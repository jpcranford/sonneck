package handlers

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/auth"
	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// recoverMiddleware turns a panic in any handler into a logged 500 with the
// standard {error} envelope, instead of taking the whole server down. If a
// handler already wrote part of a response before panicking, the extra
// WriteHeader here is a harmless no-op (net/http just logs it) — panics in
// practice happen before a response has been started.
func recoverMiddleware(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Error("panic recovered", "panic", rec, "method", r.Method, "path", r.URL.Path)
				api.WriteError(w, http.StatusInternalServerError, api.CodeInternalError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type contextKey int

const userContextKey contextKey = 0

// publicAPIPaths never require a resolved user — they're exactly the
// endpoints a client needs before it can possibly have a session: reading
// server config, completing first-launch, and logging in itself. Every
// other /api/* path requires authMiddleware to have attached a user to the
// request context; non-/api/ paths (the embedded frontend) are never
// gated at all, so the SPA shell always loads and can itself call these to
// decide what to show.
var publicAPIPaths = map[string]bool{
	"/api/config":             true,
	"/api/setup/complete":     true,
	"/api/auth/login":         true,
	"/api/auth/oidc/login":    true,
	"/api/auth/oidc/callback": true,
}

// authMiddleware resolves the request's user — the implicit id=1 row in
// `none` mode (no session needed at all, identical zero-overhead behavior to
// the pre-multi-user app), or the session cookie's owner in `singlepass`/
// `oidc` mode — and attaches it to the request context. It does not itself
// enforce permissions; requirePermission (below) does that, per-handler,
// following the same "one shared helper, not a blanket route-metadata
// middleware" convention CLAUDE.md's Permission model section calls for,
// since requirements vary per-handler in a way this single middleware can't
// express. Slots in after recoverMiddleware (server.go's New), same seam
// memory project_oidc_multiuser_plan.md already identified.
func authMiddleware(next http.Handler, db *sql.DB, cfg *config.Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || publicAPIPaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		ctx := r.Context()
		settings, err := repo.GetServerSettings(ctx, db)
		if err != nil {
			api.WriteError(w, http.StatusInternalServerError, api.CodeInternalError, "internal error")
			return
		}
		authMethod := repo.ResolveAuthMethod(cfg.AuthMethod, settings)

		var user *models.User
		if authMethod == "none" {
			user, err = repo.GetUserByID(ctx, db, 1)
			if err != nil {
				api.WriteError(w, http.StatusInternalServerError, api.CodeInternalError, "internal error")
				return
			}
		} else if cookie, err := r.Cookie(auth.SessionCookieName); err == nil {
			userID, err := repo.GetSessionUserID(ctx, db, cookie.Value)
			if err == nil {
				user, err = repo.GetUserByID(ctx, db, userID)
				if err != nil {
					api.WriteError(w, http.StatusInternalServerError, api.CodeInternalError, "internal error")
					return
				}
			}
		}

		if user == nil {
			api.WriteError(w, http.StatusUnauthorized, api.CodeUnauthorized, "authentication required")
			return
		}

		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, userContextKey, user)))
	})
}

// userFromContext reads the user authMiddleware attached — ok is false only
// if this handler is somehow reachable without authMiddleware having run
// (a routing bug, not a real runtime state under normal operation, since
// every /api/* route goes through it).
func userFromContext(ctx context.Context) (*models.User, bool) {
	u, ok := ctx.Value(userContextKey).(*models.User)
	return u, ok
}

// requirePermission is the one shared per-handler gate (CLAUDE.md > Auth
// methods / Permission model's "one shared helper" convention, same shape
// as ResolveEffective/ResolveAuthMethod) — called as the first line of any
// handler that needs it. Writes the response and returns ok=false itself on
// failure, so a handler's own body is simply `if !ok { return }`.
func (s *Server) requirePermission(w http.ResponseWriter, r *http.Request, perm string) (*models.User, bool) {
	user, ok := userFromContext(r.Context())
	if !ok {
		api.WriteError(w, http.StatusUnauthorized, api.CodeUnauthorized, "authentication required")
		return nil, false
	}
	if !user.HasPermission(perm) {
		api.WriteError(w, http.StatusForbidden, api.CodeForbidden, "insufficient permission")
		return nil, false
	}
	return user, true
}
