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

// Three days practiced within the last four weeks, not all in one week (the
// marked day, and at least one 7 to 27 days before it), move a piece with no
// status, or Want to Learn, to Learning — and say so; every other status
// stays, as do two days, three days in one week, and days spread over more
// than four weeks.
func TestPracticedMovesToLearning(t *testing.T) {
	h := newTestServer(t)
	none := uploadTestPiece(t, h)
	wanted := uploadDistinctTestPiece(t, h, 3)
	stalled := uploadDistinctTestPiece(t, h, 4)
	learned := uploadDistinctTestPiece(t, h, 5)
	other := uploadDistinctTestPiece(t, h, 6)

	setStatus := func(id int64, status string) {
		t.Helper()
		if rec := doJSON(t, h, http.MethodPatch, apiPiecesURL(id)+"/practice-status", map[string]any{"practiceStatus": status}); rec.Code != http.StatusOK {
			t.Fatalf("set status: %d %s", rec.Code, rec.Body.String())
		}
	}
	mark := func(id int64, day string, practiced bool) bool {
		t.Helper()
		rec := doJSON(t, h, http.MethodPut, apiPiecesURL(id)+"/practiced/"+day, map[string]bool{"practiced": practiced})
		if rec.Code != http.StatusOK {
			t.Fatalf("mark %s: %d %s", day, rec.Code, rec.Body.String())
		}
		var r struct {
			MovedToLearning bool `json:"movedToLearning"`
		}
		decodeData(t, rec, &r)
		return r.MovedToLearning
	}
	status := func(id int64) string {
		t.Helper()
		var p struct {
			PracticeStatus *string `json:"practiceStatus"`
		}
		decodeData(t, doJSON(t, h, http.MethodGet, apiPiecesURL(id), nil), &p)
		if p.PracticeStatus == nil {
			return ""
		}
		return *p.PracticeStatus
	}

	setStatus(wanted, "Want to Learn")
	setStatus(stalled, "Stalled")
	setStatus(learned, "Learned")

	// Three days in one week don't count; a day the next week makes two
	// weeks, but only once there are three days.
	for _, id := range []int64{none, wanted, stalled, learned} {
		for _, day := range []string{"2026-11-02", "2026-11-04", "2026-11-08"} {
			if mark(id, day, true) {
				t.Errorf("piece %d: moved to Learning within one week (%s)", id, day)
			}
		}
	}
	for id, want := range map[int64]bool{none: true, wanted: true, stalled: false, learned: false} {
		if got := mark(id, "2026-11-10", true); got != want {
			t.Errorf("piece %d: movedToLearning = %v, want %v", id, got, want)
		}
	}
	for id, want := range map[int64]string{none: "Learning", wanted: "Learning", stalled: "Stalled", learned: "Learned"} {
		if got := status(id); got != want {
			t.Errorf("piece %d: status %q, want %q", id, got, want)
		}
	}

	// Two days in different weeks aren't enough; a third makes it — but not
	// one over four weeks back, or a day only unmarked.
	mark(other, "2026-10-01", true)
	if mark(other, "2026-10-12", true) || status(other) != "" {
		t.Errorf("two days moved it to Learning (status %q)", status(other))
	}
	mark(other, "2026-10-20", false)
	if mark(other, "2026-11-01", true) || status(other) != "" {
		// 10-01 is over four weeks before; 10-20 was unmarked.
		t.Errorf("10-12 and 11-01 alone moved it to Learning (status %q)", status(other))
	}
	if !mark(other, "2026-11-02", true) || status(other) != "Learning" {
		t.Errorf("10-12, 11-01, 11-02: status %q, want Learning", status(other))
	}
}
