package handlers

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/storage"
)

// personSortColumns backs the People Library's own sort control (mockup:
// Name/Piece Count/Birth Year/Death Year/Date Added). pieceCount is a
// scalar subquery mirroring repo.CountPiecesForPerson's own UNION query —
// there's no stored column to sort by directly. birthYear/deathYear use
// the same direction-invariant "blank sorts last" clause as
// bookSortColumns' yearWritten, for the same reason (SQLite's own
// NULL-sorts-first-on-ASC default would otherwise put an unknown-year
// person at the front of an ascending list).
var personSortColumns = map[string]sortColumnFunc{
	"dateAdded": simpleSortColumn("id"),
	"name":      simpleSortColumn("name COLLATE NOCASE"),
	"pieceCount": func(dir string) string {
		const expr = `(SELECT COUNT(DISTINCT piece_id) FROM (
			SELECT piece_id FROM piece_composers WHERE person_id = people.id
			UNION
			SELECT piece_id FROM piece_arrangers WHERE person_id = people.id
		))`
		return expr + " " + dir
	},
	"birthYear": func(dir string) string {
		return "(birth_year IS NULL) ASC, birth_year " + dir
	},
	"deathYear": func(dir string) string {
		return "(death_year IS NULL) ASC, death_year " + dir
	},
}

// handleListPeople is the People Library's own browse/search, and — reused
// unpaginated — the Edit Piece/Book Modal's composer/arranger TagComboBox
// picker source (a Person is a real library entity with its own page,
// unlike Key/Instrument/SheetType's small-fixed-list lookup endpoints, so
// one endpoint serves both, matching how GET /api/pieces already serves
// both the Library page and sourceBookId-scoped lookups). No limit/offset
// — same "small personal-library scale" assumption Key/Instrument's own
// always-return-everything lookups already make.
func (s *Server) handleListPeople(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	var where []string
	var args []any
	sqlStr := `SELECT id FROM people`

	if query := strings.TrimSpace(q.Get("query")); query != "" {
		where = append(where, "name LIKE ?")
		args = append(args, "%"+query+"%")
	}
	if len(where) > 0 {
		sqlStr += " WHERE " + strings.Join(where, " AND ")
	}

	sortOrderBy, ok := parseSort(w, q, personSortColumns, "name")
	if !ok {
		return
	}
	sqlStr += " ORDER BY " + sortOrderBy + ", id DESC"

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

	results := make([]*api.PersonResponse, 0, len(ids))
	for _, id := range ids {
		p, err := repo.GetPersonByID(r.Context(), s.DB, id)
		if err != nil {
			s.writeError(w, err)
			return
		}
		resp, err := api.BuildPersonResponse(r.Context(), s.DB, p)
		if err != nil {
			s.writeError(w, err)
			return
		}
		results = append(results, resp)
	}

	api.WriteData(w, http.StatusOK, results)
}

func (s *Server) handleCreatePerson(w http.ResponseWriter, r *http.Request) {
	var req api.PersonCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var resp *api.PersonResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		p := &models.Person{
			Name:      req.Name,
			BirthYear: req.BirthYear,
			DeathYear: req.DeathYear,
		}
		if errs := api.ValidatePerson(p); len(errs) > 0 {
			return errs
		}

		id, err := repo.CreatePerson(r.Context(), tx, p)
		if err != nil {
			return err
		}
		created, err := repo.GetPersonByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		resp, err = api.BuildPersonResponse(r.Context(), tx, created)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusCreated, resp)
}

func (s *Server) handleGetPerson(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid person id")
		return
	}
	p, err := repo.GetPersonByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildPersonResponse(r.Context(), s.DB, p)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleUpdatePerson is the Edit Person modal's submission — Name/Bio/
// BirthYear/DeathYear only (portrait is its own dedicated endpoint below,
// same "small action, not the general write path" treatment as Book's
// cover image). A name change ripples to every work/book crediting this
// person (their credit resolves live, no denormalization — same reasoning
// a Book field edit already fans out to its pieces), so this resyncs the
// search index for every affected piece, same as ResyncSearchIndexForBook.
func (s *Server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid person id")
		return
	}

	var req api.PersonWriteRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var resp *api.PersonResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		p, err := repo.GetPersonByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		p.Name = req.Name
		p.Bio = req.Bio
		p.BirthYear = req.BirthYear
		p.DeathYear = req.DeathYear

		if errs := api.ValidatePerson(p); len(errs) > 0 {
			return errs
		}

		if err := repo.UpdatePerson(r.Context(), tx, p); err != nil {
			return err
		}

		affected, err := repo.AffectedPieceIDsForPerson(r.Context(), tx, id)
		if err != nil {
			return err
		}
		for _, pieceID := range affected {
			if err := repo.ResyncSearchIndex(r.Context(), tx, pieceID); err != nil {
				return err
			}
		}

		resp, err = api.BuildPersonResponse(r.Context(), tx, p)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, resp)
}

// handleDeletePerson removes the person row outright (their own credit
// rows cascade via ON DELETE CASCADE) — the People Library's direct
// "Delete Person" action, distinct from Split People below, which
// deliberately leaves the row in place with zero credits. Every affected
// piece's pieces_fts row is resynced in the same transaction, same as a
// name edit, since a deleted person's name should stop appearing in
// search the instant the row is gone.
func (s *Server) handleDeletePerson(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid person id")
		return
	}

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		p, err := repo.GetPersonByID(r.Context(), tx, id)
		if err != nil {
			return err
		}

		affected, err := repo.AffectedPieceIDsForPerson(r.Context(), tx, id)
		if err != nil {
			return err
		}

		if err := repo.DeletePerson(r.Context(), tx, id); err != nil {
			return err
		}

		for _, pieceID := range affected {
			if err := repo.ResyncSearchIndex(r.Context(), tx, pieceID); err != nil {
				return err
			}
		}

		s.Logger.Info("person deleted", "personId", id, "name", p.Name)
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// handleSplitPerson reassigns every one of this person's credits to one or
// more replacement people, in order (Split People, Person Details) — the
// person's own row is deliberately not deleted, matching the already-
// approved mockup's own stated behavior ("isn't deleted — they're just
// left with zero credits afterward"). At least one replacement name is
// required.
func (s *Server) handleSplitPerson(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid person id")
		return
	}

	var req api.PersonSplitRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var resp *api.PersonResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := repo.GetPersonByID(r.Context(), tx, id); err != nil {
			return err
		}

		replacementIDs, err := resolveTagNames(r.Context(), tx, repo.FindOrCreatePerson, req.ReplacementNames, "replacementNames")
		if err != nil {
			return err
		}
		if len(replacementIDs) == 0 {
			return api.ValidationErrors{{Field: "replacementNames", Message: "at least one replacement is required"}}
		}

		affected, err := repo.SplitPerson(r.Context(), tx, id, replacementIDs)
		if err != nil {
			return err
		}
		for _, pieceID := range affected {
			if err := repo.ResyncSearchIndex(r.Context(), tx, pieceID); err != nil {
				return err
			}
		}

		p, err := repo.GetPersonByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		resp, err = api.BuildPersonResponse(r.Context(), tx, p)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, resp)
}

// handleGetPersonPortrait/handleUploadPersonPortrait/
// handleDeletePersonPortrait mirror handleGetBookCover/
// handleUploadBookCover/handleDeleteBookCover exactly — same content-
// addressed storage (storage.PortraitImagePath), same Content-Type-sniffed-
// at-upload-time convention. The one real difference: a Person has no
// derived-thumbnail fallback the way a Book falls back to its own page-1
// render — no file, no custom portrait means a clean 404 (the frontend's
// own initials/bust placeholder takes over from there, entirely client-
// side, same as it already does for a person with no portraitImageHash).
func (s *Server) handleGetPersonPortrait(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid person id")
		return
	}
	p, err := repo.GetPersonByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if p.PortraitImageHash == nil {
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "this person has no portrait")
		return
	}
	w.Header().Set("Content-Type", *p.PortraitImageContentType)
	http.ServeFile(w, r, storage.PortraitImagePath(s.Cfg.DataDir, *p.PortraitImageHash))
}

func (s *Server) handleUploadPersonPortrait(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid person id")
		return
	}

	file, _, ok := requireMultipartFile(w, r)
	if !ok {
		return
	}
	defer file.Close()

	stagingDir := filepath.Join(s.Cfg.DataDir, "library", "portraits")
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

	newPath := storage.PortraitImagePath(s.Cfg.DataDir, hash)
	_, statErr := os.Stat(newPath)
	newPathPreexisted := statErr == nil
	if err := storage.MoveIntoPlace(tempPath, newPath); err != nil {
		s.writeError(w, err)
		return
	}

	var oldHash *string
	var resp *api.PersonResponse
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		p, err := repo.GetPersonByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		oldHash = p.PortraitImageHash

		if err := repo.UpdatePersonPortraitImage(r.Context(), tx, id, &hash, &contentType); err != nil {
			return err
		}
		p.PortraitImageHash = &hash
		p.PortraitImageContentType = &contentType

		resp, err = api.BuildPersonResponse(r.Context(), tx, p)
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
		remaining, err := repo.CountPeopleWithPortraitImageHash(r.Context(), s.DB, *oldHash)
		if err != nil {
			s.Logger.Error("failed to check old portrait image hash reference count after replace",
				"error", err, "personId", id, "portraitImageHash", *oldHash)
		} else if remaining == 0 {
			oldPath := storage.PortraitImagePath(s.Cfg.DataDir, *oldHash)
			if err := os.Remove(oldPath); err != nil && !os.IsNotExist(err) {
				s.Logger.Error("failed to remove old portrait image after replace",
					"error", err, "personId", id, "filePath", oldPath)
			}
		}
	}

	s.Logger.Info("person portrait image set", "personId", id, "portraitImageHash", hash)

	api.WriteData(w, http.StatusOK, resp)
}

func (s *Server) handleDeletePersonPortrait(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid person id")
		return
	}

	var oldHash *string
	var resp *api.PersonResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		p, err := repo.GetPersonByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		oldHash = p.PortraitImageHash

		if oldHash != nil {
			if err := repo.UpdatePersonPortraitImage(r.Context(), tx, id, nil, nil); err != nil {
				return err
			}
			p.PortraitImageHash = nil
			p.PortraitImageContentType = nil
		}

		resp, err = api.BuildPersonResponse(r.Context(), tx, p)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	if oldHash != nil {
		remaining, err := repo.CountPeopleWithPortraitImageHash(r.Context(), s.DB, *oldHash)
		if err != nil {
			s.Logger.Error("failed to check old portrait image hash reference count after delete",
				"error", err, "personId", id, "portraitImageHash", *oldHash)
		} else if remaining == 0 {
			oldPath := storage.PortraitImagePath(s.Cfg.DataDir, *oldHash)
			if err := os.Remove(oldPath); err != nil && !os.IsNotExist(err) {
				s.Logger.Error("failed to remove portrait image after delete",
					"error", err, "personId", id, "filePath", oldPath)
			}
		}
		s.Logger.Info("person portrait image removed", "personId", id)
	}

	api.WriteData(w, http.StatusOK, resp)
}
