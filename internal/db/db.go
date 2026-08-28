package db

import (
	"database/sql"
	"database/sql/driver"
	"embed"
	"fmt"

	"github.com/pressly/goose/v3"
	sqlite "modernc.org/sqlite"

	"github.com/jpcranford/sonneck/internal/fuzzy"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// init registers fuzzydist as a real SQLite scalar function, callable from
// any query issued through this package's "sqlite" driver — the
// pieces-search fuzzy-matching tier (CLAUDE.md > Search, internal/
// handlers/search.go) calls it as a plain WHERE/ORDER BY predicate against
// pieces_fts's own columns, no different from any built-in SQL function.
// modernc.org/sqlite's own doc comment on RegisterScalarFunction: "The new
// function will be available to all new connections opened after
// executing RegisterFunction" — hence an init() here, guaranteed by Go to
// run before any package's call to Open (or a direct sql.Open("sqlite",
// ...)) can possibly execute. Registered once for the whole process, not
// per-connection: this app opens exactly one connection anyway (CLAUDE.md
// > Concurrency), but even if that changes, a global scalar function
// registration is the correct behavior, not an accident of it.
//
// Deterministic: MinWordDistance has no side effects and always returns
// the same output for the same input — the semantically correct
// registration, independent of whether it measurably changes query
// planning (confirmed no meaningful difference either way before
// choosing this one, not assumed).
func init() {
	sqlite.RegisterDeterministicScalarFunction("fuzzydist", 2,
		func(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			text, _ := args[0].(string)
			query, _ := args[1].(string)
			return int64(fuzzy.MinWordDistance(text, query)), nil
		},
	)
}

// Open opens the SQLite database at path, applies WAL mode and foreign key enforcement (CLAUDE.md > Concurrency), and runs any pending goose migrations. v1 is single-user/single-session, so a single connection is intentional here — it also sidesteps SQLITE_BUSY entirely rather than relying on retries across a pool.
func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)",
		path,
	)

	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}
	conn.SetMaxOpenConns(1)

	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("connecting to database: %w", err)
	}

	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return nil, fmt.Errorf("setting goose dialect: %w", err)
	}
	if err := goose.Up(conn, "migrations"); err != nil {
		return nil, fmt.Errorf("running migrations: %w", err)
	}

	return conn, nil
}
