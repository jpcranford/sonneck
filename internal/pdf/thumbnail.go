package pdf

import (
	"image"
	"image/color"
	"image/png"
	"os"

	"golang.org/x/image/draw"
)

// ThumbnailFormat names how thumbnails are stored today. Bump it whenever
// that changes, so a library's cached thumbnails are cleared and redrawn
// (handlers.Server's startup check compares it with the cache's marker).
const ThumbnailFormat = "gray16-v1"

// thumbnailMaxSide caps a thumbnail's longer side: a Letter or A4 page at
// 100ppi (up to 1170px) is untouched, while an oversized page (a poster-
// sized book cover came out 2657×3654 and 11MB) is scaled down to it.
const thumbnailMaxSide = 1200

// thumbnailGrays is how many grey levels a black-and-white thumbnail keeps:
// indistinguishable from 256 on sheet music, and a third the size of the
// full-color PNG pdftoppm writes (picked from a side-by-side,
// https://claude.ai/artifact/Xymx5Vu9daB6XV2HMT7A3L, option 2).
const thumbnailGrays = 16

// shrinkThumbnail rewrites the PNG at path in place: scaled down to
// thumbnailMaxSide if it's larger, and stored as 16 greys unless the page
// has real color (a book cover), which keeps its color.
func shrinkThumbnail(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	img, err := png.Decode(f)
	f.Close()
	if err != nil {
		return err
	}

	b := img.Bounds()
	if long := max(b.Dx(), b.Dy()); long > thumbnailMaxSide {
		w := b.Dx() * thumbnailMaxSide / long
		h := b.Dy() * thumbnailMaxSide / long
		scaled := image.NewRGBA(image.Rect(0, 0, w, h))
		draw.CatmullRom.Scale(scaled, scaled.Bounds(), img, b, draw.Src, nil)
		img, b = scaled, scaled.Bounds()
	}

	var out image.Image = img
	if !hasColor(img) {
		out = toGrays(img)
	}

	tmp := path + ".shrink"
	w, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(w, out); err != nil {
		w.Close()
		os.Remove(tmp)
		return err
	}
	if err := w.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// hasColor reports whether more than 1% of the image's pixels are visibly
// colored (a channel differing from another by more than 24 of 255) —
// scanner tint and anti-aliasing fringes stay under that; a color cover
// doesn't.
func hasColor(img image.Image) bool {
	b := img.Bounds()
	limit := b.Dx() * b.Dy() / 100
	colored := 0
	// pdftoppm's PNG decodes as RGBA: read its bytes directly (At, per
	// pixel, is several times slower).
	if rgba, ok := img.(*image.RGBA); ok {
		for i := 0; i+3 < len(rgba.Pix); i += 4 {
			r, g, bl := uint32(rgba.Pix[i]), uint32(rgba.Pix[i+1]), uint32(rgba.Pix[i+2])
			if absDiff(r, g) > 24 || absDiff(g, bl) > 24 || absDiff(r, bl) > 24 {
				colored++
				if colored > limit {
					return true
				}
			}
		}
		return false
	}
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			r, g, bl = r>>8, g>>8, bl>>8
			if absDiff(r, g) > 24 || absDiff(g, bl) > 24 || absDiff(r, bl) > 24 {
				colored++
				if colored > limit {
					return true
				}
			}
		}
	}
	return false
}

func absDiff(a, b uint32) uint32 {
	if a > b {
		return a - b
	}
	return b - a
}

// toGrays maps the image onto thumbnailGrays evenly spaced greys, as a
// paletted image (which the PNG encoder writes at 4 bits a pixel).
func toGrays(img image.Image) *image.Paletted {
	palette := make(color.Palette, thumbnailGrays)
	for i := range palette {
		v := uint8(i * 255 / (thumbnailGrays - 1))
		palette[i] = color.Gray{Y: v}
	}
	b := img.Bounds()
	out := image.NewPaletted(image.Rect(0, 0, b.Dx(), b.Dy()), palette)
	index := func(gray uint32) uint8 {
		return uint8((int(gray)*(thumbnailGrays-1) + 127) / 255)
	}
	if rgba, ok := img.(*image.RGBA); ok {
		for y := 0; y < b.Dy(); y++ {
			row := rgba.Pix[y*rgba.Stride:]
			for x := 0; x < b.Dx(); x++ {
				r, g, bl := uint32(row[x*4]), uint32(row[x*4+1]), uint32(row[x*4+2])
				// color.GrayModel's weights, on 8-bit values.
				gray := (19595*r + 38470*g + 7471*bl + 1<<15) >> 16
				out.Pix[y*out.Stride+x] = index(gray)
			}
		}
		return out
	}
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			gray := color.GrayModel.Convert(img.At(x, y)).(color.Gray).Y
			out.SetColorIndex(x-b.Min.X, y-b.Min.Y, index(uint32(gray)))
		}
	}
	return out
}
