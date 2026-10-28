package handlers_test

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// annotationSubtypes lists each page's annotation subtypes in a PDF.
func annotationSubtypes(t *testing.T, pdf []byte) map[int][]string {
	t.Helper()
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	ctx, err := api.ReadAndValidate(bytes.NewReader(pdf), conf)
	if err != nil {
		t.Fatalf("reading the PDF: %v", err)
	}
	out := map[int][]string{}
	for page := 1; page <= ctx.PageCount; page++ {
		d, _, _, err := ctx.PageDict(page, false)
		if err != nil {
			t.Fatal(err)
		}
		annots, err := ctx.DereferenceArray(d["Annots"])
		if err != nil {
			t.Fatal(err)
		}
		for _, o := range annots {
			a, err := ctx.DereferenceDict(o)
			if err != nil {
				t.Fatal(err)
			}
			if sub, ok := a["Subtype"].(types.Name); ok {
				out[page] = append(out[page], string(sub))
			}
		}
	}
	return out
}

type annotationSummary struct {
	Shown  int `json:"shown"`
	Hidden int `json:"hidden"`
}

// Download PDF + Annotations: the caller's marks come out as annotations
// (a stroke as /Ink, text as /FreeText), hidden colors left out, under an
// "(annotated)" name; with nothing to export it's the plain file. The
// summary counts what would go in and what's hidden; all of it needs
// `practice`.
func TestAnnotatedPieceDownload(t *testing.T) {
	h, conn := newTestServerWithDB(t)
	pieceID := uploadTestPiece(t, h)
	fileURL := apiPiecesURL(pieceID) + "/file?annotations=true"
	summaryURL := apiPiecesURL(pieceID) + "/annotations/summary"

	var sum annotationSummary
	decodeData(t, doJSON(t, h, http.MethodGet, summaryURL, nil), &sum)
	if sum != (annotationSummary{}) {
		t.Errorf("summary with no marks = %+v, want zeros", sum)
	}
	plain := doJSON(t, h, http.MethodGet, fileURL, nil)
	if plain.Code != http.StatusOK || strings.Contains(plain.Header().Get("Content-Disposition"), "annotated") {
		t.Fatalf("no marks: status %d, disposition %q; want the plain file", plain.Code, plain.Header().Get("Content-Disposition"))
	}

	marks := []map[string]any{
		{"id": "pen", "kind": "stroke", "tool": "pen", "layer": 5, "size": 0.39, "pressure": false,
			"points": [][]float64{{0.1, 0.2, 0.5}, {0.2, 0.22, 0.5}, {0.3, 0.21, 0.5}}},
		{"id": "hl", "kind": "stroke", "tool": "highlighter", "layer": 1, "size": 2, "pressure": false,
			"points": [][]float64{{0.1, 0.4, 0.5}, {0.6, 0.4, 0.5}}},
		{"id": "note", "kind": "text", "layer": 2, "x": 0.3, "y": 0.1, "size": 1.8, "text": "Sw. to Gt.\n:pp: **sub.**"},
		{"id": "secret", "kind": "text", "layer": 0, "x": 0.3, "y": 0.6, "size": 1.8, "text": "hidden"},
	}
	if rec := doJSON(t, h, http.MethodPut, apiPiecesURL(pieceID)+"/annotations/2", map[string]any{"marks": marks}); rec.Code != http.StatusOK {
		t.Fatalf("PUT marks: status %d, body %s", rec.Code, rec.Body.String())
	}
	// Red (color 0) hidden on this piece.
	if rec := doJSON(t, h, http.MethodPut, apiPiecesURL(pieceID)+"/practice-settings",
		map[string]any{"brightness": 100, "contrast": 100, "hiddenColors": 1}); rec.Code != http.StatusOK {
		t.Fatalf("PUT practice settings: status %d, body %s", rec.Code, rec.Body.String())
	}

	decodeData(t, doJSON(t, h, http.MethodGet, summaryURL, nil), &sum)
	if sum != (annotationSummary{Shown: 3, Hidden: 1}) {
		t.Errorf("summary = %+v, want 3 shown, 1 hidden", sum)
	}

	rec := doJSON(t, h, http.MethodGet, fileURL, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("annotated download: status %d, body %s", rec.Code, rec.Body.String())
	}
	if d := rec.Header().Get("Content-Disposition"); !strings.Contains(d, "(annotated).pdf") {
		t.Errorf("disposition %q, want an (annotated) name", d)
	}
	got := annotationSubtypes(t, rec.Body.Bytes())
	if want := []string{"Ink", "Ink", "FreeText"}; strings.Join(got[2], ",") != strings.Join(want, ",") {
		t.Errorf("page 2 annotations = %v, want %v", got[2], want)
	}
	if len(got[1]) != 0 {
		t.Errorf("page 1 picked up annotations: %v", got[1])
	}

	if _, err := conn.Exec(`DELETE FROM user_permissions WHERE user_id = 1 AND permission IN ('admin', 'practice')`); err != nil {
		t.Fatal(err)
	}
	if rec := doJSON(t, h, http.MethodGet, fileURL, nil); rec.Code != http.StatusForbidden {
		t.Errorf("annotated download without practice: status %d, want 403", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodGet, summaryURL, nil); rec.Code != http.StatusForbidden {
		t.Errorf("summary without practice: status %d, want 403", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/file", nil); rec.Code != http.StatusOK {
		t.Errorf("plain download without practice: status %d, want 200", rec.Code)
	}
}

// The Set PDF + Annotations splices in each annotated piece with its
// annotations kept through the merge, and the setlist's summary counts each
// piece once however often it's in the program.
func TestAnnotatedSetlistDownload(t *testing.T) {
	h := newTestServer(t)
	pieceID := uploadTestPiece(t, h)
	rec := doJSON(t, h, http.MethodPost, "/api/setlists", map[string]any{"name": "Evensong"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create setlist: status %d", rec.Code)
	}
	var setlist struct {
		ID int64 `json:"id"`
	}
	decodeData(t, rec, &setlist)
	for range 2 {
		if rec := doJSON(t, h, http.MethodPost, setlistURL(setlist.ID, "/entries"), map[string]any{"pieceId": pieceID}); rec.Code != http.StatusCreated {
			t.Fatalf("add entry: status %d", rec.Code)
		}
	}
	marks := []map[string]any{
		{"id": "pen", "kind": "stroke", "tool": "pen", "layer": 5, "size": 0.39, "pressure": false,
			"points": [][]float64{{0.1, 0.2, 0.5}, {0.2, 0.22, 0.5}, {0.3, 0.21, 0.5}}},
	}
	if rec := doJSON(t, h, http.MethodPut, apiPiecesURL(pieceID)+"/annotations/1", map[string]any{"marks": marks}); rec.Code != http.StatusOK {
		t.Fatalf("PUT marks: status %d", rec.Code)
	}

	var sum annotationSummary
	decodeData(t, doJSON(t, h, http.MethodGet, setlistURL(setlist.ID, "/annotations/summary"), nil), &sum)
	if sum != (annotationSummary{Shown: 1}) {
		t.Errorf("setlist summary = %+v, want 1 shown", sum)
	}

	rec = doJSON(t, h, http.MethodGet, setlistURL(setlist.ID, "/pdf?annotations=true"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("annotated Set PDF: status %d, body %s", rec.Code, rec.Body.String())
	}
	if d := rec.Header().Get("Content-Disposition"); !strings.Contains(d, "Evensong (annotated).pdf") {
		t.Errorf("disposition %q, want an (annotated) name", d)
	}
	inks := 0
	for _, subtypes := range annotationSubtypes(t, rec.Body.Bytes()) {
		for _, s := range subtypes {
			if s == "Ink" {
				inks++
			}
		}
	}
	if inks != 2 {
		t.Errorf("Set PDF has %d ink annotations, want 2 (the piece twice)", inks)
	}
}
