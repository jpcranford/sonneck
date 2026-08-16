package handlers

import (
	"log/slog"
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
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
