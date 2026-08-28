package handlers_test

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/handlers"
)

// newCleanupServer builds a *handlers.Server directly (not just the
// http.Handler newTestServerWithDataDir returns) — CleanupThumbnails is a
// maintenance action reached via a CLI subcommand (cmd/sonneck/main.go),
// not an HTTP route, so exercising it means calling the method directly,
// same construction main.go itself uses.
func newCleanupServer(t *testing.T) (*handlers.Server, http.Handler, string) {
	t.Helper()
	h, dataDir, conn := newTestServerWithDataDir(t)
	s := &handlers.Server{
		DB:     conn,
		Cfg:    &config.Config{DataDir: dataDir},
		Logger: slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})),
	}
	return s, h, dataDir
}

func thumbnailCachePath(dataDir, cacheKey string) string {
	return filepath.Join(dataDir, "cache", "thumbnails", cacheKey+".png")
}

func writeStaleCacheFile(t *testing.T, dataDir, cacheKey string) {
	t.Helper()
	path := thumbnailCachePath(dataDir, cacheKey)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("creating cache dir: %v", err)
	}
	// Content doesn't matter for the orphan/out-of-range cases below — these
	// entries get removed purely because no book/piece row owns them,
	// before isCorruptPNG ever runs on them.
	if err := os.WriteFile(path, []byte("not a real png"), 0o644); err != nil {
		t.Fatalf("writing stale cache file: %v", err)
	}
}

func assertCacheFileExists(t *testing.T, dataDir, cacheKey string, want bool) {
	t.Helper()
	_, err := os.Stat(thumbnailCachePath(dataDir, cacheKey))
	exists := err == nil
	if exists != want {
		t.Errorf("cache file %q exists = %v, want %v (err = %v)", cacheKey, exists, want, err)
	}
}

func TestCleanupThumbnails_RemovesOrphanedBookThumbnail(t *testing.T) {
	s, _, dataDir := newCleanupServer(t)
	writeStaleCacheFile(t, dataDir, "book-99999-page-1")

	result, err := s.CleanupThumbnails(context.Background())
	if err != nil {
		t.Fatalf("CleanupThumbnails: %v", err)
	}
	assertCacheFileExists(t, dataDir, "book-99999-page-1", false)
	if result.Removed != 1 {
		t.Errorf("Removed = %d, want 1", result.Removed)
	}
}

func TestCleanupThumbnails_RemovesOrphanedPieceThumbnail(t *testing.T) {
	s, _, dataDir := newCleanupServer(t)
	writeStaleCacheFile(t, dataDir, "piece-99999-page-1")

	result, err := s.CleanupThumbnails(context.Background())
	if err != nil {
		t.Fatalf("CleanupThumbnails: %v", err)
	}
	assertCacheFileExists(t, dataDir, "piece-99999-page-1", false)
	if result.Removed != 1 {
		t.Errorf("Removed = %d, want 1", result.Removed)
	}
}

// TestCleanupThumbnails_PreservesThumbnailsForBookNotYetImported covers the
// "still mid-wizard" case — a book with zero pieces yet must keep every
// page thumbnail, not just page 1, since the About/Split/Titles screens
// render arbitrary pages directly and there's no way to tell "still being
// split right now" apart from "abandoned" without more signal than this
// action has.
func TestCleanupThumbnails_PreservesThumbnailsForBookNotYetImported(t *testing.T) {
	s, h, dataDir := newCleanupServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 3)

	for _, page := range []int{1, 2, 3} {
		rec := doJSON(t, h, http.MethodGet, apiBooksURL(bookID)+"/pages/"+itoa(int64(page))+"/thumbnail", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET page %d thumbnail: status %d", page, rec.Code)
		}
	}

	result, err := s.CleanupThumbnails(context.Background())
	if err != nil {
		t.Fatalf("CleanupThumbnails: %v", err)
	}
	for _, page := range []int{1, 2, 3} {
		assertCacheFileExists(t, dataDir, "book-"+itoa(bookID)+"-page-"+itoa(int64(page)), true)
	}
	if result.Removed != 0 {
		t.Errorf("Removed = %d, want 0 (book has no pieces yet)", result.Removed)
	}
}

// TestCleanupThumbnails_RemovesStaleBookPagesAfterImport is the exact
// scenario this action exists for: a book imported before
// purgeStaleBookThumbnailsAfterImport existed (or simply imported by any
// means) still has all its page thumbnails cached — pages 2+ are dead
// weight the moment it has ≥1 piece; page 1 survives (no custom cover, so
// handleGetBookCover's fallback still needs it).
func TestCleanupThumbnails_RemovesStaleBookPagesAfterImport(t *testing.T) {
	s, h, dataDir := newCleanupServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 3)

	for _, page := range []int{1, 2, 3} {
		rec := doJSON(t, h, http.MethodGet, apiBooksURL(bookID)+"/pages/"+itoa(int64(page))+"/thumbnail", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET page %d thumbnail: status %d", page, rec.Code)
		}
	}

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 3}},
		"pieces": []map[string]any{{"title": "Whole Thing", "composer": "Someone"}},
	})
	decodeData(t, confirmRec, new(any))

	// handleConfirmImport's own purgeStaleBookThumbnailsAfterImport call
	// already removed pages 2-3 at this point — recreate them directly to
	// prove *this* action's own logic does the same thing, independent of
	// that one (this is what makes it useful for a library that already
	// existed before that fix landed).
	writeStaleCacheFile(t, dataDir, "book-"+itoa(bookID)+"-page-2")
	writeStaleCacheFile(t, dataDir, "book-"+itoa(bookID)+"-page-3")

	result, err := s.CleanupThumbnails(context.Background())
	if err != nil {
		t.Fatalf("CleanupThumbnails: %v", err)
	}
	assertCacheFileExists(t, dataDir, "book-"+itoa(bookID)+"-page-1", true)
	assertCacheFileExists(t, dataDir, "book-"+itoa(bookID)+"-page-2", false)
	assertCacheFileExists(t, dataDir, "book-"+itoa(bookID)+"-page-3", false)
	if result.Removed != 2 {
		t.Errorf("Removed = %d, want 2", result.Removed)
	}
}

// TestCleanupThumbnails_RemovesPageOneWhenBookHasCustomCover covers the
// refinement beyond purgeStaleBookThumbnailsAfterImport's own simpler
// "always spare page 1" rule (chosen there for per-request simplicity,
// CLAUDE.md > File handling) — a deliberate whole-library sweep can afford
// to check the real condition: once a custom cover exists,
// handleGetBookCover never falls back to page 1 at all, so it's dead
// weight too.
func TestCleanupThumbnails_RemovesPageOneWhenBookHasCustomCover(t *testing.T) {
	s, h, dataDir := newCleanupServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 1)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 1}},
		"pieces": []map[string]any{{"title": "Only Piece", "composer": "Someone"}},
	})
	decodeData(t, confirmRec, new(any))
	writeStaleCacheFile(t, dataDir, "book-"+itoa(bookID)+"-page-1")

	dir := t.TempDir()
	coverPath := dir + "/cover.png"
	writeFixturePNG(t, coverPath, [3]byte{10, 20, 30})
	uploadRec := recordRequest(h, multipartUpload(t, apiBooksURL(bookID)+"/cover", "cover.png", readAll(t, coverPath)))
	if uploadRec.Code != http.StatusOK {
		t.Fatalf("upload cover: status %d, body %s", uploadRec.Code, uploadRec.Body.String())
	}

	result, err := s.CleanupThumbnails(context.Background())
	if err != nil {
		t.Fatalf("CleanupThumbnails: %v", err)
	}
	assertCacheFileExists(t, dataDir, "book-"+itoa(bookID)+"-page-1", false)
	if result.Removed != 1 {
		t.Errorf("Removed = %d, want 1", result.Removed)
	}
}

// TestCleanupThumbnails_RemovesPieceThumbnailBeyondPageCount covers a
// piece's own leftover thumbnail (e.g. from before a file replacement,
// design doc §14, shrank its page count) — the piece row still exists, so
// this can't be caught by the plain "does the owner exist" orphan check
// above.
func TestCleanupThumbnails_RemovesPieceThumbnailBeyondPageCount(t *testing.T) {
	s, h, dataDir := newCleanupServer(t)
	piece := createTestPiece(t, h, map[string]any{"title": "One Page"})

	validRec := doJSON(t, h, http.MethodGet, apiPiecesURL(piece.ID)+"/pages/1/thumbnail", nil)
	if validRec.Code != http.StatusOK {
		t.Fatalf("GET page 1 thumbnail: status %d", validRec.Code)
	}
	writeStaleCacheFile(t, dataDir, "piece-"+itoa(piece.ID)+"-page-5")

	result, err := s.CleanupThumbnails(context.Background())
	if err != nil {
		t.Fatalf("CleanupThumbnails: %v", err)
	}
	assertCacheFileExists(t, dataDir, "piece-"+itoa(piece.ID)+"-page-1", true)
	assertCacheFileExists(t, dataDir, "piece-"+itoa(piece.ID)+"-page-5", false)
	if result.Removed != 1 {
		t.Errorf("Removed = %d, want 1", result.Removed)
	}
}

// TestCleanupThumbnails_RegeneratesCorruptPieceThumbnail covers the other
// half of this action's job — a still-legitimately-cached entry that's
// been corrupted (the torn/truncated-PNG failure mode CLAUDE.md > Search
// documents for RegenerateThumbnails) gets re-rendered in place, not
// removed.
func TestCleanupThumbnails_RegeneratesCorruptPieceThumbnail(t *testing.T) {
	s, h, dataDir := newCleanupServer(t)
	piece := createTestPiece(t, h, map[string]any{"title": "One Page"})

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(piece.ID)+"/pages/1/thumbnail", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET page 1 thumbnail: status %d", rec.Code)
	}
	cacheKey := "piece-" + itoa(piece.ID) + "-page-1"
	if err := os.WriteFile(thumbnailCachePath(dataDir, cacheKey), []byte("corrupted, not a real png"), 0o644); err != nil {
		t.Fatalf("corrupting cache file: %v", err)
	}

	result, err := s.CleanupThumbnails(context.Background())
	if err != nil {
		t.Fatalf("CleanupThumbnails: %v", err)
	}
	assertCacheFileExists(t, dataDir, cacheKey, true)
	if result.Regenerated != 1 {
		t.Errorf("Regenerated = %d, want 1", result.Regenerated)
	}
	if result.Removed != 0 {
		t.Errorf("Removed = %d, want 0", result.Removed)
	}

	// The regenerated file must be a real, valid PNG now, not just present.
	rec2 := doJSON(t, h, http.MethodGet, apiPiecesURL(piece.ID)+"/pages/1/thumbnail", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET page 1 thumbnail after regeneration: status %d", rec2.Code)
	}
}

// TestCleanupThumbnails_LeavesUnrecognizedFilesAlone confirms this action
// stays conservative about anything that doesn't match its two known
// cache-key patterns — e.g. a stray leftover from an interrupted render —
// rather than guessing at what else might be safe to delete.
func TestCleanupThumbnails_LeavesUnrecognizedFilesAlone(t *testing.T) {
	s, _, dataDir := newCleanupServer(t)
	cacheDir := filepath.Join(dataDir, "cache", "thumbnails")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("creating cache dir: %v", err)
	}
	strayPath := filepath.Join(cacheDir, "book-12-page-3-1234.tmp")
	if err := os.WriteFile(strayPath, []byte("leftover"), 0o644); err != nil {
		t.Fatalf("writing stray file: %v", err)
	}

	result, err := s.CleanupThumbnails(context.Background())
	if err != nil {
		t.Fatalf("CleanupThumbnails: %v", err)
	}
	if _, err := os.Stat(strayPath); err != nil {
		t.Errorf("stray unrecognized file was removed (err = %v), want it left alone", err)
	}
	if result.Removed != 0 || result.Regenerated != 0 {
		t.Errorf("result = %+v, want no action taken on an unrecognized filename", result)
	}
}
