// Package repo is the data access layer: one function set per entity, plus
// the two helpers CLAUDE.md calls out as needing a single shared
// implementation used everywhere — ResolveEffective (book-inheritance
// fallback) and ResyncSearchIndex (pieces_fts sync).
package repo

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// TimestampLayout is the one format timestamps are stored in: SQLite's own
// ("YYYY-MM-DD HH:MM:SS", what CURRENT_TIMESTAMP writes), always UTC, so
// they compare and sort correctly as text, against each other and against
// CURRENT_TIMESTAMP (migration 00042). A time.Time passed straight to the
// driver would be written as Go's own text instead ("… +0000 UTC", in
// whatever zone it carries), so a Go time goes through Timestamp first.
const TimestampLayout = "2006-01-02 15:04:05"

// Timestamp is t in UTC, as TimestampLayout text, for writing to a
// timestamp column.
func Timestamp(t time.Time) string { return t.UTC().Format(TimestampLayout) }

// ErrNotFound is returned by Get-style functions when no row matches.
var ErrNotFound = errors.New("not found")

// Queryer is satisfied by both *sql.DB and *sql.Tx, so every repo function
// works identically whether called standalone or as part of a caller's
// transaction (e.g. the import wizard's confirm step, or a piece mutation
// that must resync the search index in the same transaction as the write).
type Queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}
