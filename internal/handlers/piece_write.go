package handlers

import (
	"context"
	"errors"
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
	p.Favorite = req.Favorite
	p.WorkOpusNumber = req.WorkOpusNumber
	p.Publisher = req.Publisher
	p.PublisherID = req.PublisherID
	p.YearWritten = req.YearWritten
	p.Description = req.Description
	p.UserNotes = req.UserNotes
	p.PracticeStatus = req.PracticeStatus
	p.ImslpNumber = req.ImslpNumber

	// Must reference a real Book — checked explicitly here rather than
	// left for repo.ResolveEffective to discover later (inside
	// ValidatePiece), which would surface a bad id as an opaque
	// infrastructure error instead of a clean field-level validation
	// message. nil is a legitimate value (design doc §3: Book is entirely
	// optional) and clears the association, same full-replace rule as
	// every other field here — it's only a non-nil-but-wrong id that's
	// rejected.
	if req.SourceBookID != nil {
		if _, err := repo.GetBookByID(ctx, q, *req.SourceBookID); err != nil {
			if errors.Is(err, repo.ErrNotFound) {
				return api.ValidationErrors{{Field: "sourceBookId", Message: "book not found"}}
			}
			return err
		}
	}
	p.SourceBookID = req.SourceBookID
	p.SourcePageStart = req.SourcePageStart
	p.SourcePageEnd = req.SourcePageEnd
	p.BPM = req.BPM
	p.MeasureCount = req.MeasureCount
	p.BeatsPerMeasure = req.BeatsPerMeasure
	// Duration is written directly from the request, not recomputed from
	// BPM/MeasureCount/BeatsPerMeasure — a deliberate deviation from design
	// doc §3, see CLAUDE.md > Frontend > Computed fields for the reasoning.
	p.Duration = req.Duration

	// Public Domain Badge feature (migration 00022) — full-replace, same
	// as every other field above.
	p.CopyrightYear = req.CopyrightYear
	p.CopyrightHolder = req.CopyrightHolder
	p.CopyrightSlug = req.CopyrightSlug
	p.CopyrightStatus = req.CopyrightStatus

	keyIDs, err := resolveTagNames(ctx, q, repo.FindOrCreateKey, req.Keys, "keys")
	if err != nil {
		return err
	}
	p.KeyIDs = keyIDs

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

	// Composers/Arrangers (composer/arranger overhaul, migration 00020) —
	// same ordered, full-replace-by-name resolution as Keys/Instruments/
	// UserTags above.
	composerIDs, err := resolveTagNames(ctx, q, repo.FindOrCreatePerson, req.Composers, "composers")
	if err != nil {
		return err
	}
	p.ComposerIDs = composerIDs

	arrangerIDs, err := resolveTagNames(ctx, q, repo.FindOrCreatePerson, req.Arrangers, "arrangers")
	if err != nil {
		return err
	}
	p.ArrangerIDs = arrangerIDs

	return nil
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
