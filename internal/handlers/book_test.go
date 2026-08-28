package handlers_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
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

func TestListBooks_SortsByTitleAndComposer(t *testing.T) {
	h := newTestServer(t)
	var zebra, apple bookResponse
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Zebra Etudes", "composer": "Yellowman",
	}), &zebra)
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Apple Sonatas", "composer": "Aardvark",
	}), &apple)

	var byTitle []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?sort=title&dir=asc", nil), &byTitle)
	if len(byTitle) != 2 || byTitle[0].ID != apple.ID || byTitle[1].ID != zebra.ID {
		t.Errorf("sort=title&dir=asc returned %+v, want [Apple, Zebra]", byTitle)
	}

	var byComposer []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?sort=composer&dir=asc", nil), &byComposer)
	if len(byComposer) != 2 || byComposer[0].ID != apple.ID || byComposer[1].ID != zebra.ID {
		t.Errorf("sort=composer&dir=asc returned %+v, want [Apple/Aardvark, Zebra/Yellowman]", byComposer)
	}
}

// TestListBooks_SortsByYearWrittenHandlesNonNumericAndNull proves the
// direction-invariant "junk sorts last" clause actually works both ways,
// not just in the default direction — a book with no year and one with
// free-text (non-numeric) content must both trail whether the numeric one
// is sorted earliest-first or latest-first.
func TestListBooks_SortsByYearWrittenHandlesNonNumericAndNull(t *testing.T) {
	h := newTestServer(t)
	var numeric, freeText, blank bookResponse
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Numeric Year", "composer": "Someone", "yearWritten": "1848",
	}), &numeric)
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Free Text Year", "composer": "Someone", "yearWritten": "ca. 1708-1711",
	}), &freeText)
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "No Year", "composer": "Someone",
	}), &blank)

	for _, dir := range []string{"asc", "desc"} {
		var results []bookResponse
		decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?sort=yearWritten&dir="+dir, nil), &results)
		if len(results) != 3 || results[0].ID != numeric.ID {
			t.Fatalf("sort=yearWritten&dir=%s returned %+v, want the numeric-year book first", dir, results)
		}
		trailingIDs := map[int64]bool{results[1].ID: true, results[2].ID: true}
		if !trailingIDs[freeText.ID] || !trailingIDs[blank.ID] {
			t.Errorf("sort=yearWritten&dir=%s: free-text/blank years must both trail, got %+v", dir, results)
		}
	}
}

func TestListBooks_FiltersBySheetTypeIdAndInstrumentId(t *testing.T) {
	h := newTestServer(t)
	var scoreBook bookResponse
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Full Score Book", "composer": "Someone",
	}), &scoreBook)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(scoreBook.ID), map[string]any{
		"bookTitle": scoreBook.BookTitle, "composer": "Someone",
		"sheetTypeName": "Ensemble Piece – Full Score", "instruments": []string{"Violin"},
	}), nil)

	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Unrelated Book", "composer": "Someone",
	}), nil)

	var sheetTypes []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/sheet-types", nil), &sheetTypes)
	var ensembleID int64
	for _, st := range sheetTypes {
		if st.Name == "Ensemble Piece – Full Score" {
			ensembleID = st.ID
		}
	}
	if ensembleID == 0 {
		t.Fatal("could not find seeded Ensemble Piece – Full Score sheet type")
	}

	var bySheetType []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?sheetTypeId="+itoa(ensembleID), nil), &bySheetType)
	if len(bySheetType) != 1 || bySheetType[0].ID != scoreBook.ID {
		t.Errorf("sheetTypeId filter returned %+v, want exactly [%d]", bySheetType, scoreBook.ID)
	}

	var instruments []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/instruments", nil), &instruments)
	var violinID int64
	for _, inst := range instruments {
		if inst.Name == "Violin" {
			violinID = inst.ID
		}
	}
	if violinID == 0 {
		t.Fatal("could not find the Violin instrument created via the book edit")
	}

	var byInstrument []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?instrumentId="+itoa(violinID), nil), &byInstrument)
	if len(byInstrument) != 1 || byInstrument[0].ID != scoreBook.ID {
		t.Errorf("instrumentId filter returned %+v, want exactly [%d]", byInstrument, scoreBook.ID)
	}
}

// TestListBooks_FiltersByCommaSeparatedSheetTypeIdAndInstrumentId covers the
// Filter Drawer's real multi-select behavior on Books (checking two Sheet
// Type or Instrument boxes at once, OR-matched) — mirrors
// TestSearchPieces_FiltersByMultipleKeyIds for the piece side.
func TestListBooks_FiltersByCommaSeparatedSheetTypeIdAndInstrumentId(t *testing.T) {
	h := newTestServer(t)
	var soloBook bookResponse
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Solo Book", "composer": "Someone",
	}), &soloBook)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(soloBook.ID), map[string]any{
		"bookTitle": soloBook.BookTitle, "composer": "Someone",
		"sheetTypeName": "Solo Piece", "instruments": []string{"Piano"},
	}), nil)

	var ensembleBook bookResponse
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Ensemble Book", "composer": "Someone",
	}), &ensembleBook)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(ensembleBook.ID), map[string]any{
		"bookTitle": ensembleBook.BookTitle, "composer": "Someone",
		"sheetTypeName": "Ensemble Piece – Full Score", "instruments": []string{"Violin"},
	}), nil)

	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Unrelated Book", "composer": "Someone",
	}), nil)

	var sheetTypes []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/sheet-types", nil), &sheetTypes)
	var soloID, ensembleID int64
	for _, st := range sheetTypes {
		switch st.Name {
		case "Solo Piece":
			soloID = st.ID
		case "Ensemble Piece – Full Score":
			ensembleID = st.ID
		}
	}
	if soloID == 0 || ensembleID == 0 {
		t.Fatal("could not find seeded Solo Piece/Ensemble Piece – Full Score sheet types")
	}

	var bySheetType []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?sheetTypeId="+itoa(soloID)+","+itoa(ensembleID), nil), &bySheetType)
	gotSheetType := map[int64]bool{}
	for _, b := range bySheetType {
		gotSheetType[b.ID] = true
	}
	if len(bySheetType) != 2 || !gotSheetType[soloBook.ID] || !gotSheetType[ensembleBook.ID] {
		t.Errorf("comma-separated sheetTypeId filter returned %+v, want exactly [%d, %d]",
			bySheetType, soloBook.ID, ensembleBook.ID)
	}

	var instruments []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/instruments", nil), &instruments)
	var pianoID, violinID int64
	for _, inst := range instruments {
		switch inst.Name {
		case "Piano":
			pianoID = inst.ID
		case "Violin":
			violinID = inst.ID
		}
	}
	if pianoID == 0 || violinID == 0 {
		t.Fatal("could not find seeded Piano/Violin instruments")
	}

	var byInstrument2 []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?instrumentId="+itoa(pianoID)+","+itoa(violinID), nil), &byInstrument2)
	gotInstrument := map[int64]bool{}
	for _, b := range byInstrument2 {
		gotInstrument[b.ID] = true
	}
	if len(byInstrument2) != 2 || !gotInstrument[soloBook.ID] || !gotInstrument[ensembleBook.ID] {
		t.Errorf("comma-separated instrumentId filter returned %+v, want exactly [%d, %d]",
			byInstrument2, soloBook.ID, ensembleBook.ID)
	}
}

// TestDeleteBook_CascadeDeletesAllPieces is the Book Library context menu's
// "Delete Book" action end to end: this removes the Book *and* every
// Piece referencing it in one action, not the existing orphan-cleanup
// path (which only ever fires once a book's last piece is already gone
// via individual piece deletes).
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

// TestDeleteBook_PurgesCachedPageThumbnails covers the gap found while
// building the Book Upload Wizard's "Cancel upload" action: a cancelled
// upload (a book with no pieces yet, deleted directly) must not leave its
// already-rendered page thumbnails behind in data/cache/thumbnails —
// they're keyed by bookId, not by any piece row, so the cascade-delete's
// own piece-file cleanup never touches them on its own.
func TestDeleteBook_PurgesCachedPageThumbnails(t *testing.T) {
	h, dataDir, _ := newTestServerWithDataDir(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 2)

	// Populate the cache entry the same way a real client would, by
	// actually requesting the thumbnail, rather than fabricating the cache
	// file directly — proves the cache key this test later checks for is
	// the real one handleBookPageThumbnail uses, not a guess.
	thumbRec := doJSON(t, h, http.MethodGet, apiBooksURL(bookID)+"/pages/1/thumbnail", nil)
	if thumbRec.Code != http.StatusOK {
		t.Fatalf("GET thumbnail before delete: status %d", thumbRec.Code)
	}
	cachePath := filepath.Join(dataDir, "cache", "thumbnails", fmt.Sprintf("book-%d-page-1.png", bookID))
	if _, err := os.Stat(cachePath); err != nil {
		t.Fatalf("cached thumbnail not found at %s before delete: %v", cachePath, err)
	}

	delRec := doJSON(t, h, http.MethodDelete, apiBooksURL(bookID), nil)
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete book: status %d, body %s", delRec.Code, delRec.Body.String())
	}

	if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
		t.Errorf("cached thumbnail at %s still exists after book delete (err = %v), want removed", cachePath, err)
	}
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

// TestUploadBookCover_OverridesDerivedThumbnail covers the core contract of
// the custom cover feature: once set, GET /api/books/{id}/cover must
// serve the custom image, not the first-page-of-PDF thumbnail — even
// though this book has a perfectly good real file.
func TestUploadBookCover_OverridesDerivedThumbnail(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 3)

	var before bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, apiBooksURL(bookID), nil), &before)
	if before.HasCustomCover {
		t.Fatalf("hasCustomCover = true before any cover was uploaded")
	}

	pngRec := recordRequest(h, httptestGet(t, apiBooksURL(bookID)+"/cover"))
	if pngRec.Code != http.StatusOK {
		t.Fatalf("GET cover before upload (should fall back to page-1 thumbnail): status %d", pngRec.Code)
	}
	derivedThumbnailBytes := pngRec.Body.Bytes()

	dir := t.TempDir()
	coverPath := dir + "/cover.png"
	writeFixturePNG(t, coverPath, [3]byte{63, 92, 63})
	uploadRec := recordRequest(h, multipartUpload(t, apiBooksURL(bookID)+"/cover", "cover.png", readAll(t, coverPath)))
	if uploadRec.Code != http.StatusOK {
		t.Fatalf("upload cover: status %d, body %s", uploadRec.Code, uploadRec.Body.String())
	}
	var after bookResponse
	decodeData(t, uploadRec, &after)
	if !after.HasCustomCover {
		t.Errorf("hasCustomCover = false after uploading a cover, want true")
	}

	coverRec := recordRequest(h, httptestGet(t, apiBooksURL(bookID)+"/cover"))
	if coverRec.Code != http.StatusOK {
		t.Fatalf("GET cover after upload: status %d", coverRec.Code)
	}
	if ct := coverRec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("cover Content-Type = %q, want image/png", ct)
	}
	if bytes.Equal(coverRec.Body.Bytes(), derivedThumbnailBytes) {
		t.Error("cover after upload is byte-identical to the derived page-1 thumbnail — the custom cover isn't actually being served")
	}
	if !bytes.Equal(coverRec.Body.Bytes(), readAll(t, coverPath)) {
		t.Error("cover after upload doesn't match the uploaded image's own bytes")
	}
}

// TestUploadBookCover_RejectsNonImageFile mirrors stageUpload's own
// "verify, don't trust the upload" posture for book/piece PDFs — a
// non-image file must be rejected with a validation error, not silently
// stored as an unreadable "cover".
func TestUploadBookCover_RejectsNonImageFile(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 1)

	rec := recordRequest(h, multipartUpload(t, apiBooksURL(bookID)+"/cover", "not-an-image.txt", []byte("hello, this is not an image")))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("uploading a non-image as a cover: status %d, want 400", rec.Code)
	}

	var book bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, apiBooksURL(bookID), nil), &book)
	if book.HasCustomCover {
		t.Error("hasCustomCover = true after a rejected non-image upload")
	}
}

// TestGetBookCover_404sWhenNoFileAndNoCustomCover covers a manually created
// book (migration 00014, no original PDF) with no custom cover set either —
// the frontend's "No-File Cover" placeholder case.
func TestGetBookCover_404sWhenNoFileAndNoCustomCover(t *testing.T) {
	h := newTestServer(t)
	createRec := doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "No File Book",
		"composer":  "Someone",
	})
	var created bookResponse
	decodeData(t, createRec, &created)

	rec := recordRequest(h, httptestGet(t, apiBooksURL(created.ID)+"/cover"))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET cover for a fileless book with no custom cover: status %d, want 404", rec.Code)
	}
}

// TestDeleteBookCover_RevertsToDerivedThumbnail covers removal: after
// deleting the custom cover, hasCustomCover flips back to false and GET
// /cover falls back to the page-1 thumbnail again — not a 404.
func TestDeleteBookCover_RevertsToDerivedThumbnail(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 2)

	dir := t.TempDir()
	coverPath := dir + "/cover.png"
	writeFixturePNG(t, coverPath, [3]byte{200, 50, 50})
	recordRequest(h, multipartUpload(t, apiBooksURL(bookID)+"/cover", "cover.png", readAll(t, coverPath)))

	deleteRec := doJSON(t, h, http.MethodDelete, apiBooksURL(bookID)+"/cover", nil)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete cover: status %d, body %s", deleteRec.Code, deleteRec.Body.String())
	}
	var after bookResponse
	decodeData(t, deleteRec, &after)
	if after.HasCustomCover {
		t.Error("hasCustomCover = true after deleting the cover")
	}

	coverRec := recordRequest(h, httptestGet(t, apiBooksURL(bookID)+"/cover"))
	if coverRec.Code != http.StatusOK {
		t.Errorf("GET cover after delete (should fall back to page-1 thumbnail): status %d", coverRec.Code)
	}
	if bytes.Equal(coverRec.Body.Bytes(), readAll(t, coverPath)) {
		t.Error("cover after delete still matches the removed custom image")
	}
}

// TestUploadBookCover_ReplaceSwapsContent covers uploading a second cover
// over an already-set one: the newer image must be what's served, not the
// first.
func TestUploadBookCover_ReplaceSwapsContent(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 1)

	dir := t.TempDir()
	firstPath := dir + "/first.png"
	secondPath := dir + "/second.png"
	writeFixturePNG(t, firstPath, [3]byte{10, 20, 30})
	writeFixturePNG(t, secondPath, [3]byte{200, 210, 220})

	recordRequest(h, multipartUpload(t, apiBooksURL(bookID)+"/cover", "first.png", readAll(t, firstPath)))
	recordRequest(h, multipartUpload(t, apiBooksURL(bookID)+"/cover", "second.png", readAll(t, secondPath)))

	coverRec := recordRequest(h, httptestGet(t, apiBooksURL(bookID)+"/cover"))
	if coverRec.Code != http.StatusOK {
		t.Fatalf("GET cover after replace: status %d", coverRec.Code)
	}
	if !bytes.Equal(coverRec.Body.Bytes(), readAll(t, secondPath)) {
		t.Error("cover after replace doesn't match the second (newest) uploaded image")
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
