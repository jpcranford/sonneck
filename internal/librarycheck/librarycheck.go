// Package librarycheck finds library files the database points to but that
// aren't on disk: a piece's or book's PDF, a book's custom cover, a
// person's portrait. Nothing in the app ever removes a file another row
// still uses, so a missing one means it was lost outside the app (moved or
// deleted by hand, or a copy of the library made without it) — and the
// only sign was errors when someone opened the item. The server runs this
// at startup and logs what it finds; the check-library command prints it.
package librarycheck

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"

	"github.com/jpcranford/sonneck/internal/storage"
)

// Missing is one file the library expects but can't find.
type Missing struct {
	Kind string // "piece", "book", "book cover" or "portrait"
	ID   int64
	Name string // the piece/book title or the person's name
	Path string
}

func (m Missing) String() string {
	return fmt.Sprintf("%s %d (%s): %s", m.Kind, m.ID, m.Name, m.Path)
}

// Check returns every expected library file that's missing, pieces first.
// A file that can't be checked for another reason (a permissions error, a
// network share gone away) is an error, not a missing file.
func Check(ctx context.Context, db *sql.DB, dataDir string) ([]Missing, error) {
	queries := []struct {
		kind, query string
		path        func(value string) string
	}{
		{"piece", `SELECT id, title, file_path FROM pieces ORDER BY id`, nil},
		{"book", `SELECT id, book_title, file_path FROM books WHERE file_path IS NOT NULL ORDER BY id`, nil},
		{"book cover", `SELECT id, book_title, cover_image_hash FROM books WHERE cover_image_hash IS NOT NULL ORDER BY id`,
			func(hash string) string { return storage.CoverImagePath(dataDir, hash) }},
		{"portrait", `SELECT id, name, portrait_image_hash FROM people WHERE portrait_image_hash IS NOT NULL ORDER BY id`,
			func(hash string) string { return storage.PortraitImagePath(dataDir, hash) }},
	}
	var missing []Missing
	for _, q := range queries {
		rows, err := db.QueryContext(ctx, q.query)
		if err != nil {
			return nil, fmt.Errorf("listing %ss: %w", q.kind, err)
		}
		for rows.Next() {
			var m Missing
			var value string
			if err := rows.Scan(&m.ID, &m.Name, &value); err != nil {
				rows.Close()
				return nil, err
			}
			m.Kind, m.Path = q.kind, value
			if q.path != nil {
				m.Path = q.path(value)
			}
			if _, err := os.Stat(m.Path); err != nil {
				if !errors.Is(err, fs.ErrNotExist) {
					rows.Close()
					return nil, fmt.Errorf("checking %s: %w", m.Path, err)
				}
				missing = append(missing, m)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return missing, nil
}

// Report runs Check and logs the outcome: a warning for each missing file
// and a count, nothing when every file is there, or an error if the check
// itself couldn't run. Returns how many are missing (-1 when it failed).
func Report(ctx context.Context, db *sql.DB, dataDir string, logger *slog.Logger) int {
	missing, err := Check(ctx, db, dataDir)
	if err != nil {
		logger.Error("library file check failed", "error", err)
		return -1
	}
	for _, m := range missing {
		logger.Warn("library file missing", "kind", m.Kind, "id", m.ID, "name", m.Name, "path", m.Path)
	}
	if len(missing) > 0 {
		logger.Warn("library files missing: replace or delete these items in the app", "count", len(missing))
	}
	return len(missing)
}
