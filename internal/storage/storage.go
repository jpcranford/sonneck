// Package storage handles the on-disk side of file handling (CLAUDE.md >
// File handling): streamed SHA-256 hashing on upload, and the
// content-addressed /data/library/{books,pieces} layout (design doc §4).
package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// SaveStreamed writes src to a temp file inside dir while hashing it
// incrementally via the standard hash.Hash interface — never buffering a
// full upload into memory (CLAUDE.md > File handling), regardless of file
// size. The caller doesn't know the final hash-based filename until the
// stream is fully read, so this returns a temp path for the caller to
// either move into place (MoveIntoPlace) or discard (e.g. on a dedupe hit).
func SaveStreamed(dir string, src io.Reader) (tempPath, hash string, size int64, err error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", 0, err
	}

	tmp, err := os.CreateTemp(dir, "upload-*.tmp")
	if err != nil {
		return "", "", 0, err
	}
	defer tmp.Close()

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(tmp, hasher), src)
	if err != nil {
		os.Remove(tmp.Name())
		return "", "", 0, err
	}

	return tmp.Name(), hex.EncodeToString(hasher.Sum(nil)), written, nil
}

// HashFile computes the SHA-256 hash of an already-written file — used for
// files produced locally (e.g. a piece PDF extracted by pdftocairo during
// the import wizard's confirm step) rather than streamed in from an
// upload, where SaveStreamed applies instead.
func HashFile(path string) (hash string, size int64, err error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	hasher := sha256.New()
	written, err := io.Copy(hasher, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hasher.Sum(nil)), written, nil
}

// BookPath returns the permanent path for a Book's original upload
// (design doc §4: library/books/<sha256-hash>.pdf).
func BookPath(dataDir, hash string) string {
	return filepath.Join(dataDir, "library", "books", hash+".pdf")
}

// PiecePath returns the permanent path for a Piece's extracted file
// (design doc §4: library/pieces/<sha256-hash>.pdf).
func PiecePath(dataDir, hash string) string {
	return filepath.Join(dataDir, "library", "pieces", hash+".pdf")
}

// CoverImagePath returns the permanent path for a Book's custom cover image
// (migration 00018: library/covers/<sha256-hash>). No extension, unlike
// Book/PiecePath — a cover image's format varies (PNG/JPEG/GIF) and is
// never served as a raw static file (always through handleGetBookCover,
// which sets Content-Type from the book's own stored coverImageContentType
// column), so there's nothing an extension would need to communicate here.
func CoverImagePath(dataDir, hash string) string {
	return filepath.Join(dataDir, "library", "covers", hash)
}

// MoveIntoPlace renames tempPath to finalPath, creating parent directories
// as needed. Storage is content-addressed by hash, so if finalPath already
// exists, its content is already identical by construction — the temp file
// is simply discarded rather than overwriting it. This is what makes the
// Book upload dedupe rule (CLAUDE.md > File handling) a natural consequence
// of the storage layout rather than special-cased logic.
func MoveIntoPlace(tempPath, finalPath string) error {
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return err
	}

	if _, err := os.Stat(finalPath); err == nil {
		return os.Remove(tempPath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	return os.Rename(tempPath, finalPath)
}
