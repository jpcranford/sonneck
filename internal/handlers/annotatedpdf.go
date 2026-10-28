package handlers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/jpcranford/sonneck/internal/annotpdf"
	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// Download PDF + Annotations: a piece's file (or a setlist's Set PDF) with
// the caller's Sheet Viewer marks added as real PDF annotations
// (internal/annotpdf), leaving out colors hidden on that piece. Needs
// `practice` on top of the download's own `read` + `download`, since the
// marks are the caller's viewer data.

// annotatedName is a download's name for its annotated copy.
func annotatedName(name string) string { return name + " (annotated)" }

// writeAnnotatedPiece writes p's file with user's marks to buf;
// annotpdf.ErrNoMarks when none would be exported.
func (s *Server) writeAnnotatedPiece(ctx context.Context, buf *bytes.Buffer, user *models.User, p *models.Piece) error {
	pages, err := repo.GetAnnotations(ctx, s.DB, user.ID, p.ID)
	if err != nil {
		return err
	}
	if len(pages) == 0 {
		return annotpdf.ErrNoMarks
	}
	settings, err := repo.GetPracticeSettings(ctx, s.DB, user.ID, p.ID)
	if err != nil {
		return err
	}
	f, err := os.Open(p.FilePath)
	if err != nil {
		return err
	}
	defer f.Close()
	return annotpdf.Write(f, buf, pages, annotpdf.Options{
		Author:       user.DisplayName,
		HiddenColors: settings.HiddenColors,
		Now:          time.Now(),
	})
}

// serveAnnotatedPiece answers GET /api/pieces/{id}/file?annotations=true.
// With nothing to add it serves the plain file under its plain name.
func (s *Server) serveAnnotatedPiece(w http.ResponseWriter, r *http.Request, p *models.Piece, filename string) {
	user, ok := s.requirePermission(w, r, models.PermissionPractice)
	if !ok {
		return
	}
	var buf bytes.Buffer
	err := s.writeAnnotatedPiece(r.Context(), &buf, user, p)
	if errors.Is(err, annotpdf.ErrNoMarks) {
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", filename+".pdf"))
		http.ServeFile(w, r, p.FilePath)
		return
	}
	if err != nil {
		s.writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", annotatedName(filename)+".pdf"))
	w.Write(buf.Bytes())
}

// annotatedSetlistFiles writes an annotated copy of each piece entry's file
// that has marks to export, to temp files, and points the entry at it.
// remove deletes the copies.
func (s *Server) annotatedSetlistFiles(ctx context.Context, user *models.User, pieceIDs []int64, paths []string) (remove func(), err error) {
	var temps []string
	remove = func() {
		for _, t := range temps {
			os.Remove(t)
		}
	}
	done := map[int64]string{}
	for i, id := range pieceIDs {
		if id == 0 {
			continue
		}
		if path, ok := done[id]; ok {
			paths[i] = path
			continue
		}
		p, err := repo.GetPieceByID(ctx, s.DB, id)
		if err != nil {
			remove()
			return nil, err
		}
		var buf bytes.Buffer
		err = s.writeAnnotatedPiece(ctx, &buf, user, p)
		if errors.Is(err, annotpdf.ErrNoMarks) {
			done[id] = paths[i]
			continue
		}
		if err != nil {
			remove()
			return nil, err
		}
		f, err := os.CreateTemp("", "sonneck-annotated-*.pdf")
		if err != nil {
			remove()
			return nil, err
		}
		temps = append(temps, f.Name())
		_, werr := f.Write(buf.Bytes())
		if cerr := f.Close(); werr == nil {
			werr = cerr
		}
		if werr != nil {
			remove()
			return nil, werr
		}
		done[id] = f.Name()
		paths[i] = f.Name()
	}
	return remove, nil
}

// annotationSummary is how many of the caller's marks a download would
// carry, and how many it leaves out for being in a hidden color.
type annotationSummary struct {
	Shown  int `json:"shown"`
	Hidden int `json:"hidden"`
}

func (s *Server) summarizeAnnotations(ctx context.Context, userID int64, pieceIDs []int64) (annotationSummary, error) {
	var sum annotationSummary
	seen := map[int64]bool{}
	for _, id := range pieceIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		pages, err := repo.GetAnnotations(ctx, s.DB, userID, id)
		if err != nil {
			return sum, err
		}
		if len(pages) == 0 {
			continue
		}
		settings, err := repo.GetPracticeSettings(ctx, s.DB, userID, id)
		if err != nil {
			return sum, err
		}
		shown, hidden, err := annotpdf.Count(pages, settings.HiddenColors)
		if err != nil {
			return sum, err
		}
		sum.Shown += shown
		sum.Hidden += hidden
	}
	return sum, nil
}

// handlePieceAnnotationSummary answers GET
// /api/pieces/{id}/annotations/summary, for Piece Details' "Download PDF +
// Annotations" (faded when there's nothing to export).
func (s *Server) handlePieceAnnotationSummary(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.practiceRequest(w, r)
	if !ok {
		return
	}
	if _, err := repo.GetPieceByID(r.Context(), s.DB, id); err != nil {
		s.writeError(w, err)
		return
	}
	sum, err := s.summarizeAnnotations(r.Context(), user.ID, []int64{id})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, sum)
}

// handleSetlistAnnotationSummary answers GET
// /api/setlists/{id}/annotations/summary: the same, over the setlist's
// pieces (each counted once).
func (s *Server) handleSetlistAnnotationSummary(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return
	}
	user, ok := s.requirePermission(w, r, models.PermissionPractice)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	if _, err := repo.GetSetlist(r.Context(), s.DB, user.ID, id); err != nil {
		s.writeError(w, err)
		return
	}
	entries, err := repo.ListSetlistEntries(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	var ids []int64
	for _, e := range entries {
		if e.PieceID != nil {
			ids = append(ids, *e.PieceID)
		}
	}
	sum, err := s.summarizeAnnotations(r.Context(), user.ID, ids)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, sum)
}
