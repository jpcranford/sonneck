package handlers_test

import (
	"net/http"
	"testing"
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
	WantToLearn   []dashPiece `json:"wantToLearn"`
	Learned       []dashPiece `json:"learned"`
	PracticeDays  []string    `json:"practiceDays"`
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

	// a, then b set to Learning: b is the more recent change. Setting a to
	// Learning again changes nothing, so a stays behind b.
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

	if ids := dashIDs(got.Practicing); !equalIDs(ids, []int64{b, a}) {
		t.Errorf("practicing = %v, want [b a] = %v", ids, []int64{b, a})
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
