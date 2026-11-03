package handlers

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// FacetCount is one selectable option in a filter drawer facet (e.g. one
// Key, one Instrument) paired with how many pieces/books currently match
// it. A value with zero matches is omitted from the response (a checkbox
// for a sheet type nobody has used yet is dead weight in the drawer) —
// unless it's currently selected, included or excluded, which is always
// listed, at 0 if need be (queryFacetCountsKeeping): the drawer needs it
// to show and undo that selection, and the filter chip reads its name
// from here. Without that, "Not purchased" plus filters no purchased
// piece matches dropped the tag from the drawer and showed the chip as
// "Not 5".
type FacetCount struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// StatusCount is practiceStatus's own facet shape — practiceStatus has no
// separate lookup table/ID (it's a CHECK constraint on a plain TEXT
// column, unlike Key/Instrument/SheetType/UserTag), and the frontend
// filter never needs an ID for it (the practiceStatus query param already
// takes the status string directly).
type StatusCount struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
}

// PieceFacets/BookFacets are live, faceted-navigation counts: each count reflects how many pieces/books would match
// if that value were checked *in addition to* every other currently
// active filter and the current search box text — the standard
// multi-select faceted-search rule (an option's own count never
// self-narrows against its own current selection, only against every
// OTHER active constraint). handlePieceFacets/handleBookFacets accept the
// same query params handleSearchPieces/handleListBooks do (query, plus
// each Filter Drawer facet's own param), and recompute one count query
// per facet dimension, excluding that dimension's own filter from the
// "other active filters" it ANDs in.
//
// Deliberate scope cut for the free-text portion: facet counts only ever
// use pieces_fts's plain prefix-match tier (pieceTextMatchClause below),
// never handleSearchPieces's own trigram/fuzzy fallback tiers. Facet
// counts recompute up to 8 times per request (once per dimension) —
// replicating the "does tier 1 come back empty, so fall back" decision
// (and the trigram/fuzzy tiers themselves, the one genuinely expensive,
// unindexed part of piece search) 8 times over would multiply an
// already-costlier query for a set of cosmetic sidebar counts. The one
// place this can visibly diverge from the result list: a query that only
// resolves via the list's own trigram/fuzzy fallback (a typo, or a
// mid-word fragment) — in that specific case, facet counts fall back to
// their whole-library values instead of narrowing to the fallback-matched
// set, while the result list itself still finds the right pieces via its
// own fallback tiers. Documented, deliberate (CLAUDE.md > Search), not an
// oversight.
type PieceFacets struct {
	Keys             []FacetCount  `json:"keys"`
	Instruments      []FacetCount  `json:"instruments"`
	SheetTypes       []FacetCount  `json:"sheetTypes"`
	UserTags         []FacetCount  `json:"userTags"`
	PracticeStatuses []StatusCount `json:"practiceStatuses"`
	Favorite         int           `json:"favorite"`
	Bookless         int           `json:"bookless"`
	HasImslpNumber   int           `json:"hasImslpNumber"`
	// HasAnnotations counts the pieces the caller has marked in the Sheet
	// Viewer or written notes on (their own only).
	HasAnnotations int `json:"hasAnnotations"`
}

type BookFacets struct {
	SheetTypes  []FacetCount `json:"sheetTypes"`
	Instruments []FacetCount `json:"instruments"`
}

// pieceTextMatchClause builds the free-text portion of a piece facet
// count's WHERE, when a search query is active — see PieceFacets's own
// doc comment above for why this is prefix-tier only, not the full
// prefix/trigram/fuzzy fallback chain handleSearchPieces uses for the
// actual result list.
func pieceTextMatchClause(query string) (join, where string, args []any) {
	if query == "" {
		return "", "", nil
	}
	return " JOIN pieces_fts ON pieces_fts.piece_id = p.id", "pieces_fts MATCH ?", []any{sanitizeFTSQuery(query)}
}

// whereClauseSuffix renders " WHERE <where>" (with a leading space, ready
// to append directly after a FROM/JOIN chain), or "" when there's nothing
// to filter on at all — every facet count query below is otherwise
// unconditional (matches the whole library) when no filter/search is
// active, same as this endpoint's original always-static behavior.
func whereClauseSuffix(where string) string {
	if where == "" {
		return ""
	}
	return " WHERE " + where
}

func (s *Server) handlePieceFacets(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	ctx := r.Context()
	q := r.URL.Query()
	query := strings.TrimSpace(q.Get("query"))

	clauses, ok := buildPieceFilterClauses(w, q, user.ID)
	if !ok {
		return
	}
	textJoin, textMatch, textArgs := pieceTextMatchClause(query)

	// buildWhere composes the free-text match (if any) with every active
	// filter clause except `exclude`'s own — see PieceFacets's own doc
	// comment for the faceted-search rule this implements.
	buildWhere := func(exclude string) (string, []any) {
		var parts []string
		var args []any
		if textMatch != "" {
			parts = append(parts, textMatch)
			args = append(args, textArgs...)
		}
		otherWhere, otherArgs := combineClauses(clauses, exclude)
		if otherWhere != "" {
			parts = append(parts, otherWhere)
			args = append(args, otherArgs...)
		}
		return strings.Join(parts, " AND "), args
	}

	keyWhere, keyArgs := buildWhere("keyId")
	keys, err := queryFacetCountsKeeping(ctx, s.DB, "musical_keys k", `
		SELECT k.id AS id, COUNT(pk.piece_id) AS n
		FROM musical_keys k
		JOIN piece_keys pk ON pk.key_id = k.id
		JOIN pieces p ON p.id = pk.piece_id`+textJoin+
		whereClauseSuffix(keyWhere)+`
		GROUP BY k.id`, keyArgs, "", nil, "k.sort_order",
		selectedFacetIDs(q, "keyId", "excludeKeyId"))
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Instrument/SheetType counts are inheritance-aware — mirroring the
	// exact WHERE clause handleSearchPieces uses for the instrumentId/
	// sheetTypeId filters (buildPieceFilterClauses above), just wrapped in
	// COUNT+GROUP BY instead of returning matching rows. A naive
	// direct-only count would undersell what checking the box actually
	// returns whenever a piece only qualifies via book inheritance.
	instWhere, instArgs := buildWhere("instrumentId")
	instruments, err := queryFacetCountsKeeping(ctx, s.DB, "instruments i", `
		SELECT i.id AS id, COUNT(DISTINCT p.id) AS n
		FROM instruments i
		JOIN pieces p ON
			p.id IN (SELECT piece_id FROM piece_instruments WHERE instrument_id = i.id)
			OR (p.id NOT IN (SELECT piece_id FROM piece_instruments)
				AND p.source_book_id IN (SELECT book_id FROM book_instruments WHERE instrument_id = i.id))`+textJoin+
		whereClauseSuffix(instWhere)+`
		GROUP BY i.id`, instArgs, "", nil, "i.name",
		selectedFacetIDs(q, "instrumentId", "excludeInstrumentId"))
	if err != nil {
		s.writeError(w, err)
		return
	}

	stWhere, stArgs := buildWhere("sheetTypeId")
	sheetTypes, err := queryFacetCountsKeeping(ctx, s.DB, "sheet_types st", `
		SELECT st.id AS id, COUNT(p.id) AS n
		FROM sheet_types st
		JOIN pieces p ON
			p.sheet_type_id = st.id
			OR (p.sheet_type_id IS NULL AND p.source_book_id IN (SELECT id FROM books WHERE sheet_type_id = st.id))`+textJoin+
		whereClauseSuffix(stWhere)+`
		GROUP BY st.id`, stArgs, "", nil, "st.sort_order",
		selectedFacetIDs(q, "sheetTypeId", "excludeSheetTypeId"))
	if err != nil {
		s.writeError(w, err)
		return
	}

	utWhere, utArgs := buildWhere("userTagId")
	// The caller's own tags only (a tag is private to its owner, CLAUDE.md
	// > Concurrency) — another account's tag names never reach this list.
	userTags, err := queryFacetCountsKeeping(ctx, s.DB, "user_tags t", `
		SELECT t.id AS id, COUNT(put.piece_id) AS n
		FROM user_tags t
		JOIN piece_user_tags put ON put.tag_id = t.id
		JOIN pieces p ON p.id = put.piece_id`+textJoin+
		whereClauseSuffix(utWhere)+`
		GROUP BY t.id`, utArgs, "t.owner_user_id = ?", []any{user.ID}, "t.name",
		selectedFacetIDs(q, "userTagId", "excludeUserTagId"))
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Scoped to user.ID (migration 00025) — practice status is per-user now,
	// so this facet counts only the calling user's own statuses, joined
	// through piece_practice_status/practice_statuses instead of a plain
	// p.practice_status column.
	psWhere, psArgs := buildWhere("practiceStatus")
	psFullWhere := "pps.user_id = ?"
	psQueryArgs := append([]any{user.ID}, psArgs...)
	if psWhere != "" {
		psFullWhere += " AND " + psWhere
	}
	// Like the ID facets, a selected status stays listed at 0
	// (queryFacetCountsKeeping's comment).
	selectedStatuses := selectedFacetNames(q, "practiceStatus", "excludePracticeStatus")
	keepStatus := ""
	if len(selectedStatuses) > 0 {
		keepStatus = " OR ps.name IN (" + sqlPlaceholders(len(selectedStatuses)) + ")"
	}
	psQueryArgs = append(psQueryArgs, user.ID)
	for _, name := range selectedStatuses {
		psQueryArgs = append(psQueryArgs, name)
	}
	statusRows, err := s.DB.QueryContext(ctx, `
		SELECT ps.name, COALESCE(c.n, 0)
		FROM practice_statuses ps
		LEFT JOIN (
			SELECT pps.status_id AS id, COUNT(*) AS n
			FROM piece_practice_status pps
			JOIN pieces p ON p.id = pps.piece_id`+textJoin+`
			WHERE `+psFullWhere+`
			GROUP BY pps.status_id
		) c ON c.id = ps.id
		WHERE ps.owner_user_id = ? AND (c.id IS NOT NULL`+keepStatus+`)
		-- Practice order (Want to Learn → Dropped) by the durable icon_key,
		-- matching the frontend's sortPracticeStatuses; statuses without
		-- one follow by name.
		ORDER BY CASE ps.icon_key
			WHEN 'want_to_learn' THEN 0 WHEN 'learning' THEN 1 WHEN 'learned' THEN 2
			WHEN 'stalled' THEN 3 WHEN 'dropped' THEN 4 ELSE 5 END, ps.name`, psQueryArgs...)
	if err != nil {
		s.writeError(w, err)
		return
	}
	statuses := []StatusCount{}
	for statusRows.Next() {
		var sc StatusCount
		if err := statusRows.Scan(&sc.Status, &sc.Count); err != nil {
			statusRows.Close()
			s.writeError(w, err)
			return
		}
		statuses = append(statuses, sc)
	}
	if err := statusRows.Err(); err != nil {
		statusRows.Close()
		s.writeError(w, err)
		return
	}
	statusRows.Close()

	// Scoped to user.ID (migration 00025) — favorite is per-user now
	// (piece_favorites), so this counts only pieces the calling user
	// themselves has favorited, not a shared column.
	favWhere, favArgs := buildWhere("favorite")
	favOwnCondition := "p.id IN (SELECT piece_id FROM piece_favorites WHERE user_id = ?)"
	favQueryArgs := append([]any{user.ID}, favArgs...)
	favorite, err := countPiecesMatching(ctx, s.DB, favOwnCondition, textJoin, favWhere, favQueryArgs)
	if err != nil {
		s.writeError(w, err)
		return
	}

	boWhere, boArgs := buildWhere("bookless")
	bookless, err := countPiecesMatching(ctx, s.DB, "p.source_book_id IS NULL", textJoin, boWhere, boArgs)
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Unlike favorite/bookless just above (plain columns, no inheritance to
	// consider), hasImslpNumber counts the *effective* IMSLP number — a
	// direct-only count would undersell what checking the box actually
	// returns for a piece that only inherits its number from its book.
	// Same OR-fallback shape/non-blank test as buildPieceFilterClauses's
	// own hasImslpNumber clause.
	imslpWhere, imslpArgs := buildWhere("hasImslpNumber")
	hasImslpNumber, err := countPiecesMatching(ctx, s.DB, `(NULLIF(TRIM(p.imslp_number), '') IS NOT NULL OR (NULLIF(TRIM(p.imslp_number), '') IS NULL AND p.source_book_id IN (
			SELECT id FROM books WHERE NULLIF(TRIM(imslp_number), '') IS NOT NULL
		)))`, textJoin, imslpWhere, imslpArgs)
	if err != nil {
		s.writeError(w, err)
		return
	}

	annWhere, annArgs := buildWhere("hasAnnotations")
	hasAnnotations, err := countPiecesMatching(ctx, s.DB, annotatedPiecesCondition, textJoin, annWhere,
		append(annotatedPiecesArgs(user.ID), annArgs...))
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, PieceFacets{
		Keys:             keys,
		Instruments:      instruments,
		SheetTypes:       sheetTypes,
		UserTags:         userTags,
		PracticeStatuses: statuses,
		Favorite:         favorite,
		Bookless:         bookless,
		HasImslpNumber:   hasImslpNumber,
		HasAnnotations:   hasAnnotations,
	})
}

// countPiecesMatching runs `SELECT COUNT(*) FROM pieces p<textJoin> WHERE
// <ownCondition> [AND <otherWhere>]` — the shared shape behind each of
// PieceFacets's boolean ("Show only") counts. ownCondition is usually a
// fixed, parameter-free SQL fragment (bookless/hasImslpNumber), in which
// case otherArgs alone is the query's full arg list; favorite (migration
// 00025, now a per-user join) is the one exception — its ownCondition
// carries its own leading `?` (for userID), so its caller passes that value
// prepended onto otherArgs, matching the placeholder order in the SQL text
// above (ownCondition's own placeholders always come before otherWhere's).
func countPiecesMatching(ctx context.Context, db *sql.DB, ownCondition, textJoin, otherWhere string, otherArgs []any) (int, error) {
	fullWhere := ownCondition
	if otherWhere != "" {
		fullWhere += " AND " + otherWhere
	}
	var count int
	err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pieces p`+textJoin+` WHERE `+fullWhere, otherArgs...).Scan(&count)
	return count, err
}

// handleBookFacets needs none of handlePieceFacets's inheritance
// complexity — a Book is the top of the hierarchy, nothing to fall back
// to (CLAUDE.md > Book-level soft inheritance) — but is otherwise the same
// live, faceted-navigation treatment: each count reflects the *other*
// active filter/search, same "never self-narrows against its own current
// selection" rule as PieceFacets. bookTextMatchClause mirrors
// handleListBooks's own plain-LIKE text search (no FTS5 table for Books,
// CLAUDE.md > Search) rather than pieceTextMatchClause's MATCH — kept as
// its own function since the two resources' free-text mechanisms are
// genuinely different, not just differently named.
// buildBookFilterClauses parses the Book Filter Drawer's own filter query
// params — sheetTypeId/instrumentId — into one namedClause per active
// filter, b.-qualified for handleBookFacets's own multi-table queries (see
// bookTextMatchClause's comment just below for why). Deliberately a
// separate, standalone builder from handleListBooks's own inline
// filter-building in book.go, not a shared one the way
// buildPieceFilterClauses is shared with handleSearchPieces —
// handleListBooks's query has no other table in scope to disambiguate
// against, so its own unaliased fragments are simplest left exactly as
// they are rather than rewired through a shared, alias-qualified builder
// for no behavioral gain.
func buildBookFilterClauses(w http.ResponseWriter, q url.Values) (clauses []namedClause, ok bool) {
	if ids, present, ok := parseIDListFilter(w, q, "sheetTypeId"); !ok {
		return nil, false
	} else if present {
		clauses = append(clauses, namedClause{
			name:  "sheetTypeId",
			where: "b.sheet_type_id IN (" + sqlPlaceholders(len(ids)) + ")",
			args:  idsToArgs(ids),
		})
	}
	// excludeSheetTypeId shares the "sheetTypeId" clause name with its
	// include sibling above (see namedClause's own comment) and goes
	// through negateClause, not a bare NOT IN — book.go's identical
	// handleListBooks fragment has the full reasoning (sheet_type_id is
	// nullable, and a bare NOT IN silently mishandles that).
	if ids, present, ok := parseIDListFilter(w, q, "excludeSheetTypeId"); !ok {
		return nil, false
	} else if present {
		clauses = append(clauses, namedClause{
			name:  "sheetTypeId",
			where: negateClause("b.sheet_type_id IN (" + sqlPlaceholders(len(ids)) + ")"),
			args:  idsToArgs(ids),
		})
	}

	if ids, present, ok := parseIDListFilter(w, q, "instrumentId"); !ok {
		return nil, false
	} else if present {
		clauses = append(clauses, namedClause{
			name:  "instrumentId",
			where: "b.id IN (SELECT book_id FROM book_instruments WHERE instrument_id IN (" + sqlPlaceholders(len(ids)) + "))",
			args:  idsToArgs(ids),
		})
	}
	if ids, present, ok := parseIDListFilter(w, q, "excludeInstrumentId"); !ok {
		return nil, false
	} else if present {
		clauses = append(clauses, namedClause{
			name:  "instrumentId",
			where: "b.id NOT IN (SELECT book_id FROM book_instruments WHERE instrument_id IN (" + sqlPlaceholders(len(ids)) + "))",
			args:  idsToArgs(ids),
		})
	}

	return clauses, true
}

// b.-qualified throughout (unlike handleListBooks's own unaliased version,
// which queries a bare `FROM books` with nothing else in scope) — every
// facet count query this feeds into also joins sheet_types/instruments,
// each of which has its own `id` column, so a bare `id`/`book_title`/
// `publisher` here would be ambiguous the moment both tables are in scope.
func bookTextMatchClause(query string) (where string, args []any) {
	if query == "" {
		return "", nil
	}
	// Same repo.NormalizeAmpersandForLike + column-side REPLACE treatment
	// as handleListBooks's own identical clause (internal/handlers/book.go)
	// — see that function's comment for why.
	like := "%" + repo.NormalizeAmpersandForLike(query) + "%"
	return `(REPLACE(b.book_title, '&', 'and') LIKE ? OR REPLACE(b.publisher, '&', 'and') LIKE ?
		OR b.id IN (SELECT book_id FROM book_composers bc JOIN people ppl ON ppl.id = bc.person_id WHERE REPLACE(ppl.name, '&', 'and') LIKE ?)
		OR b.id IN (SELECT book_id FROM book_arrangers ba JOIN people ppl ON ppl.id = ba.person_id WHERE REPLACE(ppl.name, '&', 'and') LIKE ?))`,
		[]any{like, like, like, like}
}

func (s *Server) handleBookFacets(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return
	}
	ctx := r.Context()
	q := r.URL.Query()
	query := strings.TrimSpace(q.Get("query"))

	clauses, ok := buildBookFilterClauses(w, q)
	if !ok {
		return
	}
	textWhere, textArgs := bookTextMatchClause(query)

	buildWhere := func(exclude string) (string, []any) {
		var parts []string
		var args []any
		if textWhere != "" {
			parts = append(parts, textWhere)
			args = append(args, textArgs...)
		}
		otherWhere, otherArgs := combineClauses(clauses, exclude)
		if otherWhere != "" {
			parts = append(parts, otherWhere)
			args = append(args, otherArgs...)
		}
		return strings.Join(parts, " AND "), args
	}

	stWhere, stArgs := buildWhere("sheetTypeId")
	sheetTypes, err := queryFacetCountsKeeping(ctx, s.DB, "sheet_types st", `
		SELECT st.id AS id, COUNT(b.id) AS n
		FROM sheet_types st
		JOIN books b ON b.sheet_type_id = st.id`+
		whereClauseSuffix(stWhere)+`
		GROUP BY st.id`, stArgs, "", nil, "st.sort_order",
		selectedFacetIDs(q, "sheetTypeId", "excludeSheetTypeId"))
	if err != nil {
		s.writeError(w, err)
		return
	}

	instWhere, instArgs := buildWhere("instrumentId")
	instruments, err := queryFacetCountsKeeping(ctx, s.DB, "instruments i", `
		SELECT i.id AS id, COUNT(DISTINCT bi.book_id) AS n
		FROM instruments i
		JOIN book_instruments bi ON bi.instrument_id = i.id
		JOIN books b ON b.id = bi.book_id`+
		whereClauseSuffix(instWhere)+`
		GROUP BY i.id`, instArgs, "", nil, "i.name",
		selectedFacetIDs(q, "instrumentId", "excludeInstrumentId"))
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, BookFacets{
		SheetTypes:  sheetTypes,
		Instruments: instruments,
	})
}

// queryFacetCountsKeeping lists one facet: every value of `lookup` (a
// table and its alias, "musical_keys k") that `counted` (a grouped query
// returning `id, n`) found matches for, plus every value in `selected` —
// the IDs the request currently includes or excludes — at 0 when nothing
// matches (FacetCount's comment). `scope` (with its args) limits which
// lookup rows can appear at all, e.g. the caller's own tags; `orderBy`
// sorts by the lookup's columns. Query text is caller-built from fixed
// fragments, with every value bound through placeholders.
func queryFacetCountsKeeping(ctx context.Context, db *sql.DB, lookup, counted string, countedArgs []any, scope string, scopeArgs []any, orderBy string, selected []int64) ([]FacetCount, error) {
	alias := lookup[strings.LastIndex(lookup, " ")+1:]
	keep := ""
	if len(selected) > 0 {
		keep = " OR " + alias + ".id IN (" + sqlPlaceholders(len(selected)) + ")"
	}
	where := "(c.id IS NOT NULL" + keep + ")"
	if scope != "" {
		where += " AND " + scope
	}
	args := append(append(append([]any{}, countedArgs...), idsToArgs(selected)...), scopeArgs...)
	return queryFacetCounts(ctx, db, `
		SELECT `+alias+`.id, `+alias+`.name, COALESCE(c.n, 0)
		FROM `+lookup+`
		LEFT JOIN (`+counted+`) c ON c.id = `+alias+`.id
		WHERE `+where+`
		ORDER BY `+orderBy, args...)
}

// selectedFacetIDs gathers the IDs a request names in any of `params`
// (a facet's include and exclude lists). The handlers have already
// validated these params, so a malformed segment is just skipped here.
func selectedFacetIDs(q url.Values, params ...string) []int64 {
	var ids []int64
	for _, param := range params {
		for _, part := range strings.Split(q.Get(param), ",") {
			if id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64); err == nil {
				ids = append(ids, id)
			}
		}
	}
	return ids
}

// selectedFacetNames is selectedFacetIDs for the practice-status lists,
// which name statuses rather than numbering them.
func selectedFacetNames(q url.Values, params ...string) []string {
	var names []string
	for _, param := range params {
		for _, part := range strings.Split(q.Get(param), ",") {
			if name := strings.TrimSpace(part); name != "" {
				names = append(names, name)
			}
		}
	}
	return names
}

// queryFacetCounts runs one facet's (id, name, count) query and scans its
// rows.
func queryFacetCounts(ctx context.Context, db *sql.DB, query string, args ...any) ([]FacetCount, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := []FacetCount{}
	for rows.Next() {
		var fc FacetCount
		if err := rows.Scan(&fc.ID, &fc.Name, &fc.Count); err != nil {
			return nil, err
		}
		counts = append(counts, fc)
	}
	return counts, rows.Err()
}
