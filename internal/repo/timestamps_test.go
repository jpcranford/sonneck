package repo_test

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// Timestamps written from Go are stored in the standard UTC layout
// (repo.TimestampLayout, migration 00042), whatever zone the time carries.
var standardTimestamp = regexp.MustCompile(`^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$`)

func TestTimestampsWrittenInStandardLayout(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	est := time.FixedZone("EST", -5*60*60)

	// A piece's edit time, given in a non-UTC zone.
	id, err := repo.CreatePiece(ctx, dbConn, &models.Piece{Title: "T", FilePath: "/t.pdf", FileHash: "t"})
	if err != nil {
		t.Fatal(err)
	}
	p, err := repo.GetPieceByID(ctx, dbConn, id)
	if err != nil {
		t.Fatal(err)
	}
	p.UpdatedAt = time.Date(2026, 11, 21, 19, 30, 0, 250_000_000, est)
	if err := repo.UpdatePiece(ctx, dbConn, p); err != nil {
		t.Fatal(err)
	}
	var raw string
	if err := dbConn.QueryRowContext(ctx, `SELECT updated_at || '' FROM pieces WHERE id = ?`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if raw != "2026-11-22 00:30:00" {
		t.Errorf("piece updated_at stored as %q, want 2026-11-22 00:30:00 (UTC)", raw)
	}

	// A session expiring half an hour from now, given in a zone behind UTC:
	// stored as UTC, it's still valid — as local text it read as hours ago.
	if err := repo.CreateSession(ctx, dbConn, "live", 1, time.Now().In(est).Add(30*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetSessionUserID(ctx, dbConn, "live"); err != nil {
		t.Errorf("a session with 30 minutes left: %v, want valid", err)
	}
	if err := dbConn.QueryRowContext(ctx, `SELECT expires_at || '' FROM sessions WHERE token = 'live'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if !standardTimestamp.MatchString(raw) {
		t.Errorf("session expires_at stored as %q, want the standard layout", raw)
	}
	if err := repo.CreateSession(ctx, dbConn, "gone", 1, time.Now().In(est).Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetSessionUserID(ctx, dbConn, "gone"); !errors.Is(err, repo.ErrNotFound) {
		t.Errorf("a session expired a minute ago: %v, want ErrNotFound", err)
	}
}
