-- +goose Up
-- Renamed in place (UPDATE, not delete+insert) so existing pieces/books
-- referencing these rows by sheet_type_id keep pointing at the same
-- row/ID — same approach as migration 00010's key renames, and simpler
-- here since sheet_type_id is single-valued (no many-to-many merge to
-- worry about).
UPDATE sheet_types SET name = 'Solo Piece' WHERE name = 'Solo Part';
UPDATE sheet_types SET name = 'Ensemble Piece – Full Score' WHERE name = 'Ensemble Score';

INSERT INTO sheet_types (name) VALUES ('Ensemble Piece – Part');

-- Explicit display order, same reasoning as musical_keys.sort_order
-- (migration 00010): ListSheetTypes previously did ORDER BY id, which
-- silently breaks the moment a row is inserted anywhere but the end —
-- exactly what adding "Ensemble Piece – Part" above would otherwise do
-- (it would sort after PVG Score, not next to the other Ensemble Piece
-- entry where it belongs).
ALTER TABLE sheet_types ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE sheet_types SET sort_order = CASE name
    WHEN 'Lead Sheet'                    THEN 1
    WHEN 'Solo Piece'                    THEN 2
    WHEN 'Ensemble Piece – Full Score'   THEN 3
    WHEN 'Ensemble Piece – Part'         THEN 4
    WHEN 'PVG Score'                     THEN 5
    ELSE 999
  END;

-- +goose Down
-- Deleting 'Ensemble Piece – Part' fails if any piece/book already
-- references it by then — same accepted risk as migration 00010's down
-- migration unconditionally deleting the row it added (G♭ Major).
ALTER TABLE sheet_types DROP COLUMN sort_order;
DELETE FROM sheet_types WHERE name = 'Ensemble Piece – Part';
UPDATE sheet_types SET name = 'Ensemble Score' WHERE name = 'Ensemble Piece – Full Score';
UPDATE sheet_types SET name = 'Solo Part' WHERE name = 'Solo Piece';
