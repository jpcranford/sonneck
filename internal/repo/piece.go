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
			title, composer, arranger, favorite, work_opus_number, key_id, sheet_type_id,
			publisher, publisher_id, year_written, description, user_notes, practice_status,
			imslp_number, source_book_id, source_page_start, source_page_end,
			duration, bpm, measure_count, beats_per_measure,
			file_path, file_hash, copyright_year, public_domain
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.Title, p.Composer, p.Arranger, p.Favorite, p.WorkOpusNumber, p.KeyID, p.SheetTypeID,
		p.Publisher, p.PublisherID, p.YearWritten, p.Description, p.UserNotes, p.PracticeStatus,
		p.ImslpNumber, p.SourceBookID, p.SourcePageStart, p.SourcePageEnd,
		p.Duration, p.BPM, p.MeasureCount, p.BeatsPerMeasure,
		p.FilePath, p.FileHash, p.CopyrightYear, p.PublicDomain,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func GetPieceByID(ctx context.Context, q Queryer, id int64) (*models.Piece, error) {
	p := &models.Piece{}
	err := q.QueryRowContext(ctx, `
		SELECT id, title, composer, arranger, favorite, work_opus_number, key_id, sheet_type_id,
			publisher, publisher_id, year_written, description, user_notes, practice_status,
			imslp_number, source_book_id, source_page_start, source_page_end,
			duration, bpm, measure_count, beats_per_measure,
			file_path, file_hash, copyright_year, public_domain, created_at, updated_at
		FROM pieces WHERE id = ?`, id,
	).Scan(
		&p.ID, &p.Title, &p.Composer, &p.Arranger, &p.Favorite, &p.WorkOpusNumber, &p.KeyID, &p.SheetTypeID,
		&p.Publisher, &p.PublisherID, &p.YearWritten, &p.Description, &p.UserNotes, &p.PracticeStatus,
		&p.ImslpNumber, &p.SourceBookID, &p.SourcePageStart, &p.SourcePageEnd,
		&p.Duration, &p.BPM, &p.MeasureCount, &p.BeatsPerMeasure,
		&p.FilePath, &p.FileHash, &p.CopyrightYear, &p.PublicDomain, &p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

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
// logic, see CLAUDE.md > Search). Tag assignments (InstrumentIDs/UserTagIDs)
// are not written here — use SetPieceInstruments/SetPieceUserTags.
func UpdatePiece(ctx context.Context, q Queryer, p *models.Piece) error {
	_, err := q.ExecContext(ctx, `
		UPDATE pieces SET
			title = ?, composer = ?, arranger = ?, favorite = ?, work_opus_number = ?,
			key_id = ?, sheet_type_id = ?, publisher = ?, publisher_id = ?, year_written = ?,
			description = ?, user_notes = ?, practice_status = ?, imslp_number = ?,
			source_book_id = ?, source_page_start = ?, source_page_end = ?,
			duration = ?, bpm = ?, measure_count = ?, beats_per_measure = ?,
			file_path = ?, file_hash = ?, copyright_year = ?, public_domain = ?,
			updated_at = ?
		WHERE id = ?`,
		p.Title, p.Composer, p.Arranger, p.Favorite, p.WorkOpusNumber,
		p.KeyID, p.SheetTypeID, p.Publisher, p.PublisherID, p.YearWritten,
		p.Description, p.UserNotes, p.PracticeStatus, p.ImslpNumber,
		p.SourceBookID, p.SourcePageStart, p.SourcePageEnd,
		p.Duration, p.BPM, p.MeasureCount, p.BeatsPerMeasure,
		p.FilePath, p.FileHash, p.CopyrightYear, p.PublicDomain,
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

// CountPiecesWithFileHash counts pieces referencing the given file hash.
// Storage is content-addressed (internal/storage), but — unlike Book
// uploads — Piece uploads aren't deduped at creation time, so two distinct
// Piece rows can legitimately end up pointing at the same on-disk file
// (identical content extracted from two different page ranges, or two
// separately uploaded files that happen to match). Callers must check this
// before deleting a piece's file: removing it while another row still
// references it would silently break that piece's download/preview.
func CountPiecesWithFileHash(ctx context.Context, q Queryer, hash string) (int, error) {
	var count int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM pieces WHERE file_hash = ?`, hash).Scan(&count)
	return count, err
}
