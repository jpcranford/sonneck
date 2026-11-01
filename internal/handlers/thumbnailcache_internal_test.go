package handlers

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/pdf"
	"github.com/jpcranford/sonneck/internal/testutil"
)

func touchAt(t *testing.T, path string, when time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
}

// A render's temp file is removed once it's clearly abandoned; one that may
// still be in progress, and real thumbnails of any age, are left alone.
func TestRemoveAbandonedThumbnailTemps(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	old := now.Add(-time.Hour)
	touchAt(t, filepath.Join(dir, "piece-45-page-2-3440797618.png"), old)
	touchAt(t, filepath.Join(dir, "book-3-page-1-12345.png.shrink"), old)
	touchAt(t, filepath.Join(dir, "piece-7-page-1-99.png"), now.Add(-time.Minute))
	touchAt(t, filepath.Join(dir, "piece-45-page-2.png"), old)
	touchAt(t, filepath.Join(dir, "notes.txt"), old)

	removed, err := removeAbandonedThumbnailTemps(dir, now)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 {
		t.Errorf("removed %d, want 2", removed)
	}
	for name, want := range map[string]bool{
		"piece-45-page-2-3440797618.png": false,
		"book-3-page-1-12345.png.shrink": false,
		"piece-7-page-1-99.png":          true,
		"piece-45-page-2.png":            true,
		"notes.txt":                      true,
	} {
		_, err := os.Stat(filepath.Join(dir, name))
		if got := err == nil; got != want {
			t.Errorf("%s exists = %v, want %v", name, got, want)
		}
	}
}

// Thumbnails cached before the current format are cleared once, with the
// redraw stamp moved; after that the cache is left alone.
func TestPrepareThumbnailCache_ClearsOldFormatOnce(t *testing.T) {
	dataDir := t.TempDir()
	cacheDir := filepath.Join(dataDir, "cache", "thumbnails")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	touchAt(t, filepath.Join(cacheDir, "piece-1-page-1.png"), time.Now())
	s := &Server{Cfg: &config.Config{DataDir: dataDir}}

	s.prepareThumbnailCache()
	if _, err := os.Stat(filepath.Join(cacheDir, "piece-1-page-1.png")); !os.IsNotExist(err) {
		t.Errorf("old-format thumbnail not cleared: %v", err)
	}
	if got, _ := os.ReadFile(s.thumbnailFormatMarker()); string(got) != pdf.ThumbnailFormat+"\n" {
		t.Errorf("marker = %q", got)
	}
	if s.thumbnailsRedrawn() == "" {
		t.Error("redraw stamp not set, so browsers would keep their cached copies")
	}

	touchAt(t, filepath.Join(cacheDir, "piece-2-page-1.png"), time.Now())
	s.prepareThumbnailCache()
	if _, err := os.Stat(filepath.Join(cacheDir, "piece-2-page-1.png")); err != nil {
		t.Errorf("current-format thumbnail cleared on a later start: %v", err)
	}
}

// A thumbnail render finishes and caches even when the request that asked
// for it has gone (a browser drops image requests it no longer needs).
func TestCachedThumbnail_FinishesAfterRequestCancelled(t *testing.T) {
	dataDir := t.TempDir()
	src := filepath.Join(dataDir, "piece.pdf")
	testutil.WriteFixturePDF(t, src, 2)
	s := &Server{Cfg: &config.Config{DataDir: dataDir}}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	path, err := s.cachedThumbnail(ctx, src, 1, ThumbnailDPI, "piece-1-page-1")
	if err != nil {
		t.Fatalf("cachedThumbnail: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("thumbnail not cached: %v", err)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Errorf("cache holds %d files, want just the thumbnail", len(entries))
	}
}
