package handlers

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
)

// FacetCount is one selectable option in a filter drawer facet (e.g. one
// Key, one Instrument) paired with how many pieces/books currently match
// it. A value with zero matches is omitted from the response entirely
// (see the queries below, each filtered to count > 0 via an INNER JOIN)
// rather than listed at count 0 — a checkbox for a sheet type nobody has
// used yet is dead weight in the drawer.
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

// PieceFacets/BookFacets are live, faceted-navigation counts (changed
// 2026-08-31 — see this file's own history for the earlier "deliberately
// static" design): each count reflects how many pieces/books would match
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
	ctx := r.Context()
	q := r.URL.Query()
	query := strings.TrimSpace(q.Get("query"))

	clauses, ok := buildPieceFilterClauses(w, q)
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
	keys, err := queryFacetCounts(ctx, s.DB, `
		SELECT k.id, k.name, COUNT(pk.piece_id)
		FROM musical_keys k
		JOIN piece_keys pk ON pk.key_id = k.id
		JOIN pieces p ON p.id = pk.piece_id`+textJoin+
		whereClauseSuffix(keyWhere)+`
		GROUP BY k.id
		ORDER BY k.sort_order`, keyArgs...)
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
	instruments, err := queryFacetCounts(ctx, s.DB, `
		SELECT i.id, i.name, COUNT(DISTINCT p.id)
		FROM instruments i
		JOIN pieces p ON
			p.id IN (SELECT piece_id FROM piece_instruments WHERE instrument_id = i.id)
			OR (p.id NOT IN (SELECT piece_id FROM piece_instruments)
				AND p.source_book_id IN (SELECT book_id FROM book_instruments WHERE instrument_id = i.id))`+textJoin+
		whereClauseSuffix(instWhere)+`
		GROUP BY i.id
		ORDER BY i.name`, instArgs...)
	if err != nil {
		s.writeError(w, err)
		return
	}

	stWhere, stArgs := buildWhere("sheetTypeId")
	sheetTypes, err := queryFacetCounts(ctx, s.DB, `
		SELECT st.id, st.name, COUNT(p.id)
		FROM sheet_types st
		JOIN pieces p ON
			p.sheet_type_id = st.id
			OR (p.sheet_type_id IS NULL AND p.source_book_id IN (SELECT id FROM books WHERE sheet_type_id = st.id))`+textJoin+
		whereClauseSuffix(stWhere)+`
		GROUP BY st.id
		ORDER BY st.sort_order`, stArgs...)
	if err != nil {
		s.writeError(w, err)
		return
	}

	utWhere, utArgs := buildWhere("userTagId")
	userTags, err := queryFacetCounts(ctx, s.DB, `
		SELECT t.id, t.name, COUNT(put.piece_id)
		FROM user_tags t
		JOIN piece_user_tags put ON put.tag_id = t.id
		JOIN pieces p ON p.id = put.piece_id`+textJoin+
		whereClauseSuffix(utWhere)+`
		GROUP BY t.id
		ORDER BY t.name`, utArgs...)
	if err != nil {
		s.writeError(w, err)
		return
	}

	psWhere, psArgs := buildWhere("practiceStatus")
	psFullWhere := "p.practice_status IS NOT NULL"
	if psWhere != "" {
		psFullWhere += " AND " + psWhere
	}
	statusRows, err := s.DB.QueryContext(ctx, `
		SELECT p.practice_status, COUNT(*)
		FROM pieces p`+textJoin+`
		WHERE `+psFullWhere+`
		GROUP BY p.practice_status`, psArgs...)
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

	favWhere, favArgs := buildWhere("favorite")
	favorite, err := countPiecesMatching(ctx, s.DB, "p.favorite = 1", textJoin, favWhere, favArgs)
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

	api.WriteData(w, http.StatusOK, PieceFacets{
		Keys:             keys,
		Instruments:      instruments,
		SheetTypes:       sheetTypes,
		UserTags:         userTags,
		PracticeStatuses: statuses,
		Favorite:         favorite,
		Bookless:         bookless,
		HasImslpNumber:   hasImslpNumber,
	})
}

// countPiecesMatching runs `SELECT COUNT(*) FROM pieces p<textJoin> WHERE
// <ownCondition> [AND <otherWhere>]` — the shared shape behind each of
// PieceFacets's three boolean ("Show only") counts. ownCondition is always
// a fixed, parameter-free SQL fragment (no `?` placeholders of its own),
// so otherArgs alone is the query's full arg list.
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

	if ids, present, ok := parseIDListFilter(w, q, "instrumentId"); !ok {
		return nil, false
	} else if present {
		clauses = append(clauses, namedClause{
			name:  "instrumentId",
			where: "b.id IN (SELECT book_id FROM book_instruments WHERE instrument_id IN (" + sqlPlaceholders(len(ids)) + "))",
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
	like := "%" + query + "%"
	return `(b.book_title LIKE ? OR b.publisher LIKE ?
		OR b.id IN (SELECT book_id FROM book_composers bc JOIN people ppl ON ppl.id = bc.person_id WHERE ppl.name LIKE ?)
		OR b.id IN (SELECT book_id FROM book_arrangers ba JOIN people ppl ON ppl.id = ba.person_id WHERE ppl.name LIKE ?))`,
		[]any{like, like, like, like}
}

func (s *Server) handleBookFacets(w http.ResponseWriter, r *http.Request) {
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
	sheetTypes, err := queryFacetCounts(ctx, s.DB, `
		SELECT st.id, st.name, COUNT(b.id)
		FROM sheet_types st
		JOIN books b ON b.sheet_type_id = st.id`+
		whereClauseSuffix(stWhere)+`
		GROUP BY st.id
		ORDER BY st.sort_order`, stArgs...)
	if err != nil {
		s.writeError(w, err)
		return
	}

	instWhere, instArgs := buildWhere("instrumentId")
	instruments, err := queryFacetCounts(ctx, s.DB, `
		SELECT i.id, i.name, COUNT(DISTINCT bi.book_id)
		FROM instruments i
		JOIN book_instruments bi ON bi.instrument_id = i.id
		JOIN books b ON b.id = bi.book_id`+
		whereClauseSuffix(instWhere)+`
		GROUP BY i.id
		ORDER BY i.name`, instArgs...)
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, BookFacets{
		SheetTypes:  sheetTypes,
		Instruments: instruments,
	})
}

// queryFacetCounts runs one facet's own (id, name, count) query — text and
// args are entirely caller-built (never directly from user input without
// going through the query-building helpers above, which use SQL
// placeholders throughout) — and scans its rows. Every caller's query
// already excludes zero-count rows via its own INNER JOIN (a facet value
// nothing currently references naturally drops out), so there's no
// separate HAVING needed here.
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
