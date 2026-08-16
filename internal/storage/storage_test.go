package storage_test

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jpcranford/sonneck/internal/storage"
)

func TestSaveStreamed_HashesIncrementallyWithoutBufferingWhole(t *testing.T) {
	dir := t.TempDir()
	content := strings.Repeat("sheet music bytes ", 1000)

	tempPath, hash, size, err := storage.SaveStreamed(dir, strings.NewReader(content))
	if err != nil {
		t.Fatalf("SaveStreamed: %v", err)
	}
	defer os.Remove(tempPath)

	wantHash := sha256.Sum256([]byte(content))
	if hash != hex.EncodeToString(wantHash[:]) {
		t.Errorf("hash = %q, want %q", hash, hex.EncodeToString(wantHash[:]))
	}
	if size != int64(len(content)) {
		t.Errorf("size = %d, want %d", size, len(content))
	}

	got, err := os.ReadFile(tempPath)
	if err != nil {
		t.Fatalf("reading temp file: %v", err)
	}
	if string(got) != content {
		t.Errorf("temp file content did not match what was streamed in")
	}
}

func TestMoveIntoPlace_MovesToFinalPath(t *testing.T) {
	dir := t.TempDir()
	tempPath, _, _, err := storage.SaveStreamed(dir, strings.NewReader("hello"))
	if err != nil {
		t.Fatalf("SaveStreamed: %v", err)
	}

	finalPath := filepath.Join(dir, "nested", "final.pdf")
	if err := storage.MoveIntoPlace(tempPath, finalPath); err != nil {
		t.Fatalf("MoveIntoPlace: %v", err)
	}

	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Errorf("temp file still exists at %s after move", tempPath)
	}
	got, err := os.ReadFile(finalPath)
	if err != nil {
		t.Fatalf("reading final file: %v", err)
	}
	if string(got) != "hello" {
		t.Errorf("final file content = %q, want %q", got, "hello")
	}
}

func TestMoveIntoPlace_DiscardsTempOnDedupeHit(t *testing.T) {
	dir := t.TempDir()
	finalPath := filepath.Join(dir, "existing.pdf")
	if err := os.WriteFile(finalPath, []byte("original content"), 0o644); err != nil {
		t.Fatalf("seeding existing file: %v", err)
	}

	tempPath, _, _, err := storage.SaveStreamed(dir, strings.NewReader("identical upload"))
	if err != nil {
		t.Fatalf("SaveStreamed: %v", err)
	}

	if err := storage.MoveIntoPlace(tempPath, finalPath); err != nil {
		t.Fatalf("MoveIntoPlace: %v", err)
	}

	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Errorf("temp file still exists at %s, want it discarded", tempPath)
	}
	got, err := os.ReadFile(finalPath)
	if err != nil {
		t.Fatalf("reading final file: %v", err)
	}
	if string(got) != "original content" {
		t.Errorf("final file was overwritten; got %q, want the pre-existing content preserved", got)
	}
}

func TestBookAndPiecePaths_LiveUnderExpectedLibrarySubdirs(t *testing.T) {
	if got, want := storage.BookPath("/data", "abc123"), "/data/library/books/abc123.pdf"; got != want {
		t.Errorf("BookPath = %q, want %q", got, want)
	}
	if got, want := storage.PiecePath("/data", "def456"), "/data/library/pieces/def456.pdf"; got != want {
		t.Errorf("PiecePath = %q, want %q", got, want)
	}
}
