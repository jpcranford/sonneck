package api

import (
	"context"
	"strings"
	"time"

	"github.com/jpcranford/sonneck/internal/repo"
)

// SetlistPieceSummary is the lean per-entry piece shape design doc §13's
// API surface calls for ("title, effective composer/arranger, key(s),
// duration, pageCount") — deliberately narrower than the full
// PieceResponse (no copyright/publisher/IMSLP/etc, none of which a
// setlist row shows). Composer/Arranger still go through
// repo.ResolveEffective (CLAUDE.md > Book-level soft inheritance's "one
// shared resolver, never read a book-inheritable column directly") —
// Title/Duration/PageCount/Keys are all plain, non-book-inheritable
// fields (CLAUDE.md's own Computed fields deviation for Duration; Key is
// explicitly never book-inheritable either), so those are read straight
// off the piece/entry row with no resolver needed.
type SetlistPieceSummary struct {
	ID        int64      `json:"id"`
	Title     string     `json:"title"`
	Composer  []repo.Tag `json:"composer"`
	Arranger  []repo.Tag `json:"arranger"`
	Keys      []repo.Tag `json:"keys"`
	Duration  *int       `json:"duration"`
	PageCount int        `json:"pageCount"`
}

// SetlistEntryResponse is one row of GetSetlist's own ordered "entries"
// array. Kind disambiguates piece/custom for a frontend that doesn't want
// to infer it from which optional fields are present. DisplayNumber is
// computed fresh on every read (decision 8) — nil for a non-counting
// entry (the common custom-entry case), never a stored/editable field.
type SetlistEntryResponse struct {
	ID                    int64                `json:"id"`
	Kind                  string               `json:"kind"`
	Piece                 *SetlistPieceSummary `json:"piece,omitempty"`
	CustomName            *string              `json:"customName,omitempty"`
	CustomDurationSeconds *int                 `json:"customDurationSeconds,omitempty"`
	CustomNotes           *string              `json:"customNotes,omitempty"`
	CustomCountsAsMusic   bool                 `json:"customCountsAsMusic"`
	Role                  *string              `json:"role"`
	DisplayNumber         *int                 `json:"displayNumber"`
}

// SetlistSummaryResponse is the shape GET /api/setlists returns per row
// (Frontend surfaces item 1: name, gig date, entry/duration/page
// summary) — every total is computed at read time, never stored (design
// doc §13), same posture as EffectiveArchived itself.
type SetlistSummaryResponse struct {
	ID                   int64     `json:"id"`
	Name                 string    `json:"name"`
	GigDate              *string   `json:"gigDate"`
	Archived             bool      `json:"archived"`
	EffectiveArchived    bool      `json:"effectiveArchived"`
	EntryCount           int       `json:"entryCount"`
	TotalDurationSeconds *int      `json:"totalDurationSeconds"`
	TotalPages           int       `json:"totalPages"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

// SetlistResponse is GET /api/setlists/{id}'s full detail — the summary
// shape plus Description and the ordered Entries themselves.
type SetlistResponse struct {
	SetlistSummaryResponse
	Description *string                `json:"description"`
	Entries     []SetlistEntryResponse `json:"entries"`
}

// setlistTotals computes entryCount/totalDurationSeconds/totalPages from
// an already-loaded entry list — shared by BuildSetlistSummaryResponse and
// BuildSetlistResponse so the two can never disagree about a setlist's own
// totals. totalDurationSeconds is nil (omitted, decision 20) specifically
// when NOT ONE entry anywhere has a set duration — otherwise it's the sum
// of whichever entries do, the entries missing one simply not contributing
// (an approximate total, per the "Approx. Duration" label, not a blocked
// one).
func setlistTotals(entries []repo.SetlistEntry) (entryCount int, totalDurationSeconds *int, totalPages int) {
	entryCount = len(entries)
	haveDuration := false
	sumDuration := 0
	for _, e := range entries {
		if e.PieceID != nil {
			if e.PiecePageCount != nil {
				totalPages += *e.PiecePageCount
			}
			if e.PieceDuration != nil {
				haveDuration = true
				sumDuration += *e.PieceDuration
			}
		} else if e.CustomDurationSeconds != nil {
			haveDuration = true
			sumDuration += *e.CustomDurationSeconds
		}
	}
	if haveDuration {
		totalDurationSeconds = &sumDuration
	}
	return entryCount, totalDurationSeconds, totalPages
}

// BuildSetlistSummaryResponse builds one GET /api/setlists row — loads
// s's own entries just far enough to compute totals (repo.SetlistEntry
// already carries the joined-in piece duration/page_count, so no further
// per-piece query is needed here).
func BuildSetlistSummaryResponse(ctx context.Context, q repo.Queryer, s *repo.Setlist) (*SetlistSummaryResponse, error) {
	entries, err := repo.ListSetlistEntries(ctx, q, s.ID)
	if err != nil {
		return nil, err
	}
	entryCount, totalDurationSeconds, totalPages := setlistTotals(entries)
	today := time.Now().Format("2006-01-02")
	return &SetlistSummaryResponse{
		ID:                   s.ID,
		Name:                 s.Name,
		GigDate:              s.GigDate,
		Archived:             s.Archived,
		EffectiveArchived:    s.EffectiveArchived(today),
		EntryCount:           entryCount,
		TotalDurationSeconds: totalDurationSeconds,
		TotalPages:           totalPages,
		CreatedAt:            s.CreatedAt,
		UpdatedAt:            s.UpdatedAt,
	}, nil
}

// BuildSetlistResponse builds GET /api/setlists/{id}'s full detail,
// resolving each piece entry's own summary and computing every entry's
// displayNumber (decision 8: a running counter over "counts as music"
// entries only, in program order — never stored).
func BuildSetlistResponse(ctx context.Context, q repo.Queryer, s *repo.Setlist) (*SetlistResponse, error) {
	entries, err := repo.ListSetlistEntries(ctx, q, s.ID)
	if err != nil {
		return nil, err
	}
	entryCount, totalDurationSeconds, totalPages := setlistTotals(entries)
	today := time.Now().Format("2006-01-02")

	respEntries := make([]SetlistEntryResponse, 0, len(entries))
	counter := 0
	for _, e := range entries {
		resp := SetlistEntryResponse{
			ID:                    e.ID,
			CustomDurationSeconds: e.CustomDurationSeconds,
			CustomNotes:           e.CustomNotes,
			CustomCountsAsMusic:   e.CustomCountsAsMusic,
			Role:                  e.Role,
		}
		if e.CountsAsMusic() {
			counter++
			n := counter
			resp.DisplayNumber = &n
		}
		if e.PieceID != nil {
			resp.Kind = "piece"
			summary, err := buildSetlistPieceSummary(ctx, q, *e.PieceID)
			if err != nil {
				return nil, err
			}
			resp.Piece = summary
		} else {
			resp.Kind = "custom"
			resp.CustomName = e.CustomName
		}
		respEntries = append(respEntries, resp)
	}

	return &SetlistResponse{
		SetlistSummaryResponse: SetlistSummaryResponse{
			ID:                   s.ID,
			Name:                 s.Name,
			GigDate:              s.GigDate,
			Archived:             s.Archived,
			EffectiveArchived:    s.EffectiveArchived(today),
			EntryCount:           entryCount,
			TotalDurationSeconds: totalDurationSeconds,
			TotalPages:           totalPages,
			CreatedAt:            s.CreatedAt,
			UpdatedAt:            s.UpdatedAt,
		},
		Description: s.Description,
		Entries:     respEntries,
	}, nil
}

// buildSetlistPieceSummary resolves pieceID's own lean setlist-row shape.
// Composer/Arranger go through repo.ResolveEffective (the one shared
// resolver); Keys/Duration/PageCount are read directly off the piece,
// which is correct (not a shortcut) since none of the three is
// book-inheritable.
func buildSetlistPieceSummary(ctx context.Context, q repo.Queryer, pieceID int64) (*SetlistPieceSummary, error) {
	p, err := repo.GetPieceByID(ctx, q, pieceID)
	if err != nil {
		return nil, err
	}
	eff, err := repo.ResolveEffective(ctx, q, p)
	if err != nil {
		return nil, err
	}

	summary := &SetlistPieceSummary{
		ID:        p.ID,
		Title:     p.Title,
		Composer:  []repo.Tag{},
		Arranger:  []repo.Tag{},
		Keys:      []repo.Tag{},
		Duration:  p.Duration,
		PageCount: p.PageCount,
	}
	if len(eff.Composer.IDs) > 0 {
		people, err := repo.PeopleByIDs(ctx, q, eff.Composer.IDs)
		if err != nil {
			return nil, err
		}
		summary.Composer = people
	}
	if len(eff.Arranger.IDs) > 0 {
		people, err := repo.PeopleByIDs(ctx, q, eff.Arranger.IDs)
		if err != nil {
			return nil, err
		}
		summary.Arranger = people
	}
	if len(p.KeyIDs) > 0 {
		keys, err := repo.KeysByIDs(ctx, q, p.KeyIDs)
		if err != nil {
			return nil, err
		}
		summary.Keys = keys
	}
	return summary, nil
}

// ValidateSetlistName is Setlist's one required field — same "an empty
// name is a confusing empty state everywhere it's displayed" reasoning
// ValidateBook's own bookTitle check already uses.
func ValidateSetlistName(name string) ValidationErrors {
	if strings.TrimSpace(name) == "" {
		return ValidationErrors{{Field: "name", Message: "is required"}}
	}
	return nil
}

// SetlistEntryInput is the request shape for POST /api/setlists/{id}/entries
// — either PieceID or CustomName must be set, matching the migration's own
// XOR CHECK constraint; ValidateSetlistEntryInput enforces that before it
// ever reaches the repo layer, so a caller never actually trips the raw
// CHECK constraint as an opaque 500.
type SetlistEntryInput struct {
	PieceID               *int64  `json:"pieceId"`
	CustomName            *string `json:"customName"`
	CustomDurationSeconds *int    `json:"customDurationSeconds"`
	CustomNotes           *string `json:"customNotes"`
	CustomCountsAsMusic   bool    `json:"customCountsAsMusic"`
	Role                  *string `json:"role"`
}

// ValidateSetlistEntryInput enforces the exactly-one-of-pieceId/customName
// rule and rejects a blank custom name.
func ValidateSetlistEntryInput(in SetlistEntryInput) ValidationErrors {
	havePiece := in.PieceID != nil
	haveCustom := in.CustomName != nil && strings.TrimSpace(*in.CustomName) != ""
	if havePiece == haveCustom {
		return ValidationErrors{{Field: "pieceId", Message: "exactly one of pieceId or customName is required"}}
	}
	return nil
}
