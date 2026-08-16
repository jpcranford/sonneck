package handlers

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/repo"
)

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

	// keyId: a piece can have more than one key (migration 00008) — match
	// if any of its keys is the requested one, same join-table pattern as
	// instrumentId/userTagId below.
	if id, present, ok := parseIDFilter(w, q, "keyId"); !ok {
		return
	} else if present {
		where = append(where, "p.id IN (SELECT piece_id FROM piece_keys WHERE key_id = ?)")
		args = append(args, id)
	}

	// sheetTypeId: match if the piece's own sheetType is that value, OR
	// the piece has no sheetType of its own and its book's does — the
	// same fallback rule repo.ResolveEffective applies for display.
	if id, present, ok := parseIDFilter(w, q, "sheetTypeId"); !ok {
		return
	} else if present {
		where = append(where, `(p.sheet_type_id = ? OR (p.sheet_type_id IS NULL AND p.source_book_id IN (
			SELECT id FROM books WHERE sheet_type_id = ?
		)))`)
		args = append(args, id, id)
	}

	// instrumentId: match if the piece has that instrument itself, OR the
	// piece has none of its own instruments and its book has that one —
	// mirroring EffectiveTagsField's whole-set fallback (a piece with any
	// instruments of its own never partially falls back to the book's).
	if id, present, ok := parseIDFilter(w, q, "instrumentId"); !ok {
		return
	} else if present {
		where = append(where, `(p.id IN (SELECT piece_id FROM piece_instruments WHERE instrument_id = ?)
			OR (p.id NOT IN (SELECT piece_id FROM piece_instruments)
				AND p.source_book_id IN (SELECT book_id FROM book_instruments WHERE instrument_id = ?)))`)
		args = append(args, id, id)
	}

	if id, present, ok := parseIDFilter(w, q, "userTagId"); !ok {
		return
	} else if present {
		where = append(where, "p.id IN (SELECT piece_id FROM piece_user_tags WHERE tag_id = ?)")
		args = append(args, id)
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
	if v := q.Get("practiceStatus"); v != "" {
		where = append(where, "p.practice_status = ?")
		args = append(args, v)
	}

	if len(where) > 0 {
		sqlStr += " WHERE " + strings.Join(where, " AND ")
	}

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
	sqlStr += " ORDER BY p.id DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

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
