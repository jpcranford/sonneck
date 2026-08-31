package handlers_test

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// This test exists because a manual smoke test caught a real bug here:
// applyPieceWriteRequest was overwriting the just-computed extraction
// range with the (empty) sourcePageStart/End from the request, silently
// nulling out every imported piece's page range — exactly the class of
// bug CLAUDE.md > Testing calls out for the split step. Locking in both
// the range and the inheritance/override behavior together, since they're
// set in the same confirm-import codepath.
func TestConfirmImport_PageRangesAndComposerInheritance(t *testing.T) {
	h := newTestServer(t)

	bookID, pageCount := uploadBook(t, h, "IMSLP99-symphony.pdf", 8)
	if pageCount != 8 {
		t.Fatalf("uploaded book page count = %d, want 8", pageCount)
	}

	patchRec := doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Six Symphonies",
		"composers": []string{"Charles-Marie Widor"},
	})
	decodeData(t, patchRec, nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 4},
			{"start": 5, "end": 8},
		},
		"pieces": []map[string]any{
			{"title": "Toccata"},
			{"title": "Adagio", "composers": []string{"Override Composer"}},
		},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)

	if len(result.Pieces) != 2 {
		t.Fatalf("created %d pieces, want 2", len(result.Pieces))
	}

	toccata, adagio := result.Pieces[0], result.Pieces[1]

	if toccata.SourcePageStart == nil || toccata.SourcePageEnd == nil {
		t.Fatalf("Toccata page range is nil, want 1-4")
	}
	if *toccata.SourcePageStart != 1 || *toccata.SourcePageEnd != 4 {
		t.Errorf("Toccata pages = %d-%d, want 1-4", *toccata.SourcePageStart, *toccata.SourcePageEnd)
	}
	if toccata.PageCount != 4 {
		t.Errorf("Toccata pageCount = %d, want 4 (derived from its 1-4 page range)", toccata.PageCount)
	}
	if names := toccata.Composer.names(); !toccata.Composer.Inherited || len(names) != 1 || names[0] != "Charles-Marie Widor" {
		t.Errorf("Toccata composer = %+v, want inherited [Charles-Marie Widor]", toccata.Composer)
	}

	if adagio.SourcePageStart == nil || adagio.SourcePageEnd == nil {
		t.Fatalf("Adagio page range is nil, want 5-8")
	}
	if *adagio.SourcePageStart != 5 || *adagio.SourcePageEnd != 8 {
		t.Errorf("Adagio pages = %d-%d, want 5-8", *adagio.SourcePageStart, *adagio.SourcePageEnd)
	}
	if adagio.PageCount != 4 {
		t.Errorf("Adagio pageCount = %d, want 4 (derived from its 5-8 page range)", adagio.PageCount)
	}
	if names := adagio.Composer.names(); adagio.Composer.Inherited || len(names) != 1 || names[0] != "Override Composer" {
		t.Errorf("Adagio composer = %+v, want own value [Override Composer]", adagio.Composer)
	}
}

// TestConfirmImport_AllOrNothingRollback verifies design doc §5's
// transactional guarantee: one invalid piece in a multi-piece confirm
// blocks the entire batch — never a half-imported book.
func TestConfirmImport_AllOrNothingRollback(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 8)

	rec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 4},
			{"start": 5, "end": 8},
		},
		"pieces": []map[string]any{
			{"title": "Valid Piece", "composers": []string{"Someone"}},
			{"title": "", "composers": []string{"Someone"}}, // missing required title
		},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("confirm-import with an invalid piece: status %d, want 400; body %s", rec.Code, rec.Body.String())
	}

	searchRec := doJSON(t, h, http.MethodGet, "/api/pieces?query=Valid", nil)
	var results []pieceResponse
	decodeData(t, searchRec, &results)
	if len(results) != 0 {
		t.Errorf("found %d piece(s) after a rolled-back import, want 0", len(results))
	}
}

// TestConfirmImport_SkipAndSharedBoundary exercises the two capabilities
// wizard.ValidateRanges was added for, through the full handler rather than
// just the validator in isolation: a skipped page (4, covered by no range)
// and a page shared between two adjacent pieces (7, the end of one range
// and the start of the next). Same 8-page shape as the wizard's own
// canonical design fixture ("Album für die Jugend, Op. 68": pp 1-3, p.4
// skipped, pp 5-7, p.7 also starts the next piece, which continues to p.8).
func TestConfirmImport_SkipAndSharedBoundary(t *testing.T) {
	h := newTestServer(t)
	bookID, pageCount := uploadBook(t, h, "album.pdf", 8)
	if pageCount != 8 {
		t.Fatalf("uploaded book page count = %d, want 8", pageCount)
	}

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 3},
			{"start": 5, "end": 7},
			{"start": 7, "end": 8},
		},
		"pieces": []map[string]any{
			{"title": "Prelude in C", "composers": []string{"J. Burgmüller"}},
			{"title": "Nocturne", "composers": []string{"Fr. Chopin"}},
			{"title": "Waltz in A-flat", "composers": []string{"Fr. Chopin"}},
		},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)

	if len(result.Pieces) != 3 {
		t.Fatalf("created %d pieces, want 3", len(result.Pieces))
	}

	prelude, nocturne, waltz := result.Pieces[0], result.Pieces[1], result.Pieces[2]

	if *prelude.SourcePageStart != 1 || *prelude.SourcePageEnd != 3 {
		t.Errorf("Prelude pages = %d-%d, want 1-3 (page 4 correctly excluded)", *prelude.SourcePageStart, *prelude.SourcePageEnd)
	}
	if *nocturne.SourcePageStart != 5 || *nocturne.SourcePageEnd != 7 {
		t.Errorf("Nocturne pages = %d-%d, want 5-7", *nocturne.SourcePageStart, *nocturne.SourcePageEnd)
	}
	if *waltz.SourcePageStart != 7 || *waltz.SourcePageEnd != 8 {
		t.Errorf("Waltz pages = %d-%d, want 7-8", *waltz.SourcePageStart, *waltz.SourcePageEnd)
	}
	// Page 7 must genuinely belong to both pieces — the whole point of a
	// shared boundary — not just to whichever one happened to claim it.
	if *nocturne.SourcePageEnd != *waltz.SourcePageStart {
		t.Errorf("page 7 should be both Nocturne's end and Waltz's start, got %d and %d", *nocturne.SourcePageEnd, *waltz.SourcePageStart)
	}
}

// TestConfirmImport_PageOffset covers the "About this book" screen's
// printed-PDF page offset (design doc §5, added post-launch): every
// piece's SourcePageStart/SourcePageEnd must reflect physical page +
// pageOffset, while PageCount (derived from the raw extraction range)
// must stay unaffected by it.
func TestConfirmImport_PageOffset(t *testing.T) {
	h := newTestServer(t)
	bookID, pageCount := uploadBook(t, h, "volume-two.pdf", 8)
	if pageCount != 8 {
		t.Fatalf("uploaded book page count = %d, want 8", pageCount)
	}

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 4},
			{"start": 5, "end": 8},
		},
		"pieces": []map[string]any{
			{"title": "Toccata", "composers": []string{"Someone"}},
			{"title": "Adagio", "composers": []string{"Someone"}},
		},
		"pageOffset": 67,
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)

	if len(result.Pieces) != 2 {
		t.Fatalf("created %d pieces, want 2", len(result.Pieces))
	}
	toccata, adagio := result.Pieces[0], result.Pieces[1]

	if *toccata.SourcePageStart != 68 || *toccata.SourcePageEnd != 71 {
		t.Errorf("Toccata pages = %d-%d, want 68-71 (physical 1-4 + offset 67)", *toccata.SourcePageStart, *toccata.SourcePageEnd)
	}
	if toccata.PageCount != 4 {
		t.Errorf("Toccata pageCount = %d, want 4 (unaffected by pageOffset)", toccata.PageCount)
	}
	if *adagio.SourcePageStart != 72 || *adagio.SourcePageEnd != 75 {
		t.Errorf("Adagio pages = %d-%d, want 72-75 (physical 5-8 + offset 67)", *adagio.SourcePageStart, *adagio.SourcePageEnd)
	}
	if adagio.PageCount != 4 {
		t.Errorf("Adagio pageCount = %d, want 4 (unaffected by pageOffset)", adagio.PageCount)
	}
}

// TestConfirmImport_PurgesStaleBookThumbnailsExceptPageOne covers a real
// cache-cleanup gap: once every piece is a real, physically split-out file
// of its own (pdf.ExtractPages into library/pieces/), the book's own
// cached page thumbnails beyond page 1 are dead weight — every piece
// thumbnail renders from the piece's own file (handlePieceThumbnail),
// never the book's, so nothing requests a book page thumbnail again after
// import. Page 1 must survive regardless: handleGetBookCover keeps
// serving it forever as the cover-image fallback for any book with no
// custom cover uploaded (Books library grid, Book Details header).
func TestConfirmImport_PurgesStaleBookThumbnailsExceptPageOne(t *testing.T) {
	h, dataDir, _ := newTestServerWithDataDir(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 3)

	// Populate all 3 page thumbnails the same way a real client would (the
	// wizard's own About/Split/Titles screens render every page) rather
	// than fabricating cache files directly — proves the cache keys this
	// test checks are the real ones handleBookPageThumbnail uses.
	for page := 1; page <= 3; page++ {
		rec := doJSON(t, h, http.MethodGet, fmt.Sprintf("%s/pages/%d/thumbnail", apiBooksURL(bookID), page), nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET page %d thumbnail before import: status %d", page, rec.Code)
		}
	}
	cachePath := func(page int) string {
		return filepath.Join(dataDir, "cache", "thumbnails", fmt.Sprintf("book-%d-page-%d.png", bookID, page))
	}
	for page := 1; page <= 3; page++ {
		if _, err := os.Stat(cachePath(page)); err != nil {
			t.Fatalf("cached thumbnail for page %d not found before import: %v", page, err)
		}
	}

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 3}},
		"pieces": []map[string]any{{"title": "Whole Thing", "composers": []string{"Someone"}}},
	})
	decodeData(t, confirmRec, new(any))

	if _, err := os.Stat(cachePath(1)); err != nil {
		t.Errorf("page 1 thumbnail removed after import (err = %v), want it preserved (handleGetBookCover's fallback)", err)
	}
	for _, page := range []int{2, 3} {
		if _, err := os.Stat(cachePath(page)); !os.IsNotExist(err) {
			t.Errorf("page %d thumbnail still exists after import (err = %v), want it purged (dead weight — no piece thumbnail ever reads a book's own file)", page, err)
		}
	}
}

func apiBooksURL(id int64) string {
	return fmt.Sprintf("/api/books/%d", id)
}
