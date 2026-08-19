-- +goose Up
-- Two bugs in migration 00010's flat-preference renaming, caught against a
-- hand-drawn reference list of all 26 practically-used major/minor keys:
--
-- 1. 00010 renamed 'C# Minor' -> 'D♭ Minor' and 'G# Minor' -> 'A♭ Minor',
--    applying the "prefer fewer accidentals" rule that correctly favors
--    D♭/A♭ on the *major* side without rechecking it for minor. A minor
--    key's accidental count matches its *relative major* (three semitones
--    up), not its parallel major — so C♯ minor (relative major E, 4♯) is
--    far simpler than D♭ minor (relative major F♭, 8♭), and G♯ minor
--    (relative major B, 5♯) is far simpler than A♭ minor (relative major
--    C♭, 7♭). D♭ minor / A♭ minor are essentially never used in practice.
--    Renamed back to the sharp spelling on the minor side only — the
--    major-side D♭ Major / A♭ Major names from 00010 are untouched and
--    still correct.
-- 2. D♯ minor / E♭ minor (relative majors F♯ and G♭, 6♯/6♭) is a genuine
--    tie, same as F♯ Major / G♭ Major on the major side — but 00010 only
--    kept the single 'E♭ Minor' spelling. Adds 'D♯ Minor' back as that
--    tie's other half, same treatment as G♭ Major.
UPDATE musical_keys SET name = 'C♯ Minor' WHERE name = 'D♭ Minor';
UPDATE musical_keys SET name = 'G♯ Minor' WHERE name = 'A♭ Minor';
INSERT INTO musical_keys (name) VALUES ('D♯ Minor');

-- Full renumber (26 rows now, was 25) rather than shifting a range, same
-- approach 00010 used — an explicit CASE is self-documenting and immune to
-- off-by-one errors from shifting everything after the insertion point.
UPDATE musical_keys SET sort_order = CASE name
    WHEN 'C Major'  THEN 1  WHEN 'C Minor'  THEN 2
    WHEN 'D♭ Major' THEN 3  WHEN 'C♯ Minor' THEN 4
    WHEN 'D Major'  THEN 5  WHEN 'D Minor'  THEN 6
    WHEN 'E♭ Major' THEN 7  WHEN 'D♯ Minor' THEN 8  WHEN 'E♭ Minor' THEN 9
    WHEN 'E Major'  THEN 10 WHEN 'E Minor'  THEN 11
    WHEN 'F Major'  THEN 12 WHEN 'F Minor'  THEN 13
    WHEN 'F♯ Major' THEN 14 WHEN 'G♭ Major' THEN 15
    WHEN 'F♯ Minor' THEN 16
    WHEN 'G Major'  THEN 17 WHEN 'G Minor'  THEN 18
    WHEN 'A♭ Major' THEN 19 WHEN 'G♯ Minor' THEN 20
    WHEN 'A Major'  THEN 21 WHEN 'A Minor'  THEN 22
    WHEN 'B♭ Major' THEN 23 WHEN 'B♭ Minor' THEN 24
    WHEN 'B Major'  THEN 25 WHEN 'B Minor'  THEN 26
    ELSE 999
  END;

-- +goose Down
-- Deleting 'D♯ Minor' is deliberately lossy for any piece_keys row that
-- came to reference it after this migration (cascades via ON DELETE
-- CASCADE on piece_keys.key_id) — same accepted trade-off as 00008/00010's
-- own down migrations for the same reason: there's no way to know what a
-- lost row's piece should fall back to.
DELETE FROM musical_keys WHERE name = 'D♯ Minor';
UPDATE musical_keys SET name = 'A♭ Minor' WHERE name = 'G♯ Minor';
UPDATE musical_keys SET name = 'D♭ Minor' WHERE name = 'C♯ Minor';

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
