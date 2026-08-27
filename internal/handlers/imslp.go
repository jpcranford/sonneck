package handlers

import (
	"errors"
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/imslp"
)

// handleImslpLookup is the "IMSLP live autofill" endpoint (design doc
// §13, deferred there — see internal/imslp's own package comment for the
// real IMSLP-access research this is built on). Read-only, no
// piece/book id involved: the frontend already has the number in hand
// (typed, or filename-detected on upload) and applies whatever comes
// back itself, field by field, only into fields that are currently
// blank — this endpoint just resolves the number, it doesn't know or
// care which piece/book is asking.
func (s *Server) handleImslpLookup(w http.ResponseWriter, r *http.Request) {
	number := r.URL.Query().Get("number")
	if number == "" {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "number is required")
		return
	}

	info, err := imslp.Lookup(r.Context(), number)
	switch {
	case errors.Is(err, imslp.ErrInvalidNumber):
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "number must be non-empty digits only")
	case errors.Is(err, imslp.ErrNotFound):
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "no IMSLP work found for that number")
	case err != nil:
		// Not the caller's fault (a malformed number is caught above) —
		// a real external-service failure, worth a WARN so it's visible
		// in production logs without treating a routine "IMSLP is slow/
		// down right now" blip as loud as an actual application bug.
		s.Logger.Warn("imslp lookup failed", "number", number, "error", err)
		api.WriteError(w, http.StatusBadGateway, api.CodeInternalError, "could not reach IMSLP")
	default:
		api.WriteData(w, http.StatusOK, info)
	}
}
