package handlers

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/repo"
)

// pieceSortColumns: sort=composer relies on the LEFT JOIN books b added
// conditionally in handleSearchPieces below (only when this field is
// requested) and mirrors repo.ResolveEffective's resolveStringField
// fallback (internal/repo/effective.go) exactly — a piece's own composer
// if non-blank, else its book's, else neither. TRIM/NULLIF treat
// whitespace-only the same as empty, matching resolveStringField's own
// isBlank check (strings.TrimSpace(s) == ""). The IS NULL clause (always
// ASC — see sortColumnFunc's own doc comment) makes a composer-less piece
// trail regardless of direction, rather than jumping to the front of an
// ascending list the way SQLite's default NULL-sorts-first-on-ASC would
// otherwise place it.
var pieceSortColumns = map[string]sortColumnFunc{
	"dateAdded": simpleSortColumn("p.id"),
	"title":     simpleSortColumn("p.title COLLATE NOCASE"),
	"composer": func(dir string) string {
		const expr = "COALESCE(NULLIF(TRIM(p.composer), ''), NULLIF(TRIM(b.composer), ''))"
		return "(" + expr + " IS NULL) ASC, " + expr + " COLLATE NOCASE " + dir
	},
}

// handleSearchPieces is design doc §11's library browse/search: search-as-
// you-type text query against pieces_fts, combinable with tag/favorite/
// practiceStatus filters.
//
// Every filter here — including sheetTypeId and instrumentId, both
// book-inheritable — respects effective values (CLAUDE.md > Book-level
// soft inheritance calls this non-negotiable: a piece that only inherits
// its sheetType/instruments from its book must still be findable by them,
// the same way it's already findable by an inherited composer via the free-
// text query against pieces_fts).
func (s *Server) handleSearchPieces(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	var where []string
	var args []any

	sqlStr := `SELECT p.id FROM pieces p`

	if query := strings.TrimSpace(q.Get("query")); query != "" {
		sqlStr += ` JOIN pieces_fts ON pieces_fts.piece_id = p.id`
		where = append(where, `pieces_fts MATCH ?`)
		args = append(args, sanitizeFTSQuery(query))
	}

	// keyId: comma-separated for an OR match against several keys at once
	// (the Filter Drawer's Key section is a real multi-select checkbox
	// list, same "any of several" shape as practiceStatus below — a piece
	// can also have more than one key itself, migration 00008, but that's
	// unrelated: this is "matches any of the requested keys", not "has all
	// of its own"). Same join-table pattern as instrumentId/userTagId.
	if ids, present, ok := parseIDListFilter(w, q, "keyId"); !ok {
		return
	} else if present {
		where = append(where, "p.id IN (SELECT piece_id FROM piece_keys WHERE key_id IN ("+sqlPlaceholders(len(ids))+"))")
		args = append(args, idsToArgs(ids)...)
	}

	// sheetTypeId: comma-separated, same OR-match shape as keyId above.
	// Match if the piece's own sheetType is one of the requested values,
	// OR the piece has no sheetType of its own and its book's is — the
	// same fallback rule repo.ResolveEffective applies for display. The
	// id list is bound twice (once per IN clause), so args needs it twice.
	if ids, present, ok := parseIDListFilter(w, q, "sheetTypeId"); !ok {
		return
	} else if present {
		ph := sqlPlaceholders(len(ids))
		where = append(where, `(p.sheet_type_id IN (`+ph+`) OR (p.sheet_type_id IS NULL AND p.source_book_id IN (
			SELECT id FROM books WHERE sheet_type_id IN (`+ph+`)
		)))`)
		args = append(args, idsToArgs(ids)...)
		args = append(args, idsToArgs(ids)...)
	}

	// instrumentId: comma-separated, same OR-match shape. Match if the
	// piece has any of the requested instruments itself, OR the piece has
	// none of its own instruments and its book has one of them — mirroring
	// EffectiveTagsField's whole-set fallback (a piece with any instruments
	// of its own never partially falls back to the book's).
	if ids, present, ok := parseIDListFilter(w, q, "instrumentId"); !ok {
		return
	} else if present {
		ph := sqlPlaceholders(len(ids))
		where = append(where, `(p.id IN (SELECT piece_id FROM piece_instruments WHERE instrument_id IN (`+ph+`))
			OR (p.id NOT IN (SELECT piece_id FROM piece_instruments)
				AND p.source_book_id IN (SELECT book_id FROM book_instruments WHERE instrument_id IN (`+ph+`))))`)
		args = append(args, idsToArgs(ids)...)
		args = append(args, idsToArgs(ids)...)
	}

	// userTagId: comma-separated, same OR-match shape as keyId/sheetTypeId.
	if ids, present, ok := parseIDListFilter(w, q, "userTagId"); !ok {
		return
	} else if present {
		where = append(where, "p.id IN (SELECT piece_id FROM piece_user_tags WHERE tag_id IN ("+sqlPlaceholders(len(ids))+"))")
		args = append(args, idsToArgs(ids)...)
	}

	if v := q.Get("favorite"); v != "" {
		fav, err := strconv.ParseBool(v)
		if err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid favorite")
			return
		}
		where = append(where, "p.favorite = ?")
		args = append(args, fav)
	}
	// practiceStatus: comma-separated for an OR match against several
	// statuses at once (the sidebar's "Currently Practicing" view — Learning
	// OR Stalled — is the first caller of this; a single value still works
	// the same as before, IN (?) with one placeholder behaves like = ?).
	if v := q.Get("practiceStatus"); v != "" {
		statuses := strings.Split(v, ",")
		placeholders := make([]string, len(statuses))
		for i, status := range statuses {
			placeholders[i] = "?"
			args = append(args, strings.TrimSpace(status))
		}
		where = append(where, "p.practice_status IN ("+strings.Join(placeholders, ",")+")")
	}

	// bookless: pieces with no sourceBookId at all (design doc §3/§5 — a
	// piece with no book is a normal, first-class case, e.g. a single
	// downloaded score). Deliberately asymmetric with favorite above:
	// bookless=false is a no-op, not a hard "exclude bookless" filter — the
	// drawer's single checkbox never sends false, there's no equivalent
	// "book-having pieces only" affordance to wire it to.
	if v := q.Get("bookless"); v != "" {
		bookless, err := strconv.ParseBool(v)
		if err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid bookless")
			return
		}
		if bookless {
			where = append(where, "p.source_book_id IS NULL")
		}
	}

	// sourceBookId: the Book Details page's pieces grid/list — every piece
	// belonging to this book. Sorted by start page ascending instead of the
	// default newest-first order below, with a tie-break the design review
	// asked for: when two pieces share a start page (e.g. a short reprise
	// that opens on the same page the piece before it is still finishing),
	// the 1-page one sorts first. No LIMIT/OFFSET either — a book's own
	// piece count is the natural bound, and the page renders all of them
	// at once rather than paginating. sort/dir (below) never apply here —
	// this is a structural property of the book, not a user preference, so
	// a sort param present alongside sourceBookId is simply not parsed/used.
	bookID, byBook, ok := parseIDFilter(w, q, "sourceBookId")
	if !ok {
		return
	}
	if byBook {
		where = append(where, "p.source_book_id = ?")
		args = append(args, bookID)
	}

	// Composer sort needs the piece's own book to fall back to (matching
	// repo.ResolveEffective's resolveStringField exactly — see
	// pieceSortColumns below), so the JOIN is added here, before WHERE, but
	// only when actually sorting by composer — no reason to pay the join
	// cost otherwise. Must happen before the "byBook" sourceBookId check
	// above already ran (it did) but before WHERE is appended (below).
	var sortOrderBy string
	if !byBook {
		sortField := q.Get("sort")
		if sortField == "" {
			sortField = "dateAdded"
		}
		if sortField == "composer" {
			sqlStr += ` LEFT JOIN books b ON b.id = p.source_book_id`
		}
		sortOrderBy, ok = parseSort(w, q, pieceSortColumns, "dateAdded")
		if !ok {
			return
		}
	}

	if len(where) > 0 {
		sqlStr += " WHERE " + strings.Join(where, " AND ")
	}

	if byBook {
		sqlStr += " ORDER BY p.source_page_start IS NULL, p.source_page_start ASC, (p.page_count = 1) DESC"
	} else {
		limit := 50
		if v := q.Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		offset := 0
		if v := q.Get("offset"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				offset = n
			}
		}
		// , p.id DESC: a deterministic secondary tie-break — without it,
		// rows with equal primary sort values (two identically-titled
		// pieces, two blank composers) have no guaranteed stable order,
		// which can skip or duplicate rows across LIMIT/OFFSET page
		// boundaries as infinite scroll fires further requests.
		sqlStr += " ORDER BY " + sortOrderBy + ", p.id DESC LIMIT ? OFFSET ?"
		args = append(args, limit, offset)
	}

	rows, err := s.DB.QueryContext(r.Context(), sqlStr, args...)
	if err != nil {
		s.writeError(w, err)
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			s.writeError(w, err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.writeError(w, err)
		return
	}
	rows.Close()

	results := make([]*api.PieceResponse, 0, len(ids))
	for _, id := range ids {
		p, err := repo.GetPieceByID(r.Context(), s.DB, id)
		if err != nil {
			s.writeError(w, err)
			return
		}
		resp, err := api.BuildPieceResponse(r.Context(), s.DB, p)
		if err != nil {
			s.writeError(w, err)
			return
		}
		results = append(results, resp)
	}

	api.WriteData(w, http.StatusOK, results)
}

// parseIDFilter reads an optional int64 query param, writing a 400
// response itself on a malformed value. The three-value return
// (id, present, ok) lets callers write `if id, present, ok := ...; !ok {
// return } else if present { ... }` instead of repeating the parse-and-
// error-response block per filter.
func parseIDFilter(w http.ResponseWriter, q url.Values, param string) (id int64, present, ok bool) {
	v := q.Get(param)
	if v == "" {
		return 0, false, true
	}
	id, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid "+param)
		return 0, false, false
	}
	return id, true, true
}

// parseIDListFilter is parseIDFilter's multi-value counterpart, for the
// Filter Drawer's real multi-select facets (Key/Instrument/SheetType/
// UserTag on pieces, SheetType/Instrument on books) — comma-separated,
// same convention as the pre-existing practiceStatus filter. An empty
// segment (a stray comma) is rejected the same as any other malformed
// value, rather than silently skipped.
func parseIDListFilter(w http.ResponseWriter, q url.Values, param string) (ids []int64, present, ok bool) {
	v := q.Get(param)
	if v == "" {
		return nil, false, true
	}
	parts := strings.Split(v, ",")
	ids = make([]int64, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid "+param)
			return nil, false, false
		}
		ids = append(ids, id)
	}
	return ids, true, true
}

// sqlPlaceholders builds "?,?,...,?" for an IN clause of n values.
func sqlPlaceholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// idsToArgs widens []int64 to []any so it can be spread into a QueryContext
// args slice alongside other parameter types.
func idsToArgs(ids []int64) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

// sanitizeFTSQuery turns free user input into a safe FTS5 MATCH query.
// FTS5's default query syntax treats hyphens, colons, and unmatched quotes
// as operators (column filters, NOT, unterminated strings) rather than
// literal text — so an ordinary search like "F-sharp" or a partial title
// containing a quote mark would otherwise throw a SQL error instead of
// returning results. Wrapping each whitespace-separated token as a quoted
// phrase (embedded quotes doubled, FTS5's own escaping rule) neutralizes
// all of that while preserving the expected "every one of these terms,
// any order" search-box behavior.
func sanitizeFTSQuery(query string) string {
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return ""
	}
	quoted := make([]string, len(fields))
	for i, f := range fields {
		quoted[i] = `"` + strings.ReplaceAll(f, `"`, `""`) + `"`
	}
	return strings.Join(quoted, " AND ")
}
