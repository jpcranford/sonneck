package models

import "time"

// Permission values (master plan's "Permission model" section) — an
// independent multi-select checklist per user, not a hierarchical tier.
// Admin short-circuits every check to true (see repo.RequirePermission).
const (
	PermissionRead     = "read"
	PermissionDownload = "download"
	PermissionPractice = "practice"
	PermissionEdit     = "edit"
	PermissionUpload   = "upload"
	PermissionCreate   = "create"
	PermissionDelete   = "delete"
	PermissionAdmin    = "admin"
)

// AllPermissions is every valid permission value, in the fixed order the
// Users screen's permission grid displays them.
var AllPermissions = []string{
	PermissionRead, PermissionDownload, PermissionPractice, PermissionEdit,
	PermissionUpload, PermissionCreate, PermissionDelete, PermissionAdmin,
}

// User is an account row (migration 00024, extended by 00025). In
// none/singlepass mode there is always exactly one (id=1) — OIDC (Phase 14)
// is the only mode that ever creates a second.
type User struct {
	ID           int64
	DisplayName  string
	PasswordHash *string
	CreatedAt    time.Time
	Permissions  []string
}

// HasPermission reports whether u holds perm directly, or holds "admin"
// (which implies every permission — master plan's Permission model).
func (u *User) HasPermission(perm string) bool {
	for _, p := range u.Permissions {
		if p == perm || p == PermissionAdmin {
			return true
		}
	}
	return false
}
