-- +goose Up
-- The Sheet Viewer's metronome. Per user and piece, on
-- piece_practice_settings: the tempo, one level per beat as a string of
-- digits ("2111": 2 accented, 1 played, 0 silent) and the clicks per beat
-- (1, 2, 3 or 4). All three are NULL until the user changes the metronome
-- on that piece, which then starts from the piece's own BPM and beats per
-- measure. Checked by the handler, not by CHECK constraints (a column with
-- one can't be dropped in place).
--
-- Per user, on user_settings: what the metronome's toolbar button shows
-- beside its icon (beat, tempo or icon), icon only by default.
ALTER TABLE piece_practice_settings ADD COLUMN metronome_bpm INTEGER;
ALTER TABLE piece_practice_settings ADD COLUMN metronome_beats TEXT;
ALTER TABLE piece_practice_settings ADD COLUMN metronome_subdivision INTEGER;
ALTER TABLE user_settings ADD COLUMN sheet_viewer_metronome_show TEXT NOT NULL DEFAULT 'icon';

-- +goose Down
ALTER TABLE piece_practice_settings DROP COLUMN metronome_bpm;
ALTER TABLE piece_practice_settings DROP COLUMN metronome_beats;
ALTER TABLE piece_practice_settings DROP COLUMN metronome_subdivision;
ALTER TABLE user_settings DROP COLUMN sheet_viewer_metronome_show;
