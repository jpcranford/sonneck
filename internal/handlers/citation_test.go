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
		"composers": []string{"Charles-Marie Widor"},
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Toccata", "workOpusNumber": "Op. 42"}},
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

	want := `Charles-Marie Widor, "Toccata" (Op. 42). Published in Six Symphonies.`
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
		"composers":   []string{"Someone"},
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
		"composers":   []string{"Someone"},
		"publisher":   "G. Schirmer",
		"publisherId": "HL50252950",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", G. Schirmer #HL50252950 Copyright © G. Schirmer.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// IMSLP number still wins the fallback entirely over publisherId
// (publisherId is dropped, not shown alongside it) — unaffected by the
// "IMSLP #" formatting change covered separately below.
// TestCitation_ImslpNumberSuppressesPublisherAndPublisherId locks in: when
// imslpNumber is present, publisher (and the publisherId fused onto it)
// are dropped from the citation entirely, not just the publisherId half
// of that pair.
func TestCitation_ImslpNumberSuppressesPublisherAndPublisherId(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":       "Solo",
		"composers":   []string{"Someone"},
		"publisher":   "G. Schirmer",
		"publisherId": "HL50252950",
		"imslpNumber": "04154",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", IMSLP #04154 Copyright © G. Schirmer.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// IMSLP renders with an explicit "IMSLP #" label, and strips any "IMSLP"
// text already baked into the stored value (common in existing data,
// entered before EditPieceModal started stripping it on save) so the
// label never doubles up.
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
		"composers":   []string{"Someone"},
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
// before "arr.") — a deliberate reversal of design doc §6's original
// exclusion of arranger from the citation format (CLAUDE.md > Config).
func TestCitation_ArrangerFusesOntoComposer(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":     "Solo",
		"composers": []string{"Robert Schumann"},
		"arrangers": []string{"J. Someone"},
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

// TestCitation_ArrangerAloneWithNoComposer covers the composer-OR-arranger
// rule's effect on the citation specifically: with no composer at all,
// the composer segment renders as just "arr. {arranger}" instead of
// disappearing — the old logic only ever appended arranger onto an
// already-non-blank composer.
func TestCitation_ArrangerAloneWithNoComposer(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":     "Traditional Tune",
		"arrangers": []string{"J. Someone"},
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `arr. J. Someone, "Traditional Tune"`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// TestCitation_ISBNAppearsAfterPublisherWhenImslpBlank covers the ISBN
// citation component: its own comma-joined part, right after the
// publisher/publisherId segment, hyphenated via the simplified heuristic
// (hyphenateISBN's own doc comment). The digits here
// are a real, well-known ISBN-13 ("Clean Code" by Robert C. Martin,
// publicly documented as 978-0-13-235088-4) chosen for recognizability —
// the *expected* hyphenation below is this project's own simplified
// 4-segment output (EAN-group-lumped-check), not that fully-correct 5-segment
// form: this heuristic doesn't attempt the publisher/title split at all
// (see hyphenateISBN), so "13" (publisher) and "235088" (title) come out as
// one lumped "13235088" block rather than split.
func TestCitation_ISBNAppearsAfterPublisherWhenImslpBlank(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Six Symphonies",
		"composers": []string{"Charles-Marie Widor"},
		"publisher": "G. Schirmer",
		"isbn":      "9780132350884",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Toccata"}},
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

	want := `Charles-Marie Widor, "Toccata". Published in Six Symphonies, G. Schirmer, ISBN 978-0-13235088-4. Copyright © G. Schirmer.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// TestCitation_ISBNHiddenWhenImslpPresent locks in the "IMSLP always wins
// the fallback" rule extended to ISBN, same treatment publisherId already
// gets when imslpNumber is present.
func TestCitation_ISBNHiddenWhenImslpPresent(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Six Symphonies",
		"composers": []string{"Charles-Marie Widor"},
		"isbn":      "9780132350884",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Toccata", "imslpNumber": "04154"}},
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

	want := `Charles-Marie Widor, "Toccata". Published in Six Symphonies, IMSLP #04154.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// TestCitation_ISBN10Hyphenation covers the ISBN-10 branch specifically
// (distinct from the ISBN-13 case covered above) — "0132350882" is the
// ISBN-10 counterpart of the same "Clean Code" ISBN used above. Same
// caveat as that test: the expected value is this heuristic's own
// 3-segment output (group-lumped-check), not the fully-correct
// publicly-documented "0-13-235088-2" (which splits publisher from title).
func TestCitation_ISBN10Hyphenation(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Six Symphonies",
		"composers": []string{"Charles-Marie Widor"},
		"isbn":      "0132350882",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Toccata"}},
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

	want := `Charles-Marie Widor, "Toccata". Published in Six Symphonies, ISBN 0-13235088-2.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// The book's own opus number always renders next to the book's name once
// the book has one (direct request, 2026-09-03) — when the piece's own
// effective opus number incorporates it (spaces ignored), only the
// piece's own distinguishing remainder renders, as a bare prefix on the
// title (no comma, no parens) rather than the book's opus number
// appearing a second time inside the piece's own "(workOpusNumber)"
// parenthetical.
func TestCitation_BookOpusNumberMovesToBookNameWhenPieceOpusIncorporatesIt(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":      "Album für die Jugend",
		"composers":      []string{"Robert Schumann"},
		"workOpusNumber": "Op. 68",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Volksliedchen", "workOpusNumber": "Op. 68, No. 9"}},
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

	want := `Robert Schumann, No. 9 "Volksliedchen". Published in Album für die Jugend, Op. 68.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// A piece that purely inherits its opus number from the book (no override
// of its own — the common case for most pieces in a book) has nothing
// distinguishing to add next to the title: the book's opus renders next
// to the book's name as usual, but the title itself stays bare, with no
// prefix and no "(...)" parenthetical either.
func TestCitation_BookOpusNumberWithPureInheritanceLeavesTitleBare(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":      "Symphony No. 1: Classical Symphony",
		"composers":      []string{"Sergei Prokofiev"},
		"workOpusNumber": "Op. 25",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Allegro"}},
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

	want := `Sergei Prokofiev, "Allegro". Published in Symphony No. 1: Classical Symphony, Op. 25.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// Direct request's own "perhaps clearer example" — Boëly's "24 Pièces pour
// l'orgue," book opus "Op. 12," a piece whose own effective opus is "Op.
// 12 No. 5" (no comma, unlike the Schumann fixture above — confirms the
// remainder split works with or without one), Public Domain status (the
// flat citation format, not the two-sentence in-copyright one, so this
// also confirms the book-opus/title-prefix logic applies identically to
// buildFlatCitation, not just buildTwoSentenceCitation).
func TestCitation_FlatCitationMovesBookOpusToBookNameForPublicDomainPiece(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":      "24 Pièces pour l'orgue",
		"composers":      []string{"Alexandre Boëly"},
		"workOpusNumber": "Op. 12",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Prélude", "workOpusNumber": "Op. 12 No. 5"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(pieceID), map[string]any{
		"title":           "Prélude",
		"sourceBookId":    bookID,
		"workOpusNumber":  "Op. 12 No. 5",
		"imslpNumber":     "972987",
		"yearWritten":     "1842",
		"copyrightStatus": "publicDomain",
	}), nil)

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Alexandre Boëly, 24 Pièces pour l'orgue, Op. 12, No. 5 "Prélude", IMSLP #972987, 1842. Public domain.`
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
		"composers":      []string{"Johann Sebastian Bach"},
		"workOpusNumber": "BWV Anh. 113-132",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Minuet", "workOpusNumber": "BWV Anh. 114"}},
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

	want := `Johann Sebastian Bach, "Minuet" (BWV Anh. 114). Published in Notebook for Anna Magdalena Bach, BWV Anh. 113-132.`
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
		"composers":   []string{"Joe Hisaishi"},
		"arrangers":   []string{"M. Yamamoto"},
		"publisher":   "Sony/ATV Music Publishing (UK)",
		"yearWritten": "2004",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Joe Hisaishi, arr. M. Yamamoto, "Merry-Go-Round of Life from 'Howl's Moving Castle'", Sony/ATV Music Publishing (UK), 2004. Copyright © Sony/ATV Music Publishing (UK).`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}
