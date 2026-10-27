package handlers_test

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/jpcranford/sonneck/internal/repo"
)

// The Sheet Viewer's Info panel saves notes through their own endpoint:
// sets and clears the caller's notes without an `edit`-gated piece write,
// and needs `practice`.
func TestSetPieceUserNotes(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	pieceID := uploadTestPiece(t, h)
	url := apiPiecesURL(pieceID) + "/user-notes"

	type notesOnly struct {
		UserNotes *string `json:"userNotes"`
	}
	read := func() *string {
		var got notesOnly
		decodeData(t, doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID), nil), &got)
		return got.UserNotes
	}

	rec := doJSON(t, h, http.MethodPatch, url, map[string]any{"userNotes": "Slow the coda."})
	if rec.Code != http.StatusOK {
		t.Fatalf("set: status %d, body %s", rec.Code, rec.Body.String())
	}
	var set notesOnly
	decodeData(t, rec, &set)
	if set.UserNotes == nil || *set.UserNotes != "Slow the coda." {
		t.Errorf("response userNotes = %v, want the new notes", set.UserNotes)
	}
	if got := read(); got == nil || *got != "Slow the coda." {
		t.Errorf("stored userNotes = %v, want the new notes", got)
	}

	if rec := doJSON(t, h, http.MethodPatch, url, map[string]any{"userNotes": ""}); rec.Code != http.StatusOK {
		t.Fatalf("clear: status %d, body %s", rec.Code, rec.Body.String())
	}
	if got := read(); got != nil {
		t.Errorf("userNotes after clearing = %q, want none", *got)
	}

	if rec := doJSON(t, h, http.MethodPatch, apiPiecesURL(99999)+"/user-notes", map[string]any{"userNotes": "x"}); rec.Code != http.StatusNotFound {
		t.Errorf("missing piece: status %d, want 404", rec.Code)
	}

	if _, err := conn.Exec(`DELETE FROM user_permissions WHERE user_id = 1 AND permission IN ('admin', 'practice')`); err != nil {
		t.Fatal(err)
	}
	if rec := doJSON(t, h, http.MethodPatch, url, map[string]any{"userNotes": "x"}); rec.Code != http.StatusForbidden {
		t.Errorf("without practice: status %d, want 403", rec.Code)
	}
}

// Per-piece viewer settings: the defaults until saved, a full replace,
// photo steps checked, back-to-defaults removes the row (a banner the user
// hid on purpose isn't a default), and `practice` required.
func TestPracticeSettings(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	pieceID := uploadTestPiece(t, h)
	url := apiPiecesURL(pieceID) + "/practice-settings"

	var got repo.PracticeSettings
	decodeData(t, doJSON(t, h, http.MethodGet, url, nil), &got)
	if !reflect.DeepEqual(got, repo.DefaultPracticeSettings) || got.NotesBarShown != nil {
		t.Fatalf("unsaved settings = %+v, want the defaults, banner not chosen", got)
	}

	shown := true
	want := repo.PracticeSettings{Brightness: 120, Contrast: 80, Grayscale: true, EdgeMargin: true, NotesBarShown: &shown}
	if rec := doJSON(t, h, http.MethodPut, url, want); rec.Code != http.StatusOK {
		t.Fatalf("PUT: status %d, body %s", rec.Code, rec.Body.String())
	}
	got = repo.PracticeSettings{}
	decodeData(t, doJSON(t, h, http.MethodGet, url, nil), &got)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("after saving, got %+v, want %+v", got, want)
	}

	for _, bad := range []repo.PracticeSettings{
		{Brightness: 125, Contrast: 100},
		{Brightness: 100, Contrast: 40},
		{Brightness: 160, Contrast: 100},
	} {
		if rec := doJSON(t, h, http.MethodPut, url, bad); rec.Code != http.StatusBadRequest {
			t.Errorf("PUT %+v: status %d, want 400", bad, rec.Code)
		}
	}

	if rec := doJSON(t, h, http.MethodPut, url, repo.DefaultPracticeSettings); rec.Code != http.StatusOK {
		t.Fatalf("PUT defaults: status %d", rec.Code)
	}
	countRows := func() int {
		var rows int
		if err := conn.QueryRow(`SELECT COUNT(*) FROM piece_practice_settings`).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if rows := countRows(); rows != 0 {
		t.Errorf("rows after saving the defaults = %d, want 0", rows)
	}

	hidden := false
	hiddenOnly := repo.PracticeSettings{Brightness: 100, Contrast: 100, NotesBarShown: &hidden}
	if rec := doJSON(t, h, http.MethodPut, url, hiddenOnly); rec.Code != http.StatusOK {
		t.Fatalf("PUT hidden banner: status %d", rec.Code)
	}
	got = repo.PracticeSettings{}
	decodeData(t, doJSON(t, h, http.MethodGet, url, nil), &got)
	if got.NotesBarShown == nil || *got.NotesBarShown {
		t.Errorf("banner hidden on purpose read back as %v, want false", got.NotesBarShown)
	}
	if rows := countRows(); rows != 1 {
		t.Errorf("rows after hiding the banner = %d, want 1", rows)
	}

	if rec := doJSON(t, h, http.MethodGet, apiPiecesURL(99999)+"/practice-settings", nil); rec.Code != http.StatusNotFound {
		t.Errorf("missing piece: status %d, want 404", rec.Code)
	}

	if _, err := conn.Exec(`DELETE FROM user_permissions WHERE user_id = 1 AND permission IN ('admin', 'practice')`); err != nil {
		t.Fatal(err)
	}
	if rec := doJSON(t, h, http.MethodGet, url, nil); rec.Code != http.StatusForbidden {
		t.Errorf("GET without practice: status %d, want 403", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodPut, url, want); rec.Code != http.StatusForbidden {
		t.Errorf("PUT without practice: status %d, want 403", rec.Code)
	}
}
