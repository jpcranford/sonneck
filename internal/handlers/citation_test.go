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

	// The piece owns this IMSLP number directly (not inherited from the
	// book), so per the book/piece-opus citation follow-up (direct request,
	// 2026-09-03) the whole publish sentence — where ISBN would otherwise
	// have shown — is dropped entirely, not just the ISBN within it: a
	// piece already pinned to its own IMSLP record doesn't need a second
	// sentence restating facts that record already carries.
	want := `Charles-Marie Widor, "Toccata", IMSLP #04154.`
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

	// An opus match means the piece is part of a greater work (direct
	// request, 2026-09-03 follow-up), so the book's title/opus fold
	// straight into this one sentence — same shape a flat/public-domain
	// citation already uses — rather than a separate "Published in ..."
	// sentence; there's no publisher/IMSLP/ISBN on record here for a
	// publish sentence to add anyway.
	want := `Robert Schumann, Album für die Jugend, Op. 68, No. 9 "Volksliedchen".`
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

	// Same opus-match fold-in as the Schumann test above — the book's title/
	// opus join the one sentence, with nothing left over to prefix the
	// title with (pure inheritance).
	want := `Sergei Prokofiev, Symphony No. 1: Classical Symphony, Op. 25, "Allegro".`
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
// buildFlatCitation, not just buildTwoSentenceCitation). Also doubles as
// coverage for the "Public domain." trailing note's one remaining case:
// this piece has no copyrightYear set anywhere, so the live calculation's
// own conclusion is the conservative negative (not likely PD) — an
// explicit 'publicDomain' pick against that is exactly the contradiction
// buildCitation keeps the note for. See the two tests below for the
// (now default) dropped case.
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
		"title":          "Prélude",
		"sourceBookId":   bookID,
		"workOpusNumber": "Op. 12 No. 5",
		"imslpNumber":    "972987",
		// yearWritten (1842) drives the citation's own displayed date;
		// copyrightYear is set separately, deliberately recent, so the
		// calculation genuinely disagrees with the explicit publicDomain
		// pick below (2020 + a 95-year US term hasn't expired yet) — this
		// test is specifically about that contradiction case, and without
		// an explicit copyrightYear the calc's own CopyrightYearForCalc
		// fallback would otherwise pick up yearWritten=1842 itself (long
		// expired), agreeing with the pick and suppressing the note this
		// test exists to check for.
		"copyrightYear":   2020,
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

// A computed 'likelyPublicDomain' status never gets a trailing note — it's
// derived from the calculation itself, so it can never contradict it
// (direct follow-up request: drop the "Public domain." addendum by
// default, keeping it only for the one case covered by the test above).
func TestCitation_LikelyPublicDomainGetsNoTrailingNote(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":         "Solo",
		"composers":     []string{"Someone"},
		"copyrightYear": 1700,
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	// yearWritten falls back to the piece's own copyrightYear when blank
	// (direct follow-up request) — this piece never set yearWritten, so
	// "1700" now correctly appears, sourced from copyrightYear.
	want := `Someone, "Solo", 1700.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// An explicit 'publicDomain' pick that the live calculation actually
// agrees with (a real, old copyrightYear on record) also gets no trailing
// note — there's no contradiction to clarify, so this is the same
// "ends bare" default as the computed case above, not the exception.
func TestCitation_ExplicitPublicDomainAgreeingWithCalculationGetsNoTrailingNote(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":           "Solo",
		"composers":       []string{"Someone"},
		"copyrightYear":   1700,
		"copyrightStatus": "publicDomain",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	// yearWritten falls back to the piece's own copyrightYear when blank
	// (direct follow-up request) — same reasoning as the test above.
	want := `Someone, "Solo", 1700.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// Real bug found live, 2026-09-05: an explicit 'publicDomain' pick that
// contradicts the calculation (copyrightYear recent enough that the term
// hasn't expired yet) used to substitute the piece's own CopyrightSlug for
// the trailing "Public domain." note when one was set — "Tom Lehrer,
// 'Smut', 1965. Released into public domain on November 26, 2022." instead
// of "... Public domain." — reading as the slug silently overriding the PD
// status rather than clarifying it. Direct product decision: the trailing
// note is always the bare literal now, regardless of CopyrightSlug (which
// still displays on its own in Piece Details' Advanced/Get Info panel).
func TestCitation_PublicDomainOverrideNeverShowsCopyrightSlug(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":           "Smut",
		"composers":       []string{"Tom Lehrer"},
		"copyrightYear":   1965, // 1965+95=2060, still in the future
		"copyrightStatus": "publicDomain",
		"copyrightSlug":   "Released into public domain on November 26, 2022.",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Tom Lehrer, "Smut", 1965. Public domain.`
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

// The following four tests cover the full opus-match / IMSLP-ownership
// matrix the two-sentence citation follow-up (direct request, 2026-09-03)
// introduced. "Opus matches, piece owns IMSLP" is covered by the request's
// own worked example below; "opus doesn't match, piece owns IMSLP" is
// already covered by TestCitation_ISBNHiddenWhenImslpPresent above (that
// book has no workOpusNumber at all, so nothing to match against); "opus
// doesn't match, neither owns IMSLP" is TestCitation_ShowsBookOpusNumberWhenNotContainedInPieceOpusNumber
// above, unchanged from the original single "Published in" format.

// The request's own worked example: opus matches (book "part of a greater
// work"), and the piece owns its IMSLP number directly — book title/opus
// fold into the one sentence, the IMSLP number goes right there with them,
// and there's no second "Published..." sentence at all.
func TestCitation_OpusMatchWithPieceOwnedImslp(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":      "Six Short Preludes and Postludes",
		"composers":      []string{"Charles Villiers Stanford"},
		"workOpusNumber": "Op. 105",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Lento", "workOpusNumber": "Op. 105 III."}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(pieceID), map[string]any{
		"title":          "Lento",
		"sourceBookId":   bookID,
		"workOpusNumber": "Op. 105 III.",
		"imslpNumber":    "07953",
		"yearWritten":    "1908",
		"copyrightYear":  2013,
		"publisher":      "Stainer & Bell",
	}), nil)

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Charles Villiers Stanford, Six Short Preludes and Postludes, Op. 105, III. "Lento", IMSLP #07953, 1908. Copyright © 2013 Stainer & Bell.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// Opus matches, but the IMSLP number belongs to the book, not the piece —
// no identifier at all in the first sentence (publisher stays only in the
// publish sentence, not duplicated in both places), and the publish
// sentence itself keeps the book's IMSLP number as its own segment
// alongside publisher, not in place of it (a deliberate divergence from the
// flat citation's own dominant-IMSLP-wins rule, since this sentence is
// specifically about the book's own publication facts).
func TestCitation_OpusMatchWithBookOwnedImslp(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":      "Album for the Young",
		"composers":      []string{"Jane Doe"},
		"workOpusNumber": "Op. 68",
		"imslpNumber":    "12345",
		"publisher":      "Henle Verlag",
		"yearPublished":  "2015",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "The Reaper's Song", "workOpusNumber": "Op. 68, No. 3"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(pieceID), map[string]any{
		"title":          "The Reaper's Song",
		"sourceBookId":   bookID,
		"workOpusNumber": "Op. 68, No. 3",
		"yearWritten":    "1878",
		"copyrightYear":  2015,
	}), nil)

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Jane Doe, Album for the Young, Op. 68, No. 3 "The Reaper's Song", 1878. Published by Henle Verlag, IMSLP #12345, 2015. Copyright © 2015 Henle Verlag.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// Opus matches, no IMSLP number anywhere — the publish sentence still runs
// (there's a publisher/year to report), just reworded from "Published in
// {book}, ..." to "Published by {publisher}, ..." since the book's own
// name/opus already said its piece in the first sentence.
func TestCitation_OpusMatchWithNoImslpUsesPublishedByWording(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":      "Album for the Young",
		"composers":      []string{"Jane Doe"},
		"workOpusNumber": "Op. 68",
		"publisher":      "Henle Verlag",
		"yearPublished":  "2015",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "The Reaper's Song", "workOpusNumber": "Op. 68, No. 3"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(pieceID), map[string]any{
		"title":          "The Reaper's Song",
		"sourceBookId":   bookID,
		"workOpusNumber": "Op. 68, No. 3",
		"yearWritten":    "1878",
		"copyrightYear":  2015,
	}), nil)

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Jane Doe, Album for the Young, Op. 68, No. 3 "The Reaper's Song", 1878. Published by Henle Verlag, 2015. Copyright © 2015 Henle Verlag.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// Opus doesn't match (no book opus at all to match against — a distinct
// piece within an anthology) and the book, not the piece, owns the IMSLP
// number — the publish sentence keeps its original "Published in {book},
// ..." wording (book title never moved out of it) and gains the book's
// IMSLP number as its own segment, same as the opus-match case above.
func TestCitation_NoOpusMatchWithBookOwnedImslp(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle":     "Album for the Young",
		"composers":     []string{"Jane Doe"},
		"imslpNumber":   "12345",
		"publisher":     "Henle Verlag",
		"yearPublished": "2015",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "The Reaper's Song", "workOpusNumber": "No. 3"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(pieceID), map[string]any{
		"title":          "The Reaper's Song",
		"sourceBookId":   bookID,
		"workOpusNumber": "No. 3",
		"yearWritten":    "1878",
		"copyrightYear":  2015,
	}), nil)

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Jane Doe, "The Reaper's Song" (No. 3), 1878. Published in Album for the Young, Henle Verlag, IMSLP #12345, 2015. Copyright © 2015 Henle Verlag.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// US renewal follow-up: a bare "(renewed)" marker (no specific year — the
// exact renewal filing year never affects the term calculation, so there's
// nothing more precise to cite) appears right after the copyright year,
// before the holder, when CopyrightRenewed is set. 1950 is deliberately
// chosen so the renewed 95-year term (1950+95=2045) hasn't elapsed yet —
// otherwise the live calculation would upgrade this piece's explicit
// "inCopyright" pick to a computed public-domain status before citation
// generation even sees it, routing through buildFlatCitation's bare-ending
// path instead of the copyrightClause this test exists to check.
func TestCitation_CopyrightClauseShowsRenewedMarker(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":            "Solo",
		"composers":        []string{"Someone"},
		"yearWritten":      "1950",
		"copyrightYear":    1950,
		"copyrightRenewed": true,
		"copyrightHolder":  "Test Publishing",
		"copyrightStatus":  "inCopyright",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", 1950. Copyright © 1950 (renewed) Test Publishing.`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

// Same shape, but CopyrightRenewed left unset — no "(renewed)" marker,
// confirming it's conditional, not always shown once a copyright year is
// present. 1990 (outside the 1923-1963 renewal window) is used here
// specifically so the calculation's own "unrenewed 1923-1963 gets only 28
// years" logic doesn't come into play at all — that's not what this test
// is about, and an in-window year here would auto-upgrade this piece past
// "inCopyright" before citation generation ever ran (the same reasoning
// the test above documents, just the opposite direction: an *unrenewed* in-
// window year is exactly the case that resolves to public domain quickly).
func TestCitation_CopyrightClauseOmitsRenewedMarkerWhenUnset(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":           "Solo",
		"composers":       []string{"Someone"},
		"yearWritten":     "1990",
		"copyrightYear":   1990,
		"copyrightHolder": "Test Publishing",
		"copyrightStatus": "inCopyright",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", 1990. Copyright © 1990 Test Publishing.`
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
