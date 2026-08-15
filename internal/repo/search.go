package repo

import (
	"context"
	"errors"
	"strings"
)

// ResyncSearchIndex rebuilds pieces_fts's single row for pieceID from
// current Piece/Book/tag data, resolving book-inheritable fields to their
// effective value (ResolveEffective) so search never misses a piece that
// only inherits a field from its book (CLAUDE.md > Search).
//
// Callers run this in the same transaction as the mutation that triggered
// it — a Piece create/update/delete, or a tag-assignment change. If the
// piece no longer exists (the delete case), this just removes its row.
func ResyncSearchIndex(ctx context.Context, q Queryer, pieceID int64) error {
	// Delete-then-insert: pieces_fts is derived data (design doc §3), so
	// there's no need to distinguish "row exists, update it" from "row
	// doesn't exist yet, insert it".
	if _, err := q.ExecContext(ctx, `DELETE FROM pieces_fts WHERE piece_id = ?`, pieceID); err != nil {
		return err
	}

	p, err := GetPieceByID(ctx, q, pieceID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	eff, err := ResolveEffective(ctx, q, p)
	if err != nil {
		return err
	}

	var keyName string
	if p.KeyID != nil {
		k, err := GetKeyByID(ctx, q, *p.KeyID)
		if err != nil {
			return err
		}
		keyName = k.Name
	}

	var sheetTypeName string
	if eff.SheetTypeID.Value != nil {
		st, err := GetSheetTypeByID(ctx, q, *eff.SheetTypeID.Value)
		if err != nil {
			return err
		}
		sheetTypeName = st.Name
	}

	instrumentNames, err := namesByIDs(ctx, q, "instruments", eff.InstrumentIDs.IDs)
	if err != nil {
		return err
	}
	userTagNames, err := namesByIDs(ctx, q, "user_tags", p.UserTagIDs)
	if err != nil {
		return err
	}

	_, err = q.ExecContext(ctx, `
		INSERT INTO pieces_fts (
			piece_id, title, composer, arranger, publisher, publisher_id,
			imslp_number, year_written, work_opus_number, description, user_notes,
			key_name, sheet_type_name, instruments, user_tags
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Title, eff.Composer.Value, strOrEmpty(p.Arranger), eff.Publisher.Value, eff.PublisherID.Value,
		eff.ImslpNumber.Value, eff.YearWritten.Value, eff.WorkOpusNumber.Value, eff.Description.Value, strOrEmpty(p.UserNotes),
		keyName, sheetTypeName, strings.Join(instrumentNames, " "), strings.Join(userTagNames, " "),
	)
	return err
}

// ResyncSearchIndexForBook resyncs every piece belonging to bookID — needed
// after a Book edit (design doc §16), since any number of pieces may
// display/index that field's new effective value. Re-resolving is a no-op
// for pieces with their own override on the changed field, so this doesn't
// need to first figure out which pieces actually lack one.
func ResyncSearchIndexForBook(ctx context.Context, q Queryer, bookID int64) error {
	pieceIDs, err := PieceIDsForBook(ctx, q, bookID)
	if err != nil {
		return err
	}
	for _, id := range pieceIDs {
		if err := ResyncSearchIndex(ctx, q, id); err != nil {
			return err
		}
	}
	return nil
}

// RebuildSearchIndex drops and repopulates pieces_fts from scratch — the
// manual full-rebuild capability behind the CLI subcommand described in
// CLAUDE.md > Search (`./main rebuild-search-index`).
func RebuildSearchIndex(ctx context.Context, q Queryer) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM pieces_fts`); err != nil {
		return err
	}

	rows, err := q.QueryContext(ctx, `SELECT id FROM pieces ORDER BY id`)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()

	for _, id := range ids {
		if err := ResyncSearchIndex(ctx, q, id); err != nil {
			return err
		}
	}
	return nil
}

func strOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
