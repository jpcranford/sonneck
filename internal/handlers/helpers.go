package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/pdf"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/storage"
)

// MaxUploadBytes bounds request bodies on every upload endpoint. Set well
// above realistic scanned-book PDF sizes (design doc §9 anticipates
// "100+MB book PDFs") rather than tightly — this exists to stop a
// runaway/malicious upload from filling disk, not to constrain normal use.
// A var, not a const, so tests can shrink it rather than needing to
// generate an actual 500MB+ request body to exercise the limit.
var MaxUploadBytes int64 = 500 << 20 // 500MB

// requireMultipartFile applies the upload size cap, parses the multipart
// form, and pulls out the required "file" field — the same three steps
// every upload handler (single-piece, book, replace-file) needs, written
// once here instead of three times.
//
// The X-Requested-With check below closes a real CSRF gap: multipart/
// form-data is one of the fetch spec's CORS-safelisted content types, so
// a plain cross-origin HTML form
// targeting this endpoint was never preflighted by the browser — CORS only
// stops attacker JS from *reading* the response, not from the request
// executing server-side. There's no auth to check an Origin/Referer
// against yet (design doc §8), so this instead requires a header a plain
// HTML form can never set, which forces the browser to preflight — and
// since this server sets no CORS response headers at all (single-origin by
// design), any cross-origin preflight fails closed. The real frontend
// (frontend/src/api/client.ts's uploadRequest) sends this on every upload;
// a same-origin request never triggers a preflight for it regardless, so
// this adds no real round-trip for legitimate use.
func requireMultipartFile(w http.ResponseWriter, r *http.Request) (multipart.File, *multipart.FileHeader, bool) {
	if r.Header.Get("X-Requested-With") != "XMLHttpRequest" {
		api.WriteError(w, http.StatusForbidden, api.CodeValidationError, "missing required X-Requested-With header")
		return nil, nil, false
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			api.WriteError(w, http.StatusRequestEntityTooLarge, api.CodeValidationError,
				fmt.Sprintf("upload exceeds the %d MB limit", MaxUploadBytes>>20))
		} else {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "could not parse multipart upload: "+err.Error())
		}
		return nil, nil, false
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, `missing "file" field`)
		return nil, nil, false
	}
	return file, header, true
}

// stageUpload streams file into stagingDir (hashing incrementally via
// storage.SaveStreamed) and validates the result is a real PDF via
// pdf.PageCount — the save-then-validate sequence every upload handler
// (single-piece, book, replace-file) needs before deciding the file's
// permanent content-addressed home. On failure this cleans up the temp
// file and writes the {error} response itself; callers just return.
// pageCount is returned for the one caller (book upload) that reports it
// back to the client; the others simply ignore it.
func (s *Server) stageUpload(w http.ResponseWriter, r *http.Request, stagingDir string, file multipart.File) (tempPath, hash string, pageCount int, ok bool) {
	tempPath, hash, _, err := storage.SaveStreamed(stagingDir, file)
	if err != nil {
		s.writeError(w, err)
		return "", "", 0, false
	}

	pageCount, err = pdf.PageCount(r.Context(), tempPath)
	if err != nil {
		os.Remove(tempPath)
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "uploaded file is not a valid PDF")
		return "", "", 0, false
	}

	return tempPath, hash, pageCount, true
}

// cachedThumbnail returns the path to a cached page-thumbnail PNG for
// srcPath, rendering (via pdftoppm) and caching it under cacheKey on a
// miss. Used by both handlePieceThumbnail and handleBookPageThumbnail.
//
// Renders to a private temp file first and atomically renames it into
// place with storage.MoveIntoPlace, rather than having pdftoppm write
// straight to the final cache path. Two concurrent first-requests for the
// same not-yet-cached page (e.g. the Piece Details page and a Library card
// prefetching the same thumbnail at once) would otherwise both pass the
// existence check and both invoke pdftoppm with the *same* output path,
// racing to write the same file — the loser's partial/interleaved write
// can leave a torn PNG on disk that then "exists" forever, since the
// existence check alone gates regeneration. Rendering to a unique temp
// name means each request writes its own complete file; whichever renames
// into place first wins, and MoveIntoPlace already discards the other
// (content-addressed storage's own dedupe rule, reused here for the same
// reason).
func (s *Server) cachedThumbnail(ctx context.Context, srcPath string, page, dpi int, cacheKey string) (string, error) {
	cacheDir := filepath.Join(s.Cfg.DataDir, "cache", "thumbnails")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", err
	}

	thumbPath := filepath.Join(cacheDir, cacheKey+".png")
	if _, err := os.Stat(thumbPath); err == nil {
		return thumbPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	tmpPNG, err := s.renderThumbnailToTemp(ctx, cacheDir, srcPath, page, dpi, cacheKey)
	if err != nil {
		return "", err
	}
	if err := storage.MoveIntoPlace(tmpPNG, thumbPath); err != nil {
		os.Remove(tmpPNG)
		return "", err
	}

	return thumbPath, nil
}

// renderThumbnailToTemp renders page of srcPath to a private, uniquely
// named temp PNG inside cacheDir (via a reserved-then-freed name from
// os.CreateTemp, since pdftoppm needs to create the file itself given a
// bare prefix) — the render step shared by cachedThumbnail's on-miss path
// and regenerateThumbnail's always-render path.
func (s *Server) renderThumbnailToTemp(ctx context.Context, cacheDir, srcPath string, page, dpi int, cacheKey string) (string, error) {
	tmpFile, err := os.CreateTemp(cacheDir, cacheKey+"-*.tmp")
	if err != nil {
		return "", err
	}
	tmpPrefix := strings.TrimSuffix(tmpFile.Name(), ".tmp")
	tmpFile.Close()
	os.Remove(tmpFile.Name())

	return pdf.RenderThumbnail(ctx, srcPath, page, dpi, tmpPrefix)
}

// regenerateThumbnail force-renders page of srcPath, unconditionally
// replacing any existing cache entry — unlike cachedThumbnail, which skips
// rendering if thumbPath already exists. Used by the regenerate-thumbnails
// CLI subcommand (CLAUDE.md > Search's general admin/maintenance pattern)
// to recover from a corrupted cache entry without needing to know which
// ones are bad. Still renders to a private temp file and renames into
// place — os.Rename atomically replaces an existing destination on POSIX,
// so a reader (a concurrent live HTTP request for the same page) never
// observes a partially-written file, same guarantee as cachedThumbnail.
func (s *Server) regenerateThumbnail(ctx context.Context, srcPath string, page, dpi int, cacheKey string) (string, error) {
	cacheDir := filepath.Join(s.Cfg.DataDir, "cache", "thumbnails")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", err
	}

	tmpPNG, err := s.renderThumbnailToTemp(ctx, cacheDir, srcPath, page, dpi, cacheKey)
	if err != nil {
		return "", err
	}

	thumbPath := filepath.Join(cacheDir, cacheKey+".png")
	if err := os.Rename(tmpPNG, thumbPath); err != nil {
		os.Remove(tmpPNG)
		return "", err
	}
	return thumbPath, nil
}

// RegenerateThumbnails force-regenerates every piece's page thumbnails from
// scratch — the manual recovery path behind the regenerate-thumbnails CLI
// subcommand. Clears data/cache/thumbnails entirely first (it's derived
// data, same "safely dropped and rebuilt" philosophy as pieces_fts, CLAUDE.md
// > Search) so any corrupted or orphaned entry (a deleted piece, a page
// beyond the current PageCount, a stale book-import thumbnail) is gone too,
// not just the ones a caller happens to know about — then re-renders one
// PNG per page of every piece still in the library. Returns the count
// regenerated for the caller to report.
func (s *Server) RegenerateThumbnails(ctx context.Context) (int, error) {
	cacheDir := filepath.Join(s.Cfg.DataDir, "cache", "thumbnails")
	entries, err := os.ReadDir(cacheDir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, err
	}
	for _, e := range entries {
		if err := os.Remove(filepath.Join(cacheDir, e.Name())); err != nil {
			return 0, err
		}
	}

	ids, err := repo.AllPieceIDs(ctx, s.DB)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, id := range ids {
		p, err := repo.GetPieceByID(ctx, s.DB, id)
		if err != nil {
			return count, err
		}
		for page := 1; page <= p.PageCount; page++ {
			cacheKey := fmt.Sprintf("piece-%d-page-%d", p.ID, page)
			if _, err := s.regenerateThumbnail(ctx, p.FilePath, page, 100, cacheKey); err != nil {
				return count, fmt.Errorf("piece %d page %d: %w", p.ID, page, err)
			}
			count++
		}
	}
	return count, nil
}

// purgeBookPageThumbnails removes every cached page-thumbnail PNG for
// bookID (cacheKey pattern "book-<id>-page-<n>", set by
// handleBookPageThumbnail) — called from handleDeleteBook so a deleted
// book doesn't leave orphaned cache entries behind. Derived data, same
// "safely dropped" reasoning as RegenerateThumbnails' full-cache wipe
// above, just scoped to one book's entries instead of all of them. A book
// with no file (FilePath nil) never had any page thumbnails rendered, but
// this is harmless to call regardless — the glob simply matches nothing.
func purgeBookPageThumbnails(dataDir string, bookID int64) error {
	cacheDir := filepath.Join(dataDir, "cache", "thumbnails")
	matches, err := filepath.Glob(filepath.Join(cacheDir, fmt.Sprintf("book-%d-page-*.png", bookID)))
	if err != nil {
		return err
	}
	for _, match := range matches {
		if err := os.Remove(match); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// purgeStaleBookThumbnailsAfterImport removes bookID's cached page
// thumbnails except page 1, once handleConfirmImport has committed —
// pages 2..N are pure duplicate render work from this point on: every
// piece just created is a real, physically split-out PDF of its own
// (handleConfirmImport extracts via pdf.ExtractPages into
// library/pieces/, a separate file from the book's own library/books/
// one), rendered and cached under its own "piece-<id>-page-<n>" key
// (handlePieceThumbnail, piece.go — always renders from the piece's own
// FilePath, never the book's). Nothing in the app requests a book's own
// page N>1 thumbnail again after import; leaving them cached is dead
// weight, not a live data source.
//
// Page 1 is deliberately spared, unlike purgeBookPageThumbnails' own
// unconditional full purge (used on book *deletion*, where nothing needs
// sparing): handleGetBookCover keeps serving "book-<id>-page-1" forever
// as the cover-image fallback for any book with no custom cover uploaded
// (Books library grid, Book Details header) — purging it here would just
// force an immediate, pointless re-render the moment either page is next
// viewed, typically seconds later when the wizard itself redirects to the
// newly-imported book. Sparing it regardless of whether this particular
// book actually has a custom cover keeps the logic simple; the cost of
// occasionally keeping one harmless, genuinely unused page-1 PNG around is
// negligible next to that complexity.
//
// The book's own source PDF (Book.FilePath) is never touched by this —
// only derived cache entries, same "safe to drop and rebuild" status as
// purgeBookPageThumbnails' own full purge.
func purgeStaleBookThumbnailsAfterImport(dataDir string, bookID int64) error {
	cacheDir := filepath.Join(dataDir, "cache", "thumbnails")
	matches, err := filepath.Glob(filepath.Join(cacheDir, fmt.Sprintf("book-%d-page-*.png", bookID)))
	if err != nil {
		return err
	}
	keep := fmt.Sprintf("book-%d-page-1.png", bookID)
	for _, match := range matches {
		if filepath.Base(match) == keep {
			continue
		}
		if err := os.Remove(match); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

var (
	bookThumbnailCacheKey  = regexp.MustCompile(`^book-(\d+)-page-(\d+)\.png$`)
	pieceThumbnailCacheKey = regexp.MustCompile(`^piece-(\d+)-page-(\d+)\.png$`)
)

// CleanupThumbnailsResult reports what a CleanupThumbnails run actually did
// — the `cleanup-thumbnails` CLI subcommand logs these two counts.
type CleanupThumbnailsResult struct {
	Removed     int
	Regenerated int
}

// CleanupThumbnails is a single targeted pass over the whole
// data/cache/thumbnails directory — the routine-maintenance counterpart to
// RegenerateThumbnails' nuclear "wipe piece thumbnails and rebuild every
// one from scratch" option. Unlike that one, this doesn't touch anything
// that's already correct: it removes an entry only when nothing can ever
// read it again, and regenerates one only when it's actually corrupt,
// leaving everything else untouched. Two independent problems this catches
// that neither purgeBookPageThumbnails (deletion-time) nor
// purgeStaleBookThumbnailsAfterImport (import-time, this book only) ever
// will, because both are scoped to one book at the moment something
// happens to it:
//   - Book thumbnails left behind by a book deleted before the
//     purgeBookPageThumbnails fix existed (CLAUDE.md > File handling,
//     2026-08-24) — permanently orphaned until something like this runs.
//   - Stale (page 2+, or page-1-with-a-custom-cover) book thumbnails for
//     every book imported before purgeStaleBookThumbnailsAfterImport
//     existed — that fix only runs at the moment of a *new* import, not
//     retroactively for a library's existing history.
//
// Each cache filename is parsed back into an owning book/piece id + page
// number (bookThumbnailCacheKey/pieceThumbnailCacheKey) rather than
// starting from the database and asking "does this row's thumbnail exist"
// — the whole point is to find cache entries the database side has no
// record of needing at all, which a query starting from Piece/Book rows
// could never surface. A filename that doesn't match either pattern (e.g.
// a stray temp file from an interrupted render) is left alone rather than
// guessed at — conservative by design for a tool whose whole job is
// deleting files unattended.
func (s *Server) CleanupThumbnails(ctx context.Context) (CleanupThumbnailsResult, error) {
	cacheDir := filepath.Join(s.Cfg.DataDir, "cache", "thumbnails")
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return CleanupThumbnailsResult{}, nil
		}
		return CleanupThumbnailsResult{}, err
	}

	var result CleanupThumbnailsResult
	// Memoized per run: many page entries share the same owning book/piece,
	// and this dedupes both the DB lookups and (for books) the
	// PieceIDsForBook query rather than repeating them once per page.
	books := map[int64]*models.Book{}
	bookHasPieces := map[int64]bool{}
	pieces := map[int64]*models.Piece{}

	for _, e := range entries {
		name := e.Name()
		fullPath := filepath.Join(cacheDir, name)

		if m := bookThumbnailCacheKey.FindStringSubmatch(name); m != nil {
			bookID, _ := strconv.ParseInt(m[1], 10, 64)
			page, _ := strconv.Atoi(m[2])

			book, cached := books[bookID]
			if !cached {
				b, err := repo.GetBookByID(ctx, s.DB, bookID)
				if err != nil && !errors.Is(err, repo.ErrNotFound) {
					return result, err
				}
				book = b // nil when ErrNotFound — orphaned, handled below
				books[bookID] = book
			}

			if book == nil || book.FilePath == nil {
				// No book to own this entry at all, or (defensively — not
				// reachable via any current write path, since a file-less
				// book never gets a page thumbnail rendered in the first
				// place) a book with nothing to regenerate from either way.
				if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
					return result, err
				}
				result.Removed++
				continue
			}

			hasPieces, cached := bookHasPieces[bookID]
			if !cached {
				pieceIDs, err := repo.PieceIDsForBook(ctx, s.DB, bookID)
				if err != nil {
					return result, err
				}
				hasPieces = len(pieceIDs) > 0
				bookHasPieces[bookID] = hasPieces
			}

			if !hasPieces {
				// Not yet imported — still plausibly mid-wizard (About/
				// Split/Titles screens render every page directly), so
				// every page thumbnail is left alone regardless of page
				// number or custom-cover status.
				continue
			}

			// Imported: page 1 is only still a live dependency
			// (handleGetBookCover's fallback) when there's no custom
			// cover to prefer instead — every other page is definitionally
			// dead weight the instant this book has ≥1 piece, since every
			// piece renders from its own split-out file, never the book's
			// (handlePieceThumbnail's own doc comment).
			if page != 1 || book.CoverImageHash != nil {
				if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
					return result, err
				}
				result.Removed++
				continue
			}

			if isCorruptPNG(fullPath) {
				cacheKey := strings.TrimSuffix(name, ".png")
				if _, err := s.regenerateThumbnail(ctx, *book.FilePath, page, 100, cacheKey); err != nil {
					return result, fmt.Errorf("regenerating %s: %w", name, err)
				}
				result.Regenerated++
			}
			continue
		}

		if m := pieceThumbnailCacheKey.FindStringSubmatch(name); m != nil {
			pieceID, _ := strconv.ParseInt(m[1], 10, 64)
			page, _ := strconv.Atoi(m[2])

			piece, cached := pieces[pieceID]
			if !cached {
				p, err := repo.GetPieceByID(ctx, s.DB, pieceID)
				if err != nil && !errors.Is(err, repo.ErrNotFound) {
					return result, err
				}
				piece = p
				pieces[pieceID] = piece
			}

			// Orphaned (piece since deleted through some path that
			// predates handleDeletePiece's own thumbnail purge), or a
			// leftover page beyond the piece's current PageCount (e.g.
			// after a file replacement — design doc §14 — shrank it):
			// either way, nothing will ever request this page again.
			if piece == nil || page > piece.PageCount {
				if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
					return result, err
				}
				result.Removed++
				continue
			}

			if isCorruptPNG(fullPath) {
				cacheKey := strings.TrimSuffix(name, ".png")
				if _, err := s.regenerateThumbnail(ctx, piece.FilePath, page, 100, cacheKey); err != nil {
					return result, fmt.Errorf("regenerating %s: %w", name, err)
				}
				result.Regenerated++
			}
		}
	}

	return result, nil
}

// isCorruptPNG reports whether path can't be decoded as a valid PNG — the
// same failure mode CLAUDE.md > Search documents for RegenerateThumbnails'
// own reason for existing: a torn/truncated file from a page-render race.
// A file that can't even be opened counts as corrupt too (covers a 0-byte
// leftover from an interrupted render the same way).
func isCorruptPNG(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return true
	}
	defer f.Close()
	_, err = png.DecodeConfig(f)
	return err != nil
}

// withTx runs fn inside a transaction, committing on success and rolling
// back otherwise. Callers that need to resync the search index do so
// inside fn, in the same transaction as the mutation (CLAUDE.md > Search).
func (s *Server) withTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// writeError maps an error to the {error} envelope (CLAUDE.md > API
// response contract): validation failures become 400s, missing rows 404,
// anything else a logged 500 with no internal detail leaked to the client.
func (s *Server) writeError(w http.ResponseWriter, err error) {
	var verrs api.ValidationErrors
	if errors.As(err, &verrs) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, verrs.Error())
		return
	}
	if errors.Is(err, repo.ErrNotFound) {
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "not found")
		return
	}
	s.Logger.Error("internal error", "error", err)
	api.WriteError(w, http.StatusInternalServerError, api.CodeInternalError, "internal error")
}

// pathID parses an int64 path parameter (e.g. {id}), reporting failure
// rather than panicking on a malformed URL.
func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	return id, err == nil
}

func decodeJSON(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}
