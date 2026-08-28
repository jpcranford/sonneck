package handlers

import (
	"net/http"
	"net/url"

	"github.com/jpcranford/sonneck/internal/api"
)

// sortColumnFunc builds the full ORDER BY expression for one sort field,
// given the resolved direction ("ASC"/"DESC"). A plain column just applies
// the direction as-is (see simpleSortColumn) — the common case. A field
// where a blank/absent value should always trail regardless of direction
// (composer falling back through book inheritance to nothing at all;
// yearWritten's free-text/non-numeric data) needs more than that: SQLite
// sorts NULL *first* in ASC by default, not last, so a naive single
// "expr DESC/ASC" fragment would put blank-composer pieces at the front of
// an ascending list instead of trailing them, which reads as broken, not
// helpful. Those fields prepend their own direction-invariant "is this
// blank" boolean clause (always ASC — blank sorts equally last whichever
// way the real values are ordered), ahead of the value's own
// direction-following clause.
type sortColumnFunc func(dir string) string

func simpleSortColumn(expr string) sortColumnFunc {
	return func(dir string) string {
		return expr + " " + dir
	}
}

// parseSort reads the `sort`/`dir` query params against a whitelist of
// known sort keys, returning the fully-composed ORDER BY expression for
// the resolved field+direction. Same 400-on-invalid-value posture as
// parseIDFilter — an unrecognized sort key or direction is a client error,
// not a silent fallback to the default, so a typo in a future caller fails
// loudly instead of quietly sorting wrong.
//
// columns must be fixed and hardcoded — whatever a sortColumnFunc returns
// ends up concatenated directly into the SQL string, so nothing derived
// from user input may ever appear in it.
func parseSort(w http.ResponseWriter, q url.Values, columns map[string]sortColumnFunc, defaultField string) (orderBy string, ok bool) {
	field := q.Get("sort")
	if field == "" {
		field = defaultField
	}
	fn, known := columns[field]
	if !known {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid sort")
		return "", false
	}

	var dir string
	switch v := q.Get("dir"); v {
	case "", "desc":
		dir = "DESC"
	case "asc":
		dir = "ASC"
	default:
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid dir")
		return "", false
	}

	return fn(dir), true
}
