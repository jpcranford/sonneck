-- +goose Up
-- Supports the Library view's per-card page-cycle control (design doc §11,
-- frontend design system's locked "Library view — grid and list cards").
-- Every piece has at least one page (pdf.PageCount validates this at
-- upload/replace time), so DEFAULT 1 is a safe fallback for any pre-existing
-- row rather than allowing an unknown/NULL page count to leak into the UI.
ALTER TABLE pieces ADD COLUMN page_count INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE pieces DROP COLUMN page_count;
