package handlers

import (
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

	var bookTitle, bookWorkOpusNumber, bookISBN string
	if p.SourceBookID != nil {
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
	}

	api.WriteData(w, http.StatusOK, map[string]string{
		"citation": buildCitation(eff, p.Title, bookTitle, bookWorkOpusNumber, bookISBN),
	})
}

// buildCitation implements design doc §6's fixed v1 format:
// {composer}, {Book.bookTitle}, "{title}" ({workOpusNumber}), {publisher},
// {imslpNumber falling back to publisherId}, {yearWritten} — every blank
// component omitted entirely, never shown as empty punctuation.
//
// Deliberate deviation from §6's literal "ca. {yearWritten}" wording:
// yearWritten is free text specifically so it can hold its own
// approximate/uncertain-date qualifier when one applies (design doc §3:
// e.g. "ca. 1708-1711") — an unconditional "ca. " prefix here would
// misrepresent a piece with a precisely known year (e.g. "1848") as
// merely approximate. The citation renders the field's stored value
// verbatim; any "ca." belongs in the value itself, entered by the user.
//
// Deliberate deviation, added 2026-08-17: when publisherId is the one
// actually used (imslpNumber blank), it renders fused onto the publisher
// name as "{publisher} #{publisherId}" — no comma, a "#" prefix — rather
// than as its own comma-joined part like every other component. IMSLP
// number's own appearance is unchanged (still its own plain comma-joined
// part) — this only affects the publisherId fallback case, since an
// IMSLP catalog number reads fine on its own but a bare publisher ID
// ("G. Schirmer, HL50252950") read ambiguously, like a second unrelated
// value, without something marking what it actually is.
//
// Three more deliberate deviations, added 2026-08-17:
//
//  1. Arranger (§6 explicitly excludes it — "not part of the citation
//     format as currently specified" — direct instruction overrides that)
//     fuses onto the composer, same "no comma, own connector" treatment as
//     the publisherId fusion above: "{composer}, arr. {arranger}". Only
//     applied when composer is non-blank — an arranger credit with no
//     named composer to attach to doesn't render at all, same reasoning
//     as the publisherId-with-no-publisher case not inventing one either.
//
//  2. IMSLP number now renders as "IMSLP #{number}" instead of its raw
//     stored value verbatim. Existing data (and, before this change, new
//     data too) commonly already has "IMSLP" typed directly into the
//     field's own value (e.g. "IMSLP04154"), which read fine as a bare
//     citation component but reads redundant next to an explicit "IMSLP "
//     label. stripImslpPrefix strips any leading "imslp" (plus a
//     following space/colon/hash/dash, case-insensitive) before
//     formatting — this normalizes old data at render time regardless of
//     what's actually stored, on top of EditPieceModal.tsx now stripping
//     the same prefix from the value itself on save so newly-saved data
//     stops carrying it at all.
//
//  3. The book-title component now also carries the book's own opus
//     number (Book.WorkOpusNumber, not the piece's effective one) —
//     "{bookTitle}, {bookWorkOpusNumber}" — UNLESS that book opus number
//     (spaces ignored) is already contained in the piece's own effective
//     WorkOpusNumber, which happens whenever the piece doesn't override
//     it (pure inheritance) or overrides it with something that still
//     incorporates the book's number (e.g. book "Op. 68", piece
//     "Op. 68, No. 9"). Suppressing it there avoids the same opus number
//     appearing twice in one citation — once from the book title segment,
//     once from the piece's own "(workOpusNumber)" parenthetical next to
//     the title.
//
// Fourth deviation, added 2026-08-17: any double quote character inside
// title itself is rendered as a single quote before the whole title gets
// wrapped in the citation's own double quotes — a title like
// `Merry-Go-Round of Life from "Howl's Moving Castle"` would otherwise
// produce a `""Howl's Moving Castle""` collision where the title's own
// embedded quotes run straight into the citation's wrapping ones,
// unreadable as to which quote closes what. Standard nested-quote
// typographic convention (outer double, inner single) resolves it, and
// costs nothing here since titles containing a literal double quote at
// all are rare and this only ever touches that character.
//
// Fifth and sixth deviations, added 2026-08-20 (direct instruction):
//
//  5. Arranger is now book-inheritable (ResolveEffective), read via
//     eff.Arranger rather than a separately passed raw Piece column — and a
//     piece/book may now legitimately have an arranger with no composer at
//     all (ValidatePiece/ValidateBook require one of the two, not composer
//     specifically). When composer is blank but arranger isn't, the
//     composer segment renders as just "arr. {arranger}" instead of
//     disappearing entirely, which is what the old "only append arranger
//     onto an existing composer" logic would otherwise do.
//
//  6. ISBN (a Book-only field, no Piece-level override or inheritance —
//     see models.Book.ISBN) renders as its own comma-joined part right
//     after the publisher/publisherId segment, hyphenated via
//     hyphenateISBN: "{Publisher} #{PublisherID}, ISBN {hyphenated}". Only
//     when imslpNumber is blank — same "IMSLP always wins the fallback"
//     rule already applied to publisherId above, extended to ISBN for the
//     same reason (an IMSLP catalog number is the more useful identifier
//     when both are known; showing every identifier at once would clutter
//     the citation more than it'd help).
//
// Seventh deviation, added 2026-08-21 (direct instruction): publisher (and
// publisherId, fused onto it) is now dropped from the citation entirely
// whenever imslpNumber is present — previously only publisherId and ISBN
// deferred to imslpNumber this way; publisher itself still rendered
// alongside "IMSLP #...". Same "IMSLP is the more useful identifier when
// both are known" reasoning as the ISBN/publisherId fallback above,
// extended to cover publisher too.
//
// This is deliberately not generic CITATION_FORMAT token substitution:
// blank-field omission doesn't fit a plain-substitution model, and the
// design doc explicitly defers a configurable conditional template engine
// (§6, §13) rather than asking for one here.
func buildCitation(eff *repo.EffectivePiece, title, bookTitle, bookWorkOpusNumber, isbn string) string {
	var parts []string

	switch {
	case eff.Composer.Value != "" && eff.Arranger.Value != "":
		parts = append(parts, fmt.Sprintf("%s, arr. %s", eff.Composer.Value, eff.Arranger.Value))
	case eff.Composer.Value != "":
		parts = append(parts, eff.Composer.Value)
	case eff.Arranger.Value != "":
		parts = append(parts, fmt.Sprintf("arr. %s", eff.Arranger.Value))
	}

	bookPart := bookTitle
	if bookTitle != "" && bookWorkOpusNumber != "" && !containsIgnoringSpaces(eff.WorkOpusNumber.Value, bookWorkOpusNumber) {
		bookPart += fmt.Sprintf(", %s", bookWorkOpusNumber)
	}
	if bookPart != "" {
		parts = append(parts, bookPart)
	}

	titlePart := fmt.Sprintf(`"%s"`, strings.ReplaceAll(title, `"`, `'`))
	if eff.WorkOpusNumber.Value != "" {
		titlePart += fmt.Sprintf(" (%s)", eff.WorkOpusNumber.Value)
	}
	parts = append(parts, titlePart)

	// Publisher (and publisherId, fused on as "#" prefixed) only render
	// when imslpNumber is blank — same "IMSLP wins the fallback entirely"
	// rule already applied to ISBN below. Added 2026-08-21, direct
	// instruction: an IMSLP catalog number is the more useful identifier
	// when both are known, so publisher is dropped from the citation
	// entirely rather than shown alongside it.
	if eff.ImslpNumber.Value == "" {
		switch {
		case eff.Publisher.Value != "" && eff.PublisherID.Value != "":
			parts = append(parts, fmt.Sprintf("%s #%s", eff.Publisher.Value, eff.PublisherID.Value))
		case eff.Publisher.Value != "":
			parts = append(parts, eff.Publisher.Value)
		case eff.PublisherID.Value != "":
			parts = append(parts, fmt.Sprintf("#%s", eff.PublisherID.Value))
		}
	}

	// Same "IMSLP wins the fallback entirely" rule as publisherId above —
	// isbn is only book-sourced (never a Piece-level field), so there's no
	// effective-value resolution to do here, just the blank/imslpNumber
	// gate.
	if eff.ImslpNumber.Value == "" && isbn != "" {
		parts = append(parts, fmt.Sprintf("ISBN %s", hyphenateISBN(isbn)))
	}

	if eff.ImslpNumber.Value != "" {
		parts = append(parts, fmt.Sprintf("IMSLP #%s", stripImslpPrefix(eff.ImslpNumber.Value)))
	}

	if eff.YearWritten.Value != "" {
		parts = append(parts, eff.YearWritten.Value)
	}

	return strings.Join(parts, ", ")
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
// registration group via a simplified heuristic (approved 2026-08-20):
// registration groups 0/1/2/3/4/5/7 are single-digit under the real ISBN
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
