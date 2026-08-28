package handlers_test

import (
	"net/http"
	"testing"
)

func TestPieceFacets_KeyCountsMatchActualPieceCounts(t *testing.T) {
	h := newTestServer(t)
	createTestPiece(t, h, map[string]any{"title": "In C 1", "keys": []string{"C Major"}})
	createTestPiece(t, h, map[string]any{"title": "In C 2", "keys": []string{"C Major"}})
	createTestPiece(t, h, map[string]any{"title": "In D", "keys": []string{"D Major"}})
	createTestPiece(t, h, map[string]any{"title": "No key at all"})

	var facets struct {
		Keys []struct {
			ID    int64  `json:"id"`
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"keys"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/facets", nil), &facets)

	counts := map[string]int{}
	for _, k := range facets.Keys {
		counts[k.Name] = k.Count
	}
	if counts["C Major"] != 2 {
		t.Errorf("C Major facet count = %d, want 2", counts["C Major"])
	}
	if counts["D Major"] != 1 {
		t.Errorf("D Major facet count = %d, want 1", counts["D Major"])
	}
	// A key nobody uses (e.g. G Major, seeded but never assigned above)
	// must not appear at all — zero-count facet values are omitted, not
	// shown at count 0.
	if _, present := counts["G Major"]; present {
		t.Errorf("G Major facet present with count %d, want it omitted entirely (nothing uses it)", counts["G Major"])
	}
}

// TestPieceFacets_InstrumentCountsIncludeInheritedPieces mirrors
// TestSearchPieces_SheetTypeAndInstrumentFiltersMatchInheritedValues: the
// facet count must match what the filter itself would actually return, so
// a piece that only inherits an instrument from its book has to be
// reflected in that instrument's displayed count, not just direct
// per-piece assignments.
func TestPieceFacets_InstrumentCountsIncludeInheritedPieces(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology", "composer": "Someone", "instruments": []string{"Violin"},
	}), nil)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Inherits Violin", "composer": "Someone"}},
	})
	decodeData(t, confirmRec, new(any))

	createTestPiece(t, h, map[string]any{"title": "Direct Piano", "instruments": []string{"Piano"}})

	var facets struct {
		Instruments []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"instruments"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/facets", nil), &facets)

	counts := map[string]int{}
	for _, inst := range facets.Instruments {
		counts[inst.Name] = inst.Count
	}
	if counts["Violin"] != 1 {
		t.Errorf("Violin facet count = %d, want 1 (the book-inheriting piece)", counts["Violin"])
	}
	if counts["Piano"] != 1 {
		t.Errorf("Piano facet count = %d, want 1", counts["Piano"])
	}
}

func TestPieceFacets_FavoriteAndBooklessCounts(t *testing.T) {
	h := newTestServer(t)
	createTestPiece(t, h, map[string]any{"title": "Fav 1", "favorite": true})
	createTestPiece(t, h, map[string]any{"title": "Fav 2", "favorite": true})
	createTestPiece(t, h, map[string]any{"title": "Not fav", "favorite": false})

	bookID, _ := uploadBook(t, h, "book.pdf", 2)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 2}},
		"pieces": []map[string]any{{"title": "From a book", "composer": "Someone"}},
	})
	decodeData(t, confirmRec, new(any))

	var facets struct {
		Favorite int `json:"favorite"`
		Bookless int `json:"bookless"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/facets", nil), &facets)

	if facets.Favorite != 2 {
		t.Errorf("favorite facet count = %d, want 2", facets.Favorite)
	}
	// 3 bookless pieces created via createTestPiece above (none have a
	// sourceBookId) + the one from-a-book piece is the only non-bookless one.
	if facets.Bookless != 3 {
		t.Errorf("bookless facet count = %d, want 3", facets.Bookless)
	}
}

func TestBookFacets_SheetTypeAndInstrumentCounts(t *testing.T) {
	h := newTestServer(t)
	var scoreBook struct {
		ID int64 `json:"id"`
	}
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Full Score Book", "composer": "Someone",
	}), &scoreBook)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(scoreBook.ID), map[string]any{
		"bookTitle": "Full Score Book", "composer": "Someone",
		"sheetTypeName": "Ensemble Piece – Full Score", "instruments": []string{"Violin", "Cello"},
	}), nil)
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Unclassified Book", "composer": "Someone",
	}), nil)

	var facets struct {
		SheetTypes []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"sheetTypes"`
		Instruments []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"instruments"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books/facets", nil), &facets)

	sheetTypeCounts := map[string]int{}
	for _, st := range facets.SheetTypes {
		sheetTypeCounts[st.Name] = st.Count
	}
	if sheetTypeCounts["Ensemble Piece – Full Score"] != 1 {
		t.Errorf("Ensemble Piece – Full Score facet count = %d, want 1", sheetTypeCounts["Ensemble Piece – Full Score"])
	}

	instrumentCounts := map[string]int{}
	for _, inst := range facets.Instruments {
		instrumentCounts[inst.Name] = inst.Count
	}
	if instrumentCounts["Violin"] != 1 || instrumentCounts["Cello"] != 1 {
		t.Errorf("instrument counts = %+v, want Violin:1 and Cello:1", instrumentCounts)
	}
}
