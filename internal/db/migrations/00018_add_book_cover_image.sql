-- +goose Up
-- Manual cover image upload (direct instruction, 2026-08-21): a Book can now
-- have a custom cover image that overrides the derived first-page-of-PDF
-- thumbnail (or the "No-File Cover" placeholder, for a book with no file at
-- all) — see internal/handlers/book.go's handleUploadBookCover/
-- handleGetBookCover/handleDeleteBookCover. Content-addressed on disk under
-- library/covers/<sha256-hash> (storage.CoverImagePath), same convention as
-- book/piece files — coverImageContentType is stored alongside the hash
-- since, unlike a book/piece PDF, the file has no fixed extension to imply
-- it (sniffed once at upload time via image.DecodeConfig, not re-sniffed on
-- every read).
ALTER TABLE books ADD COLUMN cover_image_hash TEXT;
ALTER TABLE books ADD COLUMN cover_image_content_type TEXT;

-- +goose Down
ALTER TABLE books DROP COLUMN cover_image_content_type;
ALTER TABLE books DROP COLUMN cover_image_hash;
