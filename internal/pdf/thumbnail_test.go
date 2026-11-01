package pdf

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func writePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

func readPNG(t *testing.T, path string) image.Image {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

// A black-and-white page (anti-aliased greys included) is stored as 16
// evenly spaced greys; black and white stay exact.
func TestShrinkThumbnail_GrayPageBecomesSixteenGrays(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 200, 260))
	for y := 0; y < 260; y++ {
		for x := 0; x < 200; x++ {
			v := uint8(255)
			if x < 50 {
				v = 0
			} else if x < 100 {
				v = uint8(x * 2) // a ramp of greys, like anti-aliasing
			}
			img.Set(x, y, color.RGBA{v, v, v, 255})
		}
	}
	path := filepath.Join(t.TempDir(), "page.png")
	writePNG(t, path, img)
	if err := shrinkThumbnail(path); err != nil {
		t.Fatal(err)
	}
	got, ok := readPNG(t, path).(*image.Paletted)
	if !ok {
		t.Fatalf("got %T, want a paletted (16-grey) image", readPNG(t, path))
	}
	if len(got.Palette) != thumbnailGrays {
		t.Errorf("palette has %d entries, want %d", len(got.Palette), thumbnailGrays)
	}
	if got.Bounds().Dx() != 200 || got.Bounds().Dy() != 260 {
		t.Errorf("size changed to %v", got.Bounds())
	}
	if c := color.GrayModel.Convert(got.At(10, 10)).(color.Gray).Y; c != 0 {
		t.Errorf("black became %d", c)
	}
	if c := color.GrayModel.Convert(got.At(150, 10)).(color.Gray).Y; c != 255 {
		t.Errorf("white became %d", c)
	}
}

// A page with real color (a book cover) keeps it.
func TestShrinkThumbnail_ColorPageStaysColor(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 100, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 100; x++ {
			img.Set(x, y, color.RGBA{180, 40, 40, 255})
		}
	}
	path := filepath.Join(t.TempDir(), "cover.png")
	writePNG(t, path, img)
	if err := shrinkThumbnail(path); err != nil {
		t.Fatal(err)
	}
	r, g, _, _ := readPNG(t, path).At(50, 50).RGBA()
	if r>>8 < 150 || g>>8 > 70 {
		t.Errorf("color lost: r=%d g=%d", r>>8, g>>8)
	}
}

// An oversized page is scaled so its longer side is 1200px, keeping its
// shape; a normal page is left at its size.
func TestShrinkThumbnail_CapsLongSide(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2400, 3000))
	path := filepath.Join(t.TempDir(), "big.png")
	writePNG(t, path, img)
	if err := shrinkThumbnail(path); err != nil {
		t.Fatal(err)
	}
	if b := readPNG(t, path).Bounds(); b.Dx() != 960 || b.Dy() != 1200 {
		t.Errorf("size = %dx%d, want 960x1200", b.Dx(), b.Dy())
	}
}

// A render that fails leaves no file behind (a killed pdftoppm used to
// leave its half-written output in the thumbnail cache forever).
func TestRenderThumbnail_FailureLeavesNoFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "missing.pdf")
	prefix := filepath.Join(dir, "thumb")
	if err := os.WriteFile(prefix+".png", []byte("half a png"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := RenderThumbnail(context.Background(), "", src, 1, 100, prefix); err == nil {
		t.Fatal("rendering a missing file succeeded")
	}
	if _, err := os.Stat(prefix + ".png"); !os.IsNotExist(err) {
		t.Errorf("partial output still there: %v", err)
	}
}
