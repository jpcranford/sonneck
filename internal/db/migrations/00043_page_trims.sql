-- +goose Up
-- Trim Margins (the Sheet Viewer's Piece Preparation): each trimmed page's
-- frame as shares of the page (0 to 1, like an annotation's coordinates).
-- The piece's own setting, shared by every account; a page with no row
-- isn't trimmed. Checked by the handler, not CHECK constraints.
CREATE TABLE piece_page_trims (
    piece_id     INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    page         INTEGER NOT NULL,
    trim_left    REAL    NOT NULL,
    trim_top     REAL    NOT NULL,
    trim_right   REAL    NOT NULL,
    trim_bottom  REAL    NOT NULL,
    PRIMARY KEY (piece_id, page)
);

-- Piece Preparation's Reset switches a piece's trims off without forgetting
-- them: the pages show untrimmed, and Trim Margins opens on the frames last
-- used. Saving frames switches them back on.
ALTER TABLE pieces ADD COLUMN page_trims_off INTEGER NOT NULL DEFAULT 0;

-- Show original pages: each account's own choice per piece, on until that
-- account does a step of Piece Preparation itself.
ALTER TABLE piece_practice_settings ADD COLUMN show_original INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE piece_practice_settings DROP COLUMN show_original;
ALTER TABLE pieces DROP COLUMN page_trims_off;
DROP TABLE piece_page_trims;
