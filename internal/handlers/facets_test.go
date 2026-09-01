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
		"bookTitle": "Anthology", "composers": []string{"Someone"}, "instruments": []string{"Violin"},
	}), nil)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Inherits Violin", "composers": []string{"Someone"}}},
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
		"pieces": []map[string]any{{"title": "From a book", "composers": []string{"Someone"}}},
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

// TestPieceFacets_HasImslpNumberCountIsInheritanceAware mirrors
// TestPieceFacets_InstrumentCountsIncludeInheritedPieces: the "Show only"
// Has IMSLP number count must include a piece that only inherits its
// number from its book, unlike the plain-column favorite/bookless counts
// right above it.
func TestPieceFacets_HasImslpNumberCountIsInheritanceAware(t *testing.T) {
	h := newTestServer(t)
	createTestPiece(t, h, map[string]any{"title": "Direct", "imslpNumber": "111"})
	createTestPiece(t, h, map[string]any{"title": "None"})

	bookID, _ := uploadBook(t, h, "book.pdf", 2)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology", "composers": []string{"Someone"}, "imslpNumber": "222",
	}), nil)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 2}},
		"pieces": []map[string]any{{"title": "Inherits", "composers": []string{"Someone"}}},
	})
	decodeData(t, confirmRec, new(any))

	var facets struct {
		HasImslpNumber int `json:"hasImslpNumber"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/facets", nil), &facets)

	if facets.HasImslpNumber != 2 {
		t.Errorf("hasImslpNumber facet count = %d, want 2 (1 direct + 1 inherited)", facets.HasImslpNumber)
	}
}

// TestPieceFacets_NarrowByOtherActiveFilter is the core faceted-navigation
// behavior (changed 2026-08-31 from "always static, whole-library" — see
// PieceFacets's own doc comment): a facet's displayed count reflects every
// OTHER currently active filter, but never self-narrows against its own
// selection. Two keys (C Major, D Major) each paired with one of two
// instruments (Piano, Violin) — filtering to instrumentId=Piano must
// narrow the Key facet down to just the Piano piece's own key, while the
// Instrument facet itself stays at its unfiltered counts (a facet never
// narrows against its own active filter).
func TestPieceFacets_NarrowByOtherActiveFilter(t *testing.T) {
	h := newTestServer(t)
	createTestPiece(t, h, map[string]any{"title": "Piano in C", "keys": []string{"C Major"}, "instruments": []string{"Piano"}})
	createTestPiece(t, h, map[string]any{"title": "Violin in D", "keys": []string{"D Major"}, "instruments": []string{"Violin"}})

	var pianoID int64
	{
		var lookup struct {
			Instruments []struct {
				ID   int64  `json:"id"`
				Name string `json:"name"`
			} `json:"instruments"`
		}
		decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/facets", nil), &lookup)
		for _, inst := range lookup.Instruments {
			if inst.Name == "Piano" {
				pianoID = inst.ID
			}
		}
		if pianoID == 0 {
			t.Fatalf("Piano instrument id not found in unfiltered facets: %+v", lookup.Instruments)
		}
	}

	var narrowed struct {
		Keys []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"keys"`
		Instruments []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"instruments"`
	}
	url := "/api/pieces/facets?instrumentId=" + itoa(pianoID)
	decodeData(t, doJSON(t, h, http.MethodGet, url, nil), &narrowed)

	keyCounts := map[string]int{}
	for _, k := range narrowed.Keys {
		keyCounts[k.Name] = k.Count
	}
	if _, present := keyCounts["D Major"]; present {
		t.Errorf("D Major key present at count %d while instrumentId=Piano is active, want it narrowed out entirely", keyCounts["D Major"])
	}
	if keyCounts["C Major"] != 1 {
		t.Errorf("C Major key count = %d, want 1 (narrowed to the Piano piece)", keyCounts["C Major"])
	}

	instCounts := map[string]int{}
	for _, inst := range narrowed.Instruments {
		instCounts[inst.Name] = inst.Count
	}
	if instCounts["Piano"] != 1 || instCounts["Violin"] != 1 {
		t.Errorf("instrument counts = %+v, want Piano:1 and Violin:1 (a facet never narrows against its own active filter)", instCounts)
	}
}

// TestPieceFacets_NarrowByQueryText confirms the free-text portion of a
// facet count (pieceTextMatchClause) actually narrows results, using the
// deliberately prefix-tier-only match (see PieceFacets's own doc comment
// on why trigram/fuzzy aren't replicated here).
func TestPieceFacets_NarrowByQueryText(t *testing.T) {
	h := newTestServer(t)
	createTestPiece(t, h, map[string]any{"title": "Andantino", "keys": []string{"C Major"}})
	createTestPiece(t, h, map[string]any{"title": "Nocturne", "keys": []string{"D Major"}})

	var facets struct {
		Keys []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"keys"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/facets?query=andan", nil), &facets)

	counts := map[string]int{}
	for _, k := range facets.Keys {
		counts[k.Name] = k.Count
	}
	if _, present := counts["D Major"]; present {
		t.Errorf("D Major present at count %d while query=andan is active, want it narrowed out (only Andantino matches)", counts["D Major"])
	}
	if counts["C Major"] != 1 {
		t.Errorf("C Major count = %d, want 1", counts["C Major"])
	}
}

// TestBookFacets_NarrowByOtherActiveFilterAndQuery mirrors
// TestPieceFacets_NarrowByOtherActiveFilter for Books — no inheritance
// concern (Book is the top of the hierarchy), but the same "narrow by
// every OTHER active filter/search, never by your own" rule applies.
func TestBookFacets_NarrowByOtherActiveFilterAndQuery(t *testing.T) {
	h := newTestServer(t)
	var scoreBook struct {
		ID int64 `json:"id"`
	}
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Full Score Book", "composers": []string{"Someone"},
	}), &scoreBook)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(scoreBook.ID), map[string]any{
		"bookTitle": "Full Score Book", "composers": []string{"Someone"},
		"sheetTypeName": "Ensemble Piece – Full Score", "instruments": []string{"Violin"},
	}), nil)
	var soloBook struct {
		ID int64 `json:"id"`
	}
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Solo Piano Anthology", "composers": []string{"Someone"},
	}), &soloBook)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(soloBook.ID), map[string]any{
		"bookTitle": "Solo Piano Anthology", "composers": []string{"Someone"},
		"sheetTypeName": "Solo Piece", "instruments": []string{"Piano"},
	}), nil)

	var lookup struct {
		Instruments []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"instruments"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books/facets", nil), &lookup)
	var violinID int64
	for _, inst := range lookup.Instruments {
		if inst.Name == "Violin" {
			violinID = inst.ID
		}
	}
	if violinID == 0 {
		t.Fatalf("Violin instrument id not found: %+v", lookup.Instruments)
	}

	var narrowed struct {
		SheetTypes []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"sheetTypes"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books/facets?instrumentId="+itoa(violinID), nil), &narrowed)
	stCounts := map[string]int{}
	for _, st := range narrowed.SheetTypes {
		stCounts[st.Name] = st.Count
	}
	if _, present := stCounts["Solo Piece"]; present {
		t.Errorf("Solo Piece present at count %d while instrumentId=Violin is active, want it narrowed out", stCounts["Solo Piece"])
	}
	if stCounts["Ensemble Piece – Full Score"] != 1 {
		t.Errorf("Ensemble Piece – Full Score count = %d, want 1", stCounts["Ensemble Piece – Full Score"])
	}

	var byQuery struct {
		Instruments []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"instruments"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books/facets?query=Solo+Piano", nil), &byQuery)
	instCounts := map[string]int{}
	for _, inst := range byQuery.Instruments {
		instCounts[inst.Name] = inst.Count
	}
	if _, present := instCounts["Violin"]; present {
		t.Errorf("Violin present at count %d while query=Solo Piano is active, want it narrowed out", instCounts["Violin"])
	}
	if instCounts["Piano"] != 1 {
		t.Errorf("Piano count = %d, want 1", instCounts["Piano"])
	}
}

func TestBookFacets_SheetTypeAndInstrumentCounts(t *testing.T) {
	h := newTestServer(t)
	var scoreBook struct {
		ID int64 `json:"id"`
	}
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Full Score Book", "composers": []string{"Someone"},
	}), &scoreBook)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(scoreBook.ID), map[string]any{
		"bookTitle": "Full Score Book", "composers": []string{"Someone"},
		"sheetTypeName": "Ensemble Piece – Full Score", "instruments": []string{"Violin", "Cello"},
	}), nil)
	decodeData(t, doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Unclassified Book", "composers": []string{"Someone"},
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
