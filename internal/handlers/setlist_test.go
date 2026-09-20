package handlers_test

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// uploadTestPiece uploads a minimal real piece via the actual HTTP upload
// endpoint (not a direct repo call) and returns its id, for setlist-entry
// tests that need a real piece to reference.
func uploadTestPiece(t *testing.T, h http.Handler) int64 {
	t.Helper()
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 2)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("uploading test piece: status %d, body %s", rec.Code, rec.Body.String())
	}
	var piece struct {
		ID int64 `json:"id"`
	}
	decodeData(t, rec, &piece)
	return piece.ID
}

// TestListSetlists_EmptyReturnsEmptyArrayNotNull is the same regression
// class TestListUserTags_EmptyTableReturnsEmptyArrayNotNull already covers
// for tags/instruments — a brand new account has no setlists yet.
func TestListSetlists_EmptyReturnsEmptyArrayNotNull(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/setlists", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"data":null`) {
		t.Errorf("body = %s, want an empty array, not null", rec.Body.String())
	}
}

// TestCreateSetlist_RejectsBlankName covers ValidateSetlistName's own
// "an empty name is a confusing empty state" rule end to end via HTTP.
func TestCreateSetlist_RejectsBlankName(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodPost, "/api/setlists", map[string]any{"name": "   "})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s, want 400", rec.Code, rec.Body.String())
	}
}

// TestSetlistFullLifecycle_CreateAddEntriesReorderUpdateDelete is one
// broad round trip through every real endpoint, mirroring how the mockup
// itself actually drives a setlist end to end: create it, add a piece and
// a custom entry, reorder them, edit the custom entry, remove one, then
// archive and delete the setlist.
func TestSetlistFullLifecycle_CreateAddEntriesReorderUpdateDelete(t *testing.T) {
	h := newTestServer(t)
	pieceID := uploadTestPiece(t, h)

	// Create.
	rec := doJSON(t, h, http.MethodPost, "/api/setlists", map[string]any{
		"name": "Sunday Morning Service", "gigDate": "2026-12-25",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: status %d, body %s", rec.Code, rec.Body.String())
	}
	var setlist struct {
		ID      int64 `json:"id"`
		Entries []struct {
			ID int64 `json:"id"`
		} `json:"entries"`
	}
	decodeData(t, rec, &setlist)
	setlistID := setlist.ID

	// Add a piece entry.
	rec = doJSON(t, h, http.MethodPost, setlistURL(setlistID, "/entries"), map[string]any{"pieceId": pieceID})
	if rec.Code != http.StatusCreated {
		t.Fatalf("add piece entry: status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, rec, &setlist)
	if len(setlist.Entries) != 1 {
		t.Fatalf("entries after adding a piece = %d, want 1", len(setlist.Entries))
	}
	pieceEntryID := setlist.Entries[0].ID

	// Add a custom entry.
	rec = doJSON(t, h, http.MethodPost, setlistURL(setlistID, "/entries"), map[string]any{
		"customName": "Welcome & Announcements",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("add custom entry: status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, rec, &setlist)
	if len(setlist.Entries) != 2 {
		t.Fatalf("entries after adding a custom entry = %d, want 2", len(setlist.Entries))
	}
	customEntryID := setlist.Entries[1].ID

	// Reorder: swap the two entries.
	rec = doJSON(t, h, http.MethodPut, setlistURL(setlistID, "/entries/order"), map[string]any{
		"entryIds": []int64{customEntryID, pieceEntryID},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("reorder: status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, rec, &setlist)
	if setlist.Entries[0].ID != customEntryID || setlist.Entries[1].ID != pieceEntryID {
		t.Fatalf("order after reorder = %+v, want [custom, piece]", setlist.Entries)
	}

	// A reorder that omits an entry must be rejected, not silently applied.
	rec = doJSON(t, h, http.MethodPut, setlistURL(setlistID, "/entries/order"), map[string]any{
		"entryIds": []int64{customEntryID},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("incomplete reorder: status %d, want 400", rec.Code)
	}

	// Edit the custom entry.
	rec = doJSON(t, h, http.MethodPatch, setlistURL(setlistID, "/entries/"+strconv.FormatInt(customEntryID, 10)), map[string]any{
		"customName":          "Welcome",
		"customCountsAsMusic": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("edit custom entry: status %d, body %s", rec.Code, rec.Body.String())
	}

	// Remove the piece entry.
	rec = doJSON(t, h, http.MethodDelete, setlistURL(setlistID, "/entries/"+strconv.FormatInt(pieceEntryID, 10)), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("remove entry: status %d, body %s", rec.Code, rec.Body.String())
	}

	// Confirm the state via GET.
	rec = doJSON(t, h, http.MethodGet, setlistURL(setlistID, ""), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: status %d, body %s", rec.Code, rec.Body.String())
	}
	var detail struct {
		Entries []struct {
			ID         int64   `json:"id"`
			CustomName *string `json:"customName"`
		} `json:"entries"`
	}
	decodeData(t, rec, &detail)
	if len(detail.Entries) != 1 || detail.Entries[0].CustomName == nil || *detail.Entries[0].CustomName != "Welcome" {
		t.Fatalf("final entries = %+v, want just the renamed custom entry", detail.Entries)
	}

	// Archive.
	rec = doJSON(t, h, http.MethodPatch, setlistURL(setlistID, ""), map[string]any{
		"name": "Sunday Morning Service", "gigDate": "2026-12-25", "archived": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("archive: status %d, body %s", rec.Code, rec.Body.String())
	}
	var afterArchive struct {
		Archived bool `json:"archived"`
	}
	decodeData(t, rec, &afterArchive)
	if !afterArchive.Archived {
		t.Error("archived = false after archiving, want true")
	}

	// Delete.
	rec = doJSON(t, h, http.MethodDelete, setlistURL(setlistID, ""), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: status %d, body %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, h, http.MethodGet, setlistURL(setlistID, ""), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("get after delete: status %d, want 404", rec.Code)
	}
}

// TestGetSetlist_NonexistentID404s covers a plain not-found path.
func TestGetSetlist_NonexistentID404s(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/setlists/999999", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
}

// TestAddSetlistEntry_RejectsNeitherPieceNorCustomName covers
// ValidateSetlistEntryInput's own XOR rule via HTTP.
func TestAddSetlistEntry_RejectsNeitherPieceNorCustomName(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodPost, "/api/setlists", map[string]any{"name": "Program"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: status %d, body %s", rec.Code, rec.Body.String())
	}
	var setlist struct {
		ID int64 `json:"id"`
	}
	decodeData(t, rec, &setlist)

	rec = doJSON(t, h, http.MethodPost, setlistURL(setlist.ID, "/entries"), map[string]any{})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s, want 400", rec.Code, rec.Body.String())
	}
}

// TestListPieceSetlistMemberships_ReflectsAddAndRemove covers the bulk
// membership endpoint the Library grid/list indicator and the Add to
// Setlist picker's own checked-state/remove flow both depend on — a
// piece's membership row must appear after adding it to a setlist and
// disappear after removing it, carrying the real entryId needed to
// address that removal in the first place.
func TestListPieceSetlistMemberships_ReflectsAddAndRemove(t *testing.T) {
	h := newTestServer(t)
	pieceID := uploadTestPiece(t, h)

	rec := doJSON(t, h, http.MethodGet, "/api/setlists/memberships", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"data":null`) {
		t.Errorf("body = %s, want an empty array, not null", rec.Body.String())
	}
	var memberships []struct {
		PieceID   int64 `json:"pieceId"`
		SetlistID int64 `json:"setlistId"`
		EntryID   int64 `json:"entryId"`
	}
	decodeData(t, rec, &memberships)
	if len(memberships) != 0 {
		t.Fatalf("memberships before adding anything = %+v, want empty", memberships)
	}

	rec = doJSON(t, h, http.MethodPost, "/api/setlists", map[string]any{"name": "Program"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create setlist: status %d, body %s", rec.Code, rec.Body.String())
	}
	var setlist struct {
		ID int64 `json:"id"`
	}
	decodeData(t, rec, &setlist)

	rec = doJSON(t, h, http.MethodPost, setlistURL(setlist.ID, "/entries"), map[string]any{"pieceId": pieceID})
	if rec.Code != http.StatusCreated {
		t.Fatalf("add entry: status %d, body %s", rec.Code, rec.Body.String())
	}
	var added struct {
		Entries []struct {
			ID int64 `json:"id"`
		} `json:"entries"`
	}
	decodeData(t, rec, &added)
	entryID := added.Entries[0].ID

	rec = doJSON(t, h, http.MethodGet, "/api/setlists/memberships", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, rec, &memberships)
	if len(memberships) != 1 || memberships[0].PieceID != pieceID || memberships[0].SetlistID != setlist.ID || memberships[0].EntryID != entryID {
		t.Fatalf("memberships after adding = %+v, want one row for piece %d / setlist %d / entry %d", memberships, pieceID, setlist.ID, entryID)
	}

	rec = doJSON(t, h, http.MethodDelete, setlistURL(setlist.ID, "/entries/"+strconv.FormatInt(entryID, 10)), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("remove entry: status %d, body %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, h, http.MethodGet, "/api/setlists/memberships", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, rec, &memberships)
	if len(memberships) != 0 {
		t.Fatalf("memberships after removing = %+v, want empty", memberships)
	}
}

func setlistURL(id int64, suffix string) string {
	return "/api/setlists/" + strconv.FormatInt(id, 10) + suffix
}
