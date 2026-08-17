-- +goose Up
-- A few starter userTags so a fresh library isn't a totally blank tag
-- vocabulary on first use — same "seed the lookup table at creation" idea
-- as musical_keys/sheet_types (00001), just arriving later since user_tags
-- (00004) wasn't seeded at the time. INSERT OR IGNORE: user_tags.name is
-- UNIQUE, and an existing install may already have created one of these
-- names by hand before upgrading — skip rather than fail the migration.
INSERT OR IGNORE INTO user_tags (name) VALUES
    ('recital candidate'),
    ('sight-reading practice'),
    ('favorite encore');

-- +goose Down
DELETE FROM user_tags WHERE name IN ('recital candidate', 'sight-reading practice', 'favorite encore');
