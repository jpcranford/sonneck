package handlers_test

import (
	"fmt"
	"net/http"
	"testing"
)

// TestBookUserTags covers your tags on a book (migration 00044): saved by
// Edit Book and kept when a request leaves them out, carried read-only by
// the book's pieces in addition to their own, counted by the pieces' tag
// filter and facet, filterable on the Books library, merged with the tag,
// and private to their owner.
func TestBookUserTags(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	bookURL := apiBooksURL(bookID)
	base := map[string]any{"bookTitle": "Carols", "composers": []string{"Various"}}
	withTags := func(tags ...string) map[string]any {
		m := map[string]any{}
		for k, v := range base {
			m[k] = v
		}
		m["userTags"] = tags
		return m
	}

	type tag struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	var book struct {
		UserTags []tag `json:"userTags"`
	}
	rec := doJSON(t, h, http.MethodPatch, bookURL, withTags("Christmas"))
	if rec.Code != http.StatusOK {
		t.Fatalf("set tags: status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, rec, &book)
	if len(book.UserTags) != 1 || book.UserTags[0].Name != "Christmas" {
		t.Fatalf("book tags = %+v, want Christmas", book.UserTags)
	}
	christmas := book.UserTags[0].ID

	// A request without userTags leaves them alone.
	decodeData(t, doJSON(t, h, http.MethodPatch, bookURL, base), &book)
	if len(book.UserTags) != 1 {
		t.Errorf("after a save without userTags: %+v, want Christmas kept", book.UserTags)
	}

	decodeData(t, doJSON(t, h, http.MethodPost, bookURL+"/confirm-import", map[string]any{
		"ranges": []map[string]any{{"start": 1, "end": 4}},
		"pieces": []map[string]any{{"title": "In Book", "composers": []string{"Various"}}},
	}), new(any))
	var inBook struct {
		ID           int64 `json:"id"`
		UserTags     []tag `json:"userTags"`
		BookUserTags []tag `json:"bookUserTags"`
	}
	var list []pieceResponse
	decodeData(t, doJSON(t, h, http.MethodGet, fmt.Sprintf("/api/pieces?sourceBookId=%d", bookID), nil), &list)
	if len(list) != 1 {
		t.Fatalf("pieces in book = %d, want 1", len(list))
	}
	inBookID := list[0].ID
	// Its own tag "Christmas" too: shown once, as its own.
	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(inBookID), map[string]any{
		"title": "In Book", "composers": []string{"Various"}, "userTags": []string{"Recital"},
		"sourceBookId": bookID, // a piece save replaces every field, its book included
	}), &inBook)
	if len(inBook.UserTags) != 1 || inBook.UserTags[0].Name != "Recital" ||
		len(inBook.BookUserTags) != 1 || inBook.BookUserTags[0].ID != christmas {
		t.Errorf("piece in book: own %+v, from book %+v; want Recital and Christmas", inBook.UserTags, inBook.BookUserTags)
	}
	loose := createTestPiece(t, h, map[string]any{"title": "Loose", "userTags": []string{"Christmas"}})
	plain := createTestPiece(t, h, map[string]any{"title": "Plain"})

	ids := func(query string) map[int64]bool {
		var results []pieceResponse
		decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces?"+query, nil), &results)
		got := map[int64]bool{}
		for _, r := range results {
			got[r.ID] = true
		}
		return got
	}
	if got := ids(fmt.Sprintf("userTagId=%d", christmas)); len(got) != 2 || !got[inBookID] || !got[loose.ID] {
		t.Errorf("userTagId=Christmas: %v, want the book's piece and Loose", got)
	}
	if got := ids(fmt.Sprintf("excludeUserTagId=%d", christmas)); got[inBookID] || got[loose.ID] || !got[plain.ID] {
		t.Errorf("excludeUserTagId=Christmas: %v, want Plain but neither Christmas piece", got)
	}

	var pieceFacets struct {
		UserTags []struct {
			ID    int64 `json:"id"`
			Count int   `json:"count"`
		} `json:"userTags"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/facets", nil), &pieceFacets)
	for _, f := range pieceFacets.UserTags {
		if f.ID == christmas && f.Count != 2 {
			t.Errorf("pieces facet Christmas = %d, want 2", f.Count)
		}
	}

	// The Books library's tag filter and facet.
	other, _ := uploadBook(t, h, "other.pdf", 2)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(other), map[string]any{
		"bookTitle": "Other", "composers": []string{"Someone"},
	}), new(any))
	var books []bookResponse
	decodeData(t, doJSON(t, h, http.MethodGet, fmt.Sprintf("/api/books?userTagId=%d", christmas), nil), &books)
	if len(books) != 1 || books[0].ID != bookID {
		t.Errorf("books userTagId=Christmas: %+v, want just Carols", books)
	}
	decodeData(t, doJSON(t, h, http.MethodGet, fmt.Sprintf("/api/books?excludeUserTagId=%d", christmas), nil), &books)
	if len(books) != 1 || books[0].ID != other {
		t.Errorf("books excludeUserTagId=Christmas: %+v, want just Other", books)
	}
	var bookFacets struct {
		UserTags []struct {
			ID    int64 `json:"id"`
			Count int   `json:"count"`
		} `json:"userTags"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/books/facets", nil), &bookFacets)
	if len(bookFacets.UserTags) != 1 || bookFacets.UserTags[0].ID != christmas || bookFacets.UserTags[0].Count != 1 {
		t.Errorf("books facet: %+v, want Christmas 1", bookFacets.UserTags)
	}

	// Another account's private tag on the book stays theirs: unseen, and
	// untouched by your own save.
	if _, err := conn.Exec(`INSERT INTO users (id, display_name) VALUES (2, 'Other')`); err != nil {
		t.Fatal(err)
	}
	res, err := conn.Exec(`INSERT INTO user_tags (owner_user_id, name) VALUES (2, 'Secret')`)
	if err != nil {
		t.Fatal(err)
	}
	secret, _ := res.LastInsertId()
	if _, err := conn.Exec(`INSERT INTO book_user_tags (book_id, tag_id) VALUES (?, ?)`, bookID, secret); err != nil {
		t.Fatal(err)
	}
	decodeData(t, doJSON(t, h, http.MethodPatch, bookURL, withTags("Christmas", "Advent")), &book)
	if len(book.UserTags) != 2 {
		t.Errorf("your book tags = %+v, want Advent and Christmas only", book.UserTags)
	}
	decodeData(t, doJSON(t, h, http.MethodGet, apiPiecesURL(inBookID), nil), &inBook)
	for _, tg := range inBook.BookUserTags {
		if tg.ID == secret {
			t.Error("another account's book tag reached the piece")
		}
	}
	var n int
	if err := conn.QueryRow(`SELECT count(*) FROM book_user_tags WHERE tag_id = ?`, secret).Scan(&n); err != nil || n != 1 {
		t.Errorf("the other account's tag on the book: %d rows (%v), want 1", n, err)
	}

	// Deleting Advent into Christmas merges the book's tags too.
	var advent int64
	for _, tg := range book.UserTags {
		if tg.Name == "Advent" {
			advent = tg.ID
		}
	}
	if rec := doJSON(t, h, http.MethodDelete, fmt.Sprintf("/api/tags/%d", advent), map[string]any{"mergeIntoId": christmas}); rec.Code >= 300 {
		t.Fatalf("merge: status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, doJSON(t, h, http.MethodGet, bookURL, nil), &book)
	if len(book.UserTags) != 1 || book.UserTags[0].ID != christmas {
		t.Errorf("after merging Advent into Christmas: %+v, want Christmas only", book.UserTags)
	}
}
