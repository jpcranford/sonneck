-- +goose Up
-- A setlist entry's description, for a piece entry too now (shown under it
-- on Setlist Details), not only a custom one: custom_notes is renamed, as
-- it no longer belongs to custom entries alone.
ALTER TABLE setlist_entries RENAME COLUMN custom_notes TO description;

-- +goose Down
ALTER TABLE setlist_entries RENAME COLUMN description TO custom_notes;
