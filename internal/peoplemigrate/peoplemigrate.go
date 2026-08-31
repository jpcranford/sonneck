// Package peoplemigrate implements the one-shot `migrate-people` CLI
// subcommand (CLAUDE.md > Search's general admin/maintenance pattern —
// same posture as internal/export's own CSV dump: a subcommand on this
// binary, gated by shell/docker exec access, not an unauthenticated HTTP
// endpoint). It backfills the composer/arranger overhaul's new Person
// entity and ordered join tables (migration 00020) from every Piece/Book's
// still-present old composer/arranger TEXT columns — deliberately not
// dropped by that migration precisely so this backfill has something to
// read. See that migration's own comment and CLAUDE.md's "Open items"
// note for why the column drop is a separate, later migration, not part
// of this same change.
package peoplemigrate

import (
	"context"
	"database/sql"
	"regexp"
	"strings"

	"github.com/jpcranford/sonneck/internal/repo"
)

// oxfordCommaAndPattern/bareAndPattern/ampersandPattern together implement
// the locked migration-plan wording (memory
// project_people_composer_overhaul.md): split on "any combination of
// commas/'and'/ampersands (handling a trailing Oxford comma)". Order
// matters — the Oxford-comma pattern must run first, or a plain "and"
// replacement would leave a stray empty segment between two commas
// ("X, Y, and Z" → naively replacing " and " alone gives "X, Y, , Z").
var (
	oxfordCommaAndPattern = regexp.MustCompile(`(?i),\s*and\s+`)
	bareAndPattern        = regexp.MustCompile(`(?i)\s+and\s+`)
	ampersandPattern      = regexp.MustCompile(`\s*&\s*`)
)

// SplitNames splits a legacy composer/arranger string into individual
// names, in order. A single name with no separator at all (the common
// case) returns unchanged as a one-element slice — this deliberately does
// NOT split on a literal "and" or "&" embedded without surrounding
// whitespace (e.g. a hyphenated or compound name), and does not attempt to
// detect "Last, First" formatted single names (this app's own composer/
// arranger fields are always stored "First Last", per every real fixture
// across the whole project) — splitting "Anderson, John" into two people
// is a known, accepted limitation, not a case this app's real data
// actually produces.
func SplitNames(raw string) []string {
	s := oxfordCommaAndPattern.ReplaceAllString(raw, ", ")
	s = bareAndPattern.ReplaceAllString(s, ", ")
	s = ampersandPattern.ReplaceAllString(s, ", ")

	parts := strings.Split(s, ",")
	names := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			names = append(names, trimmed)
		}
	}
	return names
}

// Result reports what Run actually did, for the CLI subcommand's own log
// line.
type Result struct {
	PiecesMigrated int
	PiecesSkipped  int
	BooksMigrated  int
	BooksSkipped   int
}

// Run performs the full backfill. Idempotent — a piece/book that already
// has any composer or arranger credit (from a previous run of this same
// command, or because it was already edited through the new real UI
// before this ran) is left untouched and counted as skipped, so this is
// always safe to re-run. Runs outside any single transaction (each
// piece/book is its own small transaction via the repo layer's own
// Set*Composers/Arrangers calls against the plain *sql.DB) — a real
// library's full piece count is small enough that this isn't a
// performance concern, and it means an interrupted run leaves already-
// processed rows correctly migrated rather than rolling everything back.
func Run(ctx context.Context, db *sql.DB) (Result, error) {
	var result Result

	pieces, err := legacyPieceCredits(ctx, db)
	if err != nil {
		return result, err
	}
	for _, p := range pieces {
		migrated, err := migratePieceCredits(ctx, db, p)
		if err != nil {
			return result, err
		}
		if migrated {
			result.PiecesMigrated++
		} else {
			result.PiecesSkipped++
		}
	}

	books, err := legacyBookCredits(ctx, db)
	if err != nil {
		return result, err
	}
	for _, b := range books {
		migrated, err := migrateBookCredits(ctx, db, b)
		if err != nil {
			return result, err
		}
		if migrated {
			result.BooksMigrated++
		} else {
			result.BooksSkipped++
		}
	}

	return result, nil
}

type legacyCredit struct {
	id                 int64
	composer, arranger *string
}

func legacyPieceCredits(ctx context.Context, db *sql.DB) ([]legacyCredit, error) {
	return queryLegacyCredits(ctx, db, `SELECT id, composer, arranger FROM pieces`)
}

func legacyBookCredits(ctx context.Context, db *sql.DB) ([]legacyCredit, error) {
	return queryLegacyCredits(ctx, db, `SELECT id, composer, arranger FROM books`)
}

// queryLegacyCredits reads directly off the old composer/arranger TEXT
// columns — not through models.Piece/models.Book, which no longer have
// these fields at all (they moved to ComposerIDs/ArrangerIDs). This is the
// one place in the whole app still allowed to read them, since backfilling
// from them is this package's entire purpose.
func queryLegacyCredits(ctx context.Context, db *sql.DB, query string) ([]legacyCredit, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var credits []legacyCredit
	for rows.Next() {
		var c legacyCredit
		if err := rows.Scan(&c.id, &c.composer, &c.arranger); err != nil {
			return nil, err
		}
		credits = append(credits, c)
	}
	return credits, rows.Err()
}

func migratePieceCredits(ctx context.Context, db *sql.DB, legacy legacyCredit) (bool, error) {
	piece, err := repo.GetPieceByID(ctx, db, legacy.id)
	if err != nil {
		return false, err
	}
	if len(piece.ComposerIDs) > 0 || len(piece.ArrangerIDs) > 0 {
		return false, nil
	}

	composerIDs, err := resolvePersonIDs(ctx, db, legacy.composer)
	if err != nil {
		return false, err
	}
	if len(composerIDs) > 0 {
		if err := repo.SetPieceComposers(ctx, db, legacy.id, composerIDs); err != nil {
			return false, err
		}
	}

	arrangerIDs, err := resolvePersonIDs(ctx, db, legacy.arranger)
	if err != nil {
		return false, err
	}
	if len(arrangerIDs) > 0 {
		if err := repo.SetPieceArrangers(ctx, db, legacy.id, arrangerIDs); err != nil {
			return false, err
		}
	}

	if len(composerIDs) == 0 && len(arrangerIDs) == 0 {
		return false, nil
	}

	// A credit changed, so this piece's effective composer/arranger names
	// (and the book it may inherit blank fields into) need resyncing —
	// same rule any other credit-changing write follows.
	return true, repo.ResyncSearchIndex(ctx, db, legacy.id)
}

func migrateBookCredits(ctx context.Context, db *sql.DB, legacy legacyCredit) (bool, error) {
	book, err := repo.GetBookByID(ctx, db, legacy.id)
	if err != nil {
		return false, err
	}
	if len(book.ComposerIDs) > 0 || len(book.ArrangerIDs) > 0 {
		return false, nil
	}

	composerIDs, err := resolvePersonIDs(ctx, db, legacy.composer)
	if err != nil {
		return false, err
	}
	if len(composerIDs) > 0 {
		if err := repo.SetBookComposers(ctx, db, legacy.id, composerIDs); err != nil {
			return false, err
		}
	}

	arrangerIDs, err := resolvePersonIDs(ctx, db, legacy.arranger)
	if err != nil {
		return false, err
	}
	if len(arrangerIDs) > 0 {
		if err := repo.SetBookArrangers(ctx, db, legacy.id, arrangerIDs); err != nil {
			return false, err
		}
	}

	if len(composerIDs) == 0 && len(arrangerIDs) == 0 {
		return false, nil
	}

	// A book credit changed — fan the resync out to every piece that
	// inherits from it, same as any other book-field edit (design doc
	// §16).
	return true, repo.ResyncSearchIndexForBook(ctx, db, legacy.id)
}

// resolvePersonIDs splits raw (if non-blank) and find-or-creates a Person
// per name, in order — the same Calibre-style pattern every other tag-like
// field in this app already uses, reused here via the real
// repo.FindOrCreatePerson rather than a separate migration-only lookup.
func resolvePersonIDs(ctx context.Context, db *sql.DB, raw *string) ([]int64, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	names := SplitNames(*raw)
	ids := make([]int64, 0, len(names))
	for _, name := range names {
		id, err := repo.FindOrCreatePerson(ctx, db, name)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}
