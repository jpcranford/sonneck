package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
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
func requireMultipartFile(w http.ResponseWriter, r *http.Request) (multipart.File, *multipart.FileHeader, bool) {
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
// same not-yet-cached page (e.g. the Piece View and a Library card
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
