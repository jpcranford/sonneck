// Package repo is the data access layer: one function set per entity, plus
// the two helpers CLAUDE.md calls out as needing a single shared
// implementation used everywhere — ResolveEffective (book-inheritance
// fallback) and ResyncSearchIndex (pieces_fts sync).
package repo

import (
	"context"
	"database/sql"
	"errors"
)

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
