<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/wordmark-light.svg">
    <img alt="Sonneck" src=".github/assets/wordmark-light.svg" width="360">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/jpcranford/sonneck/blob/main/go.mod"><img alt="Go version" src="https://img.shields.io/github/go-mod/go-version/jpcranford/sonneck"></a>
  <a href="https://github.com/jpcranford/sonneck/actions/workflows/docker-publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/jpcranford/sonneck/docker-publish.yml"></a>
  <a href="https://github.com/jpcranford/sonneck/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/jpcranford/sonneck"></a>
  <a href="https://github.com/jpcranford/sonneck/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/jpcranford/sonneck/total"></a>
</p>

A self-hosted library organizer for sheet music: import, tag, browse, and download pieces and books. Made by a musician, for musicians.

## Features
Sonneck is designed to live “in an office with a printer”, so to speak. There are [plans](#planned-features) to add more practice-session features later, but its core feature set is focused squarely on digital score library management first and foremost.

- **Organize your sheet music library.** Upload individual pieces or entire books — the built-in book splitter and metadata inheritance make quick work of prepping a whole book's worth of pieces to be found later.
- **Real cataloging, not a folder of PDFs.** Composer, arranger, key(s), instruments, sheet type, opus number, ISBN, and your own tags, plus a one-click citation generator that formats it all for you, ready to be copied into a program template or group chat.
- **Metadata that works for you.** Give it an IMSLP catalog number and it'll auto-fill composer, opus number, year, and publisher for you. The citation line adapts to show only the fields you've actually filled in, and descriptions/performer notes support Markdown — including shortcode music symbols like `:mf:` for a mezzo-forte marking (see the [doc](docs/music-emoji.md) for the full list).
- **Pieces inherit properties from their books.** Set a book's composer, publisher, and year once. Every piece inside it inherits the information automatically, you only ever need to override the pieces that are actually different.
- **Search that keeps up with you.** Full-text fuzzy search across your whole library as you type. Grid views are optimized for number of items shown at once, while list views show you the most detail about each piece without having to open it up.
- **Track your wishlist.** Ever forget you were learning a piece only to rediscover it weeks later at the bottom of your bag? Or buy pieces to learn, only for them to get lost in the stacks? No more! Use the practice status and filter views to track what you want to play, what you have in progress, and even the stuff you never want to touch again! Take *that*, [Sorabji](https://www.youtube.com/watch?v=_OrAewTxBrc)!
- **A truly *responsive* workflow.** None of that "resize-and-rerender-everything" lag. Resize and it's good to go, instantly. Useful keyboard shortcuts throughout, plus right-click (desktop)/long-press (mobile) context menus for quick edits within library views.
- **It's completely yours.** Self-hosted, one SQLite file, daily automatic backups. No algorithm, no callbacks to some centralized analytics server. It’s a tool for you: use it, break it, repurpose it, join us (or don’t) in making it better. Or even leave– a full CSV export is available at any time. If it turns out Sonneck isn't the right place for your music, the information you enter (and the time you take doing so) is still yours.

## Installation
### Docker Compose (recommended)
There's a [`docker-compose.yml`](docker-compose.yml) file in this repo and linked to the releases, complete with helpful comments explaining some common options.

Download the file, tailor it how you want, then run:

```sh
cd ./wherever          # containing folder of docker-compose.yml
mkdir data             # create this yourself — see note below
docker compose up -d
```

The compose file takes care of the fiddly bits like remembering where you put your data folder and mounting it to the right place in the container.

Create the `data` folder yourself before the first run. If you skip it, Docker will create it for you when the container starts — but as `root`, which the container (a fixed non-root user) then can't write to. If you hit a permission error on startup, it's almost always this; `sudo chown -R 1000:1000 ./data` fixes it.

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

> [!WARNING]
> Sonneck has **no login and no access control of its own.** It's currently built for a single user, single session at a time. Anyone who can reach the server over the network can use the full API — there's no separation between "trusted operator" and "anonymous visitor." **Do not expose this directly to the open internet.** Deploy it behind a private network / VPN / Tailscale, or put an authenticating reverse proxy in front of it (e.g. Basic Auth, Authelia). Seriously, if you open it to the internet and a bunch of ne'er-do-wells put sketchy stuff on your server don't come crying to me.

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
Maintenance actions are exposed as subcommands on the same binary rather than HTTP endpoints, since they're more actions for server owners than mere admins. They're safe to run against a live server; they rely on SQLite's WAL mode (already enabled) and, where they touch on-disk files, write via a temp-file-then-atomic-rename so a concurrent request never sees a partial result.

If you're using Docker, do
```sh
docker exec -it <container-name> ./sonneck <command>
```

Or if you're running locally from the repo:
```sh
DATA_DIR=./data go run ./cmd/sonneck <command>
```

| Command | What it does | When to run it |
|---|---|---|
| `rebuild-search-index` | Drops and repopulates the full-text search index (`pieces_fts`) from the database's core tables. | The index is derived data — safe to rebuild any time it's suspected out of sync. |
| `regenerate-thumbnails` | Clears `$DATA_DIR/cache/thumbnails` and re-renders every page of every piece from scratch, also sweeping up any orphaned entries left over from deleted pieces. | If a cached thumbnail is ever suspected corrupted or stale — no need to know which cache entries are actually bad. |
| `cleanup-thumbnails` | A lighter touch than `regenerate-thumbnails`: leaves everything that's already correct alone, and only removes cached page images nothing can read anymore (a deleted book/piece's leftovers, or a book's own pages once it's been fully imported into pieces) or re-renders ones that are actually corrupted. | Routine housekeeping — safe to run any time, and if you had a pre-v0.3 library it's worth running once after upgrading to reclaim space from book thumbnails your library accumulated before this existed. |
| `export-csv` | Writes a full export of your library data to `$DATA_DIR/export/<timestamp>/` — one CSV file per database table (books, pieces, tags, keys, and so on). Read-only; doesn't touch the database or any existing files. | Any time you want your data out of Sonneck as plain CSV — a one-off backup in a format other tools can read, or just to take it with you. |

## Planned features
- **Dark mode.** Dear God, my eyes.
- **Setlists!** Plan out sets with the piece duration and tempo values.
- **Public domain badge.** Set your country as an env var and the *likely* copyright status will be calculated per-piece, with the ability to manually override it. Scaffolding for this is already in place.
- **Auth support.** Lock your collection behind a simple password, or utilize a separate OIDC system for multi-user support. User notes, annotations, and tags stay saved per-user.
- **Configurable citation format.** Just in case you don't like the defaults.
- **Sheet Viewer!** The practice view every app like this seems to have, with Bluetooth page turner support, server-saved annotations, and a built-in metronome. Maybe some music theory references too, why not; it's not like the circle of fifths has changed in the last 400 years
- **Native desktop app builds.** For some reason, the venn diagram of "people who play from sheet music" and "people who know what Docker is" is shockingly small.
- Support for a folder of image files to be uploaded/assembled into pieces
- A way to rename user tags, sheet types, etc. from the interface — honestly, this one's probably waiting on the auth support, when I slice off a *bunch* of user settings into their own menu (dark/light mode preference, citation style choice, etc.)
- Offline mode? for remote gigs? Still thinking about how to accomplish this one. Contributions would be welcome.
- Server-side printer support? Unsure about this one, but essentially the server would have a dedicated printer with the same settings saved, boiling a whole process down into a simple "Send to Printer" button. Dunno if this is achievable or just a fever dream.

## About the name
Sonneck is named after **Oscar Sonneck** (1873–1928), an American musicologist and librarian. In 1902 he became the first chief of the new Music Division at the Library of Congress, a post he held until 1917; there he built the division's holdings into one of the world's great music collections and devised a classification scheme still in use today, with modifications. After leaving that post, he joined the music publisher G. Schirmer, Inc. (still around today!) and become its vice president in 1921. He's regarded as the founding figure of American musicology — his bibliographic work on early American music laid the groundwork for the field. 

And most importantly, his last name sounded great for an app. :wink:

## AI disclaimer
This has been a series of learning exercises for me while I build a desperately-needed toolkit for my own use. While I had a quite a lot of ideas and built out a meticulously detailed framework, specifications, and guardrails, and contributed code and designed assets as I went, I did use AI, especially for much of the raw building-from-scratch gruntwork and bug-finding (hours of work became mere *seconds!*).

That being said, I still don’t trust it– I’ll gladly welcome the contributions of any human that wants to make this project more secure, reliable, robust, or just plain cleaner.

## Acknowledgements
- My beautiful girlfriend, for helping design the logo
- The frontend serif typeface is [Libre Baskerville](https://github.com/impallari/Libre-Baskerville) by Pablo Impallari, [Google Fonts](https://fonts.google.com/), licensed under the [SIL Open Font License 1.1](https://fonts.google.com/specimen/Libre+Baskerville/license). Self-hosted rather than loaded from Google Fonts at runtime.
- The frontend sans-serif typeface is [Rethink Sans](https://github.com/hans-thiessen/Rethink-Sans) by Hans Thiessen, also for Google Fonts and licensed under the SIL Open Font License 1.1. Self-hosted rather than loaded from Google Fonts at runtime.
- The cursive S logo is taken from the [Gwendolyn](https://github.com/googlefonts/gwendolyn) font's capital S (what luck, it looking like a treble clef!) and the rest of the wordmark was built with [Mea Culpa](https://github.com/googlefonts/mea-culpa). Both fonts were designed by Robert Leuschke for Google Fonts and licensed under the SIL Open Font License 1.1. Logo and wordmark rendered as SVG and self-hosted.
- The music symbols supported in Markdown fields (`:forte:`, `:flat:`, `:segno:`, and the rest) render via [Bravura Text](https://github.com/steinbergmedia/bravura), the SMuFL music-notation font from Steinberg Media Technologies, licensed under the SIL Open Font License 1.1. Self-hosted as a tiny subset (a few KB, not the ~3MB full release) containing only the specific glyphs this app supports.
- My inspirations, for showing me what's possible with modern tech. [RomM](https://github.com/rommapp/romm) and [Calibre](https://calibre-ebook.com/) stand out.
- Despite some passing resemblance in name, we are in no way affiliated with a certain blue runs-fast creature. Whatever species it claims to be.
