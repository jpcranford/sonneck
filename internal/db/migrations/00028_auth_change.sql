-- +goose Up
-- Auth Change flow (master plan Phase 16, precious-kindling-pretzel.md) —
-- the boot-time comparison baseline. Set once when first-launch completes
-- (repo.CompleteFirstLaunch) and again whenever an in-app none/singlepass
-- change lands (repo.UpdateAuthMethod) or this flow itself finishes
-- (repo.ApplyAuthChangeDowngrade et al). A mismatch between this and the
-- freshly-resolved auth method on boot means the operator changed
-- AUTH_METHOD externally since the app last ran under it — GET
-- /api/config's authChangePending is exactly that comparison.
ALTER TABLE server_settings ADD COLUMN last_active_auth_method TEXT
    CHECK (last_active_auth_method IN ('none','singlepass','oidc'));

-- +goose Down
ALTER TABLE server_settings DROP COLUMN last_active_auth_method;
