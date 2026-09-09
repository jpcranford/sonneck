-- +goose Up
-- OIDC support (master plan Phase 14, precious-kindling-pretzel.md) — the
-- two columns the multi-user backend (migration 00025) deliberately left
-- out, since Phase 10 was scoped to "no OIDC yet."
--
-- oidc_subject: the IdP's own stable per-account identifier ("sub" claim).
-- NULL for every none/singlepass-mode row (there's no IdP at all) and for
-- any OIDC row before its first real login claims/provisions it. Plain
-- ALTER TABLE ADD COLUMN cannot itself carry a UNIQUE constraint — a real,
-- documented SQLite restriction, distinct from the DROP-COLUMN-with-CHECK
-- gotcha CLAUDE.md already documents for a different reason — so the
-- uniqueness is a separate index below instead. SQLite already treats NULL
-- as distinct under a UNIQUE index, so every non-OIDC row (oidc_subject
-- always NULL) coexists fine with no partial-index WHERE clause needed.
--
-- avatar_url: the IdP's own "picture" claim, re-synced on every login (not
-- just the first) in case it changes upstream — Phase 4's own forward note
-- in the master plan. NULL for none/singlepass, which have no such concept.
ALTER TABLE users ADD COLUMN oidc_subject TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE UNIQUE INDEX idx_users_oidc_subject ON users (oidc_subject);

-- +goose Down
DROP INDEX idx_users_oidc_subject;
ALTER TABLE users DROP COLUMN avatar_url;
ALTER TABLE users DROP COLUMN oidc_subject;
