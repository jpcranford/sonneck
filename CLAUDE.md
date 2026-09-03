# CLAUDE.md — House Rules & Conventions

Companion to `sonneck-design.md` (the design doc for **Sonneck**, named after Oscar Sonneck, the American musicologist and first head of the Library of Congress's Music Division — see the root README's "About the name" section for the full story). This file is the *living* counterpart to that doc: cross-cutting conventions, and every deliberate deviation from the design doc as the project actually got built, with the reasoning for each. Re-read it at the start of every session; if the two disagree, this file wins.

Keep this file itself lean — it holds **current-state conventions and deviations, not a changelog**. Two other places already carry related content, so don't duplicate their job here:
- **`CONTRIBUTING.md`** mirrors several of the load-bearing rules below for human contributors, in its own words. When changing either, check whether the other needs the same update.
- **Session memory and `git log`** hold the narrative behind these decisions — bug hunts, iteration rounds, dated "found via direct report" detail, the exact sequence a feature got built in. When something here is genuinely resolved and shipped, state the resulting rule/behavior plainly; don't narrate how it got there or when. A memory pointer is given where the fuller story is worth keeping.

## Database migrations
Tool: **goose**. Every schema change is a migration file, checked into the repo, never a hand-edited change to an existing migration.

Deliberate deviations from the design doc's original schema:
- **`Piece.key` is many-to-many** (`Piece.keys`, migration `00008`), not the single `key` tag/FK column §3 specifies — a piece that modulates, or a medley, can legitimately need more than one. `piece_keys` uses `PRIMARY KEY (piece_id, position)` (migration `00012`), not `(piece_id, key_id)`, so the same key can legitimately repeat (e.g. a modulation back to an earlier key). Keys remain explicitly *not* book-inheritable — this is about single- vs. multi-valued, not inheritance.
- **`copyrightYear`/`publicDomain` were pre-built into `Piece`'s v1 schema ahead of their own feature** (§3's stated reasoning) — a one-off exception for cheap, simple columns, not a general license to pre-build ahead of features. (The Public Domain Badge has since shipped — see below — and `publicDomain` was superseded by a real `copyright_status` enum at that point; a plain bool couldn't represent the actual four-way choice.)
- **Composer/Arranger are an ordered reference to a `Person` entity, not a plain string** — see "People / Composer & Arranger" below.

Migration `00020_people_and_credits.sql` is deliberately additive-only — the old `pieces.composer`/`pieces.arranger`/`books.composer`/`books.arranger` TEXT columns are still in the schema, unused by application code, pending a **separate future migration** to drop them. This is load-bearing, not laziness: goose runs every pending migration automatically on startup with no pause for a manual step in between, so a column-drop migration shipping in the same deploy as an additive one would destroy the backfill's own source data before it ever ran.

Full build history for the People/Composer migration (and every polish fix since) is in memory `project_people_composer_overhaul.md`.

## API response contract
Every endpoint returns one of two shapes — no per-handler improvisation:
```json
// success
{ "data": { ... } }

// error
{ "error": { "code": "VALIDATION_ERROR", "message": "human-readable description" } }
```
If a decision point isn't covered by this doc, default to this shape rather than inventing a variant.

## Testing
No comprehensive test suite is required for v1, but one area is **not optional** because failures there are silent and permanent:
- **PDF page-extraction logic** (the import wizard's split step, `internal/wizard/`/`internal/pdf/`, mirrored client-side in `frontend/src/lib/pieceSplitLogic.ts`) — a wrong page range is a data-correctness bug nobody notices until they open the piece later. Needs unit tests covering at least: single-page piece, multi-page piece, first piece includes page 1, last piece includes the final page, off-by-one boundaries between adjacent pieces.

Everything else: use judgment, but the PDF-extraction logic above is load-bearing.

## Live browser verification (dev tooling, not app code)
No MCP browser tool is configured in this environment. A real Chromium is still available: `npx playwright` caches a full install to `~/.npm/_npx/<hash>/node_modules/playwright/` (`find ~/.npm/_npx -maxdepth 3 -iname playwright`; run `npx playwright --version` once first if that comes up empty, to populate the cache). Drive it directly with a hand-written Node script through Bash:
```js
import { chromium } from '/Users/<user>/.npm/_npx/<hash>/node_modules/playwright/index.mjs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
await page.goto('http://localhost:5173/...')
// ...interact, assert, page.screenshot()...
await browser.close()
```
Needs both dev servers already running — backend on `:8080`, Vite on `:5173` (check with `lsof -iTCP -sTCP:LISTEN -P` rather than assuming). Use this for anything a type-check or unit test can't actually catch — a real click-through sequence, animation/transition timing, DOM state after an interaction.

**The dev library at `./data` (`DATA_DIR`) is read-only.** Don't write to it — not through the app's own endpoints, not direct SQL, not file operations. To verify a write flow: start a second Go backend on a different port against a throwaway `DATA_DIR` (`PORT=8099 DATA_DIR=<scratchpad>/throwaway-data go run ./cmd/sonneck`), plus a throwaway Vite config (`frontend/vite.throwaway.config.ts` — must live inside `frontend/`, never committed — proxying `/api` to that port), and drive Playwright at the throwaway Vite's port. Clean up both processes and the throwaway files afterward.

**The long-running dev backend doesn't hot-reload.** A "no such endpoint" error against a newly-added route usually means the backend process is stale, not that the code is wrong — restart it (`ps eww -p <pid>` recovers its env vars if not already known; restarting doesn't touch `DATA_DIR`).

**Verify fine visual details with pixel data, not by eyeballing a screenshot.** Visual inspection is unreliable for shape-topology questions (is a glyph's counter open or closed) and gradient-fidelity questions (does an overlay render monotonically) — flood-fill connectivity analysis for the former, clean scanline pixel sampling for the latter. Normal visual QA (layout, color, spacing) is fine to eyeball; this is specifically for defects too subtle to reliably see by eye. A sub-pixel/font-rendering question (e.g. is an icon+label row *exactly* centered) is a *third* category this doesn't cover either — rendering genuinely differs by browser engine, so build a throwaway interactive calibration page and judge it live in the real target browser instead of trusting an automated cross-engine measurement.

**Verify against data missing the relevant optional fields, not just happy-path fixtures.** A layout relying on `justify-between` against a sibling that can render `null` (e.g. `TagPills` with no tags) looks correct against a fully-populated fixture and breaks silently the moment that field is empty — often the common case, not the edge case. Prefer `ml-auto` over `justify-between` when the pinned element's sibling might not render.

**Inline images/screenshots don't render for the user in this chat client.** Save any screenshot the user needs to see to `design-review/` (gitignored) and tell them it's there. Published Artifacts are unaffected — they render in their own viewer.

## Concurrency
v1 is single-user, single-session (design doc §8) — no multi-writer conflict handling. SQLite WAL mode is enabled at startup regardless (cheap, no reason to skip it).

`Piece.userNotes`/`userTags`/`favorite`/`practiceStatus` will become genuinely account-scoped once multi-user support lands, but stay simple (plain fields, a shared-catalog many-to-many for tags) in v1 rather than pre-building relational structure now — same "not cheap/simple enough to justify pre-building unused" reasoning as the migrations section above. Worth remembering for that future migration: `userTags` is confirmed to become a **fully private per-user vocabulary** at that point (no shared catalog across users, unlike `Key`/`SheetType`) — a bigger restructuring than adding a `userId` column, since it changes what a "tag" even is.

## Book-level soft inheritance
Full mechanism in design doc §3/§14/§15/§16 — this section is the implementation convention.

**One shared "resolve effective values" helper** (`repo.ResolveEffective`, `internal/repo/effective.go`), used everywhere a book-inheritable field is read: display (Piece Details, edit menus), validation, citation generation, and search indexing. Never read a book-inheritable `Piece` column directly from any of those four call sites — that's exactly the kind of silent divergence this pattern exists to prevent.

Saving a `Book` edit writes to exactly one record — the `Book` itself. Nothing about any `Piece` row changes; every piece with that `sourceBookId` and no override for the changed field resolves its effective value live against current `Book` data. This still needs a search-index resync for every affected piece (see Search).

`sourceBookId` is itself editable from the Piece Edit Menu (`PieceWriteRequest.SourceBookID`, `*int64`, same full-replace rule as every other field — `nil` clears the association) — an addition beyond the original design doc, not a deviation from it (§15 never described re-matching a piece to a different book after the fact).

Three deliberate required-field deviations from design doc §16's "no required fields beyond title," all in `internal/api/validate.go`:
- `ValidateBook` requires `bookTitle` non-empty — an untitled book is a confusing empty state everywhere it's displayed, and the wizard already defaults it from the upload filename in every real path anyway.
- `ValidatePiece` requires composer **or** arranger, not composer alone — a piece crediting only an arranger (a traditional/folk tune) is a legitimate case, not missing data.
- `ValidateBook` also requires one of composer/arranger/publisher — a book with none of the three is missing the one piece of attribution every other bibliographic field is meant to attach to.

## File handling
- All file hashing uses **SHA-256** (`crypto/sha256`, not BLAKE3 — see design doc §2), streamed incrementally via the standard `hash.Hash` interface — never buffer a full upload into memory before hashing.
- **Dedup on SHA-256 hash match**, scoped to `POST /api/pieces` (single-piece upload — returns the existing `Piece` instead of creating a duplicate) and `Book` creation. **Deliberately not** the book-import wizard's confirm step: two sibling pieces split from the same book can legitimately end up byte-identical (e.g. duplicate blank pages), which isn't a duplicate upload to collapse. No DB-level `UNIQUE` on `pieces.file_hash` for this reason (unlike `books.file_hash`, which has one).
- **Hard delete + orphan cleanup**: deleting a `Piece` removes its DB row, its extracted file, and its cached page thumbnails. If it was the last `Piece` referencing a `Book`, the `Book` (record, original file, and its own cached thumbnails) is deleted too. Both logged at INFO (see Logging).
- **`Book` fields are never denormalized onto `Piece`** — Piece Details resolves book-level display live via `sourceBookId → Book`. Don't add a "sync book fields to pieces" step anywhere in application code; the join makes every piece reflect current book data automatically.
- **`Book` is entirely optional** (design doc §3) — a piece with no `Book` at all (single-piece upload, §5) is a normal, first-class case. Don't write code that assumes `sourceBookId` is usually present.
- **File replacement** (§14) hard-replaces the same `Piece` record, not a new piece. `sourceBookId`/`sourcePageStart`/`sourcePageEnd` are kept as historical provenance after a replace — don't clear them, and don't assume they still describe the current file's exact page range.
- **Download filename**: `Content-Disposition`'s suggested name is `"<composer/arranger/publisher> - <title> (<yearWritten>).pdf"` (`downloadFilename`, `internal/handlers/filename.go`) — first non-empty of composer/arranger/publisher wins the name segment, both segments omitted cleanly (including separator) when unset. For a piece, name/year come from `repo.ResolveEffective`, not raw columns, since they're book-inheritable.

## Logging
Use the standard library's **`log/slog`**. Deletions (piece deletion, cascading orphaned-book cleanup) and piece file replacement are logged at **INFO** level, not DEBUG or WARN/ERROR — destructive-but-expected user actions belong in normal production logs, not hidden behind DEBUG or miscategorized as a problem when nothing actually went wrong.

Use structured fields, not string interpolation:
```go
logger.Info("piece deleted", "pieceId", piece.ID, "fileHash", piece.FileHash, "title", piece.Title)
```

## Config
- All global settings are env vars (no settings table in v1, design doc §3), validated at startup — fail fast with a clear message rather than failing later mid-request.
- **How env vars get set is entirely a Docker Compose concern, not application code** — a Compose `environment:` block vs. a sibling `.env` file are both natively supported by Compose, and the app reads them the same way either way.
- Backup scheduling uses `robfig/cron` (pure Go, no CGO) to parse `BACKUP_CRON` and drive the daily `VACUUM INTO` snapshot.
- **`CITATION_FORMAT` is loaded and validated but never actually consulted by citation generation** — `buildCitation` (`internal/handlers/citation.go`) hardcodes the format in Go rather than doing token substitution against `Config.CitationFormat`, since blank-field omission (a citation must skip a blank field's surrounding punctuation entirely) doesn't fit a plain-substitution model, and a real conditional-template engine is out of scope. A direct, permanent deviation from design doc §6 — changing this env var currently has no effect.

**Citation format — the full current set of deviations from design doc §6** (`internal/handlers/citation.go`):
- Arranger appears in the citation, fused onto composer as `"{composer}, arr. {arranger}"` (§6 excludes arranger entirely). Composer and Arranger are both book-inheritable — a piece/book with an arranger but no composer renders the bare `"arr. {arranger}"` instead of dropping the segment.
- IMSLP number renders as `"IMSLP #{number}"` (`stripImslpPrefix` strips any leading "IMSLP" already baked into stored data so it never doubles up), and wins the fallback entirely over publisher/publisherId/ISBN when present — those three are dropped from the citation, not shown alongside it.
- publisherId fuses onto publisher as `"{publisher} #{publisherId}"` (its own `"#"`-prefixed suffix, not a separate comma-joined part); ISBN (Book-only, no piece-level override) gets its own comma-joined `"ISBN {hyphenated}"` part right after publisher/publisherId.
- A double quote inside the title itself renders as a single quote, before the whole title is wrapped in the citation's own double quotes (standard nested-quote convention).
- `yearWritten`, when present, is unconditionally the citation's last component and gets a trailing period.
- **A book's own opus number always renders next to the book's name once set** — `"{bookTitle}, {bookWorkOpusNumber}"`. When the piece's own effective opus number incorporates the book's (per `containsIgnoringSpaces` — true for pure inheritance, or an override like book `"Op. 68"` / piece `"Op. 68, No. 9"`), only the piece's own distinguishing remainder renders, as a bare space-joined prefix directly on the quoted title (`No. 5 "Prélude"`, never in parens, never comma-separated) — a piece with nothing to add beyond the book's own opus gets a fully bare title. Otherwise (no book opus, or a piece opus that doesn't reference the book's at all), the piece's full own opus renders as the title's own `"(...)"` suffix, independently of the book segment.
- A piece with a book and an In Copyright or Copyleft status gets a different two-sentence "written / published" structure (`buildTwoSentenceCitation`) instead of the single flat line — see Public Domain Badge below.

None of the above is reflected back into `sonneck-design.md`, which stays as the original planning artifact.

## People / Composer & Arranger
`Piece`/`Book` composer/arranger are an **ordered reference to a `Person` entity** (migration `00020`: a `people` table plus four ordered join tables — `piece_composers`/`piece_arrangers`/`book_composers`/`book_arrangers`), not a plain string — a deliberate expansion beyond the design doc's original single-string field, giving Person its own thumbnail/bio/birth+death year and a People Library + Person Details area. Resolution reuses the exact same `EffectiveTagsField`/`resolveTagsField` machinery `Instruments` already used: a piece's own non-empty list wins outright, never merged with the book's; Book has nothing to inherit from, so `Book.composer`/`.arranger` are plain ordered lists with no `Effective*` wrapper.

Person-picking `TagComboBox` fields (Composer/Arranger on `EditPieceModal.tsx`, `EditBookModal.tsx`, the Book Upload Wizard's About/Titles steps, `NewBookModal.tsx`, the single-piece Upload page) share two conventions: **`pillStyle="paper"`** (shared catalog data, same treatment `TagPills.tsx` gives Key/SheetType/Instruments — not `"accent"`, reserved for genuinely per-user data like Your Tags) and **`newOptionLabel="New person"`**. `sequenceStyle` (arrow-joined text, no pill background at all) is reserved for Key(s) only — Split People's own replacement-name picker was moved off it onto `pillStyle="paper"` for the same reason.

`components/PersonNameLinks.tsx` is the JSX-capable sibling of `lib/joinNames.ts` — renders a composer/arranger credit list with each name linking to its own Person Details page (`/people/:id`). Used on Piece Details' and Book Details' header rows and Piece Details' Source Book card; `lib/formatPieceMeta.ts`/`lib/formatBookMeta.ts` themselves stay plain-string helpers for every other caller (grid/list cards), which don't need the links.

Wikipedia integration (Edit Person's autofill, Upload Portrait's search-and-crop) is real, not mocked: `internal/wikipedia` combines a MediaWiki search + lead extract in one request, enriches birth/death years from Wikidata (a separate, more reliable source than the rendered page — an infobox can lack a birth date Wikidata still has), and portrait cropping is a genuine client-side canvas operation (Wikipedia's own images serve permissive CORS headers), not a server-side endpoint.

Full build history (Stages A/B/C, the Wikipedia integration, every polish fix since) is in memory `project_people_composer_overhaul.md`.

## IMSLP live autofill
Design doc §13 listed this as deferred; built since. `GET /api/imslp/lookup?number=<digits>` → `{composer, workOpusNumber, yearWritten, publisher, publisherId}`, any field blank if that work/file doesn't have it on record (a normal result, not an error — IMSLP is community-maintained and often incomplete). `404` for an unrecognized number, `400` for non-numeric/empty input, `502` (logged at WARN) for a real IMSLP-side failure. Shared `components/ImslpAutofillButton.tsx` (`EditPieceModal.tsx`/`EditBookModal.tsx`/`BookUploadAboutStep.tsx`) — autofill only ever writes to fields **currently blank**, never overwrites something already entered.

Trigger differs by screen, on purpose: `EditPieceModal.tsx`/`EditBookModal.tsx` are manual-click only (a number on record there was already typed/confirmed at some point). `BookUploadAboutStep.tsx` also auto-runs once on mount, since a filename-detected number is already considered confirmed by the time that screen exists — but only after a 700ms delay, so the user sees the blank screen first rather than fields silently already-different the instant it mounts.

The real access mechanism — why a bare IMSLP number needs `Special:ReverseLookup` rather than the human-facing resolver page (which is JS-redirect-gated and can't be followed server-side), and why per-file publisher/publisherId data needs a second, rendered-HTML fetch rather than wikitext — is documented in `internal/imslp`'s own package doc comment and in full in memory `project_imslp_live_autofill.md`. Neither `Special:ReverseLookup`'s redirect shape nor the `we_edition_info` table's HTML structure is a stable, versioned public contract — if autofill starts silently returning blanks, re-verify both with a real fetch against a known-good number before assuming the Go code regressed.

## Public domain badge
Design doc §13's deferred public-domain feature, now built. Four states — `publicDomain`/`copyleft` (explicit, user-picked) and `likelyPublicDomain`/`inCopyright` (computed) — resolved by `repo.ResolveCopyrightStatus` against `internal/copyright` (region-rule term calculation; `COPYRIGHT_REGION` env var, validated at startup against the region table embedded from `internal/copyright/regions.json`).

**Resolution is asymmetric and read-time only, never written back to the DB:** `publicDomain`/`likelyPublicDomain` are sticky — the live calculation never overrides them, since a term can't un-expire. `copyleft`/`inCopyright` are not sticky — the calculation can push either forward to `likelyPublicDomain` (never backward) on every read. `PieceResponse.copyrightStatus` (`CopyrightStatusResponse`) carries both the raw explicit pick (`value`/`inherited`, same shape every other book-inheritable field uses) and the calculation-corrected `effective` value the badge/citation actually display — a distinct type from the plain `EffectiveField` every other field uses, since no other field needs both a stored pick and a separately-computed display value.

`Book.yearWritten` was renamed to `Book.yearPublished` as part of this feature — a full rename (DB column, Go field, API JSON key, frontend field/label). `Piece.yearWritten` itself is untouched and still inherits from the renamed `Book.yearPublished`. The pre-built `pieces.public_domain` bool column (see Database migrations above) was dropped from `models.Piece` entirely, superseded by the real four-state enum. (The Books Library's own sort control — `BooksPage.tsx`/`api/books.ts` — was missed in that rename sweep and silently 400'd on `sort=yearWritten` until caught and fixed separately; grep for a bare `yearWritten` string literal if this class of gap is ever suspected again.)

Full design history (region-rule research, badge visual options, every locked decision) is in memory `project_public_domain_badge.md`.

## Operational basics
- `/healthz` endpoint, used by the Docker healthcheck.
- Backup: daily `VACUUM INTO` snapshot of the SQLite DB. Restore: stop container → replace the DB file → restart. Documented in the README, not just implied.

## Search
SQLite FTS5, not a separate search engine like Bleve (design doc §2's own reasoning — StashApp's approach was the starting inspiration; FTS5 achieves the same goal with less operational overhead at this project's scale).

- `pieces_fts` is denormalized, one row per `Piece` — **book-inheritable fields are indexed by their effective value**, not the raw `Piece` column, or search would miss pieces that only inherit a value from their book.
- **Sync is application-level** — an explicit `repo.ResyncSearchIndex(pieceId)` call after any `Piece` or tag-assignment mutation, in the same transaction as the mutation itself. Not SQL triggers: logic spread across `Piece` and several tag join tables is harder to discover and test than one function called from application code. Editing a `Book` field must resync every affected `Piece`, not just call this once.
- The index is derived data, safely droppable/rebuildable from `Piece`/tag tables at any time — via the `rebuild-search-index` CLI, or automatically: `cmd/sonneck/main.go`'s startup path runs a cheap row-count mismatch check and self-heals if the index is out of sync (the same "detect and auto-fix on boot, keep the manual CLI as a fallback" pattern `migrate-people`'s own backfill uses, both best-effort/non-fatal so a failure doesn't block startup).
- **Query matching is three tiers, each engaged only when the previous finds nothing**: prefix (`pieces_fts` phrase-prefix syntax) → trigram substring (`pieces_fts_trigram`, `tokenize='trigram'`) → real typo-tolerant fuzzy (`internal/fuzzy`'s Damerau-Levenshtein/Optimal-String-Alignment distance, exposed as a genuine SQLite scalar function via `modernc.org/sqlite`'s `RegisterDeterministicScalarFunction` — no CGO, no separate driver, and confirmed to work fine with `WHERE`/`ORDER BY`/`LIMIT`/`OFFSET` against a real registered function, so it needed no pagination-architecture change). Never merged — the common case (prefix already matches) never pays for the fallback tiers' cost. **Facet counts** (`GET /api/pieces/facets`/`GET /api/books/facets`) deliberately only replicate the prefix tier of this — recomputing all three tiers for up to 8 sidebar dimensions per request wasn't worth it, so a query that only trigram/fuzzy resolves can show facet counts that don't quite match the actual result list in that one case.
- **"&" and "and" are interchangeable in search, both directions** — `repo.NormalizeAmpersand` (FTS5 paths, space-padded) and `repo.NormalizeAmpersandForLike` (Books/People's plain `LIKE '%term%'`, bare replace — the two backends need different spacing rules), applied at both index and query time.
- **Admin/maintenance actions are CLI subcommands on the same binary, gated by shell/`docker exec` access — not HTTP endpoints with no auth to protect them**, since there's no real auth in v1. Existing instances: `rebuild-search-index`, `regenerate-thumbnails`, `export-csv`, `cleanup-thumbnails`, `migrate-people`. Treat this as the template for any future maintenance action that comes up before OIDC/multi-user (§13) lands — reuse the app's existing config/DB-connection bootstrap rather than duplicating it. A command that writes to the SQLite file while the server may still be running relies on WAL mode for safety, the one deliberate exception to "single writer" in an otherwise single-session v1.
- Multi-select filters (`keyId`/`sheetTypeId`/`instrumentId`/`userTagId` on pieces, `sheetTypeId`/`instrumentId` on books) take comma-separated IDs, OR-matched. Facet counts are live/faceted, not static — each value's count reflects every *other* currently active filter, never narrowing against its own selection. Title sort ignores a leading "A"/"An"/"The" (library-catalog convention), computed in SQL rather than a stored sort-name column.

Full build detail (the fuzzy-tier algorithm survey, the trigram/book_title/ampersand migrations and their own backfill requirements, the facet-narrowing math) is in memory `project_fuzzy_search_research.md`, `project_search_book_title.md`, and `project_search_ampersand_and.md`.

## Frontend
| Concern | Choice |
|---|---|
| Language | TypeScript — types mirror the backend's `{data}`/`{error}` contract |
| Data fetching | TanStack Query for all API calls, not ad-hoc `useEffect`/`useState` |
| Forms | react-hook-form, **light** client-side validation only (required fields, plausible ranges) — the backend stays sole authority; don't maintain a mirrored validation schema |
| Styling | Tailwind CSS, palette/type/spacing as theme tokens |
| Routing | React Router — wizard steps are real routes |
| Icons | Tabler Icons (`@tabler/icons-react`, the scoped package) — import by name, never `import *` |
| Typography | `--font-display`/`--font-sans`/`--font-music` all self-hosted (SIL OFL 1.1, files in `frontend/src/assets/fonts/`), never loaded from Google's CDN at runtime |

- **Shell scope:** build the sidebar nav/route shell to accommodate all planned features early — scaffold-and-hide a not-yet-built feature (route/component exists, reachable, visually present even if stubbed) rather than omitting it as if undecided.
- **Mockup-first, both directions, is a standing rule** (memory `feedback_mockup_first_standing_rule.md`): a genuinely new visual/UX design goes to its `/mockup/*` counterpart first for approval before touching the real page; once any change lands in a real page that has a mockup counterpart — new interaction, added affordance, copy/behavior fix, not just a redesign — the same change gets ported into the mockup in the same pass by default. Mockups deliberately don't import real components (they're a frozen, hand-maintained visual reference) — the one exception is pure presentational data/logic with no markup of its own (e.g. `lib/formatPieceMeta.ts`, `lib/copyrightBadge.ts`), which *is* shared.
- **Wizard draft persistence**: `localStorage`, keyed by `bookId`, storing split points + in-progress field values — restore on return to an in-progress import, clear on confirm or explicit cancel.
- **Mobile scope**: the import wizard needs deliberate touch-friendly interaction design for the split-marking step specifically, not just responsive CSS carried over from a desktop layout.
- **Computed fields — deviation from design doc §3**: `Piece.duration` is a plain, directly user-entered field (not auto-recomputed from `bpm`/`measureCount`/`beatsPerMeasure` on every write, contrary to §3's original intent) — a manual "Calculate" convenience button fills it in once from the same formula, but nothing re-applies it server-side after that; the three tempo fields are now purely informational/calculator inputs.
- **`tsc --noEmit -p .` is a silent no-op** — `frontend/tsconfig.json` is a solution-style config (`{ files: [], references: [...] }`) with nothing for the type-checker to actually check. Always run `tsc --noEmit -p tsconfig.app.json`.
- Piece/Book descriptions and a piece's own notes support Markdown (`react-markdown` + `remark-breaks`, through a shared `MarkdownText.tsx` — every field that renders one of these three goes through it) plus a small set of `:shortcode:` music symbols rendered via a self-hosted Bravura Text subset — see `CONTRIBUTING.md`'s own "Music symbol shortcodes" section for the shortcode-map source of truth and how to regenerate the font subset/preview images if either changes.
- **No AI-generated visual assets** — logo/brand/icon work stays hand-authored SVG, never sourced from an image generator. Most such tools' Terms of Service don't permit releasing the output under an open-source license, which conflicts with Sonneck being open-source.

**Standing CSS/React gotchas** (full detail and more instances in memory `frontend_design_system.md` — check there for current truth on any CSS/React gotcha before re-deriving one):
- A plain `<button>` needs `cursor-pointer` added explicitly — Tailwind's preflight resets it to `cursor: default`, unlike `<a>`, which gets `pointer` natively.
- Icon colors are always a solid pre-blend hex, never a translucent opacity utility — many Tabler icons render as several overlapping `<path>`s sharing one stroke color, and a translucent color re-blends unevenly at every overlap.
- Every dropdown-style field (`TagComboBox`, `SingleSelect`, `SourceBookField`, and any future one) must support ArrowUp/ArrowDown (wrapping at both ends) and Enter.
- Card-style navigation renders a real `<Link>`/`<a>` (`components/ClickableCard.tsx`), never a click-handled `<div>` — a synthetic click handler has no `href`, so cmd/ctrl/middle-click and "open in new tab" silently don't work without a real anchor. A nested interactive child (a button inside the card) must call both `event.preventDefault()` and `event.stopPropagation()` to suppress the card's own navigation — `stopPropagation()` alone isn't enough, since it only stops React's synthetic handler, not the underlying anchor's native default action.
- `overflow: hidden` on an ancestor clips a `position: fixed` **or** `position: absolute` descendant regardless of that descendant's own computed geometry (bounding box, opacity, z-index can all report "correct" while nothing actually paints) — a popup/dropdown that must escape a `Modal`'s own rounded-corner clipping needs a real portal to `document.body`, not just a higher `z-index`.
- A mutation's "in progress" UI needs an artificial minimum display duration (`lib/minDuration.ts`, `afterMinDuration`) — this app's mutations hit a local SQLite backend and routinely resolve in under one browser paint frame, so a stripe animation or "Saving…" state can be genuinely invisible without one.
- A CSS animation that must keep running under real main-thread load animates `transform`/`opacity` (compositor-only), never `background-position` (forces a full repaint on every single frame — a well-known main-thread-repaint hazard).
- Dot separator is a bullet (`•`), never an interpunct (`·`); page-range abbreviation is the academic `p.`/`pp.` convention, never `pg.` — both keep drifting into freshly-built `/mockup/*` screens with their own local formatting; grep for the literal stale pattern when finishing a new one rather than trusting memory of every call site.

## Docker / build
Single Docker image — the Go binary embeds the built frontend via `//go:embed` (`internal/webui`, `all:dist`, with a committed placeholder `index.html` so `go build`/`go run` compile without a real frontend build present; local dev serves the frontend via Vite on `:5173` instead). `internal/handlers/server.go`'s catch-all (`spaHandler`) returns the `{error}` envelope for an `/api/*` miss, otherwise serves a static file from the embedded FS or falls back to `index.html` so a client-side route survives a hard refresh.

- **`Dockerfile`**: 3 stages, no cross-compilation in the file itself — `node` builds the frontend, `golang` copies that output over the placeholder and runs `CGO_ENABLED=0 go build` (no CGO anywhere in this module, so this produces a fully static binary), `debian-slim` is the runtime (`poppler-utils` for PDF thumbnailing, `wget` for the `HEALTHCHECK`). Runs as a fixed non-root uid/gid 1000 — `/data` is `chown`'d to that user at build time so a fresh Docker named volume inherits correct ownership automatically; a host bind-mount (what `docker-compose.yml` actually uses) keeps whatever ownership the host directory already has, which needs a manual `chown` on a host where the operator's own uid isn't 1000 (documented inline in `docker-compose.yml`).
- **`docker-compose.yml`**: one service, host bind-mount at `/data`, commented `environment:` block, healthcheck using `/healthz`.
- **CI** (`.github/workflows/docker-publish.yml`): a push to `main` runs a validation build only (`push: false` — what the README's Build-status badge reflects day to day). Publishing to GHCR only happens on a GitHub Release, split by `github.event.action`: both `released` and `prereleased` build a real multi-arch image (native ARM64 runners, not QEMU — `linux/amd64`/`linux/arm64` as separate matrix jobs pushed by digest, merged into one manifest via `docker buildx imagetools create`) and unconditionally move the floating `:dev` tag to it; only `released` additionally moves `:latest`, and only after confirming via the GitHub API that this release is genuinely what GitHub currently considers latest (not just "most recently published") — a release for an older branch, or with "Set as the latest release" unchecked, can't clobber it. `workflow_dispatch` re-runs just that `:latest` check/re-point with no rebuild, for correcting which release is marked latest after the fact. Every `${{ github.event.release.tag_name }}` reference goes through an `env:` var, never interpolated directly into a `run:` script body (git ref names allow shell metacharacters).
- **GHCR package visibility is independent of the source repo's visibility** — after the first release-triggered publish, the package defaults to private regardless, and needs a manual Package settings → visibility → Public (this **cannot be undone** through the normal UI once switched).

## Open items still pending a decision
None currently — the last tracked item (the Book Upload Wizard's 10-color split palette) shipped; see memory `project_split_palette_expansion.md` if the palette itself ever needs revisiting.
