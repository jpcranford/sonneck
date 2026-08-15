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
	"strconv"

	"github.com/jpcranford/picarda/internal/api"
	"github.com/jpcranford/picarda/internal/pdf"
	"github.com/jpcranford/picarda/internal/repo"
	"github.com/jpcranford/picarda/internal/storage"
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
