// Package handlers wires the repo/api/storage/pdf/wizard packages into
// actual HTTP endpoints.
package handlers

import (
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/config"
)

type Server struct {
	DB     *sql.DB
	Cfg    *config.Config
	Logger *slog.Logger
}

func New(db *sql.DB, cfg *config.Config, logger *slog.Logger) http.Handler {
	s := &Server{DB: db, Cfg: cfg, Logger: logger}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)

	mux.HandleFunc("GET /api/keys", s.handleListKeys)
	mux.HandleFunc("GET /api/sheet-types", s.handleListSheetTypes)
	mux.HandleFunc("GET /api/instruments", s.handleListInstruments)
	mux.HandleFunc("GET /api/tags", s.handleListUserTags)

	mux.HandleFunc("POST /api/pieces", s.handleCreatePiece)
	mux.HandleFunc("GET /api/pieces", s.handleSearchPieces)
	mux.HandleFunc("GET /api/pieces/random", s.handleGetRandomPiece)
	mux.HandleFunc("GET /api/pieces/{id}", s.handleGetPiece)
	mux.HandleFunc("PATCH /api/pieces/{id}", s.handleUpdatePiece)
	mux.HandleFunc("DELETE /api/pieces/{id}", s.handleDeletePiece)
	mux.HandleFunc("GET /api/pieces/{id}/file", s.handleDownloadPieceFile)
	mux.HandleFunc("POST /api/pieces/{id}/replace-file", s.handleReplacePieceFile)
	mux.HandleFunc("PATCH /api/pieces/{id}/thumbnail-page", s.handleSetPieceThumbnailPage)
	mux.HandleFunc("GET /api/pieces/{id}/citation", s.handleGetCitation)
	mux.HandleFunc("GET /api/pieces/{id}/pages/{page}/thumbnail", s.handlePieceThumbnail)

	mux.HandleFunc("POST /api/books", s.handleUploadBook)
	mux.HandleFunc("GET /api/books", s.handleListBooks)
	mux.HandleFunc("POST /api/books/manual", s.handleCreateBookManual)
	mux.HandleFunc("GET /api/books/{id}", s.handleGetBook)
	mux.HandleFunc("PATCH /api/books/{id}", s.handleUpdateBook)
	mux.HandleFunc("DELETE /api/books/{id}", s.handleDeleteBook)
	mux.HandleFunc("GET /api/books/{id}/file", s.handleDownloadBookFile)
	mux.HandleFunc("GET /api/books/{id}/pages/{page}/thumbnail", s.handleBookPageThumbnail)
	mux.HandleFunc("POST /api/books/{id}/confirm-import", s.handleConfirmImport)
	mux.HandleFunc("GET /api/books/{id}/cover", s.handleGetBookCover)
	mux.HandleFunc("POST /api/books/{id}/cover", s.handleUploadBookCover)
	mux.HandleFunc("DELETE /api/books/{id}/cover", s.handleDeleteBookCover)

	// Catch-all: any path not matched by a pattern above (CLAUDE.md > API
	// response contract — every endpoint returns {data}/{error}, and that
	// includes a client hitting a typo'd or nonexistent URL, not just
	// Go's default plain-text 404). This does not cover the "right path,
	// wrong method" case — net/http's ServeMux answers that one itself,
	// before any handler (including this one) runs.
	mux.HandleFunc("/", s.handleNotFound)

	return recoverMiddleware(mux, logger)
}

// handleHealthz follows the {data}/{error} envelope like every other
// endpoint (CLAUDE.md > API response contract states this applies to
// "every endpoint," with no stated exception for /healthz) — Docker's
// HEALTHCHECK and similar tooling check the status code, not the body
// shape, so this doesn't cost anything operationally.
func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	api.WriteData(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "no such endpoint")
}
