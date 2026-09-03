package handlers

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/repo"
)

func (s *Server) handleGetCitation(w http.ResponseWriter, r *http.Request) {
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
	copyrightStatus, _, err := repo.ResolveCopyrightStatus(r.Context(), s.DB, eff, s.Cfg.CopyrightRegion)
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
		eff:                eff,
		composerNames:      composerNames,
		arrangerNames:      arrangerNames,
		title:              p.Title,
		bookTitle:          bookTitle,
		bookWorkOpusNumber: bookWorkOpusNumber,
		bookYearPublished:  bookYearPublished,
		isbn:               bookISBN,
		hasBook:            hasBook,
		copyrightStatus:    copyrightStatus,
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
// 3+) — Go port of the frontend's own joinNames (PersonDetailsSample.tsx),
// same locked convention (memory project_people_composer_overhaul.md's
// migration plan: "2 people → 'X and Y'; 3 → 'X, Y, and Z'; 4+ → 'X, Y, Z,
// and Last'").
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
}

// buildCitation implements design doc §6's fixed v1 format, extended by
// the Public Domain Badge feature (design artifact §4). The original
// single flat comma-joined format (buildFlatCitation) is unchanged and
// still used for every piece except one specific case: a piece with a
// source book whose status is In Copyright or Copyleft additionally gets
// the new two-sentence "written / published" split — locked via direct
// answer to "does the new structure apply everywhere a book exists, or
// only in-copyright" (only in-copyright/copyleft; a Public Domain piece
// with a book keeps the flat format, book info folded back into the
// single list).
//
// Every other combination keeps the flat format, with a trailing note
// appended: the "Copyright © {year} {holder}." clause for In Copyright/
// Copyleft (no book), or the newer "Public domain."/copyrightSlug note for
// Public Domain/Likely Public Domain (direct request, round 3 — a PD-ish
// citation no longer ends bare).
func buildCitation(in citationInput) string {
	showsCopyrightClause := in.copyrightStatus == "copyleft" || in.copyrightStatus == "inCopyright"

	if in.hasBook && showsCopyrightClause {
		return buildTwoSentenceCitation(in)
	}

	flat := buildFlatCitation(in.eff, in.composerNames, in.arrangerNames, in.title, in.bookTitle, in.bookWorkOpusNumber, in.isbn)
	if showsCopyrightClause {
		// copyrightClause can legitimately be "" (nothing at all to
		// attribute) — appending a bare trailing space in that case would
		// be a real, if subtle, formatting bug.
		if clause := copyrightClause(in.eff); clause != "" {
			return flat + " " + clause
		}
		return flat
	}
	return flat + " " + publicDomainNote(in.eff.CopyrightSlug.Value)
}

// buildTwoSentenceCitation is the design artifact §4 structure: composer/
// title/yearWritten as their own sentence, a "Published in ..." sentence
// carrying the book/publication facts, then the copyright clause as a
// third. Only ever called when a book is present (bookTitle would
// otherwise be empty and the "Published in" sentence meaningless).
func buildTwoSentenceCitation(in citationInput) string {
	eff := in.eff
	var sentence1 strings.Builder

	composer := joinPersonNames(in.composerNames)
	arranger := joinPersonNames(in.arrangerNames)
	switch {
	case composer != "" && arranger != "":
		fmt.Fprintf(&sentence1, "%s, arr. %s, ", composer, arranger)
	case composer != "":
		fmt.Fprintf(&sentence1, "%s, ", composer)
	case arranger != "":
		fmt.Fprintf(&sentence1, "arr. %s, ", arranger)
	}
	opus := resolveOpus(eff.WorkOpusNumber.Value, in.bookWorkOpusNumber)
	if opus.titlePrefix != "" {
		fmt.Fprintf(&sentence1, "%s ", opus.titlePrefix)
	}
	fmt.Fprintf(&sentence1, `"%s"`, strings.ReplaceAll(in.title, `"`, `'`))
	if opus.titleParen != "" {
		fmt.Fprintf(&sentence1, " (%s)", opus.titleParen)
	}
	if eff.YearWritten.Value != "" {
		fmt.Fprintf(&sentence1, ", %s", eff.YearWritten.Value)
	}
	sentence1.WriteString(".")

	var publishedParts []string
	bookPart := in.bookTitle
	if opus.bookSuffix != "" {
		bookPart += fmt.Sprintf(", %s", opus.bookSuffix)
	}
	if bookPart != "" {
		publishedParts = append(publishedParts, bookPart)
	}
	publishedParts = append(publishedParts, publisherOrIdentifierParts(eff, in.isbn)...)
	if in.bookYearPublished != "" {
		publishedParts = append(publishedParts, in.bookYearPublished)
	}
	sentence2 := "Published in " + strings.Join(publishedParts, ", ") + "."

	if clause := copyrightClause(eff); clause != "" {
		return sentence1.String() + " " + sentence2 + " " + clause
	}
	return sentence1.String() + " " + sentence2
}

// buildFlatCitation is the original (pre-Public Domain Badge feature) v1
// format, unchanged: {composer}, {Book.bookTitle}, "{title}"
// ({workOpusNumber}), {publisher}, {imslpNumber falling back to
// publisherId}, {yearWritten} — every blank component omitted entirely,
// never shown as empty punctuation. This is deliberately not generic
// CITATION_FORMAT token substitution: blank-field omission doesn't fit a
// plain-substitution model, and a real conditional template engine is out
// of scope for now (design doc §6, §13).
//
// This diverges from §6's spec in several places — arranger, IMSLP/ISBN
// formatting and fallback precedence, book-opus-number de-duplication,
// nested-quote handling — see CLAUDE.md > Config for the full list and the
// reasoning behind each.
func buildFlatCitation(eff *repo.EffectivePiece, composerNames, arrangerNames []string, title, bookTitle, bookWorkOpusNumber, isbn string) string {
	var parts []string

	composer := joinPersonNames(composerNames)
	arranger := joinPersonNames(arrangerNames)
	switch {
	case composer != "" && arranger != "":
		parts = append(parts, fmt.Sprintf("%s, arr. %s", composer, arranger))
	case composer != "":
		parts = append(parts, composer)
	case arranger != "":
		parts = append(parts, fmt.Sprintf("arr. %s", arranger))
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

	parts = append(parts, publisherOrIdentifierParts(eff, isbn)...)

	// yearWritten is always the citation's last component when present, so
	// appending the period here — rather than after the final Join — lands
	// it at the very end of the citation without needing a separate
	// no-op-when-blank check on the whole result.
	if eff.YearWritten.Value != "" {
		parts = append(parts, eff.YearWritten.Value+".")
	}

	return strings.Join(parts, ", ")
}

// publisherOrIdentifierParts is the shared publisher/publisherId/IMSLP/ISBN
// segment(s), extracted so buildFlatCitation and buildTwoSentenceCitation's
// own "Published in" sentence apply the identical fallback rule — IMSLP
// wins outright over both publisher(+publisherId) and ISBN when known
// (dropping them from the citation entirely), but publisher and ISBN are
// otherwise independent: both can render as their own separate parts when
// IMSLP is blank (e.g. "G. Schirmer, ISBN 978-0-13235088-4"), not a single
// either/or fallback chain. Returns nil when nothing in this family is set.
func publisherOrIdentifierParts(eff *repo.EffectivePiece, isbn string) []string {
	if eff.ImslpNumber.Value != "" {
		return []string{fmt.Sprintf("IMSLP #%s", stripImslpPrefix(eff.ImslpNumber.Value))}
	}

	var parts []string
	switch {
	case eff.Publisher.Value != "" && eff.PublisherID.Value != "":
		parts = append(parts, fmt.Sprintf("%s #%s", eff.Publisher.Value, eff.PublisherID.Value))
	case eff.Publisher.Value != "":
		parts = append(parts, eff.Publisher.Value)
	case eff.PublisherID.Value != "":
		parts = append(parts, fmt.Sprintf("#%s", eff.PublisherID.Value))
	}
	if isbn != "" {
		parts = append(parts, fmt.Sprintf("ISBN %s", hyphenateISBN(isbn)))
	}
	return parts
}

// copyrightClause is the "Copyright © {year} {holder}. {slug}" trailing
// note for an In Copyright/Copyleft piece (design artifact §4).
// CopyrightHolder falls back to the piece's effective Publisher when
// unset — citation-only, doesn't change what's stored/displayed anywhere
// else. Omitted entirely (returns "") when there's neither a year nor an
// effective holder to attribute to, matching this codebase's "never
// render empty punctuation" citation convention.
func copyrightClause(eff *repo.EffectivePiece) string {
	holder := eff.CopyrightHolder.Value
	if holder == "" {
		holder = eff.Publisher.Value
	}
	if eff.CopyrightYear.Value == nil && holder == "" {
		return ""
	}

	base := "Copyright ©"
	if eff.CopyrightYear.Value != nil {
		base += fmt.Sprintf(" %d", *eff.CopyrightYear.Value)
	}
	if holder != "" {
		base += " " + holder
	}
	base = endsWithPeriod(base)

	if eff.CopyrightSlug.Value != "" {
		base += " " + endsWithPeriod(eff.CopyrightSlug.Value)
	}
	return base
}

// publicDomainNote is the Public Domain/Likely Public Domain equivalent of
// copyrightClause — never the "Copyright © ..." clause itself (nothing to
// attribute once there's no copyright), just the piece's own
// copyrightSlug, or the literal "Public domain." when that's unset (direct
// request, round 3).
func publicDomainNote(slug string) string {
	if slug == "" {
		return "Public domain."
	}
	return endsWithPeriod(slug)
}

// endsWithPeriod appends a trailing period only if s doesn't already have
// one — used for both copyrightClause/publicDomainNote's own slug segment
// and copyrightClause's holder segment (a holder like "G. Schirmer, Inc."
// already ends in one from the abbreviation; appending unconditionally
// would produce "Inc..").
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
// identically regardless of which shape a given piece's citation takes
// (direct request, 2026-09-03: move a book's own catalog number up next
// to the book's name instead of leaving it folded into the piece's own
// title parenthetical).
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
		return resolvedOpus{bookSuffix: bookOpus, titlePrefix: strings.Join(remainder, ", ")}
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
