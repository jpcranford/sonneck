package repo

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Setlist is a per-user ordered collection of pieces (design doc §13,
// migration 00029) — same owner_user_id-scoped shape as user_tags/
// practice_statuses. Archived is the *explicit* user-set flag only; see
// EffectiveArchived below for the read-time "manual OR gig date has
// passed" computation (same asymmetric-resolution posture as the Public
// Domain Badge's own ResolveCopyrightStatus — one stored bool, corrected
// forward at read time, never written back).
type Setlist struct {
	ID          int64     `json:"id"`
	OwnerUserID int64     `json:"-"`
	Name        string    `json:"name"`
	GigDate     *string   `json:"gigDate"`
	Description *string   `json:"description"`
	Archived    bool      `json:"archived"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// EffectiveArchived is decision 3's computed "is this in the Archive"
// rule: the explicit flag, OR a set gig date that's already passed. A
// setlist with no gig date at all is never auto-archived by this rule —
// nothing to compare, only the explicit flag can archive it. gigDate is
// a plain ISO (YYYY-MM-DD) string, so a lexical comparison against
// today's own ISO date is correct without parsing either side.
func (s *Setlist) EffectiveArchived(today string) bool {
	if s.Archived {
		return true
	}
	if s.GigDate == nil {
		return false
	}
	return *s.GigDate < today
}

// SetlistEntry is one row of a setlist's program — either a real piece
// reference (PieceID set) or a freeform custom row (CustomName set, e.g.
// an announcement or offering) — the migration's own CHECK constraint
// enforces this is always exactly one or the other, never both/neither.
// PieceDuration/PiecePageCount are joined in from the referenced Piece
// (nil for a custom entry) purely so totals (ListSetlistEntries' own
// callers) never need a second query — CLAUDE.md's Computed fields
// deviation already marks Duration/PageCount as plain, non-book-
// inheritable columns, so reading them directly here (rather than through
// repo.ResolveEffective) is correct, not a shortcut around that rule.
type SetlistEntry struct {
	ID                    int64
	SetlistID             int64
	PieceID               *int64
	CustomName            *string
	CustomDurationSeconds *int
	CustomNotes           *string
	CustomCountsAsMusic   bool
	Role                  *string
	SortOrder             int
	PieceDuration         *int
	PiecePageCount        *int
}

// CountsAsMusic mirrors decision 8's "#" column rule: a piece entry
// always counts (automatic, no choice); a custom entry counts only when
// its own toggle is on.
func (e *SetlistEntry) CountsAsMusic() bool {
	if e.PieceID != nil {
		return true
	}
	return e.CustomCountsAsMusic
}

// CreateSetlist adds a new setlist owned by ownerUserID — the `create`
// permission's first and only real consumer (CLAUDE.md > Multi-user
// support). No duplicate-name rejection (unlike user_tags/
// practice_statuses) — two setlists can share a name, e.g. "Sunday
// Morning Service" recurring across different gig dates.
func CreateSetlist(ctx context.Context, q Queryer, ownerUserID int64, name string, gigDate, description *string) (int64, error) {
	res, err := q.ExecContext(ctx, `
		INSERT INTO setlists (owner_user_id, name, gig_date, description)
		VALUES (?, ?, ?, ?)`, ownerUserID, name, gigDate, description,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ListSetlists returns ownerUserID's own setlists — every one, active and
// archived alike (decision 12: one page, two scrolled sections, not two
// endpoints) — newest-gig-date-first ordering is a frontend concern
// (sidebar/library sorting), so this returns plain id order, stable and
// cheap.
func ListSetlists(ctx context.Context, q Queryer, ownerUserID int64) ([]Setlist, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, owner_user_id, name, gig_date, description, archived, created_at, updated_at
		FROM setlists WHERE owner_user_id = ? ORDER BY id`, ownerUserID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	setlists := []Setlist{}
	for rows.Next() {
		var s Setlist
		var archived int
		if err := rows.Scan(&s.ID, &s.OwnerUserID, &s.Name, &s.GigDate, &s.Description, &archived, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		s.Archived = archived != 0
		setlists = append(setlists, s)
	}
	return setlists, rows.Err()
}

// GetSetlist loads one setlist, scoped to ownerUserID — a setlist that
// exists but belongs to someone else resolves identically to one that
// doesn't exist at all (ErrNotFound, not a 403), matching
// GetUserPieceData's own per-user-data-scoping convention.
func GetSetlist(ctx context.Context, q Queryer, ownerUserID, id int64) (*Setlist, error) {
	var s Setlist
	var archived int
	err := q.QueryRowContext(ctx, `
		SELECT id, owner_user_id, name, gig_date, description, archived, created_at, updated_at
		FROM setlists WHERE id = ? AND owner_user_id = ?`, id, ownerUserID,
	).Scan(&s.ID, &s.OwnerUserID, &s.Name, &s.GigDate, &s.Description, &archived, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	s.Archived = archived != 0
	return &s, nil
}

// UpdateSetlist replaces name/gigDate/description/archived in one write —
// same full-replace convention as every other multi-field edit form in
// this app (e.g. PieceWriteRequest), not a partial PATCH — the caller
// always submits the whole current form state. Scoped to ownerUserID;
// zero rows affected (wrong id or wrong owner) reports ErrNotFound.
func UpdateSetlist(ctx context.Context, q Queryer, ownerUserID, id int64, name string, gigDate, description *string, archived bool) error {
	res, err := q.ExecContext(ctx, `
		UPDATE setlists SET name = ?, gig_date = ?, description = ?, archived = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND owner_user_id = ?`, name, gigDate, description, archived, id, ownerUserID,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteSetlist removes id, scoped to ownerUserID. No merge target,
// unlike DeletePracticeStatus — nothing else ever references a
// setlist_id the way piece_practice_status/piece_user_tags reference a
// lookup row, so a plain scoped DELETE (setlist_entries cascading via ON
// DELETE CASCADE) is the whole operation.
func DeleteSetlist(ctx context.Context, q Queryer, ownerUserID, id int64) error {
	res, err := q.ExecContext(ctx, `DELETE FROM setlists WHERE id = ? AND owner_user_id = ?`, id, ownerUserID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListSetlistEntries returns setlistID's own entries in program order
// (sort_order), with the referenced piece's own duration/page_count
// joined straight in (NULL for a custom entry) — see SetlistEntry's own
// doc comment for why this avoids a second per-entry query for both full
// detail and totals. Caller is responsible for having already confirmed
// setlistID belongs to the calling user (repo.GetSetlist) — this
// function has no owner column of its own to scope by.
func ListSetlistEntries(ctx context.Context, q Queryer, setlistID int64) ([]SetlistEntry, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT se.id, se.setlist_id, se.piece_id, se.custom_name, se.custom_duration_seconds,
		       se.custom_notes, se.custom_counts_as_music, se.role, se.sort_order,
		       p.duration, p.page_count
		FROM setlist_entries se
		LEFT JOIN pieces p ON p.id = se.piece_id
		WHERE se.setlist_id = ?
		ORDER BY se.sort_order`, setlistID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []SetlistEntry{}
	for rows.Next() {
		var e SetlistEntry
		var countsAsMusic int
		if err := rows.Scan(
			&e.ID, &e.SetlistID, &e.PieceID, &e.CustomName, &e.CustomDurationSeconds,
			&e.CustomNotes, &countsAsMusic, &e.Role, &e.SortOrder,
			&e.PieceDuration, &e.PiecePageCount,
		); err != nil {
			return nil, err
		}
		e.CustomCountsAsMusic = countsAsMusic != 0
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// GetSetlistEntry loads one entry, scoped to setlistID (already confirmed
// to belong to the calling user by the caller) — used by handlers that
// need to know PieceID (i.e. is this a custom entry) before deciding
// which fields UpdateSetlistEntry should touch.
func GetSetlistEntry(ctx context.Context, q Queryer, setlistID, entryID int64) (*SetlistEntry, error) {
	var e SetlistEntry
	var countsAsMusic int
	err := q.QueryRowContext(ctx, `
		SELECT se.id, se.setlist_id, se.piece_id, se.custom_name, se.custom_duration_seconds,
		       se.custom_notes, se.custom_counts_as_music, se.role, se.sort_order,
		       p.duration, p.page_count
		FROM setlist_entries se
		LEFT JOIN pieces p ON p.id = se.piece_id
		WHERE se.id = ? AND se.setlist_id = ?`, entryID, setlistID,
	).Scan(
		&e.ID, &e.SetlistID, &e.PieceID, &e.CustomName, &e.CustomDurationSeconds,
		&e.CustomNotes, &countsAsMusic, &e.Role, &e.SortOrder,
		&e.PieceDuration, &e.PiecePageCount,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	e.CustomCountsAsMusic = countsAsMusic != 0
	return &e, nil
}

// AddSetlistEntryParams is either a piece reference (PieceID set) or a
// freeform custom row (CustomName set) — mirrors the migration's own XOR
// CHECK constraint; api.ValidateSetlistEntry enforces this before it ever
// reaches here.
type AddSetlistEntryParams struct {
	PieceID               *int64
	CustomName            *string
	CustomDurationSeconds *int
	CustomNotes           *string
	CustomCountsAsMusic   bool
	Role                  *string
}

// AddSetlistEntry appends one entry to the end of setlistID's own
// program — sort_order is `COUNT(*)` of the existing rows, so entries
// added one at a time (the mockup's own "+ Piece"/"+ Custom Entry" flow)
// always land in the order they were added, with no gap-filling logic
// needed. Caller must have already confirmed ownership (repo.GetSetlist).
func AddSetlistEntry(ctx context.Context, q Queryer, setlistID int64, p AddSetlistEntryParams) (int64, error) {
	var nextOrder int
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM setlist_entries WHERE setlist_id = ?`, setlistID).Scan(&nextOrder); err != nil {
		return 0, err
	}
	countsAsMusic := 0
	if p.CustomCountsAsMusic {
		countsAsMusic = 1
	}
	res, err := q.ExecContext(ctx, `
		INSERT INTO setlist_entries
			(setlist_id, piece_id, custom_name, custom_duration_seconds, custom_notes, custom_counts_as_music, role, sort_order)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		setlistID, p.PieceID, p.CustomName, p.CustomDurationSeconds, p.CustomNotes, countsAsMusic, p.Role, nextOrder,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateSetlistEntryParams edits an existing entry's own role, and — only
// meaningful for a custom entry — its name/duration/notes/counts-as-music
// toggle. A piece entry's own PieceID/piece-derived fields are never
// editable here (editing the piece itself is "Edit Piece," a separate
// concern); only Role applies to both kinds.
type UpdateSetlistEntryParams struct {
	Role                  *string
	CustomName            *string
	CustomDurationSeconds *int
	CustomNotes           *string
	CustomCountsAsMusic   bool
}

// UpdateSetlistEntry edits entryID's own role/custom fields, scoped to
// setlistID (which the caller has already confirmed belongs to the
// calling user). isCustom decides whether the custom_* columns are
// written at all — updating them on a piece entry would violate nothing
// at the SQL level (they're just nullable columns) but would be a real
// modeling error, so the handler is expected to check entry.PieceID
// itself first and only pass isCustom=true for a genuine custom entry.
func UpdateSetlistEntry(ctx context.Context, q Queryer, setlistID, entryID int64, isCustom bool, p UpdateSetlistEntryParams) error {
	var res sql.Result
	var err error
	if isCustom {
		countsAsMusic := 0
		if p.CustomCountsAsMusic {
			countsAsMusic = 1
		}
		res, err = q.ExecContext(ctx, `
			UPDATE setlist_entries
			SET role = ?, custom_name = ?, custom_duration_seconds = ?, custom_notes = ?, custom_counts_as_music = ?
			WHERE id = ? AND setlist_id = ?`,
			p.Role, p.CustomName, p.CustomDurationSeconds, p.CustomNotes, countsAsMusic, entryID, setlistID,
		)
	} else {
		res, err = q.ExecContext(ctx, `
			UPDATE setlist_entries SET role = ? WHERE id = ? AND setlist_id = ?`,
			p.Role, entryID, setlistID,
		)
	}
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// RemoveSetlistEntry deletes one entry, scoped to setlistID (already
// confirmed to belong to the calling user by the caller). Every
// remaining entry's own sort_order is left as-is — a gap in the sequence
// is harmless, since ordering is by relative sort_order value, not a
// dense 0..n-1 range, and ReorderSetlistEntries always rewrites every
// entry's sort_order from scratch the next time the program is
// reordered anyway.
func RemoveSetlistEntry(ctx context.Context, q Queryer, setlistID, entryID int64) error {
	res, err := q.ExecContext(ctx, `DELETE FROM setlist_entries WHERE id = ? AND setlist_id = ?`, entryID, setlistID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ReorderSetlistEntries rewrites sort_order for every id in orderedIDs,
// 0-indexed by position in the slice — the frontend's own drag-to-any-
// position reorder (decision 22) sends the complete new order on every
// drop, not an incremental swap, so this is a full replace of the whole
// sequence, not a pairwise move. Deliberately UPDATEs each existing row
// by its own id rather than delete-and-reinsert (the SetPieceKeys
// pattern) — a setlist entry's id is a real, externally-referenced
// identity (the frontend's own in-progress edit state, an "Edit Entry"
// deep link), and delete-and-reinsert would silently mint new ids for
// every entry on every single reorder.
//
// ownerUserID/setlistID are both required so a caller can't reorder a
// setlistID it doesn't itself own; entryIDs not belonging to setlistID
// are silently ignored by the scoped UPDATE below rather than erroring —
// callers are expected to pass exactly the current entry set (validated
// by the handler against ListSetlistEntries first), so this is a defensive
// backstop, not the primary validation path.
func ReorderSetlistEntries(ctx context.Context, q Queryer, setlistID int64, orderedIDs []int64) error {
	for position, id := range orderedIDs {
		if _, err := q.ExecContext(ctx,
			`UPDATE setlist_entries SET sort_order = ? WHERE id = ? AND setlist_id = ?`, position, id, setlistID,
		); err != nil {
			return err
		}
	}
	return nil
}
