package repo

import (
	"context"
	"errors"
	"strings"
)

// NormalizeAmpersand canonicalizes "&" to "and" so search treats the two as
// equivalent in both directions — a real publisher/composer name like
// "Boosey & Hawkes" or "Rodgers & Hammerstein" is findable by a query typed
// as "and", and a query typed with "&" finds data stored with "and". FTS5's
// tokenizer already drops a bare "&" as a plain word separator with no
// token of its own, so without this an ampersand on either side of the
// comparison just silently fails to line up with the real word "and" on the
// other side. internal/handlers/search.go's sanitizeFTSQuery/
// sanitizeTrigramFTSQuery apply this identical normalization to the
// incoming search query — see ResyncSearchIndex below for the indexed-data
// side. Padded with spaces (not a bare ReplaceAll) so a no-space case
// ("Dungeons&Dragons") still tokenizes into separate words instead of
// merging into one run-together token; any resulting doubled whitespace is
// harmless, since both the FTS5 tokenizer and the query-side strings.Fields
// treat any whitespace run as one separator.
func NormalizeAmpersand(s string) string {
	return strings.ReplaceAll(s, "&", " and ")
}

// NormalizeAmpersandForLike is NormalizeAmpersand's counterpart for a plain
// SQL LIKE search (Book/People search — internal/handlers/book.go,
// people.go, facets.go's bookTextMatchClause — none of which use FTS5, per
// CLAUDE.md > Search's own note that Books search has always been plain
// LIKE) — a bare replace with no padding, unlike NormalizeAmpersand's
// space-padded version above. LIKE does literal substring matching, so
// both sides of the comparison need to land on identical spacing: a real
// name almost always already has a space on each side of a standalone "&"
// ("Boosey & Hawkes"), and a bare replace preserves that spacing exactly,
// producing the same single-spaced "and" a normally-typed query already
// has. Padding with extra spaces here (the way the FTS-index version needs
// to, so "Dungeons&Dragons" tokenizes into two words instead of merging)
// would instead double an already-single space and silently break the
// match. Callers apply this to both the query text and the compared SQL
// column (via a SQL-level REPLACE(col, '&', 'and')) so it works in both
// directions.
func NormalizeAmpersandForLike(s string) string {
	return strings.ReplaceAll(s, "&", "and")
}

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
	//
	// Free-text fields (title/composer/arranger/publisher/description/
	// user_notes/instruments/user_tags/book_title) go through
	// NormalizeAmpersand so a real name like "Boosey & Hawkes" or "Rodgers &
	// Hammerstein" is findable by "and" too, and vice versa (see that
	// function's own doc comment) — sanitizeFTSQuery/sanitizeTrigramFTSQuery
	// (internal/handlers/search.go) apply the identical normalization to the
	// incoming query, so both sides land on the same canonical text.
	// Identifier/fixed-vocabulary fields (publisher_id, imslp_number,
	// year_written, work_opus_number, key_name, sheet_type_name) are left
	// alone — an ampersand there, if it ever occurred, isn't standing in for
	// "and".
	insertArgs := []any{
		p.ID, NormalizeAmpersand(p.Title), NormalizeAmpersand(strings.Join(composerNames, " ")), NormalizeAmpersand(strings.Join(arrangerNames, " ")),
		NormalizeAmpersand(eff.Publisher.Value), eff.PublisherID.Value,
		eff.ImslpNumber.Value, eff.YearWritten.Value, eff.WorkOpusNumber.Value, NormalizeAmpersand(eff.Description.Value), NormalizeAmpersand(strOrEmpty(p.UserNotes)),
		strings.Join(keyNames, " "), sheetTypeName, NormalizeAmpersand(strings.Join(instrumentNames, " ")), NormalizeAmpersand(strings.Join(userTagNames, " ")), NormalizeAmpersand(bookTitle),
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

// SearchIndexNeedsRebuild reports whether pieces_fts is missing rows for
// real pieces that exist — a cheap two-COUNT comparison, mirroring
// peoplemigrate.Pending's own "one query, run on every boot" posture. This
// is the guard behind main.go's automatic rebuild-on-startup: a plain
// row-count mismatch is what a migration that does `DROP TABLE pieces_fts`
// on an already-populated table (e.g. migration 00021, changing its
// column list) actually produces if the required manual `rebuild-search-
// index` step never runs afterward — the DROP destroys every existing
// row, and nothing else in this app's own write paths ever repopulates a
// piece's row except a real mutation to that specific piece (see
// ResyncSearchIndex's own doc comment), so a stale/empty index otherwise
// persists silently forever. Confirmed to actually happen, not just a
// theoretical risk: reproduced live against a real dev database that had
// gone through exactly this upgrade path — search returned zero results
// for a query matching an existing piece's own title, even though the
// piece itself was still fully present in the library.
func SearchIndexNeedsRebuild(ctx context.Context, q Queryer) (bool, error) {
	var mismatch bool
	err := q.QueryRowContext(ctx,
		`SELECT (SELECT COUNT(*) FROM pieces) != (SELECT COUNT(*) FROM pieces_fts)`,
	).Scan(&mismatch)
	return mismatch, err
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
