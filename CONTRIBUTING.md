# Contributing to Sonneck

Thanks for taking a look. Sonneck started as a personal tool — a self-hosted sheet music library for my own use — and quickly spiraled out of control. I'm more than happy to have other people poke at, use, and improve this thing. I said it in the README and I'll say it again here: this has involved a *lot* of AI-assisted development (probably too much tbh), and I'll welcome the eyes and/or code of any human who wants to make it more secure, reliable, robust, or just plain cleaner. If that's you, this file is the map.

If anything here is wrong, confusing, or out of date, that's itself a welcome bug report — open an issue, or just fix it with a PR.

## Table of contents

- [Architecture summary](#architecture-summary)
- [File structure](#file-structure)
- [Local development setup](#local-development-setup)
- [Docker](#docker)
- [Database migrations](#database-migrations)
- [Conventions & house rules](#conventions--house-rules)
- [Testing](#testing)
- [Making a change](#making-a-change)
- [Reporting bugs & suggesting features](#reporting-bugs--suggesting-features)
- [Code of conduct](#code-of-conduct)
- [Recognition](#recognition)
- [Questions](#questions)

## Architecture summary

Sonneck is a single Go binary that serves a React frontend and talks to a single SQLite file. There's no separate API server, no separate frontend host, and no external services beyond a couple of CLI tools shelled out to for PDF work.

| Layer | Choice | Why |
|---|---|---|
| Backend | Go | One static binary, easy to cross-compile, easy to deploy |
| Database | SQLite (`modernc.org/sqlite`, pure Go, no CGO) | File-based, trivial to back up, fits a single-instance deployment |
| Schema migrations | [`goose`](https://github.com/pressly/goose) | Every schema change is a checked-in migration file — see [Database migrations](#database-migrations) |
| Search | SQLite FTS5 | Built into SQLite itself — no separate search engine or index-file lifecycle to manage |
| PDF rendering | `poppler-utils` (`pdftoppm`/`pdftocairo`, shelled out from Go) | Small, well-documented, ubiquitous CLI tools |
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
│   ├── api/                   # {data}/{error} response envelope, shared field validation
│   ├── backup/                # Scheduled VACUUM INTO snapshot job
│   ├── config/                # Env var parsing — validated at startup, fails fast
│   ├── db/
│   │   └── migrations/        # goose migration files, one per schema change
│   ├── export/                # CSV export (admin CLI command)
│   ├── handlers/               # HTTP handlers — one file per resource area
│   ├── models/                # Core domain structs (Piece, Book, lookups)
│   ├── pdf/                    # Page splitting/thumbnail generation via poppler-utils
│   ├── repo/                   # All SQL lives here — the only layer that touches the DB
│   ├── storage/                # File storage on disk (originals, extracted pieces)
│   ├── testutil/               # Shared test fixtures (e.g. minimal valid PDFs)
│   ├── webui/                  # Embeds the built frontend (//go:embed) for the single-binary/Docker deployment — see the Docker section below
│   └── wizard/                 # Book-import wizard's page-range validation logic
├── frontend/
│   └── src/
│       ├── api/                # Typed fetch wrappers, one per backend resource
│       ├── components/         # Shared UI components
│       ├── hooks/               # Shared React hooks
│       ├── lib/                 # Pure helper logic (formatting, split-page math, etc.)
│       └── routes/              # One file per page, wired up in App.tsx
├── data/                       # Local dev library (DB, files, cache) — gitignored
├── design-review/              # Local screenshot/comparison scratch space — gitignored
├── .github/workflows/          # docker-publish.yml — see the Docker section below
├── Dockerfile                  # 3-stage: build frontend → embed it into the Go binary → slim runtime
├── docker-compose.yml          # What the README's Docker install path actually downloads and runs
├── sonneck-design.md           # Original design doc — the plan as first written
├── CLAUDE.md                   # Running conventions log — the plan as it actually evolved
├── README.md                   # User-facing docs (install, config, deployment)
└── CONTRIBUTING.md             # You are here
```

A few things worth knowing about that aren't obvious from the tree alone:

- **`frontend/src/routes/*Sample.tsx` and `*Mockup.tsx` files, reachable at `/mockup/*`.** These are permanent, hand-maintained design reference pages — not dead code, not a design tool integration. When a feature gets designed, it's built as an interactive mockup with fixture data first, reviewed, and *then* ported to the real page. The mockup route stays afterward as a living reference for that page's intended look, deliberately unlinked from the main nav. If you're changing a page's visual design, it's worth checking whether a matching mockup exists and should be updated too.
- **`sonneck-design.md` vs. `CLAUDE.md`.** The design doc is the original planning artifact — architecture, data model, the reasoning behind the initial stack choices. It's intentionally left as-written, not edited to match reality. `CLAUDE.md` is the living document: cross-cutting conventions, and every deliberate deviation from the design doc as the project actually got built, with the reasoning for each. If the two disagree, `CLAUDE.md` wins — check it before assuming the design doc is current.
- **`internal/repo/` is the only place SQL happens.** Handlers call into repo functions; they don't build queries themselves. If you're adding a new query, it belongs there.

## Local development setup

**Prerequisites:**
- Go 1.26+ (see `go.mod` for the exact floor)
- Node 20.19+ (or 22.12+) and npm
- `poppler-utils` installed and on your `PATH` (provides `pdftoppm`/`pdftocairo`) — `brew install poppler` on macOS, `apt-get install poppler-utils` on Debian/Ubuntu

**Backend** (from the repo root):
```sh
DATA_DIR=./data go run ./cmd/sonneck
```
`DATA_DIR` is required — the process won't start without it. This creates `./data` on first run and applies all migrations automatically; you don't need to run `goose` by hand for local dev. The server listens on `:8080` by default (`PORT` to change it). See the README's [Configuration](./README.md#configuration) table for every other env var.

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

**CI** (`.github/workflows/docker-publish.yml`): every push to `main` runs a validation build (build only, no push — this is what the README's Build-status badge reflects day to day). Publishing to GHCR only happens when a GitHub Release is published, and `:latest` only moves if that release is genuinely what GitHub currently considers the latest one (checked via the API, not just "most recently published") — see `CLAUDE.md` > Docker/build for the full mechanics if you're changing the workflow itself.

## Database migrations

Every schema change is a new [`goose`](https://github.com/pressly/goose) migration file under `internal/db/migrations/`, numbered sequentially — never a hand-edit of an existing migration, even one you just wrote and haven't shipped anywhere. Create one with:

```sh
go run github.com/pressly/goose/v3/cmd/goose@latest \
  -dir internal/db/migrations create your_migration_name sql
```

Write both the `-- +goose Up` and `-- +goose Down` sections. If a down migration is necessarily lossy (e.g. collapsing a many-to-many relationship back down), say so in a comment right there in the file — see `00008_piece_keys_many_to_many.sql` for a real example of this.

Migrations run automatically against `$DATA_DIR` on every backend startup (including `go run`), so you don't need a separate step to apply one locally — just restart the backend.

## Conventions & house rules

`CLAUDE.md` is the canonical source for this project's conventions — originally written as house rules for AI-assisted sessions, but it doubles as the most complete, current description of how the codebase actually works, including every place real behavior deviates from the original design doc and why. Skim it before making a non-trivial change; it'll save you from re-deciding something that was already deliberated. A few of the most load-bearing rules, pulled up here so they're not easy to miss:

- **API responses** always go through the `{data}`/`{error}` envelope above — no per-handler improvisation.
- **Logging** uses the standard library's `log/slog` with structured fields (`logger.Info("piece deleted", "pieceId", piece.ID)`), not string interpolation. Destructive-but-expected actions (deletions, file replacement) log at `INFO`, not `DEBUG`/`WARN`.
- **File hashing** is SHA-256, streamed incrementally — never buffer a full upload into memory before hashing.
- **Frontend type-checking**: `frontend/tsconfig.json` is a solution-style config (`{ files: [], references: [...] }`). Running `tsc --noEmit -p .` against it is a silent no-op — it type-checks nothing and reports no errors either way. Always run `tsc --noEmit -p tsconfig.app.json` instead.
- **Frontend data fetching** goes through TanStack Query — not ad-hoc `useEffect`/`useState` per component.
- **Frontend forms** use `react-hook-form` with light client-side validation only (required fields, obviously-plausible ranges). The backend remains the sole authority for everything else — don't build a second, parallel validation schema that has to be kept in sync by hand.

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

## Making a change

1. Fork/branch, make your change.
2. Run the relevant tests and linters above. `.github/workflows/docker-publish.yml` validates that the Docker image still builds on every push to `main`, but it doesn't run `go test`/`npm test`/lint for you — a green local run of those before opening a PR is still the real safety net.
3. Open a pull request with a clear description of *why*, not just *what* — the diff already shows what changed; the description is where the reasoning goes; that's genuinely more useful to a future reader than a restatement of the diff.
4. If your change touches a documented convention or a deliberate deviation described in `CLAUDE.md`, update that file in the same PR rather than leaving it stale.

Commit messages: a clear, present-tense summary line is enough. No required format beyond that.

## Reporting bugs & suggesting features

Open a GitHub issue. For bug reports, the most useful info I want to know is: what you expected, what actually happened, and how to reproduce it. Screenshots help a *lot* for anything UI-related. For feature requests, take a quick look at the README's [Planned features](./README.md#planned-features) section first in case it's already on the list. Doesn't really matter either way, I'll still see and evaluate the feature but if I see you got a planned feature off the ground I'll go nuts.

## Code of conduct

No formal document yet — this is a small project at an early stage. The short version: be respectful, assume good faith, keep criticism aimed at the code and not the person who wrote it. If that ever stops being enough, a real one will get written.

## Recognition

Contributors get credited — see the README's [Acknowledgements](./README.md#acknowledgements) section for the existing pattern (design credits, font licenses, etc.). Meaningful code contributions will get the same treatment.

## Questions

Open a GitHub issue, or start a discussion if the repo has Discussions enabled. There's no separate chat/forum for this project right now.
