-- +goose Up
-- Books gain an arranger field alongside composer (direct instruction,
-- 2026-08-20): a Book (like a Piece) must now have at least one of
-- composer/arranger set — see ValidateBook. Arranger also becomes
-- book-inheritable for Piece as part of the same change (ResolveEffective,
-- internal/repo/effective.go) — this column is what a piece falls back to
-- when it has no arranger of its own.
ALTER TABLE books ADD COLUMN arranger TEXT;

-- +goose Down
ALTER TABLE books DROP COLUMN arranger;
