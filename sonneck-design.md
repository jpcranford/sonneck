# Sonneck — Design Document

*Codename, after the English music scholar.*

## 1. Goals & non-goals for v1

**Goal:** a self-hosted, Docker-deployed library organizer for sheet music — import, tag, browse, and download pieces. A useful *organizer* first; playback/viewing comes later.

Everything intentionally left out of v1 is consolidated in §13, “Features to Add Later.”

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Go (1.21+) | Precedent from SheetAble, good fit for a single static binary. Version floor is 1.21 specifically to get `log/slog` (see `CLAUDE.md` → Logging) — no third-party logging library needed. |
| Database | SQLite | File-based, trivial to back up (one file), fits single-image/single-instance deployment |
| Frontend language | TypeScript | Chosen for maintainer accommodation (your stated criterion): it's the default expectation for new React projects at this point, and self-documents the API surface via types rather than requiring contributors to infer shapes from component code. Bonus: types can mirror the backend's `{data}`/`{error}` contract, catching drift at compile time. |
| Frontend framework | React + Vite | Modern build tooling — deliberately *not* Create React App, to avoid the Node/webpack/OpenSSL version conflicts hit while debugging SheetAble's build this session |
| Frontend data fetching | TanStack Query | Without a stated convention here, every component grows its own ad-hoc fetch/loading/error logic. TanStack Query gives one consistent pattern for caching, loading/error states, and cache invalidation after mutations (e.g. refetch the library list after an import completes). |
| Frontend forms | react-hook-form, light client-side validation only | Required fields and obviously-plausible ranges get instant client-side feedback; the backend's shared validation table (§5) remains sole authority for everything else. Deliberately *not* a full zod schema mirroring every backend rule — keeping two full validation definitions, in two languages, in sync forever is a real drift risk for a small early contributor base, for limited additional benefit. |
| Frontend styling | Tailwind CSS, high-contrast palette as theme tokens | Defines the "high-contrast for maximum visibility" requirement as an enforced token set, not a per-component judgment call. Formal accessibility compliance (WCAG auditing, full ARIA coverage, screen-reader testing) is a **tertiary concern for v1** — see §10 for the actual design priority driving this. |
| Icon set | Tabler Icons, via `@tabler/icons-react` | Confirmed via search: the current, actively maintained package (not the older unscoped `tabler-icons-react`, last published years ago — avoid that one, it's easy to confuse the two). Free, MIT-licensed, minimalist outline style that fits the clean/high-contrast design language already established (§10). Tree-shakable — import icons by name (`import { IconDownload } from '@tabler/icons-react'`), never `import *`. |
| Frontend routing | React Router | Wizard steps are real routes, not just component state — sane back/forward and refresh behavior instead of accidentally losing progress on navigation. |
| Frontend↔backend calls | Relative paths (e.g. `/api/pieces`), same-origin | No base-URL config needed — a direct consequence of the single-image architecture (Deployment row below); no CORS to configure either. |
| Deployment | Single Docker image | Backend serves the built frontend directly — no CORS, no reverse proxy needed, frontend/backend can't drift out of sync |
| Frontend embedding | Go's native `//go:embed` | SheetAble used `go.rice`, an external CLI step with fragile relative-path behavior we hit directly while debugging that project's build. Since this is a new project, Go 1.16+'s built-in `embed` package avoids that whole class of bug with no extra tooling. |
| SQLite driver | `modernc.org/sqlite` (pure Go) | Avoids CGO. The common `mattn/go-sqlite3` driver requires CGO, which makes cross-compiling for arm64 in CI meaningfully more painful. Pure-Go avoids that entirely — relevant given the multi-arch requirement in §9. |
| File hashing | SHA-256 (`crypto/sha256`, standard library) | Switched from BLAKE3 (which had itself replaced MD5). BLAKE3 was originally chosen for large-file hashing speed and to move off MD5's collision concerns — but for a small early open-source project, it meant carrying a third-party dependency to track and update for a marginal, likely-imperceptible win, since book imports are an infrequent, human-triggered action, not a hot path. `sha256` gets the same collision-safety property with zero added dependency footprint, no CGO, and works natively on both target architectures already — it's fully part of Go's standard library. |
| PDF rendering (thumbnails) | `poppler-utils` (external binary, shelled out from Go) | Tiny, extremely well-documented CLI (`pdftoppm`/`pdftocairo`), same approach SheetAble's own `pdf2png` sidecar used. Chosen over `go-pdfium`'s WASM mode for documentation maturity and ubiquity. Trade-off: needs `apt-get install poppler-utils` in the runtime image (see §9) since it's a subprocess dependency, not a Go library. |
| Schema migrations | `goose` | Simpler API than `golang-migrate`, good fit for a project this size. This concern (schema drift across many separate, possibly-AI-driven sessions) is about session count, not team size — it holds regardless of how small the contributor base is, and `goose` itself is a small, well-documented, low-overhead tool. |
| Search index | SQLite FTS5 (built into SQLite itself) | Inspired by researching StashApp's approach (Bleve, a separate Go full-text library with its own on-disk index files and a staleness/rebuild schedule) — but FTS5 achieves the same goal (search across all fields without a full table scan) with real advantages here: zero new dependency (already compiled into SQLite, which we're already using), no separate index-file lifecycle to manage (kept in sync via SQL triggers instead of a background rebuild job), and it lives in the same database file, so the existing backup (§4) already covers it. Trade-off, stated plainly: Bleve/dedicated search engines generally offer richer relevance ranking and fuzzy matching out of the box than FTS5's simpler token/prefix matching — a real capability gap, not just a style difference, but one judged worth accepting for this project's scale and search-as-you-type use case. See §11 for the index design. |

## 3. Data model
### `Piece` (the core unit)
| Field                              | Type                          | Notes                                                        |
|------------------------------------|-------------------------------|--------------------------------------------------------------|
| `id`                               | PK                            |                                                              |
| `title`                            | string                        | Never book-inheritable — each piece's title is inherently its own. |
| `composer`                         | string, nullable              | **Book-inheritable** (see the new subsection right after this table). "Required by the citation feature" now means the *effective* value (piece's own, falling back to the book's) must be non-empty — not necessarily this column itself. |
| `arranger`                         | string, nullable              | Not part of the citation format (§6) as currently specified — flagging for awareness, not blocking, since the format is otherwise resolved. Not book-inheritable (not in the confirmed field list below). |
| `favorite`                         | bool                          | Per-user eventually, same treatment as `userNotes`/`userTags` below: simple flat field in v1 (single implicit user), real migration to per-account data if/when multi-user lands (§13). |
| `workOpusNumber`                   | string, nullable              | **Book-inheritable** (corrected — see the reasoning right after this table; earlier reasoning that it had no book-level equivalent was wrong). Info button (not hover tooltip — see §12): "If this piece is part of a larger work which has a number assigned, enter that number." |
| `key`                              | tag (FK to `Key` table)       | Seeded with the 24 standard major/minor keys. Not book-inheritable — pieces within the same book routinely differ in key, so a book-level default wouldn't be meaningful. |
| `instruments`                      | tags (many-to-many)           | **Book-inheritable.** |
| `sheetType`                        | tag (FK to `SheetType` table) | **Book-inheritable.** Pre-seeded: Lead Sheet, Solo Part, Ensemble Score, PVG Score. A future version adds a `definition` text field per type, viewable from the piece edit menu — see §13. |
| `publisher`                        | string, nullable              | **Book-inheritable.** |
| `publisherId`                      | string, nullable              | **Book-inheritable.** |
| `yearWritten`                      | string, nullable              | **Book-inheritable.** Free-text, supports approximate/uncertain dates (e.g. `"ca. 1708-1711"`). Used for citation display — see §6. |
| `description`                      | string, nullable              | **Book-inheritable.** Text box for piece descriptions. |
| `userNotes`                        | string, nullable              | User-authored free-text notes (not account-scoped — v1 has no user model, see §8; becomes genuinely per-account data if/when multi-user lands, see §13). Not book-inheritable. |
| `userTags`                         | tags (many-to-many)           | User-authored tags, as opposed to the system-seeded `Key`/`SheetType` lookups — not account-scoped for the same reason as `userNotes` above. Not book-inheritable. |
| `practiceStatus`                   | string, nullable (enum)       | One of: `Want to Learn`, `Learning`, `Learned`, `Stalled`, `Dropped`. Nullable — "no status set" is a valid, distinct state from any of the five. Same per-user-eventually treatment as `favorite` above. Not a relational lookup table like `Key`/`SheetType`, since there's no indication these five values need runtime editing/expansion the way `SheetType` definitions do (§13) — a fixed, app-level enum is enough. Not book-inheritable. |
| `imslpNumber`                      | string, nullable              | **Book-inheritable.** Filename-based detection (simple regex, e.g. `IMSLP\d+`) runs against `Book.originalFilename` and is stored on `Book.imslpNumber` (§3's `Book` table) as the inheritance source — not detected-then-copied per piece anymore, superseded by the general inheritance mechanism below. Only the *live autofill from IMSLP* stays deferred, see §13. |
| `sourceBookId`                     | FK to `Book`, nullable        | Null if not imported via the book wizard. **Not paired with a denormalized `sourceBookTitle` on `Piece`** — anywhere the book title needs displaying (e.g. Piece View, §14), look it up live via `sourceBookId → Book.bookTitle`, rather than storing a copy. Editing writes to exactly one record, `Book` itself — nothing on any `Piece` row changes. What changes is what gets *read* wherever a piece's book title is resolved, since every piece with that `sourceBookId` looks it up live rather than from a stored copy. |
| `sourcePageStart`, `sourcePageEnd` | int, nullable                 | **Editable, purely cosmetic** — used for citation/reference display only, not tied to any backend operation (the actual file splitting is permanent and already done at import time; changing these numbers doesn't re-slice anything). Seeded from the actual PDF page range extracted at import, but expected to often need correcting afterward: PDF page indices and a scanned book's *printed* page numbers frequently don't match (front matter, unnumbered pages, etc.), and the printed numbers are usually what's actually useful to show. |
| `duration`                         | int, nullable (seconds)       | Computed as `(measureCount × beatsPerMeasure ÷ bpm) × 60`, recalculated whenever those three inputs change. Rendered client-side as `mm:ss`. Null if any of the three inputs is missing. |
| `bpm`, `measureCount`, `beatsPerMeasure` | int, nullable            | Supporting inputs for the `duration` calculation above. All optional — a piece can have none of these set. In the edit menu UI, tucked behind an "advanced" disclosure since `duration` is the field that actually matters day-to-day (per your notes). |
| `filePath`                         | string                        | Path to this piece's own extracted PDF                       |
| `fileHash`                         | string                        | SHA-256 hash of the extracted file (see §2)                  |
| `createdAt`, `updatedAt`           | timestamp                     |                                                              |

**Not in v1 but built anyways to avoid migrations at a later time -** `copyrightYear` (int) and `publicDomain` (bool), tied to a public-domain-badge calculation feature. That whole feature is deferred — see §13 for the fields, the calculation approach, and the research already done on it, preserved there rather than lost. **Deliberate exception to the migration convention** (see `CLAUDE.md` → Database migrations): these two specifically are cheap, simple columns worth having now rather than as a future migration; `composerDeathYear` — part of the same deferred feature — does *not* get the same treatment and will arrive as a real migration if/when the public-domain feature is built, since it's not similarly cheap/simple to justify pre-building unused.

### Book-level soft inheritance
A revision of an earlier decision worth being explicit about: this doc originally scoped the import wizard as "no inheritance, flat copy only" (§5's title). This feature reintroduces a form of inheritance, but a fundamentally lighter one than what was originally ruled out — no live link, no cascading writes when the book changes, just a smart default display plus a one-time convenience copy. Confirmed in scope for: `composer`, `instruments`, `sheetType`, `publisher`, `publisherId`, `yearWritten`, `description`, `imslpNumber`, `workOpusNumber`. Explicitly **not** in scope: `title` (inherently piece-specific), `key` (pieces within one book routinely differ in key). A "genre"/tag-style book-level field was considered and **not adopted** — not sold on its usefulness to the target audience yet; see §13 if it's revisited later.

**Correction:** `workOpusNumber` was initially scoped as piece-only, on the assumption it had no sensible book-level equivalent — wrong. A multi-movement work is a real, common case for the book/piece split here: Widor's famous Toccata is the fifth movement of his Symphony for Organ No. 5, and both his fifth and sixth symphonies share the same opus number, Op. 42. The opus number genuinely belongs at the "book" (symphony) level in a case like that, with each movement (piece) inheriting it — exactly what this feature is for.

**Mechanism** (almost entirely frontend, per your framing):
- If a piece's own value for one of the nine fields above is empty **and** it has a `sourceBookId`, the UI displays the book's value instead, labeled "Inherited from book."
- In the piece edit menu (§15), an optional "copy from book" button appears next to each of those fields, but **only when the piece's own value for that field is empty**. Clicking it copies the book's current value down into the piece's own column — a one-time, permanent write, not an ongoing link. Once the piece has its own value (typed or copied), the button disappears and inheritance display no longer applies to that field for that piece.
- Clearing a piece's own value back to empty reinstates inherited display, for the same reason.

**This supersedes the earlier wizard-time prefill mechanism** for `composer`/`yearWritten`/`imslpNumber` (previously: copied onto every piece at wizard step 3, via a "copy to all" button). That mechanism is removed — see §5's rewritten step 3. The book-level source fields (`Book.composer`, `Book.yearWritten`, `Book.imslpNumber`, `Book.workOpusNumber`, plus the newly added `Book.instruments`/`Book.sheetType`/`Book.publisher`/`Book.publisherId`/`Book.description`) now live on `Book` itself and are edited through the Book Properties Edit Menu (§16), not collected piece-by-piece during import.

**Real consequences worth being explicit about**, not just a display detail:
- **Validation** (§5's Field validation table): "required" fields among the nine above (`composer`) now mean the *effective* value must be non-empty — piece's own, or the book's if the piece's own is blank — not literally the piece's stored column. A piece with `sourceBookId` set and a book with a `composer` satisfies the requirement even with `Piece.composer` itself null.
- **Citation generation** (§6): must resolve `composer`, `publisher`, `publisherId`, `imslpNumber`, `yearWritten`, `workOpusNumber` the same way — effective value, not raw column — or an inherited-but-uncommitted piece would produce a broken or incomplete citation despite displaying correctly everywhere else.
- **Search index** (this section, above): `pieces_fts` must index *effective* values, not raw `Piece` columns, or searching for a composer/publisher/opus-number/etc. would miss pieces that only inherit it from their book. Editing a book-level field (via §16) resyncs the `pieces_fts` row of every piece belonging to that book without an override — a search-index consequence of how `pieces_fts` denormalizes data, not a write to those pieces' actual rows (see §16's correction on this point). Both effective-value resolution and the resync fan-out should be centralized in one shared "resolve effective piece values" helper, used consistently by display, validation, citation generation, and search indexing — not reimplemented separately in each — see `CLAUDE.md`.

### `Book`
**Entirely optional across the app** — a grouping construct for pieces that share a source, not a required parent. `Piece` is the app's actual primary unit; `sourceBookId` has always been nullable (§3's `Piece` table), and a piece with no `Book` at all is a completely normal, first-class case, not a special one — see §5's "Single-piece upload" for how those get created. When a `Book` does exist, it's persisted permanently as the "original unmodified file."
| Field              | Type      | Notes                              |
|--------------------|-----------|------------------------------------|
| `id`               | PK        |                                    |
| `bookTitle`        | string    | Edited through the Book Properties Edit Menu (§16), reached from the Piece View's Book Details section (§14). |
| `composer`         | string, nullable | Inheritance source for `Piece.composer` — see "Book-level soft inheritance" above. Was previously a wizard-step-1 prefill value; now edited through §16 like any other `Book` field. |
| `yearWritten`      | string, nullable | Renamed from `publishYear` for consistency with `Piece.yearWritten`, now that the parallel structure between `Book` and `Piece` is a real, general pattern rather than a one-off prefill. Inheritance source for `Piece.yearWritten`. |
| `workOpusNumber`   | string, nullable | Inheritance source for `Piece.workOpusNumber` — added for multi-movement works where the opus number belongs at the book/symphony level (e.g. Widor's symphonies), not the individual movement/piece. |
| `instruments`      | tags (many-to-many) | Mirrors `Piece.instruments`' structure — inheritance source for it. |
| `sheetType`        | tag (FK to `SheetType` table) | Mirrors `Piece.sheetType` — inheritance source for it. |
| `publisher`        | string, nullable | Inheritance source for `Piece.publisher`. |
| `publisherId`      | string, nullable | Inheritance source for `Piece.publisherId`. |
| `description`      | string, nullable | Inheritance source for `Piece.description`. |
| `imslpNumber`      | string, nullable | Detected via filename regex against `originalFilename` below (§3's `Piece.imslpNumber` row) and stored here directly, rather than being copied onto pieces at detection time — this is now the inheritance source, same mechanism as every other field in this table. |
| `originalFilename` | string    |                                    |
| `filePath`         | string    | Path to the stored original upload |
| `fileHash`         | string    | SHA-256 hash of the original file  |
| `importedAt`       | timestamp |                                    |

### `Key` (lookup table)
Seeded at first run with the 24 standard major/minor keys.

### `SheetType` (lookup table)
Seeded at first run with: Lead Sheet, Solo Part, Ensemble Score, PVG Score. A future version adds a `definition` field per type, shown as help text in the piece edit menu — see §13.

*(`Key`, `SheetType`, and the instrument/user-tag join tables are relational rather than flat string columns deliberately — tag-based filtering in §11 is core v1 functionality, not a nice-to-have, and this is what that feature actually requires.)*

### Search index (`pieces_fts`)
An SQLite FTS5 virtual table, not a separate persisted source of truth — same principle StashApp applies to its own index (researched directly: the underlying database remains authoritative, the index is regenerated data that can always be safely rebuilt), just via a different, lighter-weight mechanism (see §2).

- **Denormalized content**: one row per `Piece`, combining `title`, `arranger`, `userNotes`, plus the joined names of `key`/`instruments`/`sheetType`/`userTags` (FTS5 tables are flat — the tag names have to be flattened into the row's text at write time, they can't stay relational inside the virtual table itself). **The book-inheritable fields — `composer`, `publisher`, `publisherId`, `imslpNumber`, `yearWritten`, `workOpusNumber`, `description`, plus `instruments`/`sheetType`'s book-level values — are indexed as their *effective* value** (piece's own, falling back to the book's — §3's "Book-level soft inheritance"), not the raw `Piece` column, or a search for a composer/publisher/opus-number/etc. would silently miss every piece that only inherits it from its book.
- **Kept in sync incrementally**, not on a rebuild schedule — every `Piece` write (create/update/delete) and every tag-assignment change updates the corresponding `pieces_fts` row in the same transaction, via an application-level resync call rather than SQL triggers (see `CLAUDE.md` → Search for the reasoning). **Editing a `Book`-level field (§16) resyncs every `Piece` with that `sourceBookId` that doesn't override the field, not just one row** — a single book-level edit can change what several pieces effectively display and should therefore be searchable by. No 21-day staleness window like StashApp's Bleve index needs; the index is always current by construction.
- **Manual full rebuild**: a CLI subcommand (e.g. `./main rebuild-search-index`), not an HTTP endpoint — v1 has no auth (§8), so an unauthenticated HTTP route for a destructive/expensive admin action would be reachable by anyone who can hit the app over the network. Shell/`docker exec` access is a tighter, more appropriate gate for v1. Runs safely against the live, still-serving container — WAL mode (§4.5) is exactly what makes a second process safely writing to the same SQLite file possible without stopping the server first. Drops and repopulates `pieces_fts` from `Piece`/tag data in a single transaction; at this project's expected scale, this should take well under a second.

### Settings
No settings table in v1 — global config is environment-variable driven per your decision:
- `CITATION_FORMAT` — template string (see §6)
- `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_CRON` — see §4

*(A `COPYRIGHT_REGION` env var was specified in an earlier pass, for the now-deferred public-domain feature — see §13.)*

## 4. File storage & backups

```
/data/
  library/
    books/<sha256-hash>.pdf     # original unmodified uploads
    pieces/<sha256-hash>.pdf     # extracted per-piece files
  db/
    sonneck.sqlite
  backups/
    sonneck-YYYY-MM-DD.sqlite
```

- Both the original book PDF and the extracted per-piece PDFs are retained indefinitely. "Download piece" serves the piece's own extracted file, never the full book.
- **Daily backup job**: a scheduled in-process task that snapshots the database, timing configurable via `BACKUP_CRON` (standard cron expression, default `0 3 * * *` — 3 AM daily — if unset). Use SQLite's `VACUUM INTO` (or the backup API) rather than a raw file copy — a raw copy can catch the file mid-write; `VACUUM INTO` guarantees a consistent snapshot. Scheduling itself needs a small cron-expression parser/scheduler — `robfig/cron` is the standard, well-known, pure-Go choice for this (no CGO, fits the project's existing dependency posture — see §2's BLAKE3-vs-SHA256, `modernc.org/sqlite` reasoning for the same pattern).
- Retention controlled by `BACKUP_RETENTION_DAYS` (delete backups older than N days).
- The library folder itself (books/pieces) should live on a mounted volume the user is expected to back up separately (e.g., via their NAS's own snapshot mechanism) — the app's job is the DB backup, not full-library backup.
- **Restore procedure** (documented, not just backup creation): stop the container, replace `/data/db/sonneck.sqlite` with the desired backup file, restart. Worth a line in the README, not just implied by the backup mechanism existing.

### 4.5 Concurrency
v1 targets a single user, single session (§8) — this removes the need for multi-writer conflict handling. Still worth doing cheaply regardless: enable SQLite's **WAL mode** at startup. It costs nothing, and protects against edge cases like an accidental double-submit from the browser without requiring any real concurrency design.

## 5. Import wizard

1. **Upload** a book PDF → compute SHA-256 hash, store as-is under `library/books/`, create a `Book` record. `bookTitle` defaults to the filename (minus extension), editable at this step. `imslpNumber` auto-detects from `Book.originalFilename` (§3) if present. Other `Book` fields (`composer`, `yearWritten`, `instruments`, `sheetType`, `publisher`, `publisherId`, `description`) are optional here — they can be set now or later via the Book Properties Edit Menu (§16), since book-level soft inheritance (§3) means nothing downstream depends on filling them in during the wizard specifically. **Dedupe on hash match**: if an existing `Book` already has this hash, reuse that record instead of creating a duplicate — no second copy of the same file. Render page thumbnails (via `poppler-utils`, see §2) for the next step.
2. **Split**: user marks page ranges → each range becomes one prospective `Piece`.
3. **Fill fields** per piece — a thumbnail of the piece's first page is shown alongside the fields for each piece (reusing the page images already rendered for step 2's split-marking, no separate render needed — just the image for that piece's first page). In practice, field entry is now just each piece's own `title` (required), since `workOpusNumber` joined the book-inheritable fields (§3, corrected from an earlier pass) and everything else book-inheritable doesn't need piece-level entry at all unless the user wants to override a specific piece immediately. This is substantially lighter than earlier versions of this doc — no more bulk-fill "copy to all" button, no more per-piece prefill step, both superseded by book-level soft inheritance (§3).
4. **Confirm**: for each range, extract those pages into a standalone PDF, hash it, store under `library/pieces/`, create the `Piece` record with `sourceBookId` + page range set.

**Transactional guarantee:** the confirm step must be all-or-nothing. Strategy: extract all piece files into a temp staging directory first; only after every extraction succeeds, open a single DB transaction and insert all `Piece` rows; only after that transaction commits, atomically move (rename) the staged files from temp into their final `library/pieces/` location. If anything fails at any point — an extraction error, a DB error — nothing has been committed and the staging directory is simply discarded. This avoids ever having a half-imported book: either all N pieces exist (files + DB rows), or none do.

**Design note:** extraction happens once, at import time (not on-demand at download time) — keeps the download path trivially simple (serve a static file) at the cost of a bit more storage, which isn't expected to be the bottleneck here.

**Draft persistence:** the uploaded book PDF itself is safe as soon as step 1 completes (it's already written server-side and has a `Book` record). What's at risk of being lost is the in-progress split-point marking and per-piece field entry from steps 2–3. Persist this to browser `localStorage`, keyed by `bookId` — split points + field values as a JSON blob, restored automatically if the user returns to an in-progress import, cleared on successful confirm (or explicit cancel). Small enough data that `localStorage` is sufficient; no need for IndexedDB. This fully covers the actual safety property that matters (no lost work on a refresh); a dedicated UI for browsing abandoned imports is a nice-to-have on top of that, not required for it — see §13.

**Mobile scope:** full mobile/tablet support is required for the wizard itself, not just the browse/view experience — per your call. Worth being explicit that this is genuinely harder than the desktop version: marking split points across many page thumbnails needs a real touch-friendly interaction design (large tap targets, a workable layout for scrolling through potentially hundreds of thumbnails on a small screen), not just responsive CSS on the desktop layout. Desktop can rely on arrow keys/enter to move through potentially hundreds of pages quickly — touch has no equivalent, so this needs its own interaction pattern rather than a scaled-down version of the desktop one. One candidate worth prototyping: drag-to-select a range, then drag the resulting divider to adjust it — balancing thumbnail size (for visibility) against how many fit on screen at once is the central tension to design around. This deserves real testing on an actual phone/small tablet, echoing the same low-spec-device concern flagged elsewhere for the (deferred) Sheet Viewer.

### Single-piece upload (no book)
A separate, simpler path alongside the wizard above — not a special case of it. Since `Book` is entirely optional (§3) and `Piece` is the app's actual primary unit, adding one piece with nothing to split shouldn't require going through book upload → split-marking → confirm for a "book" that only ever has one page range.

- Upload a PDF directly → compute SHA-256 hash, store under `library/pieces/` (not `library/books/` — there's no `Book` involved at all), create the `Piece` record directly. `sourceBookId`, `sourcePageStart`, `sourcePageEnd` all stay null.
- Fill in fields — same field set as any piece (§3), but since there's no `Book` to inherit from, the book-inheritable fields (`composer`, `instruments`, `sheetType`, `publisher`, `publisherId`, `yearWritten`, `description`, `imslpNumber`, `workOpusNumber`) are just ordinary piece-level entry here, no inheritance/display-fallback applies. `imslpNumber` filename-detection (§3) still runs against the uploaded file's original name.
- Same validation rules apply (below) — `title`/effective-`composer` required, same as any piece.
- **This is the capability a future richer "drag and drop anywhere in the app" entry point (§13) would sit on top of** — the underlying single-piece upload path needs to exist regardless of when that nicer frontend wrapper gets built, since Piece View's file-replace (§14) needs the same "take a raw upload and attach it to a piece" mechanism anyway.

### Field validation

Needed in both places a piece's fields get edited — the wizard's per-piece fill step (§5.3) and the standalone piece edit menu — so this should be **one shared validation function/endpoint**, not duplicated logic in two UI flows. The frontend layer over this is intentionally light — see §2's "Frontend forms" row.

**General rule:** all line-text inputs (as opposed to the box/multi-line inputs like `description`/`userNotes`) have a 255-character max, validated both client- and server-side.

| Field | Rule |
|---|---|
| `title` | Required, non-empty, max 255 chars |
| `composer` | Required, max 255 chars, but "required" now means the *effective* value (piece's own, falling back to the book's if blank — §3's "Book-level soft inheritance") must be non-empty, not literally `Piece.composer` itself (needed for citations to be meaningful) |
| `yearWritten` | Free text, max 255 chars, no other format enforced (by design, to allow "ca. 1708–1711"-style ranges) |
| `imslpNumber` | Optional, max 255 chars; light format check (e.g. matches `IMSLP\d+`) rather than hard rejection, since v1 has no live IMSLP verification to confirm against |
| `key`, `instruments`, `sheetType`, `userTags` | Free-form tag entry against the seeded lookup tables (Calibre-style: pick existing or type a new one), each tag value max 255 chars |
| `publisher`, `publisherId`, `arranger` | Optional, max 255 chars, no other format constraints |
| `workOpusNumber` | Optional, max 255 chars — book-inheritable (§3), same "effective value" resolution as `composer` above, though not itself a required field |
| `favorite` | Boolean, no validation needed |
| `practiceStatus` | Optional; if provided, must be one of the five fixed values (§3) — no free text |
| `description`, `userNotes` | Optional, no length limit (box/multi-line inputs, not line inputs — the 255-char rule above doesn't apply) |
| `bpm`, `measureCount`, `beatsPerMeasure` | Optional; if provided, must be a positive integer |

*(A `copyrightYear` validation rule — integer, sane year range, disabled when `publicDomain` is checked — was specified in an earlier pass, alongside the now-deferred public-domain feature. Preserved in §13 for whenever that field returns.)*

## 6. Citation

v1 ships a click-to-copy citation button using the fields that exist in v1: `composer`, `Book.bookTitle` (via `sourceBookId`, not a stored `Piece` column — see §3), `title`, `workOpusNumber`, `imslpNumber`, `publisherId`, `publisher`, `yearWritten`. Fields that are blank are omitted entirely, not shown as empty punctuation.

- **Book-inheritable fields resolve to their effective value** (§3's "Book-level soft inheritance"): `composer`, `publisher`, `publisherId`, `imslpNumber`, `yearWritten`, `workOpusNumber` use the piece's own value if set, falling back to the book's if not — the same resolution used for display, not the raw `Piece` column directly. Otherwise a piece correctly showing an inherited composer everywhere else in the UI would produce a broken citation, which would be a real inconsistency, not just a missed detail.
- **Format**: `{composer}, {Book.bookTitle}, "{title}" ({workOpusNumber}), {publisher}, {imslpNumber, falling back to publisherId if blank}, ca. {yearWritten}` — with the book title italicized, and any blank field omitted entirely (not shown as empty punctuation). This adds the source book's title as a citation component for the first time (sensible now that the field exists) and changes the Opus Number presentation from the earlier `No. {workOpusNumber}` prefix style to a plain parenthetical.
- **Resolved:** `workOpusNumber` isn't restricted to a literal "Op. X" format — it holds whatever numbering convention applies to that composer/work (opus number, BWV, K., etc.), so `(BWV 606)` in the example is a `workOpusNumber` value, not an IMSLP number. `imslpNumber` (falling back to `publisherId` if blank) is a separate, later component in the citation, distinct from the opus-number slot — the two never compete for the same position, and the earlier example just happened not to have an IMSLP number to show, which read as more ambiguous than it actually was.
- **`sourcePageStart`/`sourcePageEnd` (§3) are deliberately not part of the v1 citation format** — not an oversight. They're retained specifically for when multiple citation style support (APA/MLA/Chicago-style, etc.) lands post-v1, see §13; some of those styles want a page range and some don't, so it makes more sense to wire it in once there's an actual second format to make that call for, rather than baking it into the one format v1 has now.
- `CITATION_FORMAT` env var supports plain token substitution (`{composer}`, `{title}`, etc.).
- **Scope change from an earlier pass:** the original format also inserted publisher/date before the year, *conditionally, only if the piece wasn't public domain*. Since the public-domain determination feature is deferred (§13), that conditional has nothing to check against for now — v1's default format simply omits that conditional entirely (publisher appears unconditionally per the format above, if present and non-blank). The conditional behavior returns alongside the public-domain feature.
- Fully configurable conditional logic (beyond plain token substitution) would need a small template engine — a plain env var isn't a great place for branching logic. Deferred, see §13.

## 7. Piece preview vs. the (deferred) Sheet Viewer

Your notes describe a "Piece Preview" panel as core to v1's Piece view — page images with cycle buttons — which is genuinely different from the full "Sheet Viewer" this doc has been deferring (practice mode, page-turner hardware support, annotations, contrast/filter controls). Worth being explicit about the distinction, since otherwise it reads like a contradiction with §13:

- **v1 (this section): a basic preview.** Static, per-page images so the user can see what a piece looks like and flip through it — closer to a document preview pane than a practice tool. No annotations, no page-turner-hardware key capture, no contrast controls.
- **§13 (deferred): the full Sheet Viewer.** Practice-mode features layered on top of viewing — everything the basic preview doesn't do.
- **Implementation reuses an existing dependency:** `poppler-utils` (already in the stack, §2, for wizard thumbnails) can render preview page images too — no need for a separate client-side PDF rendering library like pdf.js just for this.
- The stable route from the previous version of this section still stands and is what the preview (and eventually the full viewer) both point at: **`GET /api/pieces/:id/file`**.

## 8. No auth, single user, single session — deployment implication

No OIDC, no login, no per-user anything in v1, per your call. **Additionally scoped down further: v1 is designed and built for a single user, single session at a time** — multi-user support is a later-date addition, not just "no login screen." This simplifies real things:
- No concurrent-write conflict handling needed (two people importing simultaneously is out of scope for v1)
- No session/user-context threading through the API
- SQLite is a comfortable fit with no caveats — see §4.5

One thing worth being explicit about regardless: **this means the app has no access control of its own.** The realistic deployment is a private network / VPN / Tailscale, or an auth layer added *in front of* the app (e.g., a reverse proxy with Basic Auth, or Authelia) rather than exposing it directly to the open internet. Worth a line in the README so nobody self-hosts this expecting it to be safe on a public IP — and worth remembering when multi-user support does get added later, since that's the point real access control becomes necessary.

## 9. Docker & CI/CD

- **Single image**, multi-stage: build Vite frontend → embed via `//go:embed` → build Go binary → slim runtime (same pattern validated this session, minus the `go.rice`/relative-path fragility). The runtime stage needs `apt-get install -y poppler-utils` added, since PDF thumbnailing shells out to it rather than linking it as a Go library (see §2).
- **Multi-arch via native runners, not QEMU emulation:** GitHub now provides free, generally-available native ARM64 Linux hosted runners for public repos (`ubuntu-24.04-arm`). Build `linux/amd64` and `linux/arm64` as separate matrix jobs, each running natively on its own architecture's runner, then merge into a multi-arch manifest and push to GHCR on release/tag push — faster and less flaky than a single `docker buildx` command emulating arm64 under QEMU, for the same end result (both target architectures supported).
- Verify the arm64 build works *early* — don't leave it until the CI pipeline is the first place it's tested.
- **Build order, per your call:** get the Go+SQLite+React app fully working in plain local dev first. Containerize once the app itself is stable. Set up GitHub Actions only once `docker build` is reliably green locally — iterating on CI failures is much slower than iterating locally, which is exactly what this session's Docker debugging demonstrated repeatedly.
- **Health check endpoint** (`/healthz`): trivial to add, needed for a proper `docker-compose` healthcheck.
- **Startup config validation**: fail fast on boot if a required env var is missing or malformed (e.g. `BACKUP_RETENTION_DAYS` isn't a valid integer, or `BACKUP_CRON` isn't a parseable cron expression), rather than discovering it's invalid mid-request later.
- **Streaming uploads**: 100+MB book PDFs should stream to disk and hash incrementally as they're written, not get fully buffered in memory first. `crypto/sha256` supports incremental/streaming hashing natively via the standard `hash.Hash` interface, so this doesn't conflict with the hashing choice in §2.
- **Env var configuration method needs zero application code either way.** Docker Compose natively supports setting env vars directly in `docker-compose.yml`'s `environment:` block *or* via a sibling `.env` file — both are Compose features, not something the Go app needs to know or care about, since it just reads environment variables the same way (`os.Getenv` or equivalent) regardless of how Compose populated them. The project's own `docker-compose.yml` uses the `environment:` block directly (your preference); a `.env` file remains an option for anyone who prefers it, with no extra work on either side to support that.

## 10. UI design priority: clarity over formal accessibility compliance

Formal accessibility engineering (WCAG auditing, comprehensive ARIA coverage, screen-reader testing) is a **tertiary concern for v1** — not a target to hit. What *is* a first-order design driver, per your original spec and this conversation: a clean, non-distracting, intuitive interface, with the high-contrast palette (§2) serving both visual clarity during performance and general low-clutter design.

**Simple, but not necessarily minimal** — your own framing, worth stating explicitly: this isn't a mandate to strip features in pursuit of a bare-bones look. It's about avoiding clutter and unnecessary cognitive load, not about withholding useful functionality that a real feature (like the Piece view's advanced/Get-Info panel, §14) genuinely calls for.

In practice, this means: prefer the simpler/calmer option when a UI decision has one (fewer simultaneous choices in the wizard, a wizard step showing one thing at a time rather than a dense all-at-once form, restrained use of notifications/animation). Where an accessible pattern is *also* just better UX — the earlier example of an accessible combobox for tag entry over a bare `<input>` with a dropdown — keep making that call, since it's not extra work done for compliance's sake, it's the better component either way. What this deprioritizes is the *additional* work that's accessibility-only with no general-UX upside (full keyboard-nav auditing across every interaction, ARIA-role completeness as its own checklist item).

One near-zero-cost habit worth keeping regardless of priority level: don't rely on color alone to distinguish tags/keys (pair with text or shape) — costs nothing to decide now, mildly annoying to retrofit later.

## 11. Library Browse & Search

Not fully specified until now, despite being core to "useful library organizer." v1 needs:
- **Search-as-you-type** over the library, backed by the `pieces_fts` FTS5 virtual table (§3) — debounce the query (e.g. 200–300ms) and issue an `FTS5 MATCH` query server-side rather than shipping the whole library to the client to filter. Keeps this workable as the library grows without a full table scan, and without adopting a heavier separate search engine (§2).
- **Filter by tag** (Key, Instrument, SheetType, user tags) — combinable with the text search. This is the reason `Key`/`SheetType`/instrument/user tags are relational tables rather than flat strings (§3) — filtering like this is what that structure is for.
- **Filter by `favorite`/`practiceStatus`** (§3) — combinable with the above, same as any other filter dimension (e.g. "favorites currently Learning").
- **View mode toggle**: grid, list, or table view of the library, user-selectable.
- Content views should be built in a way that *could* later support both a paginated and an infinite-scroll mode, toggleable — not hard-coded to infinite-scroll-only. This is the cheap hook for future E-Ink Mode (§13), not a v1 feature itself.

## 12. Device-Aware UI Conventions

These apply now, not just to the deferred Sheet Viewer — low-spec and touch/stylus devices are a v1 concern for the whole app, per your direction:
- **Buttons over sliders**, or both where a slider genuinely fits — avoid slider-only controls for anything users need precise, reliable control over on an imprecise touchscreen.
- **Progress bars over spinners** wherever progress toward a known end is measurable (file uploads, the import wizard's confirm step) — spinners remain fine for genuinely indeterminate waits (e.g. an API call with no known duration).
- **No hover-dependent interactions.** Tooltips become tap/click-triggered info buttons (see the `workOpusNumber` field in §3), not hover-only affordances — a touch/stylus device has no hover state to trigger them.
- **E-Ink Mode** is a real end-goal, not a v1 feature — see §13. Noted here to reinforce why §11 avoids hard-coding infinite scroll as the only content-view mode.

## 13. Features to Add Later

This intentionally spans much more than a single "v1.1" at this point — grouped by theme below, not by target version, since it'll likely span several minor releases.

### Planned Features
#### Public domain badge
- A `publicDomain` checkbox on `Piece`, plus a `copyrightYear` (int) field specifically as the calculation input — distinct from the citation-facing `yearWritten` string, which stays in v1 (§3, §6).
- **Three named states**: "Public Domain" (checkbox set), "Likely Public Domain" (computed, per below), "In Copyright" (computed, the negative case) — not just a binary public-domain/not distinction.
- Field validation for `copyrightYear`: integer, sane range (e.g. 1400–current year+1), not required, disabled/ignored in the UI when `publicDomain` is checked.
- "Likely public domain" computed from `copyrightYear` + a per-region rule, region chosen via a `COPYRIGHT_REGION` env var.
- **Known limitation already identified, worth remembering when this is built:** most real copyright terms (life+70, life+50) are computed from the *composer's death year*, not the composition year — `copyrightYear` alone can't capture that. Either accept an approximation (composition year plus a conservative, clearly-labeled "likely" offset) or add an optional `composerDeathYear` field and use it when present.
- **No general-purpose live API for this exists** — already researched directly: country-specific calculators exist (mostly US-focused, not built for third-party integration) and the EU's Public Domain Calculator project uses per-jurisdiction flowcharts, many of which haven't been updated since 2011 — treating either as a live authoritative source would be worse than doing this locally. The better approach worked out previously: a small, versioned JSON/YAML table checked into the repo (`config/copyright-regions.json`), sourced from Wikipedia's "List of copyright duration by country" and reviewed periodically as a maintenance task, not a live external dependency — a third party's uptime or format changes shouldn't silently change a legally-adjacent badge. Illustrative shape already worked out:
```json
{
  "en-US": { "rule": "fixed-term-approx", "years": 95 },
  "eu-generic": { "rule": "life-plus-approx", "years": 70, "avgLifespanBuffer": 40 },
  "es-ES": { "rule": "life-plus-approx", "years": 80, "avgLifespanBuffer": 40, "note": "life+80 applies only to authors who died before 1987" }
}
```

- The citation feature's public-domain-conditional formatting (publisher/date inserted before the year *only if not public domain*) returns alongside this — §6 covers what v1 does instead in the meantime.
- Configurable conditional citation templates generally — a plain env var isn't a great place for branching logic; would need a small template engine regardless of the public-domain tie-in specifically.

#### Auth & multi-user
- OIDC + per-user settings (v1 is a single shared instance — see §8)
  - Multi-user support needs to be done before Sheet Viewer rollout, as the main draw for that will be the ability to add and save per-user markup/annotation
  - **UI shell:** a sidebar-based user menu, opened from a profile picture, collapsing to an unfold button on mobile. Worth deciding at build time whether the app shell has a persistent sidebar from v1 onward (inert until there's a profile to show) or whether the sidebar itself only gets added alongside auth — not decided here.

#### Setlists
Ordered collections of pieces, similar to a playlist — per-account owned (see the `userNotes`/`userTags` account-scoping note in `CLAUDE.md`, same consideration applies here).

**Stored fields:** `name`, `gigDate`, an ordered list of piece IDs (a join table with an explicit position column, e.g. `SetlistPiece(setlistId, pieceId, position)` — not just an unordered many-to-many).

**Displayed/computed values** (not stored, derived from the pieces in the setlist): **total duration** (sum of each piece's `duration`, §3) and **total pages** (sum of each piece's page count, itself computed from `sourcePageEnd − sourcePageStart + 1` for book-imported pieces — neither total is a stored field). The setlist view itself is a table-like listing, per piece, of approximate duration, key, and page count.

#### Cataloging & metadata
- IMSLP live autofill (the API/parsing integration researched earlier) — filename-based IMSLP-number detection stays in v1 since it's trivial; only the live lookup is deferred.
- Calibre-style custom field builder (user-defined fields in settings) — fixed fields only in v1.
- `SheetType.definition` field (help text per sheet type, shown in the piece edit menu).
- "Resume incomplete import" list UI — a `Book` can exist with zero linked `Piece`s if a wizard session was abandoned. The safety property that actually matters (no lost work on a refresh) is already met by §5's `localStorage` draft plus the book file being persisted immediately on upload; this item is just a friendlier way to surface already-safe abandoned imports, not required to achieve that safety.
- **Advanced / "Get Info" panel** on the Piece view (file hash, file size, full `createdAt`/`updatedAt` timestamps) — a nice-to-have per your own notes, not required for v1.
- **A "genre"/tag-style book-level field** — considered alongside book-level soft inheritance (§3) and explicitly not adopted for now, not yet sold on its usefulness to the target audience. Worth revisiting if it comes up again, rather than re-litigating from scratch.
- **Drag-and-drop upload anywhere in the app**, prompting "piece or book?" and routing to §5's single-piece upload or the book wizard accordingly. The underlying capability both routes need already exists in v1 (§5) — this is purely a friendlier frontend entry point on top of it, not new backend work, so it's reasonable to defer without blocking anything else.
- **Multiple citation styles** (APA/MLA/Chicago-style, etc.) beyond v1's single fixed format (§6). `sourcePageStart`/`sourcePageEnd` (§3) are already retained specifically in anticipation of this — some citation styles want a page range, some don't, so that decision is deferred to whenever a second style actually gets built rather than guessed at now.

#### Sheet Viewer & practice mode
**Depends on multi-user support landing first** (see Auth & multi-user above) — annotations need to be attributable to a user, which v1's no-user-model architecture (§8) can't support.
- The full Sheet Viewer (practice-mode PDF viewer): contrast/brightness/filter controls, page-turner support, annotations, PDF export with/without annotations. See §7 for the v1 hook (`GET /api/pieces/:id/file`) this depends on.
  - Annotations need a mode switcher between a mild transparency value (default) and solid
  - Annotations also have a small palette of colors, like 4-5 colors
  - Clearly marked annotation show/hide toggle
- **"E-Ink Mode":** a settings toggle swapping free scrolling for paginated content views, for very-low-refresh/limited-color-palette e-ink tablets. A real end goal, mainly relevant once the Sheet Viewer exists. §11 and §12 already avoid hard-coding infinite-scroll-only, specifically to keep this cheap to add later.
- “Reduce Animations” (also turned on with e-ink mode)

### Research problems (not planned)
- Automatic detection of chord symbols, instrumentation, or title. This is Optical Music Recognition territory: an open research problem, not an engineering task.

## 14. Piece View

The page a single piece opens to. Desktop/tablet-width layout: the piece preview (§7) dominates roughly half the view, with clickable buttons to cycle through pages — not swipe/drag-only, consistent with §12's device-aware conventions.

Elements:
- **Book Details section** — shown when the piece has a `sourceBookId`, blank/absent otherwise. A summary display of a few book-level values (`bookTitle`, `composer`, `yearWritten` — proposed default, easy to adjust), each resolved live via `sourceBookId → Book` (§3), not stored on `Piece` itself. Has its own edit affordance opening the Book Properties Edit Menu (§16), which shows and allows editing every editable `Book` field, not just the few summarized here. Editing writes to the single `Book` record only; every piece with that `sourceBookId` simply reads the current value live, rather than the app propagating a write to each piece — the whole point of resolving them via join rather than denormalizing.
- **Edit button** — opens the Piece Properties Edit Menu (§15).
- **Download button** — a split button: primary action downloads the original extracted PDF; a small arrow opens a menu with that same option plus "Download original + annotations" (greyed out/absent until the annotations feature, §13, exists).
- **Replace file** — uploads a new file (e.g. a better-quality scan) to replace the piece's current one on the same `Piece` record, not a new piece. Hard-replace, consistent with this project's existing no-soft-delete philosophy (`CLAUDE.md` → File handling): old file deleted, new one hashed (SHA-256) and stored, `filePath`/`fileHash` updated. Needs a confirmation step first, since it's destructive. `sourceBookId`/`sourcePageStart`/`sourcePageEnd` are **kept as historical provenance** even after a replace ("originated from this book import"), per your call — since these are purely cosmetic/citation-display fields anyway (§3), not tied to the actual file, there's nothing to reconcile with the new file; the user can simply edit the page numbers afterward if the replacement no longer corresponds to them. Logged at INFO level, same convention as piece/book deletions (`CLAUDE.md` → Logging).
- **Citation copy button** — click-to-copy, format per §6.
- **Public domain badge** — the three-state badge from §13 (Public Domain / Likely Public Domain / In Copyright). Deferred along with the feature itself; the UI slot for it can exist now, inert, if that's convenient.
- **Last Updated timestamp** — `Piece.updatedAt` (§3), already tracked, just needs a UI element.
- **Advanced / "Get Info" panel** — deferred, see §13.

## 15. Piece Properties Edit Menu

**Presentation:** a modal/popup with a blurred background on desktop; a slide-up popover on mobile.

**Tag inputs** (`key`, `instruments`, `sheetType`, `userTags`): typing prompts a filtered list of matching existing tags, plus a `New tag: "<input>"` option to create one on the fly — the accessible-combobox pattern referenced in §10. The input box expands vertically to fit all selected content rather than clipping/scrolling horizontally, unlike a standard line-text input.

**Book-level soft inheritance** (§3): for the nine book-inheritable fields (`composer`, `instruments`, `sheetType`, `publisher`, `publisherId`, `yearWritten`, `description`, `imslpNumber`, `workOpusNumber`), an empty piece-level value displays the book's value instead, labeled "Inherited from book," with an optional "copy from book" button next to the field — shown only while the piece's own value is empty, gone once it has one (typed or copied).

**Field layout notes:**
- `publisherId` is shorter than other line inputs and shares a row with `publisher`, right-aligned.
- `bpm`, `measureCount`, `beatsPerMeasure` sit behind an "advanced" disclosure — `duration` (§3) is the field that matters day-to-day; the inputs behind it are supporting detail, not primary.
- `sourcePageStart`, `sourcePageEnd` are editable here — purely cosmetic/citation-display fields (§3), seeded from the actual extraction range but commonly need correcting to match a scanned book's printed page numbers rather than raw PDF page indices. (The book title itself isn't a `Piece` field at all anymore — see §14's Book Details section and §16.)
- Only `title` and `composer` are required — and per the inheritance mechanism above, "required" for `composer` means the *effective* value, piece's own or inherited, not necessarily typed directly into this menu.

All other field-level detail (types, validation, 255-char limits) is in §5's Field validation table — not repeated here to avoid the two going out of sync.

## 16. Book Properties Edit Menu

Reached from the Piece View's Book Details section (§14). Same presentation pattern as §15 (modal/popup desktop, slide-up popover mobile) — this isn't a separate standalone page/view, just a `Book`-scoped counterpart to the piece edit menu.

Shows and allows editing every editable `Book` field (§3): `bookTitle`, `composer`, `yearWritten`, `workOpusNumber`, `instruments`, `sheetType`, `publisher`, `publisherId`, `imslpNumber`, `description`. No required fields at the `Book` level (unlike `Piece`, where `title`/`composer` are required) — a book can exist with only `bookTitle` set and nothing else, since none of its pieces strictly depend on any single book-level field being present.

**Saving here writes to exactly one record — the `Book` itself. Nothing about any `Piece` row changes.** What changes is what gets *read*: any piece with a matching `sourceBookId` and no override for that field resolves its effective value (§3) live against the current `Book` data, so the *displayed/validated/cited/searched* result naturally reflects the edit — without the app writing to a single `Piece` row anywhere. Worth being explicit in the UI that a book edit is visible from N pieces (e.g. "this affects N pieces"), so it doesn't read as a surprising side effect discovered later — but it's surprising only because the information is shared, not because the app propagated a write anywhere.

The one place this genuinely does require touching multiple rows is the **search index**: `pieces_fts` (§3's Search index subsection) denormalizes/flattens each piece's *effective* values into that piece's own FTS row, so saving a `Book` edit does need to trigger a resync of every affected piece's `pieces_fts` row — that's a property of how the search index works, not of the underlying data model.

## 17. Open items you may want to revisit
- Backup strategy covers the DB; full library (book/piece files) backup is left to the user's own volume/NAS backup, worth stating clearly in setup docs.
- See `CLAUDE.md` for all cross-cutting engineering conventions that apply across the whole app rather than one section of this doc — migrations, testing, the API response contract, logging, deletion semantics, config validation, the full frontend stack and device-aware UI conventions, and the Docker/CI approach.