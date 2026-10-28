-- +goose Up
-- The Sheet Viewer's annotations: each account's own marks on a piece, one
-- row per page (marks is the page's JSON array of pen and highlighter
-- strokes and text marks, in drawing order; positions are shares of the
-- page, so a mark keeps its place at any size). A page with no marks has no
-- row. Kept by page number when the piece's file is replaced.
CREATE TABLE piece_annotations (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    marks TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, piece_id, page)
);

-- Which annotation colors the user has hidden on a piece: a bitmask, bit i
-- for color i (0 = all shown).
ALTER TABLE piece_practice_settings ADD COLUMN hidden_colors INTEGER NOT NULL DEFAULT 0;

-- User Settings › Sheet Viewer › "Show hidden colors faintly": a hidden
-- color's marks stay as faint ghosts. On by default.
ALTER TABLE user_settings ADD COLUMN sheet_viewer_ghost_marks INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE user_settings DROP COLUMN sheet_viewer_ghost_marks;
ALTER TABLE piece_practice_settings DROP COLUMN hidden_colors;
DROP TABLE piece_annotations;
