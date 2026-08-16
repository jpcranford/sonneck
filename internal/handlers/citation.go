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
// {imslpNumber falling back to publisherId}, ca. {yearWritten} — every
// blank component omitted entirely, never shown as empty punctuation.
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

	if eff.Publisher.Value != "" {
		parts = append(parts, eff.Publisher.Value)
	}

	id := eff.ImslpNumber.Value
	if id == "" {
		id = eff.PublisherID.Value
	}
	if id != "" {
		parts = append(parts, id)
	}

	if eff.YearWritten.Value != "" {
		parts = append(parts, "ca. "+eff.YearWritten.Value)
	}

	return strings.Join(parts, ", ")
}
