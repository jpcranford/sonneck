// Package pdf shells out to poppler-utils (pdfinfo/pdftocairo/pdftoppm —
// design doc §2) for the three PDF operations the app needs: counting
// pages, extracting a page range into a standalone PDF, and rendering a
// single page as a thumbnail image.
package pdf

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// PageCount returns a PDF's total page count via pdfinfo.
func PageCount(ctx context.Context, path string) (int, error) {
	out, err := exec.CommandContext(ctx, "pdfinfo", path).Output()
	if err != nil {
		return 0, fmt.Errorf("pdfinfo %s: %w", path, err)
	}

	for _, line := range strings.Split(string(out), "\n") {
		rest, ok := strings.CutPrefix(line, "Pages:")
		if !ok {
			continue
		}
		n, err := strconv.Atoi(strings.TrimSpace(rest))
		if err != nil {
			return 0, fmt.Errorf("parsing pdfinfo page count from %q: %w", line, err)
		}
		return n, nil
	}
	return 0, fmt.Errorf("pdfinfo output for %s had no Pages: line", path)
}

// ExtractPages extracts the inclusive, 1-indexed page range [first, last]
// from src into a new standalone PDF at dst, via pdftocairo.
//
// Extraction happens once, at import time, not on-demand at download time
// (design doc §5) — the result is a permanent file, not a cache.
func ExtractPages(ctx context.Context, src string, first, last int, dst string) error {
	if first < 1 || last < first {
		return fmt.Errorf("invalid page range [%d, %d]", first, last)
	}

	cmd := exec.CommandContext(ctx, "pdftocairo", "-pdf",
		"-f", strconv.Itoa(first), "-l", strconv.Itoa(last), src, dst)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("pdftocairo -f %d -l %d %s: %w: %s", first, last, src, err, out)
	}
	return nil
}

// RenderThumbnail renders a single page of src as a PNG at outPrefix+".png"
// via pdftoppm, for the import wizard's split step and the basic piece
// preview (design doc §5, §7).
func RenderThumbnail(ctx context.Context, src string, page, dpi int, outPrefix string) (string, error) {
	cmd := exec.CommandContext(ctx, "pdftoppm", "-png",
		"-f", strconv.Itoa(page), "-l", strconv.Itoa(page),
		"-r", strconv.Itoa(dpi), "-singlefile", src, outPrefix)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("pdftoppm -f %d %s: %w: %s", page, src, err, out)
	}
	return outPrefix + ".png", nil
}
