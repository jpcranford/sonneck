package nativeconfig_test

import (
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/nativeconfig"
)

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
