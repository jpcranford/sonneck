package handlers_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jpcranford/sonneck/internal/repo"
)

type annotationsData struct {
	Pages map[string][]map[string]any `json:"pages"`
}

// The viewer's annotations: saved a page at a time, read back in drawing
// order with only each kind's own fields, cleared by an empty page, checked
// on the way in, kept to the caller, and `practice` required.
func TestAnnotations(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	pieceID := uploadTestPiece(t, h)
	base := apiPiecesURL(pieceID) + "/annotations"

	var got annotationsData
	decodeData(t, doJSON(t, h, http.MethodGet, base, nil), &got)
	if len(got.Pages) != 0 {
		t.Fatalf("a new piece has marks: %v", got.Pages)
	}

	marks := []map[string]any{
		{"id": "m1", "kind": "stroke", "tool": "pen", "layer": 5, "size": 0.39, "pressure": true,
			"points": [][]float64{{0.1, 0.2, 0.5}, {0.15, 0.22, 0.7}}, "stray": "dropped"},
		{"id": "t1", "kind": "text", "layer": 2, "x": 0.3, "y": 0.1, "size": 1.8, "text": "Sw. to Gt.\n:pp: sub."},
	}
	if rec := doJSON(t, h, http.MethodPut, base+"/1", map[string]any{"marks": marks}); rec.Code != http.StatusOK {
		t.Fatalf("PUT: status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, doJSON(t, h, http.MethodGet, base, nil), &got)
	page := got.Pages["1"]
	if len(page) != 2 || page[0]["id"] != "m1" || page[1]["text"] != "Sw. to Gt.\n:pp: sub." {
		t.Fatalf("page 1 read back as %v", page)
	}
	if _, ok := page[0]["stray"]; ok {
		t.Error("an unknown field was stored")
	}
	if _, ok := page[0]["x"]; ok {
		t.Error("a stroke picked up a text mark's fields")
	}

	for name, bad := range map[string][]map[string]any{
		"unknown color": {{"id": "a", "kind": "stroke", "tool": "pen", "layer": 6, "size": 0.4, "points": [][]float64{{0.1, 0.1, 0.5}}}},
		"unknown kind":  {{"id": "a", "kind": "stamp", "layer": 0, "size": 1}},
		"off the page":  {{"id": "a", "kind": "stroke", "tool": "pen", "layer": 0, "size": 0.4, "points": [][]float64{{3, 0.1, 0.5}}}},
		"short point":   {{"id": "a", "kind": "stroke", "tool": "pen", "layer": 0, "size": 0.4, "points": [][]float64{{0.1, 0.1}}}},
		"empty text":    {{"id": "a", "kind": "text", "layer": 0, "x": 0.1, "y": 0.1, "size": 1.8, "text": ""}},
		"repeated id": {
			{"id": "a", "kind": "text", "layer": 0, "x": 0.1, "y": 0.1, "size": 1.8, "text": "x"},
			{"id": "a", "kind": "text", "layer": 0, "x": 0.2, "y": 0.1, "size": 1.8, "text": "y"},
		},
	} {
		if rec := doJSON(t, h, http.MethodPut, base+"/1", map[string]any{"marks": bad}); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, rec.Code)
		}
	}
	if rec := doJSON(t, h, http.MethodPut, base+"/99", map[string]any{"marks": marks}); rec.Code != http.StatusBadRequest {
		t.Errorf("a page past the end: status %d, want 400", rec.Code)
	}

	// Another account's marks on the same page stay apart.
	if _, err := conn.Exec(`INSERT INTO users (id, display_name) VALUES (2, 'Other')`); err != nil {
		t.Fatal(err)
	}
	other, count, err := repo.NormalizeMarks(json.RawMessage(`[{"id":"o","kind":"text","layer":0,"x":0.5,"y":0.5,"size":1.8,"text":"theirs"}]`))
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SetPageAnnotations(t.Context(), conn, 2, pieceID, 1, other, count); err != nil {
		t.Fatal(err)
	}
	decodeData(t, doJSON(t, h, http.MethodGet, base, nil), &got)
	if len(got.Pages["1"]) != 2 {
		t.Errorf("another account's mark showed up: %v", got.Pages["1"])
	}

	if rec := doJSON(t, h, http.MethodPut, base+"/1", map[string]any{"marks": []any{}}); rec.Code != http.StatusOK {
		t.Fatalf("clearing: status %d", rec.Code)
	}
	var rows int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM piece_annotations WHERE user_id = 1`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("rows after clearing the page = %d, want 0", rows)
	}

	if _, err := conn.Exec(`DELETE FROM user_permissions WHERE user_id = 1 AND permission IN ('admin', 'practice')`); err != nil {
		t.Fatal(err)
	}
	if rec := doJSON(t, h, http.MethodGet, base, nil); rec.Code != http.StatusForbidden {
		t.Errorf("GET without practice: status %d, want 403", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodPut, base+"/1", map[string]any{"marks": marks}); rec.Code != http.StatusForbidden {
		t.Errorf("PUT without practice: status %d, want 403", rec.Code)
	}
}

// Hidden colors save per piece as a bitmask of the six colors.
func TestPracticeSettings_HiddenColors(t *testing.T) {
	h, _ := newTestServerWithDB(t)
	url := apiPiecesURL(uploadTestPiece(t, h)) + "/practice-settings"
	want := repo.PracticeSettings{Brightness: 100, Contrast: 100, HiddenColors: 0b100001}
	if rec := doJSON(t, h, http.MethodPut, url, want); rec.Code != http.StatusOK {
		t.Fatalf("PUT: status %d", rec.Code)
	}
	var got repo.PracticeSettings
	decodeData(t, doJSON(t, h, http.MethodGet, url, nil), &got)
	if got.HiddenColors != want.HiddenColors {
		t.Errorf("hiddenColors = %b, want %b", got.HiddenColors, want.HiddenColors)
	}
	if rec := doJSON(t, h, http.MethodPut, url, repo.PracticeSettings{Brightness: 100, Contrast: 100, HiddenColors: 64}); rec.Code != http.StatusBadRequest {
		t.Errorf("a seventh color: status %d, want 400", rec.Code)
	}
}

// Ghost marks (User Settings) are on by default and save.
func TestUserSettings_GhostMarks(t *testing.T) {
	h := newTestServer(t)
	var s repo.UserSettings
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/user-settings", nil), &s)
	if !s.GhostMarks {
		t.Fatal("ghostMarks should default to true")
	}
	if rec := doJSON(t, h, http.MethodPatch, "/api/user-settings", map[string]any{"ghostMarks": false}); rec.Code != http.StatusOK {
		t.Fatalf("PATCH: status %d", rec.Code)
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/user-settings", nil), &s)
	if s.GhostMarks {
		t.Error("ghostMarks didn't save as off")
	}
}
