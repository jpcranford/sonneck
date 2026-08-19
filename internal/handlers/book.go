package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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
			OriginalFilename: &header.Filename,
			FilePath:         &finalPath,
			FileHash:         &hash,
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

// handleCreateBookManual is the Books library view's "New Book" button —
// distinct from handleUploadBook above, which always requires a real PDF.
// The resulting Book has no file (migration 00014) and, since nothing can
// attach a Piece to a book with no original PDF to split, no path to ever
// gaining one either — it exists purely as a placeholder record a user can
// fill in ahead of actually having the sheet music.
func (s *Server) handleCreateBookManual(w http.ResponseWriter, r *http.Request) {
	var req api.BookCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var resp *api.BookResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		b := &models.Book{
			BookTitle:   req.BookTitle,
			Composer:    req.Composer,
			Publisher:   req.Publisher,
			YearWritten: req.YearWritten,
		}
		if errs := api.ValidateBook(b); len(errs) > 0 {
			return errs
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

	api.WriteData(w, http.StatusCreated, resp)
}

// handleListBooks is the Books library view's browse/search (mirrors
// handleSearchPieces's shape) — text query against book_title/composer/
// publisher via plain LIKE, not FTS5: unlike pieces_fts (design doc §11),
// there's no books_fts table, and a books library realistically holds a
// tiny fraction of the row count a pieces library does, so a LIKE scan
// costs nothing worth building real full-text search to avoid.
func (s *Server) handleListBooks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	var where []string
	var args []any

	sqlStr := `SELECT id FROM books`

	if query := strings.TrimSpace(q.Get("query")); query != "" {
		where = append(where, `(book_title LIKE ? OR composer LIKE ? OR publisher LIKE ?)`)
		like := "%" + query + "%"
		args = append(args, like, like, like)
	}

	if len(where) > 0 {
		sqlStr += " WHERE " + strings.Join(where, " AND ")
	}

	limit := 50
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	offset := 0
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	sqlStr += " ORDER BY id DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := s.DB.QueryContext(r.Context(), sqlStr, args...)
	if err != nil {
		s.writeError(w, err)
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			s.writeError(w, err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.writeError(w, err)
		return
	}
	rows.Close()

	results := make([]*api.BookResponse, 0, len(ids))
	for _, id := range ids {
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
		results = append(results, resp)
	}

	api.WriteData(w, http.StatusOK, results)
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
	// A manually created Book (migration 00014) has no file to render a
	// page from at all — a clean 404 here, not a nil-pointer panic.
	if b.FilePath == nil {
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "this book has no file")
		return
	}

	thumbPath, err := s.cachedThumbnail(r.Context(), *b.FilePath, page, 100, fmt.Sprintf("book-%d-page-%d", id, page))
	if err != nil {
		s.writeError(w, err)
		return
	}

	http.ServeFile(w, r, thumbPath)
}

// handleDownloadBookFile is the Book Details page's "Open Book PDF"
// button — mirrors handleDownloadPieceFile (piece.go) exactly: Content-
// Disposition "inline" (not "attachment") opens the original file in a
// new tab rather than forcing a download. A manually created Book
// (migration 00014) has no file at all — a clean 404, same guard
// handleBookPageThumbnail already uses, not a nil-pointer panic.
func (s *Server) handleDownloadBookFile(w http.ResponseWriter, r *http.Request) {
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
	if b.FilePath == nil {
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "this book has no file")
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", sanitizeFilename(b.BookTitle)+".pdf"))
	http.ServeFile(w, r, *b.FilePath)
}
