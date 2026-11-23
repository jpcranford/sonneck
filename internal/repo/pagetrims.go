package repo

import (
	"context"
	"math"
)

// PageTrim is one page's Trim Margins frame (migration 00043): its edges as
// shares of the page, 0 to 1, like an annotation's coordinates.
type PageTrim struct {
	Page   int     `json:"page"`
	Left   float64 `json:"left"`
	Top    float64 `json:"top"`
	Right  float64 `json:"right"`
	Bottom float64 `json:"bottom"`
}

// TrimMin is the smallest a frame may be either way, as a share of the
// page (the frontend's TRIM_MIN), less a hair for rounding.
const TrimMin = 0.1 - 1e-6

// Valid reports whether t is a frame on a page from 1 to pageCount, on the
// page and at least TrimMin across and down.
func (t PageTrim) Valid(pageCount int) bool {
	for _, v := range []float64{t.Left, t.Top, t.Right, t.Bottom} {
		if math.IsNaN(v) || v < 0 || v > 1 {
			return false
		}
	}
	return t.Page >= 1 && t.Page <= pageCount && t.Right-t.Left >= TrimMin && t.Bottom-t.Top >= TrimMin
}

// Trims reports whether t trims anything (a whole-page frame doesn't).
func (t PageTrim) Trims() bool {
	return t.Left > 0 || t.Top > 0 || t.Right < 1 || t.Bottom < 1
}

// GetPageTrims lists pieceID's trimmed pages, by page. Never nil.
func GetPageTrims(ctx context.Context, q Queryer, pieceID int64) ([]PageTrim, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT page, trim_left, trim_top, trim_right, trim_bottom
		FROM piece_page_trims WHERE piece_id = ? ORDER BY page`, pieceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	trims := []PageTrim{}
	for rows.Next() {
		var t PageTrim
		if err := rows.Scan(&t.Page, &t.Left, &t.Top, &t.Right, &t.Bottom); err != nil {
			return nil, err
		}
		trims = append(trims, t)
	}
	return trims, rows.Err()
}

// SetPageTrims replaces pieceID's trims with these (none removes them
// all). A frame that trims nothing isn't kept.
func SetPageTrims(ctx context.Context, q Queryer, pieceID int64, trims []PageTrim) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM piece_page_trims WHERE piece_id = ?`, pieceID); err != nil {
		return err
	}
	for _, t := range trims {
		if !t.Trims() {
			continue
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO piece_page_trims (piece_id, page, trim_left, trim_top, trim_right, trim_bottom)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (piece_id, page) DO UPDATE SET
				trim_left = excluded.trim_left, trim_top = excluded.trim_top,
				trim_right = excluded.trim_right, trim_bottom = excluded.trim_bottom`,
			pieceID, t.Page, t.Left, t.Top, t.Right, t.Bottom); err != nil {
			return err
		}
	}
	return nil
}

// PageTrimsOff reports whether pieceID's trims are switched off by Piece
// Preparation's Reset (migration 00043): kept as Trim Margins' starting
// point, but the pages show untrimmed.
func PageTrimsOff(ctx context.Context, q Queryer, pieceID int64) (bool, error) {
	var off bool
	err := q.QueryRowContext(ctx, `SELECT page_trims_off FROM pieces WHERE id = ?`, pieceID).Scan(&off)
	return off, err
}

// SetPageTrimsOff switches pieceID's trims off (Reset) or back on.
func SetPageTrimsOff(ctx context.Context, q Queryer, pieceID int64, off bool) error {
	_, err := q.ExecContext(ctx, `UPDATE pieces SET page_trims_off = ? WHERE id = ?`, off, pieceID)
	return err
}
