package annotpdf

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/jpcranford/sonneck/internal/testutil"
)

// pageAnnotations returns each page's annotation dicts.
func pageAnnotations(t *testing.T, pdf []byte) [][]types.Dict {
	t.Helper()
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	ctx, err := api.ReadAndValidate(bytes.NewReader(pdf), conf)
	if err != nil {
		t.Fatalf("reading the PDF: %v", err)
	}
	out := make([][]types.Dict, ctx.PageCount)
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
			out[page-1] = append(out[page-1], a)
		}
	}
	return out
}

// Every annotation loses its /P and nothing else: same annotations on the
// same pages, every other entry unchanged.
func TestStripPageRefs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.pdf")
	testutil.WriteAnnotatedPDF(t, path, 5)
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	changed, err := StripPageRefs(bytes.NewReader(src), &out)
	if err != nil || !changed {
		t.Fatalf("StripPageRefs = %v, %v; want true, nil", changed, err)
	}
	before, after := pageAnnotations(t, src), pageAnnotations(t, out.Bytes())
	if len(after) != len(before) {
		t.Fatalf("%d pages, want %d", len(after), len(before))
	}
	for i := range before {
		if len(after[i]) != len(before[i]) {
			t.Fatalf("page %d: %d annotations, want %d", i+1, len(after[i]), len(before[i]))
		}
		for j, b := range before[i] {
			a := after[i][j]
			if _, ok := a["P"]; ok {
				t.Errorf("page %d annotation %d still has /P", i+1, j)
			}
			if len(a) != len(b)-1 {
				t.Errorf("page %d annotation %d has %d entries, want %d", i+1, j, len(a), len(b)-1)
			}
			for k, v := range b {
				if k != "P" && a[k].String() != v.String() {
					t.Errorf("page %d annotation %d: /%s = %s, want %s", i+1, j, k, a[k], v)
				}
			}
		}
	}
}

// A PDF without annotations is left alone: nothing written.
func TestStripPageRefs_NoAnnotations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plain.pdf")
	testutil.WriteFixturePDF(t, path, 3)
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	changed, err := StripPageRefs(bytes.NewReader(src), &out)
	if err != nil || changed || out.Len() != 0 {
		t.Errorf("StripPageRefs = %v, %v, %d bytes; want false, nil, nothing written", changed, err, out.Len())
	}
}
