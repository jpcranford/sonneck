<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/wordmark-light.svg">
    <img alt="Sonneck" src=".github/assets/wordmark-light.svg" width="360">
  </picture>
</p>

<!--
  Badge row (2026-08-22, direct instruction). ALL FIVE currently render as
  broken/"invalid" shields, for two independent reasons — worth
  distinguishing so this comment doesn't read as stale once the first
  reason goes away:
    1. The repo is private (confirmed directly, 2026-08-22). shields.io's
       badge requests are unauthenticated — they can't read ANYTHING off a
       private GitHub repo, so even License and Go version (which need
       nothing but LICENSE / go.mod to exist, both already true) won't
       resolve until this repo goes public. This affects all five badges
       equally.
    2. Independent of (1), the last three are also forward-looking
       placeholders for the eventual Docker/CI setup described in
       CLAUDE.md (single multi-arch image, built via GitHub Actions) — they
       won't resolve even after this repo is public, until that
       infrastructure exists too:
         - Build status needs a workflow at
           .github/workflows/docker-publish.yml (rename this badge's URL to
           match if the real workflow ends up named differently).
         - Latest release needs at least one GitHub Release/tag to exist.
         - Downloads needs a Release with a real file attached — GHCR
           doesn't expose pull counts via any public API, so this is the
           closest thing to a live counter GHCR-based distribution can
           offer. The natural fit: publish docker-compose.yml (which the
           Installation section below already tells people to download) as
           a Release asset instead of linking the raw main-branch file,
           giving it a stable versioned URL *and* making this badge real at
           the same time.
  Don't build the Dockerfile/workflow/release just to make these resolve —
  that's real Docker/CI work, gated separately (see project memory: hold
  off until v1 is prod-ready and human-reviewed). Making the repo public is
  an even bigger, separate call — not something to do as a side effect of
  wanting a badge to light up.
-->
<p align="center">
  <a href="https://github.com/jpcranford/sonneck/blob/main/go.mod"><img alt="Go version" src="https://img.shields.io/github/go-mod/go-version/jpcranford/sonneck"></a>
  <a href="https://github.com/jpcranford/sonneck/actions/workflows/docker-publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/jpcranford/sonneck/docker-publish.yml"></a>
  <a href="https://github.com/jpcranford/sonneck/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/jpcranford/sonneck"></a>
  <a href="https://github.com/jpcranford/sonneck/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/jpcranford/sonneck/total"></a>
</p>

A self-hosted library organizer for sheet music: import, tag, browse, and download pieces and books. Made by a musician, for musicians.

## Features
- **Upload your music.** Individual pieces or entire books — the built-in book splitter and metadata inheritance make quick work of prepping a whole book's worth of pieces to be found later.
- **Real cataloging, not a folder of PDFs.** Composer, arranger, key(s), instruments, sheet type, opus number, ISBN, and your own tags, plus a one-click citation generator that formats it all for you, ready to be copied into a program template or group chat.
- **Books stay organized as books.** Set a book's composer, publisher, and year once. Every piece inside it inherits the information automatically, you only ever need to override the pieces that are actually different.
- **Search that keeps up with you.** Full-text search across your whole library as you type.
- **Track your practice bag.** Ever forget you were learning a piece only to rediscover it weeks later at the bottom of your bag? Or have you ever lost the whole backpack and can't remember what you had in it? No more! Use the practice status and filter views to track what you want to play, what you have in progress, and even the stuff you never want to touch again! Take *that*, [Sorabji](https://www.youtube.com/watch?v=_OrAewTxBrc)!
- **It's actually yours.** Self-hosted, one SQLite file, daily automatic backups. And full CSV export any time — even if it turns out Sonneck isn't the right place for your music, the information you enter (and the time you take doing so) is still yours.

## Installation
### Docker Compose (recommended)
There's a [`docker-compose.yml`](docker-compose.yml) file in this repo, complete with helpful comments explaining things.

Download the file, tailor it how you want, then run:

```sh
cd ./wherever # containing folder of docker-compose.yml
docker compose up -d
```

The compose file takes care of the fiddly bits like remembering where you put your data folder and mounting it to the right place in the container.

To quit the program, just use `docker compose down`. Easy peasy.

***But what about `docker run`?*** I'm sure there's some web tool out there that can helpfully convert the docker compose to a run command. Said tool would be more accurate than I.

### Running locally
Check the `CONTRIBUTING.md` file for full local run instructions. Here's the TL;DR for those that understand what it means.

Start the backend:
```sh
cd ./sonneck                           # wherever the repo is
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
| `PORT` | `8080` | HTTP listen port. If you're using Docker, use port remapping instead. |
| `DATA_DIR` | `/data` | Root of the database, library files, and backups |
| `BACKUP_DIR` | `$DATA_DIR/backups` | Where daily DB snapshots are written |
| `BACKUP_CRON` | `0 3 * * *` | Standard cron expression for the daily backup job |
| `BACKUP_RETENTION_DAYS` | `30` | Backups older than this are pruned after each run |
| `CITATION_FORMAT` | (built-in template) | Reserved for future configurable citation formatting; the fixed v1 citation format doesn't currently read this |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error` (case-insensitive). Turn this up to `debug` on a deployed instance if you need more detail while diagnosing an issue |

### Backup & restore
**Backup:** a scheduled job, automatically done by the database using the above environment variables. Backups still retained can be found at `$BACKUP_DIR/sonneck-YYYY-MM-DD.sqlite`.

This backs up the **database only**. The `library/` folder (original book PDFs and extracted piece PDFs) is not included — that's on you to back up separately via your own volume/NAS snapshot/rclone-to-Dropbox mechanism.

**Restore:**
1. Stop the server.
2. Replace `$DATA_DIR/db/sonneck.sqlite` with the desired backup file (e.g. `cp $DATA_DIR/backups/sonneck-2026-08-01.sqlite $DATA_DIR/db/sonneck.sqlite`).
3. Start the server again.

## Admin CLI commands
Maintenance actions are exposed as subcommands on the same binary — `./sonneck <command>` — rather than HTTP endpoints, since there's no authentication to protect an endpoint with (see "No authentication" below). They're safe to run against a live server; they rely on SQLite's WAL mode (already enabled) and, where they touch on-disk files, write via a temp-file-then-atomic-rename so a concurrent request never sees a partial result.

If you're using Docker, do
```sh
docker exec -it <container-name> ./sonneck <command>
```

Or if you're running locally:
```sh
DATA_DIR=./data ./sonneck <command>
```

| Command | What it does | When to run it |
|---|---|---|
| `rebuild-search-index` | Drops and repopulates the full-text search index (`pieces_fts`) from the database's core tables. | The index is derived data — safe to rebuild any time it's suspected out of sync. |
| `regenerate-thumbnails` | Clears `$DATA_DIR/cache/thumbnails` and re-renders every page of every piece from scratch, also sweeping up any orphaned entries left over from deleted pieces. | If a cached thumbnail is ever suspected corrupted or stale — no need to know which cache entries are actually bad. |
| `export-csv` | Writes a full export of your library data to `$DATA_DIR/export/<timestamp>/` — one CSV file per database table (books, pieces, tags, keys, and so on). Read-only; doesn't touch the database or any existing files. | Any time you want your data out of Sonneck as plain CSV — a one-off backup in a format other tools can read, or just to take it with you. |

## No authentication — deployment warning
Sonneck has **no login, no access control of its own.** It's currently built for a single user, single session at a time. Anyone who can reach the server over the network can use the full API — there's no separation between "trusted operator" and "anonymous visitor."

**Do not expose this directly to the open internet.** Deploy it behind a private network / VPN / Tailscale, or put an authenticating reverse proxy in front of it (e.g. Basic Auth, Authelia). Multi-user support with real access control is planned for a future release.

## Planned features
- **Sheet Viewer!** The practice view every app like this seems to have, with page turner support, server-saved annotations, and a built-in metronome.
- **Setlists!** Plan out sets with the piece duration and tempo values.
- **Auth support.** Lock your collection behind a simple password, or utilize a separate OIDC system for multi-user support. User notes, annotations, and tags stay saved per-user.
- **Public domain badge.** Set your country as an env var and the likely PD/copyright status will be calculated per-piece, with the ability to manually set it yourself. Scaffolding for this is already in place.
- **Dark mode.** Dear God, my eyes.
- **IMSLP metadata import.** Why spend the effort to manually input the info when you can just autofill from the website?
- **Configurable citation format.** Just in case you don't like the defaults.
- Support for a folder of image files to be uploaded/assembled into pieces
- Offline mode? for remote gigs? Still thinking about how to accomplish this one, contributions would be welcome.
- Server-side printer support? Unsure of this one, but essentially the server would have a dedicated printer with the same settings saved, boiling a whole process down into a simple "Send to Printer" button.

## About the name
Sonneck is named after **Oscar Sonneck** (1873–1928), an American musicologist and librarian. In 1902 he became the first chief of the new Music Division at the Library of Congress, a post he held until 1917; there he built the division's holdings into one of the world's great music collections and devised a classification scheme still in use today, with modifications. After leaving that post, he joined the music publisher G. Schirmer, Inc. (still around today!) and become its vice president in 1921. He's regarded as the founding figure of American musicology — his bibliographic work on early American music laid the groundwork for the field. 

And most importantly, his last name sounded great for an app. :wink:

## AI disclaimer
This has been a series of learning exercises for me while I build a desperately-needed toolkit for my own use. While I had a quite a lot of ideas and built out a meticulously detailed framework, specifications, and guardrails, and contributed code and designed assets as I went, I did use AI, most notably for much of the raw building-from-scratch gruntwork and bug-finding (hours of work became mere *seconds!*). 

I still don’t trust it– I’ll gladly welcome the contributions of any human that wants to make this project more secure, reliable, robust, or just plain cleaner.

## Acknowledgements
- My beautiful girlfriend, for helping design the logo
- The frontend serif typeface is [Libre Baskerville](https://github.com/impallari/Libre-Baskerville) by Pablo Impallari, [Google Fonts](https://fonts.google.com/), licensed under the [SIL Open Font License 1.1](https://fonts.google.com/specimen/Libre+Baskerville/license). Self-hosted rather than loaded from Google Fonts at runtime.
- The cursive S logo is taken from the [Gwendolyn](https://github.com/googlefonts/gwendolyn) font's capital S (what luck, it looking like a treble clef!) and the rest of the wordmark was built with [Mea Culpa](https://github.com/googlefonts/mea-culpa). Both fonts were designed by Robert Leuschke for Google Fonts and licensed under the SIL Open Font License 1.1. Logo and wordmark rendered as SVG and self-hosted.
- Despite some passing resemblance in name, we are in no way affiliated with a certain blue runs-fast creature. Whatever species it claims to be.
