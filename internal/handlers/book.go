package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // format registration for image.DecodeConfig — handleUploadBookCover
	_ "image/jpeg" // format registration for image.DecodeConfig — handleUploadBookCover
	_ "image/png"  // format registration for image.DecodeConfig — handleUploadBookCover
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/storage"
)

var (
	isbnPrefixPattern   = regexp.MustCompile(`(?i)^\s*isbn[\s:#-]*`)
	isbnNonDigitPattern = regexp.MustCompile(`[^0-9Xx]`)
)

// normalizeISBN strips a redundant "ISBN" label (same separator set as
// citation.go's stripImslpPrefix — space/colon/hash/dash, any case) plus any
// other punctuation/whitespace a user might have typed (e.g. a
// pre-hyphenated "978-1-56619-909-4"), leaving only digits and a possible
// trailing check-digit "X" (ISBN-10, uppercased).
//
// Unlike imslpNumber — which only ever gets its label stripped client-side,
// needing citation.go's own defensive stripImslpPrefix for legacy data at
// render time — this runs server-side on every write. Nothing downstream
// (citation formatting, the frontend's hyphenation display) ever needs to
// re-normalize what's already stored: migration 00017 did the same cleanup
// for data that predates this column existing at all, so isbn is guaranteed
// clean everywhere it's read, without a citation-time defensive step.
func normalizeISBN(raw *string) *string {
	if raw == nil {
		return nil
	}
	stripped := isbnPrefixPattern.ReplaceAllString(*raw, "")
	digits := strings.ToUpper(isbnNonDigitPattern.ReplaceAllString(stripped, ""))
	return &digits
}

// handleUploadBook is the import wizard's step 1 (design doc §5): upload
// the book PDF, dedupe on hash match, render nothing yet (thumbnails are
// rendered on demand per-page — see handleBookPageThumbnail).
func (s *Server) handleUploadBook(w http.ResponseWriter, r *http.Request) {
	file, header, ok := requireMultipartFile(w, r)
	if !ok {
		return
	}
	defer file.Close()

	stagingDir := filepath.Join(s.Cfg.DataDir, "library", "books")
	tempPath, hash, pageCount, ok := s.stageUpload(w, r, stagingDir, file)
	if !ok {
		return
	}

	existing, err := repo.GetBookByHash(r.Context(), s.DB, hash)
	if err != nil && !errors.Is(err, repo.ErrNotFound) {
		s.writeError(w, err)
		return
	}
	if existing != nil {
		os.Remove(tempPath)
		resp, err := api.BuildBookResponse(r.Context(), s.DB, existing)
		if err != nil {
			s.writeError(w, err)
			return
		}
		api.WriteData(w, http.StatusOK, map[string]any{"book": resp, "pageCount": pageCount})
		return
	}

	finalPath := storage.BookPath(s.Cfg.DataDir, hash)
	if err := storage.MoveIntoPlace(tempPath, finalPath); err != nil {
		s.writeError(w, err)
		return
	}

	var resp *api.BookResponse
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		b := &models.Book{
			BookTitle:        defaultTitleFromFilename(header.Filename),
			ImslpNumber:      detectImslpNumber(header.Filename),
			OriginalFilename: &header.Filename,
			FilePath:         &finalPath,
			FileHash:         &hash,
		}
		id, err := repo.CreateBook(r.Context(), tx, b)
		if err != nil {
			return err
		}

		// Re-fetch rather than reusing b: CreateBook doesn't populate
		// DB-assigned defaults (importedAt) back onto it.
		created, err := repo.GetBookByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		resp, err = api.BuildBookResponse(r.Context(), tx, created)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusCreated, map[string]any{"book": resp, "pageCount": pageCount})
}

// handleCreateBookManual is the Books library view's "New Book" button —
// distinct from handleUploadBook above, which always requires a real PDF.
// The resulting Book has no file (migration 00014) and, since nothing can
// attach a Piece to a book with no original PDF to split, no path to ever
// gaining one either — it exists purely as a placeholder record a user can
// fill in ahead of actually having the sheet music.
func (s *Server) handleCreateBookManual(w http.ResponseWriter, r *http.Request) {
	var req api.BookCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var resp *api.BookResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		b := &models.Book{
			BookTitle:   req.BookTitle,
			Publisher:   req.Publisher,
			YearWritten: req.YearWritten,
		}

		composerIDs, err := resolveTagNames(r.Context(), tx, repo.FindOrCreatePerson, req.Composers, "composers")
		if err != nil {
			return err
		}
		b.ComposerIDs = composerIDs
		arrangerIDs, err := resolveTagNames(r.Context(), tx, repo.FindOrCreatePerson, req.Arrangers, "arrangers")
		if err != nil {
			return err
		}
		b.ArrangerIDs = arrangerIDs

		if errs := api.ValidateBook(b); len(errs) > 0 {
			return errs
		}

		id, err := repo.CreateBook(r.Context(), tx, b)
		if err != nil {
			return err
		}
		if err := repo.SetBookComposers(r.Context(), tx, id, b.ComposerIDs); err != nil {
			return err
		}
		if err := repo.SetBookArrangers(r.Context(), tx, id, b.ArrangerIDs); err != nil {
			return err
		}

		// Re-fetch rather than reusing b: CreateBook doesn't populate
		// DB-assigned defaults (importedAt) back onto it.
		created, err := repo.GetBookByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		resp, err = api.BuildBookResponse(r.Context(), tx, created)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusCreated, resp)
}

// bookSortColumns: composer/title need no book-inheritance handling (books
// are the top of the hierarchy — see handleListBooks's own doc comment).
// title strips a leading "A"/"An"/"The" via titleSortColumn (internal/
// handlers/sort.go, shared with pieceSortColumns) — the usual library-
// catalog sort convention. yearWritten is TEXT, not INTEGER (free text, e.g.
// "ca. 1708-1711"), so a naive ORDER BY would sort lexicographically —
// GLOB '[0-9]*' is the "does this look like a real leading year" test
// (chosen over CAST(...) = 0, which would misclassify a literal "0" as
// junk), and the whole first clause is direction-invariant (always ASC)
// so blank/non-numeric years trail regardless of the chosen direction,
// the same "blanks always last" pattern pieceSortColumns uses for
// composer, for the same reason (SQLite's own NULL-sorts-first-on-ASC
// default would otherwise put them at the front of an ascending list).
var bookSortColumns = map[string]sortColumnFunc{
	"dateAdded": simpleSortColumn("id"),
	"title":     titleSortColumn("book_title"),
	// composer sorts by the book's own first-listed composer (position 0)
	// — composer/arranger overhaul (migration 00020) moved it off a plain
	// column onto an ordered join table, so this is a scalar subquery now,
	// not simpleSortColumn. Same direction-invariant "blank sorts last"
	// clause as yearWritten below (a book with no composer at all has
	// nothing for the subquery to return, i.e. NULL).
	"composer": func(dir string) string {
		const expr = `(SELECT p.name FROM book_composers bc JOIN people p ON p.id = bc.person_id WHERE bc.book_id = books.id ORDER BY bc.position LIMIT 1)`
		return "(" + expr + " IS NULL) ASC, " + expr + " COLLATE NOCASE " + dir
	},
	"yearWritten": func(dir string) string {
		return "(year_written IS NULL OR TRIM(year_written) = '' OR NOT (year_written GLOB '[0-9]*')) ASC, " +
			"CAST(year_written AS INTEGER) " + dir
	},
}

// handleListBooks is the Books library view's browse/search (mirrors
// handleSearchPieces's shape) — text query against book_title/composer/
// publisher via plain LIKE, not FTS5: unlike pieces_fts (design doc §11),
// there's no books_fts table, and a books library realistically holds a
// tiny fraction of the row count a pieces library does, so a LIKE scan
// costs nothing worth building real full-text search to avoid.
//
// sheetTypeId/instrumentId need none of pieces' book-inheritance
// complexity — a Book is the top of the hierarchy, nothing to fall back
// to (CLAUDE.md > Book-level soft inheritance).
func (s *Server) handleListBooks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	var where []string
	var args []any

	sqlStr := `SELECT id FROM books`

	if query := strings.TrimSpace(q.Get("query")); query != "" {
		// composer/arranger are ordered join tables now (migration 00020),
		// not a plain column — matched via an EXISTS-style IN subquery
		// against `people.name`, same "any of this book's credited people"
		// shape the personId filter below uses for an exact id match.
		where = append(where, `(book_title LIKE ? OR publisher LIKE ?
			OR id IN (SELECT book_id FROM book_composers bc JOIN people p ON p.id = bc.person_id WHERE p.name LIKE ?)
			OR id IN (SELECT book_id FROM book_arrangers ba JOIN people p ON p.id = ba.person_id WHERE p.name LIKE ?))`)
		like := "%" + query + "%"
		args = append(args, like, like, like, like)
	}

	// Comma-separated, same OR-match multi-select convention as
	// handleSearchPieces's own keyId/instrumentId/sheetTypeId/userTagId
	// filters (see parseIDListFilter's doc comment) — the Filter Drawer's
	// Sheet Type/Instrument sections are real multi-select checkbox lists.
	if ids, present, ok := parseIDListFilter(w, q, "sheetTypeId"); !ok {
		return
	} else if present {
		where = append(where, "sheet_type_id IN ("+sqlPlaceholders(len(ids))+")")
		args = append(args, idsToArgs(ids)...)
	}

	if ids, present, ok := parseIDListFilter(w, q, "instrumentId"); !ok {
		return
	} else if present {
		where = append(where, "id IN (SELECT book_id FROM book_instruments WHERE instrument_id IN ("+sqlPlaceholders(len(ids))+"))")
		args = append(args, idsToArgs(ids)...)
	}

	// personId: Person Details' own "Also credited directly on N books"
	// chip strip — every book directly crediting this person as composer
	// OR arranger. No inheritance concern here (Book is the top of the
	// hierarchy), unlike the piece-side personId filter.
	if id, present, ok := parseIDFilter(w, q, "personId"); !ok {
		return
	} else if present {
		where = append(where, `(
			id IN (SELECT book_id FROM book_composers WHERE person_id = ?)
			OR id IN (SELECT book_id FROM book_arrangers WHERE person_id = ?)
		)`)
		args = append(args, id, id)
	}

	if len(where) > 0 {
		sqlStr += " WHERE " + strings.Join(where, " AND ")
	}

	sortOrderBy, ok := parseSort(w, q, bookSortColumns, "dateAdded")
	if !ok {
		return
	}

	limit := 50
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	offset := 0
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	// , id DESC: deterministic secondary tie-break, same reasoning as
	// handleSearchPieces's own ", p.id DESC" — without it, rows with equal
	// primary sort values have no guaranteed stable order across paginated
	// requests.
	sqlStr += " ORDER BY " + sortOrderBy + ", id DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := s.DB.QueryContext(r.Context(), sqlStr, args...)
	if err != nil {
		s.writeError(w, err)
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			s.writeError(w, err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.writeError(w, err)
		return
	}
	rows.Close()

	results := make([]*api.BookResponse, 0, len(ids))
	for _, id := range ids {
		b, err := repo.GetBookByID(r.Context(), s.DB, id)
		if err != nil {
			s.writeError(w, err)
			return
		}
		resp, err := api.BuildBookResponse(r.Context(), s.DB, b)
		if err != nil {
			s.writeError(w, err)
			return
		}
		results = append(results, resp)
	}

	api.WriteData(w, http.StatusOK, results)
}

func (s *Server) handleGetBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}
	b, err := repo.GetBookByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildBookResponse(r.Context(), s.DB, b)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleUpdateBook is the Book Properties Edit Menu (design doc §16):
// writes only the Book row, then fans the search-index resync out to
// every piece that inherits from it — not just this one row.
func (s *Server) handleUpdateBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}

	var req api.BookWriteRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var resp *api.BookResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		b, err := repo.GetBookByID(r.Context(), tx, id)
		if err != nil {
			return err
		}

		b.BookTitle = req.BookTitle
		b.YearWritten = req.YearWritten
		b.WorkOpusNumber = req.WorkOpusNumber
		b.Publisher = req.Publisher
		b.PublisherID = req.PublisherID
		b.Description = req.Description
		b.ImslpNumber = req.ImslpNumber
		b.ISBN = normalizeISBN(req.ISBN)

		sheetTypeID, err := resolveOptionalTagName(r.Context(), tx, repo.FindOrCreateSheetType, req.SheetTypeName, "sheetTypeName")
		if err != nil {
			return err
		}
		b.SheetTypeID = sheetTypeID

		instrumentIDs, err := resolveTagNames(r.Context(), tx, repo.FindOrCreateInstrument, req.Instruments, "instruments")
		if err != nil {
			return err
		}
		b.InstrumentIDs = instrumentIDs

		composerIDs, err := resolveTagNames(r.Context(), tx, repo.FindOrCreatePerson, req.Composers, "composers")
		if err != nil {
			return err
		}
		b.ComposerIDs = composerIDs
		arrangerIDs, err := resolveTagNames(r.Context(), tx, repo.FindOrCreatePerson, req.Arrangers, "arrangers")
		if err != nil {
			return err
		}
		b.ArrangerIDs = arrangerIDs

		if errs := api.ValidateBook(b); len(errs) > 0 {
			return errs
		}

		if err := repo.UpdateBook(r.Context(), tx, b); err != nil {
			return err
		}
		if err := repo.SetBookInstruments(r.Context(), tx, id, b.InstrumentIDs); err != nil {
			return err
		}
		if err := repo.SetBookComposers(r.Context(), tx, id, b.ComposerIDs); err != nil {
			return err
		}
		if err := repo.SetBookArrangers(r.Context(), tx, id, b.ArrangerIDs); err != nil {
			return err
		}
		if err := repo.ResyncSearchIndexForBook(r.Context(), tx, id); err != nil {
			return err
		}

		resp, err = api.BuildBookResponse(r.Context(), tx, b)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, resp)
}

// handleDeleteBook implements the Book Library's context menu "Delete Book"
// action — a cascade delete: removes the Book and every Piece that
// references it in one action, not an unlink-and-keep. This is the single
// largest blast-radius action in the app, gated by a strong frontend
// confirmation naming the piece count.
//
// Distinct from the existing orphan-cleanup path (handleDeletePiece, which
// only ever deletes a Book once its *last* referencing Piece is gone one at
// a time) — this is reachable with pieces still attached and removes them
// too, in one transaction, same delete-then-file-cleanup-then-log shape as
// handleDeletePiece just fanned out over every piece up front.
//
// File-hash reference counts (CLAUDE.md > File handling: piece uploads
// aren't deduped, so two pieces can legitimately share a hash — e.g.
// duplicate blank pages split from the same book) are computed only after
// *all* of this book's own pieces are already deleted from the table, not
// piece-by-piece as each is removed — otherwise a still-undeleted sibling
// piece in the same batch would make an already-deleted piece's file look
// "still referenced" and wrongly survive the cleanup.
func (s *Server) handleDeleteBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}

	var book *models.Book
	var deletedPieces []*models.Piece
	var fileStillReferenced []bool // parallel to deletedPieces

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		b, err := repo.GetBookByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		book = b

		pieceIDs, err := repo.PieceIDsForBook(r.Context(), tx, id)
		if err != nil {
			return err
		}

		pieces := make([]*models.Piece, 0, len(pieceIDs))
		for _, pieceID := range pieceIDs {
			p, err := repo.GetPieceByID(r.Context(), tx, pieceID)
			if err != nil {
				return err
			}
			pieces = append(pieces, p)
		}

		for _, pieceID := range pieceIDs {
			if err := repo.DeletePiece(r.Context(), tx, pieceID); err != nil {
				return err
			}
			if err := repo.ResyncSearchIndex(r.Context(), tx, pieceID); err != nil {
				return err
			}
		}

		// Every piece this book referenced is gone from the table now, so
		// this count only reflects genuinely unrelated pieces/books that
		// happen to share a hash — see the file comment above.
		for _, p := range pieces {
			remaining, err := repo.CountPiecesWithFileHash(r.Context(), tx, p.FileHash)
			if err != nil {
				return err
			}
			fileStillReferenced = append(fileStillReferenced, remaining > 0)
		}
		deletedPieces = pieces

		return repo.DeleteBook(r.Context(), tx, id)
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	for i, p := range deletedPieces {
		if !fileStillReferenced[i] {
			if err := os.Remove(p.FilePath); err != nil && !os.IsNotExist(err) {
				s.Logger.Error("failed to remove piece file after delete", "error", err, "pieceId", p.ID, "filePath", p.FilePath)
			}
		}
		s.Logger.Info("piece deleted", "pieceId", p.ID, "fileHash", p.FileHash, "title", p.Title)
	}

	// FilePath is nil only for a manually created book (migration 00014,
	// the Books library view's "New Book" button) — a real, reachable case
	// here, unlike the same nil check in handleDeletePiece's orphan-cleanup
	// path (a book can exist with zero pieces and still have this action
	// run against it directly).
	if book.FilePath != nil {
		if err := os.Remove(*book.FilePath); err != nil && !os.IsNotExist(err) {
			s.Logger.Error("failed to remove book file after delete", "error", err, "bookId", book.ID, "filePath", *book.FilePath)
		}
	}
	// Cached page thumbnails (handleBookPageThumbnail) are keyed by bookId,
	// not tied to the piece rows just deleted above — a book cancelled out
	// of the upload wizard before any piece exists yet still needs this,
	// since its About/Split/Titles screens all render book-page thumbnails
	// straight from the original file.
	if err := purgeBookPageThumbnails(s.Cfg.DataDir, book.ID); err != nil {
		s.Logger.Error("failed to purge cached page thumbnails after book delete", "error", err, "bookId", book.ID)
	}
	// Same pointer-dereference note as handleDeletePiece's orphan-cleanup
	// logging — slog's default %v on a *string logs the pointer address.
	fileHash := "(none)"
	if book.FileHash != nil {
		fileHash = *book.FileHash
	}
	s.Logger.Info("book deleted", "bookId", book.ID, "fileHash", fileHash, "bookTitle", book.BookTitle,
		"pieceCount", len(deletedPieces), "reason", "direct delete (cascade)")

	api.WriteData(w, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

// handleBookPageThumbnail renders (and caches) a single page of a book as
// a PNG, for the wizard's split step (design doc §5) and the basic piece
// preview (§7).
func (s *Server) handleBookPageThumbnail(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}
	page, err := strconv.Atoi(r.PathValue("page"))
	if err != nil || page < 1 {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid page number")
		return
	}

	b, err := repo.GetBookByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	// A manually created Book (migration 00014) has no file to render a
	// page from at all — a clean 404 here, not a nil-pointer panic.
	if b.FilePath == nil {
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "this book has no file")
		return
	}

	thumbPath, err := s.cachedThumbnail(r.Context(), *b.FilePath, page, 100, fmt.Sprintf("book-%d-page-%d", id, page))
	if err != nil {
		s.writeError(w, err)
		return
	}

	http.ServeFile(w, r, thumbPath)
}

// detectImageContentType validates that path is a real, decodable image and
// returns its MIME type — sniffed once at upload time (image.DecodeConfig
// only reads the header, not the full image, so this is cheap regardless of
// file size) rather than trusting the client-supplied filename/Content-Type,
// same "don't trust the upload, verify it" posture as stageUpload's own
// pdf.PageCount check for book/piece PDFs. Only the three formats the Go
// standard library decodes without a third-party dependency are accepted.
func detectImageContentType(path string) (string, bool) {
	f, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer f.Close()

	_, format, err := image.DecodeConfig(f)
	if err != nil {
		return "", false
	}
	switch format {
	case "png":
		return "image/png", true
	case "jpeg":
		return "image/jpeg", true
	case "gif":
		return "image/gif", true
	default:
		return "", false
	}
}

// handleGetBookCover is the one URL every part of the frontend uses to show
// "this book's cover" (Book Details header, Books library cards) — it
// decides the fallback chain server-side (custom cover, then the derived
// first-page-of-PDF thumbnail, then 404) so no call site needs to
// special-case which source a given book's cover actually comes from.
func (s *Server) handleGetBookCover(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}
	b, err := repo.GetBookByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}

	if b.CoverImageHash != nil {
		// Set explicitly before ServeFile: http.ServeContent only falls
		// back to extension/content-sniffing when the Content-Type header
		// isn't already present, and CoverImagePath has no extension to
		// sniff from (see that function's own comment).
		w.Header().Set("Content-Type", *b.CoverImageContentType)
		http.ServeFile(w, r, storage.CoverImagePath(s.Cfg.DataDir, *b.CoverImageHash))
		return
	}
	if b.FilePath != nil {
		thumbPath, err := s.cachedThumbnail(r.Context(), *b.FilePath, 1, 100, fmt.Sprintf("book-%d-page-1", id))
		if err != nil {
			s.writeError(w, err)
			return
		}
		http.ServeFile(w, r, thumbPath)
		return
	}
	api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "this book has no cover")
}

// handleUploadBookCover sets/replaces a Book's manually uploaded custom
// cover image (migration 00018) — independent of whether the book already
// has a real PDF file: a book with a perfectly good derived thumbnail can
// still have it overridden, not just a book with no cover to begin with.
// Same move-into-place-then-transaction-then-orphan-cleanup shape as
// handleReplacePieceFile.
func (s *Server) handleUploadBookCover(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}

	file, _, ok := requireMultipartFile(w, r)
	if !ok {
		return
	}
	defer file.Close()

	stagingDir := filepath.Join(s.Cfg.DataDir, "library", "covers")
	tempPath, hash, _, err := storage.SaveStreamed(stagingDir, file)
	if err != nil {
		s.writeError(w, err)
		return
	}

	contentType, valid := detectImageContentType(tempPath)
	if !valid {
		os.Remove(tempPath)
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError,
			"uploaded file is not a valid image (PNG, JPEG, or GIF)")
		return
	}

	newPath := storage.CoverImagePath(s.Cfg.DataDir, hash)
	// Content-addressed storage means newPath may already exist (this
	// upload happens to match another book's cover, or this book's own
	// previous cover being re-uploaded) — remember that before moving, same
	// caveat as handleReplacePieceFile.
	_, statErr := os.Stat(newPath)
	newPathPreexisted := statErr == nil
	if err := storage.MoveIntoPlace(tempPath, newPath); err != nil {
		s.writeError(w, err)
		return
	}

	var oldHash *string
	var resp *api.BookResponse
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		b, err := repo.GetBookByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		oldHash = b.CoverImageHash

		if err := repo.UpdateBookCoverImage(r.Context(), tx, id, &hash, &contentType); err != nil {
			return err
		}
		b.CoverImageHash = &hash
		b.CoverImageContentType = &contentType

		resp, err = api.BuildBookResponse(r.Context(), tx, b)
		return err
	})
	if err != nil {
		if !newPathPreexisted {
			os.Remove(newPath)
		}
		s.writeError(w, err)
		return
	}

	if oldHash != nil && *oldHash != hash {
		remaining, err := repo.CountBooksWithCoverImageHash(r.Context(), s.DB, *oldHash)
		if err != nil {
			s.Logger.Error("failed to check old cover image hash reference count after replace",
				"error", err, "bookId", id, "coverImageHash", *oldHash)
		} else if remaining == 0 {
			oldPath := storage.CoverImagePath(s.Cfg.DataDir, *oldHash)
			if err := os.Remove(oldPath); err != nil && !os.IsNotExist(err) {
				s.Logger.Error("failed to remove old book cover image after replace",
					"error", err, "bookId", id, "filePath", oldPath)
			}
		}
	}

	s.Logger.Info("book cover image set", "bookId", id, "coverImageHash", hash)

	api.WriteData(w, http.StatusOK, resp)
}

// handleDeleteBookCover clears a Book's custom cover image, reverting to
// the derived first-page-of-PDF thumbnail (or the "No-File Cover"
// placeholder). Same orphan-cleanup-then-log shape as the piece/book file
// deletion paths elsewhere in this file.
func (s *Server) handleDeleteBookCover(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}

	var oldHash *string
	var resp *api.BookResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		b, err := repo.GetBookByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		oldHash = b.CoverImageHash

		if oldHash != nil {
			if err := repo.UpdateBookCoverImage(r.Context(), tx, id, nil, nil); err != nil {
				return err
			}
			b.CoverImageHash = nil
			b.CoverImageContentType = nil
		}

		resp, err = api.BuildBookResponse(r.Context(), tx, b)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	if oldHash != nil {
		remaining, err := repo.CountBooksWithCoverImageHash(r.Context(), s.DB, *oldHash)
		if err != nil {
			s.Logger.Error("failed to check cover image hash reference count after remove",
				"error", err, "bookId", id, "coverImageHash", *oldHash)
		} else if remaining == 0 {
			oldPath := storage.CoverImagePath(s.Cfg.DataDir, *oldHash)
			if err := os.Remove(oldPath); err != nil && !os.IsNotExist(err) {
				s.Logger.Error("failed to remove book cover image after remove",
					"error", err, "bookId", id, "filePath", oldPath)
			}
		}
		s.Logger.Info("book cover image removed", "bookId", id, "coverImageHash", *oldHash)
	}

	api.WriteData(w, http.StatusOK, resp)
}

// handleDownloadBookFile is the Book Details page's "Open Book PDF"
// button — mirrors handleDownloadPieceFile (piece.go) closely: Content-
// Disposition "inline" (not "attachment") opens the original file in a
// new tab rather than forcing a download, with the same "<composer/
// arranger/publisher> - <title> (<yearWritten>).pdf" filename hint. A
// Book has nothing to inherit from (it's the top of the hierarchy), so
// this reads its own columns directly rather than going through
// repo.ResolveEffective (that's piece-only). A manually created Book
// (migration 00014) has no file at all — a clean 404, same guard
// handleBookPageThumbnail already uses, not a nil-pointer panic.
func (s *Server) handleDownloadBookFile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}
	b, err := repo.GetBookByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if b.FilePath == nil {
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "this book has no file")
		return
	}
	var publisher, yearWritten string
	if b.Publisher != nil {
		publisher = *b.Publisher
	}
	if b.YearWritten != nil {
		yearWritten = *b.YearWritten
	}
	// Composer/Arranger are ordered lists now (migration 00020) — joined
	// into a single display name via joinPersonNames, same treatment as
	// handleDownloadPieceFile's own resolution.
	composerNames, err := personNames(r.Context(), s.DB, b.ComposerIDs)
	if err != nil {
		s.writeError(w, err)
		return
	}
	arrangerNames, err := personNames(r.Context(), s.DB, b.ArrangerIDs)
	if err != nil {
		s.writeError(w, err)
		return
	}
	filename := downloadFilename(joinPersonNames(composerNames), joinPersonNames(arrangerNames), publisher, b.BookTitle, yearWritten)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", filename+".pdf"))
	http.ServeFile(w, r, *b.FilePath)
}
