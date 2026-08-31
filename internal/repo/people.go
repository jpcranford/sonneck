package repo

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jpcranford/sonneck/internal/models"
)

func CreatePerson(ctx context.Context, q Queryer, p *models.Person) (int64, error) {
	res, err := q.ExecContext(ctx, `
		INSERT INTO people (name, bio, birth_year, death_year, portrait_image_hash, portrait_image_content_type)
		VALUES (?, ?, ?, ?, ?, ?)`,
		p.Name, p.Bio, p.BirthYear, p.DeathYear, p.PortraitImageHash, p.PortraitImageContentType,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func GetPersonByID(ctx context.Context, q Queryer, id int64) (*models.Person, error) {
	p := &models.Person{}
	err := q.QueryRowContext(ctx, `
		SELECT id, name, bio, birth_year, death_year, portrait_image_hash, portrait_image_content_type, created_at
		FROM people WHERE id = ?`, id,
	).Scan(&p.ID, &p.Name, &p.Bio, &p.BirthYear, &p.DeathYear, &p.PortraitImageHash, &p.PortraitImageContentType, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

// UpdatePerson writes Name/Bio/BirthYear/DeathYear (the Edit Person modal's
// own field set) — portrait image assignment is a separate small action,
// same "dedicated endpoint, not the general write path" treatment as
// Book's UpdateBookCoverImage.
func UpdatePerson(ctx context.Context, q Queryer, p *models.Person) error {
	_, err := q.ExecContext(ctx,
		`UPDATE people SET name = ?, bio = ?, birth_year = ?, death_year = ? WHERE id = ?`,
		p.Name, p.Bio, p.BirthYear, p.DeathYear, p.ID,
	)
	return err
}

// UpdatePersonPortraitImage mirrors UpdateBookCoverImage exactly — both nil
// clears the custom portrait, reverting to the frontend's placeholder.
func UpdatePersonPortraitImage(ctx context.Context, q Queryer, personID int64, hash, contentType *string) error {
	_, err := q.ExecContext(ctx,
		`UPDATE people SET portrait_image_hash = ?, portrait_image_content_type = ? WHERE id = ?`,
		hash, contentType, personID,
	)
	return err
}

// DeletePerson removes only the person row. Their own credits (join-table
// rows) cascade via ON DELETE CASCADE — used by the People Library's
// direct "Delete Person" action, distinct from Split People (SplitPerson
// below), which deliberately leaves the row in place with zero credits.
func DeletePerson(ctx context.Context, q Queryer, id int64) error {
	_, err := q.ExecContext(ctx, `DELETE FROM people WHERE id = ?`, id)
	return err
}

// CountPeopleWithPortraitImageHash mirrors CountBooksWithCoverImageHash —
// portrait images are content-addressed (storage.PortraitImagePath), so
// two different people legitimately sharing the identical portrait file
// is possible, and the file must only be removed from disk once nothing
// references it anymore.
func CountPeopleWithPortraitImageHash(ctx context.Context, q Queryer, hash string) (int, error) {
	var count int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM people WHERE portrait_image_hash = ?`, hash).Scan(&count)
	return count, err
}

// CountPiecesForPerson counts pieces crediting personID as either composer
// or arranger, *effective* — a piece's own direct credit, or (when the
// piece has no composer/arranger of its own at all) its source book's
// credit, the same book-level inheritance every other composer/arranger
// read in this app resolves through (CLAUDE.md > Book-level soft
// inheritance). This is the People Library's pieceCount, the "Show all
// composers" default (>2 pieces) filter's underlying value, and Person
// Details' "Saving will update N works" footer text — all three need the
// same effective count Person Details' own works list (handleSearchPieces'
// personId filter) already uses, or they'd undercount a person who's only
// ever credited through a book.
//
// Composer and Arranger fall back to the book independently (a piece can
// override one and inherit the other), so this checks all four
// combinations separately, mirroring handleSearchPieces' personId filter
// exactly rather than inventing a different shape for the same rule.
func CountPiecesForPerson(ctx context.Context, q Queryer, personID int64) (int, error) {
	var count int
	err := q.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pieces p WHERE (
			p.id IN (SELECT piece_id FROM piece_composers WHERE person_id = ?)
			OR (p.id NOT IN (SELECT piece_id FROM piece_composers)
				AND p.source_book_id IN (SELECT book_id FROM book_composers WHERE person_id = ?))
			OR p.id IN (SELECT piece_id FROM piece_arrangers WHERE person_id = ?)
			OR (p.id NOT IN (SELECT piece_id FROM piece_arrangers)
				AND p.source_book_id IN (SELECT book_id FROM book_arrangers WHERE person_id = ?))
		)`, personID, personID, personID, personID,
	).Scan(&count)
	return count, err
}

// FindOrCreatePerson is the same Calibre-style "pick existing or type a
// new one" pattern as Key/Instrument/SheetType/UserTag (design doc §5) —
// reuses findOrCreateTag directly (tags.go) since `people` still has an
// `id`/`name` shape that function's plain SELECT-then-INSERT works against
// unchanged; the extra bio/birthYear/deathYear/portrait columns simply
// default to NULL on a find-or-create insert, same as any other optional
// field left unset.
func FindOrCreatePerson(ctx context.Context, q Queryer, name string) (int64, error) {
	return findOrCreateTag(ctx, q, "people", name)
}

// PeopleByIDs is TagsByIDs specialized to `people`, preserving the exact
// order of ids — mirrors KeysByIDs (tags.go) exactly, for the same reason:
// a piece/book's composer/arranger credit order is meaningful (the
// composer/arranger overhaul's whole point), so `WHERE id IN (...)`'s lack
// of argument-order guarantee has to be corrected in Go, the same way
// KeysByIDs already does for a piece's key sequence.
func PeopleByIDs(ctx context.Context, q Queryer, ids []int64) ([]Tag, error) {
	unordered, err := tagsByIDsOrdered(ctx, q, "people", ids, "")
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]Tag, len(unordered))
	for _, t := range unordered {
		byID[t.ID] = t
	}
	tags := make([]Tag, 0, len(ids))
	for _, id := range ids {
		if t, ok := byID[id]; ok {
			tags = append(tags, t)
		}
	}
	return tags, nil
}

// SetPieceComposers/SetPieceArrangers/SetBookComposers/SetBookArrangers
// replace the full ordered credit list on a piece/book — same delete-all-
// then-reinsert-0..n-1 pattern as SetPieceKeys (tags.go), since credit
// order is meaningful the same way a piece's key sequence is.
func SetPieceComposers(ctx context.Context, q Queryer, pieceID int64, personIDs []int64) error {
	return setOrderedPersonRows(ctx, q, "piece_composers", "piece_id", pieceID, personIDs)
}

func SetPieceArrangers(ctx context.Context, q Queryer, pieceID int64, personIDs []int64) error {
	return setOrderedPersonRows(ctx, q, "piece_arrangers", "piece_id", pieceID, personIDs)
}

func SetBookComposers(ctx context.Context, q Queryer, bookID int64, personIDs []int64) error {
	return setOrderedPersonRows(ctx, q, "book_composers", "book_id", bookID, personIDs)
}

func SetBookArrangers(ctx context.Context, q Queryer, bookID int64, personIDs []int64) error {
	return setOrderedPersonRows(ctx, q, "book_arrangers", "book_id", bookID, personIDs)
}

func setOrderedPersonRows(ctx context.Context, q Queryer, table, ownerCol string, ownerID int64, personIDs []int64) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM `+table+` WHERE `+ownerCol+` = ?`, ownerID); err != nil {
		return err
	}
	for position, personID := range personIDs {
		if _, err := q.ExecContext(ctx,
			`INSERT INTO `+table+` (`+ownerCol+`, person_id, position) VALUES (?, ?, ?)`,
			ownerID, personID, position,
		); err != nil {
			return err
		}
	}
	return nil
}

func getPieceComposerIDs(ctx context.Context, q Queryer, pieceID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT person_id FROM piece_composers WHERE piece_id = ? ORDER BY position`, pieceID)
}

func getPieceArrangerIDs(ctx context.Context, q Queryer, pieceID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT person_id FROM piece_arrangers WHERE piece_id = ? ORDER BY position`, pieceID)
}

func getBookComposerIDs(ctx context.Context, q Queryer, bookID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT person_id FROM book_composers WHERE book_id = ? ORDER BY position`, bookID)
}

func getBookArrangerIDs(ctx context.Context, q Queryer, bookID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT person_id FROM book_arrangers WHERE book_id = ? ORDER BY position`, bookID)
}

// SplitPerson reassigns every one of personID's credits (as composer or
// arranger, on any piece or book) to replacementIDs, spliced in at the
// exact position personID held — a piece/book crediting [A, personID, B]
// becomes [A, replacement1, replacement2, B], not appended at the end.
// personID's own row is deliberately NOT deleted (matches the already-
// approved Person Details mockup's own stated behavior: "isn't deleted —
// they're just left with zero credits afterward").
//
// Reuses the tested Set*/get* functions above rather than hand-rolling
// position-shifting SQL: since position isn't part of any table's PRIMARY
// KEY (piece_id, person_id), there's no repeat-value collision risk the
// way piece_keys' migration 00012 had to solve for — a plain splice-and-
// rewrite of each affected owner's full ordered list is both correct and
// simple.
//
// Returns every piece id whose effective composer/arranger list could have
// changed as a result (directly credited, or via a book whose credits it
// inherits) — callers must resync the search index for each one, in the
// same transaction, same as any other credit-changing write.
func SplitPerson(ctx context.Context, q Queryer, personID int64, replacementIDs []int64) ([]int64, error) {
	affected := map[int64]bool{}

	pieceComposerOwners, err := splicePersonCredits(ctx, q, "piece_composers", "piece_id", personID, replacementIDs, getPieceComposerIDs, SetPieceComposers)
	if err != nil {
		return nil, err
	}
	for _, id := range pieceComposerOwners {
		affected[id] = true
	}

	pieceArrangerOwners, err := splicePersonCredits(ctx, q, "piece_arrangers", "piece_id", personID, replacementIDs, getPieceArrangerIDs, SetPieceArrangers)
	if err != nil {
		return nil, err
	}
	for _, id := range pieceArrangerOwners {
		affected[id] = true
	}

	bookComposerOwners, err := splicePersonCredits(ctx, q, "book_composers", "book_id", personID, replacementIDs, getBookComposerIDs, SetBookComposers)
	if err != nil {
		return nil, err
	}
	bookArrangerOwners, err := splicePersonCredits(ctx, q, "book_arrangers", "book_id", personID, replacementIDs, getBookArrangerIDs, SetBookArrangers)
	if err != nil {
		return nil, err
	}
	for _, bookID := range append(bookComposerOwners, bookArrangerOwners...) {
		pieceIDs, err := PieceIDsForBook(ctx, q, bookID)
		if err != nil {
			return nil, err
		}
		for _, id := range pieceIDs {
			affected[id] = true
		}
	}

	result := make([]int64, 0, len(affected))
	for id := range affected {
		result = append(result, id)
	}
	return result, nil
}

// AffectedPieceIDsForPerson returns every piece whose effective composer or
// arranger could include personID — pieces crediting them directly, plus
// every piece under a book that credits them directly. Used before a
// destructive change to personID's own credits (delete, split) so the
// caller knows which pieces' pieces_fts rows need resyncing afterward.
func AffectedPieceIDsForPerson(ctx context.Context, q Queryer, personID int64) ([]int64, error) {
	affected := map[int64]bool{}

	directComposerPieces, err := getJoinedIDs(ctx, q, `SELECT DISTINCT piece_id FROM piece_composers WHERE person_id = ?`, personID)
	if err != nil {
		return nil, err
	}
	for _, id := range directComposerPieces {
		affected[id] = true
	}
	directArrangerPieces, err := getJoinedIDs(ctx, q, `SELECT DISTINCT piece_id FROM piece_arrangers WHERE person_id = ?`, personID)
	if err != nil {
		return nil, err
	}
	for _, id := range directArrangerPieces {
		affected[id] = true
	}

	composerBooks, err := getJoinedIDs(ctx, q, `SELECT DISTINCT book_id FROM book_composers WHERE person_id = ?`, personID)
	if err != nil {
		return nil, err
	}
	arrangerBooks, err := getJoinedIDs(ctx, q, `SELECT DISTINCT book_id FROM book_arrangers WHERE person_id = ?`, personID)
	if err != nil {
		return nil, err
	}
	for _, bookID := range append(composerBooks, arrangerBooks...) {
		pieceIDs, err := PieceIDsForBook(ctx, q, bookID)
		if err != nil {
			return nil, err
		}
		for _, id := range pieceIDs {
			affected[id] = true
		}
	}

	result := make([]int64, 0, len(affected))
	for id := range affected {
		result = append(result, id)
	}
	return result, nil
}

type getOrderedIDsFunc func(ctx context.Context, q Queryer, ownerID int64) ([]int64, error)
type setOrderedIDsFunc func(ctx context.Context, q Queryer, ownerID int64, personIDs []int64) error

// splicePersonCredits finds every owner (piece/book) in table crediting
// personID, splices replacementIDs in at personID's own position within
// that owner's list, and rewrites it via setIDs. Returns the affected
// owner ids.
func splicePersonCredits(ctx context.Context, q Queryer, table, ownerCol string, personID int64, replacementIDs []int64, getIDs getOrderedIDsFunc, setIDs setOrderedIDsFunc) ([]int64, error) {
	ownerIDs, err := getJoinedIDs(ctx, q, `SELECT DISTINCT `+ownerCol+` FROM `+table+` WHERE person_id = ?`, personID)
	if err != nil {
		return nil, err
	}
	for _, ownerID := range ownerIDs {
		current, err := getIDs(ctx, q, ownerID)
		if err != nil {
			return nil, err
		}
		next := make([]int64, 0, len(current)-1+len(replacementIDs))
		for _, id := range current {
			if id == personID {
				next = append(next, replacementIDs...)
			} else {
				next = append(next, id)
			}
		}
		if err := setIDs(ctx, q, ownerID, next); err != nil {
			return nil, err
		}
	}
	return ownerIDs, nil
}
