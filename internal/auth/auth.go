// Package auth is the session/password layer for multi-user support (Phase
// 10 of the plan, memory project_multiuser_build.md) — issuing/looking up
// session tokens and hashing/checking passwords. OIDC's own exchange
// (Phase 14) lives here too once that phase builds it; nothing OIDC-shaped
// exists yet.
package auth

import (
	"crypto/rand"
	"encoding/base64"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// SessionTTL is how long an issued session cookie stays valid before a
// fresh login is required. 30 days: this app targets a household/small
// group on their own trusted network (CLAUDE.md > Concurrency), not a
// security-sensitive multi-tenant deployment, so a long-lived session
// favors "log in once, stay in" over frequent re-auth.
const SessionTTL = 30 * 24 * time.Hour

// SessionCookieName is the cookie both singlepass and OIDC sessions use —
// deliberately the same mechanism for both modes (master plan's Auth
// methods table), so authMiddleware has exactly one session-lookup path
// regardless of which login method issued it.
const SessionCookieName = "sonneck_session"

// NewSessionToken generates a cryptographically random, URL-safe session
// token — 32 bytes (256 bits) of entropy, base64url-encoded so it's a safe
// cookie value with no further escaping.
func NewSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashPassword bcrypt-hashes a plaintext password for storage in
// users.password_hash. Shared here rather than left inline in setup.go, now
// that both first-launch setup and POST /api/admin/security need the exact
// same hashing call.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckPassword reports whether password matches hash (POST /api/auth/login's
// singlepass check). A non-nil error here just means "doesn't match" (or a
// malformed hash) — callers should treat any error as authentication
// failure, not surface bcrypt's own error text to the client.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
