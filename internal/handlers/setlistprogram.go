package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// Setlist Details' "Copy program as Markdown" / "Copy program as plain
// text" (design D, picked from a side-by-side): the program as a printed
// program would list it — role, title (opus) and credit, custom entries
// unnumbered between the pieces — followed by a Sources list of every
// piece's full citation, numbered to match. Both texts come back in one
// response, so the page can load them when its menu opens and copy
// synchronously on the click (Safari and the plain-HTTP clipboard fallback
// both need the copy inside the click itself).

type setlistProgramResponse struct {
	Markdown string `json:"markdown"`
	Text     string `json:"text"`
}

// programEntry is one program row, already resolved. Number is nil for an
// unnumbered (non-counting) custom entry.
type programEntry struct {
	number   *int
	custom   bool
	role     string
	title    string
	opus     string
	credit   string
	citation string
}

func (s *Server) handleGetSetlistProgram(w http.ResponseWriter, r *http.Request) {
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

	entries := make([]programEntry, 0, len(resp.Entries))
	for _, e := range resp.Entries {
		pe := programEntry{number: e.DisplayNumber}
		if e.Role != nil {
			pe.role = *e.Role
		}
		if e.Piece == nil {
			pe.custom = true
			if e.CustomName != nil {
				pe.title = *e.CustomName
			}
			entries = append(entries, pe)
			continue
		}
		pe.title = e.Piece.Title
		pe.opus = e.Piece.WorkOpusNumber
		pe.credit = programCredit(tagNames(e.Piece.Composer), tagNames(e.Piece.Arranger))
		p, err := repo.GetPieceByID(r.Context(), s.DB, e.Piece.ID)
		if err != nil {
			s.writeError(w, err)
			return
		}
		if pe.citation, err = s.pieceCitation(r.Context(), s.DB, p); err != nil {
			s.writeError(w, err)
			return
		}
		entries = append(entries, pe)
	}

	var date string
	if setlist.GigDate != nil {
		if t, parseErr := time.Parse("2006-01-02", *setlist.GigDate); parseErr == nil {
			date = longDateFormatterText(r)(t)
		}
	}
	md, text := buildSetlistProgram(setlist.Name, date, entries)
	api.WriteData(w, http.StatusOK, setlistProgramResponse{Markdown: md, Text: text})
}

func tagNames(tags []repo.Tag) []string {
	names := make([]string, len(tags))
	for i, t := range tags {
		names[i] = t.Name
	}
	return names
}

// programCredit is "Composer", "Composer, arr. Arranger" or "arr. Arranger".
func programCredit(composers, arrangers []string) string {
	parts := []string{}
	if c := joinPersonNames(composers); c != "" {
		parts = append(parts, c)
	}
	if a := joinPersonNames(arrangers); a != "" {
		parts = append(parts, "arr. "+a)
	}
	return strings.Join(parts, ", ")
}

// buildSetlistProgram renders both copies. The Markdown sets the title as
// a heading, piece titles bold and roles and custom entries italic, with
// user text escaped so a stray * or _ in a title can't restyle the line;
// the plain text has no markup at all, so the setlist name is upper-cased
// to stand apart.
func buildSetlistProgram(name, date string, entries []programEntry) (markdown, text string) {
	var md, pt []string
	md = append(md, "# "+escapeMarkdown(name), "")
	pt = append(pt, strings.ToUpper(name))
	if date != "" {
		md = append(md, escapeMarkdown(date), "")
		pt = append(pt, date)
	}
	pt = append(pt, "")

	var sourcesMD, sourcesPT []string
	prevCustom := false
	for i, e := range entries {
		if e.custom && e.number == nil {
			// Its own paragraph between the numbered pieces (Markdown lists
			// resume at the next item's own number).
			if i > 0 && !prevCustom {
				md = append(md, "")
			}
			md = append(md, "*"+escapeMarkdown(e.title)+"*", "")
			pt = append(pt, "   "+e.title)
			prevCustom = true
			continue
		}
		prevCustom = false
		num := ""
		if e.number != nil {
			num = fmt.Sprintf("%d. ", *e.number)
		}
		rowMD, rowPT := num, num
		if e.role != "" {
			rowMD += "*" + escapeMarkdown(e.role) + ":* "
			rowPT += e.role + ": "
		}
		if e.custom {
			// A custom entry counted as music: numbered, italic, no credit.
			rowMD += "*" + escapeMarkdown(e.title) + "*"
			rowPT += e.title
		} else {
			rowMD += "**" + escapeMarkdown(e.title) + "**"
			rowPT += e.title
			if e.opus != "" {
				rowMD += " (" + escapeMarkdown(e.opus) + ")"
				rowPT += " (" + e.opus + ")"
			}
			if e.credit != "" {
				rowMD += " — " + escapeMarkdown(e.credit)
				rowPT += " — " + e.credit
			}
			if e.citation != "" {
				sourcesMD = append(sourcesMD, num+escapeMarkdown(e.citation))
				sourcesPT = append(sourcesPT, num+e.citation)
			}
		}
		md = append(md, rowMD)
		pt = append(pt, rowPT)
	}
	md = trimTrailingBlank(md)
	pt = trimTrailingBlank(pt)

	if len(sourcesMD) > 0 {
		md = append(md, "", "## Sources", "")
		md = append(md, sourcesMD...)
		pt = append(pt, "", "SOURCES")
		pt = append(pt, sourcesPT...)
	}
	return strings.Join(md, "\n") + "\n", strings.Join(pt, "\n") + "\n"
}

func trimTrailingBlank(lines []string) []string {
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// markdownSpecial is every character that could start emphasis, a link,
// code, HTML or an escape inside a line of Markdown.
var markdownSpecial = regexp.MustCompile("[\\\\`*_\\[\\]<>]")

func escapeMarkdown(s string) string {
	return markdownSpecial.ReplaceAllString(s, `\$0`)
}
