package handlers_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/handlers"
	"github.com/jpcranford/sonneck/internal/testutil"
)

// newTestServer wires up a real handler against a fresh temp DB and temp
// DATA_DIR (migrations applied, WAL mode on — same code path production
// uses), so these tests exercise the actual HTTP layer end to end rather
// than mocking anything.
func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	h, _ := newTestServerWithDB(t)
	return h
}

// newTestServerWithDB is newTestServer plus the underlying *sql.DB, for the
// rare test that needs to fabricate state the HTTP API itself won't produce
// (e.g. two Piece rows sharing a file hash — see piece_test.go).
func newTestServerWithDB(t *testing.T) (http.Handler, *sql.DB) {
	t.Helper()
	dataDir := t.TempDir()

	conn, err := db.Open(filepath.Join(dataDir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	cfg := &config.Config{DataDir: dataDir}
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	return handlers.New(conn, cfg, logger), conn
}

// writeFixturePDF is a thin wrapper over the shared fixture generator
// (internal/testutil) — kept so every other test file in this package can
// keep calling the short local name.
func writeFixturePDF(t *testing.T, path string, pageCount int) {
	testutil.WriteFixturePDF(t, path, pageCount)
}

func multipartUpload(t *testing.T, url, filename string, content []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("creating multipart field: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("writing multipart content: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("closing multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, url, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func doJSON(t *testing.T, h http.Handler, method, url string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshaling request body: %v", err)
		}
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, url, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeData(t *testing.T, rec *httptest.ResponseRecorder, dst any) {
	t.Helper()
	var envelope struct {
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding envelope (status %d, body %s): %v", rec.Code, rec.Body.String(), err)
	}
	if envelope.Error != nil {
		t.Fatalf("unexpected error response (status %d): %s: %s", rec.Code, envelope.Error.Code, envelope.Error.Message)
	}
	if dst != nil {
		if err := json.Unmarshal(envelope.Data, dst); err != nil {
			t.Fatalf("decoding data field: %v", err)
		}
	}
}

func uploadBook(t *testing.T, h http.Handler, filename string, pageCount int) (bookID int64, pageCountResp int) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, filename)
	writeFixturePDF(t, path, pageCount)
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}

	req := multipartUpload(t, "/api/books", filename, content)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload book: status %d, body %s", rec.Code, rec.Body.String())
	}

	var result struct {
		Book struct {
			ID int64 `json:"id"`
		} `json:"book"`
		PageCount int `json:"pageCount"`
	}
	decodeData(t, rec, &result)
	return result.Book.ID, result.PageCount
}

type effectiveString struct {
	Value     string `json:"value"`
	Inherited bool   `json:"inherited"`
}

type tagStub struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type pieceResponse struct {
	ID              int64           `json:"id"`
	Title           string          `json:"title"`
	Composer        effectiveString `json:"composer"`
	Keys            []tagStub       `json:"keys"`
	SourcePageStart *int            `json:"sourcePageStart"`
	SourcePageEnd   *int            `json:"sourcePageEnd"`
	Duration        *int            `json:"duration"`
	BPM             *int            `json:"bpm"`
	MeasureCount    *int            `json:"measureCount"`
	BeatsPerMeasure *int            `json:"beatsPerMeasure"`
	FileHash        string          `json:"fileHash"`
	SourceBookID    *int64          `json:"sourceBookId"`
	SourceBookTitle *string         `json:"sourceBookTitle"`
	PageCount       int             `json:"pageCount"`
	ThumbnailPage   int             `json:"thumbnailPage"`
}

// bookResponse mirrors api.BookResponse's wire shape for tests that only
// need a handful of fields — OriginalFilename/FileHash stay pointers here
// specifically so file-less-book tests can assert they come back nil
// (migration 00014) rather than empty strings.
type bookResponse struct {
	ID               int64   `json:"id"`
	BookTitle        string  `json:"bookTitle"`
	Composer         *string `json:"composer"`
	OriginalFilename *string `json:"originalFilename"`
	FileHash         *string `json:"fileHash"`
	PieceCount       int     `json:"pieceCount"`
}

func readAll(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading file %s: %v", path, err)
	}
	return content
}

func recordRequest(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func httptestGet(t *testing.T, url string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, url, nil)
}

func itoa(id int64) string {
	return fmt.Sprintf("%d", id)
}
