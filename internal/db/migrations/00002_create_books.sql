-- +goose Up
CREATE TABLE books (
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

-- +goose Down
DROP TABLE books;
