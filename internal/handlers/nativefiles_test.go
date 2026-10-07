package handlers_test

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// The desktop app's Download and Open PDF go through these two endpoints
// (nativefiles.go), which re-request the file through the app's own
// handler: the saved/opened file must be byte-identical to a normal
// download, a cancel must write nothing, and only this app's own /api/
// paths may be fetched.
func TestNativeSaveAndOpenFile(t *testing.T) {
	native, _ := fakeNativeOptions(t)
	saveTo := filepath.Join(t.TempDir(), "chosen.pdf")
	var suggested, opened string
	cancel := false
	native.SaveFile = func(defaultName string) (string, error) {
		suggested = defaultName
		if cancel {
			return "", nil
		}
		return saveTo, nil
	}
	native.OpenPath = func(path string) error {
		opened = path
		return nil
	}
	h, _ := newNativeTestServer(t, "none", native)
	bookID, _ := uploadBook(t, h, "Nocturnes.pdf", 3)
	fileURL := fmt.Sprintf("/api/books/%d/file", bookID)

	direct := doJSON(t, h, http.MethodGet, fileURL, nil)
	if direct.Code != http.StatusOK {
		t.Fatalf("direct download: status %d", direct.Code)
	}

	rec := doJSON(t, h, http.MethodPost, "/api/native/save-file", map[string]string{"url": fileURL})
	if rec.Code != http.StatusOK {
		t.Fatalf("save-file: status %d, body %s", rec.Code, rec.Body.String())
	}
	if suggested == "" || filepath.Ext(suggested) != ".pdf" {
		t.Errorf("suggested name = %q, want a .pdf download name", suggested)
	}
	saved, err := os.ReadFile(saveTo)
	if err != nil {
		t.Fatalf("reading saved file: %v", err)
	}
	if string(saved) != direct.Body.String() {
		t.Errorf("saved file differs from a direct download (%d vs %d bytes)", len(saved), direct.Body.Len())
	}

	cancel = true
	os.Remove(saveTo)
	rec = doJSON(t, h, http.MethodPost, "/api/native/save-file", map[string]string{"url": fileURL})
	if rec.Code != http.StatusOK {
		t.Fatalf("canceled save-file: status %d", rec.Code)
	}
	if _, err := os.Stat(saveTo); !os.IsNotExist(err) {
		t.Errorf("a canceled save still wrote %s", saveTo)
	}

	rec = doJSON(t, h, http.MethodPost, "/api/native/open-file", map[string]string{"url": fileURL})
	if rec.Code != http.StatusOK {
		t.Fatalf("open-file: status %d, body %s", rec.Code, rec.Body.String())
	}
	got, err := os.ReadFile(opened)
	if err != nil {
		t.Fatalf("reading opened file %q: %v", opened, err)
	}
	if string(got) != direct.Body.String() {
		t.Errorf("opened file differs from a direct download")
	}
	os.Remove(opened)

	// A file the app doesn't have relays the app's own 404.
	rec = doJSON(t, h, http.MethodPost, "/api/native/open-file", map[string]string{"url": "/api/books/99999/file"})
	if rec.Code != http.StatusNotFound {
		t.Errorf("missing book: status %d, want 404", rec.Code)
	}

	// Never another host, never a non-API path.
	for _, bad := range []string{"https://example.com/x.pdf", "//example.com/x.pdf", "/books/1"} {
		rec = doJSON(t, h, http.MethodPost, "/api/native/save-file", map[string]string{"url": bad})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("url %q: status %d, want 400", bad, rec.Code)
		}
	}
}

func TestNativeFileEndpoints_404OnDocker(t *testing.T) {
	h := newTestServer(t)
	for _, path := range []string{"/api/native/save-file", "/api/native/open-file"} {
		rec := doJSON(t, h, http.MethodPost, path, map[string]string{"url": "/api/books/1/file"})
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s on docker: status %d, want 404", path, rec.Code)
		}
	}
}
