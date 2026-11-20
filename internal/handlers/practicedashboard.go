package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/repo"
)

// The Practice Dashboard (the sidebar's Practice): every shelf and the
// practice days in one request, each shelf sorted and capped here, so the
// page needs no per-shelf queries. Gated `read` then `practice`, like the
// Practice List it sits beside: it's the caller's own practice data.
//
// ?day= is the caller's local calendar day ('YYYY-MM-DD'), as everywhere
// in the practice log: the server can't know which day it is for them.

const (
	// dashboardShelfCap is how many pieces a shelf with a page of its own
	// sends: what an expanded shelf shows, the rest behind See all.
	dashboardShelfCap = 16
	// The two shelves with no page of their own are short lists.
	dashboardRecentlyAddedCap  = 10
	dashboardRecentlyPlayedCap = 15
	// practiceDaysBack is how far back the practice days go: six weeks,
	// more than either week view needs.
	practiceDaysBack = 41
)

type recentlyPlayedPiece struct {
	Piece *api.PieceResponse `json:"piece"`
	// LastPracticed is the last day the piece was marked practiced.
	LastPracticed string `json:"lastPracticed"`
}

type practiceDashboardResponse struct {
	// Learning or Stalled (the sidebar's Currently Practicing), the most
	// recently changed status first.
	Practicing []*api.PieceResponse `json:"practicing"`
	// Practiced pieces not in Currently Practicing, the most recent day
	// first.
	RecentlyPlayed []recentlyPlayedPiece `json:"recentlyPlayed"`
	// The newest uploads first.
	RecentlyAdded []*api.PieceResponse `json:"recentlyAdded"`
	// The other sidebar views, by title.
	Favorites   []*api.PieceResponse `json:"favorites"`
	WantToLearn []*api.PieceResponse `json:"wantToLearn"`
	Learned     []*api.PieceResponse `json:"learned"`
	// Every day with a piece marked practiced, from six weeks before ?day=
	// through it, oldest first.
	PracticeDays []string `json:"practiceDays"`
}

func (s *Server) handlePracticeDashboard(w http.ResponseWriter, r *http.Request) {
	user, ok := s.practiceUser(w, r)
	if !ok {
		return
	}
	day := r.URL.Query().Get("day")
	if !validDay(day) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "day must be YYYY-MM-DD")
		return
	}
	ctx := r.Context()
	byTitle := titleSortColumn("p.title")("ASC")

	resp := practiceDashboardResponse{}
	var err error

	// The sidebar views' own rule: by sidebar_slot, so a renamed status
	// still lands on its shelf.
	slotIDs := func(slot, order string, limit int) ([]int64, error) {
		return s.pieceIDs(ctx, `
			SELECT p.id FROM pieces p
			JOIN piece_practice_status pps ON pps.piece_id = p.id AND pps.user_id = ?
			JOIN practice_statuses ps ON ps.id = pps.status_id
			WHERE ps.sidebar_slot = ?
			ORDER BY `+order+`, p.id DESC LIMIT ?`, user.ID, slot, limit)
	}

	practicingIDs, err := slotIDs("practicing", "pps.updated_at IS NULL, pps.updated_at DESC, "+byTitle, dashboardShelfCap)
	if err == nil {
		resp.Practicing, err = s.pieceResponses(ctx, practicingIDs, user.ID)
	}
	if err == nil {
		resp.RecentlyPlayed, err = s.recentlyPlayed(ctx, user.ID)
	}
	if err == nil {
		var ids []int64
		ids, err = s.pieceIDs(ctx, `SELECT p.id FROM pieces p ORDER BY p.id DESC LIMIT ?`, dashboardRecentlyAddedCap)
		if err == nil {
			resp.RecentlyAdded, err = s.pieceResponses(ctx, ids, user.ID)
		}
	}
	if err == nil {
		var ids []int64
		ids, err = s.pieceIDs(ctx, `
			SELECT p.id FROM pieces p
			JOIN piece_favorites f ON f.piece_id = p.id AND f.user_id = ?
			ORDER BY `+byTitle+`, p.id DESC LIMIT ?`, user.ID, dashboardShelfCap)
		if err == nil {
			resp.Favorites, err = s.pieceResponses(ctx, ids, user.ID)
		}
	}
	if err == nil {
		var ids []int64
		ids, err = slotIDs("want_to_learn", byTitle, dashboardShelfCap)
		if err == nil {
			resp.WantToLearn, err = s.pieceResponses(ctx, ids, user.ID)
		}
	}
	if err == nil {
		var ids []int64
		ids, err = slotIDs("learned", byTitle, dashboardShelfCap)
		if err == nil {
			resp.Learned, err = s.pieceResponses(ctx, ids, user.ID)
		}
	}
	if err == nil {
		resp.PracticeDays, err = s.practiceDays(ctx, user.ID, day)
	}
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// recentlyPlayed is each piece's last practiced day, newest first, leaving
// out what Currently Practicing already shows (Learning and Stalled), so
// no piece is on both shelves.
func (s *Server) recentlyPlayed(ctx context.Context, userID int64) ([]recentlyPlayedPiece, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT d.piece_id, MAX(d.day) AS last_day
		FROM piece_practice_days d
		WHERE d.user_id = ? AND d.practiced = 1
		  AND d.piece_id NOT IN (
			SELECT pps.piece_id FROM piece_practice_status pps
			JOIN practice_statuses ps ON ps.id = pps.status_id
			WHERE pps.user_id = ? AND ps.sidebar_slot = 'practicing')
		GROUP BY d.piece_id
		ORDER BY last_day DESC, d.piece_id DESC
		LIMIT ?`, userID, userID, dashboardRecentlyPlayedCap)
	if err != nil {
		return nil, err
	}
	type row struct {
		id  int64
		day string
	}
	var found []row
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.id, &x.day); err != nil {
			rows.Close()
			return nil, err
		}
		found = append(found, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]recentlyPlayedPiece, 0, len(found))
	for _, x := range found {
		pieces, err := s.pieceResponses(ctx, []int64{x.id}, userID)
		if err != nil {
			return nil, err
		}
		out = append(out, recentlyPlayedPiece{Piece: pieces[0], LastPracticed: x.day})
	}
	return out, nil
}

// practiceDays lists the days userID practiced anything, from
// practiceDaysBack days before day through day.
func (s *Server) practiceDays(ctx context.Context, userID int64, day string) ([]string, error) {
	end, _ := time.Parse("2006-01-02", day)
	start := end.AddDate(0, 0, -practiceDaysBack).Format("2006-01-02")
	rows, err := s.DB.QueryContext(ctx, `
		SELECT DISTINCT day FROM piece_practice_days
		WHERE user_id = ? AND practiced = 1 AND day >= ? AND day <= ?
		ORDER BY day`, userID, start, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := []string{}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		days = append(days, d)
	}
	return days, rows.Err()
}

// pieceIDs runs a query returning one piece id per row.
func (s *Server) pieceIDs(ctx context.Context, query string, args ...any) ([]int64, error) {
	rows, err := s.DB.QueryContext(ctx, query, args...)
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

// pieceResponses builds each piece the way the library search does (the
// caller's favorite and practice status included), in the order given.
func (s *Server) pieceResponses(ctx context.Context, ids []int64, userID int64) ([]*api.PieceResponse, error) {
	out := make([]*api.PieceResponse, 0, len(ids))
	for _, id := range ids {
		p, err := repo.GetPieceByID(ctx, s.DB, id)
		if err != nil {
			return nil, err
		}
		resp, err := api.BuildPieceResponse(ctx, s.DB, p, s.Cfg.CopyrightRegion(), userID)
		if err != nil {
			return nil, err
		}
		out = append(out, resp)
	}
	return out, nil
}
