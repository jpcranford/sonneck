-- +goose Up
-- Two durable, rename-proof identifiers for the 5 seeded practice_statuses
-- rows (migration 00025) — direct feedback: renaming a status in User
-- Settings must be reflected everywhere, and must not break the sidebar's
-- fixed Want to Learn/Currently Practicing/Learned views, which up to now
-- filtered by the status's own live *name* (breaks the instant it's
-- renamed) and rendered a hardcoded icon keyed by that same live name
-- (same problem, one level up — even survives a rename within one page
-- session, but not a fresh mount, e.g. navigating away and back).
--
-- sidebar_slot: which of the three fixed sidebar views (if any) this
-- status feeds. Not unique per slot — "Currently Practicing" is Learning
-- OR Stalled together, so both rows carry 'practicing'. Set once at seed
-- time (here, and in repo.SeedNewUserData for every future new account),
-- never touched by RenamePracticeStatus — a rename only ever changes
-- `name`.
--
-- icon_key: which of the five hardcoded icons (components/
-- PracticeStatusIcon.tsx's own five, mirrored client-side) this status
-- was seeded as. Deliberately NOT the same values as sidebar_slot — Stalled
-- and Learning share a sidebar_slot but need different icons, and Dropped
-- has an icon but no sidebar_slot at all. NULL for any status the user
-- creates themselves (Practice Status creation is currently disabled in
-- the UI specifically because there's no icon-assignment UX yet for that
-- case — this column doesn't change that, it only durably records the
-- assignment the five *seeded* rows already unambiguously have).
--
-- Both nullable with no explicit default — SQLite's ADD COLUMN gives every
-- existing row NULL, which satisfies a CHECK constraint same as any other
-- value (NULL never violates a CHECK unless the expression explicitly says
-- so). Backfilled below by matching each existing row's current name —
-- safe for this migration only because multi-user support has shipped no
-- real users yet (CLAUDE.md's own "Multi-user support" section); a
-- practice_statuses row already renamed away from its seed name before
-- this migration ever runs would backfill as NULL/NULL, same as a genuine
-- custom status.
ALTER TABLE practice_statuses ADD COLUMN sidebar_slot TEXT
    CHECK (sidebar_slot IN ('want_to_learn', 'practicing', 'learned'));
ALTER TABLE practice_statuses ADD COLUMN icon_key TEXT
    CHECK (icon_key IN ('want_to_learn', 'learning', 'learned', 'stalled', 'dropped'));

UPDATE practice_statuses SET sidebar_slot = 'want_to_learn', icon_key = 'want_to_learn' WHERE name = 'Want to Learn';
UPDATE practice_statuses SET sidebar_slot = 'practicing', icon_key = 'learning' WHERE name = 'Learning';
UPDATE practice_statuses SET sidebar_slot = 'practicing', icon_key = 'stalled' WHERE name = 'Stalled';
UPDATE practice_statuses SET sidebar_slot = 'learned', icon_key = 'learned' WHERE name = 'Learned';
UPDATE practice_statuses SET icon_key = 'dropped' WHERE name = 'Dropped';

-- +goose Down
ALTER TABLE practice_statuses DROP COLUMN icon_key;
ALTER TABLE practice_statuses DROP COLUMN sidebar_slot;
