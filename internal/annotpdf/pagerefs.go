package annotpdf

import (
	"fmt"
	"io"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// StripPageRefs writes src to w with the /P entry (the page an annotation
// sits on) removed from every annotation, and reports whether there was
// any; with none, nothing is written.
//
// The book split copies a piece's pages with pdfseparate and joins them
// with pdfunite, which keeps /P's old object number: in the piece it
// points at some other object or none, so a later pdfunite (the Set PDF)
// drops the annotations and pdfcpu (Download PDF + Annotations) refuses
// the file. /P is optional and readers find an annotation through its
// page's /Annots, so the annotations are otherwise untouched. A Screen
// annotation keeps its /P, which its media playback needs.
func StripPageRefs(src io.ReadSeeker, w io.Writer) (bool, error) {
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	ctx, err := api.ReadAndValidate(src, conf)
	if err != nil {
		return false, fmt.Errorf("reading the PDF: %w", err)
	}
	changed := false
	for page := 1; page <= ctx.PageCount; page++ {
		d, _, _, err := ctx.PageDict(page, false)
		if err != nil {
			return false, fmt.Errorf("page %d: %w", page, err)
		}
		annots, err := ctx.DereferenceArray(d["Annots"])
		if err != nil {
			return false, fmt.Errorf("page %d's annotations: %w", page, err)
		}
		for _, o := range annots {
			a, err := ctx.DereferenceDict(o)
			if err != nil || a == nil {
				continue
			}
			if _, ok := a["P"]; !ok {
				continue
			}
			if sub, _ := a["Subtype"].(types.Name); sub == "Screen" {
				continue
			}
			delete(a, "P")
			changed = true
		}
	}
	if !changed {
		return false, nil
	}
	if err := api.Write(ctx, w, conf); err != nil {
		return false, fmt.Errorf("writing the PDF: %w", err)
	}
	return true, nil
}
