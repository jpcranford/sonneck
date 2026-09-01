package handlers

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/fuzzy"
	"github.com/jpcranford/sonneck/internal/repo"
)

// pieceSortColumns: sort=title strips a leading "A"/"An"/"The" via
// titleSortColumn (internal/handlers/sort.go) — the usual library-catalog
// convention, computed in SQL rather than a stored sort-name column. sort=
// composer and sort=yearWritten (both book-inheritable) rely on the LEFT
// JOIN books b added conditionally in handleSearchPieces below (only when
// one of them is actually requested) and mirror repo.ResolveEffective's
// resolveStringField fallback (internal/repo/effective.go) exactly — a
// piece's own value if non-blank, else its book's, else neither. yearWritten's
// own expression uses TRIM/NULLIF to treat whitespace-only the same as
// empty, matching resolveStringField's own isBlank check
// (strings.TrimSpace(s) == ""). The IS NULL clause (always ASC — see
// sortColumnFunc's own doc comment) makes a piece with nothing to sort by
// trail regardless of direction, rather than jumping to the front of an
// ascending list the way SQLite's default NULL-sorts-first-on-ASC would
// otherwise place it.
var pieceSortColumns = map[string]sortColumnFunc{
	"dateAdded": simpleSortColumn("p.id"),
	"title":     titleSortColumn("p.title"),
	// composer sorts by the piece's own effective first-listed composer —
	// composer/arranger overhaul (migration 00020) moved it off a plain
	// column onto an ordered join table. The COALESCE mirrors
	// repo.ResolveEffective's own all-or-nothing fallback exactly: the
	// piece's own first composer (position 0) if it has any composer at
	// all, else the book's — a piece with zero composers of its own has no
	// row in piece_composers at all, so that subquery genuinely returns
	// NULL (not an empty string), which is what makes COALESCE fall
	// through to the book's subquery correctly.
	"composer": func(dir string) string {
		const expr = `COALESCE(
			(SELECT ppl.name FROM piece_composers pc JOIN people ppl ON ppl.id = pc.person_id WHERE pc.piece_id = p.id ORDER BY pc.position LIMIT 1),
			(SELECT ppl.name FROM book_composers bc JOIN people ppl ON ppl.id = bc.person_id WHERE bc.book_id = b.id ORDER BY bc.position LIMIT 1)
		)`
		return "(" + expr + " IS NULL) ASC, " + expr + " COLLATE NOCASE " + dir
	},
	// yearWritten is book-inheritable (design doc §3) and TEXT, not INTEGER
	// (free text, e.g. "ca. 1708-1711") — same two concerns bookSortColumns'
	// own yearWritten already handles individually, combined here. The
	// COALESCE/NULLIF mirrors repo.resolveStringField exactly (piece's own
	// non-blank value wins outright, else the book's, matching composer's
	// own all-or-nothing fallback above), and GLOB '[0-9]*' is the same
	// "does this look like a real leading year" test bookSortColumns uses,
	// applied to whichever value actually won the fallback. Direction-
	// invariant first clause, same "blanks/non-numeric always trail"
	// reasoning as composer above.
	"yearWritten": func(dir string) string {
		const expr = `COALESCE(NULLIF(TRIM(p.year_written), ''), NULLIF(TRIM(b.year_written), ''))`
		return "(" + expr + " IS NULL OR NOT (" + expr + " GLOB '[0-9]*')) ASC, " +
			"CAST(" + expr + " AS INTEGER) " + dir
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
//
// The free-text query itself runs through up to three tiers, each only
// attempted when every tier before it found nothing at all — never merged
// — so the common case's behavior/ranking stays completely unchanged and
// each looser tier's extra noise only ever shows up when the tighter ones
// have nothing to offer:
//  1. pieces_fts, prefix matching (sanitizeFTSQuery).
//  2. pieces_fts_trigram, substring-anywhere matching (migration 00019).
//  3. fuzzydist(), real typo tolerance (internal/fuzzy) — a SQLite scalar
//     function, not another FTS5 table; see runFuzzyQuery below.
//
// This is why the non-free-text filters/sort/pagination below are built
// into `where`/`args` once and reused by every attempt (via runQuery/
// runFuzzyQuery) instead of being recomputed per attempt.
func (s *Server) handleSearchPieces(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := strings.TrimSpace(q.Get("query"))

	clauses, ok := buildPieceFilterClauses(w, q)
	if !ok {
		return
	}
	var where []string
	var args []any
	for _, c := range clauses {
		where = append(where, c.where)
		args = append(args, c.args...)
	}

	// personId: Person Details' own "works" list — every piece crediting
	// this person as composer OR arranger, effective (book-inheritance-
	// aware). Composer and Arranger fall back to the book independently
	// (CLAUDE.md's Book-level inheritance note), so this checks all four
	// combinations separately rather than one shared "own OR book's"
	// clause the way sheetTypeId/instrumentId (a single field) can. Not
	// part of buildPieceFilterClauses (below) — personId isn't a Filter
	// Drawer facet, it's Person Details' own filter, so handlePieceFacets
	// has no reason to know about it.
	personID, byPerson, ok := parseIDFilter(w, q, "personId")
	if !ok {
		return
	}
	if byPerson {
		where = append(where, `(
			p.id IN (SELECT piece_id FROM piece_composers WHERE person_id = ?)
			OR (p.id NOT IN (SELECT piece_id FROM piece_composers)
				AND p.source_book_id IN (SELECT book_id FROM book_composers WHERE person_id = ?))
			OR p.id IN (SELECT piece_id FROM piece_arrangers WHERE person_id = ?)
			OR (p.id NOT IN (SELECT piece_id FROM piece_arrangers)
				AND p.source_book_id IN (SELECT book_id FROM book_arrangers WHERE person_id = ?))
		)`)
		args = append(args, personID, personID, personID, personID)
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
	// pieceSortColumns below), so the JOIN is added inside runQuery below,
	// but only when actually sorting by composer — no reason to pay the
	// join cost otherwise.
	var sortOrderBy string
	needsBookJoin := false
	if !byBook {
		sortField := q.Get("sort")
		if sortField == "" {
			sortField = "dateAdded"
		}
		needsBookJoin = sortField == "composer" || sortField == "yearWritten"
		sortOrderBy, ok = parseSort(w, q, pieceSortColumns, "dateAdded")
		if !ok {
			return
		}
	}

	// Neither sourceBookId nor personId paginate — both are naturally
	// bounded (a book's own piece count; a person's own credit count) and
	// the frontend renders either as a single full list with no "load
	// more"/infinite-scroll affordance, so a silent LIMIT 50 would just
	// drop real results off the end with no way for the user to reach
	// them. personId added 2026-09-01, direct report ("why is Person
	// Details capped at 50 pieces?") — the exact same class of bug the
	// Piece Library itself had before infinite scroll was added there
	// (2026-08-23), just never fixed for this page since it was built
	// without ever hitting a person credited on more than 50 pieces during
	// development.
	limit := 50
	offset := 0
	if !byBook && !byPerson {
		if v := q.Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		if v := q.Get("offset"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				offset = n
			}
		}
	}

	// runQuery executes the piece-id SELECT against one FTS table variant
	// (see this function's own doc comment for why there are two). Every
	// clause except the free-text one is identical between the primary and
	// fallback attempts, so those live in the already-built where/args
	// above and get prepended to here, not recomputed per attempt.
	runQuery := func(ftsTable string, sanitize func(string) string) ([]int64, error) {
		sqlStr := `SELECT p.id FROM pieces p`
		var qWhere []string
		var qArgs []any
		if query != "" {
			sqlStr += ` JOIN ` + ftsTable + ` ON ` + ftsTable + `.piece_id = p.id`
			qWhere = append(qWhere, ftsTable+` MATCH ?`)
			qArgs = append(qArgs, sanitize(query))
		}
		if needsBookJoin {
			sqlStr += ` LEFT JOIN books b ON b.id = p.source_book_id`
		}
		qWhere = append(qWhere, where...)
		qArgs = append(qArgs, args...)
		if len(qWhere) > 0 {
			sqlStr += " WHERE " + strings.Join(qWhere, " AND ")
		}

		if byBook {
			sqlStr += " ORDER BY p.source_page_start IS NULL, p.source_page_start ASC, (p.page_count = 1) DESC"
		} else if byPerson {
			// Same sortOrderBy the paginated case below uses, just with no
			// LIMIT/OFFSET — see this function's own comment on why personId
			// doesn't paginate.
			sqlStr += " ORDER BY " + sortOrderBy + ", p.id DESC"
		} else {
			// , p.id DESC: a deterministic secondary tie-break — without it,
			// rows with equal primary sort values (two identically-titled
			// pieces, two blank composers) have no guaranteed stable order,
			// which can skip or duplicate rows across LIMIT/OFFSET page
			// boundaries as infinite scroll fires further requests.
			sqlStr += " ORDER BY " + sortOrderBy + ", p.id DESC LIMIT ? OFFSET ?"
			qArgs = append(qArgs, limit, offset)
		}

		rows, err := s.DB.QueryContext(r.Context(), sqlStr, qArgs...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var ids []int64
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return nil, err
			}
			ids = append(ids, id)
		}
		return ids, rows.Err()
	}

	// runFuzzyQuery is the third and last tier — real typo tolerance
	// (internal/fuzzy, CLAUDE.md > Search), not just substring matching.
	// Its shape genuinely differs from runQuery above (no MATCH, no second
	// FTS table — fuzzydist() is a plain WHERE predicate against
	// pieces_fts's own already-denormalized title/composer/arranger
	// columns, real SQLite scalar function registered in internal/db),
	// so it's its own closure rather than a third case forced into
	// runQuery's shape. Still shares where/args/needsBookJoin/byBook/
	// sortOrderBy/limit/offset from the outer scope exactly like runQuery
	// does — every filter/sort/pagination behaves identically across all
	// three tiers. Sort order is still the user's chosen sort field, same
	// as the trigram tier — this tier doesn't rank by fuzzy distance, for
	// the same "don't add a fourth kind of ordering behavior" consistency
	// reasoning that already applies to the trigram tier not ranking by
	// bm25.
	runFuzzyQuery := func() ([]int64, error) {
		maxDist := fuzzy.MaxDistance(query)
		sqlStr := `SELECT p.id FROM pieces p JOIN pieces_fts ON pieces_fts.piece_id = p.id`
		if needsBookJoin {
			sqlStr += ` LEFT JOIN books b ON b.id = p.source_book_id`
		}
		qWhere := []string{`(fuzzydist(pieces_fts.title, ?) <= ? OR fuzzydist(pieces_fts.composer, ?) <= ? OR fuzzydist(pieces_fts.arranger, ?) <= ?)`}
		qArgs := []any{query, maxDist, query, maxDist, query, maxDist}
		qWhere = append(qWhere, where...)
		qArgs = append(qArgs, args...)
		sqlStr += " WHERE " + strings.Join(qWhere, " AND ")

		if byBook {
			sqlStr += " ORDER BY p.source_page_start IS NULL, p.source_page_start ASC, (p.page_count = 1) DESC"
		} else if byPerson {
			sqlStr += " ORDER BY " + sortOrderBy + ", p.id DESC"
		} else {
			sqlStr += " ORDER BY " + sortOrderBy + ", p.id DESC LIMIT ? OFFSET ?"
			qArgs = append(qArgs, limit, offset)
		}

		rows, err := s.DB.QueryContext(r.Context(), sqlStr, qArgs...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var ids []int64
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return nil, err
			}
			ids = append(ids, id)
		}
		return ids, rows.Err()
	}

	ids, err := runQuery("pieces_fts", sanitizeFTSQuery)
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Trigram fallback: only when the primary (prefix) query text
	// genuinely found nothing — see this function's own doc comment for
	// why this isn't merged with the primary result instead.
	if len(ids) == 0 && query != "" {
		ids, err = runQuery("pieces_fts_trigram", sanitizeTrigramFTSQuery)
		if err != nil {
			s.writeError(w, err)
			return
		}
	}

	// Fuzzy fallback: only when *both* prior tiers found nothing — same
	// "don't change common-case behavior" reasoning as the trigram
	// fallback above, one step further out.
	if len(ids) == 0 && query != "" {
		ids, err = runFuzzyQuery()
		if err != nil {
			s.writeError(w, err)
			return
		}
	}

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

// namedClause is one Filter Drawer facet's own WHERE fragment + its bound
// args, tagged with the query-param name it came from. buildPieceFilterClauses
// (below) returns these instead of the flat where []string/args []any pair
// handleSearchPieces builds directly for personId/sourceBookId, specifically
// so handlePieceFacets can compose "every active filter except this one
// dimension's own" per facet — see combineClauses.
type namedClause struct {
	name  string
	where string
	args  []any
}

// buildPieceFilterClauses parses the Piece Filter Drawer's own filter query
// params — keyId/sheetTypeId/instrumentId/userTagId/favorite/
// practiceStatus/bookless/hasImslpNumber — into one namedClause per active
// filter. Shared by handleSearchPieces (which flattens every clause into one
// WHERE exactly as it did before this existed) and handlePieceFacets (which
// needs "every active filter except this dimension's own" per facet — the
// standard multi-select faceted-search rule: a facet value's own displayed
// count reflects what checking it would add on top of every OTHER active
// filter/search, not a count that self-narrows against its own current
// selection). Deliberately excludes personId/sourceBookId — neither is a
// Filter Drawer facet (personId is Person Details' own works-list filter,
// sourceBookId is Book Details' pieces list), so handleSearchPieces still
// parses those two separately, unchanged.
func buildPieceFilterClauses(w http.ResponseWriter, q url.Values) (clauses []namedClause, ok bool) {
	if ids, present, ok := parseIDListFilter(w, q, "keyId"); !ok {
		return nil, false
	} else if present {
		clauses = append(clauses, namedClause{
			name:  "keyId",
			where: "p.id IN (SELECT piece_id FROM piece_keys WHERE key_id IN (" + sqlPlaceholders(len(ids)) + "))",
			args:  idsToArgs(ids),
		})
	}

	if ids, present, ok := parseIDListFilter(w, q, "sheetTypeId"); !ok {
		return nil, false
	} else if present {
		ph := sqlPlaceholders(len(ids))
		var args []any
		args = append(args, idsToArgs(ids)...)
		args = append(args, idsToArgs(ids)...)
		clauses = append(clauses, namedClause{
			name: "sheetTypeId",
			where: `(p.sheet_type_id IN (` + ph + `) OR (p.sheet_type_id IS NULL AND p.source_book_id IN (
				SELECT id FROM books WHERE sheet_type_id IN (` + ph + `)
			)))`,
			args: args,
		})
	}

	if ids, present, ok := parseIDListFilter(w, q, "instrumentId"); !ok {
		return nil, false
	} else if present {
		ph := sqlPlaceholders(len(ids))
		var args []any
		args = append(args, idsToArgs(ids)...)
		args = append(args, idsToArgs(ids)...)
		clauses = append(clauses, namedClause{
			name: "instrumentId",
			where: `(p.id IN (SELECT piece_id FROM piece_instruments WHERE instrument_id IN (` + ph + `))
				OR (p.id NOT IN (SELECT piece_id FROM piece_instruments)
					AND p.source_book_id IN (SELECT book_id FROM book_instruments WHERE instrument_id IN (` + ph + `))))`,
			args: args,
		})
	}

	if ids, present, ok := parseIDListFilter(w, q, "userTagId"); !ok {
		return nil, false
	} else if present {
		clauses = append(clauses, namedClause{
			name:  "userTagId",
			where: "p.id IN (SELECT piece_id FROM piece_user_tags WHERE tag_id IN (" + sqlPlaceholders(len(ids)) + "))",
			args:  idsToArgs(ids),
		})
	}

	if v := q.Get("favorite"); v != "" {
		fav, err := strconv.ParseBool(v)
		if err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid favorite")
			return nil, false
		}
		clauses = append(clauses, namedClause{name: "favorite", where: "p.favorite = ?", args: []any{fav}})
	}

	// practiceStatus: comma-separated for an OR match against several
	// statuses at once (the sidebar's "Currently Practicing" view — Learning
	// OR Stalled — is the first caller of this; a single value still works
	// the same as before, IN (?) with one placeholder behaves like = ?).
	if v := q.Get("practiceStatus"); v != "" {
		statuses := strings.Split(v, ",")
		placeholders := make([]string, len(statuses))
		args := make([]any, len(statuses))
		for i, status := range statuses {
			placeholders[i] = "?"
			args[i] = strings.TrimSpace(status)
		}
		clauses = append(clauses, namedClause{
			name:  "practiceStatus",
			where: "p.practice_status IN (" + strings.Join(placeholders, ",") + ")",
			args:  args,
		})
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
			return nil, false
		}
		if bookless {
			clauses = append(clauses, namedClause{name: "bookless", where: "p.source_book_id IS NULL"})
		}
	}

	// hasImslpNumber: pieces with a non-blank *effective* IMSLP number —
	// own value if set, else the book's (same inheritance-aware "own OR
	// book's" shape sheetTypeId/instrumentId use above, but testing
	// presence/non-blankness rather than a specific id match; NULLIF(TRIM(
	// ...), '') IS NOT NULL is this file's own established non-blank test,
	// matching the composer sort expression above and resolveStringField's
	// isBlank check). Same asymmetric-boolean shape as bookless:
	// hasImslpNumber=false is a no-op, not a hard exclude — the drawer's
	// single checkbox never sends false.
	if v := q.Get("hasImslpNumber"); v != "" {
		has, err := strconv.ParseBool(v)
		if err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid hasImslpNumber")
			return nil, false
		}
		if has {
			clauses = append(clauses, namedClause{
				name: "hasImslpNumber",
				where: `(NULLIF(TRIM(p.imslp_number), '') IS NOT NULL OR (NULLIF(TRIM(p.imslp_number), '') IS NULL AND p.source_book_id IN (
					SELECT id FROM books WHERE NULLIF(TRIM(imslp_number), '') IS NOT NULL
				)))`,
			})
		}
	}

	return clauses, true
}

// combineClauses ANDs together every namedClause except the one matching
// `exclude` (pass "" to include everything) — handlePieceFacets's own
// per-dimension "every other active filter" composition.
func combineClauses(clauses []namedClause, exclude string) (where string, args []any) {
	var parts []string
	for _, c := range clauses {
		if c.name == exclude {
			continue
		}
		parts = append(parts, c.where)
		args = append(args, c.args...)
	}
	return strings.Join(parts, " AND "), args
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

// quoteFTSToken wraps a single whitespace-separated token as a safe,
// literal FTS5 phrase — FTS5's default query syntax treats hyphens,
// colons, and unmatched quotes as operators (column filters, NOT,
// unterminated strings) rather than literal text, so an ordinary search
// like "F-sharp" or a partial title containing a quote mark would
// otherwise throw a SQL error instead of returning results. Embedded
// quotes are doubled, FTS5's own escaping rule.
func quoteFTSToken(f string) string {
	return `"` + strings.ReplaceAll(f, `"`, `""`) + `"`
}

// sanitizeFTSQuery turns free user input into a safe, prefix-matching
// pieces_fts MATCH query. Each whitespace-separated token becomes its own
// quoted phrase (quoteFTSToken), joined with AND — "every one of these
// terms, any order" search-box behavior — with a trailing `*` on each:
// FTS5's phrase-prefix syntax, valid on a single-token "phrase" the same as
// a multi-token one, so a still-being-typed word matches ("andan" finds
// "Andantino"/"Andante sostenuto"), not just a complete one.
//
// This is prefix matching only — a query has to match some word's actual
// start. handleSearchPieces retries via sanitizeTrigramFTSQuery/
// pieces_fts_trigram (migration 00019) when this finds nothing, covering a
// mid-word fragment ("crack" finding "Nutcracker") that isn't a prefix of
// anything. Neither is fuzzy/typo-tolerant matching (a misspelled letter
// still won't match either way) — see the true-fuzzy-search research saved
// to memory for what that would take.
func sanitizeFTSQuery(query string) string {
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return ""
	}
	quoted := make([]string, len(fields))
	for i, f := range fields {
		quoted[i] = quoteFTSToken(f) + `*`
	}
	return strings.Join(quoted, " AND ")
}

// sanitizeTrigramFTSQuery is sanitizeFTSQuery's counterpart for
// pieces_fts_trigram — same safe-quoting, no trailing `*`: trigram's own
// tokenizer already matches a token anywhere inside a word (that's the
// point of the fallback), so the prefix operator doesn't add anything and
// isn't needed. A token shorter than 3 characters (trigram's own minimum)
// simply matches nothing rather than erroring — confirmed directly against
// this project's actual pinned driver before relying on it, not assumed
// from SQLite's docs alone.
func sanitizeTrigramFTSQuery(query string) string {
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return ""
	}
	quoted := make([]string, len(fields))
	for i, f := range fields {
		quoted[i] = quoteFTSToken(f)
	}
	return strings.Join(quoted, " AND ")
}
