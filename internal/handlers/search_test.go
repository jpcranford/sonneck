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

// TestSearchPieces_FiltersByMultiplePracticeStatuses covers the sidebar's
// "Currently Practicing" view (Learning OR Stalled): a comma-separated
// practiceStatus value must OR-match, not require an exact single status.
func TestSearchPieces_FiltersByMultiplePracticeStatuses(t *testing.T) {
	h := newTestServer(t)
	learning := createTestPiece(t, h, map[string]any{"title": "Learning Piece", "practiceStatus": "Learning"})
	stalled := createTestPiece(t, h, map[string]any{"title": "Stalled Piece", "practiceStatus": "Stalled"})
	createTestPiece(t, h, map[string]any{"title": "Learned Piece", "practiceStatus": "Learned"})
	createTestPiece(t, h, map[string]any{"title": "Dropped Piece", "practiceStatus": "Dropped"})

	rec := doJSON(t, h, http.MethodGet, "/api/pieces?practiceStatus=Learning,Stalled", nil)
	var results []pieceResponse
	decodeData(t, rec, &results)

	gotIDs := map[int64]bool{}
	for _, r := range results {
		gotIDs[r.ID] = true
	}
	if len(results) != 2 || !gotIDs[learning.ID] || !gotIDs[stalled.ID] {
		t.Errorf("practiceStatus=Learning,Stalled returned %+v, want exactly [%d %d]", results, learning.ID, stalled.ID)
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

// TestSearchPieces_FiltersByMultipleKeyIds covers the Filter Drawer's real
// multi-select behavior (comma-separated keyId, OR-matched) — checking two
// key checkboxes at once must return pieces matching either, not just the
// first, and must not accidentally return a piece matching neither.
func TestSearchPieces_FiltersByMultipleKeyIds(t *testing.T) {
	h := newTestServer(t)
	inC := createTestPiece(t, h, map[string]any{"title": "In C", "keys": []string{"C Major"}})
	inD := createTestPiece(t, h, map[string]any{"title": "In D", "keys": []string{"D Major"}})
	createTestPiece(t, h, map[string]any{"title": "In G", "keys": []string{"G Major"}})

	var keys []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/keys", nil), &keys)
	var cMajorID, dMajorID int64
	for _, k := range keys {
		switch k.Name {
		case "C Major":
			cMajorID = k.ID
		case "D Major":
			dMajorID = k.ID
		}
	}
	if cMajorID == 0 || dMajorID == 0 {
		t.Fatal("could not find seeded C Major/D Major keys")
	}

	searchRec := doJSON(t, h, http.MethodGet, "/api/pieces?keyId="+itoa(cMajorID)+","+itoa(dMajorID), nil)
	var results []pieceResponse
	decodeData(t, searchRec, &results)

	gotIDs := map[int64]bool{}
	for _, r := range results {
		gotIDs[r.ID] = true
	}
	if len(results) != 2 || !gotIDs[inC.ID] || !gotIDs[inD.ID] {
		t.Errorf("comma-separated keyId filter returned %+v, want exactly [%d, %d]", results, inC.ID, inD.ID)
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

	// Comma-separated sheetTypeId/instrumentId: the SQL binds the id list
	// twice each (once per side of the inheritance OR), so this is a real
	// regression test for the args-ordering, not just the OR-match logic —
	// a swapped/misaligned bind would either error outright or silently
	// return the wrong rows. Piano/"Solo Piece" are the seeded defaults a
	// bare createTestPiece gets, matched directly (no book involved),
	// alongside the inherited Violin/Ensemble piece from above.
	direct := createTestPiece(t, h, map[string]any{
		"title": "Direct Piano Solo", "instruments": []string{"Piano"}, "sheetTypeName": "Solo Piece",
	})
	// Re-fetch: "Solo Piece"/"Piano" are created (FindOrCreate) by the write
	// above, so they aren't in the lists fetched earlier in this test.
	var sheetTypes2 []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/sheet-types", nil), &sheetTypes2)
	var soloID int64
	for _, st := range sheetTypes2 {
		if st.Name == "Solo Piece" {
			soloID = st.ID
		}
	}
	if soloID == 0 {
		t.Fatal("could not find seeded Solo Piece sheet type")
	}
	var instruments2 []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/instruments", nil), &instruments2)
	var pianoID int64
	for _, inst := range instruments2 {
		if inst.Name == "Piano" {
			pianoID = inst.ID
		}
	}
	if pianoID == 0 {
		t.Fatal("could not find seeded Piano instrument")
	}

	multiSheetTypeRec := doJSON(t, h, http.MethodGet, "/api/pieces?sheetTypeId="+itoa(ensembleID)+","+itoa(soloID), nil)
	var multiSheetTypeResults []pieceResponse
	decodeData(t, multiSheetTypeRec, &multiSheetTypeResults)
	gotSheetType := map[int64]bool{}
	for _, r := range multiSheetTypeResults {
		gotSheetType[r.ID] = true
	}
	if len(multiSheetTypeResults) != 2 || !gotSheetType[inheriting.ID] || !gotSheetType[direct.ID] {
		t.Errorf("comma-separated sheetTypeId filter returned %+v, want exactly [%d, %d]",
			multiSheetTypeResults, inheriting.ID, direct.ID)
	}

	multiInstrumentRec := doJSON(t, h, http.MethodGet, "/api/pieces?instrumentId="+itoa(violinID)+","+itoa(pianoID), nil)
	var multiInstrumentResults []pieceResponse
	decodeData(t, multiInstrumentRec, &multiInstrumentResults)
	gotInstrument := map[int64]bool{}
	for _, r := range multiInstrumentResults {
		gotInstrument[r.ID] = true
	}
	if len(multiInstrumentResults) != 2 || !gotInstrument[inheriting.ID] || !gotInstrument[direct.ID] {
		t.Errorf("comma-separated instrumentId filter returned %+v, want exactly [%d, %d]",
			multiInstrumentResults, inheriting.ID, direct.ID)
	}
}

func TestSearchPieces_SortsByTitleAscendingAndDescending(t *testing.T) {
	h := newTestServer(t)
	zebra := createTestPiece(t, h, map[string]any{"title": "Zebra"})
	apple := createTestPiece(t, h, map[string]any{"title": "Apple"})
	mango := createTestPiece(t, h, map[string]any{"title": "Mango"})

	ascRec := doJSON(t, h, http.MethodGet, "/api/pieces?sort=title&dir=asc", nil)
	var asc []pieceResponse
	decodeData(t, ascRec, &asc)
	if len(asc) != 3 || asc[0].ID != apple.ID || asc[1].ID != mango.ID || asc[2].ID != zebra.ID {
		t.Errorf("sort=title&dir=asc returned %+v, want [Apple, Mango, Zebra]", asc)
	}

	descRec := doJSON(t, h, http.MethodGet, "/api/pieces?sort=title&dir=desc", nil)
	var desc []pieceResponse
	decodeData(t, descRec, &desc)
	if len(desc) != 3 || desc[0].ID != zebra.ID || desc[1].ID != mango.ID || desc[2].ID != apple.ID {
		t.Errorf("sort=title&dir=desc returned %+v, want [Zebra, Mango, Apple]", desc)
	}
}

// TestSearchPieces_SortsByTitleIgnoresLeadingArticle covers titleSortColumn
// (internal/handlers/sort.go): a leading "A"/"An"/"The" is ignored for sort
// purposes (the usual library-catalog convention), computed in SQL rather
// than a stored sort-name field. Also guards against a false-positive
// strip — "Andantino"/"Aria"/"Theme and Variations" all start with the same
// letters as an article but have no space right after it, so they must
// sort on their own literal text, not have a few letters chopped off.
func TestSearchPieces_SortsByTitleIgnoresLeadingArticle(t *testing.T) {
	h := newTestServer(t)
	nutcracker := createTestPiece(t, h, map[string]any{"title": "The Nutcracker"})
	midsummer := createTestPiece(t, h, map[string]any{"title": "A Midsummer Night's Dream"})
	american := createTestPiece(t, h, map[string]any{"title": "An American in Paris"})
	andantino := createTestPiece(t, h, map[string]any{"title": "Andantino"})
	aria := createTestPiece(t, h, map[string]any{"title": "Aria"})
	theme := createTestPiece(t, h, map[string]any{"title": "Theme and Variations"})
	zebra := createTestPiece(t, h, map[string]any{"title": "Zebra"})

	// Effective sort keys: "American in Paris", "Andantino", "Aria",
	// "Midsummer Night's Dream", "Nutcracker", "Theme and Variations",
	// "Zebra" — alphabetical order of those, not the raw titles.
	want := []int64{american.ID, andantino.ID, aria.ID, midsummer.ID, nutcracker.ID, theme.ID, zebra.ID}

	ascRec := doJSON(t, h, http.MethodGet, "/api/pieces?sort=title&dir=asc", nil)
	var asc []pieceResponse
	decodeData(t, ascRec, &asc)
	if len(asc) != len(want) {
		t.Fatalf("sort=title&dir=asc returned %d pieces, want %d: %+v", len(asc), len(want), asc)
	}
	for i, id := range want {
		if asc[i].ID != id {
			t.Errorf("sort=title&dir=asc position %d = %q (id %d), want id %d\nfull order: %+v",
				i, asc[i].Title, asc[i].ID, id, asc)
			break
		}
	}
}

// TestSearchPieces_SortsByComposerFallsBackToBookComposer is the
// regression-critical case for the composer sort's SQL — it must mirror
// repo.ResolveEffective's resolveStringField fallback exactly (a piece's
// own composer if non-blank, else its book's, else neither), not just
// handle the happy path of pieces that all have their own composer.
func TestSearchPieces_SortsByComposerFallsBackToBookComposer(t *testing.T) {
	h := newTestServer(t)

	// Own composer, no book.
	zappa := createTestPiece(t, h, map[string]any{"title": "Own Composer", "composer": "Zappa"})

	// Blank own composer, falls back to the book's.
	bookID, _ := uploadBook(t, h, "book.pdf", 2)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "A Book", "composer": "Bach",
	}), nil)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 2}},
		"pieces": []map[string]any{{"title": "Inherits Composer", "composer": ""}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	inheriting := result.Pieces[0]

	// Neither its own composer nor a book to fall back to — validated via
	// an arranger-only piece (ValidatePiece requires composer OR arranger,
	// CLAUDE.md > Database migrations), so this is a real, legitimate case,
	// not a contrived one.
	neither := createTestPiece(t, h, map[string]any{"title": "Neither", "composer": "", "arranger": "Someone"})

	rec := doJSON(t, h, http.MethodGet, "/api/pieces?sort=composer&dir=asc", nil)
	var results []pieceResponse
	decodeData(t, rec, &results)
	if len(results) != 3 {
		t.Fatalf("sort=composer returned %d pieces, want 3", len(results))
	}
	// "Bach" < "Zappa" alphabetically; the composer-less piece has no
	// sortable value at all and trails regardless of direction — via the
	// explicit "IS NULL" tie-break clause in pieceSortColumns, not
	// SQLite's own default (which actually sorts NULL *first* on ASC,
	// the opposite of what a blank composer should do here).
	if results[0].ID != inheriting.ID || results[1].ID != zappa.ID || results[2].ID != neither.ID {
		t.Errorf("sort=composer&dir=asc returned %+v, want [inherited Bach, own Zappa, neither]", results)
	}
}

func TestSearchPieces_DefaultSortIsDateAddedDescending(t *testing.T) {
	h := newTestServer(t)
	first := createTestPiece(t, h, map[string]any{"title": "First"})
	second := createTestPiece(t, h, map[string]any{"title": "Second"})

	rec := doJSON(t, h, http.MethodGet, "/api/pieces", nil)
	var results []pieceResponse
	decodeData(t, rec, &results)
	if len(results) != 2 || results[0].ID != second.ID || results[1].ID != first.ID {
		t.Errorf("default (unparameterized) sort returned %+v, want [second, first] (newest-first, matching pre-existing behavior)", results)
	}
}

func TestSearchPieces_RejectsInvalidSortAndDirValues(t *testing.T) {
	h := newTestServer(t)
	if rec := doJSON(t, h, http.MethodGet, "/api/pieces?sort=nonsense", nil); rec.Code != http.StatusBadRequest {
		t.Errorf("sort=nonsense: status %d, want 400", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodGet, "/api/pieces?sort=title&dir=sideways", nil); rec.Code != http.StatusBadRequest {
		t.Errorf("dir=sideways: status %d, want 400", rec.Code)
	}
}

// TestSearchPieces_SortIgnoredWhenSourceBookIdPresent locks in the
// deliberate interaction decision: the Book Details page's page-order sort
// is a structural property of the book, not a user preference, so a sort
// param present alongside sourceBookId must not override it.
func TestSearchPieces_SortIgnoredWhenSourceBookIdPresent(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 5)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 2},
			{"start": 3, "end": 5},
		},
		"pieces": []map[string]any{
			{"title": "Zebra", "composer": "Someone"}, // starts first, alphabetically last
			{"title": "Apple", "composer": "Someone"}, // starts second, alphabetically first
		},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	zebra, apple := result.Pieces[0], result.Pieces[1]

	rec := doJSON(t, h, http.MethodGet, "/api/pieces?sourceBookId="+itoa(bookID)+"&sort=title&dir=asc", nil)
	var results []pieceResponse
	decodeData(t, rec, &results)
	if len(results) != 2 || results[0].ID != zebra.ID || results[1].ID != apple.ID {
		t.Errorf("sourceBookId+sort=title returned %+v, want page-order [Zebra, Apple] unaffected by sort=title", results)
	}
}

func TestSearchPieces_FiltersByBookless(t *testing.T) {
	h := newTestServer(t)
	standalone := createTestPiece(t, h, map[string]any{"title": "Standalone"})

	bookID, _ := uploadBook(t, h, "book.pdf", 2)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 2}},
		"pieces": []map[string]any{{"title": "From a Book", "composer": "Someone"}},
	})
	decodeData(t, confirmRec, new(any)) // just confirm it succeeded; piece isn't referenced further

	rec := doJSON(t, h, http.MethodGet, "/api/pieces?bookless=true", nil)
	var results []pieceResponse
	decodeData(t, rec, &results)
	if len(results) != 1 || results[0].ID != standalone.ID {
		t.Errorf("bookless=true returned %+v, want exactly [%d]", results, standalone.ID)
	}
}
