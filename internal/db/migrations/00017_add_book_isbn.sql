-- +goose Up
-- Proper ISBN support (direct instruction, 2026-08-20), split out of the
-- free-text publisherId field it used to be jammed into. Stored as plain
-- digits (+ a possible trailing check-digit "X" for ISBN-10) with no
-- hyphens — hyphenation is a display-time concern (frontend, and
-- buildCitation's own formatter for the citation string), not something
-- baked into storage. TEXT, not an integer column: real ISBN-10s can start
-- with a leading zero (silently lost in a true SQL INTEGER) and end in a
-- literal "X" check digit (not representable as one at all).
ALTER TABLE books ADD COLUMN isbn TEXT;

-- Data migration: existing publisherId values already carrying an "ISBN"
-- label (real observed data, e.g. "ISBN 1575607573") move to the new
-- column, extracted down to bare digits. This mirrors the same
-- label-was-typed-directly-into-a-free-text-field situation imslpNumber
-- has always had (stripImslpPrefix in citation.go) — except here the value
-- is moving to its own proper column instead of just having the label
-- stripped at render time, so publisherId is cleared for these rows: it
-- held nothing else, the whole value was the ISBN.
--
-- The extraction only handles the label immediately followed by digits and
-- optionally one separator character among space/colon/hash/dash (covers
-- every real-world variant tested: "ISBN 123", "isbn: 123", "ISBN-123",
-- "ISBN#123") — not a general-purpose parser. INSTR/UPPER finds "ISBN"
-- case-insensitively; +4 skips past the word itself; the chained REPLACEs
-- strip any of those separator characters from what's left.
UPDATE books
SET isbn = REPLACE(REPLACE(REPLACE(REPLACE(
        SUBSTR(publisher_id, INSTR(UPPER(publisher_id), 'ISBN') + 4),
        ' ', ''), ':', ''), '#', ''), '-', ''),
    publisher_id = NULL
WHERE publisher_id IS NOT NULL AND UPPER(publisher_id) LIKE '%ISBN%';

-- +goose Down
-- Lossy/approximate by necessity if any isbn value was ever set
-- independently after this migration ran (not migrated from publisher_id
-- at all) — same accepted limitation as this project's other lossy down
-- migrations (00008, 00012, 00014): every non-null isbn gets stuffed back
-- into publisher_id as "ISBN {isbn}", whether or not that's really where
-- it came from.
UPDATE books SET publisher_id = 'ISBN ' || isbn WHERE isbn IS NOT NULL AND publisher_id IS NULL;
ALTER TABLE books DROP COLUMN isbn;
