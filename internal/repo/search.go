package repo

import (
	"context"
	"errors"
	"strings"
)

// ResyncSearchIndex rebuilds pieces_fts's (and pieces_fts_trigram's — see
// migration 00019) single row for pieceID from current Piece/Book/tag data,
// resolving book-inheritable fields to their effective value
// (ResolveEffective) so search never misses a piece that only inherits a
// field from its book (CLAUDE.md > Search).
//
// Callers run this in the same transaction as the mutation that triggered
// it — a Piece create/update/delete, or a tag-assignment change. If the
// piece no longer exists (the delete case), this just removes its rows.
func ResyncSearchIndex(ctx context.Context, q Queryer, pieceID int64) error {
	// Delete-then-insert: both tables are derived data (design doc §3), so
	// there's no need to distinguish "row exists, update it" from "row
	// doesn't exist yet, insert it".
	if _, err := q.ExecContext(ctx, `DELETE FROM pieces_fts WHERE piece_id = ?`, pieceID); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `DELETE FROM pieces_fts_trigram WHERE piece_id = ?`, pieceID); err != nil {
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

	keyNames, err := namesByIDs(ctx, q, "musical_keys", p.KeyIDs)
	if err != nil {
		return err
	}

	// Composer/arranger are ordered lists now (migration 00020) — flattened
	// into pieces_fts the same way key names already are (space-joined),
	// via the effective (book-fallback-resolved) id list.
	composerNames, err := namesByIDs(ctx, q, "people", eff.Composer.IDs)
	if err != nil {
		return err
	}
	arrangerNames, err := namesByIDs(ctx, q, "people", eff.Arranger.IDs)
	if err != nil {
		return err
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

	// Book title has no "effective"/inherited concept of its own the way
	// composer/publisher/etc. do (a piece can't override its own source
	// book's title) — just the source book's own BookTitle, verbatim, or
	// empty for a book-less piece. Same lookup api.dto.go's own
	// SourceBookTitle response field already uses.
	var bookTitle string
	if p.SourceBookID != nil {
		book, err := GetBookByID(ctx, q, *p.SourceBookID)
		if err != nil {
			return err
		}
		bookTitle = book.BookTitle
	}

	// Both tables get the same row shape/values — pieces_fts_trigram exists
	// purely as a different tokenizer over identical content (migration
	// 00019's own comment), not a differently-scoped index.
	insertArgs := []any{
		p.ID, p.Title, strings.Join(composerNames, " "), strings.Join(arrangerNames, " "), eff.Publisher.Value, eff.PublisherID.Value,
		eff.ImslpNumber.Value, eff.YearWritten.Value, eff.WorkOpusNumber.Value, eff.Description.Value, strOrEmpty(p.UserNotes),
		strings.Join(keyNames, " "), sheetTypeName, strings.Join(instrumentNames, " "), strings.Join(userTagNames, " "), bookTitle,
	}
	const insertColumns = `
		piece_id, title, composer, arranger, publisher, publisher_id,
		imslp_number, year_written, work_opus_number, description, user_notes,
		key_name, sheet_type_name, instruments, user_tags, book_title
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	if _, err := q.ExecContext(ctx, `INSERT INTO pieces_fts (`+insertColumns, insertArgs...); err != nil {
		return err
	}
	_, err = q.ExecContext(ctx, `INSERT INTO pieces_fts_trigram (`+insertColumns, insertArgs...)
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
	if _, err := q.ExecContext(ctx, `DELETE FROM pieces_fts_trigram`); err != nil {
		return err
	}

	ids, err := AllPieceIDs(ctx, q)
	if err != nil {
		return err
	}

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
