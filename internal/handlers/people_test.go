package handlers_test

import (
	"bytes"
	"net/http"
	"testing"
)

func apiPeopleURL(id int64) string {
	return "/api/people/" + itoa(id)
}

type personResponse struct {
	ID                int64   `json:"id"`
	Name              string  `json:"name"`
	Bio               *string `json:"bio"`
	BirthYear         *int    `json:"birthYear"`
	DeathYear         *int    `json:"deathYear"`
	HasCustomPortrait bool    `json:"hasCustomPortrait"`
	PieceCount        int     `json:"pieceCount"`
}

func createPerson(t *testing.T, h http.Handler, name string) personResponse {
	t.Helper()
	rec := doJSON(t, h, http.MethodPost, "/api/people", map[string]any{"name": name})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create person %q: status %d, body %s", name, rec.Code, rec.Body.String())
	}
	var p personResponse
	decodeData(t, rec, &p)
	return p
}

func TestCreatePerson_RequiresName(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodPost, "/api/people", map[string]any{})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400 (name required); body %s", rec.Code, rec.Body.String())
	}
}

func TestCreatePerson_RoundTrips(t *testing.T) {
	h := newTestServer(t)
	birthYear, deathYear := 1810, 1849
	rec := doJSON(t, h, http.MethodPost, "/api/people", map[string]any{
		"name":      "Frédéric Chopin",
		"birthYear": birthYear,
		"deathYear": deathYear,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201; body %s", rec.Code, rec.Body.String())
	}
	var p personResponse
	decodeData(t, rec, &p)
	if p.Name != "Frédéric Chopin" {
		t.Errorf("name = %q, want %q", p.Name, "Frédéric Chopin")
	}
	if p.BirthYear == nil || *p.BirthYear != birthYear || p.DeathYear == nil || *p.DeathYear != deathYear {
		t.Errorf("birthYear/deathYear = %v/%v, want %d/%d", p.BirthYear, p.DeathYear, birthYear, deathYear)
	}
	if p.PieceCount != 0 {
		t.Errorf("pieceCount = %d, want 0 (freshly created, no credits yet)", p.PieceCount)
	}
}

// TestUpdatePiece_ComposersRoundTripAndFindOrCreate covers the core write
// path end to end: submitting composer/arranger names via the piece edit
// endpoint find-or-creates Person rows and preserves submission order.
func TestUpdatePiece_ComposersRoundTripAndFindOrCreate(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	updateRec := doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":     "Collaboration",
		"composers": []string{"Second Composer", "First Composer"},
	})
	var updated pieceResponse
	decodeData(t, updateRec, &updated)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("update: status %d, body %s", updateRec.Code, updateRec.Body.String())
	}
	names := updated.Composer.names()
	if len(names) != 2 || names[0] != "Second Composer" || names[1] != "First Composer" {
		t.Errorf("composer names = %v, want [Second Composer, First Composer] in submission order", names)
	}

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people", nil), &people)
	if len(people) != 2 {
		t.Fatalf("GET /api/people returned %d, want 2 (both find-or-created)", len(people))
	}
}

// TestUpdatePerson_NameChangeResyncsCreditedPieces confirms a Person name
// edit ripples into search — same "book edit fans out to inheriting
// pieces" reasoning, since a person's credit resolves live everywhere,
// with no denormalized copy anywhere to go stale.
func TestUpdatePerson_NameChangeResyncsCreditedPieces(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":     "Renamed Composer Test",
		"composers": []string{"Original Name"},
	}), nil)

	assertSearchCount(t, h, "Original", 1)

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people", nil), &people)
	if len(people) != 1 {
		t.Fatalf("expected exactly 1 person, got %d", len(people))
	}
	personID := people[0].ID

	renameRec := doJSON(t, h, http.MethodPatch, apiPeopleURL(personID), map[string]any{
		"name": "Renamed Name",
	})
	if renameRec.Code != http.StatusOK {
		t.Fatalf("rename person: status %d, body %s", renameRec.Code, renameRec.Body.String())
	}

	assertSearchCount(t, h, "Original", 0)
	assertSearchCount(t, h, "Renamed", 1)
}

// TestSplitPerson_ReassignsCreditsAndLeavesOriginalWithZero is the HTTP-
// level round trip of the repo-level split test — confirms the endpoint
// wiring (find-or-create replacement names, resync) works end to end, not
// just the underlying repo function in isolation.
func TestSplitPerson_ReassignsCreditsAndLeavesOriginalWithZero(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":     "Split Target",
		"composers": []string{"Original Person"},
	}), nil)

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people", nil), &people)
	originalID := people[0].ID

	splitRec := doJSON(t, h, http.MethodPost, apiPeopleURL(originalID)+"/split", map[string]any{
		"replacementNames": []string{"Replacement One", "Replacement Two"},
	})
	if splitRec.Code != http.StatusOK {
		t.Fatalf("split: status %d, body %s", splitRec.Code, splitRec.Body.String())
	}

	getRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID), nil)
	var piece pieceResponse
	decodeData(t, getRec, &piece)
	names := piece.Composer.names()
	if len(names) != 2 || names[0] != "Replacement One" || names[1] != "Replacement Two" {
		t.Errorf("composer names after split = %v, want [Replacement One, Replacement Two]", names)
	}

	var originalAfter personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, apiPeopleURL(originalID), nil), &originalAfter)
	if originalAfter.Name != "Original Person" {
		t.Errorf("original person's own row = %+v, want it to still exist", originalAfter)
	}
	if originalAfter.PieceCount != 0 {
		t.Errorf("original person's pieceCount after split = %d, want 0", originalAfter.PieceCount)
	}
}

func TestSplitPerson_RequiresAtLeastOneReplacement(t *testing.T) {
	h := newTestServer(t)
	p := createPerson(t, h, "Nobody Yet")

	rec := doJSON(t, h, http.MethodPost, apiPeopleURL(p.ID)+"/split", map[string]any{
		"replacementNames": []string{},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("split with no replacements: status %d, want 400; body %s", rec.Code, rec.Body.String())
	}
}

func TestDeletePerson_RemovesRowAndResyncsCreditedPieces(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, uploadRec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":     "Deletion Target",
		"composers": []string{"Doomed Person"},
	}), nil)
	assertSearchCount(t, h, "Doomed", 1)

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people", nil), &people)
	personID := people[0].ID

	delRec := doJSON(t, h, http.MethodDelete, apiPeopleURL(personID), nil)
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete person: status %d, body %s", delRec.Code, delRec.Body.String())
	}

	if rec := doJSON(t, h, http.MethodGet, apiPeopleURL(personID), nil); rec.Code != http.StatusNotFound {
		t.Errorf("person after delete: status %d, want 404", rec.Code)
	}
	assertSearchCount(t, h, "Doomed", 0)
}

func TestListPeople_SortsByPieceCountAndFiltersByQuery(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()

	// Distinct page counts per upload — writeFixturePDF produces identical
	// content for the same page count regardless of filename, and
	// handleCreatePiece dedupes a single-piece upload on SHA-256 hash
	// match (CLAUDE.md > File handling), so same-page-count uploads would
	// silently collapse into one Piece row instead of three.
	makePieceWithComposer := func(filename string, pageCount int, composer string) {
		path := dir + "/" + filename
		writeFixturePDF(t, path, pageCount)
		uploadRec := recordRequest(h, multipartUpload(t, "/api/pieces", filename, readAll(t, path)))
		var uploaded pieceResponse
		decodeData(t, uploadRec, &uploaded)
		decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
			"title":     "Piece for " + composer,
			"composers": []string{composer},
		}), nil)
	}
	makePieceWithComposer("a.pdf", 1, "Prolific Composer")
	makePieceWithComposer("b.pdf", 2, "Prolific Composer")
	makePieceWithComposer("c.pdf", 3, "One Hit Wonder")

	var byPieceCount []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people?sort=pieceCount&dir=desc", nil), &byPieceCount)
	if len(byPieceCount) != 2 || byPieceCount[0].Name != "Prolific Composer" || byPieceCount[0].PieceCount != 2 {
		t.Errorf("sort=pieceCount&dir=desc = %+v, want Prolific Composer (2 pieces) first", byPieceCount)
	}

	var filtered []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people?query=Hit", nil), &filtered)
	if len(filtered) != 1 || filtered[0].Name != "One Hit Wonder" {
		t.Errorf("query=Hit returned %+v, want just One Hit Wonder", filtered)
	}
}

// TestListPeople_AmpersandMatchesAnd covers repo.NormalizeAmpersandForLike
// — a Person credited as a duo with a bare "&" in their own name ("Rodgers
// & Hammerstein") must be findable by a query typed with "and", in the
// People Library's plain-LIKE search (no FTS5 here, same as Books).
func TestListPeople_AmpersandMatchesAnd(t *testing.T) {
	h := newTestServer(t)
	duo := createPerson(t, h, "Rodgers & Hammerstein")
	createPerson(t, h, "Unrelated Composer")

	var filtered []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people?query=Rodgers+and+Hammerstein", nil), &filtered)
	if len(filtered) != 1 || filtered[0].ID != duo.ID {
		t.Errorf(`query="Rodgers and Hammerstein" returned %+v, want just the "Rodgers & Hammerstein" person`, filtered)
	}
}

// TestListPeople_SortByNameIgnoresLeadingQuotationMark covers a real
// request: a person entered with a nickname in quotes — "Jelly Roll"
// Morton, Ferdinand LaMothe's real stage name — must still sort under
// "J", not collate as if the quote character itself were the first
// letter of the name. Covers both a straight double quote and a curly
// opening double quote (quoteStrippedSQL, people.go), since real data can
// carry either depending on how it was typed.
func TestListPeople_SortByNameIgnoresLeadingQuotationMark(t *testing.T) {
	h := newTestServer(t)
	for _, name := range []string{
		`"Jelly Roll" Morton`,
		"“Fats” Waller",
		"Albert King",
		"Zoot Sims",
	} {
		decodeData(t, doJSON(t, h, http.MethodPost, "/api/people", map[string]any{"name": name}), nil)
	}

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people?sort=name&dir=asc", nil), &people)
	var got []string
	for _, p := range people {
		got = append(got, p.Name)
	}
	want := []string{"Albert King", "“Fats” Waller", `"Jelly Roll" Morton`, "Zoot Sims"}
	if len(got) != len(want) {
		t.Fatalf("got %d people, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("sort=name&dir=asc = %v, want %v (quoted names sort by their first real letter)", got, want)
			break
		}
	}
}

func TestSearchPieces_FiltersByPersonIdIncludingBookInheritance(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology",
		"composers": []string{"Shared Person"},
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Inherits From Book"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people", nil), &people)
	if len(people) != 1 {
		t.Fatalf("expected exactly 1 person, got %d", len(people))
	}
	personID := people[0].ID

	var byPerson []pieceResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces?personId="+itoa(personID), nil), &byPerson)
	if len(byPerson) != 1 || byPerson[0].ID != result.Pieces[0].ID {
		t.Errorf("personId filter returned %+v, want exactly the inheriting piece", byPerson)
	}
}

// TestSearchPieces_PersonIdFilterIsNotPaginated is the real reported bug,
// 2026-09-01 ("why is Person Details capped at 50 pieces?") — personId
// used to fall through to the same default limit=50 every other piece
// search gets, even though Person Details itself renders the whole works
// list at once with no "load more"/infinite-scroll affordance the way the
// Piece Library has, so a person credited on more than 50 pieces silently
// lost the rest. Mirrors sourceBookId's own established "naturally
// bounded, no pagination" treatment.
func TestSearchPieces_PersonIdFilterIsNotPaginated(t *testing.T) {
	h := newTestServer(t)
	const pieceCount = 55 // comfortably past the default limit=50
	for i := 0; i < pieceCount; i++ {
		createTestPiece(t, h, map[string]any{"composers": []string{"Prolific Composer"}})
	}

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people?query=Prolific", nil), &people)
	if len(people) != 1 {
		t.Fatalf("expected exactly 1 person, got %d", len(people))
	}
	personID := people[0].ID
	if people[0].PieceCount != pieceCount {
		t.Errorf("PersonResponse.pieceCount = %d, want %d", people[0].PieceCount, pieceCount)
	}

	var byPerson []pieceResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces?personId="+itoa(personID), nil), &byPerson)
	if len(byPerson) != pieceCount {
		t.Errorf("personId filter returned %d pieces, want all %d (not capped at the default limit=50)", len(byPerson), pieceCount)
	}
}

// TestPersonResponse_PieceCountIsEffectiveIncludingBookInheritance covers a
// real reported gap: PersonResponse.pieceCount (the People Library card/
// list count, its default >2-piece "Show only" filter, and Person Details'
// own "Saving will update N works" footer) used to only count pieces
// crediting the person directly, undercounting anyone credited only
// through a book — the same case
// TestSearchPieces_FiltersByPersonIdIncludingBookInheritance already
// confirms the personId piece filter itself gets right; pieceCount needs
// to agree with it.
func TestPersonResponse_PieceCountIsEffectiveIncludingBookInheritance(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology",
		"composers": []string{"Shared Person"},
	}), nil)
	doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "Inherits From Book"}},
	})

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people", nil), &people)
	if len(people) != 1 {
		t.Fatalf("expected exactly 1 person, got %d", len(people))
	}
	personID := people[0].ID
	if people[0].PieceCount != 1 {
		t.Errorf("pieceCount = %d, want 1 (the book-inheriting piece)", people[0].PieceCount)
	}

	// Refetching the single person directly must agree with the list
	// response above — both go through BuildPersonResponse the same way,
	// but worth confirming neither path diverges.
	var refetched personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, apiPeopleURL(personID), nil), &refetched)
	if refetched.PieceCount != 1 {
		t.Errorf("GET /api/people/{id} pieceCount = %d, want 1", refetched.PieceCount)
	}

	// Sorting by pieceCount must agree with the count it's sorting by —
	// this person has to actually place ahead of a genuinely 0-piece one
	// in a desc sort, not just report the right number when fetched alone.
	createPerson(t, h, "Never Credited")
	var byPieceCount []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people?sort=pieceCount&dir=desc", nil), &byPieceCount)
	if len(byPieceCount) == 0 || byPieceCount[0].ID != personID {
		t.Errorf("sort=pieceCount&dir=desc first result = %+v, want the book-inheriting person (id %d) first", byPieceCount, personID)
	}
}

func TestListBooks_FiltersByPersonId(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 2)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Credited Book",
		"composers": []string{"Book Person"},
	}), nil)

	var people []personResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/people", nil), &people)
	personID := people[0].ID

	var byPerson []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?personId="+itoa(personID), nil), &byPerson)
	if len(byPerson) != 1 || byPerson[0].ID != bookID {
		t.Errorf("personId filter returned %+v, want exactly [%d]", byPerson, bookID)
	}
}

// TestUploadPersonPortrait_RoundTrips mirrors
// TestUploadBookCover_OverridesDerivedThumbnail's core contract, minus the
// derived-thumbnail fallback (a Person has none — no file means a clean
// 404, handled entirely client-side via the initials/bust placeholder).
func TestUploadPersonPortrait_RoundTrips(t *testing.T) {
	h := newTestServer(t)
	p := createPerson(t, h, "Portrait Test")

	noPortraitRec := recordRequest(h, httptestGet(t, apiPeopleURL(p.ID)+"/portrait"))
	if noPortraitRec.Code != http.StatusNotFound {
		t.Fatalf("GET portrait before upload: status %d, want 404", noPortraitRec.Code)
	}

	dir := t.TempDir()
	portraitPath := dir + "/portrait.png"
	writeFixturePNG(t, portraitPath, [3]byte{10, 20, 30})
	uploadRec := recordRequest(h, multipartUpload(t, apiPeopleURL(p.ID)+"/portrait", "portrait.png", readAll(t, portraitPath)))
	if uploadRec.Code != http.StatusOK {
		t.Fatalf("upload portrait: status %d, body %s", uploadRec.Code, uploadRec.Body.String())
	}
	var after personResponse
	decodeData(t, uploadRec, &after)
	if !after.HasCustomPortrait {
		t.Errorf("hasCustomPortrait = false after upload, want true")
	}

	getRec := recordRequest(h, httptestGet(t, apiPeopleURL(p.ID)+"/portrait"))
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET portrait after upload: status %d", getRec.Code)
	}
	if !bytes.Equal(getRec.Body.Bytes(), readAll(t, portraitPath)) {
		t.Error("portrait after upload doesn't match the uploaded image's own bytes")
	}

	deleteRec := doJSON(t, h, http.MethodDelete, apiPeopleURL(p.ID)+"/portrait", nil)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete portrait: status %d, body %s", deleteRec.Code, deleteRec.Body.String())
	}
	var afterDelete personResponse
	decodeData(t, deleteRec, &afterDelete)
	if afterDelete.HasCustomPortrait {
		t.Error("hasCustomPortrait = true after deleting the portrait")
	}
	if rec := recordRequest(h, httptestGet(t, apiPeopleURL(p.ID)+"/portrait")); rec.Code != http.StatusNotFound {
		t.Errorf("GET portrait after delete: status %d, want 404", rec.Code)
	}
}
