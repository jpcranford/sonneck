package handlers

import (
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// imslpNumberPattern is design doc §3's filename-based IMSLP detection: a
// light regex against the original filename, not a live lookup (deferred,
// see design doc §13). Captures just the digits, not the "IMSLP" label
// itself — the app's own citation convention renders it as "IMSLP
// #{number}" (buildCitation, stripImslpPrefix in citation.go), so a
// stored value should be prefix-free from the moment it's detected, same
// as EditBookModal.tsx/EditPieceModal.tsx's own stripImslpPrefix already
// enforces on every manual save.
var imslpNumberPattern = regexp.MustCompile(`IMSLP(\d+)`)

// defaultTitleFromFilename mirrors the Book upload default (design doc
// §5: bookTitle defaults to the filename minus extension) for the
// single-piece upload path, which has no wizard fill step to supply a
// title up front.
func defaultTitleFromFilename(filename string) string {
	base := filepath.Base(filename)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

func detectImslpNumber(filename string) *string {
	match := imslpNumberPattern.FindStringSubmatch(filename)
	if match == nil {
		return nil
	}
	number := match[1]
	return &number
}

// unsafeFilenameChars strips anything that could break a Content-Disposition
// header or confuse a filesystem, for the download filename hint
// (handleDownloadPieceFile, handleDownloadBookFile) derived from free-text
// fields. Parens are allowed (not stripped) specifically for
// downloadFilename's "(yearWritten)" segment below. Comma allowed too (found
// 2026-09-02, real bug): joinPersonNames' own Oxford-comma joining of a
// multi-person composer/arranger credit ("Jimmy Page, John Paul Jones, and
// John Bonham") was getting every comma replaced with "_" here, since a
// comma wasn't in the allowed set — a real title can legitimately carry one
// too ("No. 9, Volksliedchen"). A comma breaks neither a quoted
// Content-Disposition filename (RFC 6266/2616 quoted-string only requires
// escaping `"`/`\`) nor any real filesystem (Windows/macOS/Linux all permit
// it), so there was never a real reason to strip it.
var unsafeFilenameChars = regexp.MustCompile(`[^a-zA-Z0-9 _(),-]+`)

// diacriticStripper decomposes precomposed accented letters (é → e +
// combining acute) and drops the combining mark, so a composer/title with
// diacritics degrades to its closest ASCII letter instead of falling
// straight to unsafeFilenameChars' "_" replacement below (found 2026-09-05:
// "Frédéric Chopin - Nocturne.pdf" was downloading as
// "Fr_d_ric_Chopin_-_Nocturne.pdf").
var diacriticStripper = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// extraLatinFolds covers the common Latin letters NFD decomposition can't
// touch — they're their own code points, not a base letter plus a
// combining mark, so diacriticStripper above passes them through
// unchanged and they'd otherwise still hit the "_" fallback.
var extraLatinFolds = strings.NewReplacer(
	"ß", "ss",
	"æ", "ae", "Æ", "AE",
	"œ", "oe", "Œ", "OE",
	"ø", "o", "Ø", "O",
	"đ", "d", "Đ", "D",
	"ł", "l", "Ł", "L",
	"þ", "th", "Þ", "Th",
	"ð", "d", "Ð", "D",
)

func stripDiacritics(s string) string {
	folded := extraLatinFolds.Replace(s)
	result, _, err := transform.String(diacriticStripper, folded)
	if err != nil {
		return folded
	}
	return result
}

func sanitizeFilename(title string) string {
	cleaned := strings.TrimSpace(unsafeFilenameChars.ReplaceAllString(stripDiacritics(title), "_"))
	if cleaned == "" {
		return "piece"
	}
	return cleaned
}

// downloadFilename builds the "<name> - <title> (<year>).pdf"-minus-
// extension hint shared by the piece and book download/open routes.
// name is composer, falling back to arranger, falling back to publisher
// (first non-empty wins) — callers pass already-resolved values: effective
// (book-inheritable-aware) values for a piece, plain Book columns for a
// book, since a Book has nothing to inherit from. Either optional segment
// (name, year) is omitted cleanly, including its separator, rather than
// leaving a stray "- " or "()" when unset.
func downloadFilename(composer, arranger, publisher, title, yearWritten string) string {
	name := composer
	if name == "" {
		name = arranger
	}
	if name == "" {
		name = publisher
	}

	result := title
	if name != "" {
		result = name + " - " + result
	}
	if yearWritten != "" {
		result = result + " (" + yearWritten + ")"
	}
	return sanitizeFilename(result)
}
