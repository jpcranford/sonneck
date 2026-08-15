package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/jpcranford/picarda/internal/backup"
	"github.com/jpcranford/picarda/internal/config"
	"github.com/jpcranford/picarda/internal/db"
	"github.com/jpcranford/picarda/internal/handlers"
	"github.com/jpcranford/picarda/internal/repo"
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

	dbPath := filepath.Join(cfg.DataDir, "db", "picarda.sqlite")
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
		runSubcommand(os.Args[1], conn, logger)
		return
	}

	scheduler, err := backup.StartScheduler(cfg.BackupCron, conn, cfg.BackupDir, cfg.BackupRetentionDays, logger)
	if err != nil {
		logger.Error("failed to start backup scheduler", "error", err)
		os.Exit(1)
	}
	defer scheduler.Stop()

	handler := handlers.New(conn, cfg, logger)

	logger.Info("starting server", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, handler); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func runSubcommand(name string, conn *sql.DB, logger *slog.Logger) {
	switch name {
	case "rebuild-search-index":
		// Safe to run against a live server (WAL mode, CLAUDE.md >
		// Concurrency's one deliberate exception to single-writer).
		if err := repo.RebuildSearchIndex(context.Background(), conn); err != nil {
			logger.Error("search index rebuild failed", "error", err)
			os.Exit(1)
		}
		logger.Info("search index rebuild completed")
	default:
		logger.Error("unknown subcommand", "subcommand", name)
		os.Exit(1)
	}
}
