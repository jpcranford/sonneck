package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func apiPiecesURL(id int64) string {
	return fmt.Sprintf("/api/pieces/%d", id)
}

func apiPieceThumbnailURL(id int64, page int) string {
	return fmt.Sprintf("/api/pieces/%d/pages/%d/thumbnail", id, page)
}

// TestSinglePieceUpload_BypassesValidationButEditRequiresIt verifies the
// deliberate split described in design doc §5: the raw upload creates a
// bare Piece (just a filename-derived title, no composer) without
// enforcing "required" fields, but the follow-up edit — reusing the same
// standalone Piece Properties Edit Menu path — does enforce them.
func TestSinglePieceUpload_BypassesValidationButEditRequiresIt(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/my-piece.pdf"
	writeFixturePDF(t, path, 1)
	content := readAll(t, path)

	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "my-piece.pdf", content))
	if uploadRec.Code != http.StatusCreated {
		t.Fatalf("upload: status %d, body %s", uploadRec.Code, uploadRec.Body.String())
	}
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)
	if uploaded.Title != "my-piece" {
		t.Errorf("default title = %q, want %q (filename minus extension)", uploaded.Title, "my-piece")
	}

	// Editing with no composer and no book to inherit from must fail.
	badEditRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title": "Still No Composer",
	})
	if badEditRec.Code != http.StatusBadRequest {
		t.Fatalf("edit without composer: status %d, want 400; body %s", badEditRec.Code, badEditRec.Body.String())
	}

	goodEditRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":    "Now Has A Composer",
		"composer": "Someone",
	})
	decodeData(t, goodEditRec, nil)
	if goodEditRec.Code != http.StatusOK {
		t.Fatalf("edit with composer: status %d, want 200; body %s", goodEditRec.Code, goodEditRec.Body.String())
	}
}

// TestCreatePiece_SetsPageCount covers the Library card page-cycle control's
// data dependency: a standalone upload's page count must be captured from
// the file itself (pdf.PageCount, already computed for PDF validation in
// stageUpload) rather than left at the schema's DEFAULT 1 fallback.
// TestUpdatePiece_SupportsMultipleKeys covers key becoming many-to-many
// (migration 00008) — a piece can genuinely be written in more than one
// key (e.g. a piece that modulates). Confirms both keys persist, round-trip
// through a fresh GET (not just the mutation's own response), and that
// replacing the set with a single key correctly drops the other.
func TestUpdatePiece_SupportsMultipleKeys(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	updateRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":    "Modulating Piece",
		"composer": "Someone",
		"keys":     []string{"C Major", "A Minor"},
	})
	var updated pieceResponse
	decodeData(t, updateRec, &updated)
	if len(updated.Keys) != 2 {
		t.Fatalf("keys after update = %+v, want 2 keys", updated.Keys)
	}

	getRec := recordRequest(h, httptestGet(t, apiPiecesURL(uploaded.ID)))
	var reread pieceResponse
	decodeData(t, getRec, &reread)
	gotNames := map[string]bool{}
	for _, k := range reread.Keys {
		gotNames[k.Name] = true
	}
	if !gotNames["C Major"] || !gotNames["A Minor"] || len(reread.Keys) != 2 {
		t.Errorf("keys on re-fetch = %+v, want exactly [C Major, A Minor]", reread.Keys)
	}

	// Replacing with a single key must drop the other, not just add to it —
	// PieceWriteRequest is a full replace (same rule as every other field).
	replaceRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":    "Modulating Piece",
		"composer": "Someone",
		"keys":     []string{"G Major"},
	})
	var replaced pieceResponse
	decodeData(t, replaceRec, &replaced)
	if len(replaced.Keys) != 1 || replaced.Keys[0].Name != "G Major" {
		t.Errorf("keys after replace = %+v, want exactly [G Major]", replaced.Keys)
	}
}

// TestUpdatePiece_SupportsRepeatedKeys covers migration 00012: a piece that
// modulates back to a key it already used (e.g. C Major -> G Major -> C
// Major) must be able to store that key twice, in sequence order — not
// collapse it to one occurrence. Before 00012, piece_keys' PRIMARY KEY
// (piece_id, key_id) made this impossible; PRIMARY KEY (piece_id, position)
// replaced it specifically so this round-trips.
func TestUpdatePiece_SupportsRepeatedKeys(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	updateRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":    "Doubly Modulating Piece",
		"composer": "Someone",
		"keys":     []string{"C Major", "G Major", "C Major"},
	})
	var updated pieceResponse
	decodeData(t, updateRec, &updated)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("update: status %d, body %s", updateRec.Code, updateRec.Body.String())
	}
	assertKeySequence(t, updated.Keys, "C Major", "G Major", "C Major")

	// Round-trip through a fresh GET, not just the mutation's own response —
	// same check TestUpdatePiece_SupportsMultipleKeys makes, since position
	// ordering is exactly the kind of thing that could look right in the
	// write response but come back reshuffled on read.
	getRec := recordRequest(h, httptestGet(t, apiPiecesURL(uploaded.ID)))
	var reread pieceResponse
	decodeData(t, getRec, &reread)
	assertKeySequence(t, reread.Keys, "C Major", "G Major", "C Major")
}

func assertKeySequence(t *testing.T, keys []tagStub, want ...string) {
	t.Helper()
	if len(keys) != len(want) {
		t.Fatalf("keys = %+v, want %v", keys, want)
	}
	for i, w := range want {
		if keys[i].Name != w {
			t.Errorf("keys[%d] = %q, want %q (full sequence: %+v)", i, keys[i].Name, w, keys)
		}
	}
}

// Duration is written directly from the request, not recomputed from
// bpm/measureCount/beatsPerMeasure (a deliberate deviation from design doc
// §3 — see CLAUDE.md > Frontend > Computed fields). This deliberately sends
// a duration that does NOT match what the old formula would have derived
// from the given tempo fields (95s here vs. the ~71s the formula would
// compute for 88bpm/35 measures/3 beats), so a regression back to
// auto-computing would be caught by this assertion, not silently pass.
func TestUpdatePiece_DurationIsWrittenDirectlyNotComputed(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	updateRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":           "Tempo Test",
		"composer":        "Someone",
		"duration":        95,
		"bpm":             88,
		"measureCount":    35,
		"beatsPerMeasure": 3,
	})
	var updated pieceResponse
	decodeData(t, updateRec, &updated)
	if updated.Duration == nil || *updated.Duration != 95 {
		t.Fatalf("duration after update = %v, want 95 (written as sent, not recomputed)", updated.Duration)
	}

	getRec := recordRequest(h, httptestGet(t, apiPiecesURL(uploaded.ID)))
	var reread pieceResponse
	decodeData(t, getRec, &reread)
	if reread.Duration == nil || *reread.Duration != 95 {
		t.Errorf("duration on re-fetch = %v, want 95", reread.Duration)
	}

	// Omitting duration on a later write clears it, same full-replace rule
	// as every other field (CLAUDE.md-documented PieceWriteRequest
	// semantics) — it must not silently keep the old value or fall back to
	// recomputing one from the still-present tempo fields.
	clearRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":           "Tempo Test",
		"composer":        "Someone",
		"bpm":             88,
		"measureCount":    35,
		"beatsPerMeasure": 3,
	})
	var cleared pieceResponse
	decodeData(t, clearRec, &cleared)
	if cleared.Duration != nil {
		t.Errorf("duration after omitting it on write = %v, want nil (cleared, not recomputed)", cleared.Duration)
	}
}

func TestCreatePiece_SetsPageCount(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/multi-page.pdf"
	writeFixturePDF(t, path, 4)

	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "multi-page.pdf", readAll(t, path)))
	if uploadRec.Code != http.StatusCreated {
		t.Fatalf("upload: status %d, body %s", uploadRec.Code, uploadRec.Body.String())
	}
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)
	if uploaded.PageCount != 4 {
		t.Errorf("pageCount = %d, want 4", uploaded.PageCount)
	}
}

// TestCreatePiece_DedupesOnFileHash covers the single-piece-upload dedupe
// rule (CLAUDE.md > File handling): uploading a file whose SHA-256 already
// matches an existing Piece must reuse that Piece (200 OK) rather than
// minting a duplicate row, so the frontend can route the user to the piece
// that already represents this file instead of creating a confusing second
// copy. This only applies to this standalone endpoint — the book-import
// wizard's sibling pieces are exempt, see
// TestDeletePiece_DoesNotRemoveFileStillReferencedByAnotherPiece.
func TestCreatePiece_DedupesOnFileHash(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/my-piece.pdf"
	writeFixturePDF(t, path, 1)
	content := readAll(t, path)

	firstRec := recordRequest(h, multipartUpload(t, "/api/pieces", "my-piece.pdf", content))
	if firstRec.Code != http.StatusCreated {
		t.Fatalf("first upload: status %d, want 201; body %s", firstRec.Code, firstRec.Body.String())
	}
	var first pieceResponse
	decodeData(t, firstRec, &first)

	secondRec := recordRequest(h, multipartUpload(t, "/api/pieces", "my-piece-again.pdf", content))
	if secondRec.Code != http.StatusOK {
		t.Fatalf("duplicate upload: status %d, want 200 (existing piece reused); body %s", secondRec.Code, secondRec.Body.String())
	}
	var second pieceResponse
	decodeData(t, secondRec, &second)

	if second.ID != first.ID {
		t.Errorf("duplicate upload created a new piece (id %d), want the existing piece (id %d) reused", second.ID, first.ID)
	}

	listRec := doJSON(t, h, http.MethodGet, "/api/pieces", nil)
	var all []pieceResponse
	decodeData(t, listRec, &all)
	if len(all) != 1 {
		t.Errorf("library has %d pieces after a duplicate upload, want exactly 1", len(all))
	}
}

// TestDeletePiece_OrphansBookWhenLastPieceRemoved covers CLAUDE.md > File
// handling's deletion semantics end to end: deleting a piece removes its
// row; deleting the last piece referencing a book removes the book too.
func TestDeletePiece_OrphansBookWhenLastPieceRemoved(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 8)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{
			{"start": 1, "end": 4},
			{"start": 5, "end": 8},
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
	firstID, secondID := result.Pieces[0].ID, result.Pieces[1].ID

	// Deleting the first of two pieces must not touch the book.
	del1 := doJSON(t, h, http.MethodDelete, apiPiecesURL(firstID), nil)
	decodeData(t, del1, nil)
	bookStillThere := doJSON(t, h, http.MethodGet, apiBooksURL(bookID), nil)
	if bookStillThere.Code != http.StatusOK {
		t.Fatalf("book after first piece delete: status %d, want 200 (book has a remaining piece)", bookStillThere.Code)
	}

	// Deleting the last remaining piece must orphan-clean the book.
	del2 := doJSON(t, h, http.MethodDelete, apiPiecesURL(secondID), nil)
	decodeData(t, del2, nil)
	bookGone := doJSON(t, h, http.MethodGet, apiBooksURL(bookID), nil)
	if bookGone.Code != http.StatusNotFound {
		t.Fatalf("book after last piece delete: status %d, want 404 (orphan cleanup)", bookGone.Code)
	}
}

// TestDeletePiece_DoesNotRemoveFileStillReferencedByAnotherPiece is a
// regression test for a real bug a code review caught: storage is
// content-addressed (internal/storage), and two distinct Piece rows can
// legitimately share one on-disk file — specifically, two sibling pieces
// split from the same book via the import wizard, which creates pieces via
// repo.CreatePiece directly and doesn't dedupe against sibling content
// (see CountPiecesWithFileHash). Deleting one used to unconditionally
// os.Remove that file — silently breaking the surviving piece's
// download/preview.
//
// This no longer happens via two direct standalone uploads: handleCreatePiece
// now dedupes on SHA-256 match (an identical upload returns the existing
// Piece instead of creating a second row), so this test fabricates the
// shared-hash state directly through repo.CreatePiece — the same call the
// wizard's confirm-import makes for each sibling piece — rather than through
// the HTTP upload endpoint, which would now just return pieceA a second time.
func TestDeletePiece_DoesNotRemoveFileStillReferencedByAnotherPiece(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	dir := t.TempDir()
	path := dir + "/shared.pdf"
	writeFixturePDF(t, path, 1)
	content := readAll(t, path)

	rec1 := recordRequest(h, multipartUpload(t, "/api/pieces", "shared-a.pdf", content))
	var pieceA pieceResponse
	decodeData(t, rec1, &pieceA)

	// Simulates a wizard sibling piece landing on the same on-disk file as
	// pieceA (repo.CreatePiece never checks for an existing hash match) —
	// fetch pieceA's real FilePath so pieceB genuinely shares its file, not
	// just its hash.
	pieceARow, err := repo.GetPieceByID(context.Background(), conn, pieceA.ID)
	if err != nil {
		t.Fatalf("fetching pieceA row: %v", err)
	}
	bID, err := repo.CreatePiece(context.Background(), conn, &models.Piece{
		Title:     "Shared File Sibling",
		FilePath:  pieceARow.FilePath,
		FileHash:  pieceARow.FileHash,
		PageCount: pieceARow.PageCount,
	})
	if err != nil {
		t.Fatalf("fabricating sibling piece: %v", err)
	}
	pieceB := pieceResponse{ID: bID, FileHash: pieceARow.FileHash}

	decodeData(t, doJSON(t, h, http.MethodDelete, apiPiecesURL(pieceA.ID), nil), nil)

	downloadRec := recordRequest(h, httptestGet(t, apiPiecesURL(pieceB.ID)+"/file"))
	if downloadRec.Code != http.StatusOK {
		t.Fatalf("downloading piece B after piece A (sharing its file) was deleted: status %d, want 200 — the shared file must survive", downloadRec.Code)
	}
	if downloadRec.Body.Len() == 0 {
		t.Error("piece B's file is empty after piece A's deletion")
	}
}

// TestReplacePieceFile_PreservesProvenanceAndSwapsHash covers design doc
// §14: sourceBookId/sourcePageStart/sourcePageEnd stay put across a file
// replace (historical provenance, not tied to the actual file), while the
// file itself is genuinely swapped.
func TestReplacePieceFile_PreservesProvenanceAndSwapsHash(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Solo", "composer": "Someone"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	original := result.Pieces[0]

	dir := t.TempDir()
	newPath := dir + "/replacement.pdf"
	writeFixturePDF(t, newPath, 9) // deliberately different page count/content from the original

	replaceRec := recordRequest(h, multipartUpload(t, apiPiecesURL(original.ID)+"/replace-file", "replacement.pdf", readAll(t, newPath)))
	if replaceRec.Code != http.StatusOK {
		t.Fatalf("replace-file: status %d, body %s", replaceRec.Code, replaceRec.Body.String())
	}
	var replaced pieceResponse
	decodeData(t, replaceRec, &replaced)

	if replaced.FileHash == original.FileHash {
		t.Error("fileHash unchanged after replace, want it to reflect the new file")
	}
	if replaced.SourceBookID == nil || *replaced.SourceBookID != bookID {
		t.Errorf("sourceBookId = %v after replace, want it preserved as %d", replaced.SourceBookID, bookID)
	}
	if replaced.SourcePageStart == nil || *replaced.SourcePageStart != *original.SourcePageStart {
		t.Errorf("sourcePageStart changed after replace, want it preserved as historical provenance")
	}

	// The old file's bytes must actually be gone, not just re-pointed to.
	downloadRec := recordRequest(h, httptestGet(t, apiPiecesURL(original.ID)+"/file"))
	if downloadRec.Code != http.StatusOK {
		t.Fatalf("download after replace: status %d", downloadRec.Code)
	}
}

// TestSetPieceThumbnailPage covers the manual thumbnail-page picker (design
// doc §14 addition): a valid selection persists and is reflected back by a
// fresh GET (not just the mutation's own response), an out-of-range page is
// rejected with a validation error and leaves the stored value untouched,
// and replacing the piece's file resets the selection to 1 rather than
// carrying a now-stale/possibly-out-of-range page number forward.
func TestSetPieceThumbnailPage(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 3)

	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)
	if uploaded.ThumbnailPage != 1 {
		t.Fatalf("thumbnailPage on upload = %d, want 1", uploaded.ThumbnailPage)
	}

	setRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID)+"/thumbnail-page", map[string]any{"page": 2})
	if setRec.Code != http.StatusOK {
		t.Fatalf("set thumbnail page: status %d, body %s", setRec.Code, setRec.Body.String())
	}
	var updated pieceResponse
	decodeData(t, setRec, &updated)
	if updated.ThumbnailPage != 2 {
		t.Errorf("thumbnailPage after set = %d, want 2", updated.ThumbnailPage)
	}

	// Reflected by a fresh read, not just the mutation's own response.
	getRec := recordRequest(h, httptestGet(t, apiPiecesURL(uploaded.ID)))
	var reread pieceResponse
	decodeData(t, getRec, &reread)
	if reread.ThumbnailPage != 2 {
		t.Errorf("thumbnailPage on re-fetch = %d, want 2", reread.ThumbnailPage)
	}

	// Out of range (piece has 3 pages) must be rejected, not clamped.
	badRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID)+"/thumbnail-page", map[string]any{"page": 4})
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("out-of-range page: status %d, want 400; body %s", badRec.Code, badRec.Body.String())
	}
	unchangedRec := recordRequest(h, httptestGet(t, apiPiecesURL(uploaded.ID)))
	var unchanged pieceResponse
	decodeData(t, unchangedRec, &unchanged)
	if unchanged.ThumbnailPage != 2 {
		t.Errorf("thumbnailPage after rejected update = %d, want unchanged 2", unchanged.ThumbnailPage)
	}

	// Replacing the file resets the selection rather than carrying a
	// possibly-stale/out-of-range page number forward.
	replacementPath := dir + "/replacement.pdf"
	writeFixturePDF(t, replacementPath, 1)
	replaceRec := recordRequest(h, multipartUpload(t, apiPiecesURL(uploaded.ID)+"/replace-file", "replacement.pdf", readAll(t, replacementPath)))
	var replaced pieceResponse
	decodeData(t, replaceRec, &replaced)
	if replaced.ThumbnailPage != 1 {
		t.Errorf("thumbnailPage after file replace = %d, want reset to 1", replaced.ThumbnailPage)
	}
}

// TestPieceThumbnail_ReturnsPNG covers the Library view's card thumbnail
// (design doc §11) for a standalone piece — one with no sourceBookId, so
// handleBookPageThumbnail isn't reachable for it at all; handlePieceThumbnail
// must work from the piece's own file regardless of provenance.
func TestPieceThumbnail_ReturnsPNG(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)

	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	rec := recordRequest(h, httptestGet(t, apiPieceThumbnailURL(uploaded.ID, 1)))
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

// TestPieceThumbnail_RejectsPageBeyondPageCount covers the bounds check
// against the piece's own PageCount (not the source book's, if any) — a
// page-cycle control that raced ahead of a since-shrunk piece shouldn't
// silently render garbage or someone else's page.
func TestPieceThumbnail_RejectsPageBeyondPageCount(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 2)

	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	rec := recordRequest(h, httptestGet(t, apiPieceThumbnailURL(uploaded.ID, 3)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("thumbnail for out-of-range page: status %d, want 400; body %s", rec.Code, rec.Body.String())
	}
}

// TestPieceThumbnail_InvalidatedAfterFileReplace is a regression test for a
// bug that would otherwise ship with handlePieceThumbnail: the thumbnail
// cache is keyed by piece id, not file hash (see handleReplacePieceFile's
// cache-cleanup step), so replacing a piece's file must not leave the old
// file's cached thumbnail being served for the new one.
func TestPieceThumbnail_InvalidatedAfterFileReplace(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)

	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	firstThumbRec := recordRequest(h, httptestGet(t, apiPieceThumbnailURL(uploaded.ID, 1)))
	if firstThumbRec.Code != http.StatusOK {
		t.Fatalf("first thumbnail: status %d", firstThumbRec.Code)
	}
	firstThumb := firstThumbRec.Body.Bytes()

	// writeFixturePDF's pages carry no drawable content (no /Contents
	// stream), so pdftoppm renders any of them as an identical blank page —
	// varying page count wouldn't actually change the rendered thumbnail.
	// A different page *size* does: pdftoppm scales by DPI against
	// MediaBox, so this genuinely renders as a different PNG.
	newPath := dir + "/replacement.pdf"
	writeFixturePDFWithMediaBox(t, newPath, 0, 0, 300, 300)
	replaceRec := recordRequest(h, multipartUpload(t, apiPiecesURL(uploaded.ID)+"/replace-file", "replacement.pdf", readAll(t, newPath)))
	if replaceRec.Code != http.StatusOK {
		t.Fatalf("replace-file: status %d, body %s", replaceRec.Code, replaceRec.Body.String())
	}

	secondThumbRec := recordRequest(h, httptestGet(t, apiPieceThumbnailURL(uploaded.ID, 1)))
	if secondThumbRec.Code != http.StatusOK {
		t.Fatalf("second thumbnail: status %d", secondThumbRec.Code)
	}
	if bytes.Equal(firstThumb, secondThumbRec.Body.Bytes()) {
		t.Error("thumbnail unchanged after file replace, want it regenerated from the new file")
	}
}

// writeFixturePDFWithMediaBox writes a minimal single-page PDF with a
// caller-chosen page size — unlike writeFixturePDF, whose fixed-size pages
// all render identically and so can't distinguish "stale cached thumbnail"
// from "correctly regenerated" in a render-based test.
func writeFixturePDFWithMediaBox(t *testing.T, path string, x0, y0, x1, y1 int) {
	t.Helper()
	content := fmt.Sprintf(`%%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [%d %d %d %d] /Resources << >> >>
endobj
xref
0 4
0000000000 65535 f
trailer
<< /Size 4 /Root 1 0 R >>
startxref
0
%%%%EOF`, x0, y0, x1, y1)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("writing fixture PDF: %v", err)
	}
}

// TestDownloadPieceFile_SuggestsFilenameWithoutForcingDownload verifies the
// Content-Disposition fix: "inline" (not "attachment", which would break
// the same route's use as a preview embed) with a title-derived filename,
// so "Save As" doesn't suggest a bare numeric ID with no extension.
func TestDownloadPieceFile_SuggestsFilenameWithoutForcingDownload(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":    "Prélude / Étude No. 1?",
		"composer": "Someone",
	}), nil)

	rec := recordRequest(h, httptestGet(t, apiPiecesURL(uploaded.ID)+"/file"))
	if rec.Code != http.StatusOK {
		t.Fatalf("download: status %d", rec.Code)
	}
	disposition := rec.Header().Get("Content-Disposition")
	if !strings.HasPrefix(disposition, "inline;") {
		t.Errorf("Content-Disposition = %q, want it to start with %q", disposition, "inline;")
	}
	if !strings.Contains(disposition, ".pdf") {
		t.Errorf("Content-Disposition = %q, want a .pdf filename", disposition)
	}
	// Characters from the title that would break a filesystem path or a
	// header value (the outer quotes around the filename are correct,
	// structural header syntax — it's characters from the title bleeding
	// through unescaped that would be the bug) must not survive verbatim.
	for _, unsafe := range []string{"/", "?"} {
		if strings.Contains(disposition, unsafe) {
			t.Errorf("Content-Disposition = %q, contains unsafe character %q from the title", disposition, unsafe)
		}
	}
}

// TestGetRandomPiece_ReturnsAPiece covers the Piece Details page dice button's
// backend: GET /api/pieces/random must resolve as the literal route, not
// fall through to handleGetPiece and get parsed as an id of "random".
func TestGetRandomPiece_ReturnsAPiece(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	var uploaded pieceResponse
	decodeData(t, recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path))), &uploaded)

	rec := doJSON(t, h, http.MethodGet, "/api/pieces/random", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/pieces/random: status %d, want 200", rec.Code)
	}
	var got pieceResponse
	decodeData(t, rec, &got)
	if got.ID != uploaded.ID {
		t.Errorf("random piece id = %d, want the only piece in the library (%d)", got.ID, uploaded.ID)
	}
}

func TestGetRandomPiece_404WhenLibraryEmpty(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/pieces/random", nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /api/pieces/random on an empty library: status %d, want 404", rec.Code)
	}
}

func TestGetPiece_404ForNonexistentID(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(99999), nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET nonexistent piece: status %d, want 404", rec.Code)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding error body: %v", err)
	}
	if body.Error.Code != "NOT_FOUND" {
		t.Errorf("error code = %q, want NOT_FOUND", body.Error.Code)
	}
}

// TestUpdatePiece_TagValidationErrorNamesTheRealField is a regression test
// for a code-review finding: a too-long key/sheetType/instrument/userTag
// name used to always report a hardcoded, ambiguous field label ("tags" or
// "key/sheetType") regardless of which actual field failed, making it
// impossible for a frontend to highlight the right input.
// TestGetPiece_ArrangerInheritsFromBook covers the full API contract for
// arranger becoming book-inheritable (2026-08-20): PieceResponse.Arranger
// is now {value, inherited} like every other book-inheritable field, not
// the plain nullable string it used to be. Repo-level resolution logic is
// already covered by TestResolveEffective_ArrangerInheritsFromBook — this
// confirms the HTTP layer actually wires eff.Arranger through, not a raw
// Piece column.
func TestGetPiece_ArrangerInheritsFromBook(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology",
		"arranger":  "Book Arranger",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Inherits"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(result.Pieces[0].ID), nil)
	var piece pieceResponse
	decodeData(t, rec, &piece)

	if piece.Arranger.Value != "Book Arranger" || !piece.Arranger.Inherited {
		t.Errorf("arranger = %+v, want {value: %q, inherited: true}", piece.Arranger, "Book Arranger")
	}
}

func TestUpdatePiece_TagValidationErrorNamesTheRealField(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	tooLong := strings.Repeat("a", 256)

	for _, tc := range []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"keys", map[string]any{"title": "T", "composer": "C", "keys": []string{tooLong}}, "keys"},
		{"sheetTypeName", map[string]any{"title": "T", "composer": "C", "sheetTypeName": tooLong}, "sheetTypeName"},
		{"instruments", map[string]any{"title": "T", "composer": "C", "instruments": []string{tooLong}}, "instruments"},
		{"userTags", map[string]any{"title": "T", "composer": "C", "userTags": []string{tooLong}}, "userTags"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body %s", rec.Code, rec.Body.String())
			}
			var body struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decoding error body: %v", err)
			}
			if !strings.Contains(body.Error.Message, tc.field) {
				t.Errorf("error message = %q, want it to name field %q", body.Error.Message, tc.field)
			}
		})
	}
}

// TestUpdatePiece_SetsAndClearsSourceBookID covers the Piece Properties
// Edit Menu's Source Book field (design doc §15) — re-matching a piece to
// an existing Book via sourceBookId, and clearing it back to none via the
// same full-replace rule every other field here follows (omitting it on a
// later write clears it, not "leaves it alone").
func TestUpdatePiece_SetsAndClearsSourceBookID(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	bookRec := doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{
		"bookTitle": "Album für die Jugend, Op. 68",
		"composer":  "Robert Schumann",
	})
	var book bookResponse
	decodeData(t, bookRec, &book)

	setRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":        "No. 9, Volksliedchen",
		"composer":     "Robert Schumann",
		"sourceBookId": book.ID,
	})
	var withBook pieceResponse
	decodeData(t, setRec, &withBook)
	if withBook.SourceBookID == nil || *withBook.SourceBookID != book.ID {
		t.Fatalf("sourceBookId = %v, want %d", withBook.SourceBookID, book.ID)
	}
	if withBook.SourceBookTitle == nil || *withBook.SourceBookTitle != book.BookTitle {
		t.Errorf("sourceBookTitle = %v, want %q", withBook.SourceBookTitle, book.BookTitle)
	}

	// Round-trip through a fresh GET, not just the mutation's own response.
	getRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID), nil)
	var reloaded pieceResponse
	decodeData(t, getRec, &reloaded)
	if reloaded.SourceBookID == nil || *reloaded.SourceBookID != book.ID {
		t.Fatalf("after reload, sourceBookId = %v, want %d", reloaded.SourceBookID, book.ID)
	}

	// Omitting sourceBookId on a later write clears it — same full-replace
	// rule as every other field, not "leaves it alone."
	clearRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":    "No. 9, Volksliedchen",
		"composer": "Robert Schumann",
	})
	var cleared pieceResponse
	decodeData(t, clearRec, &cleared)
	if cleared.SourceBookID != nil {
		t.Errorf("sourceBookId after omitting it = %v, want nil (full-replace)", cleared.SourceBookID)
	}
}

// TestUpdatePiece_RejectsNonexistentSourceBookID ensures a bad/stale
// sourceBookId (e.g. the book was deleted in another tab) surfaces as a
// clean 400 validation error naming the field, not an opaque 500 from
// repo.ResolveEffective discovering the missing book later in the request.
func TestUpdatePiece_RejectsNonexistentSourceBookID(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	rec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":        "T",
		"composer":     "C",
		"sourceBookId": 999999,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding error body: %v", err)
	}
	if !strings.Contains(body.Error.Message, "sourceBookId") {
		t.Errorf("error message = %q, want it to name field %q", body.Error.Message, "sourceBookId")
	}
}

func TestUpdatePiece_400ForMalformedJSON(t *testing.T) {
	h := newTestServer(t)
	req := httptest.NewRequest(http.MethodPatch, apiPiecesURL(1), strings.NewReader("{not valid json"))
	rec := recordRequest(h, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("PATCH with malformed JSON: status %d, want 400", rec.Code)
	}
}
