// Package handlers wires the repo/api/storage/pdf/wizard packages into
// actual HTTP endpoints.
package handlers

import (
	"context"
	"database/sql"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/backup"
	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/repo"
)

type Server struct {
	DB     *sql.DB
	Cfg    *config.Config
	Logger *slog.Logger

	// BackupScheduler is nil in test/CLI-subcommand construction that never
	// calls New (e.g. internal/handlers/cleanup_test.go's direct &Server{}
	// literal) — handleUpdateLibrarySettings checks for nil before calling
	// Reschedule, since none of those callers ever reach that handler.
	BackupScheduler *backup.Scheduler
	// BuildSHA/BuildDate are ldflags-injected at build time (Dockerfile),
	// "dev"/"unknown" otherwise — Admin Settings' Version section's own
	// running-build identity.
	BuildSHA        string
	BuildDate       string
	releaseIdentity *releaseIdentity
	// BuildTarget — "docker" (default) or "native", ldflags-injected
	// exactly like BuildSHA/BuildDate (project_wails_native_app_investigation
	// memory's Phase 3) — GET /api/config's own signal for every
	// native-only frontend branch.
	BuildTarget string

	// OIDCAuth is nil unless the resolved auth method is genuinely "oidc" —
	// mirrors BackupScheduler's own "nil in
	// test/CLI-subcommand construction" convention. handleOIDCLogin/
	// handleOIDCCallback check for nil before using it. Typed as the local
	// OIDCAuthenticator interface (oidc.go), not the concrete
	// *oidcauth.Authenticator, so tests can inject a fake with no real
	// network/JWT-signing involved.
	OIDCAuth OIDCAuthenticator
}

// New wires up the full HTTP surface — the /api endpoints below, /healthz,
// and (via frontend) the embedded frontend build itself (design doc §9,
// internal/webui). frontend is an fs.FS rather than a concrete embed.FS so
// tests can pass the same webui.FS() call without any special-casing.
// scheduler/buildSHA/buildDate all back Admin Settings' Library
// Settings/Version sections — a test or CLI-subcommand caller that never
// reaches those routes can pass nil/""/"" for all three. oidcAuth is nil
// unless cfg.AuthMethod == "oidc" — constructed once in cmd/sonneck/main.go,
// since it does a real network call (OIDC
// discovery) that config.Load() itself deliberately never makes.
func New(db *sql.DB, cfg *config.Config, logger *slog.Logger, frontend fs.FS, scheduler *backup.Scheduler, buildSHA, buildDate, buildTarget string, oidcAuth OIDCAuthenticator) http.Handler {
	s := &Server{
		DB: db, Cfg: cfg, Logger: logger,
		BackupScheduler: scheduler, BuildSHA: buildSHA, BuildDate: buildDate,
		releaseIdentity: &releaseIdentity{},
		BuildTarget:     buildTarget,
		OIDCAuth:        oidcAuth,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)

	// A minimal, deliberately narrow slice of server config the frontend
	// needs at runtime — just CopyrightRegion so far (US renewal follow-up:
	// gates whether the Copyright Year field's renewal toggle even shows),
	// not the whole config.Config (most of which is server-internal —
	// directories, cron schedule — with no frontend use).
	mux.HandleFunc("GET /api/config", s.handleGetConfig)
	// First-time launch flow — the one real endpoint that flow needs; see
	// handleCompleteSetup's own comment for what it does and doesn't gate.
	mux.HandleFunc("POST /api/setup/complete", s.handleCompleteSetup)

	// Auth — session issuance/lookup/expiry. GET /api/auth/me is the
	// frontend's own single source of truth for "who am I, what can I do"
	// (route guards, the sidebar user menu).
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/me", s.handleGetMe)
	// OIDC — the IdP redirect and its callback, both reachable pre-session
	// (authMiddleware's publicAPIPaths).
	mux.HandleFunc("GET /api/auth/oidc/login", s.handleOIDCLogin)
	mux.HandleFunc("GET /api/auth/oidc/callback", s.handleOIDCCallback)
	// Auth Change flow — reachable pre-session by necessity (nobody can be
	// logged in yet under whichever method just became active),
	// self-guarded by re-deriving authChangePending server-side rather than
	// trusting the client, same posture as POST /api/setup/complete.
	mux.HandleFunc("GET /api/auth-change/candidates", s.handleAuthChangeCandidates)
	mux.HandleFunc("POST /api/auth-change/complete", s.handleAuthChangeComplete)
	// User Settings' Account card — self-rename and self-service password
	// change, distinct from the admin-only equivalents under /api/admin/*.
	mux.HandleFunc("PATCH /api/auth/me", s.handleUpdateMe)
	mux.HandleFunc("POST /api/auth/change-password", s.handleChangePassword)

	mux.HandleFunc("GET /api/keys", s.handleListKeys)
	mux.HandleFunc("GET /api/sheet-types", s.handleListSheetTypes)
	mux.HandleFunc("GET /api/instruments", s.handleListInstruments)
	mux.HandleFunc("GET /api/tags", s.handleListUserTags)
	mux.HandleFunc("GET /api/practice-statuses", s.handleListPracticeStatuses)
	mux.HandleFunc("GET /api/imslp/lookup", s.handleImslpLookup)

	// Your Tags / Practice Status create/delete/merge — user-scoped, not
	// admin-gated (read permission only).
	mux.HandleFunc("POST /api/tags", s.handleCreateUserTag)
	mux.HandleFunc("PATCH /api/tags/{id}", s.handleRenameUserTag)
	mux.HandleFunc("DELETE /api/tags/{id}", s.handleDeleteUserTag)
	mux.HandleFunc("POST /api/practice-statuses", s.handleCreatePracticeStatus)
	mux.HandleFunc("PATCH /api/practice-statuses/{id}", s.handleRenamePracticeStatus)
	mux.HandleFunc("DELETE /api/practice-statuses/{id}", s.handleDeletePracticeStatus)

	// User Settings' Appearance/Library cards — read permission only, the
	// calling user's own preferences.
	mux.HandleFunc("GET /api/user-settings", s.handleGetUserSettings)
	mux.HandleFunc("PATCH /api/user-settings", s.handleUpdateUserSettings)

	// Admin Settings — every route below is `admin`-gated inside its own
	// handler (requirePermission).
	mux.HandleFunc("GET /api/admin/users", s.handleListAdminUsers)
	mux.HandleFunc("PATCH /api/admin/users/{id}", s.handleSetUserPermissions)
	mux.HandleFunc("DELETE /api/admin/users/{id}", s.handleDeleteAdminUser)
	mux.HandleFunc("POST /api/admin/security", s.handleAdminSecurity)
	mux.HandleFunc("GET /api/admin/library-counts", s.handleLibraryCounts)
	mux.HandleFunc("POST /api/admin/sheet-types", s.handleCreateSheetType)
	mux.HandleFunc("PATCH /api/admin/sheet-types/{id}", s.handleRenameSheetType)
	mux.HandleFunc("DELETE /api/admin/sheet-types/{id}", s.handleDeleteSheetType)
	mux.HandleFunc("POST /api/admin/instruments", s.handleCreateInstrument)
	mux.HandleFunc("PATCH /api/admin/instruments/{id}", s.handleRenameInstrument)
	mux.HandleFunc("DELETE /api/admin/instruments/{id}", s.handleDeleteInstrument)
	// Library Settings + Version — see librarysettings.go/version.go.
	mux.HandleFunc("GET /api/admin/library-settings", s.handleGetLibrarySettings)
	mux.HandleFunc("PATCH /api/admin/library-settings", s.handleUpdateLibrarySettings)
	mux.HandleFunc("GET /api/admin/version", s.handleGetVersion)
	mux.HandleFunc("POST /api/admin/version/check", s.handleCheckForUpdates)
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

	// authMiddleware runs inside recoverMiddleware (recover stays outermost,
	// so a panic anywhere — including inside auth resolution itself — still
	// gets the standard 500 envelope, not a bare connection reset).
	return recoverMiddleware(authMiddleware(mux, db, cfg), logger)
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

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	settings, err := repo.GetServerSettings(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Resolution order: env var wins if set, else the stored first-launch
	// choice, else "none" — the frontend never re-derives this itself, it
	// just reads the already-resolved value here. Shared with
	// authMiddleware via repo.ResolveAuthMethod.
	authMethod := repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings)

	resp := api.ConfigResponse{
		CopyrightRegion:      s.Cfg.CopyrightRegion(),
		AuthMethod:           authMethod,
		AuthMethodSetByEnv:   s.Cfg.AuthMethod != "",
		FirstLaunchCompleted: settings.FirstLaunchCompletedAt != nil,
		BuildTarget:          s.BuildTarget,
	}
	if !resp.FirstLaunchCompleted {
		resp.DataDir = &s.Cfg.DataDir
	}
	if authMethod == "oidc" {
		resp.OIDCProviderName = &s.Cfg.ExternalProvider
	}
	// Auth Change flow — a fresh install has LastActiveAuthMethod
	// == nil (never set until first-launch completes), so this is never
	// pending before then; App.tsx also only checks it after
	// firstLaunchCompleted, so the ordering doesn't strictly depend on this
	// nil-check alone, but it's correct either way.
	if resp.FirstLaunchCompleted && settings.LastActiveAuthMethod != nil && *settings.LastActiveAuthMethod != authMethod {
		pending, err := s.buildAuthChangePending(r.Context(), *settings.LastActiveAuthMethod, authMethod)
		if err != nil {
			s.writeError(w, err)
			return
		}
		resp.AuthChangePending = pending
	}
	api.WriteData(w, http.StatusOK, resp)
}

// buildAuthChangePending fills in NeedsPassword/MultiAccount alongside the
// bare from/to mismatch — cheap enough (a user count, and id=1's own
// password_hash) to compute unconditionally whenever a change is actually
// pending, so AuthChangeFlow.tsx can render its whole step sequence
// upfront (computeSteps, ported from AuthChangeFlowMockup.tsx) rather than
// discovering it field-by-field from validation errors.
func (s *Server) buildAuthChangePending(ctx context.Context, from, to string) (*api.AuthChangePendingResponse, error) {
	users, err := repo.ListUsers(ctx, s.DB)
	if err != nil {
		return nil, err
	}
	multiAccount := to != "oidc" && len(users) > 1

	needsPassword := false
	if to == "singlepass" {
		if multiAccount {
			// Conservatively true — see AuthChangePendingResponse's own
			// doc comment for why this is safe even in the rare case the
			// eventual survivor already has one.
			needsPassword = true
		} else {
			seed, err := repo.GetUserByID(ctx, s.DB, 1)
			if err != nil {
				return nil, err
			}
			needsPassword = seed.PasswordHash == nil
		}
	}

	return &api.AuthChangePendingResponse{From: from, To: to, NeedsPassword: needsPassword, MultiAccount: multiAccount}, nil
}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "no such endpoint")
}
