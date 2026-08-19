-- +goose Up
-- Manual book creation (Books library view "New Book" button) needs a Book
-- row with no underlying PDF at all — every field here was previously
-- NOT NULL because every Book used to come from the upload/import wizard
-- (design doc §5), which always has a real file. That's no longer the only
-- way a Book gets created, so original_filename/file_path/file_hash all
-- become nullable. file_hash keeps its UNIQUE constraint — SQLite treats
-- every NULL as distinct under UNIQUE, so any number of file-less books
-- can coexist without colliding on it. SQLite can't ALTER a column to drop
-- NOT NULL in place, so the table is recreated, same pattern as migrations
-- 00008/00012.
CREATE TABLE books_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_title TEXT NOT NULL,
    composer TEXT,
    year_written TEXT,
    work_opus_number TEXT,
    sheet_type_id INTEGER REFERENCES sheet_types(id),
    publisher TEXT,
    publisher_id TEXT,
    description TEXT,
    imslp_number TEXT,
    original_filename TEXT,
    file_path TEXT,
    file_hash TEXT UNIQUE,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO books_new SELECT * FROM books;

DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

-- +goose Down
-- Lossy by necessity if any file-less book was actually created in the
-- meantime (same convention as every other down migration in this
-- project): there's no real file to backfill, so this fails outright
-- rather than silently inventing placeholder file data for rows that
-- can't satisfy the restored NOT NULL constraints.
CREATE TABLE books_old (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_title TEXT NOT NULL,
    composer TEXT,
    year_written TEXT,
    work_opus_number TEXT,
    sheet_type_id INTEGER REFERENCES sheet_types(id),
    publisher TEXT,
    publisher_id TEXT,
    description TEXT,
    imslp_number TEXT,
    original_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO books_old SELECT * FROM books;

DROP TABLE books;
ALTER TABLE books_old RENAME TO books;
