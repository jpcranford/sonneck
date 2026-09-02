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
		"citation": buildCitation(eff, composerNames, arrangerNames, p.Title, bookTitle, bookWorkOpusNumber, bookISBN),
	})
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

// buildCitation implements design doc §6's fixed v1 format:
// {composer}, {Book.bookTitle}, "{title}" ({workOpusNumber}), {publisher},
// {imslpNumber falling back to publisherId}, {yearWritten} — every blank
// component omitted entirely, never shown as empty punctuation. This is
// deliberately not generic CITATION_FORMAT token substitution: blank-field
// omission doesn't fit a plain-substitution model, and a real conditional
// template engine is out of scope for now (design doc §6, §13).
//
// This diverges from §6's spec in several places — arranger, IMSLP/ISBN
// formatting and fallback precedence, book-opus-number de-duplication,
// nested-quote handling — see CLAUDE.md > Config for the full list and the
// reasoning behind each.
//
// composerNames/arrangerNames (composer/arranger overhaul, migration
// 00020) are already-resolved, ordered display names — buildCitation stays
// a pure function with no DB access, same as before; the caller resolves
// ids to names (personNames, above) and joins them into a single fused
// "Composer, arr. Arranger" segment via joinPersonNames, extending each
// role to however many people it now holds instead of exactly one.
func buildCitation(eff *repo.EffectivePiece, composerNames, arrangerNames []string, title, bookTitle, bookWorkOpusNumber, isbn string) string {
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
	// when imslpNumber is blank — an IMSLP catalog number is the more
	// useful identifier when both are known, so publisher is dropped from
	// the citation entirely rather than shown alongside it. Same rule
	// applied to ISBN below.
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

	// yearWritten is always the citation's last component when present, so
	// appending the period here — rather than after the final Join — lands
	// it at the very end of the citation without needing a separate
	// no-op-when-blank check on the whole result.
	if eff.YearWritten.Value != "" {
		parts = append(parts, eff.YearWritten.Value+".")
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
