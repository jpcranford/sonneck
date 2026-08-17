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

	var bookTitle, bookWorkOpusNumber string
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
	}

	var arranger string
	if p.Arranger != nil {
		arranger = *p.Arranger
	}

	api.WriteData(w, http.StatusOK, map[string]string{
		"citation": buildCitation(eff, p.Title, arranger, bookTitle, bookWorkOpusNumber),
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
// This is deliberately not generic CITATION_FORMAT token substitution:
// blank-field omission doesn't fit a plain-substitution model, and the
// design doc explicitly defers a configurable conditional template engine
// (§6, §13) rather than asking for one here.
func buildCitation(eff *repo.EffectivePiece, title, arranger, bookTitle, bookWorkOpusNumber string) string {
	var parts []string

	composerPart := eff.Composer.Value
	if composerPart != "" && arranger != "" {
		composerPart += fmt.Sprintf(", arr. %s", arranger)
	}
	if composerPart != "" {
		parts = append(parts, composerPart)
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

	// publisherId only renders (fused onto publisher, "#" prefixed) when
	// it's the one actually in use — i.e. imslpNumber is blank. When
	// imslpNumber is present, publisherId is dropped from the citation
	// entirely, same as before this change (imslpNumber always wins the
	// fallback; the two were never both shown).
	usingPublisherID := eff.ImslpNumber.Value == "" && eff.PublisherID.Value != ""
	switch {
	case eff.Publisher.Value != "" && usingPublisherID:
		parts = append(parts, fmt.Sprintf("%s #%s", eff.Publisher.Value, eff.PublisherID.Value))
	case eff.Publisher.Value != "":
		parts = append(parts, eff.Publisher.Value)
	case usingPublisherID:
		parts = append(parts, fmt.Sprintf("#%s", eff.PublisherID.Value))
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
