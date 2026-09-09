package handlers_test

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"testing"

	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/handlers"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// serverWithAuthMethod builds a real handler against an already-open DB
// with a specific cfg.AuthMethod — representing "the same install,
// restarted with a changed AUTH_METHOD env var," exactly the scenario the
// Auth Change flow exists to detect. Mirrors newTestServerWithDataDir's own
// setup shape (handlers_test.go).
func serverWithAuthMethod(t *testing.T, conn *sql.DB, authMethod string) http.Handler {
	t.Helper()
	cfg := &config.Config{AuthMethod: authMethod, LogLevelVar: &slog.LevelVar{}}
	cfg.SetCopyrightRegion("en-US")
	cfg.SetBackupCron("0 3 * * *")
	cfg.SetBackupRetentionDays(30)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	frontend := mustFS(t)
	return handlers.New(conn, cfg, logger, frontend, nil, "", "", nil)
}

func TestAuthChangeEndpoints_409WhenNothingPending(t *testing.T) {
	h := newTestServer(t)

	rec := doJSON(t, h, http.MethodGet, "/api/auth-change/candidates", nil)
	if rec.Code != http.StatusConflict {
		t.Errorf("GET candidates: status = %d, want 409", rec.Code)
	}
	rec = doJSON(t, h, http.MethodPost, "/api/auth-change/complete", nil)
	if rec.Code != http.StatusConflict {
		t.Errorf("POST complete: status = %d, want 409", rec.Code)
	}
}

func TestGetConfig_ReportsAuthChangePendingOnMismatch(t *testing.T) {
	_, conn := newTestServerWithDB(t)
	ctx := context.Background()
	if err := repo.CompleteFirstLaunch(ctx, conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}

	// "Restart" the same install with AUTH_METHOD=singlepass now set.
	restarted := serverWithAuthMethod(t, conn, "singlepass")

	rec := doJSON(t, restarted, http.MethodGet, "/api/config", nil)
	var cfg struct {
		AuthChangePending *struct {
			From          string `json:"from"`
			To            string `json:"to"`
			NeedsPassword bool   `json:"needsPassword"`
			MultiAccount  bool   `json:"multiAccount"`
		} `json:"authChangePending"`
	}
	decodeData(t, rec, &cfg)
	if cfg.AuthChangePending == nil {
		t.Fatal("authChangePending = nil, want a pending none→singlepass transition")
	}
	if cfg.AuthChangePending.From != "none" || cfg.AuthChangePending.To != "singlepass" {
		t.Errorf("authChangePending = %+v, want {from: none, to: singlepass}", cfg.AuthChangePending)
	}
	if !cfg.AuthChangePending.NeedsPassword {
		t.Error("NeedsPassword should be true — id=1 has never had a password set")
	}
	if cfg.AuthChangePending.MultiAccount {
		t.Error("MultiAccount should be false — only the one seeded account exists")
	}
}

func TestAuthChangeComplete_ToSinglepass_RequiresPasswordThenLogsIn(t *testing.T) {
	_, conn := newTestServerWithDB(t)
	ctx := context.Background()
	if err := repo.CompleteFirstLaunch(ctx, conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}
	restarted := serverWithAuthMethod(t, conn, "singlepass")

	// No password: rejected.
	rec := doJSON(t, restarted, http.MethodPost, "/api/auth-change/complete", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("no password: status = %d, want 400, body %s", rec.Code, rec.Body.String())
	}

	// A real password: succeeds, and last_active_auth_method catches up —
	// re-checking GET /api/config on a fresh handler against the same DB
	// (the "next restart, nothing changed" case) should now show no
	// pending transition.
	rec = doJSON(t, restarted, http.MethodPost, "/api/auth-change/complete", map[string]string{"password": "correcthorse"})
	if rec.Code != http.StatusOK {
		t.Fatalf("with password: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}

	again := serverWithAuthMethod(t, conn, "singlepass")
	rec = doJSON(t, again, http.MethodGet, "/api/config", nil)
	var cfg struct {
		AuthChangePending *struct{} `json:"authChangePending"`
	}
	decodeData(t, rec, &cfg)
	if cfg.AuthChangePending != nil {
		t.Error("authChangePending should be nil once last_active_auth_method has caught up")
	}

	// The password set during the flow actually works.
	rec = doJSON(t, again, http.MethodPost, "/api/auth/login", map[string]string{"password": "correcthorse"})
	if rec.Code != http.StatusOK {
		t.Errorf("login with the password just set: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
}

func TestAuthChangeComplete_SinglepassToNone_NoPasswordNeeded(t *testing.T) {
	_, conn := newTestServerWithDB(t)
	ctx := context.Background()
	hash := "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W" // bcrypt("password"), reused from oidc-verify's own Dex fixture
	if err := repo.CompleteFirstLaunch(ctx, conn, "singlepass", &hash); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}
	restarted := serverWithAuthMethod(t, conn, "none")

	rec := doJSON(t, restarted, http.MethodPost, "/api/auth-change/complete", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
}

func TestAuthChangeCandidates_RequiresMultiAccountOIDCDowngrade(t *testing.T) {
	_, conn := newTestServerWithDB(t)
	ctx := context.Background()
	if err := repo.CompleteFirstLaunch(ctx, conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}
	if err := repo.SetLastActiveAuthMethod(ctx, conn, "oidc"); err != nil {
		t.Fatalf("SetLastActiveAuthMethod: %v", err)
	}
	// Simulates having actually run under oidc with only the one seeded
	// account — target isn't oidc (so not an upgrade) and only one account
	// exists, so candidates has nothing to offer.
	restarted := serverWithAuthMethod(t, conn, "none")
	rec := doJSON(t, restarted, http.MethodGet, "/api/auth-change/candidates", nil)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("single-account downgrade: status = %d, want 400 (nothing to choose)", rec.Code)
	}

	// id=1 has to be claimed first — ClaimOrProvisionOIDCUser's own "first
	// login claims the still-unclaimed id=1" rule means the very next call
	// below would otherwise claim id=1 as "Alex" instead of provisioning a
	// genuinely new row.
	if _, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-1", "Original", nil,
		[]string{models.PermissionAdmin}, true); err != nil {
		t.Fatalf("claiming id=1: %v", err)
	}
	// A second admin account changes that.
	if _, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-2", "Alex", nil,
		[]string{models.PermissionRead, models.PermissionAdmin}, true); err != nil {
		t.Fatalf("provisioning second admin: %v", err)
	}
	rec = doJSON(t, restarted, http.MethodGet, "/api/auth-change/candidates", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("multi-account downgrade: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
	var candidates []struct {
		ID          int64  `json:"id"`
		DisplayName string `json:"displayName"`
	}
	decodeData(t, rec, &candidates)
	if len(candidates) != 2 {
		t.Errorf("candidates = %+v, want both id=1 and Alex (both admins)", candidates)
	}
}

func TestAuthChangeComplete_MultiAccountDowngrade_ValidatesAndCollapses(t *testing.T) {
	_, conn := newTestServerWithDB(t)
	ctx := context.Background()
	if err := repo.CompleteFirstLaunch(ctx, conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}
	if err := repo.SetLastActiveAuthMethod(ctx, conn, "oidc"); err != nil {
		t.Fatalf("SetLastActiveAuthMethod: %v", err)
	}
	// Claim id=1 first (see the sibling candidates test's own comment for
	// why) so Alex/Sam below genuinely land on new ids — the point of this
	// test is exercising ApplyAuthChangeDowngrade's keepUserID != 1
	// branch, which claiming id=1 as "Alex" directly would silently skip.
	if _, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-1", "Original", nil,
		[]string{models.PermissionAdmin}, true); err != nil {
		t.Fatalf("claiming id=1: %v", err)
	}
	if _, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-2", "Alex", nil,
		[]string{models.PermissionRead, models.PermissionAdmin}, true); err != nil {
		t.Fatalf("provisioning second admin: %v", err)
	}
	if _, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-3", "Sam", nil,
		[]string{models.PermissionRead}, true); err != nil {
		t.Fatalf("provisioning non-admin: %v", err)
	}
	restarted := serverWithAuthMethod(t, conn, "singlepass")

	// Missing keepUserId: rejected.
	rec := doJSON(t, restarted, http.MethodPost, "/api/auth-change/complete", map[string]string{"password": "correcthorse"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing keepUserId: status = %d, want 400", rec.Code)
	}

	// A non-admin keepUserId (Sam): rejected. Alex's real id comes from the
	// flow's own public candidates endpoint (/api/admin/users is
	// permission-gated and unreachable pre-session here, same as every
	// other admin route) — Sam is a real account but not an admin, so
	// won't appear there at all; its id is looked up directly against the
	// DB instead, purely so this exercises the "valid account, wrong
	// permission" 400 path rather than the "no such account" one.
	candidatesRec := doJSON(t, restarted, http.MethodGet, "/api/auth-change/candidates", nil)
	var candidates []struct {
		ID          int64  `json:"id"`
		DisplayName string `json:"displayName"`
	}
	decodeData(t, candidatesRec, &candidates)
	var samID, alexID int64
	for _, u := range candidates {
		if u.DisplayName == "Alex" {
			alexID = u.ID
		}
	}
	if err := conn.QueryRowContext(ctx, `SELECT id FROM users WHERE display_name = 'Sam'`).Scan(&samID); err != nil {
		t.Fatalf("looking up Sam's id: %v", err)
	}
	rec = doJSON(t, restarted, http.MethodPost, "/api/auth-change/complete",
		map[string]any{"password": "correcthorse", "keepUserId": samID})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("non-admin keepUserId: status = %d, want 400", rec.Code)
	}

	// Alex (a real admin) as the survivor: succeeds, collapses to one
	// account, and the new password works.
	rec = doJSON(t, restarted, http.MethodPost, "/api/auth-change/complete",
		map[string]any{"password": "correcthorse", "keepUserId": alexID})
	if rec.Code != http.StatusOK {
		t.Fatalf("valid downgrade: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}

	remaining, err := repo.ListUsers(ctx, conn)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if len(remaining) != 1 || remaining[0].ID != 1 || remaining[0].DisplayName != "Alex" {
		t.Fatalf("remaining users = %+v, want exactly [id=1 Alex]", remaining)
	}

	// Both id=1 (migration 00025's own seed) and Alex (repo.SeedNewUserData,
	// same 5 default names) carried their own identically-named
	// practice_statuses before this — exactly 5 surviving under id=1
	// confirms ApplyAuthChangeDowngrade replaced id=1's own rows rather
	// than colliding with Alex's on the UNIQUE(owner_user_id, name)
	// constraint.
	var practiceStatusCount int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM practice_statuses WHERE owner_user_id = 1`).Scan(&practiceStatusCount); err != nil {
		t.Fatalf("counting practice_statuses: %v", err)
	}
	if practiceStatusCount != 5 {
		t.Errorf("practice_statuses owned by id=1 = %d, want exactly 5", practiceStatusCount)
	}

	loginRec := doJSON(t, restarted, http.MethodPost, "/api/auth/login", map[string]string{"password": "correcthorse"})
	if loginRec.Code != http.StatusOK {
		t.Errorf("login with the password set during downgrade: status = %d, want 200", loginRec.Code)
	}
}

// TestAuthChangeComplete_SubmittedPasswordOverridesStaleLeftoverHash is a
// regression test for a real bug caught during live verification (not
// found by any of the tests above): id=1 can carry a genuinely stale
// password_hash left over from a much earlier singlepass stint — nothing
// clears it when later claimed via OIDC, since ClaimOrProvisionOIDCUser
// never touches that column, and ApplyAuthChangeDowngrade's own
// keepUserID==1 branch doesn't either. The first version of this handler
// only used a submitted password when id=1 had none yet, so a fresh
// password typed into this exact flow was silently discarded in favor of
// the old, forgotten one — confirmed live (typed "newsharedpass", only
// the leftover original password actually worked afterward). A submitted
// password must always win.
func TestAuthChangeComplete_SubmittedPasswordOverridesStaleLeftoverHash(t *testing.T) {
	_, conn := newTestServerWithDB(t)
	ctx := context.Background()
	staleHash := "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W" // bcrypt("password")
	if err := repo.CompleteFirstLaunch(ctx, conn, "singlepass", &staleHash); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}
	// Claiming id=1 via OIDC never touches password_hash — it survives,
	// dormant, exactly like a real singlepass->oidc upgrade would leave it.
	if _, err := repo.ClaimOrProvisionOIDCUser(ctx, conn, "sub-1", "Jamie", nil, []string{models.PermissionAdmin}, true); err != nil {
		t.Fatalf("claiming id=1 via oidc: %v", err)
	}
	if err := repo.SetLastActiveAuthMethod(ctx, conn, "oidc"); err != nil {
		t.Fatalf("SetLastActiveAuthMethod: %v", err)
	}
	restarted := serverWithAuthMethod(t, conn, "singlepass")

	rec := doJSON(t, restarted, http.MethodPost, "/api/auth-change/complete", map[string]string{"password": "newsharedpass"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}

	oldRec := doJSON(t, restarted, http.MethodPost, "/api/auth/login", map[string]string{"password": "password"})
	if oldRec.Code == http.StatusOK {
		t.Error("the stale leftover password should no longer work")
	}
	newRec := doJSON(t, restarted, http.MethodPost, "/api/auth/login", map[string]string{"password": "newsharedpass"})
	if newRec.Code != http.StatusOK {
		t.Errorf("login with the freshly-submitted password: status = %d, want 200, body %s", newRec.Code, newRec.Body.String())
	}
}
