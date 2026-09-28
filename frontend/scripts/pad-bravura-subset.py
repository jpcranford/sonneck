#!/usr/bin/env python3
"""Add side bearings to the Bravura Text subset fonts, in place.

Bravura Text is an engraving font: every glyph's ink runs right to both
edges of its advance box, and the dynamics (p, f, pp, ff, ...) overhang
their box on the left by up to 0.23em. Set inline with text that makes an
accidental crowd the letter before it ("E♭") and a dynamic nearly touch the
word before it. This gives every glyph the same clear space on both sides:
its ink moves so the left bearing is PAD_EM, and its advance becomes the
ink's width plus PAD_EM on each side.

Run it on a freshly subsetted, unpadded font — both copies the app ships:

    frontend/src/assets/fonts/bravura-text-subset.woff2   (web, CFF outlines)
    internal/setlistpdf/assets/fonts/BravuraText-subset.ttf (PDF, TrueType)

It refuses a font that's already padded, so running it twice can't double
the spacing. Needs fonttools (and brotli for woff2):

    python3 -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python frontend/scripts/pad-bravura-subset.py <font> [<font> ...]
"""

import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

PAD_EM = 0.08

# U+266D (♭) has no bearings at all in the upstream font, so a left bearing
# already at the padded value means this font has been through here.
GUARD_CODEPOINT = 0x266D


def ink_bounds(glyph_set, name):
    pen = BoundsPen(glyph_set)
    glyph_set[name].draw(pen)
    return pen.bounds  # None for a glyph with no outline


def pad_font(path):
    font = TTFont(path)
    upem = font["head"].unitsPerEm
    pad = round(PAD_EM * upem)
    glyph_set = font.getGlyphSet()

    guard = font.getBestCmap().get(GUARD_CODEPOINT)
    if guard is None:
        sys.exit(f"{path}: no U+{GUARD_CODEPOINT:04X} glyph — not a Bravura Text subset?")
    bounds = ink_bounds(glyph_set, guard)
    if bounds and bounds[0] >= pad:
        sys.exit(f"{path}: already padded (U+{GUARD_CODEPOINT:04X} left bearing is {bounds[0]}), leaving it alone")

    # Work out every glyph's shift first: the CFF path below redraws glyphs
    # through the original glyph set, which must still be unmodified.
    changes = {}
    for name in font.getGlyphOrder():
        if name == ".notdef":
            continue
        b = ink_bounds(glyph_set, name)
        if b is None:
            continue
        x_min, _, x_max, _ = b
        changes[name] = (pad - x_min, (x_max - x_min) + 2 * pad)

    hmtx = font["hmtx"]
    if "glyf" in font:
        glyf = font["glyf"]
        for name, (dx, advance) in changes.items():
            g = glyf[name]
            if g.isComposite():
                sys.exit(f"{path}: composite glyph {name} — this script only handles simple glyphs")
            g.coordinates.translate((dx, 0))
            g.recalcBounds(glyf)
            hmtx[name] = (round(advance), g.xMin)
    elif "CFF " in font:
        cff = font["CFF "].cff
        top = cff[cff.fontNames[0]]
        char_strings = top.CharStrings
        for name, (dx, advance) in changes.items():
            private = char_strings[name].private
            # A CFF charstring stores its width relative to nominalWidthX.
            pen = T2CharStringPen(round(advance) - private.nominalWidthX, glyph_set)
            glyph_set[name].draw(TransformPen(pen, (1, 0, 0, 1, dx, 0)))
            char_strings[name] = pen.getCharString(private=private, globalSubrs=cff.GlobalSubrs)
            hmtx[name] = (round(advance), round(pad))
    else:
        sys.exit(f"{path}: neither glyf nor CFF outlines")

    font.save(path)
    print(f"{path}: padded {len(changes)} glyphs by {pad} units ({PAD_EM}em) on each side")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        pad_font(p)
