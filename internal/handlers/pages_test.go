package handlers_test

import (
	"context"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func pagePath(dataDir, hash string, page int) string {
	return filepath.Join(dataDir, "cache", "pages", "v2", hash, fmt.Sprintf("%d.png", page))
}

func uploadPagesPiece(t *testing.T, h http.Handler, pages int) pieceResponse {
	t.Helper()
	path := filepath.Join(t.TempDir(), "piece.pdf")
	writeFixturePDF(t, path, pages)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: status %d, body %s", rec.Code, rec.Body.String())
	}
	var p pieceResponse
	decodeData(t, rec, &p)
	return p
}

// A page is an 8-bit grayscale PNG at 300ppi, cached by file hash, and a
// versioned URL may be kept for good.
func TestPiecePage_ServesGrayPNG(t *testing.T) {
	h, dataDir, _ := newTestServerWithDataDir(t)
	p := uploadPagesPiece(t, h, 2)

	rec := recordRequest(h, httptestGet(t, fmt.Sprintf("/api/pieces/%d/pages/2?v=x", p.ID)))
	if rec.Code != http.StatusOK {
		t.Fatalf("page: status %d, body %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q, want the immutable one for a versioned URL", cc)
	}
	img, err := png.Decode(rec.Body)
	if err != nil {
		t.Fatalf("decoding page: %v", err)
	}
	if _, ok := img.(*image.Gray); !ok {
		t.Errorf("page decodes as %T, want *image.Gray", img)
	}
	if b := img.Bounds(); b.Dx() != 2550 || b.Dy() != 3300 {
		t.Errorf("page is %dx%d, want 2550x3300 (Letter at 300ppi)", b.Dx(), b.Dy())
	}
	if _, err := os.Stat(pagePath(dataDir, p.FileHash, 2)); err != nil {
		t.Errorf("page not cached by file hash: %v", err)
	}
}

func TestPiecePage_RejectsPageOutOfRange(t *testing.T) {
	h := newTestServer(t)
	p := uploadPagesPiece(t, h, 2)
	for _, page := range []string{"0", "3", "x"} {
		rec := recordRequest(h, httptestGet(t, fmt.Sprintf("/api/pieces/%d/pages/%s", p.ID, page)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("page %s: status %d, want 400", page, rec.Code)
		}
	}
}

// The Sheet Viewer is practice-gated, so its pages are too.
func TestPiecePage_RequiresPractice(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	p := uploadPagesPiece(t, h, 1)
	if _, err := conn.Exec(`DELETE FROM user_permissions WHERE user_id = 1 AND permission IN ('admin', 'practice')`); err != nil {
		t.Fatal(err)
	}
	if rec := recordRequest(h, httptestGet(t, fmt.Sprintf("/api/pieces/%d/pages/1", p.ID))); rec.Code != http.StatusForbidden {
		t.Errorf("page without practice: status %d, want 403", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodPost, fmt.Sprintf("/api/pieces/%d/pages/prepare", p.ID), nil); rec.Code != http.StatusForbidden {
		t.Errorf("prepare without practice: status %d, want 403", rec.Code)
	}
}

// Opening a piece renders all its pages in the background.
func TestPreparePiecePages_RendersEveryPage(t *testing.T) {
	h, dataDir, _ := newTestServerWithDataDir(t)
	p := uploadPagesPiece(t, h, 3)

	rec := doJSON(t, h, http.MethodPost, fmt.Sprintf("/api/pieces/%d/pages/prepare", p.ID), nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("prepare: status %d, body %s", rec.Code, rec.Body.String())
	}
	var got struct {
		PageCount int `json:"pageCount"`
	}
	decodeData(t, rec, &got)
	if got.PageCount != 3 {
		t.Errorf("pageCount = %d, want 3", got.PageCount)
	}
	deadline := time.Now().Add(60 * time.Second)
	for page := 1; page <= 3; page++ {
		for {
			if _, err := os.Stat(pagePath(dataDir, p.FileHash, page)); err == nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("page %d never rendered", page)
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

// Deleting a piece takes its cached pages with its file.
func TestDeletePiece_RemovesCachedPages(t *testing.T) {
	h, dataDir, _ := newTestServerWithDataDir(t)
	p := uploadPagesPiece(t, h, 1)
	if rec := recordRequest(h, httptestGet(t, fmt.Sprintf("/api/pieces/%d/pages/1", p.ID))); rec.Code != http.StatusOK {
		t.Fatalf("page: status %d", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodDelete, apiPiecesURL(p.ID), nil); rec.Code != http.StatusOK && rec.Code != http.StatusNoContent {
		t.Fatalf("delete: status %d, body %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Dir(pagePath(dataDir, p.FileHash, 1))); !os.IsNotExist(err) {
		t.Errorf("cached pages still there after delete (err = %v)", err)
	}
}

// Replacing a piece's file drops the old file's pages; the new file renders
// under its own hash.
func TestReplacePieceFile_RemovesOldPages(t *testing.T) {
	h, dataDir, _ := newTestServerWithDataDir(t)
	p := uploadPagesPiece(t, h, 2)
	if rec := recordRequest(h, httptestGet(t, fmt.Sprintf("/api/pieces/%d/pages/1", p.ID))); rec.Code != http.StatusOK {
		t.Fatalf("page: status %d", rec.Code)
	}
	replacement := filepath.Join(t.TempDir(), "replacement.pdf")
	writeFixturePDF(t, replacement, 1)
	rec := recordRequest(h, multipartUpload(t, apiPiecesURL(p.ID)+"/replace-file", "replacement.pdf", readAll(t, replacement)))
	if rec.Code != http.StatusOK {
		t.Fatalf("replace: status %d, body %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Dir(pagePath(dataDir, p.FileHash, 1))); !os.IsNotExist(err) {
		t.Errorf("old file's pages still there after replace (err = %v)", err)
	}
}

func TestCleanupPages(t *testing.T) {
	s, h, dataDir := newCleanupServer(t)
	p := uploadPagesPiece(t, h, 2)
	if rec := recordRequest(h, httptestGet(t, fmt.Sprintf("/api/pieces/%d/pages/1", p.ID))); rec.Code != http.StatusOK {
		t.Fatalf("page: status %d", rec.Code)
	}
	dir := filepath.Dir(pagePath(dataDir, p.FileHash, 1))
	write := func(path string, content string, age time.Duration) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		old := time.Now().Add(-age)
		os.Chtimes(path, old, old)
	}
	write(filepath.Join(dataDir, "cache", "pages", "v1", p.FileHash, "1.png"), "old version", 0)  // older render version
	write(filepath.Join(dataDir, "cache", "pages", "v2", "deadbeef", "1.png"), "no such file", 0) // no piece has it
	write(filepath.Join(dir, "3.png"), "past the end", 0)                                         // the piece has 2 pages
	write(filepath.Join(dir, "2.png"), "not a png", 0)                                            // unreadable
	write(filepath.Join(dir, "1-123.tmp"), "", 2*time.Hour)                                       // leftover temp
	write(filepath.Join(dir, "2-456.tmp"), "", 0)                                                 // a render in progress
	write(filepath.Join(dir, "notes.txt"), "", 2*time.Hour)                                       // unknown: left alone

	removed, err := s.CleanupPages(context.Background())
	if err != nil {
		t.Fatalf("CleanupPages: %v", err)
	}
	if removed != 5 {
		t.Errorf("removed %d files, want 5", removed)
	}
	for name, want := range map[string]bool{
		"1.png": true, "2.png": false, "3.png": false, "1-123.tmp": false, "2-456.tmp": true, "notes.txt": true,
	} {
		_, err := os.Stat(filepath.Join(dir, name))
		if got := err == nil; got != want {
			t.Errorf("%s exists = %v, want %v", name, got, want)
		}
	}
	for _, gone := range []string{filepath.Join(dataDir, "cache", "pages", "v1"), filepath.Join(dataDir, "cache", "pages", "v2", "deadbeef")} {
		if _, err := os.Stat(gone); !os.IsNotExist(err) {
			t.Errorf("%s still there", gone)
		}
	}
}

// regenerate-pages with no IDs redraws only pieces that already have pages,
// and changes the page URLs' version.
func TestRegeneratePages(t *testing.T) {
	s, h, dataDir := newCleanupServer(t)
	opened := uploadPagesPiece(t, h, 2)
	path := filepath.Join(t.TempDir(), "other.pdf")
	writeFixturePDF(t, path, 3) // different page count, so different bytes
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "other.pdf", readAll(t, path)))
	var never pieceResponse
	decodeData(t, rec, &never)
	if rec := recordRequest(h, httptestGet(t, fmt.Sprintf("/api/pieces/%d/pages/1", opened.ID))); rec.Code != http.StatusOK {
		t.Fatalf("page: status %d", rec.Code)
	}

	var before struct {
		PagesVersion string `json:"pagesVersion"`
	}
	decodeData(t, recordRequest(h, httptestGet(t, "/api/config")), &before)

	count, err := s.RegeneratePages(context.Background(), nil)
	if err != nil {
		t.Fatalf("RegeneratePages: %v", err)
	}
	if count != 2 {
		t.Errorf("regenerated %d pages, want 2 (only the opened piece)", count)
	}
	if _, err := os.Stat(pagePath(dataDir, opened.FileHash, 2)); err != nil {
		t.Errorf("opened piece's page 2 not rendered: %v", err)
	}
	if _, err := os.Stat(filepath.Dir(pagePath(dataDir, never.FileHash, 1))); !os.IsNotExist(err) {
		t.Errorf("a never-opened piece got pages")
	}

	var after struct {
		PagesVersion string `json:"pagesVersion"`
	}
	decodeData(t, recordRequest(h, httptestGet(t, "/api/config")), &after)
	if before.PagesVersion != "2" || after.PagesVersion == before.PagesVersion {
		t.Errorf("pagesVersion %q → %q, want \"2\" then a redrawn version", before.PagesVersion, after.PagesVersion)
	}
}
