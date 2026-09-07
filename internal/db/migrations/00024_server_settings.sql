-- +goose Up
-- Multi-user support, first-time launch flow (Phase 3 of the plan in
-- memory project_multiuser_build.md) — the minimal slice of the full
-- planned multi-user schema this phase actually needs: somewhere to
-- persist which security mode the operator picked and the one local admin
-- account's password, if singlepass is chosen. The rest of that plan's
-- schema (user_permissions, sessions, piece_favorites/
-- piece_practice_status/piece_user_notes, user_tags.owner_user_id,
-- user_settings) is deliberately NOT part of this migration — that's real
-- multi-user enforcement, scoped to a later "Backend changes" phase.
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (id, display_name) VALUES (1, 'Admin');

CREATE TABLE server_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    auth_method TEXT CHECK (auth_method IN ('none', 'singlepass', 'oidc')),
    first_launch_completed_at DATETIME
);

-- An existing library (any Piece or Book already on record) has plainly
-- already been "set up" in every sense that matters — it must never be
-- routed into the first-launch takeover on its next restart just because
-- this migration is new. Only a genuinely fresh, empty database gets
-- first_launch_completed_at left NULL so the real flow actually shows.
INSERT INTO server_settings (id, auth_method, first_launch_completed_at)
SELECT 1, NULL,
    CASE WHEN EXISTS (SELECT 1 FROM pieces) OR EXISTS (SELECT 1 FROM books)
        THEN CURRENT_TIMESTAMP
        ELSE NULL
    END;

-- +goose Down
DROP TABLE server_settings;
DROP TABLE users;
