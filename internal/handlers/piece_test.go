package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func apiPiecesURL(id int64) string {
	return fmt.Sprintf("/api/pieces/%d", id)
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

// TestDeletePiece_OrphansBookWhenLastPieceRemoved covers CLAUDE.md > File
// handling's deletion semantics end to end: deleting a piece removes its
// row; deleting the last piece referencing a book removes the book too.
func TestDeletePiece_OrphansBookWhenLastPieceRemoved(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 8)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"boundaries": []int{4},
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
// content-addressed (internal/storage), but piece uploads aren't deduped
// on hash the way book uploads are, so two distinct Piece rows can
// legitimately share one on-disk file. Deleting one used to unconditionally
// os.Remove that file — silently breaking the surviving piece's
// download/preview.
func TestDeletePiece_DoesNotRemoveFileStillReferencedByAnotherPiece(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/shared.pdf"
	writeFixturePDF(t, path, 1)
	content := readAll(t, path)

	rec1 := recordRequest(h, multipartUpload(t, "/api/pieces", "shared-a.pdf", content))
	var pieceA pieceResponse
	decodeData(t, rec1, &pieceA)

	rec2 := recordRequest(h, multipartUpload(t, "/api/pieces", "shared-b.pdf", content))
	var pieceB pieceResponse
	decodeData(t, rec2, &pieceB)

	if pieceA.FileHash != pieceB.FileHash {
		t.Fatalf("test setup: expected both pieces to share a file hash, got %q and %q", pieceA.FileHash, pieceB.FileHash)
	}

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
		"boundaries": []int{},
		"pieces":     []map[string]any{{"title": "Solo", "composer": "Someone"}},
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
		{"keyName", map[string]any{"title": "T", "composer": "C", "keyName": tooLong}, "keyName"},
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

func TestUpdatePiece_400ForMalformedJSON(t *testing.T) {
	h := newTestServer(t)
	req := httptest.NewRequest(http.MethodPatch, apiPiecesURL(1), strings.NewReader("{not valid json"))
	rec := recordRequest(h, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("PATCH with malformed JSON: status %d, want 400", rec.Code)
	}
}
