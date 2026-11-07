# Music symbol shortcodes

Piece and book descriptions, as well as practice notes, support Markdown syntax. If you're not familiar, here's a quick [rundown](https://www.tomarkdown.org/guides/markdown-tutorial-for-beginners).

On top of that, Sonneck also supports a small set of shortcode codes, styled after the familiar `:emoji:` convention you may have seen used on Discord or Microsoft Teams.

A code is only recognized if it's one of the ones listed here — anything else (`:shrug:`, `:tada:`, etc.) is left as plain text. A code shown inside a code span or code block (`` `:forte:` ``) is also left as plain text, so it can still be used as a literal example.

| Preview | Shortcode(s) | Description | Codepoint |
|:---:|---|---|---|
| <img src="music-emoji-images/piano.png" alt="piano" height="36"> | `:piano:` `:p:` | Dynamic marking — Piano | U+E520 |
| <img src="music-emoji-images/mezzo.png" alt="mezzo" height="36"> | `:mezzo:` `:m:` | Dynamic marking — Mezzo | U+E521 |
| <img src="music-emoji-images/forte.png" alt="forte" height="36"> | `:forte:` `:f:` | Dynamic marking — Forte | U+E522 |
| <img src="music-emoji-images/pianissimo.png" alt="pianissimo" height="36"> | `:pianissimo:` `:pp:` | Dynamic marking — Pianissimo | U+E52B |
| <img src="music-emoji-images/mezzopiano.png" alt="mezzopiano" height="36"> | `:mezzopiano:` `:mp:` | Dynamic marking — Mezzo piano | U+E52C |
| <img src="music-emoji-images/mezzoforte.png" alt="mezzoforte" height="36"> | `:mezzoforte:` `:mf:` | Dynamic marking — Mezzo forte | U+E52D |
| <img src="music-emoji-images/fortissimo.png" alt="fortissimo" height="36"> | `:fortissimo:` `:ff:` | Dynamic marking — Fortissimo | U+E52F |
| <img src="music-emoji-images/flat.png" alt="flat" height="36"> | `:flat:` `:b:` | Accidental — Flat | U+266D |
| <img src="music-emoji-images/natural.png" alt="natural" height="36"> | `:natural:` | Accidental — Natural | U+266E |
| <img src="music-emoji-images/sharp.png" alt="sharp" height="36"> | `:sharp:` `:#:` | Accidental — Sharp | U+266F |
| <img src="music-emoji-images/doublesharp.png" alt="doublesharp" height="36"> | `:doublesharp:` `:##:` | Accidental — Double sharp | U+ED63 |
| <img src="music-emoji-images/doubleflat.png" alt="doubleflat" height="36"> | `:doubleflat:` `:bb:` | Accidental — Double flat | U+ED64 |
| <img src="music-emoji-images/dalsegno.png" alt="dalsegno" height="36"> | `:dalsegno:` `:ds:` | D.S. (dal segno) sign | U+E045 |
| <img src="music-emoji-images/dacapo.png" alt="dacapo" height="36"> | `:dacapo:` `:dc:` | D.C. (da capo) sign | U+E046 |
| <img src="music-emoji-images/segno.png" alt="segno" height="36"> | `:segno:` | Segno sign | U+E047 |
| <img src="music-emoji-images/coda.png" alt="coda" height="36"> | `:coda:` | Coda sign | U+E048 |
| <img src="music-emoji-images/treble.png" alt="treble" height="36"> | `:treble:` | Treble clef | U+E050 |
| <img src="music-emoji-images/alto.png" alt="alto" height="36"> | `:alto:` | Alto clef | U+E05C |
| <img src="music-emoji-images/bass.png" alt="bass" height="36"> | `:bass:` | Bass clef | U+E062 |
| <img src="music-emoji-images/glasses.png" alt="glasses" height="36"> | `:glasses:` `:look:` | Glasses (the most important symbol of all) | U+EC62 |

### Technical notes
Our code for general Markdown support is located [here](frontend/src/components/MarkdownText.tsx).

These "emoji" are rendered with a self-hosted subset of [Bravura Text](https://github.com/steinbergmedia/bravura) (Steinberg, SIL OFL 1.1) containing only the glyphs listed above.

See `CONTRIBUTING.md`'s "Music symbol shortcodes" section for how this list and its preview images are generated and kept in sync.
