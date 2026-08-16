package backup_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jpcranford/sonneck/internal/backup"
	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func TestRun_ProducesIndependentConsistentSnapshot(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	conn, err := db.Open(filepath.Join(dir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening source database: %v", err)
	}
	defer conn.Close()

	if _, err := repo.CreatePiece(ctx, conn, &models.Piece{
		Title:    "Backed Up Piece",
		FilePath: "/data/library/pieces/x.pdf",
		FileHash: "x",
	}); err != nil {
		t.Fatalf("seeding piece: %v", err)
	}

	backupDir := filepath.Join(dir, "backups")
	path, err := backup.Run(ctx, conn, backupDir)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("backup file missing at %s: %v", path, err)
	}

	// Open the backup as a wholly separate connection — it must be a
	// complete, independently readable database, not a reference to the
	// source file.
	backupConn, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("opening backup file: %v", err)
	}
	defer backupConn.Close()

	var title string
	if err := backupConn.QueryRowContext(ctx, `SELECT title FROM pieces WHERE title = ?`, "Backed Up Piece").Scan(&title); err != nil {
		t.Fatalf("querying backup for seeded piece: %v", err)
	}
	if title != "Backed Up Piece" {
		t.Errorf("title in backup = %q, want %q", title, "Backed Up Piece")
	}
}

func TestRun_ReplacesSameDayBackupRatherThanErroring(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	conn, err := db.Open(filepath.Join(dir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening database: %v", err)
	}
	defer conn.Close()

	backupDir := filepath.Join(dir, "backups")
	if _, err := backup.Run(ctx, conn, backupDir); err != nil {
		t.Fatalf("first Run: %v", err)
	}
	if _, err := backup.Run(ctx, conn, backupDir); err != nil {
		t.Fatalf("second same-day Run: %v", err)
	}
}

func TestPrune_DeletesOnlyExpiredBackups(t *testing.T) {
	dir := t.TempDir()

	recent := filepath.Join(dir, "sonneck-2026-08-14.sqlite")
	old := filepath.Join(dir, "sonneck-2026-01-01.sqlite")
	for _, p := range []string{recent, old} {
		if err := os.WriteFile(p, []byte("not a real db, just testing file lifecycle"), 0o644); err != nil {
			t.Fatalf("seeding backup file %s: %v", p, err)
		}
	}

	now := time.Now()
	if err := os.Chtimes(recent, now, now.Add(-1*24*time.Hour)); err != nil {
		t.Fatalf("setting mtime on recent backup: %v", err)
	}
	if err := os.Chtimes(old, now, now.Add(-40*24*time.Hour)); err != nil {
		t.Fatalf("setting mtime on old backup: %v", err)
	}

	if err := backup.Prune(dir, 30); err != nil {
		t.Fatalf("Prune: %v", err)
	}

	if _, err := os.Stat(recent); err != nil {
		t.Errorf("recent backup was removed, want it kept: %v", err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("old backup still exists, want it pruned")
	}
}

func TestPrune_MissingDirectoryIsNotAnError(t *testing.T) {
	if err := backup.Prune(filepath.Join(t.TempDir(), "never-created"), 30); err != nil {
		t.Errorf("Prune on a nonexistent directory = %v, want nil", err)
	}
}
