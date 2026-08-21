package handlers_test

import (
	"net/http"
	"net/url"
	"sync/atomic"
	"testing"
)

// testPieceCounter gives each createTestPiece call distinct fixture content
// (via distinct page counts), so callers get genuinely separate Piece rows
// even now that /api/pieces dedupes identical uploads (handleCreatePiece).
// Package-level rather than per-test: search tests in this file create
// several pieces per test and must never collide with each other.
var testPieceCounter atomic.Int64

func createTestPiece(t *testing.T, h http.Handler, fields map[string]any) pieceResponse {
	t.Helper()
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, int(testPieceCounter.Add(1)))

	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload piece: status %d, body %s", rec.Code, rec.Body.String())
	}
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	base := map[string]any{"title": uploaded.Title, "composer": "Someone"}
	for k, v := range fields {
		base[k] = v
	}
	editRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), base)
	var edited pieceResponse
	decodeData(t, editRec, &edited)
	return edited
}

func TestSearchPieces_FiltersByFavorite(t *testing.T) {
	h := newTestServer(t)
	fav := createTestPiece(t, h, map[string]any{"title": "Favorite Piece", "favorite": true})
	createTestPiece(t, h, map[string]any{"title": "Ordinary Piece", "favorite": false})

	rec := doJSON(t, h, http.MethodGet, "/api/pieces?favorite=true", nil)
	var results []pieceResponse
	decodeData(t, rec, &results)

	if len(results) != 1 || results[0].ID != fav.ID {
		t.Errorf("favorite filter returned %+v, want exactly [%d]", results, fav.ID)
	}
}

func TestSearchPieces_FiltersByPracticeStatus(t *testing.T) {
	h := newTestServer(t)
	learning := createTestPiece(t, h, map[string]any{"title": "Learning Piece", "practiceStatus": "Learning"})
	createTestPiece(t, h, map[string]any{"title": "Learned Piece", "practiceStatus": "Learned"})

	rec := doJSON(t, h, http.MethodGet, "/api/pieces?practiceStatus=Learning", nil)
	var results []pieceResponse
	decodeData(t, rec, &results)

	if len(results) != 1 || results[0].ID != learning.ID {
		t.Errorf("practiceStatus filter returned %+v, want exactly [%d]", results, learning.ID)
	}
}

func TestSearchPieces_FiltersByKeyId(t *testing.T) {
	h := newTestServer(t)
	inC := createTestPiece(t, h, map[string]any{"title": "In C", "keys": []string{"C Major"}})
	createTestPiece(t, h, map[string]any{"title": "In D", "keys": []string{"D Major"}})

	rec := doJSON(t, h, http.MethodGet, "/api/keys", nil)
	var keys []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, rec, &keys)
	var cMajorID int64
	for _, k := range keys {
		if k.Name == "C Major" {
			cMajorID = k.ID
		}
	}
	if cMajorID == 0 {
		t.Fatal("could not find seeded C Major key")
	}

	searchRec := doJSON(t, h, http.MethodGet, "/api/pieces?keyId="+itoa(cMajorID), nil)
	var results []pieceResponse
	decodeData(t, searchRec, &results)

	if len(results) != 1 || results[0].ID != inC.ID {
		t.Errorf("keyId filter returned %+v, want exactly [%d]", results, inC.ID)
	}
}

// TestSearchPieces_FiltersByBookAndSortsByStartPageWithTieBreak covers the
// Book Details page's pieces grid/list: sourceBookId scopes results to
// just that book (a piece from elsewhere must never appear), sorted by
// start page ascending rather than the default newest-first order — with
// the design review's tie-break rule when two pieces share a start page
// (e.g. a short reprise opening on the same page the piece before it is
// still finishing): the 1-page one sorts first. The tie is forced by hand
// via a PATCH (sourcePageStart is "purely cosmetic," design doc §3 — a
// real, expected way for two pieces to end up sharing a start page, not a
// contrived edge case), since confirm-import's own ranges never overlap.
func TestSearchPieces_FiltersByBookAndSortsByStartPageWithTieBreak(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 5)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 1},
			{"start": 2, "end": 5},
		},
		"pieces": []map[string]any{
			{"title": "Short", "composer": "Someone"},
			{"title": "Long", "composer": "Someone"},
		},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	short, long := result.Pieces[0], result.Pieces[1]
	if short.PageCount != 1 {
		t.Fatalf("Short piece pageCount = %d, want 1 (fixture assumption)", short.PageCount)
	}

	// A piece with no relation to this book must never appear in its results.
	createTestPiece(t, h, map[string]any{"title": "Unrelated"})

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(long.ID), map[string]any{
		"title":           long.Title,
		"composer":        "Someone",
		"sourceBookId":    bookID,
		"sourcePageStart": *short.SourcePageStart,
		"sourcePageEnd":   *long.SourcePageEnd,
	}), nil)

	rec := doJSON(t, h, http.MethodGet, "/api/pieces?sourceBookId="+itoa(bookID), nil)
	var results []pieceResponse
	decodeData(t, rec, &results)

	if len(results) != 2 {
		t.Fatalf("sourceBookId filter returned %d piece(s), want 2", len(results))
	}
	if results[0].ID != short.ID || results[1].ID != long.ID {
		t.Errorf("order = [id %d (%d pp), id %d (%d pp)], want the 1-page piece (Short) first when start pages tie",
			results[0].ID, results[0].PageCount, results[1].ID, results[1].PageCount)
	}
}

func TestSearchPieces_RejectsInvalidFilterValue(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/pieces?keyId=not-a-number", nil)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("search with invalid keyId: status %d, want 400", rec.Code)
	}
}

// TestSearchPieces_QueryHandlesFTSSpecialCharacters is a regression test
// for a real bug a code review caught: FTS5's default query syntax treats
// hyphens as a column-exclusion operator and an unmatched quote as an
// unterminated string, so searching for perfectly ordinary text like
// "F-sharp" (a ordinary composer/title term) used to return a 500 instead
// of a normal result.
func TestSearchPieces_QueryHandlesFTSSpecialCharacters(t *testing.T) {
	h := newTestServer(t)
	hyphenated := createTestPiece(t, h, map[string]any{"title": "Symphony in F-sharp minor"})
	quoted := createTestPiece(t, h, map[string]any{"title": `Symphony "Eroica" No. 3`})

	for _, tc := range []struct {
		query  string
		wantID int64
	}{
		{"F-sharp", hyphenated.ID},
		{`Eroica"`, quoted.ID}, // a trailing, unmatched quote — as if typed mid-word
	} {
		rec := doJSON(t, h, http.MethodGet, "/api/pieces?query="+url.QueryEscape(tc.query), nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("search for %q: status %d, want 200; body %s", tc.query, rec.Code, rec.Body.String())
		}
		var results []pieceResponse
		decodeData(t, rec, &results)
		if len(results) != 1 || results[0].ID != tc.wantID {
			t.Errorf("search for %q returned %+v, want exactly [%d]", tc.query, results, tc.wantID)
		}
	}
}

// TestSearchPieces_SheetTypeAndInstrumentFiltersMatchInheritedValues is a
// regression test for a real gap a code review caught: these two filters
// were matching only the piece's own column, silently missing pieces that
// display the right value everywhere else purely via book inheritance —
// exactly the divergence CLAUDE.md's book-inheritance section exists to
// prevent.
func TestSearchPieces_SheetTypeAndInstrumentFiltersMatchInheritedValues(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":     "Anthology",
		"composer":      "Someone",
		"sheetTypeName": "Ensemble Piece – Full Score",
		"instruments":   []string{"Violin"},
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Inherits Both", "composer": "Someone"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	inheriting := result.Pieces[0]

	// A standalone piece with no book must not spuriously match.
	createTestPiece(t, h, map[string]any{"title": "Unrelated"})

	sheetTypesRec := doJSON(t, h, http.MethodGet, "/api/sheet-types", nil)
	var sheetTypes []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, sheetTypesRec, &sheetTypes)
	var ensembleID int64
	for _, st := range sheetTypes {
		if st.Name == "Ensemble Piece – Full Score" {
			ensembleID = st.ID
		}
	}
	if ensembleID == 0 {
		t.Fatal("could not find seeded Ensemble Piece – Full Score sheet type")
	}

	sheetTypeSearchRec := doJSON(t, h, http.MethodGet, "/api/pieces?sheetTypeId="+itoa(ensembleID), nil)
	var sheetTypeResults []pieceResponse
	decodeData(t, sheetTypeSearchRec, &sheetTypeResults)
	if len(sheetTypeResults) != 1 || sheetTypeResults[0].ID != inheriting.ID {
		t.Errorf("sheetTypeId filter returned %+v, want exactly [%d] (inherited value)", sheetTypeResults, inheriting.ID)
	}

	instrumentsRec := doJSON(t, h, http.MethodGet, "/api/instruments", nil)
	var instruments []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, instrumentsRec, &instruments)
	var violinID int64
	for _, inst := range instruments {
		if inst.Name == "Violin" {
			violinID = inst.ID
		}
	}
	if violinID == 0 {
		t.Fatal("could not find the Violin instrument created via the book edit")
	}

	instrumentSearchRec := doJSON(t, h, http.MethodGet, "/api/pieces?instrumentId="+itoa(violinID), nil)
	var instrumentResults []pieceResponse
	decodeData(t, instrumentSearchRec, &instrumentResults)
	if len(instrumentResults) != 1 || instrumentResults[0].ID != inheriting.ID {
		t.Errorf("instrumentId filter returned %+v, want exactly [%d] (inherited value)", instrumentResults, inheriting.ID)
	}
}
