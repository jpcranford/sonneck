package handlers_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

type dashPiece struct {
	ID             int64   `json:"id"`
	PracticeStatus *string `json:"practiceStatus"`
}

type dashboard struct {
	Practicing     []dashPiece `json:"practicing"`
	RecentlyPlayed []struct {
		Piece         dashPiece `json:"piece"`
		LastPracticed string    `json:"lastPracticed"`
	} `json:"recentlyPlayed"`
	RecentlyAdded []dashPiece `json:"recentlyAdded"`
	Favorites     []dashPiece `json:"favorites"`
	WantToLearn   []dashPiece `json:"wantToLearn"`
	Learned       []dashPiece `json:"learned"`
	PracticeDays  []string    `json:"practiceDays"`
	Totals        struct {
		Practicing  int `json:"practicing"`
		WantToLearn int `json:"wantToLearn"`
		Learned     int `json:"learned"`
	} `json:"totals"`
}

func dashIDs(ps []dashPiece) []int64 {
	out := make([]int64, len(ps))
	for i, p := range ps {
		out[i] = p.ID
	}
	return out
}

func equalIDs(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// The Practice Dashboard: Currently Practicing by the latest status change,
// Other Recently Played leaving those out, Recently Added newest first, the
// status shelves, the practice days in range, and ?day= required.
func TestPracticeDashboard(t *testing.T) {
	h := newTestServer(t)
	a := uploadTestPiece(t, h)
	b := uploadDistinctTestPiece(t, h, 3)
	c := uploadDistinctTestPiece(t, h, 4)
	d := uploadDistinctTestPiece(t, h, 5)

	setStatus := func(id int64, status string) {
		t.Helper()
		rec := doJSON(t, h, http.MethodPatch, apiPiecesURL(id)+"/practice-status", map[string]any{"practiceStatus": status})
		if rec.Code != http.StatusOK {
			t.Fatalf("set status: %d %s", rec.Code, rec.Body.String())
		}
	}
	practiced := func(id int64, day string) {
		t.Helper()
		rec := doJSON(t, h, http.MethodPut, apiPiecesURL(id)+"/practiced/"+day, map[string]any{"practiced": true})
		if rec.Code != http.StatusOK {
			t.Fatalf("mark practiced: %d %s", rec.Code, rec.Body.String())
		}
	}

	// a and b are both on Currently Practicing (b the later status change);
	// a was practiced and b never, so a comes first (latest practiced
	// first, never practiced last).
	setStatus(a, "Learning")
	setStatus(b, "Stalled")
	setStatus(a, "Learning")
	setStatus(c, "Learned")
	setStatus(d, "Want to Learn")

	practiced(a, "2026-11-18") // Currently Practicing: not on Other Recently Played
	practiced(c, "2026-11-10")
	practiced(c, "2026-11-17")
	practiced(d, "2026-11-15")
	practiced(d, "2026-09-01") // outside the six-week range

	rec := doJSON(t, h, http.MethodGet, "/api/practice/dashboard?day=2026-11-19", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard: %d %s", rec.Code, rec.Body.String())
	}
	var got dashboard
	decodeData(t, rec, &got)

	if ids := dashIDs(got.Practicing); !equalIDs(ids, []int64{a, b}) {
		t.Errorf("practicing = %v, want [a b] = %v", ids, []int64{a, b})
	}
	var played []int64
	for _, p := range got.RecentlyPlayed {
		played = append(played, p.Piece.ID)
	}
	if !equalIDs(played, []int64{c, d}) {
		t.Errorf("recently played = %v, want [c d] = %v", played, []int64{c, d})
	}
	if len(got.RecentlyPlayed) > 0 && got.RecentlyPlayed[0].LastPracticed != "2026-11-17" {
		t.Errorf("c's last practiced = %q, want 2026-11-17", got.RecentlyPlayed[0].LastPracticed)
	}
	if ids := dashIDs(got.RecentlyAdded); !equalIDs(ids, []int64{d, c, b, a}) {
		t.Errorf("recently added = %v, want newest first", ids)
	}
	if ids := dashIDs(got.WantToLearn); !equalIDs(ids, []int64{d}) {
		t.Errorf("want to learn = %v, want [d]", ids)
	}
	if ids := dashIDs(got.Learned); !equalIDs(ids, []int64{c}) {
		t.Errorf("learned = %v, want [c]", ids)
	}
	wantDays := []string{"2026-11-10", "2026-11-15", "2026-11-17", "2026-11-18"}
	if len(got.PracticeDays) != len(wantDays) {
		t.Fatalf("practice days = %v, want %v", got.PracticeDays, wantDays)
	}
	for i := range wantDays {
		if got.PracticeDays[i] != wantDays[i] {
			t.Errorf("practice days = %v, want %v", got.PracticeDays, wantDays)
			break
		}
	}

	if got.Totals.Practicing != 2 || got.Totals.WantToLearn != 1 || got.Totals.Learned != 1 {
		t.Errorf("totals = %+v, want practicing 2, want to learn 1, learned 1", got.Totals)
	}

	if rec := doJSON(t, h, http.MethodGet, "/api/practice/dashboard", nil); rec.Code != http.StatusBadRequest {
		t.Errorf("no day: status %d, want 400", rec.Code)
	}
}

// The week's Customize settings round-trip through User Settings and are
// checked.
func TestUserSettings_PracticeWeek(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodPatch, "/api/user-settings", map[string]any{
		"practiceHistoryMode": "target", "practiceTargetDays": 5, "practiceWeekStart": "sunday",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body.String())
	}
	var s struct {
		Mode   string `json:"practiceHistoryMode"`
		Target int    `json:"practiceTargetDays"`
		Start  string `json:"practiceWeekStart"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/user-settings", nil), &s)
	if s.Mode != "target" || s.Target != 5 || s.Start != "sunday" {
		t.Errorf("settings = %+v, want target/5/sunday", s)
	}
	for _, bad := range []map[string]any{
		{"practiceHistoryMode": "weekly"},
		{"practiceTargetDays": 0},
		{"practiceTargetDays": 8},
		{"practiceWeekStart": "friday"},
	} {
		if rec := doJSON(t, h, http.MethodPatch, "/api/user-settings", bad); rec.Code != http.StatusBadRequest {
			t.Errorf("patch %v: status %d, want 400", bad, rec.Code)
		}
	}
}

// Want to Learn and Learned list the latest status change first; setting the
// same status again doesn't move a piece. Currently Practicing lists the
// latest practiced first.
func TestPracticeDashboard_StatusShelvesRecentFirst(t *testing.T) {
	h := newTestServer(t)
	x := uploadTestPiece(t, h)
	y := uploadDistinctTestPiece(t, h, 3)
	z := uploadDistinctTestPiece(t, h, 4)

	setStatus := func(id int64, status string) {
		t.Helper()
		rec := doJSON(t, h, http.MethodPatch, apiPiecesURL(id)+"/practice-status", map[string]any{"practiceStatus": status})
		if rec.Code != http.StatusOK {
			t.Fatalf("set status: %d %s", rec.Code, rec.Body.String())
		}
		time.Sleep(5 * time.Millisecond) // updated_at is to the millisecond
	}
	get := func() dashboard {
		t.Helper()
		var d dashboard
		decodeData(t, doJSON(t, h, http.MethodGet, "/api/practice/dashboard?day=2026-11-22", nil), &d)
		return d
	}

	setStatus(x, "Learned")
	setStatus(y, "Learned")
	setStatus(z, "Learned")
	setStatus(x, "Learned") // the same status again: x stays last
	if ids := dashIDs(get().Learned); !equalIDs(ids, []int64{z, y, x}) {
		t.Errorf("learned = %v, want [z y x] (latest change first)", ids)
	}
	setStatus(y, "Want to Learn")
	setStatus(x, "Want to Learn")
	d := get()
	if ids := dashIDs(d.WantToLearn); !equalIDs(ids, []int64{x, y}) {
		t.Errorf("want to learn = %v, want [x y]", ids)
	}
	if ids := dashIDs(d.Learned); !equalIDs(ids, []int64{z}) {
		t.Errorf("learned = %v, want [z]", ids)
	}

	// Currently Practicing goes by the latest day practiced instead: y was
	// set to Learning last but practiced longest ago.
	for _, id := range []int64{x, z, y} {
		setStatus(id, "Learning")
	}
	for id, day := range map[int64]string{x: "2026-11-20", y: "2026-11-01", z: "2026-11-21"} {
		doJSON(t, h, http.MethodPut, apiPiecesURL(id)+"/practiced/"+day, map[string]bool{"practiced": true})
	}
	if ids := dashIDs(get().Practicing); !equalIDs(ids, []int64{z, x, y}) {
		t.Errorf("practicing = %v, want [z x y] (latest practiced first)", ids)
	}
}

// Favorites list the most recently edited piece first, compared to the
// second whatever suffix a row's updated_at carries.
func TestPracticeDashboard_FavoritesRecentlyEditedFirst(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	older := createTestPiece(t, h, map[string]any{"title": "Alpha", "favorite": true})
	newest := createTestPiece(t, h, map[string]any{"title": "Beta", "favorite": true})
	middle := createTestPiece(t, h, map[string]any{"title": "Gamma", "favorite": true})
	createTestPiece(t, h, map[string]any{"title": "Not a favorite", "favorite": false})

	for id, at := range map[int64]string{
		older.ID:  "2026-11-01 10:00:00",
		newest.ID: "2026-11-20 08:00:00.123 +0000 UTC",
		middle.ID: "2026-11-10 09:00:00.5 +0000 UTC",
	} {
		if _, err := conn.Exec(`UPDATE pieces SET updated_at = ? WHERE id = ?`, at, id); err != nil {
			t.Fatal(err)
		}
	}
	var d dashboard
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/practice/dashboard?day=2026-11-22", nil), &d)
	if ids := dashIDs(d.Favorites); !equalIDs(ids, []int64{newest.ID, middle.ID, older.ID}) {
		t.Errorf("favorites = %v, want [Beta Gamma Alpha] = %v", ids, []int64{newest.ID, middle.ID, older.ID})
	}
}

// A shuffled shelf: drawn at random from the whole view, then capped; the
// same seed gives the same shelf, a new seed a new one. The recent shelves
// keep their own pieces, only reordered. A malformed shuffle is refused.
func TestPracticeDashboard_Shuffle(t *testing.T) {
	h := newTestServer(t)
	for i := 0; i < 30; i++ {
		createTestPiece(t, h, map[string]any{"title": fmt.Sprintf("Fav %02d", i), "favorite": true})
	}
	get := func(q string) dashboard {
		t.Helper()
		rec := doJSON(t, h, http.MethodGet, "/api/practice/dashboard?day=2026-11-22"+q, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("dashboard%s: %d %s", q, rec.Code, rec.Body.String())
		}
		var d dashboard
		decodeData(t, rec, &d)
		return d
	}
	plain := get("")
	if len(plain.Favorites) != 16 {
		t.Fatalf("favorites = %d, want the cap of 16", len(plain.Favorites))
	}
	inPlain := map[int64]bool{}
	for _, id := range dashIDs(plain.Favorites) {
		inPlain[id] = true
	}

	// Over a few seeds, the shuffled shelf reaches pieces past the usual 16.
	reached := map[int64]bool{}
	for seed := 1; seed <= 6; seed++ {
		d := get(fmt.Sprintf("&shuffle=favorites:%d", seed))
		if len(d.Favorites) != 16 {
			t.Fatalf("seed %d: %d favorites, want 16", seed, len(d.Favorites))
		}
		for _, id := range dashIDs(d.Favorites) {
			reached[id] = true
		}
	}
	outside := 0
	for id := range reached {
		if !inPlain[id] {
			outside++
		}
	}
	if outside == 0 {
		t.Errorf("shuffled favorites never reached past the usual 16")
	}

	a := dashIDs(get("&shuffle=favorites:42").Favorites)
	if !equalIDs(a, dashIDs(get("&shuffle=favorites:42").Favorites)) {
		t.Errorf("the same seed gave a different shelf")
	}
	if equalIDs(a, dashIDs(get("&shuffle=favorites:43").Favorites)) {
		t.Errorf("a new seed gave the same shelf")
	}

	// Recently Added: the same 10 newest, in another order.
	shuffledAdded := dashIDs(get("&shuffle=added:9").RecentlyAdded)
	plainAdded := dashIDs(plain.RecentlyAdded)
	if len(shuffledAdded) != 10 || equalIDs(shuffledAdded, plainAdded) {
		t.Errorf("shuffled recently added = %v, want the same 10 reordered (%v)", shuffledAdded, plainAdded)
	}
	set := map[int64]bool{}
	for _, id := range plainAdded {
		set[id] = true
	}
	for _, id := range shuffledAdded {
		if !set[id] {
			t.Errorf("shuffled recently added has %d, not one of the 10 newest", id)
		}
	}

	// Other shelves are untouched by a favorites shuffle; bad input is a 400.
	if !equalIDs(dashIDs(get("&shuffle=favorites:5").RecentlyAdded), plainAdded) {
		t.Errorf("shuffling favorites reordered recently added")
	}
	for _, bad := range []string{"favorites", "favorites:x", "favorites:0", "favorites:-3"} {
		if rec := doJSON(t, h, http.MethodGet, "/api/practice/dashboard?day=2026-11-22&shuffle="+bad, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("shuffle=%s: %d, want 400", bad, rec.Code)
		}
	}
}
