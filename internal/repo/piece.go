package repo

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jpcranford/sonneck/internal/models"
)

func CreatePiece(ctx context.Context, q Queryer, p *models.Piece) (int64, error) {
	res, err := q.ExecContext(ctx, `
		INSERT INTO pieces (
			title, composer, arranger, favorite, work_opus_number, sheet_type_id,
			publisher, publisher_id, year_written, description, user_notes, practice_status,
			imslp_number, source_book_id, source_page_start, source_page_end,
			duration, bpm, measure_count, beats_per_measure,
			file_path, file_hash, page_count, thumbnail_page, copyright_year, public_domain
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.Title, p.Composer, p.Arranger, p.Favorite, p.WorkOpusNumber, p.SheetTypeID,
		p.Publisher, p.PublisherID, p.YearWritten, p.Description, p.UserNotes, p.PracticeStatus,
		p.ImslpNumber, p.SourceBookID, p.SourcePageStart, p.SourcePageEnd,
		p.Duration, p.BPM, p.MeasureCount, p.BeatsPerMeasure,
		p.FilePath, p.FileHash, p.PageCount, p.ThumbnailPage, p.CopyrightYear, p.PublicDomain,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func GetPieceByID(ctx context.Context, q Queryer, id int64) (*models.Piece, error) {
	p := &models.Piece{}
	err := q.QueryRowContext(ctx, `
		SELECT id, title, composer, arranger, favorite, work_opus_number, sheet_type_id,
			publisher, publisher_id, year_written, description, user_notes, practice_status,
			imslp_number, source_book_id, source_page_start, source_page_end,
			duration, bpm, measure_count, beats_per_measure,
			file_path, file_hash, page_count, thumbnail_page, copyright_year, public_domain, created_at, updated_at
		FROM pieces WHERE id = ?`, id,
	).Scan(
		&p.ID, &p.Title, &p.Composer, &p.Arranger, &p.Favorite, &p.WorkOpusNumber, &p.SheetTypeID,
		&p.Publisher, &p.PublisherID, &p.YearWritten, &p.Description, &p.UserNotes, &p.PracticeStatus,
		&p.ImslpNumber, &p.SourceBookID, &p.SourcePageStart, &p.SourcePageEnd,
		&p.Duration, &p.BPM, &p.MeasureCount, &p.BeatsPerMeasure,
		&p.FilePath, &p.FileHash, &p.PageCount, &p.ThumbnailPage, &p.CopyrightYear, &p.PublicDomain, &p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	keyIDs, err := getPieceKeyIDs(ctx, q, p.ID)
	if err != nil {
		return nil, err
	}
	p.KeyIDs = keyIDs

	instrumentIDs, err := getPieceInstrumentIDs(ctx, q, p.ID)
	if err != nil {
		return nil, err
	}
	p.InstrumentIDs = instrumentIDs

	userTagIDs, err := getPieceUserTagIDs(ctx, q, p.ID)
	if err != nil {
		return nil, err
	}
	p.UserTagIDs = userTagIDs

	return p, nil
}

// UpdatePiece writes every editable Piece column. updated_at is set by the
// caller's clock (application-level, not a SQL trigger — consistent with
// this project's general preference for application-level over trigger
// logic, see CLAUDE.md > Search). Tag assignments (KeyIDs/InstrumentIDs/
// UserTagIDs) are not written here — use SetPieceKeys/SetPieceInstruments/
// SetPieceUserTags.
func UpdatePiece(ctx context.Context, q Queryer, p *models.Piece) error {
	_, err := q.ExecContext(ctx, `
		UPDATE pieces SET
			title = ?, composer = ?, arranger = ?, favorite = ?, work_opus_number = ?,
			sheet_type_id = ?, publisher = ?, publisher_id = ?, year_written = ?,
			description = ?, user_notes = ?, practice_status = ?, imslp_number = ?,
			source_book_id = ?, source_page_start = ?, source_page_end = ?,
			duration = ?, bpm = ?, measure_count = ?, beats_per_measure = ?,
			file_path = ?, file_hash = ?, page_count = ?, thumbnail_page = ?, copyright_year = ?, public_domain = ?,
			updated_at = ?
		WHERE id = ?`,
		p.Title, p.Composer, p.Arranger, p.Favorite, p.WorkOpusNumber,
		p.SheetTypeID, p.Publisher, p.PublisherID, p.YearWritten,
		p.Description, p.UserNotes, p.PracticeStatus, p.ImslpNumber,
		p.SourceBookID, p.SourcePageStart, p.SourcePageEnd,
		p.Duration, p.BPM, p.MeasureCount, p.BeatsPerMeasure,
		p.FilePath, p.FileHash, p.PageCount, p.ThumbnailPage, p.CopyrightYear, p.PublicDomain,
		p.UpdatedAt,
		p.ID,
	)
	return err
}

// DeletePiece removes only the DB row. Deleting the extracted file, and
// cleaning up an orphaned Book, are the caller's responsibility (they need
// the file path/hash before this call removes the row) — see CLAUDE.md >
// File handling and > Logging for the full deletion sequence.
func DeletePiece(ctx context.Context, q Queryer, id int64) error {
	_, err := q.ExecContext(ctx, `DELETE FROM pieces WHERE id = ?`, id)
	return err
}

// AllPieceIDs returns every Piece's id, ordered for deterministic
// iteration — used by maintenance operations that need to visit every
// piece in the library (e.g. RegenerateThumbnails), mirroring the same
// "SELECT id, then process each" shape RebuildSearchIndex uses.
func AllPieceIDs(ctx context.Context, q Queryer) ([]int64, error) {
	rows, err := q.QueryContext(ctx, `SELECT id FROM pieces ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// CountPiecesWithFileHash counts pieces referencing the given file hash.
// Storage is content-addressed (internal/storage). handleCreatePiece dedupes
// standalone single-piece uploads at creation time (see GetPieceByFileHash),
// but the book-import wizard's confirm step deliberately does not: two
// sibling Piece rows split from the same book can legitimately end up
// pointing at the same on-disk file (e.g. identical duplicate pages), and
// those are genuinely different pieces, not a duplicate upload to collapse.
// Callers must check this before deleting a piece's file: removing it while
// another row still references it would silently break that piece's
// download/preview.
func CountPiecesWithFileHash(ctx context.Context, q Queryer, hash string) (int, error) {
	var count int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM pieces WHERE file_hash = ?`, hash).Scan(&count)
	return count, err
}

// GetPieceByFileHash supports the single-piece-upload dedupe rule
// (handleCreatePiece): reuse an existing Piece on SHA-256 match rather than
// creating a duplicate row for identical file content, mirroring
// GetBookByHash. Deliberately not used by the book-import wizard (see
// CountPiecesWithFileHash) — matches the oldest existing piece by id when
// more than one legitimately shares the hash. Returns ErrNotFound if none do.
func GetPieceByFileHash(ctx context.Context, q Queryer, hash string) (*models.Piece, error) {
	var id int64
	err := q.QueryRowContext(ctx, `SELECT id FROM pieces WHERE file_hash = ? ORDER BY id LIMIT 1`, hash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return GetPieceByID(ctx, q, id)
}

// GetRandomPiece supports the Piece Details page's "random piece" dice button.
// SQLite's ORDER BY RANDOM() LIMIT 1 is fine at this project's scale (a
// personal library, not a catalog needing an index-friendly random-row
// trick) — a full table scan per roll is cheap here. Returns ErrNotFound
// if the library is empty. Doesn't exclude the piece currently being
// viewed — occasionally re-rolling the same piece is an acceptable, minor
// quirk, not something worth a second query parameter for.
func GetRandomPiece(ctx context.Context, q Queryer) (*models.Piece, error) {
	var id int64
	err := q.QueryRowContext(ctx, `SELECT id FROM pieces ORDER BY RANDOM() LIMIT 1`).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return GetPieceByID(ctx, q, id)
}
