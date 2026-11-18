package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/pdf"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/setlistpdf"
)

// programImagePPI renders the 540pt-wide program image 1080 pixels wide.
const programImagePPI = 144

// handleGetSetlistProgramImage is Setlist Details' "Copy program as image"
// (design F): the program as a PNG, 1080 pixels wide and as tall as the
// program, drawn with the Set PDF's fonts and print colors
// (setlistpdf.ProgramImage) and rendered by poppler. Read only, like the
// program's text: copying needs no download permission. The frontend copies
// it to the clipboard, or saves it where the connection can't copy images.
func (s *Server) handleGetSetlistProgramImage(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	setlist, err := repo.GetSetlist(r.Context(), s.DB, user.ID, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := s.buildSetlistResponse(r, setlist)
	if err != nil {
		s.writeError(w, err)
		return
	}

	// The entries as the program copy lists them: role, title (opus) and
	// credit for a piece; a custom entry by name, numbered only when it
	// counts as music.
	in := setlistpdf.ProgramImageInput{Name: setlist.Name}
	if setlist.GigDate != nil {
		if t, parseErr := time.Parse("2006-01-02", *setlist.GigDate); parseErr == nil {
			in.Date = weekdayDateFormatter(r)(t)
		}
	}
	for _, e := range resp.Entries {
		row := setlistpdf.ProgramImageRow{Number: e.DisplayNumber}
		if e.Piece == nil {
			if e.CustomName != nil {
				row.Title = *e.CustomName
			}
			in.Rows = append(in.Rows, row)
			continue
		}
		if e.Role != nil {
			row.Role = *e.Role
		}
		row.Title = e.Piece.Title
		row.Opus = e.Piece.WorkOpusNumber
		row.Credit = programCredit(tagNames(e.Piece.Composer), tagNames(e.Piece.Arranger))
		in.Rows = append(in.Rows, row)
	}

	doc, err := setlistpdf.ProgramImage(in)
	if err != nil {
		s.writeError(w, err)
		return
	}
	dir, err := os.MkdirTemp("", "sonneck-program-image-")
	if err != nil {
		s.writeError(w, err)
		return
	}
	defer os.RemoveAll(dir)
	src := filepath.Join(dir, "program.pdf")
	if err := os.WriteFile(src, doc, 0o600); err != nil {
		s.writeError(w, err)
		return
	}
	pngPath, err := pdf.RenderPNG(r.Context(), s.Cfg.PDFBinDir, src, 1, programImagePPI, filepath.Join(dir, "program"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	out, err := os.ReadFile(pngPath)
	if err != nil {
		s.writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", sanitizeFilename(setlist.Name)+".png"))
	w.Write(out)
}
