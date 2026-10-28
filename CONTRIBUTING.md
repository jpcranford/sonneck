# Contributing to Sonneck

Thanks for taking a look. Sonneck started as a personal tool — a self-hosted sheet music library for my own use — and quickly spiraled out of control. I'm more than happy to have other people poke at, use, and improve this thing. If that's you, this file is the map.

If anything here is wrong, confusing, or out of date, that's itself a welcome bug report — open an [issue](#reporting-bugs--suggesting-features), or just fix it with a PR.

> [!NOTE]
> I said it in the README and I'll say it again here: this has involved a *lot* of AI-assisted development (probably too much tbh), and I'll welcome the eyes and/or code of any human who wants to make it more secure, reliable, robust, or just plain cleaner.
> 
> If you have the experience to be able to confidently clean up or even just comment on the code, I'll happily accept *any* contributions you want to give.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Recognition](#recognition)
- [Reporting bugs & suggesting features](#reporting-bugs--suggesting-features)
- [Making a change](#making-a-change)
- [Conventions & house rules](#conventions--house-rules)
- [Architecture summary](#architecture-summary)
- [File structure](#file-structure)
- [Local development setup](#local-development-setup)
- [Docker](#docker)
- [Database migrations](#database-migrations)
- [Testing](#testing)
- [Music symbol shortcodes](#music-symbol-shortcodes)
- [Annotated PDF downloads](#annotated-pdf-downloads)
- [Setlist PDF fleuron](#setlist-pdf-fleuron)

## Code of conduct

No formal document yet — this is a small project at an early stage. The short version: be respectful, assume good faith, keep criticism aimed at the code and not the person who wrote it. If that ever stops being enough, a real one will get written.

## Recognition

Contributors get credited — see the README's [Acknowledgements](./README.md#acknowledgements) section for the existing pattern (design credits, font licenses, etc.). Meaningful code contributions will get the same treatment.

This project has involved a lot of AI-assisted development (see the note at the top of this file), but an AI coding tool isn't a contributor — it's a tool, same category as an editor or a compiler, not a person who gets listed alongside one. (I’m not branding my new porch deck with “Co-built by Black & Decker,” now am I?) No AI tool gets added to Contributors/Acknowledgements, and no commit or PR in this repo should carry a `Co-Authored-By: <AI>` trailer or a "Generated with ..." badge crediting one, no matter how much of the diff it helped produce. If you used one, that's fine — just own the result yourself, the same way you'd own code from any other tool.

## Reporting bugs & suggesting features

Open a GitHub issue. For bug reports, the most useful info I want to know is: what you expected, what actually happened, and how to reproduce it, and how you're running it (your OS, and native app or Docker). Screenshots help a *lot* for anything UI-related. For feature requests, take a quick look at the README's [Planned features](./README.md#planned-features) section first in case it's already on the list. Doesn't really matter either way, I'll still see and evaluate the feature but if I see you got a planned feature off the ground I'll go nuts.

## Making a change

1. Fork/branch, make your change.
2. Run the relevant tests and linters (see below). `.github/workflows/docker-publish.yml` validates that the Docker image still builds on every push to `main`, but it doesn't run `go test`/`npm test`/lint for you — a green local run of those before opening a PR is still the real safety net.
3. Open a pull request with a clear description of *why*, not just *what* — the diff already shows what changed; the description is where the reasoning goes; that's genuinely more useful to a future reader than a restatement of the diff.
4. If your change touches a documented convention or a deliberate deviation described in `CLAUDE.md`, update that file in the same PR rather than leaving it stale.

Commit messages: a clear, present-tense summary line is enough. No required format beyond that. One thing *not* to include: a `Co-Authored-By: <AI tool>` trailer or a "Generated with ..." badge, even if you used one to help write the change — see above for why.

## Conventions & house rules

`CLAUDE.md` is the canonical source for this project's conventions — originally written as house rules for AI-assisted sessions, but it doubles as the most complete, current description of how the codebase actually works, including every place real behavior deviates from the original design doc and why. Skim it before making a non-trivial change; it'll save you from re-deciding something that was already deliberated (trust me, I'm a fickle bastard who isn't satisfied until I've tried it at least 3 different ways and conceded to the least-bothersome one). A few of the most load-bearing rules, pulled up here so they're not easy to miss:

- **API responses** always go through the `{data}`/`{error}` envelope below — no per-handler improvisation.
- **Permission checks**: any handler that needs one calls `requirePermission(w, r, models.PermissionX)` as its first line — the one shared gate, not a blanket route-metadata middleware (requirements vary too much per-handler for that). See `CLAUDE.md` > Multi-user support for the current `read`/`download`/`practice`/`edit`/`upload`/`create`/`delete`/`admin` mapping if you're adding a new endpoint.
- **Logging** uses the standard library's `log/slog` with structured fields (`logger.Info("piece deleted", "pieceId", piece.ID)`), not string interpolation. Destructive-but-expected actions (deletions, file replacement) log at `INFO`, not `DEBUG`/`WARN`.
- **File hashing** is SHA-256, streamed incrementally — never buffer a full upload into memory before hashing.
- **Sheet Viewer pages** (`internal/handlers/pages.go`, `internal/pdf/page.go`) are cached by file hash under a render version: if you change how they render (resolution, renderer, encoding), bump `pageRenderVersion` so every page renders afresh at a new address. A poppler tool `internal/pdf` newly runs also has to be added to the macOS app's bundle list in `.github/workflows/native-build.yml`.
- **Frontend type-checking**: `frontend/tsconfig.json` is a solution-style config (`{ files: [], references: [...] }`). Running `tsc --noEmit -p .` against it is a silent no-op — it type-checks nothing and reports no errors either way. Always run `tsc --noEmit -p tsconfig.app.json` instead.
- **Frontend data fetching** goes through TanStack Query — not ad-hoc `useEffect`/`useState` per component. Every successful mutation marks all loaded data stale without fetching it (`main.tsx`), so off-screen lists refresh when next shown; a save must still invalidate the lists it changes *on screen* (filter counts included), and a mutation that only looks something up (no write) gets `meta: { readOnly: true }`.
- **An edit window starts from fresh data** (`hooks/useFreshOnOpen.ts`, fields locked until it lands), and a save that returns its record goes through `lib/refreshAfterSave.ts`. **A thumbnail or first-page cover URL takes a version** from `hooks/useThumbnailVersion.ts` (file hash + redraw stamp), so browsers can cache it for good and still see a replaced file at once.
- **Adding a font cut**: the self-hosted Cabin/Libre Baskerville/Atkinson Hyperlegible Next/Quintessential files come from Google Fonts' CSS2 API with **one weight per request** (a combined multi-weight request returns the same file for every weight) — add the latin and latin-ext woff2 pair plus matching `@font-face` rules in `frontend/src/index.css`, and check the new file's name table (fontTools) says the cut you meant.
- **Frontend forms** use `react-hook-form` with light client-side validation only (required fields, obviously-plausible ranges). The backend remains the sole authority for everything else — don't build a second, parallel validation schema that has to be kept in sync by hand.
- **A control the viewer's own permissions can't actually use** (checked via `hasPermission(me, perm)` from `lib/AuthContext.tsx`, never a bare `me.permissions.includes(...)` — `admin` counts as every permission, the same as the server) is left out entirely, never a normal clickable control that would just 403 — along with anything only it needed (a divider, a menu button with no items left), and its keyboard shortcut set to `enabled: false`. `CLAUDE.md` > Multi-user support lists where this applies. A control disabled for another reason (not yet built, nothing to act on) still fades.
- **This project's React Compiler setup is stricter than default React advice on two points**: it flags reading a ref's `.current` during render, not just writing one (a value that needs to persist across renders has to be real `useState`, updated from an event handler or effect — never a ref read inline in the render body), and it flags a bare `setState` call directly inside a plain `useEffect` body (prefer updating state from the specific event handler that causes the change).

## Architecture summary

Sonneck is a single Go binary that serves a React frontend and talks to a single SQLite file. There's no separate API server, no separate frontend host, and no external services beyond a couple of CLI tools shelled out to for PDF work.

| Layer | Choice | Why |
|---|---|---|
| Backend | Go | One static binary, easy to cross-compile, easy to deploy |
| Database | SQLite (`modernc.org/sqlite`, pure Go, no CGO) | File-based, trivial to back up, fits a single-instance deployment |
| Schema migrations | [`goose`](https://github.com/pressly/goose) | Every schema change is a checked-in migration file — see [Database migrations](#database-migrations) |
| Search | SQLite FTS5 | Built into SQLite itself — no separate search engine or index-file lifecycle to manage |
| PDF rendering | `poppler-utils` (`pdftoppm`/`pdftocairo`/`pdfimages`/`pdfseparate`/`pdfunite`, shelled out from Go) | Small, well-documented, ubiquitous CLI tools |
| Frontend language | TypeScript | Self-documents the API surface; types mirror the backend's response contract |
| Frontend framework | React + Vite | Modern build tooling |
| Frontend data fetching | TanStack Query | One consistent caching/loading/error pattern instead of ad-hoc `useEffect`/`useState` per component |
| Frontend styling | Tailwind CSS | Palette/type/spacing as theme tokens, not per-component judgment calls |
| Frontend routing | React Router | Wizard steps are real routes, so back/forward/refresh behave sanely |
| Deployment | Single Docker image | The Go binary embeds the built frontend via `//go:embed` — no CORS, no reverse proxy, frontend and backend can't drift apart |

**Request flow:** the frontend calls relative paths like `/api/pieces` (same-origin, no base URL config, no CORS — a direct consequence of the single-image setup). Every handler lives under `internal/handlers/`, reads/writes through `internal/repo/` (the only layer that touches SQL), and responds with one of exactly two JSON shapes:

```json
// success
{ "data": { ... } }

// error
{ "error": { "code": "VALIDATION_ERROR", "message": "human-readable description" } }
```

No handler improvises a third shape. See `internal/api/response.go` for the two helper functions (`WriteData`/`WriteError`) every handler goes through.

**Book-level inheritance:** a `Piece` can belong to a `Book`, and several fields (composer, publisher, year, etc.) fall back to the book's value when the piece doesn't override them. That resolution happens in exactly one place — `internal/repo/effective.go` — and every consumer (display, validation, citation generation, search indexing) calls through it rather than reading `Piece` columns directly. If you're touching any of those fields, start there.

For the full original design rationale (why SQLite over Postgres, why FTS5 over a dedicated search engine, the full data model, etc.), see [`sonneck-design.md`](./sonneck-design.md) — the project's original planning document. For the running list of conventions and deliberate deviations from that plan as the project actually evolved, see [`CLAUDE.md`](./CLAUDE.md) (more on both files below).

## File structure

```
sonneck/
├── cmd/sonneck/main.go        # Entry point — server bootstrap + CLI subcommands
├── internal/
│   ├── annotpdf/              # Download PDF + Annotations: Sheet Viewer marks written into a piece's PDF as real annotations (pdfcpu)
│   ├── api/                   # {data}/{error} response envelope, shared field validation
│   ├── auth/                   # Session tokens, password hashing (multi-user support)
│   ├── backup/                # Scheduled VACUUM INTO snapshot job
│   ├── config/                # Env var parsing — validated at startup, fails fast
│   ├── copyright/              # Public domain badge's region-rule term calculation (region table embedded from regions.json)
│   ├── db/
│   │   └── migrations/        # goose migration files, one per schema change
│   ├── export/                # CSV export (admin CLI command)
│   ├── fuzzy/                  # Typo-tolerant search — Damerau-Levenshtein distance as a registered SQLite scalar function
│   ├── githubrelease/           # GitHub releases/compare API client backing Admin Settings' version check
│   ├── handlers/               # HTTP handlers — one file per resource area
│   ├── imslp/                  # Live IMSLP lookup (composer/opus/year/publisher by IMSLP number) — see its own package doc comment
│   ├── libraryconfig/           # DATA_DIR/config.yml load/save for Admin Settings' Library Settings card
│   ├── models/                # Core domain structs (Piece, Book, Person, lookups)
│   ├── oidcauth/                # OIDC discovery/token exchange (multi-user support)
│   ├── pdf/                    # Page splitting, thumbnails and the Sheet Viewer's full-size pages via poppler-utils
│   ├── peoplemigrate/           # One-shot backfill splitting legacy composer/arranger strings into Person rows (admin CLI command, also runs automatically on startup)
│   ├── repo/                   # All SQL lives here — the only layer that touches the DB
│   ├── richtext/               # The Markdown + :shortcode: subset Sonneck's generated PDFs draw (shared by setlistpdf and annotpdf)
│   ├── storage/                # File storage on disk (originals, extracted pieces)
│   ├── testutil/               # Shared test fixtures (e.g. minimal valid PDFs)
│   ├── webui/                  # Embeds the built frontend (//go:embed) for the single-binary/Docker deployment — see the Docker section below
│   ├── wikipedia/               # Live Wikipedia search + Wikidata birth/death-year enrichment for Person autofill
│   ├── wizard/                 # Book-import wizard's page-range validation logic
│   └── yearparse/               # Leading-year extraction for sort=yearWritten/yearPublished, as a registered SQLite scalar function
├── frontend/
│   └── src/
│       ├── api/                # Typed fetch wrappers, one per backend resource
│       ├── assets/              # Self-hosted fonts, brand SVGs, diagrams
│       ├── components/         # Shared UI components
│       ├── hooks/               # Shared React hooks
│       ├── lib/                 # Pure helper logic (formatting, split-page math, etc.)
│       └── routes/              # One file per page (including /mockup/* design references), wired up in App.tsx
├── data/                       # Local dev library (DB, files, cache) — gitignored
├── design-review/              # Local screenshot/comparison scratch space — gitignored; the only one (never a frontend/design-review/)
├── .github/workflows/          # docker-publish.yml — see the Docker section below
├── Dockerfile                  # 3-stage: build frontend → embed it into the Go binary → slim runtime
├── docker-compose.yml          # What the README's Docker install path actually downloads and runs
├── sonneck-design.md           # Original design doc — the plan as first written
├── CLAUDE.md                   # Running conventions log — the plan as it actually evolved
├── README.md                   # User-facing docs (install, config, deployment)
└── CONTRIBUTING.md             # You are here
```

A few things worth knowing about that aren't obvious from the tree alone:

- **`frontend/src/routes/*Sample.tsx` and `*Mockup.tsx` files, reachable at `/mockup/*`.** These are permanent, hand-maintained design reference pages, not dead code or a design tool integration.
  - When a feature gets designed, build an interactive mockup with test data first, review, and *then* port to the real page. The mockup route stays afterward as a living reference for that page's intended look, deliberately unlinked from the main nav. If you're changing a page's visual design, it's worth checking whether a matching mockup exists and should be updated too. I've kept the mockup's test data deliberately full so that we can easily judge visual clutter.
  - The exception is `/mockup/style-sampler`, a reference of the current colors, type and controls that reads `index.css` and the app's own source live, so it never needs editing; the comment above each `--color-*` token in `index.css` is that color's description there, so keep one when you add or change a color.
  - Colors always come from the tokens in `index.css` (`bg-paper`, `text-ink`, `bg-accent-fill`…), never a hex value or a Tailwind palette color, because the dark theme is those same tokens redefined in the `:root[data-theme='dark']` block right below them: a new token needs a dark value there too, solid green and red fills use the `-fill` tokens, an overlay that must stay dark in both themes uses `bg-scrim`, and a hover or selected fill on a menu row, list row or small button uses `bg-paper-hover`, not `bg-paper-sunken` (on a green `accent-soft` surface, `bg-accent-soft-hover`). In the sidebar, hovers use `bg-sidebar-hover` (the dark rail) or `bg-sidebar-menu-hover` (its menus), never a `white/5`-style tint. A disabled solid-green button fades with `disabled:opacity-50`. Shadows are the plain `shadow-sm`…`shadow-2xl` utilities, which get their color per theme from the `--shadow-tint-*` variables in `index.css`; don't add a shadow color or an arbitrary shadow.
  - Checkboxes, radios, switches, sliders and dropdowns are `components/Checkbox.tsx`, `Radio.tsx`, `Toggle.tsx`, `Slider.tsx` and `SingleSelect.tsx`, never a bare input, a bare `<select>` or a hand-built switch. Dropdown and menu rows hover with `bg-paper-hover` and mark the chosen row with a green check.
  - Confirmations and error messages go through `confirmAction()`/`showAlert()` (`lib/dialogs.ts`), never `window.confirm()`/`alert()`, which the Mac desktop app can't show.
  - Any `<img>` that shows a sheet-music page gets the `score-page` class, which is what User Settings' Dark Mode Scores inverts; covers and portraits never do.
  - A new `/mockup/*` page also gets a row in `routes/MockupIndexPage.tsx`.
  - A floating panel that has to escape a window's clipping (a dropdown, picker or menu portaled to `<body>`) is placed with `useAnchoredPanel` (`hooks/useAnchorRect.ts`), never a hand-rolled `getBoundingClientRect` on scroll — it uses the browser's own anchor positioning where available, and pass the panel's width to keep it on screen.
  - Heights tied to the screen use `dvh`, never `vh` (on iPhones `vh` ignores the browser's toolbars).
  - A bar that should stay visible while the page scrolls sits outside the scroll container (the library toolbar portals into `AppShell`'s slot via `PageToolbarPortal`), never `sticky` inside it.
  - Disabled buttons get their not-allowed cursor and lose their hover style automatically (`index.css`), so don't add `disabled:cursor-*` or `disabled:pointer-events-none`; cut-off text gets a hover tooltip automatically too, as long as it's truncated with `truncate`/`line-clamp-*` rather than by slicing the string.
  - An empty message ("nothing here yet", "no matches") is `components/EmptyState.tsx`, a serif headline over an italic line, and a library search that finds nothing takes its wording from `lib/emptyMessages.ts`.
  - A page keyboard shortcut is registered with `useShortcuts` (`lib/shortcuts.ts`), never a hand-written keydown listener — that's what keeps every shortcut out of text fields and open windows, and lists it in the shortcut help; anything that opens over the page without being a `Modal` calls `useShortcutBlocker(open)`. Give the registration the page's name (`{ title }`) and, if it has an edit window, that window's keys as `reference` rows, so the hold-/ shortcut help lists them.
  - In the Sheet Viewer, every control is at least a 48×48 tap area (a smaller drawn button inside, no two overlapping), marked `data-hit` and checked with `frontend/scripts/check-hit-areas.mjs` (see CLAUDE.md for how to run it); its on/off rows use `Toggle`'s `row` style, and its clock uses the `font-clock` face with `tabular-nums`.
- **`sonneck-design.md` vs. `CLAUDE.md`.** The design doc is the original planning artifact — architecture, data model, the reasoning behind the initial stack choices. It's intentionally left as-written, not edited to match reality.
  - `CLAUDE.md` is the living document: cross-cutting conventions, and every deliberate deviation from the design doc as the project actually got built, with the reasoning for each. Think of it as a sort of a living intention-and-decision document whose primary goal is to prevent AI drift.
  - If the two disagree, `CLAUDE.md` wins — seriously, I'm debating removing the original doc once we get most features it outlines in place, as at this point only the major, foundational parts it outlines don't have exceptions to its rules.
- **`internal/repo/` is the only place SQL happens.** Handlers call into repo functions; they don't build queries themselves. If you're adding a new query, it belongs there.

## Local development setup

**Prerequisites:**
- Go 1.26+ (see `go.mod` for the exact floor)
- Node 20.19+ (or 22.12+) and npm
- `poppler-utils` installed and on your `PATH` (provides `pdfinfo`/`pdfimages`/`pdfseparate`/`pdfunite`/`pdftocairo`/`pdftoppm`) — `brew install poppler` on macOS, `apt-get install poppler-utils` on Debian/Ubuntu

**Backend** (from the repo root):
```sh
DATA_DIR=./data PORT=8080 go run ./cmd/sonneck
```
`DATA_DIR` is required — the process won't start without it. This creates `./data` on first run and applies all migrations automatically; you don't need to run `goose` by hand for local dev. The server listens on `:8080` by default (`PORT` manually specifies it, since it defaults to middle C on some systems). See the README's [Configuration](./README.md#configuration) table for every other env var.

**Frontend** (in a separate terminal, from `frontend/`):
```sh
npm install
npm run dev
```
Vite serves on `:5173` and proxies `/api/*` to the backend on `:8080` — you'll want both running at once for local dev. `npm run build` produces the static bundle the Go binary embeds for a real deployment.

## Docker

You don't need Docker for local development (see above), but if you're touching the `Dockerfile`, `docker-compose.yml`, or `internal/webui` (the package that embeds the frontend into the binary), build and run it directly:

```sh
docker build -t sonneck:local .
docker run --rm -p 8080:8080 -v sonneck-local-data:/data sonneck:local
```

This runs the full multi-stage build (frontend build → embed into the Go binary → slim runtime with `poppler-utils`) exactly as the release pipeline does — the frontend is built fresh inside the image every time, so there's no separate "remember to rebuild the frontend first" step to forget the way there might be if you were embedding a stale local `frontend/dist`. Confirm it's actually serving the real app, not just that it built: `curl localhost:8080/healthz`, then load `http://localhost:8080/` in a browser.

To test `docker-compose.yml` itself against a local build rather than the published image, temporarily point its `image:` at `sonneck:local` (don't commit that change though obvs).

**CI** (`.github/workflows/docker-publish.yml`): every push to `main` runs a validation build (build only, no push — this is what the README's Build-status badge reflects day to day). `:dev` rebuilds nightly from whichever commit on `main` most recently passed that validation build (not just whatever HEAD happens to be). Publishing a version-tagged image to GHCR otherwise only happens when a GitHub Release is published — a pre-release unconditionally moves `:beta`, and a real release moves both `:latest` and `:beta` together (so `:beta` always tracks the newer of the two) but only if that release is genuinely what GitHub currently considers the latest one (checked via the API, not just "most recently published") — see `CLAUDE.md` > Docker/build for the full mechanics if you're changing the workflow itself.

## Database migrations

Every schema change is a new [`goose`](https://github.com/pressly/goose) migration file under `internal/db/migrations/`, numbered sequentially — never a hand-edit of an existing migration, even one you just wrote and haven't shipped anywhere. Create one with:

```sh
go run github.com/pressly/goose/v3/cmd/goose@latest \
  -dir internal/db/migrations create your_migration_name sql
```

Write both the `-- +goose Up` and `-- +goose Down` sections. If a down migration is necessarily lossy (e.g. collapsing a many-to-many relationship back down), say so in a comment right there in the file — see `00008_piece_keys_many_to_many.sql` for a real example of this.

**If your migration rebuilds an existing table** (the `CREATE ..._new` / copy rows / `DROP TABLE <old>` / `RENAME` pattern — needed whenever SQLite can't `ALTER` a `UNIQUE` constraint or `DROP COLUMN` a column with its own `CHECK`), and anything else references that table via `ON DELETE CASCADE`, bracket the `DROP TABLE` in `PRAGMA foreign_keys = OFF;`/`PRAGMA foreign_keys = ON;` with a `-- +goose NO TRANSACTION` directive. This project's connections run with foreign keys enabled, which makes `DROP TABLE` perform an implicit `DELETE FROM` first — genuinely firing cascades into every referencing table, not just dropping schema. Migration `00025`'s own header comment has a real, fixed example to copy, and `internal/db/migration_safety_test.go` is a regression guard for exactly this class of bug (it seeds real rows in every FK-child table before migrating, and asserts they survive) — run it against any migration that rebuilds a table with real dependents.

Migrations run automatically against `$DATA_DIR` on every backend startup (including `go run`), so you don't need a separate step to apply one locally — just restart the backend.

## Testing

**Backend:**
```sh
go test ./...
```
Most of the codebase doesn't require exhaustive test coverage for this project's current stage, but two areas are treated as non-optional, because a failure in either is silent and permanent (nobody notices until they open the affected piece later):
- **PDF page-extraction logic** (`internal/wizard/split.go`, `internal/pdf/`) — a wrong page range is a data-correctness bug. Covers at minimum: single-page piece, multi-page piece, first/last piece boundaries, off-by-one boundaries between adjacent pieces.
- **The equivalent frontend split-page logic** (`frontend/src/lib/pieceSplitLogic.ts`) — the book-import wizard's own page-range math, mirrored on the client side for the split-marking UI.

If you're touching either of those two areas, add or update tests in the same PR.

**Frontend:**
```sh
cd frontend
npm test              # vitest
npm run lint           # eslint
npx tsc --noEmit -p tsconfig.app.json   # NOT `-p .` — see above
```

Beyond the split-logic requirement above, comprehensive frontend test coverage isn't currently expected — use judgment, but don't skip the split-logic tests if you're anywhere near that code.

## Music symbol shortcodes

Piece/book descriptions and a piece's own notes support a small set of `:shortcode:` music symbols (`:forte:`, `:flat:`, `:segno:`, …), documented for end users in [`docs/music-emoji.md`](docs/music-emoji.md). If you're changing that feature:

- The single source of truth for the shortcode → character mapping is `MUSIC_SHORTCODES` in `frontend/src/lib/musicEmoji.ts`. `docs/music-emoji.md`'s table is a hand-maintained mirror of it for humans — if the map changes, update that table to match; nothing regenerates the table text itself.
- The PDFs Sonneck draws (Setlist PDF, annotated downloads) carry a Go copy of the same map, `Shortcodes` in `internal/richtext/richtext.go`, kept in step by hand.
- The table's preview images (`docs/music-emoji-images/*.png`) *are* generated — regenerate them any time the shortcode list or the font subset changes, rather than hand-editing:
  ```sh
  cd frontend
  npm run generate:music-emoji-images
  ```
  This script reads `MUSIC_SHORTCODES` directly and renders each symbol from the actual shipped font subset (`frontend/src/assets/fonts/bravura-text-subset.woff2`) via Playwright, so the images can't quietly drift out of sync with what the app actually ships. Needs a Chromium binary the first time — `npx playwright install chromium` if you don't already have one.
- Both copies of the font subset — `frontend/src/assets/fonts/bravura-text-subset.woff2` (web) and `internal/setlistpdf/assets/fonts/BravuraText-subset.ttf` (the Setlist PDF, converted to TrueType since the PDF library can't read Bravura's CFF outlines) — are **padded** after subsetting.
  - Upstream Bravura is an engraving font with no side bearings, and its dynamics overhang to the left, so set inline with text an accidental crowds the letter before it ("E♭") and a dynamic nearly touches the previous word. `frontend/scripts/pad-bravura-subset.py` gives every glyph 0.08em of clear space on each side.
  - If you re-subset either file from the upstream release, run it on the new file (it refuses a font that's already padded, so it can't double the spacing), then regenerate the preview images above:
  ```sh
  python3 -m venv .venv && .venv/bin/pip install fonttools brotli
  .venv/bin/python frontend/scripts/pad-bravura-subset.py frontend/src/assets/fonts/bravura-text-subset.woff2 internal/setlistpdf/assets/fonts/BravuraText-subset.ttf
  ```
- A few symbols also have a second, non-inserted Unicode codepoint that the `Bravura Text` `@font-face` (`frontend/src/index.css`) is *also* the preferred font for, so pasting or typing the character directly (not via a shortcode) still renders correctly: `flat`/`natural`/`sharp` each additionally cover their SMuFL "alternate code" form (U+ED60–U+ED62), and `treble`/`alto`/`bass` each additionally cover the standard Unicode musical-symbol codepoint (U+1D11E, U+1D121, U+1D122). See that `@font-face`'s `unicode-range` for the exact list.

## Annotated PDF downloads

Download PDF + Annotations (`internal/annotpdf`) redraws each Sheet Viewer mark the way the viewer draws it, so a few things are copies that have to stay in step:

- **Stroke shapes**: `freehand.go` is a Go port of [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT), the library the viewer draws strokes with. `TestGetStrokeMatchesPerfectFreehand` checks it against outlines the JavaScript library produced. After updating perfect-freehand in `frontend/package.json`, regenerate them from the repo root and rerun the test:
  ```sh
  node internal/annotpdf/testdata/freehand-fixtures.mjs > internal/annotpdf/testdata/freehand.json
  go test ./internal/annotpdf
  ```
- **Stroke options and colors**: the options `strokePath` passes (`frontend/src/lib/sheetViewerMarks.ts`) and `LAYER_COLORS`' light values (`frontend/src/lib/sheetViewerTools.ts`) are repeated in `annotate.go`.
- **Text layout**: `text.go` follows `textBoxStyle` and the text marks' line height; `internal/annotpdf/assets/Quintessential-Regular.ttf` is Google Fonts' TTF of the web app's woff2 files.

## Setlist PDF fleuron

The ornament on generated setlist covers exists as two byte-identical copies of one SVG: `frontend/src/assets/ornaments/garamond-fleuron.svg` (the mockup, via `frontend/src/lib/garamondFleuron.ts`) and `internal/setlistpdf/assets/garamond-fleuron.svg` (the PDF, via `go:embed`). Neither build can reach the other's tree, hence the copy. If you change it:

- Edit the frontend copy, then copy it over the Go one. `TestFleuronMatchesFrontendCopy` fails if the two differ.
- Keep it one `<path>` with `fill-rule="evenodd"` and `fill="currentColor"`, using only absolute `M`, `C` and `Z` commands — `internal/setlistpdf/fleuron.go`'s parser rejects anything else rather than drawing it wrong.
- It's a standalone XML file, so a comment inside it can't contain `--`.
- Keep its credit in the README's Acknowledgements accurate.

Using it somewhere new:

- **Borders:** the flower repeats cleanly edge to edge. Place copies side by side at a pitch equal to their rendered width to rebuild the original border; a small negative gap tightens it the way the metal type set.
- **Accessibility:** it's decorative. Inlined, give it `aria-hidden="true"` and `focusable="false"`; as an `<img>`, `alt=""`.
- **Inline with text:** it looks best at about 1–1.2× the text's cap height, with `vertical-align: middle` or a slight negative offset.
