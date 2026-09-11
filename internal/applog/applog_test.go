package applog_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jpcranford/sonneck/internal/applog"
)

func TestRotatingWriter_WritesToTodaysFile(t *testing.T) {
	dir := t.TempDir()
	w, err := applog.NewRotatingWriter(dir)
	if err != nil {
		t.Fatalf("NewRotatingWriter: %v", err)
	}
	defer w.Close()

	if _, err := w.Write([]byte("hello\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	wantPath := filepath.Join(dir, "sonneck-"+time.Now().Format("2006-01-02")+".log")
	data, err := os.ReadFile(wantPath)
	if err != nil {
		t.Fatalf("reading %s: %v", wantPath, err)
	}
	if string(data) != "hello\n" {
		t.Errorf("file content = %q, want %q", string(data), "hello\n")
	}
}

func TestRotatingWriter_AppendsAcrossMultipleWrites(t *testing.T) {
	dir := t.TempDir()
	w, err := applog.NewRotatingWriter(dir)
	if err != nil {
		t.Fatalf("NewRotatingWriter: %v", err)
	}
	defer w.Close()

	w.Write([]byte("first\n"))
	w.Write([]byte("second\n"))

	wantPath := filepath.Join(dir, "sonneck-"+time.Now().Format("2006-01-02")+".log")
	data, err := os.ReadFile(wantPath)
	if err != nil {
		t.Fatalf("reading %s: %v", wantPath, err)
	}
	if string(data) != "first\nsecond\n" {
		t.Errorf("file content = %q, want %q", string(data), "first\nsecond\n")
	}
}

func TestPrune_DeletesOnlyExpiredLogs(t *testing.T) {
	dir := t.TempDir()

	recent := filepath.Join(dir, "sonneck-2026-08-14.log")
	old := filepath.Join(dir, "sonneck-2026-01-01.log")
	for _, p := range []string{recent, old} {
		if err := os.WriteFile(p, []byte("not a real log, just testing file lifecycle"), 0o644); err != nil {
			t.Fatalf("seeding log file %s: %v", p, err)
		}
	}

	now := time.Now()
	if err := os.Chtimes(recent, now, now.Add(-1*24*time.Hour)); err != nil {
		t.Fatalf("setting mtime on recent log: %v", err)
	}
	if err := os.Chtimes(old, now, now.Add(-40*24*time.Hour)); err != nil {
		t.Fatalf("setting mtime on old log: %v", err)
	}

	if err := applog.Prune(dir, 30); err != nil {
		t.Fatalf("Prune: %v", err)
	}

	if _, err := os.Stat(recent); err != nil {
		t.Errorf("recent log was removed, want it kept: %v", err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("old log still exists, want it pruned")
	}
}

func TestPrune_MissingDirectoryIsNotAnError(t *testing.T) {
	if err := applog.Prune(filepath.Join(t.TempDir(), "never-created"), 30); err != nil {
		t.Errorf("Prune on a nonexistent directory = %v, want nil", err)
	}
}
