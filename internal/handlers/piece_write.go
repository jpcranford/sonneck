package handlers

import (
	"context"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// applyPieceWriteRequest maps req's fields onto p and resolves its tag
// names to IDs (creating new tags as needed — Calibre-style pick-existing-
// or-type-new, design doc §5). It does not persist anything: callers still
// call repo.CreatePiece/UpdatePiece plus SetPieceInstruments/
// SetPieceUserTags themselves. This is the one shared mapping used by both
// the wizard's per-piece fill step and the standalone piece edit menu
// (CLAUDE.md > Book-level soft inheritance requires exactly this — one
// implementation, not two that can drift).
//
// req is a full-form submission (design doc §5, §15): every field in req
// replaces p's current value, including clearing it when nil/empty — not a
// sparse partial update.
func applyPieceWriteRequest(ctx context.Context, q repo.Queryer, p *models.Piece, req api.PieceWriteRequest) error {
	p.Title = req.Title
	p.Composer = req.Composer
	p.Arranger = req.Arranger
	p.Favorite = req.Favorite
	p.WorkOpusNumber = req.WorkOpusNumber
	p.Publisher = req.Publisher
	p.PublisherID = req.PublisherID
	p.YearWritten = req.YearWritten
	p.Description = req.Description
	p.UserNotes = req.UserNotes
	p.PracticeStatus = req.PracticeStatus
	p.ImslpNumber = req.ImslpNumber
	p.SourcePageStart = req.SourcePageStart
	p.SourcePageEnd = req.SourcePageEnd
	p.BPM = req.BPM
	p.MeasureCount = req.MeasureCount
	p.BeatsPerMeasure = req.BeatsPerMeasure
	p.Duration = computeDuration(req.BPM, req.MeasureCount, req.BeatsPerMeasure)

	keyID, err := resolveOptionalTagName(ctx, q, repo.FindOrCreateKey, req.KeyName, "keyName")
	if err != nil {
		return err
	}
	p.KeyID = keyID

	sheetTypeID, err := resolveOptionalTagName(ctx, q, repo.FindOrCreateSheetType, req.SheetTypeName, "sheetTypeName")
	if err != nil {
		return err
	}
	p.SheetTypeID = sheetTypeID

	instrumentIDs, err := resolveTagNames(ctx, q, repo.FindOrCreateInstrument, req.Instruments, "instruments")
	if err != nil {
		return err
	}
	p.InstrumentIDs = instrumentIDs

	userTagIDs, err := resolveTagNames(ctx, q, repo.FindOrCreateUserTag, req.UserTags, "userTags")
	if err != nil {
		return err
	}
	p.UserTagIDs = userTagIDs

	return nil
}

// computeDuration mirrors the frontend's computed field (design doc §3):
// (measureCount × beatsPerMeasure ÷ bpm) × 60, in seconds. The backend
// recomputes it too rather than trusting a client-sent value, since it's
// derived data and the backend remains the source of truth for anything
// persisted.
func computeDuration(bpm, measureCount, beatsPerMeasure *int) *int {
	if bpm == nil || measureCount == nil || beatsPerMeasure == nil || *bpm <= 0 {
		return nil
	}
	seconds := int(float64(*measureCount) * float64(*beatsPerMeasure) / float64(*bpm) * 60)
	return &seconds
}

type findOrCreateFunc func(ctx context.Context, q repo.Queryer, name string) (int64, error)

func resolveOptionalTagName(ctx context.Context, q repo.Queryer, findOrCreate findOrCreateFunc, name *string, field string) (*int64, error) {
	if name == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*name)
	if trimmed == "" {
		return nil, nil
	}
	if err := api.ValidateTagName(trimmed); err != nil {
		return nil, api.ValidationErrors{{Field: field, Message: err.Error()}}
	}
	id, err := findOrCreate(ctx, q, trimmed)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func resolveTagNames(ctx context.Context, q repo.Queryer, findOrCreate findOrCreateFunc, names []string, field string) ([]int64, error) {
	ids := make([]int64, 0, len(names))
	for _, name := range names {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		if err := api.ValidateTagName(trimmed); err != nil {
			return nil, api.ValidationErrors{{Field: field, Message: err.Error()}}
		}
		id, err := findOrCreate(ctx, q, trimmed)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}
