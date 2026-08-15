package pdf_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/picarda/internal/pdf"
	"github.com/jpcranford/picarda/internal/testutil"
)

func TestPageCount_MatchesFixture(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "fixture.pdf")
	testutil.WriteFixturePDF(t, src, 7)

	got, err := pdf.PageCount(context.Background(), src)
	if err != nil {
		t.Fatalf("PageCount: %v", err)
	}
	if got != 7 {
		t.Errorf("PageCount = %d, want 7", got)
	}
}

func TestExtractPages_ProducesFileWithExactPageCount(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "book.pdf")
	testutil.WriteFixturePDF(t, src, 10)

	dst := filepath.Join(dir, "piece.pdf")
	if err := pdf.ExtractPages(context.Background(), src, 4, 8, dst); err != nil {
		t.Fatalf("ExtractPages: %v", err)
	}

	got, err := pdf.PageCount(context.Background(), dst)
	if err != nil {
		t.Fatalf("PageCount on extracted file: %v", err)
	}
	if want := 8 - 4 + 1; got != want {
		t.Errorf("extracted PageCount = %d, want %d (pages 4-8 inclusive)", got, want)
	}
}

func TestExtractPages_RejectsInvalidRange(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "book.pdf")
	testutil.WriteFixturePDF(t, src, 5)

	if err := pdf.ExtractPages(context.Background(), src, 3, 2, filepath.Join(dir, "out.pdf")); err == nil {
		t.Error("ExtractPages with last < first = nil error, want an error")
	}
}

func TestRenderThumbnail_WritesExpectedPNG(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "book.pdf")
	testutil.WriteFixturePDF(t, src, 3)

	outPrefix := filepath.Join(dir, "thumb")
	path, err := pdf.RenderThumbnail(context.Background(), src, 2, 72, outPrefix)
	if err != nil {
		t.Fatalf("RenderThumbnail: %v", err)
	}
	if path != outPrefix+".png" {
		t.Errorf("returned path = %q, want %q", path, outPrefix+".png")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat rendered thumbnail: %v", err)
	}
	if info.Size() == 0 {
		t.Error("rendered thumbnail file is empty")
	}
}
