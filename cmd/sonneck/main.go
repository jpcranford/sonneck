package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/jpcranford/sonneck/internal/backup"
	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/export"
	"github.com/jpcranford/sonneck/internal/handlers"
	"github.com/jpcranford/sonneck/internal/peoplemigrate"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/webui"
)

func main() {
	// Bootstrap logger at the default level — LOG_LEVEL itself hasn't been
	// validated yet, so this is only used to report a config.Load failure
	// (including a bad LOG_LEVEL). Once config loads successfully, it's
	// replaced below with one at the configured level.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	logger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.SlogLevel()}))
	slog.SetDefault(logger)

	dbPath := filepath.Join(cfg.DataDir, "db", "sonneck.sqlite")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		logger.Error("failed to create database directory", "error", err, "path", filepath.Dir(dbPath))
		os.Exit(1)
	}

	conn, err := db.Open(dbPath)
	if err != nil {
		logger.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer conn.Close()

	// CLI subcommands (CLAUDE.md > Search's general pattern for admin/
	// maintenance actions before real auth exists): a subcommand on this
	// same binary, gated by shell/docker exec access rather than an
	// unauthenticated HTTP endpoint. Reuses the exact config/DB bootstrap
	// above rather than duplicating it, per that same section.
	if len(os.Args) > 1 {
		runSubcommand(os.Args[1], conn, cfg, logger)
		return
	}

	// Backfills the composer/arranger overhaul's Person/join-table schema
	// (migration 00020) from any Piece/Book still carrying only the old
	// composer/arranger TEXT columns — runs on every normal startup, not
	// just via the `migrate-people` CLI subcommand (which stays available
	// below as a manual fallback), so a user upgrading past this point
	// never has to know the subcommand exists. Safe to run unconditionally:
	// peoplemigrate.Run is purely additive (never touches the old TEXT
	// columns, which this migration deliberately never drops — see that
	// migration's own comment) and idempotent (skips any piece/book that
	// already has a credit), so an already-migrated library just costs two
	// cheap SELECTs. Best-effort/non-fatal — a failure here leaves the old
	// TEXT data untouched and the app fully usable, so it's logged rather
	// than treated as a startup-blocking error the way a real migration
	// failure is.
	if result, err := peoplemigrate.Run(context.Background(), conn); err != nil {
		logger.Error("people migration failed", "error", err)
	} else if result.PiecesMigrated > 0 || result.BooksMigrated > 0 {
		logger.Info("people migration completed",
			"piecesMigrated", result.PiecesMigrated, "piecesSkipped", result.PiecesSkipped,
			"booksMigrated", result.BooksMigrated, "booksSkipped", result.BooksSkipped)
	}

	// Same auto-heal posture as the people migration just above, for a real
	// and previously-unaddressed gap: a goose migration that changes
	// pieces_fts's own column list (e.g. migration 00021, adding
	// book_title) has to DROP and recreate the virtual table — FTS5 tables
	// can't be ALTERed on this project's pinned driver (that migration's
	// own comment) — which destroys every existing row. Nothing else in
	// this app's write paths ever repopulates a piece's row except a real
	// mutation to that specific piece, so without this, search silently
	// returns nothing for the *entire* existing library (not just the new
	// column) the moment such a migration runs, until someone happens to
	// know to run the `rebuild-search-index` CLI subcommand by hand.
	// Confirmed happening for real, not just in theory — reproduced live
	// against a real dev database that had just been upgraded past
	// migration 00021: search for a query matching an existing piece's own
	// title returned zero results, even though the piece was still fully
	// present in the library. SearchIndexNeedsRebuild is a cheap two-COUNT
	// check (same "one query, run on every boot" cost as peoplemigrate.
	// Pending), so a healthy library pays almost nothing here; only a
	// genuinely out-of-sync index triggers the full rebuild. Best-effort/
	// non-fatal, same reasoning as the people migration above — a failed
	// rebuild leaves search broken but the app otherwise fully usable, not
	// worth blocking startup over. The manual `rebuild-search-index` CLI
	// subcommand stays too, as a fallback.
	if needsRebuild, err := repo.SearchIndexNeedsRebuild(context.Background(), conn); err != nil {
		logger.Error("search index rebuild check failed", "error", err)
	} else if needsRebuild {
		if err := repo.RebuildSearchIndex(context.Background(), conn); err != nil {
			logger.Error("automatic search index rebuild failed", "error", err)
		} else {
			logger.Info("automatic search index rebuild completed")
		}
	}

	scheduler, err := backup.StartScheduler(cfg.BackupCron, conn, cfg.BackupDir, cfg.BackupRetentionDays, logger)
	if err != nil {
		logger.Error("failed to start backup scheduler", "error", err)
		os.Exit(1)
	}
	defer scheduler.Stop()

	frontend, err := webui.FS()
	if err != nil {
		logger.Error("failed to load embedded frontend", "error", err)
		os.Exit(1)
	}

	handler := handlers.New(conn, cfg, logger, frontend)

	logger.Info("starting server", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, handler); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func runSubcommand(name string, conn *sql.DB, cfg *config.Config, logger *slog.Logger) {
	switch name {
	case "rebuild-search-index":
		// Safe to run against a live server (WAL mode, CLAUDE.md >
		// Concurrency's one deliberate exception to single-writer).
		if err := repo.RebuildSearchIndex(context.Background(), conn); err != nil {
			logger.Error("search index rebuild failed", "error", err)
			os.Exit(1)
		}
		logger.Info("search index rebuild completed")
	case "regenerate-thumbnails":
		// Also safe against a live server, same WAL-mode reasoning — this
		// only touches data/cache/thumbnails, never the database, and every
		// write lands via an atomic rename (helpers.go's regenerateThumbnail)
		// so a concurrent live request for the same page never observes a
		// partial file.
		s := &handlers.Server{DB: conn, Cfg: cfg, Logger: logger}
		count, err := s.RegenerateThumbnails(context.Background())
		if err != nil {
			logger.Error("thumbnail regeneration failed", "error", err, "regenerated", count)
			os.Exit(1)
		}
		logger.Info("thumbnail regeneration completed", "count", count)
	case "cleanup-thumbnails":
		// Fourth instance of the CLI-subcommand admin pattern (CLAUDE.md >
		// Search). Also safe against a live server, same reasoning as
		// regenerate-thumbnails above — cache-directory writes only, atomic
		// renames throughout. Unlike regenerate-thumbnails' full wipe-and-
		// rebuild-every-piece-thumbnail, this only touches entries that are
		// actually orphaned/stale (removed) or actually corrupt
		// (regenerated) — the routine-maintenance option, not the nuclear
		// one.
		s := &handlers.Server{DB: conn, Cfg: cfg, Logger: logger}
		result, err := s.CleanupThumbnails(context.Background())
		if err != nil {
			logger.Error("thumbnail cleanup failed", "error", err, "removed", result.Removed, "regenerated", result.Regenerated)
			os.Exit(1)
		}
		logger.Info("thumbnail cleanup completed", "removed", result.Removed, "regenerated", result.Regenerated)
	case "migrate-people":
		// Fifth instance of the CLI-subcommand admin pattern (CLAUDE.md >
		// Search). Safe against a live server (WAL mode) — reads/writes go
		// through the same repo layer every real request already uses, no
		// raw connection tricks. Idempotent: safe to re-run. Kept as a
		// manual subcommand even though this same backfill now also runs
		// automatically on every normal server startup (main, above) — a
		// deliberate fallback for re-running it by hand (e.g. against a
		// different DATA_DIR, or to retry after a failed automatic run
		// without restarting the server).
		result, err := peoplemigrate.Run(context.Background(), conn)
		if err != nil {
			logger.Error("people migration failed", "error", err)
			os.Exit(1)
		}
		logger.Info("people migration completed",
			"piecesMigrated", result.PiecesMigrated, "piecesSkipped", result.PiecesSkipped,
			"booksMigrated", result.BooksMigrated, "booksSkipped", result.BooksSkipped)
	case "export-csv":
		// Third instance of the CLI-subcommand admin pattern (CLAUDE.md >
		// Search). Also safe against a live server — WAL mode lets these
		// SELECTs run alongside real writes, and this only ever reads.
		exportDir := filepath.Join(cfg.DataDir, "export")
		path, err := export.RunCSV(context.Background(), conn, exportDir)
		if err != nil {
			logger.Error("CSV export failed", "error", err)
			os.Exit(1)
		}
		logger.Info("CSV export completed", "path", path)
	default:
		logger.Error("unknown subcommand", "subcommand", name)
		os.Exit(1)
	}
}
