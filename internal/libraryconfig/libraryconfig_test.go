package libraryconfig_test

import (
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/libraryconfig"
)

func TestLoad_MissingFileReturnsZeroValue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yml")
	s, err := libraryconfig.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if *s != (libraryconfig.Settings{}) {
		t.Errorf("Load on a missing file = %+v, want zero value", *s)
	}
}

func TestSaveThenLoad_RoundTrips(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yml")
	want := &libraryconfig.Settings{
		BackupCron:          "0 4 * * *",
		BackupRetentionDays: 14,
		LogLevel:            "debug",
		CopyrightRegion:     "en-GB",
	}
	if err := libraryconfig.Save(path, want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := libraryconfig.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if *got != *want {
		t.Errorf("Load after Save = %+v, want %+v", *got, *want)
	}
}

func TestSave_OverwritesExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yml")
	if err := libraryconfig.Save(path, &libraryconfig.Settings{LogLevel: "info"}); err != nil {
		t.Fatalf("first Save: %v", err)
	}
	if err := libraryconfig.Save(path, &libraryconfig.Settings{LogLevel: "warn"}); err != nil {
		t.Fatalf("second Save: %v", err)
	}
	got, err := libraryconfig.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.LogLevel != "warn" {
		t.Errorf("LogLevel = %q, want %q", got.LogLevel, "warn")
	}
}
