package handlers_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func TestUploadBook_DedupesOnHashMatch(t *testing.T) {
	h := newTestServer(t)

	firstID, _ := uploadBook(t, h, "book.pdf", 4)

	dir := t.TempDir()
	path := dir + "/book-again.pdf"
	writeFixturePDF(t, path, 4) // identical content to the first upload
	content := readAll(t, path)

	rec := recordRequest(h, multipartUpload(t, "/api/books", "book-again.pdf", content))
	if rec.Code != http.StatusOK {
		t.Fatalf("re-upload of identical content: status %d, want 200 (dedupe hit, not 201 create); body %s", rec.Code, rec.Body.String())
	}

	var result struct {
		Book struct {
			ID int64 `json:"id"`
		} `json:"book"`
	}
	decodeData(t, rec, &result)
	if result.Book.ID != firstID {
		t.Errorf("dedupe returned book id %d, want the original %d", result.Book.ID, firstID)
	}
}

// TestUpdateBook_ResyncsSearchForInheritingPieces locks in, via the actual
// HTTP layer, what an earlier manual smoke test verified by hand: editing
// a book's composer must update search results for every piece that
// inherits it, and leave pieces with their own override untouched.
func TestUpdateBook_ResyncsSearchForInheritingPieces(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 8)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology",
		"composer":  "Original Composer",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 4},
			{"start": 5, "end": 8},
		},
		"pieces": []map[string]any{
			{"title": "Inherits"},
			{"title": "Overrides", "composer": "Own Composer"},
		},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)

	assertSearchCount(t, h, "Original", 1) // only the inheriting piece

	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology",
		"composer":  "Renamed Composer",
	}), nil)

	assertSearchCount(t, h, "Original", 0)
	assertSearchCount(t, h, "Renamed", 1)
	assertSearchCount(t, h, "Own", 1) // the override is untouched by the book edit
}

// TestUpdateBook_NormalizesISBNOnSave covers normalizeISBN end to end
// through the real handler: a value with a redundant "ISBN" label and
// hyphens comes back as bare digits, matching the same "strip on save"
// treatment IMSLP number already gets client-side (CLAUDE.md), just done
// server-side here since the digit-only invariant matters for
// hyphenation/version detection downstream, not just cosmetics.
func TestUpdateBook_NormalizesISBNOnSave(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Six Symphonies",
		"composer":  "Charles-Marie Widor",
		"isbn":      "ISBN 978-0-13-235088-4",
	}), nil)

	rec := doJSON(t, h, http.MethodGet, apiBooksURL(bookID), nil)
	var book bookResponse
	decodeData(t, rec, &book)

	if book.ISBN == nil || *book.ISBN != "9780132350884" {
		t.Errorf("isbn = %v, want %q (label and hyphens stripped)", book.ISBN, "9780132350884")
	}
}

// TestUpdateBook_ArrangerRoundTrips is a minimal smoke test for the new
// field itself (the composer-or-arranger requirement is covered at the
// api.ValidateBook unit-test level, not re-tested here).
func TestUpdateBook_ArrangerRoundTrips(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology",
		"arranger":  "J. Someone",
	}), nil)

	rec := doJSON(t, h, http.MethodGet, apiBooksURL(bookID), nil)
	var book bookResponse
	decodeData(t, rec, &book)

	if book.Arranger == nil || *book.Arranger != "J. Someone" {
		t.Errorf("arranger = %v, want %q", book.Arranger, "J. Someone")
	}
}

func TestBookPageThumbnail_ReturnsPNG(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 3)

	req := httptestGet(t, "/api/books/"+itoa(bookID)+"/pages/1/thumbnail")
	rec := recordRequest(h, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("thumbnail: status %d, body %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if rec.Body.Len() == 0 {
		t.Error("thumbnail response body is empty")
	}
}

// TestCreateBookManual_RequiresTitle locks in ValidateBook's one required
// field (CLAUDE.md > Book-level soft inheritance) for the new file-less
// creation path specifically, not just the upload/edit paths that already
// covered it.
func TestCreateBookManual_RequiresTitle(t *testing.T) {
	h := newTestServer(t)

	rec := doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"composer": "Erik Satie",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400 (bookTitle required); body %s", rec.Code, rec.Body.String())
	}
}

// TestCreateBookManual_CreatesFilelessBook is the Books library view's
// "New Book" button end to end: only bookTitle required, the book starts
// at zero pieces, and its file-related fields come back null rather than
// empty strings (migration 00014).
func TestCreateBookManual_CreatesFilelessBook(t *testing.T) {
	h := newTestServer(t)

	rec := doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Gymnopédies",
		"composer":  "Erik Satie",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201; body %s", rec.Code, rec.Body.String())
	}

	var book bookResponse
	decodeData(t, rec, &book)
	if book.BookTitle != "Gymnopédies" {
		t.Errorf("bookTitle = %q, want %q", book.BookTitle, "Gymnopédies")
	}
	if book.PieceCount != 0 {
		t.Errorf("pieceCount = %d, want 0 (nothing can attach a piece to a file-less book)", book.PieceCount)
	}
	if book.FileHash != nil {
		t.Errorf("fileHash = %v, want nil", *book.FileHash)
	}
	if book.OriginalFilename != nil {
		t.Errorf("originalFilename = %v, want nil", *book.OriginalFilename)
	}

	// The thumbnail endpoint has nothing to render from — a clean 404, not
	// a panic (guards the nil-FilePath dereference in handleBookPageThumbnail).
	thumbRec := recordRequest(h, httptestGet(t, "/api/books/"+itoa(book.ID)+"/pages/1/thumbnail"))
	if thumbRec.Code != http.StatusNotFound {
		t.Errorf("thumbnail for file-less book: status %d, want 404", thumbRec.Code)
	}
}

// TestDownloadBookFile_ReturnsFileInline covers the Book Details page's
// "Open Book PDF" button: the file downloads with an "inline" (not
// "attachment") Content-Disposition, so it opens in a new tab instead of
// forcing a save dialog — same convention as handleDownloadPieceFile.
func TestDownloadBookFile_ReturnsFileInline(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 3)

	rec := recordRequest(h, httptestGet(t, "/api/books/"+itoa(bookID)+"/file"))
	if rec.Code != http.StatusOK {
		t.Fatalf("download: status %d, body %s", rec.Code, rec.Body.String())
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "inline;") {
		t.Errorf("Content-Disposition = %q, want it to start with %q", cd, "inline;")
	}
	if rec.Body.Len() == 0 {
		t.Error("download response body is empty")
	}
}

// TestDownloadBookFile_FilelessBookReturns404 guards the nil-FilePath
// dereference for a manually created book (migration 00014) — a clean
// 404, not a panic.
func TestDownloadBookFile_FilelessBookReturns404(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Christmas Medleys",
		"composer":  "Traditional",
	})
	var book bookResponse
	decodeData(t, rec, &book)

	downloadRec := recordRequest(h, httptestGet(t, "/api/books/"+itoa(book.ID)+"/file"))
	if downloadRec.Code != http.StatusNotFound {
		t.Errorf("download for file-less book: status %d, want 404", downloadRec.Code)
	}
}

// TestListBooks_ReturnsAllAndFiltersByQuery covers the new GET /api/books
// (both a real uploaded book and a manually created one should appear —
// this endpoint isn't specific to either creation path) and its LIKE-based
// query filter.
func TestListBooks_ReturnsAllAndFiltersByQuery(t *testing.T) {
	h := newTestServer(t)
	uploadBook(t, h, "book.pdf", 2) // default title comes from the filename ("Book")

	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Gymnopédies",
		"composer":  "Erik Satie",
	}), nil)

	var all []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books", nil), &all)
	if len(all) != 2 {
		t.Fatalf("GET /api/books returned %d book(s), want 2", len(all))
	}

	var filtered []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?query=Satie", nil), &filtered)
	if len(filtered) != 1 || filtered[0].BookTitle != "Gymnopédies" {
		t.Errorf("query=Satie returned %+v, want just the Gymnopédies book", filtered)
	}
}

// TestDeleteBook_CascadeDeletesAllPieces is the Book Library context menu's
// "Delete Book" action end to end — confirmed direct instruction: this
// removes the Book *and* every Piece referencing it in one action, not the
// existing orphan-cleanup path (which only ever fires once a book's last
// piece is already gone via individual piece deletes).
func TestDeleteBook_CascadeDeletesAllPieces(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 2},
			{"start": 3, "end": 4},
		},
		"pieces": []map[string]any{
			{"title": "First", "composer": "Someone"},
			{"title": "Second", "composer": "Someone"},
		},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)

	delRec := doJSON(t, h, http.MethodDelete, apiBooksURL(bookID), nil)
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete book: status %d, body %s", delRec.Code, delRec.Body.String())
	}

	if rec := doJSON(t, h, http.MethodGet, apiBooksURL(bookID), nil); rec.Code != http.StatusNotFound {
		t.Errorf("book after delete: status %d, want 404", rec.Code)
	}
	for _, p := range result.Pieces {
		if rec := doJSON(t, h, http.MethodGet, apiPiecesURL(p.ID), nil); rec.Code != http.StatusNotFound {
			t.Errorf("piece %d (%q) after book delete: status %d, want 404", p.ID, p.Title, rec.Code)
		}
	}

	// A search that would have matched a deleted piece must also come up
	// empty — proves the pieces_fts rows were cleaned up, not just the
	// pieces table (CLAUDE.md > Search: resync must happen in the same
	// transaction as the mutation).
	assertSearchCount(t, h, "Someone", 0)
}

// TestDeleteBook_DoesNotRemoveFileStillReferencedOutsideTheBook mirrors
// TestDeletePiece_DoesNotRemoveFileStillReferencedByAnotherPiece for the
// cascade path: storage is content-addressed and piece uploads aren't
// hash-deduped (CLAUDE.md > File handling), so a piece with no relation to
// this book at all can legitimately share its on-disk file with one of the
// book's pieces. Deleting the book must not take that unrelated piece's
// file down with it.
func TestDeleteBook_DoesNotRemoveFileStillReferencedOutsideTheBook(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 2)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 2}},
		"pieces": []map[string]any{{"title": "In The Book", "composer": "Someone"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	inBookPiece := result.Pieces[0]

	inBookRow, err := repo.GetPieceByID(context.Background(), conn, inBookPiece.ID)
	if err != nil {
		t.Fatalf("fetching in-book piece row: %v", err)
	}
	outsideID, err := repo.CreatePiece(context.Background(), conn, &models.Piece{
		Title:     "Outside The Book",
		FilePath:  inBookRow.FilePath,
		FileHash:  inBookRow.FileHash,
		PageCount: inBookRow.PageCount,
	})
	if err != nil {
		t.Fatalf("fabricating outside piece sharing the same file: %v", err)
	}

	decodeData(t, doJSON(t, h, http.MethodDelete, apiBooksURL(bookID), nil), nil)

	downloadRec := recordRequest(h, httptestGet(t, apiPiecesURL(outsideID)+"/file"))
	if downloadRec.Code != http.StatusOK {
		t.Fatalf("downloading the outside piece after the book (sharing its file) was deleted: status %d, want 200 — the shared file must survive", downloadRec.Code)
	}
	if downloadRec.Body.Len() == 0 {
		t.Error("outside piece's file is empty after the book's deletion")
	}
}

func assertSearchCount(t *testing.T, h http.Handler, query string, want int) {
	t.Helper()
	rec := doJSON(t, h, http.MethodGet, "/api/pieces?query="+query, nil)
	var results []pieceResponse
	decodeData(t, rec, &results)
	if len(results) != want {
		t.Errorf("search %q returned %d result(s), want %d", query, len(results), want)
	}
}
