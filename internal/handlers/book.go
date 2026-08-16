package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/storage"
)

// handleUploadBook is the import wizard's step 1 (design doc §5): upload
// the book PDF, dedupe on hash match, render nothing yet (thumbnails are
// rendered on demand per-page — see handleBookPageThumbnail).
func (s *Server) handleUploadBook(w http.ResponseWriter, r *http.Request) {
	file, header, ok := requireMultipartFile(w, r)
	if !ok {
		return
	}
	defer file.Close()

	stagingDir := filepath.Join(s.Cfg.DataDir, "library", "books")
	tempPath, hash, pageCount, ok := s.stageUpload(w, r, stagingDir, file)
	if !ok {
		return
	}

	existing, err := repo.GetBookByHash(r.Context(), s.DB, hash)
	if err != nil && !errors.Is(err, repo.ErrNotFound) {
		s.writeError(w, err)
		return
	}
	if existing != nil {
		os.Remove(tempPath)
		resp, err := api.BuildBookResponse(r.Context(), s.DB, existing)
		if err != nil {
			s.writeError(w, err)
			return
		}
		api.WriteData(w, http.StatusOK, map[string]any{"book": resp, "pageCount": pageCount})
		return
	}

	finalPath := storage.BookPath(s.Cfg.DataDir, hash)
	if err := storage.MoveIntoPlace(tempPath, finalPath); err != nil {
		s.writeError(w, err)
		return
	}

	var resp *api.BookResponse
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		b := &models.Book{
			BookTitle:        defaultTitleFromFilename(header.Filename),
			ImslpNumber:      detectImslpNumber(header.Filename),
			OriginalFilename: header.Filename,
			FilePath:         finalPath,
			FileHash:         hash,
		}
		id, err := repo.CreateBook(r.Context(), tx, b)
		if err != nil {
			return err
		}

		// Re-fetch rather than reusing b: CreateBook doesn't populate
		// DB-assigned defaults (importedAt) back onto it.
		created, err := repo.GetBookByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		resp, err = api.BuildBookResponse(r.Context(), tx, created)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusCreated, map[string]any{"book": resp, "pageCount": pageCount})
}

func (s *Server) handleGetBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}
	b, err := repo.GetBookByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildBookResponse(r.Context(), s.DB, b)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleUpdateBook is the Book Properties Edit Menu (design doc §16):
// writes only the Book row, then fans the search-index resync out to
// every piece that inherits from it — not just this one row.
func (s *Server) handleUpdateBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}

	var req api.BookWriteRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var resp *api.BookResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		b, err := repo.GetBookByID(r.Context(), tx, id)
		if err != nil {
			return err
		}

		b.BookTitle = req.BookTitle
		b.Composer = req.Composer
		b.YearWritten = req.YearWritten
		b.WorkOpusNumber = req.WorkOpusNumber
		b.Publisher = req.Publisher
		b.PublisherID = req.PublisherID
		b.Description = req.Description
		b.ImslpNumber = req.ImslpNumber

		sheetTypeID, err := resolveOptionalTagName(r.Context(), tx, repo.FindOrCreateSheetType, req.SheetTypeName, "sheetTypeName")
		if err != nil {
			return err
		}
		b.SheetTypeID = sheetTypeID

		instrumentIDs, err := resolveTagNames(r.Context(), tx, repo.FindOrCreateInstrument, req.Instruments, "instruments")
		if err != nil {
			return err
		}
		b.InstrumentIDs = instrumentIDs

		if errs := api.ValidateBook(b); len(errs) > 0 {
			return errs
		}

		if err := repo.UpdateBook(r.Context(), tx, b); err != nil {
			return err
		}
		if err := repo.SetBookInstruments(r.Context(), tx, id, b.InstrumentIDs); err != nil {
			return err
		}
		if err := repo.ResyncSearchIndexForBook(r.Context(), tx, id); err != nil {
			return err
		}

		resp, err = api.BuildBookResponse(r.Context(), tx, b)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, resp)
}

// handleBookPageThumbnail renders (and caches) a single page of a book as
// a PNG, for the wizard's split step (design doc §5) and the basic piece
// preview (§7).
func (s *Server) handleBookPageThumbnail(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}
	page, err := strconv.Atoi(r.PathValue("page"))
	if err != nil || page < 1 {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid page number")
		return
	}

	b, err := repo.GetBookByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}

	thumbPath, err := s.cachedThumbnail(r.Context(), b.FilePath, page, 100, fmt.Sprintf("book-%d-page-%d", id, page))
	if err != nil {
		s.writeError(w, err)
		return
	}

	http.ServeFile(w, r, thumbPath)
}
