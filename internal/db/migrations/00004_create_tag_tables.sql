-- +goose Up
CREATE TABLE instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE user_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE piece_instruments (
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    PRIMARY KEY (piece_id, instrument_id)
);

CREATE TABLE piece_user_tags (
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (piece_id, tag_id)
);

CREATE TABLE book_instruments (
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, instrument_id)
);

-- +goose Down
DROP TABLE book_instruments;
DROP TABLE piece_user_tags;
DROP TABLE piece_instruments;
DROP TABLE user_tags;
DROP TABLE instruments;
