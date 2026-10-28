package pdf

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"image"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/image/tiff"
)

// scanCoverage is how much of a page its images must cover, together, for
// the page to count as a scan. A scan is one page-sized image, or a few
// strips of one (a photographed page is often stored as five); an engraved
// page carries at most a small logo.
const scanCoverage = 0.5

var pageSizeLine = regexp.MustCompile(`Page\s+\d+\s+size:\s+([\d.]+)\s+x\s+([\d.]+)`)

// IsScannedPage reports whether page of src is a scan rather than an
// engraved (OEF, "original electronic format") page, by adding up the area
// its images cover (pdfimages -list). Image masks are left out, since they
// shape another image rather than add to it; a 1-bit scan is a "stencil".
func IsScannedPage(ctx context.Context, binDir, src string, page int) (bool, error) {
	p := strconv.Itoa(page)
	info, err := exec.CommandContext(ctx, toolPath(binDir, "pdfinfo"), "-f", p, "-l", p, src).Output()
	if err != nil {
		return false, fmt.Errorf("pdfinfo -f %d %s: %w", page, src, err)
	}
	m := pageSizeLine.FindSubmatch(info)
	if m == nil {
		return false, fmt.Errorf("pdfinfo -f %d %s: no page size in output", page, src)
	}
	w, _ := strconv.ParseFloat(string(m[1]), 64)
	h, _ := strconv.ParseFloat(string(m[2]), 64)
	pageArea := (w / 72) * (h / 72) // square inches
	if pageArea <= 0 {
		return false, nil
	}

	out, err := exec.CommandContext(ctx, toolPath(binDir, "pdfimages"), "-list", "-f", p, "-l", p, src).Output()
	if err != nil {
		return false, fmt.Errorf("pdfimages -list -f %d %s: %w", page, src, err)
	}
	covered := 0.0
	// Columns: page num type width height color comp bpc enc interp object
	// ID x-ppi y-ppi size ratio. The first two lines are the header.
	for _, line := range strings.Split(string(out), "\n")[2:] {
		f := strings.Fields(line)
		if len(f) < 14 || (f[2] != "image" && f[2] != "stencil") {
			continue
		}
		iw, err1 := strconv.ParseFloat(f[3], 64)
		ih, err2 := strconv.ParseFloat(f[4], 64)
		xppi, err3 := strconv.ParseFloat(f[12], 64)
		yppi, err4 := strconv.ParseFloat(f[13], 64)
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil || xppi <= 0 || yppi <= 0 {
			continue
		}
		covered += (iw / xppi) * (ih / yppi)
	}
	return covered/pageArea >= scanCoverage, nil
}

// RenderPageGray renders page of src at dpi as 8-bit grayscale, the Sheet
// Viewer's full-size page. An engraved page goes through pdftocairo, which
// draws thin lines at their true width; pdftoppm snaps them to whole
// pixels, so staff lines come out 1 or 2 pixels wide on the same page. A
// scan goes through pdftoppm, which keeps a 1-bit scan crisp where
// pdftocairo smooths it (and doubles its file size).
//
// pdftocairo writes uncompressed TIFF to a temp file under tmpDir (libtiff
// can't write to a pipe; its own PNG output is the same pixels, about three
// times slower); pdftoppm streams PGM straight in (its -gray only works for
// PGM). Either way the caller encodes the PNG.
func RenderPageGray(ctx context.Context, binDir, src string, page, dpi int, scanned bool, tmpDir string) (*image.Gray, error) {
	p, r := strconv.Itoa(page), strconv.Itoa(dpi)
	if scanned {
		cmd := exec.CommandContext(ctx, toolPath(binDir, "pdftoppm"), "-gray", "-cropbox",
			"-r", r, "-f", p, "-l", p, "-singlefile", src)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			return nil, fmt.Errorf("pdftoppm -gray -f %d %s: %w: %s", page, src, err, stderr.Bytes())
		}
		return readPGM(out)
	}

	tmp, err := os.CreateTemp(tmpDir, "page-*.tmp")
	if err != nil {
		return nil, err
	}
	prefix := strings.TrimSuffix(tmp.Name(), ".tmp")
	tmp.Close()
	os.Remove(tmp.Name())
	tifPath := prefix + ".tif"
	defer os.Remove(tifPath)

	// -cropbox, like the scan path and thumbnails: the page as every PDF
	// app shows it, which is also where annotated downloads place marks.
	cmd := exec.CommandContext(ctx, toolPath(binDir, "pdftocairo"), "-gray", "-tiff", "-cropbox",
		"-r", r, "-f", p, "-l", p, "-singlefile", src, prefix)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("pdftocairo -gray -tiff -cropbox -f %d %s: %w: %s", page, src, err, out)
	}
	f, err := os.Open(tifPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, err := tiff.Decode(bufio.NewReader(f))
	if err != nil {
		return nil, fmt.Errorf("decoding pdftocairo's TIFF for page %d of %s: %w", page, src, err)
	}
	return toGray(img), nil
}

// readPGM parses the binary (P5) 8-bit graymap pdftoppm -gray writes.
func readPGM(b []byte) (*image.Gray, error) {
	r := bufio.NewReader(bytes.NewReader(b))
	var magic string
	if _, err := fmt.Fscan(r, &magic); err != nil || magic != "P5" {
		return nil, fmt.Errorf("not a binary PGM (got %q)", magic)
	}
	var vals []int
	for len(vals) < 3 {
		var tok string
		if _, err := fmt.Fscan(r, &tok); err != nil {
			return nil, fmt.Errorf("PGM header: %w", err)
		}
		if strings.HasPrefix(tok, "#") {
			r.ReadString('\n')
			continue
		}
		n, err := strconv.Atoi(tok)
		if err != nil {
			return nil, fmt.Errorf("PGM header: %w", err)
		}
		vals = append(vals, n)
	}
	if vals[2] != 255 {
		return nil, fmt.Errorf("PGM maxval %d, want 255", vals[2])
	}
	r.ReadByte() // the one whitespace byte after maxval
	img := image.NewGray(image.Rect(0, 0, vals[0], vals[1]))
	if _, err := io.ReadFull(r, img.Pix); err != nil {
		return nil, fmt.Errorf("PGM pixels: %w", err)
	}
	return img, nil
}

func toGray(m image.Image) *image.Gray {
	if g, ok := m.(*image.Gray); ok {
		return g
	}
	b := m.Bounds()
	g := image.NewGray(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			g.Set(x, y, m.At(x, y))
		}
	}
	return g
}
