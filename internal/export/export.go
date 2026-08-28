// Package export implements the CSV database export CLI subcommand
// (CLAUDE.md > Search's general pattern for admin/maintenance actions
// before real auth exists — third instance of that pattern, after
// rebuild-search-index and regenerate-thumbnails): a full dump of every
// real data table, one CSV file per table, for an admin who wants their
// library data out of the app entirely. There's no other caller for this
// inside the app itself — it exists purely to hand the data back out.
package export

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// excludedTables are sqlite_master entries that aren't real user data:
// goose's own migration-tracking table and sqlite's internal autoincrement
// bookkeeping. FTS5 virtual tables (pieces_fts, pieces_fts_trigram —
// migration 00019) and their shadow tables are excluded separately, in
// listTables below, discovered from sqlite_master itself rather than
// hardcoded here by name. They're explicitly derived/rebuildable
// (CLAUDE.md > Search: "pieces_fts... is derived data, not a source of
// truth... can be safely dropped and rebuilt"), so including them would
// just be noise in an export meant to hand someone their actual library
// back — a hardcoded per-table list here would need a new entry (the base
// table plus 5 shadow suffixes) every time a future FTS5 table is added,
// exactly the kind of drift a real gap already caught once: adding
// pieces_fts_trigram silently slipped six new "tables" into the export
// before this was made dynamic.
var excludedTables = map[string]bool{
	"goose_db_version": true,
	"sqlite_sequence":  true,
}

// fts5ShadowSuffixes are the fixed set of internal tables SQLite creates
// alongside any FTS5 virtual table that stores its own content (no
// content='' external-content option) — confirmed directly against a real
// fts5 table via this project's actual pinned driver, not assumed from
// SQLite's docs alone.
var fts5ShadowSuffixes = []string{"_data", "_idx", "_content", "_docsize", "_config"}

// RunCSV writes one CSV file per real data table into a new timestamped
// subdirectory of exportDir, returning that subdirectory's path. Table and
// column lists are discovered from sqlite_master/rows.Columns rather than
// hardcoded, so a future migration's new table or column is picked up
// automatically instead of silently missing from the export.
func RunCSV(ctx context.Context, db *sql.DB, exportDir string) (string, error) {
	tables, err := listTables(ctx, db)
	if err != nil {
		return "", fmt.Errorf("listing tables: %w", err)
	}

	outDir := filepath.Join(exportDir, time.Now().UTC().Format("2006-01-02-150405"))
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return "", fmt.Errorf("creating export directory: %w", err)
	}

	for _, table := range tables {
		if err := exportTable(ctx, db, table, outDir); err != nil {
			return "", fmt.Errorf("exporting table %s: %w", table, err)
		}
	}

	return outDir, nil
}

func listTables(ctx context.Context, db *sql.DB) ([]string, error) {
	fts5Tables, err := fts5VirtualTableNames(ctx, db)
	if err != nil {
		return nil, err
	}
	excluded := make(map[string]bool, len(excludedTables)+len(fts5Tables)*(1+len(fts5ShadowSuffixes)))
	for name := range excludedTables {
		excluded[name] = true
	}
	for _, name := range fts5Tables {
		excluded[name] = true
		for _, suffix := range fts5ShadowSuffixes {
			excluded[name+suffix] = true
		}
	}

	rows, err := db.QueryContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		if excluded[name] {
			continue
		}
		tables = append(tables, name)
	}
	return tables, rows.Err()
}

// fts5VirtualTableNames finds every FTS5 virtual table by its own CREATE
// VIRTUAL TABLE ... USING fts5(...) statement in sqlite_master, rather
// than hardcoding table names — the same "discover, don't hardcode"
// principle this package's own doc comment already applies to real data
// tables/columns. Confirmed the exact stored `sql` text this LIKE pattern
// depends on directly against the real driver rather than assuming it.
func fts5VirtualTableNames(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT name FROM sqlite_master
		WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%USING fts5%'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

// exportTable writes table's full contents to <outDir>/<table>.csv. Table
// names only ever come from listTables (sqlite_master, not user input), so
// building the query with fmt.Sprintf here doesn't carry the injection risk
// it would if table were externally supplied.
func exportTable(ctx context.Context, db *sql.DB, table, outDir string) error {
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`SELECT * FROM "%s"`, table))
	if err != nil {
		return err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return err
	}

	f, err := os.Create(filepath.Join(outDir, table+".csv"))
	if err != nil {
		return err
	}
	defer f.Close()

	w := csv.NewWriter(f)
	if err := w.Write(columns); err != nil {
		return err
	}

	values := make([]any, len(columns))
	scanArgs := make([]any, len(columns))
	for i := range values {
		scanArgs[i] = &values[i]
	}

	record := make([]string, len(columns))
	for rows.Next() {
		if err := rows.Scan(scanArgs...); err != nil {
			return err
		}
		for i, v := range values {
			record[i] = formatValue(v)
		}
		if err := w.Write(record); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	w.Flush()
	return w.Error()
}

// formatValue renders one scanned column value as CSV text. NULL becomes
// an empty field — the standard CSV trade-off of being indistinguishable
// from an empty string; nothing in this schema depends on the distinction
// for a human reading the export. SQLite hands back TEXT columns as []byte
// through database/sql's generic scan path, so that case handles the
// overwhelming majority of values here.
func formatValue(v any) string {
	switch val := v.(type) {
	case nil:
		return ""
	case []byte:
		return string(val)
	case time.Time:
		return val.UTC().Format(time.RFC3339)
	default:
		return fmt.Sprintf("%v", val)
	}
}
