package handlers_test

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/handlers"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/oidcauth"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/webui"
)

// fakeOIDCAuthenticator implements handlers.OIDCAuthenticator with no real
// network/JWT-signing involved — the interface exists (oidc.go) specifically
// so tests can do this instead of standing up a full fake IdP.
type fakeOIDCAuthenticator struct {
	claims oidcauth.Claims
	err    error
}

func (f *fakeOIDCAuthenticator) AuthCodeURL(state string) string {
	return "https://idp.example.com/authorize?state=" + state
}

func (f *fakeOIDCAuthenticator) Exchange(ctx context.Context, code string) (oidcauth.Claims, error) {
	return f.claims, f.err
}

// newOIDCTestServer mirrors newTestServerWithDataDir but wires a fake
// OIDCAuthenticator and lets each test set allowRegistration/defaultPerms —
// the two pieces of config ClaimOrProvisionOIDCUser's branching depends on.
func newOIDCTestServer(t *testing.T, fake handlers.OIDCAuthenticator, allowRegistration bool, defaultPerms []string) (http.Handler, *sql.DB) {
	t.Helper()
	dataDir := t.TempDir()

	conn, err := db.Open(filepath.Join(dataDir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	cfg := &config.Config{DataDir: dataDir, LogLevelVar: &slog.LevelVar{}, AuthMethod: "oidc"}
	cfg.SetCopyrightRegion("en-US")
	cfg.SetBackupCron("0 3 * * *")
	cfg.SetBackupRetentionDays(30)
	cfg.OIDCAllowRegistration = allowRegistration
	cfg.OIDCDefaultPermissions = defaultPerms
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	frontend, err := webui.FS()
	if err != nil {
		t.Fatalf("loading embedded frontend: %v", err)
	}

	return handlers.New(conn, cfg, logger, frontend, nil, "", "", "docker", fake, nil), conn
}

// startOIDCLogin drives GET /api/auth/oidc/login and returns the state
// cookie it set, so a callback test can present it back.
func startOIDCLogin(t *testing.T, h http.Handler) *http.Cookie {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/login", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("GET /api/auth/oidc/login: status %d, want 302", rec.Code)
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == "sonneck_oidc_state" {
			return c
		}
	}
	t.Fatal("no sonneck_oidc_state cookie set")
	return nil
}

func TestOIDCCallback_FirstLoginClaimsSeedAdmin(t *testing.T) {
	fake := &fakeOIDCAuthenticator{claims: oidcauth.Claims{Subject: "sub-1", Name: "Jamie Chen", Picture: "https://idp.example.com/jamie.png"}}
	h, conn := newOIDCTestServer(t, fake, true, []string{models.PermissionRead})

	stateCookie := startOIDCLogin(t, h)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/callback?code=abc&state="+stateCookie.Value, nil)
	req.AddCookie(stateCookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" {
		t.Fatalf("callback: status %d, location %q, body %s", rec.Code, rec.Header().Get("Location"), rec.Body.String())
	}

	var sessionCookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == "sonneck_session" {
			sessionCookie = c
		}
	}
	if sessionCookie == nil {
		t.Fatal("no session cookie set on successful callback")
	}

	user, err := repo.GetUserByID(context.Background(), conn, 1)
	if err != nil {
		t.Fatalf("loading id=1: %v", err)
	}
	if user.OIDCSubject == nil || *user.OIDCSubject != "sub-1" {
		t.Errorf("id=1 OIDCSubject = %v, want sub-1 (first login should claim the seed admin row)", user.OIDCSubject)
	}
	if user.DisplayName != "Jamie Chen" {
		t.Errorf("id=1 DisplayName = %q, want Jamie Chen", user.DisplayName)
	}
	if user.AvatarURL == nil || *user.AvatarURL != "https://idp.example.com/jamie.png" {
		t.Errorf("id=1 AvatarURL = %v, want the claimed picture URL", user.AvatarURL)
	}
	if !user.HasPermission(models.PermissionAdmin) {
		t.Error("claimed seed admin row should keep its existing admin permission untouched")
	}
}

func TestOIDCCallback_SecondDistinctSubjectAutoProvisions(t *testing.T) {
	fake := &fakeOIDCAuthenticator{}
	h, conn := newOIDCTestServer(t, fake, true, []string{models.PermissionRead})

	// First login claims id=1.
	fake.claims = oidcauth.Claims{Subject: "sub-1", Name: "Jamie Chen"}
	stateCookie := startOIDCLogin(t, h)
	req := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/callback?code=abc&state="+stateCookie.Value, nil)
	req.AddCookie(stateCookie)
	h.ServeHTTP(httptest.NewRecorder(), req)

	// A second, distinct subject must auto-provision a new row rather than
	// touching id=1 again.
	fake.claims = oidcauth.Claims{Subject: "sub-2", Name: "Alex Rivera"}
	stateCookie = startOIDCLogin(t, h)
	req = httptest.NewRequest(http.MethodGet, "/api/auth/oidc/callback?code=xyz&state="+stateCookie.Value, nil)
	req.AddCookie(stateCookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" {
		t.Fatalf("second callback: status %d, location %q, body %s", rec.Code, rec.Header().Get("Location"), rec.Body.String())
	}

	users, err := repo.ListUsers(context.Background(), conn)
	if err != nil {
		t.Fatalf("listing users: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("got %d users, want 2 (id=1 claimed, sub-2 auto-provisioned)", len(users))
	}
	var second *models.User
	for _, u := range users {
		if u.ID != 1 {
			second = u
		}
	}
	if second == nil {
		t.Fatal("no second user row found")
	}
	if second.DisplayName != "Alex Rivera" {
		t.Errorf("second user DisplayName = %q, want Alex Rivera", second.DisplayName)
	}
	if second.OIDCSubject == nil || *second.OIDCSubject != "sub-2" {
		t.Errorf("second user OIDCSubject = %v, want sub-2", second.OIDCSubject)
	}
	if !second.HasPermission(models.PermissionRead) || second.HasPermission(models.PermissionAdmin) {
		t.Errorf("second user permissions = %v, want exactly [read] (OIDCDefaultPermissions)", second.Permissions)
	}
}

// TestOIDCCallback_RegistrationDisabledRejectsUnknownSubject confirms
// OIDC_ALLOW_REGISTRATION=false blocks auto-provisioning even on a *first*
// login — id=1 being unclaimed doesn't make a subject "known," only a
// matching oidc_subject does (repo.ClaimOrProvisionOIDCUser's own ordering:
// exact-subject match, then claim-id=1, then provision-or-reject).
func TestOIDCCallback_RegistrationDisabledRejectsUnknownSubject(t *testing.T) {
	fake := &fakeOIDCAuthenticator{claims: oidcauth.Claims{Subject: "sub-9", Name: "Uninvited"}}

	// Claim id=1 with a *different* subject first, so sub-9 below genuinely
	// falls into the reject-vs-provision branch rather than the claim
	// branch.
	claimer := &fakeOIDCAuthenticator{claims: oidcauth.Claims{Subject: "sub-1", Name: "Jamie Chen"}}
	claimServer, conn := newOIDCTestServer(t, claimer, true, []string{models.PermissionRead})
	stateCookie := startOIDCLogin(t, claimServer)
	req := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/callback?code=abc&state="+stateCookie.Value, nil)
	req.AddCookie(stateCookie)
	claimServer.ServeHTTP(httptest.NewRecorder(), req)

	// Same DB, registration-disabled server, unknown subject.
	rejecting := handlers.New(conn, &config.Config{DataDir: t.TempDir(), LogLevelVar: &slog.LevelVar{}, AuthMethod: "oidc"}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})), mustFS(t), nil, "", "", "docker", fake, nil)
	stateCookie2 := startOIDCLogin(t, rejecting)
	req2 := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/callback?code=xyz&state="+stateCookie2.Value, nil)
	req2.AddCookie(stateCookie2)
	rec2 := httptest.NewRecorder()
	rejecting.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec2.Code)
	}
	if loc := rec2.Header().Get("Location"); loc != "/?oidcError=registration_disabled" {
		t.Errorf("location = %q, want /?oidcError=registration_disabled", loc)
	}
}

func mustFS(t *testing.T) fs.FS {
	t.Helper()
	f, err := webui.FS()
	if err != nil {
		t.Fatalf("loading embedded frontend: %v", err)
	}
	return f
}

func TestOIDCCallback_StateMismatchRejected(t *testing.T) {
	fake := &fakeOIDCAuthenticator{claims: oidcauth.Claims{Subject: "sub-1", Name: "Jamie Chen"}}
	h, _ := newOIDCTestServer(t, fake, true, []string{models.PermissionRead})

	stateCookie := startOIDCLogin(t, h)
	req := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/callback?code=abc&state=not-the-real-state", nil)
	req.AddCookie(stateCookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/?oidcError=state" {
		t.Errorf("location = %q, want /?oidcError=state", loc)
	}
}

func TestClaimOrProvisionOIDCUser_ReLoginResyncsNameAndAvatar(t *testing.T) {
	dataDir := t.TempDir()
	conn, err := db.Open(filepath.Join(dataDir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	defer conn.Close()

	ctx := context.Background()
	pic1 := "https://idp.example.com/v1.png"
	if _, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-1", "Jamie Chen", &pic1, []string{models.PermissionRead}, true); err != nil {
		t.Fatalf("first claim: %v", err)
	}

	pic2 := "https://idp.example.com/v2.png"
	user, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-1", "Jamie C. Chen", &pic2, []string{models.PermissionRead}, true)
	if err != nil {
		t.Fatalf("second login: %v", err)
	}
	if user.DisplayName != "Jamie C. Chen" {
		t.Errorf("DisplayName after re-login = %q, want the freshly-claimed name (re-synced every login, not just once)", user.DisplayName)
	}
	if user.AvatarURL == nil || *user.AvatarURL != pic2 {
		t.Errorf("AvatarURL after re-login = %v, want %s", user.AvatarURL, pic2)
	}
}

func TestClaimOrProvisionOIDCUser_RegistrationDisabledErrorIsSentinel(t *testing.T) {
	dataDir := t.TempDir()
	conn, err := db.Open(filepath.Join(dataDir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	defer conn.Close()

	ctx := context.Background()
	// Claim id=1 first so the next subject genuinely falls into the
	// "already claimed by someone else" auto-provision branch.
	if _, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-1", "Jamie Chen", nil, []string{models.PermissionRead}, true); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	_, err = repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-2", "Nope", nil, []string{models.PermissionRead}, false)
	if !errors.Is(err, repo.ErrOIDCRegistrationDisabled) {
		t.Errorf("err = %v, want repo.ErrOIDCRegistrationDisabled", err)
	}
}
