package repo_test

import (
	"context"
	"testing"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// createTestPiece is a minimal, valid Piece for setlist entry tests — the
// exact field values don't matter beyond being unique/non-empty, only
// that a real piece_id exists to reference.
func createTestPiece(t *testing.T, dbConn repo.Queryer, title string) int64 {
	t.Helper()
	id, err := repo.CreatePiece(context.Background(), dbConn, &models.Piece{
		Title:    title,
		FilePath: "/data/library/pieces/" + title + ".pdf",
		FileHash: title + "-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	return id
}

// createSecondUser fabricates a second account so ownership-scoping tests
// have someone other than the seeded id=1 to try (and fail) to reach
// another user's setlist through.
func createSecondUser(t *testing.T, dbConn repo.Queryer) int64 {
	t.Helper()
	res, err := dbConn.ExecContext(context.Background(), `INSERT INTO users (display_name) VALUES ('Second User')`)
	if err != nil {
		t.Fatalf("inserting second user: %v", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("LastInsertId: %v", err)
	}
	return id
}

func TestCreateGetListUpdateDeleteSetlist(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	id, err := repo.CreateSetlist(ctx, dbConn, 1, "Sunday Morning Service", strPtr("2026-12-25"), strPtr("A Christmas program."))
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}

	got, err := repo.GetSetlist(ctx, dbConn, 1, id)
	if err != nil {
		t.Fatalf("GetSetlist: %v", err)
	}
	if got.Name != "Sunday Morning Service" || got.GigDate == nil || *got.GigDate != "2026-12-25" || got.Archived {
		t.Errorf("GetSetlist returned unexpected row: %+v", got)
	}

	list, err := repo.ListSetlists(ctx, dbConn, 1)
	if err != nil {
		t.Fatalf("ListSetlists: %v", err)
	}
	if len(list) != 1 || list[0].ID != id {
		t.Errorf("ListSetlists = %+v, want one row with id %d", list, id)
	}

	if err := repo.UpdateSetlist(ctx, dbConn, 1, id, "Renamed Service", nil, nil, true); err != nil {
		t.Fatalf("UpdateSetlist: %v", err)
	}
	got, err = repo.GetSetlist(ctx, dbConn, 1, id)
	if err != nil {
		t.Fatalf("GetSetlist after update: %v", err)
	}
	if got.Name != "Renamed Service" || got.GigDate != nil || got.Description != nil || !got.Archived {
		t.Errorf("GetSetlist after update = %+v, want cleared gigDate/description, archived=true", got)
	}

	if err := repo.DeleteSetlist(ctx, dbConn, 1, id); err != nil {
		t.Fatalf("DeleteSetlist: %v", err)
	}
	if _, err := repo.GetSetlist(ctx, dbConn, 1, id); err != repo.ErrNotFound {
		t.Errorf("GetSetlist after delete = %v, want ErrNotFound", err)
	}
}

// TestSetlist_ScopedToOwner is the "silent data leak" case CLAUDE.md's own
// per-user-data-scoping convention exists to prevent: a setlist created by
// one user must be completely invisible (not 403, genuinely 404/ErrNotFound)
// to any other user, for every read AND write path.
func TestSetlist_ScopedToOwner(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	otherUser := createSecondUser(t, dbConn)

	id, err := repo.CreateSetlist(ctx, dbConn, 1, "User 1's Setlist", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}

	if _, err := repo.GetSetlist(ctx, dbConn, otherUser, id); err != repo.ErrNotFound {
		t.Errorf("GetSetlist as other user = %v, want ErrNotFound", err)
	}

	list, err := repo.ListSetlists(ctx, dbConn, otherUser)
	if err != nil {
		t.Fatalf("ListSetlists as other user: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("ListSetlists as other user = %+v, want empty", list)
	}

	if err := repo.UpdateSetlist(ctx, dbConn, otherUser, id, "Hijacked", nil, nil, false); err != repo.ErrNotFound {
		t.Errorf("UpdateSetlist as other user = %v, want ErrNotFound", err)
	}
	if err := repo.DeleteSetlist(ctx, dbConn, otherUser, id); err != repo.ErrNotFound {
		t.Errorf("DeleteSetlist as other user = %v, want ErrNotFound", err)
	}

	// The setlist must still exist, completely untouched, for its real owner.
	got, err := repo.GetSetlist(ctx, dbConn, 1, id)
	if err != nil {
		t.Fatalf("GetSetlist as real owner after failed hijack attempts: %v", err)
	}
	if got.Name != "User 1's Setlist" {
		t.Errorf("GetSetlist as real owner = %+v, want untouched original name", got)
	}
}

// TestSetlist_EffectiveArchived is decision 3's own asymmetric-resolution
// rule (one stored flag, corrected forward at read time, never written
// back) — a pure unit test against the struct method itself, no DB
// involved, since every case is a plain today-vs-gigDate comparison.
func TestSetlist_EffectiveArchived(t *testing.T) {
	const today = "2026-06-15"

	cases := []struct {
		name     string
		archived bool
		gigDate  *string
		want     bool
	}{
		{"explicitly archived, no gig date at all", true, nil, true},
		{"explicitly archived, gig date still upcoming", true, strPtr("2026-12-25"), true},
		{"not archived, no gig date at all", false, nil, false},
		{"not archived, gig date in the future", false, strPtr("2026-12-25"), false},
		{"not archived, gig date is today", false, strPtr(today), false},
		{"not archived, gig date already passed", false, strPtr("2026-01-01"), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := &repo.Setlist{Archived: c.archived, GigDate: c.gigDate}
			if got := s.EffectiveArchived(today); got != c.want {
				t.Errorf("EffectiveArchived(%q) = %v, want %v", today, got, c.want)
			}
		})
	}
}

// TestSetlistEntry_CountsAsMusic is decision 8's own automatic-numbering
// rule at its narrowest: a piece entry always counts (no choice), a
// custom entry only when its own toggle is on.
func TestSetlistEntry_CountsAsMusic(t *testing.T) {
	pieceID := int64(42)
	piece := &repo.SetlistEntry{PieceID: &pieceID, CustomCountsAsMusic: false}
	if !piece.CountsAsMusic() {
		t.Error("a piece entry must always count as music, regardless of CustomCountsAsMusic")
	}
	customOff := &repo.SetlistEntry{CustomName: strPtr("Announcements"), CustomCountsAsMusic: false}
	if customOff.CountsAsMusic() {
		t.Error("a custom entry with the toggle off must not count as music")
	}
	customOn := &repo.SetlistEntry{CustomName: strPtr("Congregational Response"), CustomCountsAsMusic: true}
	if !customOn.CountsAsMusic() {
		t.Error("a custom entry with the toggle on must count as music")
	}
}

// TestAddSetlistEntry_AssignsSequentialSortOrder is the "silent
// misordering" case CLAUDE.md holds the PDF-extraction logic to the same
// bar for — entries added one at a time (the mockup's own "+ Piece"/
// "+ Custom Entry" flow) must always land in the order they were added.
func TestAddSetlistEntry_AssignsSequentialSortOrder(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	p1 := createTestPiece(t, dbConn, "First Piece")
	p2 := createTestPiece(t, dbConn, "Second Piece")

	e1, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1})
	if err != nil {
		t.Fatalf("AddSetlistEntry 1: %v", err)
	}
	e2, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{CustomName: strPtr("Welcome & Announcements")})
	if err != nil {
		t.Fatalf("AddSetlistEntry 2: %v", err)
	}
	e3, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p2})
	if err != nil {
		t.Fatalf("AddSetlistEntry 3: %v", err)
	}

	entries, err := repo.ListSetlistEntries(ctx, dbConn, setlistID)
	if err != nil {
		t.Fatalf("ListSetlistEntries: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("ListSetlistEntries returned %d entries, want 3", len(entries))
	}
	wantOrder := []int64{e1, e2, e3}
	for i, e := range entries {
		if e.ID != wantOrder[i] {
			t.Errorf("entries[%d].ID = %d, want %d (program order broken)", i, e.ID, wantOrder[i])
		}
		if e.SortOrder != i {
			t.Errorf("entries[%d].SortOrder = %d, want %d", i, e.SortOrder, i)
		}
	}
}

// TestReorderSetlistEntries_RewritesSortOrderWithoutChangingIdentity
// covers the exact "silent data bug if wrong" risk the plan calls out for
// reorder math: dragging an entry to a new position must change its
// sort_order, never its own id (a frontend deep link — an in-progress
// "Edit Entry" — points at that id) or its own field values.
func TestReorderSetlistEntries_RewritesSortOrderWithoutChangingIdentity(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	p1 := createTestPiece(t, dbConn, "Alpha")
	p2 := createTestPiece(t, dbConn, "Beta")
	p3 := createTestPiece(t, dbConn, "Gamma")

	e1, _ := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1, Role: strPtr("Prelude")})
	e2, _ := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p2})
	e3, _ := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p3})

	// Drag the last entry (Gamma) to the front.
	if err := repo.ReorderSetlistEntries(ctx, dbConn, setlistID, []int64{e3, e1, e2}); err != nil {
		t.Fatalf("ReorderSetlistEntries: %v", err)
	}

	entries, err := repo.ListSetlistEntries(ctx, dbConn, setlistID)
	if err != nil {
		t.Fatalf("ListSetlistEntries: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("got %d entries, want 3", len(entries))
	}
	wantOrder := []int64{e3, e1, e2}
	for i, e := range entries {
		if e.ID != wantOrder[i] {
			t.Errorf("entries[%d].ID = %d, want %d after reorder", i, e.ID, wantOrder[i])
		}
		if e.SortOrder != i {
			t.Errorf("entries[%d].SortOrder = %d, want %d", i, e.SortOrder, i)
		}
	}
	// e1's own identity/fields (its Role, its id) must have survived the
	// reorder unchanged — only its position moved.
	if entries[1].ID != e1 || entries[1].Role == nil || *entries[1].Role != "Prelude" {
		t.Errorf("entry e1 lost its own identity/fields across a reorder: %+v", entries[1])
	}
}

// TestRemoveSetlistEntry_LeavesRemainingOrderIntact confirms a gap in
// sort_order after removing a middle entry doesn't corrupt the
// still-relative ordering of what's left, and that a subsequent reorder
// still works correctly against the now-gapped sequence.
func TestRemoveSetlistEntry_LeavesRemainingOrderIntact(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	p1 := createTestPiece(t, dbConn, "One")
	p2 := createTestPiece(t, dbConn, "Two")
	p3 := createTestPiece(t, dbConn, "Three")
	e1, _ := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1})
	e2, _ := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p2})
	e3, _ := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p3})

	if err := repo.RemoveSetlistEntry(ctx, dbConn, setlistID, e2); err != nil {
		t.Fatalf("RemoveSetlistEntry: %v", err)
	}
	entries, err := repo.ListSetlistEntries(ctx, dbConn, setlistID)
	if err != nil {
		t.Fatalf("ListSetlistEntries: %v", err)
	}
	if len(entries) != 2 || entries[0].ID != e1 || entries[1].ID != e3 {
		t.Fatalf("ListSetlistEntries after removal = %+v, want [e1, e3]", entries)
	}

	// A reorder against this now-gapped sequence must still work cleanly.
	if err := repo.ReorderSetlistEntries(ctx, dbConn, setlistID, []int64{e3, e1}); err != nil {
		t.Fatalf("ReorderSetlistEntries after removal: %v", err)
	}
	entries, err = repo.ListSetlistEntries(ctx, dbConn, setlistID)
	if err != nil {
		t.Fatalf("ListSetlistEntries after reorder: %v", err)
	}
	if len(entries) != 2 || entries[0].ID != e3 || entries[0].SortOrder != 0 || entries[1].ID != e1 || entries[1].SortOrder != 1 {
		t.Errorf("ListSetlistEntries after reorder = %+v, want [e3@0, e1@1]", entries)
	}
}

// TestAddSetlistEntry_SamePieceCanRepeat covers decision 4: a piece can
// legitimately appear more than once in the same setlist (a reprised
// piece/encore) — each occurrence is its own distinct entry row/id.
func TestAddSetlistEntry_SamePieceCanRepeat(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	p1 := createTestPiece(t, dbConn, "Doxology")

	e1, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1})
	if err != nil {
		t.Fatalf("AddSetlistEntry (first): %v", err)
	}
	e2, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1})
	if err != nil {
		t.Fatalf("AddSetlistEntry (encore): %v", err)
	}
	if e1 == e2 {
		t.Fatal("repeating the same piece must produce two distinct entry ids")
	}

	entries, err := repo.ListSetlistEntries(ctx, dbConn, setlistID)
	if err != nil {
		t.Fatalf("ListSetlistEntries: %v", err)
	}
	if len(entries) != 2 || *entries[0].PieceID != p1 || *entries[1].PieceID != p1 {
		t.Errorf("ListSetlistEntries = %+v, want the same piece twice", entries)
	}
}

// TestSetlistEntries_PieceIDXorCustomNameEnforcedByCheckConstraint
// verifies the migration's own CHECK constraint is real and actually
// rejects malformed data at the DB level — a genuine defense-in-depth
// backstop behind api.ValidateSetlistEntryInput, not just documentation.
func TestSetlistEntries_PieceIDXorCustomNameEnforcedByCheckConstraint(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	pieceID := createTestPiece(t, dbConn, "Ambiguous")

	// Neither piece_id nor custom_name set.
	if _, err := dbConn.ExecContext(ctx,
		`INSERT INTO setlist_entries (setlist_id, sort_order) VALUES (?, 0)`, setlistID,
	); err == nil {
		t.Error("expected a CHECK constraint violation inserting neither piece_id nor custom_name, got none")
	}

	// Both piece_id and custom_name set.
	if _, err := dbConn.ExecContext(ctx,
		`INSERT INTO setlist_entries (setlist_id, piece_id, custom_name, sort_order) VALUES (?, ?, 'Both', 0)`,
		setlistID, pieceID,
	); err == nil {
		t.Error("expected a CHECK constraint violation inserting both piece_id and custom_name, got none")
	}
}

// TestDeleteSetlist_CascadesEntries confirms setlist_entries' own ON
// DELETE CASCADE actually fires — deleting a setlist must not leave
// orphaned entry rows behind.
func TestDeleteSetlist_CascadesEntries(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	p1 := createTestPiece(t, dbConn, "Cascade Me")
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &p1}); err != nil {
		t.Fatalf("AddSetlistEntry: %v", err)
	}

	if err := repo.DeleteSetlist(ctx, dbConn, 1, setlistID); err != nil {
		t.Fatalf("DeleteSetlist: %v", err)
	}

	var count int
	if err := dbConn.QueryRowContext(ctx, `SELECT COUNT(*) FROM setlist_entries WHERE setlist_id = ?`, setlistID).Scan(&count); err != nil {
		t.Fatalf("counting orphaned entries: %v", err)
	}
	if count != 0 {
		t.Errorf("setlist_entries still has %d row(s) for a deleted setlist, want 0", count)
	}
}

// TestDeletePiece_RemovesItFromEveryContainingSetlist confirms
// setlist_entries.piece_id's own ON DELETE CASCADE — deleting a Piece
// must remove it from any setlist it was part of, per the plan's own
// "Deleting a Piece cascades it out of any setlist automatically" note,
// rather than leaving a dangling reference.
func TestDeletePiece_RemovesItFromEveryContainingSetlist(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	pieceID := createTestPiece(t, dbConn, "Soon Deleted")
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &pieceID}); err != nil {
		t.Fatalf("AddSetlistEntry: %v", err)
	}

	if _, err := dbConn.ExecContext(ctx, `DELETE FROM pieces WHERE id = ?`, pieceID); err != nil {
		t.Fatalf("deleting piece: %v", err)
	}

	entries, err := repo.ListSetlistEntries(ctx, dbConn, setlistID)
	if err != nil {
		t.Fatalf("ListSetlistEntries: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("ListSetlistEntries after deleting the referenced piece = %+v, want empty", entries)
	}
}

// TestListSetlistEntries_JoinsPieceDurationAndPageCount confirms the
// joined-in PieceDuration/PiecePageCount fields (used by totals
// computation without a second per-piece query) actually reflect the
// referenced piece's own real values, and stay nil for a custom entry.
func TestListSetlistEntries_JoinsPieceDurationAndPageCount(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)
	setlistID, err := repo.CreateSetlist(ctx, dbConn, 1, "Program", nil, nil)
	if err != nil {
		t.Fatalf("CreateSetlist: %v", err)
	}
	duration := 245
	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:    "Timed Piece",
		FilePath: "/data/library/pieces/timed.pdf",
		FileHash: "timed-hash",
		Duration: &duration,
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{PieceID: &pieceID}); err != nil {
		t.Fatalf("AddSetlistEntry (piece): %v", err)
	}
	if _, err := repo.AddSetlistEntry(ctx, dbConn, setlistID, repo.AddSetlistEntryParams{
		CustomName: strPtr("Offering"), CustomDurationSeconds: intPtr(120),
	}); err != nil {
		t.Fatalf("AddSetlistEntry (custom): %v", err)
	}

	entries, err := repo.ListSetlistEntries(ctx, dbConn, setlistID)
	if err != nil {
		t.Fatalf("ListSetlistEntries: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(entries))
	}
	if entries[0].PieceDuration == nil || *entries[0].PieceDuration != duration {
		t.Errorf("piece entry PieceDuration = %v, want %d", entries[0].PieceDuration, duration)
	}
	if entries[0].PiecePageCount == nil {
		t.Error("piece entry PiecePageCount = nil, want the piece's own page count")
	}
	if entries[1].PieceDuration != nil || entries[1].PiecePageCount != nil {
		t.Errorf("custom entry joined-in piece fields = %v/%v, want both nil", entries[1].PieceDuration, entries[1].PiecePageCount)
	}
}
