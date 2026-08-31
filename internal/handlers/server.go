// Package handlers wires the repo/api/storage/pdf/wizard packages into
// actual HTTP endpoints.
package handlers

import (
	"database/sql"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/config"
)

type Server struct {
	DB     *sql.DB
	Cfg    *config.Config
	Logger *slog.Logger
}

// New wires up the full HTTP surface — the /api endpoints below, /healthz,
// and (via frontend) the embedded frontend build itself (design doc §9,
// internal/webui). frontend is an fs.FS rather than a concrete embed.FS so
// tests can pass the same webui.FS() call without any special-casing.
func New(db *sql.DB, cfg *config.Config, logger *slog.Logger, frontend fs.FS) http.Handler {
	s := &Server{DB: db, Cfg: cfg, Logger: logger}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)

	mux.HandleFunc("GET /api/keys", s.handleListKeys)
	mux.HandleFunc("GET /api/sheet-types", s.handleListSheetTypes)
	mux.HandleFunc("GET /api/instruments", s.handleListInstruments)
	mux.HandleFunc("GET /api/tags", s.handleListUserTags)
	mux.HandleFunc("GET /api/imslp/lookup", s.handleImslpLookup)
	// Wikipedia autofill (composer/arranger overhaul) — shared by the Edit
	// Person modal's own autofill button and Upload Portrait's "search
	// Wikipedia" source step, same "one endpoint, two callers" reasoning
	// as GET /api/people's own dual role.
	mux.HandleFunc("GET /api/wikipedia/search", s.handleWikipediaSearch)
	mux.HandleFunc("GET /api/wikipedia/page-image", s.handleWikipediaPageImage)

	// Person (composer/arranger overhaul, migration 00020) — a real library
	// entity with its own page, unlike Key/Instrument/SheetType's small
	// fixed-list lookups above, so it gets the same route shape as
	// Piece/Book (list+create, {id} CRUD, plus small dedicated action
	// endpoints) rather than a bare lookup list.
	mux.HandleFunc("GET /api/people", s.handleListPeople)
	mux.HandleFunc("POST /api/people", s.handleCreatePerson)
	mux.HandleFunc("GET /api/people/{id}", s.handleGetPerson)
	mux.HandleFunc("PATCH /api/people/{id}", s.handleUpdatePerson)
	mux.HandleFunc("DELETE /api/people/{id}", s.handleDeletePerson)
	mux.HandleFunc("POST /api/people/{id}/split", s.handleSplitPerson)
	mux.HandleFunc("GET /api/people/{id}/portrait", s.handleGetPersonPortrait)
	mux.HandleFunc("POST /api/people/{id}/portrait", s.handleUploadPersonPortrait)
	mux.HandleFunc("DELETE /api/people/{id}/portrait", s.handleDeletePersonPortrait)

	mux.HandleFunc("POST /api/pieces", s.handleCreatePiece)
	mux.HandleFunc("GET /api/pieces", s.handleSearchPieces)
	mux.HandleFunc("GET /api/pieces/random", s.handleGetRandomPiece)
	// /facets sits alongside /random as a second specific-literal-path
	// sibling of /{id} — Go 1.22+'s http.ServeMux resolves the literal
	// over the wildcard regardless of registration order, so this isn't
	// an ordering hazard, just worth the same note /random's own route
	// would deserve if it had one.
	mux.HandleFunc("GET /api/pieces/facets", s.handlePieceFacets)
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
	mux.HandleFunc("GET /api/books/facets", s.handleBookFacets)
	mux.HandleFunc("GET /api/books/{id}", s.handleGetBook)
	mux.HandleFunc("PATCH /api/books/{id}", s.handleUpdateBook)
	mux.HandleFunc("DELETE /api/books/{id}", s.handleDeleteBook)
	mux.HandleFunc("GET /api/books/{id}/file", s.handleDownloadBookFile)
	mux.HandleFunc("GET /api/books/{id}/pages/{page}/thumbnail", s.handleBookPageThumbnail)
	mux.HandleFunc("POST /api/books/{id}/confirm-import", s.handleConfirmImport)
	mux.HandleFunc("GET /api/books/{id}/cover", s.handleGetBookCover)
	mux.HandleFunc("POST /api/books/{id}/cover", s.handleUploadBookCover)
	mux.HandleFunc("DELETE /api/books/{id}/cover", s.handleDeleteBookCover)

	// Catch-all: any path not matched by a pattern above. Two different
	// audiences share this one route — an /api/* miss (CLAUDE.md > API
	// response contract — every endpoint returns {data}/{error}, including
	// a client hitting a typo'd or nonexistent URL, not just Go's default
	// plain-text 404) still gets the JSON envelope; everything else is the
	// embedded frontend, serving a real static asset where one exists and
	// falling back to index.html otherwise so a client-side route (e.g.
	// /pieces/5, /favorites) survives a hard refresh or a direct link —
	// standard SPA-serving behavior. This does not cover the "right path,
	// wrong method" case for /api/* — net/http's ServeMux answers that one
	// itself, before any handler (including this one) runs.
	mux.Handle("/", spaHandler(frontend, s.handleNotFound))

	return recoverMiddleware(mux, logger)
}

// spaHandler serves the embedded frontend build. A request path that
// resolves to a real file (JS/CSS/images/favicon/manifest, all under
// frontend/'s build output) gets served directly; anything else that isn't
// under /api/ falls back to index.html, since that path is a client-side
// route React Router owns, not a real file on disk. /api/* misses are
// handed off to notFound instead — those must keep returning the {error}
// envelope, not an HTML page.
func spaHandler(frontend fs.FS, notFound http.HandlerFunc) http.HandlerFunc {
	fileServer := http.FileServer(http.FS(frontend))
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			notFound(w, r)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "."
		}
		if _, err := fs.Stat(frontend, path); err != nil {
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	}
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
