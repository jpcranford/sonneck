package api_test

import (
	"context"
	"testing"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// TestBuildSetlistResponse_DisplayNumberSkipsNonCountingCustomEntries is
// decision 8's own "#" column rule end to end: a piece entry always
// counts (automatic), a custom entry only when its own toggle is on, and
// the running counter must skip — not just blank, genuinely skip — every
// non-counting entry rather than leaving a gap in the sequence.
func TestBuildSetlistResponse_DisplayNumberSkipsNonCountingCustomEntries(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Sunday Service", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	p1, err := repo.CreatePiece(ctx, dbConn, &models.Piece{Title: "Prelude", FilePath: "/a.pdf", FileHash: "a"})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	p2, err := repo.CreatePiece(ctx, dbConn, &models.Piece{Title: "Postlude", FilePath: "/b.pdf", FileHash: "b"})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	// piece(1), custom-not-counting, custom-counting, piece(2) — expect
	// display numbers 1, nil, 2, 3.
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1}); err != nil {
		t.Fatalf("AddSetlistEntry p1: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{CustomName: strPtr("Announcements")}); err != nil {
		t.Fatalf("AddSetlistEntry announcements: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{
		CustomName: strPtr("Congregational Response"), CustomCountsAsMusic: true,
	}); err != nil {
		t.Fatalf("AddSetlistEntry congregational response: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p2}); err != nil {
		t.Fatalf("AddSetlistEntry p2: %v", err)
	}

	setlist, err := repo.GetSetlist(ctx, dbConn, 1, setlistID)
	if err != nil {
		t.Fatalf("GetSetlist: %v", err)
	}
	resp, err := api.BuildSetlistResponse(ctx, dbConn, setlist)
	if err != nil {
		t.Fatalf("BuildSetlistResponse: %v", err)
	}
	if len(resp.Entries) != 4 {
		t.Fatalf("got %d entries, want 4", len(resp.Entries))
	}
	want := []*int{intPtr(1), nil, intPtr(2), intPtr(3)}
	for i, w := range want {
		got := resp.Entries[i].DisplayNumber
		switch {
		case w == nil && got != nil:
			t.Errorf("entries[%d].DisplayNumber = %d, want nil", i, *got)
		case w != nil && got == nil:
			t.Errorf("entries[%d].DisplayNumber = nil, want %d", i, *w)
		case w != nil && got != nil && *w != *got:
			t.Errorf("entries[%d].DisplayNumber = %d, want %d", i, *got, *w)
		}
	}
}

// TestBuildSetlistResponse_TotalsSumDurationAndPages covers decision 20's
// own totals rule: total pages only ever sums piece entries (a custom
// entry has no pages), total duration sums whatever entries — piece or
// custom — actually have one set, and is nil (omitted) only when NOT ONE
// entry anywhere has a duration.
func TestBuildSetlistResponse_TotalsSumDurationAndPages(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	d1 := 180
	p1, err := repo.CreatePiece(ctx, dbConn, &models.Piece{Title: "Timed", FilePath: "/a.pdf", FileHash: "a", Duration: &d1, PageCount: 3})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	p2, err := repo.CreatePiece(ctx, dbConn, &models.Piece{Title: "Untimed", FilePath: "/b.pdf", FileHash: "b", PageCount: 2})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1}); err != nil {
		t.Fatalf("AddSetlistEntry p1: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p2}); err != nil {
		t.Fatalf("AddSetlistEntry p2: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{
		CustomName: strPtr("Offering"), CustomDurationSeconds: intPtr(60),
	}); err != nil {
		t.Fatalf("AddSetlistEntry custom: %v", err)
	}

	setlist, err := repo.GetSetlist(ctx, dbConn, 1, setlistID)
	if err != nil {
		t.Fatalf("GetSetlist: %v", err)
	}
	resp, err := api.BuildSetlistResponse(ctx, dbConn, setlist)
	if err != nil {
		t.Fatalf("BuildSetlistResponse: %v", err)
	}
	if resp.EntryCount != 3 {
		t.Errorf("EntryCount = %d, want 3", resp.EntryCount)
	}
	if resp.TotalPages != 5 {
		t.Errorf("TotalPages = %d, want 5 (3 + 2, the custom entry contributing nothing)", resp.TotalPages)
	}
	if resp.TotalDurationSeconds == nil || *resp.TotalDurationSeconds != 240 {
		t.Errorf("TotalDurationSeconds = %v, want 240 (180 + 60, the untimed piece contributing nothing)", resp.TotalDurationSeconds)
	}
}

// TestBuildSetlistResponse_TotalDurationOmittedWhenNoEntryHasOne is the
// other half of decision 20: when literally nothing in the program has a
// set duration, TotalDurationSeconds must be nil (omitted), never a
// misleading 0.
func TestBuildSetlistResponse_TotalDurationOmittedWhenNoEntryHasOne(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	p1, err := repo.CreatePiece(ctx, dbConn, &models.Piece{Title: "Untimed", FilePath: "/a.pdf", FileHash: "a"})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1}); err != nil {
		t.Fatalf("AddSetlistEntry: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{CustomName: strPtr("Announcements")}); err != nil {
		t.Fatalf("AddSetlistEntry custom: %v", err)
	}

	setlist, err := repo.GetSetlist(ctx, dbConn, 1, setlistID)
	if err != nil {
		t.Fatalf("GetSetlist: %v", err)
	}
	resp, err := api.BuildSetlistResponse(ctx, dbConn, setlist)
	if err != nil {
		t.Fatalf("BuildSetlistResponse: %v", err)
	}
	if resp.TotalDurationSeconds != nil {
		t.Errorf("TotalDurationSeconds = %d, want nil (no entry has one set)", *resp.TotalDurationSeconds)
	}
}

// TestBuildSetlistResponse_PieceEntryResolvesComposerThroughBookInheritance
// is CLAUDE.md > Book-level soft inheritance's own rule, applied to a
// setlist entry specifically: a piece with no composer of its own but a
// composer on its source Book must still show that composer here — going
// through repo.ResolveEffective, never a raw Piece column.
func TestBuildSetlistResponse_PieceEntryResolvesComposerThroughBookInheritance(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle: "Collected Works", FilePath: strPtr("/book.pdf"), FileHash: strPtr("book-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	bach, err := repo.FindOrCreatePerson(ctx, dbConn, "J.S. Bach")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetBookComposers(ctx, dbConn, bookID, []int64{bach}); err != nil {
		t.Fatalf("SetBookComposers: %v", err)
	}
	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title: "Prelude", SourceBookID: &bookID, FilePath: "/piece.pdf", FileHash: "piece-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &pieceID}); err != nil {
		t.Fatalf("AddSetlistEntry: %v", err)
	}

	setlist, err := repo.GetSetlist(ctx, dbConn, 1, setlistID)
	if err != nil {
		t.Fatalf("GetSetlist: %v", err)
	}
	resp, err := api.BuildSetlistResponse(ctx, dbConn, setlist)
	if err != nil {
		t.Fatalf("BuildSetlistResponse: %v", err)
	}
	if len(resp.Entries) != 1 || resp.Entries[0].Piece == nil {
		t.Fatalf("resp.Entries = %+v, want one resolved piece entry", resp.Entries)
	}
	composer := resp.Entries[0].Piece.Composer
	if len(composer) != 1 || composer[0].Name != "J.S. Bach" {
		t.Errorf("piece entry composer = %+v, want the book's own inherited J.S. Bach", composer)
	}
}

// TestBuildSetlistSummaryResponse_EffectiveArchivedReflectsPassedGigDate
// wires decision 3's own asymmetric rule through the real DB-backed
// builder (repo.Setlist.EffectiveArchived is already unit-tested in
// isolation, internal/repo/setlist_test.go) — confirms the summary
// response actually surfaces it correctly end to end.
func TestBuildSetlistSummaryResponse_EffectiveArchivedReflectsPassedGigDate(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Old Gig", strPtr("2020-01-01"), nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	setlist, err := repo.GetSetlist(ctx, dbConn, 1, setlistID)
	if err != nil {
		t.Fatalf("GetSetlist: %v", err)
	}
	resp, err := api.BuildSetlistSummaryResponse(ctx, dbConn, setlist)
	if err != nil {
		t.Fatalf("BuildSetlistSummaryResponse: %v", err)
	}
	if resp.Archived {
		t.Error("Archived (the explicit flag) should still be false — nothing set it")
	}
	if !resp.EffectiveArchived {
		t.Error("EffectiveArchived should be true — the gig date is long past")
	}
}
