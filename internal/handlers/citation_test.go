package handlers_test

import (
	"net/http"
	"testing"
)

func TestCitation_OmitsBlankFieldsAndUsesBookTitle(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Six Symphonies",
		"composer":  "Charles-Marie Widor",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"boundaries": []int{},
		"pieces":     []map[string]any{{"title": "Toccata", "workOpusNumber": "Op. 42"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Charles-Marie Widor, Six Symphonies, "Toccata" (Op. 42)`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// publisherId with no publisher name to attach to: still gets the "#"
// prefix, just with no publisher text ahead of it.
func TestCitation_FallsBackToPublisherIdWhenImslpNumberBlank(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":       "Solo",
		"composer":    "Someone",
		"publisherId": "PN-123",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", #PN-123`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// publisherId fuses onto the publisher name ("Publisher #ID", no comma)
// when it's the one actually in use — a real deviation from the plain
// comma-joined treatment every other citation component gets.
func TestCitation_PublisherIdFusesOntoPublisherName(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":       "Solo",
		"composer":    "Someone",
		"publisher":   "G. Schirmer",
		"publisherId": "HL50252950",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", G. Schirmer #HL50252950`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// IMSLP number still wins the fallback entirely over publisherId
// (publisherId is dropped, not shown alongside it) — unaffected by the
// "IMSLP #" formatting change covered separately below.
func TestCitation_ImslpNumberWinsOverPublisherId(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":       "Solo",
		"composer":    "Someone",
		"publisher":   "G. Schirmer",
		"publisherId": "HL50252950",
		"imslpNumber": "04154",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", G. Schirmer, IMSLP #04154`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// IMSLP renders with an explicit "IMSLP #" label, 2026-08-17 — and strips
// any "IMSLP" text already baked into the stored value (common in
// existing data, and in data written before EditPieceModal started
// stripping it on save) so the label never doubles up.
func TestCitation_ImslpNumberGetsHashLabelAndStripsExistingPrefix(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":       "Solo",
		"composer":    "Someone",
		"imslpNumber": "IMSLP04154",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", IMSLP #04154`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// Arranger fuses onto the composer ("Author, arr. Arranger", no comma
// before "arr.") — a direct instruction overriding design doc §6's
// original exclusion of arranger from the citation format.
func TestCitation_ArrangerFusesOntoComposer(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":    "Solo",
		"composer": "Robert Schumann",
		"arranger": "J. Someone",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Robert Schumann, arr. J. Someone, "Solo"`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// Book's own opus number is suppressed from the book-title segment when
// it's already contained (spaces ignored) in the piece's own effective
// opus number — otherwise the same opus number would appear twice in one
// citation (book-title segment + the piece's own "(workOpusNumber)"
// parenthetical next to the title).
func TestCitation_SuppressesBookOpusNumberWhenContainedInPieceOpusNumber(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":      "Album für die Jugend",
		"composer":       "Robert Schumann",
		"workOpusNumber": "Op. 68",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"boundaries": []int{},
		"pieces":     []map[string]any{{"title": "Volksliedchen", "workOpusNumber": "Op. 68, No. 9"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Robert Schumann, Album für die Jugend, "Volksliedchen" (Op. 68, No. 9)`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// The book's opus number still renders (as its own comma-joined addition
// to the book title) when the piece's own effective opus number doesn't
// actually contain it — a genuinely different identifier, not a
// duplicate, so nothing should be suppressed.
func TestCitation_ShowsBookOpusNumberWhenNotContainedInPieceOpusNumber(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":      "Notebook for Anna Magdalena Bach",
		"composer":       "Johann Sebastian Bach",
		"workOpusNumber": "BWV Anh. 113-132",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"boundaries": []int{},
		"pieces":     []map[string]any{{"title": "Minuet", "workOpusNumber": "BWV Anh. 114"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Johann Sebastian Bach, Notebook for Anna Magdalena Bach, BWV Anh. 113-132, "Minuet" (BWV Anh. 114)`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// A title containing its own literal double quotes (a nested subtitle,
// e.g. "Merry-Go-Round of Life from "Howl's Moving Castle"") would
// otherwise collide with the citation's own wrapping quotes — those
// embedded quotes render as single quotes instead, standard nested-quote
// convention.
func TestCitation_TitleDoubleQuotesBecomeSingleQuotes(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":       `Merry-Go-Round of Life from "Howl's Moving Castle"`,
		"composer":    "Joe Hisaishi",
		"arranger":    "M. Yamamoto",
		"publisher":   "Sony/ATV Music Publishing (UK)",
		"yearWritten": "2004",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Joe Hisaishi, arr. M. Yamamoto, "Merry-Go-Round of Life from 'Howl's Moving Castle'", Sony/ATV Music Publishing (UK), 2004`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}
