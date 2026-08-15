package handlers

import (
	"path/filepath"
	"regexp"
	"strings"
)

// imslpNumberPattern is design doc §3's filename-based IMSLP detection: a
// light regex against the original filename, not a live lookup (deferred,
// see design doc §13).
var imslpNumberPattern = regexp.MustCompile(`IMSLP\d+`)

// defaultTitleFromFilename mirrors the Book upload default (design doc
// §5: bookTitle defaults to the filename minus extension) for the
// single-piece upload path, which has no wizard fill step to supply a
// title up front.
func defaultTitleFromFilename(filename string) string {
	base := filepath.Base(filename)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

func detectImslpNumber(filename string) *string {
	match := imslpNumberPattern.FindString(filename)
	if match == "" {
		return nil
	}
	return &match
}

// unsafeFilenameChars strips anything that could break a Content-Disposition
// header or confuse a filesystem, for the download filename hint
// (handleDownloadPieceFile) derived from a piece's free-text title.
var unsafeFilenameChars = regexp.MustCompile(`[^a-zA-Z0-9 _-]+`)

func sanitizeFilename(title string) string {
	cleaned := strings.TrimSpace(unsafeFilenameChars.ReplaceAllString(title, "_"))
	if cleaned == "" {
		return "piece"
	}
	return cleaned
}
