package handlers

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func (s *Server) handleGetCitation(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}

	p, err := repo.GetPieceByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	eff, err := repo.ResolveEffective(r.Context(), s.DB, p)
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Composer/Arranger are ordered lists now (migration 00020) — resolved
	// to display names here, at the one place that needs to actually
	// render them, rather than carrying names inside EffectivePiece itself
	// (which stays DB-decoupled, ids only, same as InstrumentIDs).
	composerNames, err := personNames(r.Context(), s.DB, eff.Composer.IDs)
	if err != nil {
		s.writeError(w, err)
		return
	}
	arrangerNames, err := personNames(r.Context(), s.DB, eff.Arranger.IDs)
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Public Domain Badge feature — the effective (computed/overridden)
	// status the badge itself shows, not just the raw explicit pick.
	// calculatedLikelyPD is the raw calculation's own conclusion, needed
	// separately to decide whether an explicit 'publicDomain' pick
	// contradicts what the calculation would otherwise show (see
	// buildCitation's own comment on the note it guards).
	copyrightStatus, _, calculatedLikelyPD, err := repo.ResolveCopyrightStatus(r.Context(), s.DB, eff, s.Cfg.CopyrightRegion())
	if err != nil {
		s.writeError(w, err)
		return
	}

	var bookTitle, bookWorkOpusNumber, bookISBN, bookYearPublished string
	hasBook := p.SourceBookID != nil
	if hasBook {
		book, err := repo.GetBookByID(r.Context(), s.DB, *p.SourceBookID)
		if err != nil {
			s.writeError(w, err)
			return
		}
		bookTitle = book.BookTitle
		if book.WorkOpusNumber != nil {
			bookWorkOpusNumber = *book.WorkOpusNumber
		}
		if book.ISBN != nil {
			bookISBN = *book.ISBN
		}
		if book.YearPublished != nil {
			bookYearPublished = *book.YearPublished
		}
	}

	citation := buildCitation(citationInput{
		eff:                    eff,
		composerNames:          composerNames,
		arrangerNames:          arrangerNames,
		title:                  p.Title,
		bookTitle:              bookTitle,
		bookWorkOpusNumber:     bookWorkOpusNumber,
		bookYearPublished:      bookYearPublished,
		isbn:                   bookISBN,
		hasBook:                hasBook,
		copyrightStatus:        copyrightStatus,
		calculatedLikelyPD:     calculatedLikelyPD,
		arrangementYearWritten: resolveArrangementYearWritten(p.YearWritten, bookYearPublished, p.CopyrightYear),
	})

	api.WriteData(w, http.StatusOK, map[string]string{"citation": citation})
}

// personNames resolves an ordered list of person ids to their display
// names, in the same order — the citation/download-filename layer's own
// thin wrapper over repo.PeopleByIDs (which already preserves order).
func personNames(ctx context.Context, q repo.Queryer, ids []int64) ([]string, error) {
	people, err := repo.PeopleByIDs(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	names := make([]string, len(people))
	for i, p := range people {
		names[i] = p.Name
	}
	return names, nil
}

// joinPersonNames formats an ordered list of person names as a natural
// English list: "" / "X" / "X and Y" / "X, Y, and Z" (Oxford comma for
// 3+) — Go port of the frontend's own joinNames (PersonDetailsSample.tsx).
func joinPersonNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	default:
		return strings.Join(names[:len(names)-1], ", ") + ", and " + names[len(names)-1]
	}
}

// citationInput bundles buildCitation's inputs — grown too large for a
// positional parameter list once the Public Domain Badge feature added
// hasBook/copyrightStatus/bookYearPublished on top of the original set.
type citationInput struct {
	eff                *repo.EffectivePiece
	composerNames      []string
	arrangerNames      []string
	title              string
	bookTitle          string
	bookWorkOpusNumber string
	bookYearPublished  string
	isbn               string
	hasBook            bool
	// copyrightStatus is the piece's EFFECTIVE status (repo.ResolveCopyrightStatus's
	// result — already corrected forward by the live calculation), one of
	// 'publicDomain' / 'copyleft' / 'likelyPublicDomain' / 'inCopyright'.
	copyrightStatus string
	// calculatedLikelyPD is the raw calculation's own conclusion
	// (repo.ResolveCopyrightStatus's 3rd return value), independent of any
	// explicit override — see buildCitation's own comment on the one place
	// this is actually consulted.
	calculatedLikelyPD bool
	// arrangementYearWritten is effectiveArrangementYearWritten —
	// resolveArrangementYearWritten's own result, computed once in
	// handleGetCitation and used as the citation's year in place of plain
	// yearWritten only when arrangerNames is non-empty (citationYear).
	arrangementYearWritten string
}

// buildCitation implements design doc §6's fixed v1 format, extended by
// the Public Domain Badge feature (design artifact §4). The original
// single flat comma-joined format (buildFlatCitation) is unchanged and
// still used for every piece except one specific case: a piece with a
// source book whose status is In Copyright or Copyleft additionally gets
// the new two-sentence "written / published" split (only in-copyright/
// copyleft; a Public Domain piece with a book keeps the flat format, book
// info folded back into the single list).
//
// Every other combination keeps the flat format, with a trailing
// "Copyright © {year} {holder}." clause appended for In Copyright/Copyleft
// (no book) when there's anything to attribute. A Public Domain/Likely
// Public Domain citation ends bare by default — no trailing note — with
// one deliberate exception: an explicit 'publicDomain' pick that actually
// contradicts what the live calculation would otherwise show (i.e. the
// calculation alone would call this piece In Copyright) keeps a bare literal
// "Public domain." note, since silently ending the citation there would
// read as unexplained rather than simply unremarkable. `likelyPublicDomain`
// never hits this — it's derived *from* the calculation, so it can't
// contradict it.
//
// This trailing note is always the literal "Public domain." — never the
// piece's own CopyrightSlug: a piece's citation once showed "Released into
// public domain on November 26, 2022." — its CopyrightSlug — in place of
// "Public domain.", which read as the slug silently overriding/hiding the
// actual PD status rather than clarifying it. An earlier version of this
// feature substituted the slug here when set; that's been dropped — the
// slug still displays on its own in Piece Details' Advanced/Get Info panel
// ("Copyright details" row) regardless of status, just never folded into
// the citation's own PD note.
func buildCitation(in citationInput) string {
	showsCopyrightClause := in.copyrightStatus == "copyleft" || in.copyrightStatus == "inCopyright"

	if in.hasBook && showsCopyrightClause {
		return buildTwoSentenceCitation(in)
	}

	flat := buildFlatCitation(in.eff, in.composerNames, in.arrangerNames, in.title, in.bookTitle, in.bookWorkOpusNumber, in.isbn, in.arrangementYearWritten)
	if showsCopyrightClause {
		// copyrightClause can legitimately be "" (nothing at all to
		// attribute) — appending a bare trailing space in that case would
		// be a real, if subtle, formatting bug.
		if clause := copyrightClause(in.eff, in.composerNames, in.arrangerNames); clause != "" {
			// endsWithPeriod(flat), not flat + " " + clause: buildFlatCitation
			// only ends flat in a period when yearWritten is set (its own
			// last-component rule, and a citation with no year legitimately
			// has no trailing period on its own — TestCitation_ArrangerAloneWithNoComposer
			// et al. cover that bare case). A yearWritten-less piece's
			// citation once read `"A Christmas Carol" Public domain.` —
			// missing the period that should separate the title from the
			// appended note. Same gap applied here, just
			// never surfaced because every existing copyrightClause test
			// happened to set yearWritten.
			return endsWithPeriod(flat) + " " + clause
		}
		return flat
	}
	if in.copyrightStatus == "publicDomain" && !in.calculatedLikelyPD {
		return endsWithPeriod(flat) + " Public domain."
	}
	return flat
}

// pieceOwnsImslp reports whether eff's effective IMSLP number came from the
// piece itself, not inherited from its book — the switch buildTwoSentenceCitation
// uses to decide both where the number is shown (folded into the first
// sentence, like a flat citation, vs. as its own segment in the publish
// sentence) and whether the publish sentence exists at all: a piece
// already pinned to its own IMSLP record doesn't need a second sentence
// restating facts that record already carries — a *book*-level IMSLP
// number doesn't carry that same implication, since the piece itself isn't
// independently catalogued there.
func pieceOwnsImslp(eff *repo.EffectivePiece) bool {
	return eff.ImslpNumber.Value != "" && !eff.ImslpNumber.Inherited
}

// resolveArrangementYearWritten computes the year a citation ends with when
// the piece has an arranger (citationYear) — the same fallback chain repo's own resolveYearWritten uses for the
// piece's plain YearWritten field (piece's own value, else piece's own
// CopyrightYear, else the book's YearPublished), with tiers 2 and 3
// swapped: the book's YearPublished is a better proxy for "when was this
// arrangement made" than the piece's own copyright year, which may
// describe the ORIGINAL work's copyright rather than this arrangement's —
// so it's checked first, ahead of the piece's own copyright year.
// Citation-only — doesn't change YearWritten's own resolution or anything
// else exposed on PieceResponse.
func resolveArrangementYearWritten(pieceYearWritten *string, bookYearPublished string, pieceCopyrightYear *int) string {
	if pieceYearWritten != nil && strings.TrimSpace(*pieceYearWritten) != "" {
		return *pieceYearWritten
	}
	if bookYearPublished != "" {
		return bookYearPublished
	}
	if pieceCopyrightYear != nil {
		return strconv.Itoa(*pieceCopyrightYear)
	}
	return ""
}

// citationYear is the year a citation's first sentence ends with: the
// arrangement year (resolveArrangementYearWritten) whenever the piece has an
// arranger (the year then dates the arrangement, and the book's year is a
// better proxy for that than the piece's own copyright year), else the
// piece's plain effective yearWritten. Shared by buildFlatCitation and
// buildTwoSentenceCitation.
func citationYear(eff *repo.EffectivePiece, arranger, arrangementYearWritten string) string {
	if arranger != "" {
		return arrangementYearWritten
	}
	return eff.YearWritten.Value
}

// buildTwoSentenceCitation is the design artifact §4 structure, extended
// beyond the original fixed "written / published" split with three
// further rules:
//
//  1. An opus match (the book's own opus number contained in the piece's
//     effective one — resolvedOpus.matched) means the piece is part of a
//     greater work, so the book's title/opus fold directly into the first
//     sentence, exactly like a flat citation already does — the same
//     resolveOpus call already decides this via titlePrefix/titleParen, this
//     just also gates whether bookTitle+bookSuffix join sentence 1.
//  2. The piece's own IMSLP number (pieceOwnsImslp, not merely inherited
//     from the book) also earns a spot in the first sentence — independent
//     of whether #1 applies — and suppresses the publish sentence entirely.
//     A *book*-owned IMSLP number instead becomes its own segment inside the
//     publish sentence, alongside publisher/publisherId rather than
//     replacing them (a deliberate divergence from publisherOrIdentifierParts'
//     normal dominant-IMSLP-wins rule — see that function's own comment).
//  3. An arranger renders inline in sentence 1 as ", arr. {arranger}",
//     right after the title (and its opus parenthetical), same placement
//     as buildFlatCitation, and sentence 1's year becomes the arrangement
//     year (citationYear).
//
// Only ever called when a book is present.
func buildTwoSentenceCitation(in citationInput) string {
	eff := in.eff
	opus := resolveOpus(eff.WorkOpusNumber.Value, in.bookWorkOpusNumber)
	ownsImslp := pieceOwnsImslp(eff)

	var sentence1 strings.Builder
	composer := joinPersonNames(in.composerNames)
	arranger := joinPersonNames(in.arrangerNames)
	if composer != "" {
		fmt.Fprintf(&sentence1, "%s, ", composer)
	}

	if opus.matched {
		bookPart := in.bookTitle
		if opus.bookSuffix != "" {
			bookPart += fmt.Sprintf(", %s", opus.bookSuffix)
		}
		if bookPart != "" {
			fmt.Fprintf(&sentence1, "%s, ", bookPart)
		}
	}
	if opus.titlePrefix != "" {
		fmt.Fprintf(&sentence1, "%s ", opus.titlePrefix)
	}
	fmt.Fprintf(&sentence1, `"%s"`, strings.ReplaceAll(in.title, `"`, `'`))
	if opus.titleParen != "" {
		fmt.Fprintf(&sentence1, " (%s)", opus.titleParen)
	}
	if arranger != "" {
		fmt.Fprintf(&sentence1, ", arr. %s", arranger)
	}
	if ownsImslp {
		fmt.Fprintf(&sentence1, ", IMSLP #%s", stripImslpPrefix(eff.ImslpNumber.Value))
	}
	if year := citationYear(eff, arranger, in.arrangementYearWritten); year != "" {
		fmt.Fprintf(&sentence1, ", %s", year)
	}
	sentence1.WriteString(".")

	parts := []string{sentence1.String()}

	if ownsImslp {
		if clause := copyrightClause(eff, in.composerNames, in.arrangerNames); clause != "" {
			parts = append(parts, clause)
		}
		return strings.Join(parts, " ")
	}

	var publishParts []string
	if !opus.matched && in.bookTitle != "" {
		bookPart := in.bookTitle
		if opus.bookSuffix != "" {
			bookPart += fmt.Sprintf(", %s", opus.bookSuffix)
		}
		publishParts = append(publishParts, bookPart)
	}
	if assembly := fusePublisherAndID(eff.Publisher.Value, eff.PublisherID.Value); assembly != "" {
		publishParts = append(publishParts, assembly)
	}
	switch {
	case eff.ImslpNumber.Value != "": // book-owned, since ownsImslp is false here
		publishParts = append(publishParts, fmt.Sprintf("IMSLP #%s", stripImslpPrefix(eff.ImslpNumber.Value)))
	case in.isbn != "":
		publishParts = append(publishParts, fmt.Sprintf("ISBN %s", hyphenateISBN(in.isbn)))
	}
	if in.bookYearPublished != "" {
		publishParts = append(publishParts, in.bookYearPublished)
	}

	if len(publishParts) > 0 {
		verb := "Published in "
		if opus.matched {
			verb = "Published by "
		}
		parts = append(parts, verb+strings.Join(publishParts, ", ")+".")
	}

	if clause := copyrightClause(eff, in.composerNames, in.arrangerNames); clause != "" {
		parts = append(parts, clause)
	}
	return strings.Join(parts, " ")
}

// buildFlatCitation is the original (pre-Public Domain Badge feature) v1
// format: {composer}, {Book.bookTitle}, "{title}" ({workOpusNumber}),
// arr. {arranger}, {publisher}, {imslpNumber falling back to publisherId},
// {yearWritten} —
// every blank component omitted entirely, never shown as empty
// punctuation. This is deliberately not generic CITATION_FORMAT token
// substitution: blank-field omission doesn't fit a plain-substitution
// model, and a real conditional template engine is out of scope for now
// (design doc §6, §13).
//
// An arranger renders inline as its own "arr. {arranger}" part right after
// the title, and the trailing year becomes the arrangement year
// (citationYear): one line either way, nothing else in it moves.
//
// This diverges from §6's spec in several places — arranger placement,
// IMSLP/ISBN formatting and fallback precedence, book-opus-number
// de-duplication, nested-quote handling — see CLAUDE.md > Config for the
// full list and the reasoning behind each.
func buildFlatCitation(eff *repo.EffectivePiece, composerNames, arrangerNames []string, title, bookTitle, bookWorkOpusNumber, isbn, arrangementYearWritten string) string {
	var parts []string

	if composer := joinPersonNames(composerNames); composer != "" {
		parts = append(parts, composer)
	}

	opus := resolveOpus(eff.WorkOpusNumber.Value, bookWorkOpusNumber)

	bookPart := bookTitle
	if bookTitle != "" && opus.bookSuffix != "" {
		bookPart += fmt.Sprintf(", %s", opus.bookSuffix)
	}
	if bookPart != "" {
		parts = append(parts, bookPart)
	}

	titlePart := ""
	if opus.titlePrefix != "" {
		titlePart = opus.titlePrefix + " "
	}
	titlePart += fmt.Sprintf(`"%s"`, strings.ReplaceAll(title, `"`, `'`))
	if opus.titleParen != "" {
		titlePart += fmt.Sprintf(" (%s)", opus.titleParen)
	}
	parts = append(parts, titlePart)

	arranger := joinPersonNames(arrangerNames)
	if arranger != "" {
		parts = append(parts, "arr. "+arranger)
	}

	parts = append(parts, publisherOrIdentifierParts(eff, isbn)...)

	// The year is always the citation's last component when present, so
	// appending the period here, rather than after the final Join, lands
	// it at the very end of the citation without needing a separate
	// no-op-when-blank check on the whole result.
	if year := citationYear(eff, arranger, arrangementYearWritten); year != "" {
		parts = append(parts, year+".")
	}
	return strings.Join(parts, ", ")
}

// publisherOrIdentifierParts is the shared publisher/publisherId/IMSLP/ISBN
// segment(s) for a citation's single flat identifier slot — buildFlatCitation
// itself, and buildTwoSentenceCitation's own first sentence when the piece
// has its own IMSLP number (see pieceOwnsImslp). IMSLP wins outright over
// both publisher(+publisherId) and ISBN when known (dropping them from the
// citation entirely), but publisher and ISBN are otherwise independent: both
// can render as their own separate parts when IMSLP is blank (e.g.
// "G. Schirmer, ISBN 978-0-13235088-4"), not a single either/or fallback
// chain. Returns nil when nothing in this family is set.
//
// This dominant-IMSLP-wins rule is specific to a single flat identifier
// slot — buildTwoSentenceCitation's own "Published in/by" sentence
// deliberately does NOT reuse this function when the *book* (not the piece)
// owns the IMSLP number, since that sentence is specifically about the
// book's own publication facts and treats a book-level IMSLP as one more
// fact alongside publisher, not a replacement for it — distinguishing
// "piece has the IMSLP number" from "book has the IMSLP number" as two
// different cases.
func publisherOrIdentifierParts(eff *repo.EffectivePiece, isbn string) []string {
	if eff.ImslpNumber.Value != "" {
		return []string{fmt.Sprintf("IMSLP #%s", stripImslpPrefix(eff.ImslpNumber.Value))}
	}

	var parts []string
	if assembly := fusePublisherAndID(eff.Publisher.Value, eff.PublisherID.Value); assembly != "" {
		parts = append(parts, assembly)
	}
	if isbn != "" {
		parts = append(parts, fmt.Sprintf("ISBN %s", hyphenateISBN(isbn)))
	}
	return parts
}

// fusePublisherAndID formats publisher+publisherId as "{publisher} #{id}"
// when both are set, falling back to whichever one alone is set, or "" when
// neither is — the shared publisher-naming rule every citation format uses,
// factored out since publisherOrIdentifierParts and
// buildTwoSentenceCitation's own publish-sentence assembly both need it but
// otherwise combine it with different things (IMSLP-dominant vs.
// IMSLP-additive).
func fusePublisherAndID(publisher, publisherID string) string {
	switch {
	case publisher != "" && publisherID != "":
		return fmt.Sprintf("%s #%s", publisher, publisherID)
	case publisher != "":
		return publisher
	case publisherID != "":
		return fmt.Sprintf("#%s", publisherID)
	default:
		return ""
	}
}

// copyrightClause is the "Copyright © {year} (renewed) {holder}. {slug}"
// trailing note for an In Copyright/Copyleft piece (design artifact §4).
// CopyrightHolder falls back when unset (citation-only, doesn't change
// what's stored/displayed anywhere else): to the arranger(s), else the
// composer(s), when the effective publisher is "self-published"
// (isSelfPublished), since the work's own creator holds it rather than a
// literal "Self-Published" imprint; otherwise to the effective Publisher.
// An explicitly entered holder always wins. Omitted entirely (returns "") when there's neither a year nor an
// effective holder to attribute to, matching this codebase's "never
// render empty punctuation" citation convention.
//
// "(renewed)" (US renewal follow-up) appears
// right after the year, before the holder, whenever CopyrightRenewed is
// set — bare, no specific year: the exact renewal filing year never
// affects the term calculation (a renewed pre-1964 US work always gets 95
// years from the copyright year already shown, not from whenever within
// its filing window the renewal happened — see
// internal/copyright.ComputeLikelyPublicDomain's own doc comment), so
// there's nothing more precise to add here than the bare fact itself.
func copyrightClause(eff *repo.EffectivePiece, composerNames, arrangerNames []string) string {
	holder := eff.CopyrightHolder.Value
	if holder == "" && isSelfPublished(eff.Publisher.Value) {
		holder = joinPersonNames(arrangerNames)
		if holder == "" {
			holder = joinPersonNames(composerNames)
		}
	}
	if holder == "" {
		holder = eff.Publisher.Value
	}
	if eff.CopyrightYear.Value == nil && holder == "" {
		return ""
	}

	// A non-breaking space (U+00A0), not a plain space, right after © —
	// keeps it glued to whatever immediately follows (the year, or the
	// holder when there's no year) instead of ever wrapping onto its own
	// line.
	base := "Copyright © "
	if eff.CopyrightYear.Value != nil {
		base += fmt.Sprintf("%d", *eff.CopyrightYear.Value)
		if eff.CopyrightRenewed.Value {
			base += " (renewed)"
		}
		if holder != "" {
			base += " " + holder
		}
	} else if holder != "" {
		base += holder
	}
	base = endsWithPeriod(base)

	if eff.CopyrightSlug.Value != "" {
		base += " " + endsWithPeriod(eff.CopyrightSlug.Value)
	}
	return base
}

// isSelfPublished reports whether a publisher value means "self-published",
// ignoring case, spaces, and punctuation: "Self-Published", "self
// published", "SELF PUBLISHED." and "Self–published" all match. Only
// letters and digits are compared.
func isSelfPublished(publisher string) bool {
	var b strings.Builder
	for _, r := range publisher {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String() == "selfpublished"
}

// endsWithPeriod appends a trailing period only if s doesn't already have
// one — used for both copyrightClause's own slug segment and its holder
// segment (a holder like "G. Schirmer, Inc." already ends in one from the
// abbreviation; appending unconditionally would produce "Inc..").
func endsWithPeriod(s string) string {
	if strings.HasSuffix(s, ".") {
		return s
	}
	return s + "."
}

var imslpPrefixPattern = regexp.MustCompile(`(?i)^\s*imslp[\s:#-]*`)

// stripImslpPrefix removes a leading "IMSLP" label (however it was typed
// in — with or without a space/colon/hash/dash separator, any case) from
// a stored imslpNumber value, so buildCitation's own "IMSLP #" label never
// doubles up with one already baked into the data.
func stripImslpPrefix(s string) string {
	return imslpPrefixPattern.ReplaceAllString(s, "")
}

// hyphenateISBN formats a clean digit(+X) ISBN for display, detecting
// ISBN-10 vs ISBN-13 by length (10 vs 13 characters) and splitting off the
// registration group via a simplified heuristic — a deliberate scope
// tradeoff, not an oversight, see below: registration groups 0/1/2/3/4/5/7
// are single-digit under the real ISBN
// Agency spec (respectively English, English, French, German, Japan,
// Russian/CIS, and Chinese — among the registration groups this app is
// most likely to actually see); every other leading digit gets a 2-digit
// group instead. This is NOT officially correct hyphenation — true
// correctness needs the Agency's own range tables (exactly which
// group/publisher-prefix boundaries exist, and how many digits each
// occupies), which this project deliberately isn't embedding or
// maintaining. The registration-group and publisher/title segments are
// further lumped into a single block rather than also guessing a
// publisher-prefix boundary — that guess would be even less reliable than
// the group-length one, and compounding two approximations isn't worth it.
// Anything that isn't exactly 10 or 13 characters (incomplete/malformed
// data) is returned unhyphenated rather than guessed at.
func hyphenateISBN(digits string) string {
	switch len(digits) {
	case 10:
		group := isbnRegistrationGroupLength(digits[:1])
		return digits[:group] + "-" + digits[group:9] + "-" + digits[9:]
	case 13:
		ean, rest := digits[:3], digits[3:]
		group := isbnRegistrationGroupLength(rest[:1])
		return ean + "-" + rest[:group] + "-" + rest[group:9] + "-" + rest[9:]
	default:
		return digits
	}
}

func isbnRegistrationGroupLength(firstDigit string) int {
	switch firstDigit {
	case "0", "1", "2", "3", "4", "5", "7":
		return 1
	default:
		return 2
	}
}

// containsIgnoringSpaces reports whether needle appears in haystack once
// all spaces are stripped from both — "Op. 68" is considered contained in
// "Op. 68, No. 9" this way. An empty needle never matches (nothing to
// dedupe against).
func containsIgnoringSpaces(haystack, needle string) bool {
	if needle == "" {
		return false
	}
	strip := func(s string) string { return strings.ReplaceAll(s, " ", "") }
	return strings.Contains(strip(haystack), strip(needle))
}

// resolvedOpus bundles how a piece's own effective opus number should
// render relative to its source book's — computed once by resolveOpus
// below, shared by buildFlatCitation's single-line format and
// buildTwoSentenceCitation's two-sentence one, so "Op. 25" renders
// identically regardless of which shape a given piece's citation takes —
// a book's own catalog number moves up next to the book's name instead of
// leaving it folded into the piece's own title parenthetical.
type resolvedOpus struct {
	// bookSuffix is appended onto the book title unconditionally whenever
	// the book has an opus number set (", {bookWorkOpusNumber}") — a
	// reversal of the original rule, which suppressed it whenever the
	// piece's own opus already incorporated it. See titlePrefix below for
	// what replaced that suppression.
	bookSuffix string
	// titlePrefix, when non-empty, is prepended to the quoted title with a
	// plain space — not a comma, not parens (e.g. `No. 5 "Prélude"`) — the
	// piece's own distinguishing remainder once the book's opus has been
	// subtracted back out of it (book "Op. 12" + piece "Op. 12 No. 5" →
	// "No. 5"). Empty when the piece purely inherits the book's opus
	// verbatim, with nothing of its own to add — the title then renders
	// bare, with no opus text anywhere near it.
	titlePrefix string
	// titleParen, when non-empty, is appended to the quoted title as
	// " (...)" — the original, unchanged behavior for a piece whose own
	// opus doesn't incorporate the book's at all (no book, a book with no
	// opus of its own, or a piece opus that references something else
	// entirely, e.g. two different catalog systems).
	titleParen string
	// matched mirrors which of titlePrefix/titleParen was taken (true only
	// for the "piece's opus incorporates the book's" branch) — exposed as
	// its own bool, rather than making every caller re-derive it from which
	// of the other two fields is non-empty (both are legitimately empty
	// together in the matched branch, when the piece's opus is identical to
	// the book's with nothing of its own to add). buildTwoSentenceCitation
	// uses this directly to decide whether the book's title/opus fold into
	// its first sentence — an opus match means "the piece is
	// part of a greater work," so the book moves up to join it.
	matched bool
}

// resolveOpus decides which of resolvedOpus's two mutually exclusive
// shapes applies: pieceOpus is EffectivePiece.WorkOpusNumber.Value (the
// piece's own, book-inherited when the piece has no override of its own —
// see repo/effective.go), bookOpus is the source book's own
// WorkOpusNumber column read directly (not the piece's effective one).
//
// When the book has an opus AND the piece's own opus incorporates it (the
// existing containsIgnoringSpaces check — true both for pure inheritance,
// where the two are identical, and for an override like book "Op. 68" /
// piece "Op. 68, No. 9"): the book's opus always renders next to the
// book's name, and only whatever's left of the piece's own opus after
// subtracting the book's back out becomes the title's own prefix.
//
// Otherwise: unchanged from the original behavior — the book shows its
// own opus if it has one (never suppressed here, since there's nothing to
// dedupe against), and the piece's full own opus renders as the title's
// "(...)" suffix, entirely independently.
func resolveOpus(pieceOpus, bookOpus string) resolvedOpus {
	if bookOpus != "" && containsIgnoringSpaces(pieceOpus, bookOpus) {
		before, after, _ := splitAroundIgnoringSpaces(pieceOpus, bookOpus)
		var remainder []string
		if before != "" {
			remainder = append(remainder, before)
		}
		if after != "" {
			remainder = append(remainder, after)
		}
		return resolvedOpus{bookSuffix: bookOpus, titlePrefix: strings.Join(remainder, ", "), matched: true}
	}
	return resolvedOpus{bookSuffix: bookOpus, titleParen: pieceOpus}
}

// splitAroundIgnoringSpaces finds needle within haystack the same
// space-insensitive way containsIgnoringSpaces does (spaces stripped from
// both before comparing — rune-based throughout, not byte-based, so a
// haystack carrying non-ASCII characters elsewhere doesn't misalign the
// match), then returns whatever's left in haystack before and after the
// matched span, each trimmed of the stray leading/trailing comma or space
// the removal can leave behind — e.g. splitting "Op. 12 No. 5" around
// "Op. 12" returns ("", "No. 5"); splitting "Op. 68, No. 9" around
// "Op. 68" returns ("", "No. 9"). found is false (both returned strings
// "") when needle isn't present this way.
func splitAroundIgnoringSpaces(haystack, needle string) (before, after string, found bool) {
	needleCompact := []rune(strings.ReplaceAll(needle, " ", ""))
	if len(needleCompact) == 0 {
		return "", "", false
	}

	haystackRunes := []rune(haystack)
	var compact []rune
	origIndex := make([]int, 0, len(haystackRunes))
	for i, r := range haystackRunes {
		if r == ' ' {
			continue
		}
		compact = append(compact, r)
		origIndex = append(origIndex, i)
	}

	pos := runesIndex(compact, needleCompact)
	if pos == -1 {
		return "", "", false
	}

	startOrig := origIndex[pos]
	endOrig := origIndex[pos+len(needleCompact)-1] + 1
	before = trimSeparators(string(haystackRunes[:startOrig]))
	after = trimSeparators(string(haystackRunes[endOrig:]))
	return before, after, true
}

// runesIndex is strings.Index for []rune — needed because
// splitAroundIgnoringSpaces builds its "compact" (spaces removed) haystack
// as runes to keep its position-mapping back to the original string
// correct for any non-ASCII content, so it can't hand off to strings.Index
// (which works in bytes) without re-introducing that risk.
func runesIndex(haystack, needle []rune) int {
	if len(needle) == 0 || len(needle) > len(haystack) {
		return -1
	}
outer:
	for i := 0; i+len(needle) <= len(haystack); i++ {
		for j := range needle {
			if haystack[i+j] != needle[j] {
				continue outer
			}
		}
		return i
	}
	return -1
}

// trimSeparators strips the leading/trailing whitespace and comma
// punctuation splitAroundIgnoringSpaces' removal can leave dangling at
// either edge (", No. 9" → "No. 9"; "No. 9, " → "No. 9").
func trimSeparators(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, ",")
	return strings.TrimSpace(s)
}
