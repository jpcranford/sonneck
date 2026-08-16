package repo

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jpcranford/sonneck/internal/models"
)

func CreateBook(ctx context.Context, q Queryer, b *models.Book) (int64, error) {
	res, err := q.ExecContext(ctx, `
		INSERT INTO books (
			book_title, composer, year_written, work_opus_number, sheet_type_id,
			publisher, publisher_id, description, imslp_number,
			original_filename, file_path, file_hash
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		b.BookTitle, b.Composer, b.YearWritten, b.WorkOpusNumber, b.SheetTypeID,
		b.Publisher, b.PublisherID, b.Description, b.ImslpNumber,
		b.OriginalFilename, b.FilePath, b.FileHash,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// GetBookByHash supports the upload dedupe rule (CLAUDE.md > File handling):
// reuse an existing Book on SHA-256 match rather than storing a duplicate.
// Returns ErrNotFound if no book has this hash.
func GetBookByHash(ctx context.Context, q Queryer, hash string) (*models.Book, error) {
	var id int64
	err := q.QueryRowContext(ctx, `SELECT id FROM books WHERE file_hash = ?`, hash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return GetBookByID(ctx, q, id)
}

func GetBookByID(ctx context.Context, q Queryer, id int64) (*models.Book, error) {
	b := &models.Book{}
	err := q.QueryRowContext(ctx, `
		SELECT id, book_title, composer, year_written, work_opus_number, sheet_type_id,
			publisher, publisher_id, description, imslp_number,
			original_filename, file_path, file_hash, imported_at
		FROM books WHERE id = ?`, id,
	).Scan(
		&b.ID, &b.BookTitle, &b.Composer, &b.YearWritten, &b.WorkOpusNumber, &b.SheetTypeID,
		&b.Publisher, &b.PublisherID, &b.Description, &b.ImslpNumber,
		&b.OriginalFilename, &b.FilePath, &b.FileHash, &b.ImportedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	instrumentIDs, err := getBookInstrumentIDs(ctx, q, b.ID)
	if err != nil {
		return nil, err
	}
	b.InstrumentIDs = instrumentIDs

	return b, nil
}

// UpdateBook writes only the Book row (design doc §16) — it never touches
// any Piece row. Every piece with this sourceBookId simply resolves its
// effective values live against the new data on next read. Callers must
// still resync the pieces_fts row for every affected piece in the same
// transaction — see ResyncSearchIndexForBook.
func UpdateBook(ctx context.Context, q Queryer, b *models.Book) error {
	_, err := q.ExecContext(ctx, `
		UPDATE books SET
			book_title = ?, composer = ?, year_written = ?, work_opus_number = ?, sheet_type_id = ?,
			publisher = ?, publisher_id = ?, description = ?, imslp_number = ?
		WHERE id = ?`,
		b.BookTitle, b.Composer, b.YearWritten, b.WorkOpusNumber, b.SheetTypeID,
		b.Publisher, b.PublisherID, b.Description, b.ImslpNumber,
		b.ID,
	)
	return err
}

func DeleteBook(ctx context.Context, q Queryer, id int64) error {
	_, err := q.ExecContext(ctx, `DELETE FROM books WHERE id = ?`, id)
	return err
}

// CountPiecesForBook supports the orphan-cleanup rule (CLAUDE.md > File
// handling): a Book is deleted once its last referencing Piece is deleted.
func CountPiecesForBook(ctx context.Context, q Queryer, bookID int64) (int, error) {
	var count int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM pieces WHERE source_book_id = ?`, bookID).Scan(&count)
	return count, err
}

// PieceIDsForBook lists every piece belonging to a book, used to fan out
// pieces_fts resyncs after a book edit (design doc §16).
func PieceIDsForBook(ctx context.Context, q Queryer, bookID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT id FROM pieces WHERE source_book_id = ? ORDER BY id`, bookID)
}
