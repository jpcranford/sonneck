-- +goose Up
-- Your tags on a book: each account's own private user_tags, like
-- piece_user_tags (no user_id column — a tag's owner is its user). Every
-- piece in the book carries them too, read-only on the piece, in addition
-- to its own tags.
CREATE TABLE book_user_tags (
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, tag_id)
);
CREATE INDEX idx_book_user_tags_tag ON book_user_tags(tag_id);

-- +goose Down
DROP TABLE book_user_tags;
