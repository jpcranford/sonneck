-- +goose Up
-- Prefer the simpler enharmonic spelling for the five "black key" pitches
-- (fewer accidentals in the key signature — e.g. D♭ major is five flats
-- vs. C♯ major's seven sharps), except F♯/G♭ major, a genuine tie (six
-- accidentals each) where both spellings are common enough in real
-- notation that neither should be dropped. Renamed in place (UPDATE, not
-- delete+insert) so existing piece_keys rows and IDs survive untouched.
-- Unicode ♯ (U+266F) / ♭ (U+266D) everywhere an accidental appears, never
-- ASCII '#' or a literal 'b'.
UPDATE musical_keys SET name = 'D♭ Major' WHERE name = 'C# Major';
UPDATE musical_keys SET name = 'D♭ Minor' WHERE name = 'C# Minor';
UPDATE musical_keys SET name = 'E♭ Major' WHERE name = 'D# Major';
UPDATE musical_keys SET name = 'E♭ Minor' WHERE name = 'D# Minor';
UPDATE musical_keys SET name = 'F♯ Major' WHERE name = 'F# Major';
UPDATE musical_keys SET name = 'F♯ Minor' WHERE name = 'F# Minor';
UPDATE musical_keys SET name = 'A♭ Major' WHERE name = 'G# Major';
UPDATE musical_keys SET name = 'A♭ Minor' WHERE name = 'G# Minor';
UPDATE musical_keys SET name = 'B♭ Major' WHERE name = 'A# Major';
UPDATE musical_keys SET name = 'B♭ Minor' WHERE name = 'A# Minor';

-- A pre-existing ad-hoc "Bb Major" (ASCII 'b', ID 25 on the dev DB) was
-- created by hand earlier via the free-text "new key" combobox, before
-- this naming convention existed. Merge it into the canonical B♭ Major
-- row above rather than leaving a duplicate: repoint any piece
-- referencing it, then remove the now-orphaned row. Guarded with EXISTS so
-- this is a safe no-op on a fresh install that never had this row.
UPDATE piece_keys
SET key_id = (SELECT id FROM musical_keys WHERE name = 'B♭ Major')
WHERE key_id = (SELECT id FROM musical_keys WHERE name = 'Bb Major')
  AND EXISTS (SELECT 1 FROM musical_keys WHERE name = 'Bb Major');
DELETE FROM musical_keys WHERE name = 'Bb Major';

-- The one deliberate exception: F♯ major and G♭ major are both listed.
-- (F♯ minor stays the sole spelling on the minor side — G♭ minor would
-- need double-flats and is essentially never used in practice, so there's
-- no equivalent tie to preserve there.)
INSERT INTO musical_keys (name) VALUES ('G♭ Major');

-- Explicit display order (chromatic, each pitch's major immediately
-- before its minor) — the previous order just happened to fall out of
-- insertion order (ListKeys did ORDER BY id), which silently breaks the
-- moment a row is inserted anywhere but the end. That's exactly what
-- adding G♭ Major above would otherwise do: it would land after B Minor,
-- nowhere near F♯ Major where it musically belongs. ORDER BY sort_order
-- replaces ORDER BY id in ListKeys/KeysByIDs so this is robust to future
-- inserts (a user typing a brand-new key name via "New tag" still just
-- gets appended — sort_order only orders the display, not FindOrCreate).
ALTER TABLE musical_keys ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE musical_keys SET sort_order = CASE name
    WHEN 'C Major'  THEN 1  WHEN 'C Minor'  THEN 2
    WHEN 'D♭ Major' THEN 3  WHEN 'D♭ Minor' THEN 4
    WHEN 'D Major'  THEN 5  WHEN 'D Minor'  THEN 6
    WHEN 'E♭ Major' THEN 7  WHEN 'E♭ Minor' THEN 8
    WHEN 'E Major'  THEN 9  WHEN 'E Minor'  THEN 10
    WHEN 'F Major'  THEN 11 WHEN 'F Minor'  THEN 12
    WHEN 'F♯ Major' THEN 13 WHEN 'G♭ Major' THEN 14
    WHEN 'F♯ Minor' THEN 15
    WHEN 'G Major'  THEN 16 WHEN 'G Minor'  THEN 17
    WHEN 'A♭ Major' THEN 18 WHEN 'A♭ Minor' THEN 19
    WHEN 'A Major'  THEN 20 WHEN 'A Minor'  THEN 21
    WHEN 'B♭ Major' THEN 22 WHEN 'B♭ Minor' THEN 23
    WHEN 'B Major'  THEN 24 WHEN 'B Minor'  THEN 25
    ELSE 999
  END;

-- +goose Down
-- The "Bb Major" merge above is deliberately lossy, same as migration
-- 00008's own down migration: there's no way to un-merge which piece(s)
-- originally pointed at the ad-hoc duplicate row vs. the canonical one.
ALTER TABLE musical_keys DROP COLUMN sort_order;
DELETE FROM musical_keys WHERE name = 'G♭ Major';
UPDATE musical_keys SET name = 'A# Major' WHERE name = 'B♭ Major';
UPDATE musical_keys SET name = 'A# Minor' WHERE name = 'B♭ Minor';
UPDATE musical_keys SET name = 'G# Major' WHERE name = 'A♭ Major';
UPDATE musical_keys SET name = 'G# Minor' WHERE name = 'A♭ Minor';
UPDATE musical_keys SET name = 'F# Major' WHERE name = 'F♯ Major';
UPDATE musical_keys SET name = 'F# Minor' WHERE name = 'F♯ Minor';
UPDATE musical_keys SET name = 'D# Major' WHERE name = 'E♭ Major';
UPDATE musical_keys SET name = 'D# Minor' WHERE name = 'E♭ Minor';
UPDATE musical_keys SET name = 'C# Major' WHERE name = 'D♭ Major';
UPDATE musical_keys SET name = 'C# Minor' WHERE name = 'D♭ Minor';
