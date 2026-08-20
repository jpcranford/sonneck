# Sonneck

A self-hosted library organizer for sheet music: import, tag, browse, and download pieces and books. Made by a musician, for musicians.

**Status:** the backend (Go API + SQLite) is functionally complete for v1. The frontend is in progress (Phase 0 scaffolding complete). Not yet packaged as a Docker image — for now, run it directly with the Go toolchain as described below.

## Features
((to be filled in))

## Installation
I hope it goes without saying that this runs **on your own hardware** at your own assumed risk. No code is infallible; in case of breakage, open an issue and I’ll take a look.

### Docker Compose (recommended)
There's a `docker-compose.yml` file in this repo for you to use, complete with helpful comments. Download the file, tailor it how you want, then run `docker compose up -d` in the directory containing it. The compose file takes care of the fiddly bits like persistent data folder.

**But what about `docker run`?** I'm sure there's some web tool out there that can helpfully convert the docker compose to a run command. Said tool would be more accurate than I.

### Running locally
Check the `CONTRIBUTING.md` file for full local run instructions. Here's the TL;DR for those that understand what it means.

Start the backend:
```sh
cd /sonneck                            # wherever the repo is
DATA_DIR=./data go run ./cmd/sonneck   # DATA_DIR *must* be passed somehow or it'll fail
```

And because that needs to keep running, in a separate terminal run:
```sh
cd /sonneck/frontend
npm run dev
```

## Advanced options
### Configuration

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

### Backup & restore

**Backup:** a scheduled job, automatically done by the database using the above environment variables. Backups still retained can be found at `$BACKUP_DIR/sonneck-YYYY-MM-DD.sqlite`.

This backs up the **database only**. The `library/` folder (original book PDFs and extracted piece PDFs) is not included — it's on you to back that up separately via your own volume/NAS snapshot mechanism.

**Restore:**
1. Stop the server.
2. Replace `$DATA_DIR/db/sonneck.sqlite` with the desired backup file (e.g. `cp $DATA_DIR/backups/sonneck-2026-08-01.sqlite $DATA_DIR/db/sonneck.sqlite`).
3. Start the server again.

## Admin CLI commands

Maintenance actions are exposed as subcommands on the same binary — `./sonneck <command>` — rather than HTTP endpoints, since there's no authentication to protect an endpoint with (see "No authentication" below). Each one is safe to run against a live server: they rely on SQLite's WAL mode (already enabled) and, where they touch on-disk files, write via a temp-file-then-atomic-rename so a concurrent request never sees a partial result.

```sh
DATA_DIR=./data ./sonneck <command>
```

| Command | What it does | When to run it |
|---|---|---|
| `rebuild-search-index` | Drops and repopulates the full-text search index (`pieces_fts`) from the database's core tables. | The index is derived data — safe to rebuild any time it's suspected out of sync. |
| `regenerate-thumbnails` | Clears `$DATA_DIR/cache/thumbnails` and re-renders every page of every piece from scratch, also sweeping up any orphaned entries left over from deleted pieces. | If a cached thumbnail is ever suspected corrupted or stale — no need to know which cache entries are actually bad. |

## No authentication — deployment warning

Sonneck has **no login, no access control of its own.** It's built for a single user, single session at a time. Anyone who can reach the server over the network can use the full API — there's no separation between "trusted operator" and "anonymous visitor."

**Do not expose this directly to the open internet.** Deploy it behind a private network / VPN / Tailscale, or put an authenticating reverse proxy in front of it (e.g. Basic Auth, Authelia). Multi-user support with real access control is planned for a future release, not v1.

## Planned features
- **Sheet Viewer!** The practice view every app like this seems to have, with page turner support, server-saved annotations, and a built-in metronome.
- **Setlists!** Plan out sets with the piece duration and tempo values
- **Auth support.** Lock your collection behind a simple password, or utilize a separate OIDC system for multi-user support. User notes, annotations, and tags stay saved per-user.
- **Public domain badge.** Set your country as an env var and the likely PD/copyright status will be calculated per-piece, with the ability to manually set it yourself. Scaffolding for this is already in place.
- **Dark mode.** Dear God, my eyes.
- Support for a folder of image files to be uploaded/assembled into pieces
- Offline mode? for remote gigs? Still thinking about how to accomplish this one, contributions would be welcome.
- Server-side printer support? Unsure of this one, but essentially the server would have a dedicated printer with the same settings saved, boiling a whole process down into a simple "Send to Printer" button.

## About the name

Sonneck is named after **Oscar Sonneck** (1873–1928), an American musicologist and librarian. In 1902 he became the first chief of the new Music Division at the Library of Congress, a post he held until 1917; there he built the division's holdings into one of the world's great music collections and devised a classification scheme still in use today, with modifications. A few years later in 1921, he was appointed vice president of the music publisher G. Schirmer, Inc.. He's regarded as the founding figure of American musicology — his bibliographic work on early American music laid the groundwork for the field. 

And most importantly, his last name sounded great for an app. :wink:

## AI disclaimer

This has been a series of learning exercises for me while I build a desperately-needed toolkit for my own use. While I had a quite a lot of ideas and built out a meticulously detailed framework, specifications, and guardrails — and contributed code and designed assets as I went — I did use AI, most notably for much of the raw building-from-scratch and bug-finding (hours of work became mere *seconds*!). 

All that being said, I still don’t trust it– I’ll gladly welcome the help of any human that wants to make this project more secure, reliable, robust, or just plain cleaner.

## Acknowledgements
- My beautiful girlfriend, for helping design the logo
- The frontend typeface is [Libre Baskerville](https://github.com/impallari/Libre-Baskerville) by Pablo Impallari, [Google Fonts](https://fonts.google.com/), licensed under the [SIL Open Font License 1.1](https://fonts.google.com/specimen/Libre+Baskerville/license). Self-hosted rather than loaded from Google Fonts at runtime.
- The cursive S logo is taken from the [Imperial Script](https://github.com/googlefonts/imperial-script) font's capital S (what luck, it looking like a treble clef!) and the rest of the wordmark was built with [Mea Culpa](https://github.com/googlefonts/mea-culpa). Both fonts were designed by Robert Leuschke for Google Fonts and licensed under the SIL Open Font License 1.1.
- Despite some passing resemblance in name, we are in no way affiliated with a certain blue runs-fast creature. Whatever species it claims to be.
