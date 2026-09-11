package nativeconfig_test

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/nativeconfig"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestLoad_MissingFileReturnsZeroValue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	s, err := nativeconfig.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if *s != (nativeconfig.Settings{}) {
		t.Errorf("Load on a missing file = %+v, want zero value", *s)
	}
}

func TestSaveThenLoad_RoundTrips(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	want := &nativeconfig.Settings{
		LibraryPath:    "/Users/jamie/Music/Sonneck Library",
		ShareOnNetwork: true,
	}
	if err := nativeconfig.Save(path, want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := nativeconfig.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if *got != *want {
		t.Errorf("Load after Save = %+v, want %+v", *got, *want)
	}
}

func TestSave_CreatesMissingParentDir(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Sonneck", "config.json")
	if err := nativeconfig.Save(path, &nativeconfig.Settings{ShareOnNetwork: true}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := nativeconfig.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !got.ShareOnNetwork {
		t.Errorf("ShareOnNetwork = false, want true")
	}
}

func TestSave_OverwritesExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := nativeconfig.Save(path, &nativeconfig.Settings{ShareOnNetwork: false}); err != nil {
		t.Fatalf("first Save: %v", err)
	}
	if err := nativeconfig.Save(path, &nativeconfig.Settings{ShareOnNetwork: true}); err != nil {
		t.Fatalf("second Save: %v", err)
	}
	got, err := nativeconfig.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !got.ShareOnNetwork {
		t.Errorf("ShareOnNetwork = false, want true")
	}
}

func TestApplyPendingLibraryMove_NoOpWhenNothingPending(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	s := &nativeconfig.Settings{LibraryPath: "/Users/jamie/Music/Sonneck Library"}
	got, err := nativeconfig.ApplyPendingLibraryMove(testLogger(), configPath, s)
	if err != nil {
		t.Fatalf("ApplyPendingLibraryMove: %v", err)
	}
	if *got != *s {
		t.Errorf("ApplyPendingLibraryMove with nothing pending = %+v, want unchanged %+v", *got, *s)
	}
}

func TestApplyPendingLibraryMove_PointOnly_NoMove(t *testing.T) {
	root := t.TempDir()
	oldPath := filepath.Join(root, "old")
	newPath := filepath.Join(root, "new")
	if err := os.MkdirAll(oldPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldPath, "sonneck.sqlite"), []byte("db"), 0o644); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, "config.json")

	s := &nativeconfig.Settings{LibraryPath: oldPath, PendingLibraryPath: newPath, PendingMoveExisting: false}
	got, err := nativeconfig.ApplyPendingLibraryMove(testLogger(), configPath, s)
	if err != nil {
		t.Fatalf("ApplyPendingLibraryMove: %v", err)
	}
	if got.LibraryPath != newPath || got.PendingLibraryPath != "" || got.PendingMoveExisting {
		t.Errorf("got %+v, want LibraryPath=%q and pending cleared", *got, newPath)
	}
	if _, err := os.Stat(filepath.Join(oldPath, "sonneck.sqlite")); err != nil {
		t.Errorf("point-only move should leave the old directory's contents untouched: %v", err)
	}
	if _, err := os.Stat(newPath); !os.IsNotExist(err) {
		t.Errorf("point-only move should not create the new directory itself; that's the rest of startup's job")
	}

	reloaded, err := nativeconfig.Load(configPath)
	if err != nil {
		t.Fatalf("Load after ApplyPendingLibraryMove: %v", err)
	}
	if *reloaded != *got {
		t.Errorf("ApplyPendingLibraryMove result wasn't actually persisted: got %+v, file has %+v", *got, *reloaded)
	}
}

func TestApplyPendingLibraryMove_MoveExisting_MovesFiles(t *testing.T) {
	root := t.TempDir()
	oldPath := filepath.Join(root, "old")
	newPath := filepath.Join(root, "nested", "new")
	if err := os.MkdirAll(filepath.Join(oldPath, "db"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldPath, "db", "sonneck.sqlite"), []byte("real data"), 0o644); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, "Sonneck", "config.json")

	s := &nativeconfig.Settings{LibraryPath: oldPath, PendingLibraryPath: newPath, PendingMoveExisting: true}
	got, err := nativeconfig.ApplyPendingLibraryMove(testLogger(), configPath, s)
	if err != nil {
		t.Fatalf("ApplyPendingLibraryMove: %v", err)
	}
	if got.LibraryPath != newPath || got.PendingLibraryPath != "" {
		t.Errorf("got %+v, want LibraryPath=%q and pending cleared", *got, newPath)
	}
	moved, err := os.ReadFile(filepath.Join(newPath, "db", "sonneck.sqlite"))
	if err != nil || string(moved) != "real data" {
		t.Errorf("moved file at %s = %q, %v; want %q, nil", newPath, moved, err, "real data")
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Errorf("old directory %s should be gone after a move, got err=%v", oldPath, err)
	}
}

func TestApplyPendingLibraryMove_MoveExisting_SourceNeverExisted_JustRepoints(t *testing.T) {
	root := t.TempDir()
	oldPath := filepath.Join(root, "never-used") // never created — a fresh install using the GOOS default
	newPath := filepath.Join(root, "new")
	configPath := filepath.Join(root, "config.json")

	s := &nativeconfig.Settings{PendingLibraryPath: newPath, PendingMoveExisting: true} // LibraryPath "" → falls back to config.DefaultDataDir(), not oldPath, but nothing there either way
	_ = oldPath
	got, err := nativeconfig.ApplyPendingLibraryMove(testLogger(), configPath, s)
	if err != nil {
		t.Fatalf("ApplyPendingLibraryMove: %v", err)
	}
	if got.LibraryPath != newPath || got.PendingLibraryPath != "" {
		t.Errorf("got %+v, want a clean repoint to %q", *got, newPath)
	}
}

func TestApplyPendingLibraryMove_DestinationAlreadyPopulated_FailsWithoutLosingData(t *testing.T) {
	root := t.TempDir()
	oldPath := filepath.Join(root, "old")
	newPath := filepath.Join(root, "new")
	if err := os.MkdirAll(oldPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldPath, "sonneck.sqlite"), []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(newPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(newPath, "unrelated.txt"), []byte("already here"), 0o644); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, "config.json")

	s := &nativeconfig.Settings{LibraryPath: oldPath, PendingLibraryPath: newPath, PendingMoveExisting: true}
	got, err := nativeconfig.ApplyPendingLibraryMove(testLogger(), configPath, s)
	if err == nil {
		t.Fatal("expected an error when the destination is already populated, got nil")
	}
	// Conservative failure: nothing about s changes — the app boots against
	// the old path next, data untouched, and the pending move survives to
	// be retried later.
	if *got != *s {
		t.Errorf("on failure, settings should be returned unchanged: got %+v, want %+v", *got, *s)
	}
	if original, err := os.ReadFile(filepath.Join(oldPath, "sonneck.sqlite")); err != nil || string(original) != "original" {
		t.Errorf("old data must survive a failed move: %q, %v", original, err)
	}
}

func TestApplyPendingLibraryMove_PendingMatchesCurrent_ClearsFlagOnly(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "lib")
	configPath := filepath.Join(root, "config.json")

	s := &nativeconfig.Settings{LibraryPath: path, PendingLibraryPath: path, PendingMoveExisting: true}
	got, err := nativeconfig.ApplyPendingLibraryMove(testLogger(), configPath, s)
	if err != nil {
		t.Fatalf("ApplyPendingLibraryMove: %v", err)
	}
	if got.LibraryPath != path || got.PendingLibraryPath != "" || got.PendingMoveExisting {
		t.Errorf("got %+v, want pending cleared with LibraryPath unchanged", *got)
	}
}

func TestDefaultPath_ReturnsSonneckSubdir(t *testing.T) {
	path, err := nativeconfig.DefaultPath()
	if err != nil {
		t.Fatalf("DefaultPath: %v", err)
	}
	if filepath.Base(path) != "config.json" {
		t.Errorf("DefaultPath = %q, want a config.json file", path)
	}
	if filepath.Base(filepath.Dir(path)) != "Sonneck" {
		t.Errorf("DefaultPath = %q, want it inside a Sonneck subdirectory", path)
	}
}
