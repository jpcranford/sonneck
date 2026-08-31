package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/wikipedia"
)

// handleWikipediaSearch is the Edit Person modal's and Upload Portrait's
// shared Wikipedia autofill endpoint (composer/arranger overhaul) —
// unlike IMSLP's number-based lookup (one precise identifier resolving to
// exactly one work), a person's *name* is inherently ambiguous, so this
// returns a real disambiguation list for the human to pick from, rather
// than a single resolved result. A blank query returns an empty list
// (wikipedia.Search's own no-request-made short-circuit) rather than a
// validation error — the frontend's own "type a name first" gate already
// keeps this from ever being called with nothing typed, and a genuinely
// empty result list is exactly what "no name entered yet" should read as
// to whatever UI called this.
func (s *Server) handleWikipediaSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")

	results, err := wikipedia.Search(r.Context(), query)
	if err != nil {
		// A real external-service failure, not the caller's fault — same
		// WARN-not-ERROR posture as handleImslpLookup's own external-
		// service failure, so a routine "Wikipedia is slow/down right
		// now" blip doesn't read as loud as an actual application bug.
		s.Logger.Warn("wikipedia search failed", "query", query, "error", err)
		api.WriteError(w, http.StatusBadGateway, api.CodeInternalError, "could not reach Wikipedia")
		return
	}
	api.WriteData(w, http.StatusOK, results)
}

// handleWikipediaPageImage resolves a Wikipedia page title (as returned
// by handleWikipediaSearch) to its lead image URL — Upload Portrait's own
// "use this Wikipedia result as my portrait source" step. The frontend
// loads the returned URL directly into a cross-origin-enabled <img> for
// its own client-side crop/zoom canvas (confirmed live, 2026-08-31:
// upload.wikimedia.org serves Access-Control-Allow-Origin: *, so no
// server-side image proxy is needed here — this endpoint only resolves
// *which* URL to use, it never fetches or re-serves the image bytes
// itself).
func (s *Server) handleWikipediaPageImage(w http.ResponseWriter, r *http.Request) {
	title := strings.TrimSpace(r.URL.Query().Get("title"))
	if title == "" {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "title is required")
		return
	}

	imageURL, err := wikipedia.PageImage(r.Context(), title)
	switch {
	case errors.Is(err, wikipedia.ErrPageNotFound):
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "no Wikipedia page found for that title")
	case err != nil:
		s.Logger.Warn("wikipedia page-image lookup failed", "title", title, "error", err)
		api.WriteError(w, http.StatusBadGateway, api.CodeInternalError, "could not reach Wikipedia")
	default:
		api.WriteData(w, http.StatusOK, map[string]*string{"imageUrl": nonEmptyOrNil(imageURL)})
	}
}

func nonEmptyOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
