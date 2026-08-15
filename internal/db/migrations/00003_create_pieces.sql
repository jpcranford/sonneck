-- +goose Up
CREATE TABLE pieces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    composer TEXT,
    arranger TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    work_opus_number TEXT,
    key_id INTEGER REFERENCES musical_keys(id),
    sheet_type_id INTEGER REFERENCES sheet_types(id),
    publisher TEXT,
    publisher_id TEXT,
    year_written TEXT,
    description TEXT,
    user_notes TEXT,
    practice_status TEXT CHECK (practice_status IN ('Want to Learn', 'Learning', 'Learned', 'Stalled', 'Dropped')),
    imslp_number TEXT,
    source_book_id INTEGER REFERENCES books(id),
    source_page_start INTEGER,
    source_page_end INTEGER,
    duration INTEGER,
    bpm INTEGER,
    measure_count INTEGER,
    beats_per_measure INTEGER,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    -- Deliberate pre-build exception (see CLAUDE.md > Database migrations):
    -- unused until the public-domain badge feature (design doc §13) lands.
    copyright_year INTEGER,
    public_domain INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pieces_source_book_id ON pieces(source_book_id);
CREATE INDEX idx_pieces_key_id ON pieces(key_id);
CREATE INDEX idx_pieces_sheet_type_id ON pieces(sheet_type_id);

-- +goose Down
DROP TABLE pieces;
