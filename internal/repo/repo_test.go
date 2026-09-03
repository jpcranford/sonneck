package repo_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/db"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func strPtr(s string) *string { return &s }

func intPtr(i int) *int { return &i }
