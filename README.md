# Sonneck

A self-hosted library organizer for sheet music: import, tag, browse, and download pieces. See `sonneck-design.md` for the full design and `CLAUDE.md` for cross-cutting engineering conventions.

**Status:** the backend (Go API + SQLite) is functionally complete for v1. The frontend is in progress (Phase 0 scaffolding complete). Not yet packaged as a Docker image — for now, run it directly with the Go toolchain as described below.

## Requirements

- Go 1.21+ (developed against 1.26)
- [`poppler-utils`](https://poppler.freedesktop.org/) (`pdfinfo`, `pdftocairo`, `pdftoppm`) on `PATH` — used for page counting, piece extraction, and thumbnail rendering. On macOS: `brew install poppler`. On Debian/Ubuntu: `apt-get install poppler-utils`.

No separate database server is needed — Sonneck uses an embedded, pure-Go SQLite (`modernc.org/sqlite`), with schema migrations applied automatically at startup.

## Running locally

```sh
go build -o sonneck ./cmd/sonneck
DATA_DIR=./data ./sonneck
```

This starts the API server (default port `8080`) and applies any pending database migrations. `DATA_DIR` is created if it doesn't exist; it ends up holding:

```
$DATA_DIR/
  db/sonneck.sqlite        # the database
  library/books/           # original uploaded book PDFs
  library/pieces/          # extracted per-piece PDFs
  backups/                 # daily DB snapshots
  cache/thumbnails/        # rendered page thumbnails (safe to delete anytime)
```

Health check: `GET /healthz`.

## Configuration

All configuration is via environment variables, validated at startup — the process exits immediately with a clear error if something's invalid (e.g. an unparseable cron expression), rather than failing later mid-request.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `DATA_DIR` | `/data` | Root of the database, library files, and backups |
| `BACKUP_DIR` | `$DATA_DIR/backups` | Where daily DB snapshots are written |
| `BACKUP_CRON` | `0 3 * * *` | Standard cron expression for the daily backup job |
| `BACKUP_RETENTION_DAYS` | `30` | Backups older than this are pruned after each run |
| `CITATION_FORMAT` | (built-in template) | Reserved for future configurable citation formatting; the fixed v1 citation format doesn't currently read this |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error` (case-insensitive). Turn this up to `debug` on a deployed instance if you need more detail while diagnosing an issue |

## Backup & restore

**Backup:** a scheduled job (per `BACKUP_CRON`) runs SQLite's `VACUUM INTO` to write a consistent snapshot to `$BACKUP_DIR/sonneck-YYYY-MM-DD.sqlite`, then deletes snapshots older than `BACKUP_RETENTION_DAYS`. `VACUUM INTO` is used specifically because it guarantees a consistent copy even while the server is live — a raw file copy could catch the database mid-write.

This backs up the **database only**. The `library/` folder (original book PDFs and extracted piece PDFs) is not included — back that up separately via your own volume/NAS snapshot mechanism.

**Restore:**
1. Stop the server.
2. Replace `$DATA_DIR/db/sonneck.sqlite` with the desired backup file (e.g. `cp $DATA_DIR/backups/sonneck-2026-08-01.sqlite $DATA_DIR/db/sonneck.sqlite`).
3. Start the server again.

## Maintenance: rebuilding the search index

The full-text search index (`pieces_fts`) is derived data — it can be safely dropped and rebuilt from the database's core tables at any time, e.g. if it's ever suspected to be out of sync:

```sh
DATA_DIR=./data ./sonneck rebuild-search-index
```

Safe to run against a live server (it relies on SQLite's WAL mode, already enabled). This is a CLI subcommand rather than an HTTP endpoint deliberately — see "No authentication" below.

## No authentication — deployment warning

Sonneck has **no login, no access control of its own**, by design for v1: it's built for a single user, single session at a time. Anyone who can reach the server over the network can use the full API — there's no separation between "trusted operator" and "anonymous visitor."

**Do not expose this directly to the open internet.** Deploy it behind a private network / VPN / Tailscale, or put an authenticating reverse proxy in front of it (e.g. Basic Auth, Authelia). Multi-user support with real access control is planned for a future release, not v1.

## Testing

```sh
go test ./...
```

Most packages have meaningful test coverage; two areas are treated as non-optional rather than best-effort, since failures there are silent and permanent: the import wizard's PDF page-range computation (`internal/wizard`) and the effective-value/search-index resolution that implements book-level field inheritance (`internal/repo`).

## About the name

Sonneck is named after **Oscar Sonneck** (1873–1928), an American musicologist and librarian. In 1902 he became the first chief of the new Music Division at the Library of Congress, a post he held until 1917; there he built the division's holdings into one of the world's great music collections and devised a classification scheme still in use today, with modifications. He's regarded as the founding figure of American musicology — his bibliographic work on early American music laid the groundwork for the field.

## Acknowledgements

The frontend typeface is [Baskervville](https://fonts.google.com/specimen/Baskervville) by Storm Type Foundry, [Google Fonts](https://fonts.google.com/), licensed under the [SIL Open Font License 1.1](https://fonts.google.com/specimen/Baskervville/license). Self-hosted rather than loaded from Google Fonts at runtime.
