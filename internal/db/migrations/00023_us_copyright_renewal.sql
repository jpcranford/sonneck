-- +goose Up
-- US renewal follow-up (Public Domain Badge feature) — a work published
-- 1923-1963 in the US needed a separate renewal registration filed during
-- its 28th year to keep protection past that initial 28-year term; without
-- one it's public domain today (28 years is long since elapsed for
-- anything in that range). Nullable, mirroring copyright_year's own
-- pattern, so a piece with no explicit pick can still inherit the book's —
-- NULL means "not explicitly set here," not "confirmed not renewed."
ALTER TABLE pieces ADD COLUMN copyright_renewed INTEGER;
ALTER TABLE books ADD COLUMN copyright_renewed INTEGER;

-- +goose Down
ALTER TABLE pieces DROP COLUMN copyright_renewed;
ALTER TABLE books DROP COLUMN copyright_renewed;
