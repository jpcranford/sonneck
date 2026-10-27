package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

// Annotations (migration 00035): one account's marks on a piece, page by
// page, as the Sheet Viewer draws them (frontend/src/lib/sheetViewerMarks.ts).
// Every position is a share of the page (x of its width, y of its height)
// and every size a percent of its width.

// AnnotationColors is how many annotation colors (layers) there are.
const AnnotationColors = 6

// Limits on what one page can hold, so a bad client can't store a runaway
// page: generous for real use.
const (
	maxMarksPerPage  = 5000
	maxStrokePoints  = 10000
	maxTextLength    = 2000
	maxMarkIDLength  = 64
	maxMarkSize      = 20.0
	coordinateMargin = 0.5 // a stroke may run a little off the page
)

// StrokeMark is a pen or highlighter stroke: points are [x, y, pressure].
type StrokeMark struct {
	ID       string       `json:"id"`
	Kind     string       `json:"kind"`
	Tool     string       `json:"tool"`
	Layer    int          `json:"layer"`
	Size     float64      `json:"size"`
	Points   [][3]float64 `json:"points"`
	Pressure bool         `json:"pressure"`
}

// TextMark is a text mark: y is its first line's baseline; text is Markdown
// with :shortcodes:.
type TextMark struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	Layer  int     `json:"layer"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Size   float64 `json:"size"`
	Text   string  `json:"text"`
	Italic bool    `json:"italic,omitempty"`
}

// ErrInvalidMarks wraps every problem NormalizeMarks finds, for a 400.
var ErrInvalidMarks = errors.New("invalid marks")

// rawMark is any mark as sent, before it's checked.
type rawMark struct {
	ID       string      `json:"id"`
	Kind     string      `json:"kind"`
	Tool     string      `json:"tool"`
	Layer    int         `json:"layer"`
	Size     float64     `json:"size"`
	Points   [][]float64 `json:"points"`
	Pressure bool        `json:"pressure"`
	X        *float64    `json:"x"`
	Y        *float64    `json:"y"`
	Text     *string     `json:"text"`
	Italic   bool        `json:"italic"`
}

// NormalizeMarks checks a page's marks as sent and returns them re-encoded
// with only the fields each kind has, so nothing unchecked is stored.
func NormalizeMarks(data json.RawMessage) (json.RawMessage, int, error) {
	var marks []rawMark
	if err := json.Unmarshal(data, &marks); err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrInvalidMarks, err)
	}
	if len(marks) > maxMarksPerPage {
		return nil, 0, fmt.Errorf("%w: more than %d marks on one page", ErrInvalidMarks, maxMarksPerPage)
	}
	bad := func(i int, why string) error { return fmt.Errorf("%w: mark %d: %s", ErrInvalidMarks, i, why) }
	ids := map[string]bool{}
	out := make([]any, 0, len(marks))
	for i, m := range marks {
		if m.ID == "" || len(m.ID) > maxMarkIDLength {
			return nil, 0, bad(i, "id must be 1 to 64 characters")
		}
		if ids[m.ID] {
			return nil, 0, bad(i, "repeats an id")
		}
		ids[m.ID] = true
		if m.Layer < 0 || m.Layer >= AnnotationColors {
			return nil, 0, bad(i, "unknown color")
		}
		if !finite(m.Size) || m.Size <= 0 || m.Size > maxMarkSize {
			return nil, 0, bad(i, "size out of range")
		}
		switch m.Kind {
		case "stroke":
			if m.Tool != "pen" && m.Tool != "highlighter" {
				return nil, 0, bad(i, "unknown tool")
			}
			if len(m.Points) == 0 || len(m.Points) > maxStrokePoints {
				return nil, 0, bad(i, "a stroke needs 1 to 10000 points")
			}
			points := make([][3]float64, len(m.Points))
			for j, p := range m.Points {
				if len(p) != 3 || !onPage(p[0]) || !onPage(p[1]) || !finite(p[2]) || p[2] < 0 || p[2] > 1 {
					return nil, 0, bad(i, fmt.Sprintf("point %d out of range", j))
				}
				points[j] = [3]float64{p[0], p[1], p[2]}
			}
			out = append(out, StrokeMark{
				ID: m.ID, Kind: "stroke", Tool: m.Tool, Layer: m.Layer, Size: m.Size,
				Points: points, Pressure: m.Pressure,
			})
		case "text":
			if m.X == nil || m.Y == nil || m.Text == nil || !onPage(*m.X) || !onPage(*m.Y) {
				return nil, 0, bad(i, "a text mark needs x, y and text on the page")
			}
			if *m.Text == "" || len(*m.Text) > maxTextLength {
				return nil, 0, bad(i, "text must be 1 to 2000 characters")
			}
			out = append(out, TextMark{
				ID: m.ID, Kind: "text", Layer: m.Layer, X: *m.X, Y: *m.Y, Size: m.Size,
				Text: *m.Text, Italic: m.Italic,
			})
		default:
			return nil, 0, bad(i, "unknown kind")
		}
	}
	encoded, err := json.Marshal(out)
	return encoded, len(out), err
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func onPage(v float64) bool {
	return finite(v) && v >= -coordinateMargin && v <= 1+coordinateMargin
}

// GetAnnotations loads userID's marks on pieceID, by page number. Pages
// without marks are left out.
func GetAnnotations(ctx context.Context, q Queryer, userID, pieceID int64) (map[int]json.RawMessage, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT page, marks FROM piece_annotations WHERE user_id = ? AND piece_id = ? ORDER BY page`,
		userID, pieceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	pages := map[int]json.RawMessage{}
	for rows.Next() {
		var page int
		var marks string
		if err := rows.Scan(&page, &marks); err != nil {
			return nil, err
		}
		pages[page] = json.RawMessage(marks)
	}
	return pages, rows.Err()
}

// SetPageAnnotations replaces userID's marks on one page of pieceID with
// already-normalized marks; none removes the page's row.
func SetPageAnnotations(ctx context.Context, q Queryer, userID, pieceID int64, page int, marks json.RawMessage, count int) error {
	if count == 0 {
		_, err := q.ExecContext(ctx,
			`DELETE FROM piece_annotations WHERE user_id = ? AND piece_id = ? AND page = ?`,
			userID, pieceID, page)
		return err
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO piece_annotations (user_id, piece_id, page, marks) VALUES (?, ?, ?, ?)
		ON CONFLICT (user_id, piece_id, page) DO UPDATE SET
			marks = excluded.marks, updated_at = CURRENT_TIMESTAMP`,
		userID, pieceID, page, string(marks))
	return err
}
