package handlers

import (
	"fmt"
	"net/http"
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

	var bookTitle string
	if p.SourceBookID != nil {
		book, err := repo.GetBookByID(r.Context(), s.DB, *p.SourceBookID)
		if err != nil {
			s.writeError(w, err)
			return
		}
		bookTitle = book.BookTitle
	}

	api.WriteData(w, http.StatusOK, map[string]string{
		"citation": buildCitation(eff, p.Title, bookTitle),
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
// This is deliberately not generic CITATION_FORMAT token substitution:
// blank-field omission doesn't fit a plain-substitution model, and the
// design doc explicitly defers a configurable conditional template engine
// (§6, §13) rather than asking for one here.
func buildCitation(eff *repo.EffectivePiece, title, bookTitle string) string {
	var parts []string

	if eff.Composer.Value != "" {
		parts = append(parts, eff.Composer.Value)
	}
	if bookTitle != "" {
		parts = append(parts, bookTitle)
	}

	titlePart := fmt.Sprintf(`"%s"`, title)
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
		parts = append(parts, eff.ImslpNumber.Value)
	}

	if eff.YearWritten.Value != "" {
		parts = append(parts, eff.YearWritten.Value)
	}

	return strings.Join(parts, ", ")
}
