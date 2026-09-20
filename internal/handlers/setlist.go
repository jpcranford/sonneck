package handlers

import (
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// handleListSetlists returns the calling user's own setlists — every one,
// active and archived alike (decision 12: one page, two scrolled
// sections, not two endpoints/query params).
func (s *Server) handleListSetlists(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	setlists, err := repo.ListSetlists(r.Context(), s.DB, user.ID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	summaries := make([]api.SetlistSummaryResponse, 0, len(setlists))
	for i := range setlists {
		summary, err := api.BuildSetlistSummaryResponse(r.Context(), s.DB, &setlists[i])
		if err != nil {
			s.writeError(w, err)
			return
		}
		summaries = append(summaries, *summary)
	}
	api.WriteData(w, http.StatusOK, summaries)
}

// handleListPieceSetlistMemberships answers "which of my setlists is each
// piece in" in one bulk call — the Library grid/list "already in a
// setlist" indicator (decision 6) and the Add to Setlist picker's own
// checked-state/remove flow both need this, and neither can afford one
// request per visible card.
func (s *Server) handleListPieceSetlistMemberships(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	memberships, err := repo.ListPieceSetlistMemberships(r.Context(), s.DB, user.ID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, memberships)
}

// setlistCreateRequest is POST /api/setlists' own body shape.
type setlistCreateRequest struct {
	Name        string  `json:"name"`
	GigDate     *string `json:"gigDate"`
	Description *string `json:"description"`
}

// handleCreateSetlist is the `create` permission's first and only real
// consumer (CLAUDE.md > Multi-user support's own long-standing
// reservation) — every other setlist endpoint below gates on `read`
// instead, since past creation this is the calling user's own data, same
// posture as Tags/Practice Status.
func (s *Server) handleCreateSetlist(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionCreate)
	if !ok {
		return
	}
	var req setlistCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if verrs := api.ValidateSetlistName(req.Name); verrs != nil {
		s.writeError(w, verrs)
		return
	}
	id, err := repo.CreateSetlist(r.Context(), s.DB, user.ID, req.Name, req.GigDate, req.Description)
	if err != nil {
		s.writeError(w, err)
		return
	}
	setlist, err := repo.GetSetlist(r.Context(), s.DB, user.ID, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildSetlistResponse(r.Context(), s.DB, setlist)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusCreated, resp)
}

func (s *Server) handleGetSetlist(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	setlist, err := repo.GetSetlist(r.Context(), s.DB, user.ID, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildSetlistResponse(r.Context(), s.DB, setlist)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// setlistUpdateRequest is PATCH /api/setlists/{id}'s own body shape — a
// full replace of every field at once (same convention as every other
// multi-field edit form in this app), not a partial patch: the caller
// always submits the whole current Setlist Details form state, Archived
// included (the Edit Setlist modal's own tab doesn't touch Archived, but
// the Setlist Details page's own dedicated Archive/Unarchive action does,
// through this same endpoint).
type setlistUpdateRequest struct {
	Name        string  `json:"name"`
	GigDate     *string `json:"gigDate"`
	Description *string `json:"description"`
	Archived    bool    `json:"archived"`
}

func (s *Server) handleUpdateSetlist(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	var req setlistUpdateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if verrs := api.ValidateSetlistName(req.Name); verrs != nil {
		s.writeError(w, verrs)
		return
	}
	if err := repo.UpdateSetlist(r.Context(), s.DB, user.ID, id, req.Name, req.GigDate, req.Description, req.Archived); err != nil {
		s.writeError(w, err)
		return
	}
	setlist, err := repo.GetSetlist(r.Context(), s.DB, user.ID, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildSetlistResponse(r.Context(), s.DB, setlist)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

func (s *Server) handleDeleteSetlist(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	if err := repo.DeleteSetlist(r.Context(), s.DB, user.ID, id); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"deleted": true})
}

// handleAddSetlistEntry appends one entry (a piece reference or a
// freeform custom row, api.ValidateSetlistEntryInput enforces exactly
// one) to the end of a setlist's own program.
func (s *Server) handleAddSetlistEntry(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	setlistID, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	if _, err := repo.GetSetlist(r.Context(), s.DB, user.ID, setlistID); err != nil {
		s.writeError(w, err)
		return
	}
	var in api.SetlistEntryInput
	if err := decodeJSON(r, &in); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if verrs := api.ValidateSetlistEntryInput(in); verrs != nil {
		s.writeError(w, verrs)
		return
	}
	_, err := repo.AddSetlistEntry(r.Context(), s.DB, setlistID, repo.AddSetlistEntryParams{
		PieceID:               in.PieceID,
		CustomName:            in.CustomName,
		CustomDurationSeconds: in.CustomDurationSeconds,
		CustomNotes:           in.CustomNotes,
		CustomCountsAsMusic:   in.CustomCountsAsMusic,
		Role:                  in.Role,
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	setlist, err := repo.GetSetlist(r.Context(), s.DB, user.ID, setlistID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildSetlistResponse(r.Context(), s.DB, setlist)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusCreated, resp)
}

// setlistEntryUpdateRequest edits an existing entry's own role, and — only
// meaningful for a custom entry — name/duration/notes/counts-as-music.
type setlistEntryUpdateRequest struct {
	Role                  *string `json:"role"`
	CustomName            *string `json:"customName"`
	CustomDurationSeconds *int    `json:"customDurationSeconds"`
	CustomNotes           *string `json:"customNotes"`
	CustomCountsAsMusic   bool    `json:"customCountsAsMusic"`
}

func (s *Server) handleUpdateSetlistEntry(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	setlistID, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	entryID, ok := pathID(r, "entryId")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid entry id")
		return
	}
	if _, err := repo.GetSetlist(r.Context(), s.DB, user.ID, setlistID); err != nil {
		s.writeError(w, err)
		return
	}
	entry, err := repo.GetSetlistEntry(r.Context(), s.DB, setlistID, entryID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	isCustom := entry.PieceID == nil

	var req setlistEntryUpdateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if isCustom && (req.CustomName == nil || len(*req.CustomName) == 0) {
		s.writeError(w, api.ValidationErrors{{Field: "customName", Message: "is required"}})
		return
	}
	if err := repo.UpdateSetlistEntry(r.Context(), s.DB, setlistID, entryID, isCustom, repo.UpdateSetlistEntryParams{
		Role:                  req.Role,
		CustomName:            req.CustomName,
		CustomDurationSeconds: req.CustomDurationSeconds,
		CustomNotes:           req.CustomNotes,
		CustomCountsAsMusic:   req.CustomCountsAsMusic,
	}); err != nil {
		s.writeError(w, err)
		return
	}
	setlist, err := repo.GetSetlist(r.Context(), s.DB, user.ID, setlistID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildSetlistResponse(r.Context(), s.DB, setlist)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

func (s *Server) handleRemoveSetlistEntry(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	setlistID, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	entryID, ok := pathID(r, "entryId")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid entry id")
		return
	}
	if _, err := repo.GetSetlist(r.Context(), s.DB, user.ID, setlistID); err != nil {
		s.writeError(w, err)
		return
	}
	if err := repo.RemoveSetlistEntry(r.Context(), s.DB, setlistID, entryID); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"deleted": true})
}

// setlistReorderRequest is PUT /api/setlists/{id}/entries/order's own body
// — the complete new ordering, sent whole on every drop (decision 22's
// real drag-to-any-position reorder), not an incremental up/down swap.
type setlistReorderRequest struct {
	EntryIDs []int64 `json:"entryIds"`
}

func (s *Server) handleReorderSetlistEntries(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	setlistID, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid id")
		return
	}
	if _, err := repo.GetSetlist(r.Context(), s.DB, user.ID, setlistID); err != nil {
		s.writeError(w, err)
		return
	}
	var req setlistReorderRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	existing, err := repo.ListSetlistEntries(r.Context(), s.DB, setlistID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	// The submitted order must be exactly the setlist's own current entry
	// set, just reordered — never a subset/superset — so a stale or
	// partial client-side list can't silently drop or orphan an entry's
	// sort_order. Checked here rather than trusted to
	// repo.ReorderSetlistEntries' own defensive scoped UPDATE, which
	// would otherwise just silently no-op on any id it doesn't recognize.
	if len(req.EntryIDs) != len(existing) {
		s.writeError(w, api.ValidationErrors{{Field: "entryIds", Message: "must include every entry in the setlist, exactly once"}})
		return
	}
	existingIDs := make(map[int64]bool, len(existing))
	for _, e := range existing {
		existingIDs[e.ID] = true
	}
	for _, id := range req.EntryIDs {
		if !existingIDs[id] {
			s.writeError(w, api.ValidationErrors{{Field: "entryIds", Message: "must include every entry in the setlist, exactly once"}})
			return
		}
	}

	if err := repo.ReorderSetlistEntries(r.Context(), s.DB, setlistID, req.EntryIDs); err != nil {
		s.writeError(w, err)
		return
	}
	setlist, err := repo.GetSetlist(r.Context(), s.DB, user.ID, setlistID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildSetlistResponse(r.Context(), s.DB, setlist)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}
