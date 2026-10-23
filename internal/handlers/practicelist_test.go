package handlers_test

import (
	"fmt"
	"net/http"
	"testing"
)

type listEntry struct {
	Piece struct {
		ID    int64  `json:"id"`
		Title string `json:"title"`
	} `json:"piece"`
	Practiced *bool `json:"practiced"`
}

// uploadDistinctTestPiece uploads a piece of the given page count, so its
// file differs from uploadTestPiece's (2 pages) and isn't deduped onto it.
func uploadDistinctTestPiece(t *testing.T, h http.Handler, pages int) int64 {
	t.Helper()
	path := t.TempDir() + "/piece.pdf"
	writeFixturePDF(t, path, pages)
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

func practiceListIDs(t *testing.T, h http.Handler, query string) []listEntry {
	t.Helper()
	var entries []listEntry
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/practice-list"+query, nil), &entries)
	return entries
}

// The Practice List: added pieces go to the end, never twice; remove and a
// whole-list reorder; a reorder must name exactly the pieces on it; and
// `practice` is required.
func TestPracticeList(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	a := uploadTestPiece(t, h)
	b := uploadDistinctTestPiece(t, h, 3)
	c := uploadDistinctTestPiece(t, h, 4)

	if got := practiceListIDs(t, h, ""); len(got) != 0 {
		t.Fatalf("new list = %+v, want empty", got)
	}

	var added struct {
		Added int `json:"added"`
	}
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/practice-list", map[string]any{"pieceIds": []int64{b, a}}), &added)
	if added.Added != 2 {
		t.Errorf("added = %d, want 2", added.Added)
	}
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/practice-list", map[string]any{"pieceIds": []int64{a, c}}), &added)
	if added.Added != 1 {
		t.Errorf("adding one new and one listed: added = %d, want 1", added.Added)
	}
	order := func() string {
		s := ""
		for _, e := range practiceListIDs(t, h, "") {
			s += fmt.Sprintf("%d,", e.Piece.ID)
		}
		return s
	}
	if got, want := order(), fmt.Sprintf("%d,%d,%d,", b, a, c); got != want {
		t.Errorf("order = %s, want %s (added to the end, no duplicates)", got, want)
	}

	if rec := doJSON(t, h, http.MethodPut, "/api/practice-list/order", map[string]any{"pieceIds": []int64{c, b, a}}); rec.Code != http.StatusOK {
		t.Fatalf("reorder: status %d, body %s", rec.Code, rec.Body.String())
	}
	if got, want := order(), fmt.Sprintf("%d,%d,%d,", c, b, a); got != want {
		t.Errorf("after reorder = %s, want %s", got, want)
	}
	if rec := doJSON(t, h, http.MethodPut, "/api/practice-list/order", map[string]any{"pieceIds": []int64{c, b}}); rec.Code != http.StatusBadRequest {
		t.Errorf("reorder missing a piece: status %d, want 400", rec.Code)
	}

	if rec := doJSON(t, h, http.MethodDelete, fmt.Sprintf("/api/practice-list/%d", b), nil); rec.Code != http.StatusOK {
		t.Fatalf("remove: status %d", rec.Code)
	}
	if got, want := order(), fmt.Sprintf("%d,%d,", c, a); got != want {
		t.Errorf("after remove = %s, want %s", got, want)
	}

	if rec := doJSON(t, h, http.MethodPost, "/api/practice-list", map[string]any{"pieceIds": []int64{99999}}); rec.Code != http.StatusNotFound {
		t.Errorf("adding a missing piece: status %d, want 404", rec.Code)
	}

	if _, err := conn.Exec(`DELETE FROM user_permissions WHERE user_id = 1 AND permission IN ('admin', 'practice')`); err != nil {
		t.Fatal(err)
	}
	if rec := doJSON(t, h, http.MethodGet, "/api/practice-list", nil); rec.Code != http.StatusForbidden {
		t.Errorf("without practice: status %d, want 403", rec.Code)
	}
}

// Practiced days: a mark and an unmark are both kept for the day (an
// unmark is false, not gone), the list reports each piece's mark for a
// day, and the last practiced day ignores unmarks.
func TestPracticedDays(t *testing.T) {
	h := newTestServer(t)
	a := uploadTestPiece(t, h)
	base := apiPiecesURL(a) + "/practiced"

	type practiced struct {
		Practiced     *bool   `json:"practiced"`
		LastPracticed *string `json:"lastPracticed"`
	}
	get := func(day string) practiced {
		var p practiced
		decodeData(t, doJSON(t, h, http.MethodGet, base+"?day="+day, nil), &p)
		return p
	}

	if p := get("2026-10-20"); p.Practiced != nil || p.LastPracticed != nil {
		t.Fatalf("never practiced = %+v, want nothing", p)
	}
	for _, day := range []string{"2026-10-18", "2026-10-20"} {
		if rec := doJSON(t, h, http.MethodPut, base+"/"+day, map[string]bool{"practiced": true}); rec.Code != http.StatusOK {
			t.Fatalf("mark %s: status %d, body %s", day, rec.Code, rec.Body.String())
		}
	}
	if rec := doJSON(t, h, http.MethodPut, base+"/2026-10-20", map[string]bool{"practiced": false}); rec.Code != http.StatusOK {
		t.Fatalf("unmark: status %d", rec.Code)
	}
	p := get("2026-10-20")
	if p.Practiced == nil || *p.Practiced {
		t.Errorf("after unmarking, practiced = %v, want false (kept for the day)", p.Practiced)
	}
	if p.LastPracticed == nil || *p.LastPracticed != "2026-10-18" {
		t.Errorf("lastPracticed = %v, want 2026-10-18 (the unmarked day doesn't count)", p.LastPracticed)
	}

	doJSON(t, h, http.MethodPost, "/api/practice-list", map[string]any{"pieceIds": []int64{a}})
	entries := practiceListIDs(t, h, "?day=2026-10-18")
	if len(entries) != 1 || entries[0].Practiced == nil || !*entries[0].Practiced {
		t.Errorf("list marks for 2026-10-18 = %+v, want practiced", entries)
	}
	if entries := practiceListIDs(t, h, "?day=2026-10-19"); entries[0].Practiced != nil {
		t.Errorf("list mark for an unrecorded day = %v, want null", *entries[0].Practiced)
	}

	if rec := doJSON(t, h, http.MethodPut, base+"/20261020", map[string]bool{"practiced": true}); rec.Code != http.StatusBadRequest {
		t.Errorf("bad day: status %d, want 400", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodPut, base+"/2026-10-21", map[string]any{}); rec.Code != http.StatusBadRequest {
		t.Errorf("missing practiced: status %d, want 400", rec.Code)
	}
}
