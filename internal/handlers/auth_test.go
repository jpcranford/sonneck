package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jpcranford/sonneck/internal/auth"
	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/handlers"
	"github.com/jpcranford/sonneck/internal/repo"
)

// TestLogin_SecureCookieOnlyWhenGenuinelyHTTPSAndTrusted covers the fix for
// CodeQL's "Cookie 'Secure' attribute is not set to true" findings against
// this app's four http.SetCookie calls (auth.go's session cookie, oidc.go's
// state cookie). The fix isn't to hardcode Secure true — this app's primary
// documented deployment is plain HTTP on a LAN with nothing in front of it
// (README's own CAUTION callout), and a browser refuses to send a Secure
// cookie back over a non-HTTPS connection, so hardcoding it there would
// silently break login. Instead Secure is derived per-request
// (isSecureRequest, auth.go): only true when the operator has explicitly
// opted in via TRUST_PROXY_HTTPS *and* this specific request actually
// carries X-Forwarded-Proto: https. Exercised end to end through a real
// login rather than unit-testing the unexported helper directly.
func TestLogin_SecureCookieOnlyWhenGenuinelyHTTPSAndTrusted(t *testing.T) {
	tests := []struct {
		name             string
		trustProxyHTTPS  bool
		forwardedProto   string
		wantSecureCookie bool
	}{
		{
			name:             "plain HTTP, no proxy trust configured",
			trustProxyHTTPS:  false,
			forwardedProto:   "",
			wantSecureCookie: false,
		},
		{
			name:             "X-Forwarded-Proto: https present but TRUST_PROXY_HTTPS not set",
			trustProxyHTTPS:  false,
			forwardedProto:   "https",
			wantSecureCookie: false,
		},
		{
			name:             "X-Forwarded-Proto: https, TRUST_PROXY_HTTPS set",
			trustProxyHTTPS:  true,
			forwardedProto:   "https",
			wantSecureCookie: true,
		},
		{
			name:             "TRUST_PROXY_HTTPS set but no https header on this request",
			trustProxyHTTPS:  true,
			forwardedProto:   "",
			wantSecureCookie: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newSinglepassServerWithPassword(t, "correcthorse123", tt.trustProxyHTTPS)

			body, err := json.Marshal(map[string]string{"password": "correcthorse123"})
			if err != nil {
				t.Fatalf("marshaling request body: %v", err)
			}
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if tt.forwardedProto != "" {
				req.Header.Set("X-Forwarded-Proto", tt.forwardedProto)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("login status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
			}

			var sessionCookie *http.Cookie
			for _, c := range rec.Result().Cookies() {
				if c.Name == auth.SessionCookieName {
					sessionCookie = c
				}
			}
			if sessionCookie == nil {
				t.Fatalf("no %s cookie set on successful login", auth.SessionCookieName)
			}
			if sessionCookie.Secure != tt.wantSecureCookie {
				t.Errorf("session cookie Secure = %v, want %v", sessionCookie.Secure, tt.wantSecureCookie)
			}
			// HttpOnly/SameSite must never regress regardless of the Secure
			// decision above — this test's whole point is that Secure is now
			// conditional, not that the other flags became conditional too.
			if !sessionCookie.HttpOnly {
				t.Error("session cookie must stay HttpOnly")
			}
			if sessionCookie.SameSite != http.SameSiteLaxMode {
				t.Errorf("session cookie SameSite = %v, want Lax", sessionCookie.SameSite)
			}
		})
	}
}

// newSinglepassServerWithPassword builds a real handler in singlepass mode
// with a password already set on the seeded admin row, plus a chosen
// TrustProxyHTTPS — mirrors serverWithAuthMethod (authchange_test.go), with
// the one extra knob this test needs.
func newSinglepassServerWithPassword(t *testing.T, password string, trustProxyHTTPS bool) http.Handler {
	t.Helper()
	_, conn := newTestServerWithDB(t)

	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if err := repo.CompleteFirstLaunch(context.Background(), conn, "singlepass", &hash); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}

	cfg := &config.Config{AuthMethod: "singlepass", TrustProxyHTTPS: trustProxyHTTPS, LogLevelVar: &slog.LevelVar{}}
	cfg.SetCopyrightRegion("en-US")
	cfg.SetBackupCron("0 3 * * *")
	cfg.SetBackupRetentionDays(30)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	frontend := mustFS(t)
	return handlers.New(conn, cfg, logger, frontend, nil, "", "", nil)
}
