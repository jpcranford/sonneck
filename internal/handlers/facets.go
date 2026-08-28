package handlers

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
)

// FacetCount is one selectable option in a filter drawer facet (e.g. one
// Key, one Instrument) paired with how many pieces/books currently match
// it. A value with zero matches is omitted from the response entirely
// (see the queries below, each filtered to count > 0) rather than listed
// at count 0 — a checkbox for a sheet type nobody has used yet is dead
// weight in the drawer.
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

// PieceFacets/BookFacets are deliberately static — computed from the
// *whole* library, not narrowed by whatever's currently typed in the
// search box or by other active filters (a fully "faceted"/dynamic search
// where checking one box changes every other box's count). Fetched once
// per drawer-open on the frontend, not recomputed per keystroke or per
// filter change.
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

func (s *Server) handlePieceFacets(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	keys, err := queryFacetCounts(ctx, s.DB, `
		SELECT k.id, k.name, COUNT(pk.piece_id)
		FROM musical_keys k
		JOIN piece_keys pk ON pk.key_id = k.id
		GROUP BY k.id
		ORDER BY k.sort_order`)
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Instrument/SheetType counts are inheritance-aware — mirroring the
	// exact WHERE clause handleSearchPieces uses for the instrumentId/
	// sheetTypeId filters (internal/handlers/search.go), just wrapped in
	// COUNT+GROUP BY instead of returning matching rows. A naive
	// direct-only count would undersell what checking the box actually
	// returns whenever a piece only qualifies via book inheritance.
	instruments, err := queryFacetCounts(ctx, s.DB, `
		SELECT i.id, i.name, COUNT(DISTINCT p.id)
		FROM instruments i
		JOIN pieces p ON
			p.id IN (SELECT piece_id FROM piece_instruments WHERE instrument_id = i.id)
			OR (p.id NOT IN (SELECT piece_id FROM piece_instruments)
				AND p.source_book_id IN (SELECT book_id FROM book_instruments WHERE instrument_id = i.id))
		GROUP BY i.id
		ORDER BY i.name`)
	if err != nil {
		s.writeError(w, err)
		return
	}

	sheetTypes, err := queryFacetCounts(ctx, s.DB, `
		SELECT st.id, st.name, COUNT(p.id)
		FROM sheet_types st
		JOIN pieces p ON
			p.sheet_type_id = st.id
			OR (p.sheet_type_id IS NULL AND p.source_book_id IN (SELECT id FROM books WHERE sheet_type_id = st.id))
		GROUP BY st.id
		ORDER BY st.sort_order`)
	if err != nil {
		s.writeError(w, err)
		return
	}

	userTags, err := queryFacetCounts(ctx, s.DB, `
		SELECT t.id, t.name, COUNT(put.piece_id)
		FROM user_tags t
		JOIN piece_user_tags put ON put.tag_id = t.id
		GROUP BY t.id
		ORDER BY t.name`)
	if err != nil {
		s.writeError(w, err)
		return
	}

	statusRows, err := s.DB.QueryContext(ctx, `
		SELECT practice_status, COUNT(*)
		FROM pieces
		WHERE practice_status IS NOT NULL
		GROUP BY practice_status`)
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

	var favorite, bookless int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM pieces WHERE favorite = 1`).Scan(&favorite); err != nil {
		s.writeError(w, err)
		return
	}
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM pieces WHERE source_book_id IS NULL`).Scan(&bookless); err != nil {
		s.writeError(w, err)
		return
	}

	// Unlike favorite/bookless just above (plain columns, no inheritance to
	// consider), hasImslpNumber counts the *effective* IMSLP number — a
	// direct-only count would undersell what checking the box actually
	// returns for a piece that only inherits its number from its book.
	// Same OR-fallback shape/non-blank test as handleSearchPieces's own
	// hasImslpNumber filter.
	var hasImslpNumber int
	if err := s.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pieces p WHERE
			NULLIF(TRIM(p.imslp_number), '') IS NOT NULL
			OR (NULLIF(TRIM(p.imslp_number), '') IS NULL AND p.source_book_id IN (
				SELECT id FROM books WHERE NULLIF(TRIM(imslp_number), '') IS NOT NULL
			))`).Scan(&hasImslpNumber); err != nil {
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

// handleBookFacets needs none of handlePieceFacets's inheritance
// complexity — a Book is the top of the hierarchy, nothing to fall back
// to (CLAUDE.md > Book-level soft inheritance), so these are plain
// GROUP BY counts.
func (s *Server) handleBookFacets(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	sheetTypes, err := queryFacetCounts(ctx, s.DB, `
		SELECT st.id, st.name, COUNT(b.id)
		FROM sheet_types st
		JOIN books b ON b.sheet_type_id = st.id
		GROUP BY st.id
		ORDER BY st.sort_order`)
	if err != nil {
		s.writeError(w, err)
		return
	}

	instruments, err := queryFacetCounts(ctx, s.DB, `
		SELECT i.id, i.name, COUNT(DISTINCT bi.book_id)
		FROM instruments i
		JOIN book_instruments bi ON bi.instrument_id = i.id
		GROUP BY i.id
		ORDER BY i.name`)
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, BookFacets{
		SheetTypes:  sheetTypes,
		Instruments: instruments,
	})
}

// queryFacetCounts runs a fixed (never user-input-derived), hardcoded
// facet query and scans its (id, name, count) rows. Every caller's query
// already excludes zero-count rows via its own JOIN (an INNER JOIN against
// the piece/book side naturally drops a facet value nothing currently
// references), so there's no separate HAVING needed here.
func queryFacetCounts(ctx context.Context, db *sql.DB, query string) ([]FacetCount, error) {
	rows, err := db.QueryContext(ctx, query)
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
