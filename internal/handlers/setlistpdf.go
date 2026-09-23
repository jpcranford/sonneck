package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/setlistpdf"
)

// handleDownloadSetlistPDF generates and streams the merged "Download Set
// PDF" export for one setlist: a cover page, a table of contents, each
// program entry in order (a piece's own real PDF pages, or a generated
// stand-in page for a custom entry), and a colophon. Two-permission gate
// (Read then Download) matching handleDownloadPieceFile — this produces a
// downloadable file, unlike the rest of setlist.go's plain read-only
// (single-permission) routes.
func (s *Server) handleDownloadSetlistPDF(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	if _, ok := s.requirePermission(w, r, models.PermissionDownload); !ok {
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
	resp, err := api.BuildSetlistResponse(r.Context(), s.DB, setlist)
	if err != nil {
		s.writeError(w, err)
		return
	}

	entries, err := buildPDFEntries(r, s.DB, resp.Entries)
	if err != nil {
		s.writeError(w, err)
		return
	}

	var gigDate string
	if setlist.GigDate != nil {
		if t, parseErr := time.Parse("2006-01-02", *setlist.GigDate); parseErr == nil {
			gigDate = t.Format("January 2, 2006")
		}
	}
	description := ""
	if resp.Description != nil {
		description = *resp.Description
	}

	out, err := setlistpdf.Generate(r.Context(), s.Cfg.PDFBinDir, setlistpdf.Input{
		Setlist: setlistpdf.Setlist{
			Name:        setlist.Name,
			GigDate:     gigDate,
			Description: description,
		},
		Entries: entries,
		Shape:   setlistpdf.ShapeForRegion(s.Cfg.CopyrightRegion()),
		Now:     time.Now(),
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	filename := sanitizeFilename(setlist.Name) + ".pdf"
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", filename))
	w.Write(out)
}

// buildPDFEntries converts the already-resolved API entry shape into
// setlistpdf.Entry, additionally fetching each piece entry's own real
// FilePath — SetlistPieceSummary is deliberately lean and doesn't carry
// it (CLAUDE.md > Setlists), so this is the one extra per-piece-entry
// lookup the export needs beyond what api.BuildSetlistResponse already
// resolved (same small-N-per-entry-lookup pattern buildSetlistPieceSummary
// itself already uses for other fields).
func buildPDFEntries(r *http.Request, db *sql.DB, in []api.SetlistEntryResponse) ([]setlistpdf.Entry, error) {
	out := make([]setlistpdf.Entry, len(in))
	for i, e := range in {
		if e.Piece != nil {
			piece, err := repo.GetPieceByID(r.Context(), db, e.Piece.ID)
			if err != nil {
				return nil, err
			}
			keys := make([]string, len(e.Piece.Keys))
			for j, k := range e.Piece.Keys {
				keys[j] = k.Name
			}
			out[i] = setlistpdf.Entry{
				IsPiece:        true,
				DisplayNumber:  e.DisplayNumber,
				PieceTitle:     e.Piece.Title,
				PieceKeys:      keys,
				PieceDuration:  e.Piece.Duration,
				PieceFilePath:  piece.FilePath,
				PiecePageCount: e.Piece.PageCount,
			}
			continue
		}
		name := ""
		if e.CustomName != nil {
			name = *e.CustomName
		}
		out[i] = setlistpdf.Entry{
			IsPiece:               false,
			DisplayNumber:         e.DisplayNumber,
			CustomName:            name,
			CustomRole:            e.Role,
			CustomDurationSeconds: e.CustomDurationSeconds,
			CustomNotes:           e.CustomNotes,
		}
	}
	return out, nil
}
