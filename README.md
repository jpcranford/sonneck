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

An intuitive sheet music organizer app: import, tag, browse, and download pieces and books. Made by a musician, for musicians.

## Features
Sonneck is a bookshelf for your sheet music, whether you have public domain classics or the newest pop hits. Organize your personal sheet music by category, composer, year, or practice status, and access your library from whatever device you have on hand.

Sonneck is currently built to live “in an office with a printer”, so to speak, but there are [plans](#planned-features) to add more practice-session features later to turn it into a more well-rounded app.

- **Organize your sheet music library.** Upload individual pieces or entire books — the built-in book splitter and metadata inheritance make quick work of prepping a whole book's worth of pieces to be found later.
- **Use it from any device.** Any device with a browser can use every feature of Sonneck, with everything you do saved to the library. Edit metadata on your phone, mark up your score on your tablet (feature [coming soon](#planned-features):tm:), or build a setlist on your computer.
- **Real cataloging, not a folder of PDFs.** Input key(s), instruments, sheet type, opus number, ISBN, and your own tags, plus a one-click citation generator that collects it all for you, ready to be pasted into a program template or group chat.
- **Composers and arrangers are real people, not text fields.** Each one gets their own page — portrait, bio, birth/death years, and every piece and book they're credited on — browsable from a dedicated People library. A piece or book can credit more than one composer or arranger, in the right order (think "Gilbert and Sullivan," or a hymn with a separate composer and arranger).
- **Metadata that works for you.** Give it an IMSLP catalog number and it'll auto-fill composer, opus number, year, and publisher for you. The citation line adapts to show only the fields you've actually filled in, and descriptions/performer notes support Markdown — including shortcode music symbols like `:mf:` for a mezzo-forte marking (see the [emoji doc](docs/music-emoji.md) for the full list).
- **Pieces inherit properties from their books.** Set a book's composer, publisher, and year once. Every piece inside it inherits the information automatically, you only ever need to override the pieces that are actually different.
- **Public domain badge.** A small badge shows whether a piece is Public Domain, Likely Public Domain, Copyleft, or In Copyright — computed automatically from the copyright year and composer death year(s) where possible, or set explicitly when you know better. See [Public domain badge](#public-domain-badge) below for how the calculation works and its limitations.
- **Search that keeps up with you.** Full-text fuzzy search across your whole library as you type. Grid views are optimized for number of items shown at once, while list views show you the most detail about each piece without having to open it up.
- **Track your wishlist.** Ever forget you were learning a piece only to rediscover it weeks later at the bottom of your bag? Or buy pieces to learn, only for them to get lost in the stacks? No more! Use the practice status and filter views to track what you want to play, what you have in progress, and even the stuff you never want to touch again! Take *that*, [Sorabji](https://www.youtube.com/watch?v=_OrAewTxBrc)!
- **A truly *responsive* workflow.** None of that "resize-and-rerender-everything" lag. Resize and it's good to go, instantly. Useful keyboard shortcuts throughout, plus right-click (desktop)/long-press (mobile) context menus for quick edits within library views.
- **It's completely yours.** Self-hosted, one SQLite file, daily automatic backups. No algorithm, no callbacks to some centralized analytics server. It’s a tool for you: use it, break it, repurpose it, join us (or don’t) in making it better. Or even leave– a full CSV export is available at any time. If it turns out Sonneck isn't the right place for your music, the information you enter (and the time you take doing so) is still yours.

## Installation

Two ways of installing Sonneck: there's the native Mac and Windows apps for an easier install or you can use Docker, which is recommended if you intend on using SSO or hosting over the web.

### Native apps (macOS/Windows)
Coming soon. When I roll this out, they'll be generated on release and put under the [releases](https://github.com/jpcranford/sonneck/releases) page.

### Docker Compose
There's a [`docker-compose.yml`](docker-compose.yml) file in this repo and linked to the releases, complete with helpful comments explaining some common options.

Download the file, tailor it how you want, then run:

```sh
cd ./wherever          # containing folder of docker-compose.yml
mkdir data             # create this yourself — see note below
docker compose up -d
```

The compose file takes care of the fiddly bits like remembering where you put your data folder and mounting it to the right place in the container.

**Create the `data` folder yourself before the first run.** If you don't, Docker will create it for you as root when the container starts, which may cause write issues. If you hit a permission error on startup, it's almost always this; fix it by running `sudo chown -R 1000:1000 ./data` on the host machine.

***But what about `docker run`?*** I'm sure there's some web tool out there that can helpfully convert the docker compose to a run command. Such a tool would be more accurate than I.

> [!WARNING]
> Sonneck on Docker first launches with no security enabled and open to the network (see [Security](#security) below). Until you enable a password or SSO support, anyone who can reach the server over the network can use the full API, with no separation between "trusted operator" and "anonymous visitor." It should go without saying but **do not expose it on the open internet like this.**

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
Nearly all configuration can be done via environment variables (validated at startup, and the process exits immediately with a clear error if something's invalid e.g. an unparseable cron expression). Several of these (`BACKUP_CRON`, `BACKUP_RETENTION_DAYS`, `LOG_LEVEL`, `COPYRIGHT_REGION`) can also be changed live from Admin Settings once you're signed in as an admin — no restart needed. An env var always wins if set (locking that field in Admin Settings); otherwise the value you set through Admin Settings is saved to `config.yml` at the root of your library folder and takes effect immediately.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP listen port. If you're using Docker, use port remapping instead. |
| `DATA_DIR` | `/data` | Root of the database, library files, backups, and logs |
| `BACKUP_DIR` | `$DATA_DIR/backups` | Where daily DB snapshots are written |
| `BACKUP_CRON` | `0 3 * * *` | Standard cron expression for the daily backup job |
| `BACKUP_RETENTION_DAYS` | `30` | Backups older than this are pruned after each run |
| `CITATION_FORMAT` | (built-in template) | Reserved for future configurable citation formatting; the fixed v1 citation format doesn't currently read this |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error` (case-insensitive). Turn this up to `debug` on a deployed instance if you need more detail while diagnosing an issue |
| `COPYRIGHT_REGION` | `en-US` | One of `en-US`, `eu-generic`, `en-GB`, `ca` — which region's rule the "Likely Public Domain" badge calculation uses. See [Public domain badge](#public-domain-badge) below |
| `AUTH_METHOD` | (unset) | One of `none`, `singlepass`, `oidc` — see [Security](#security) below |

### Security
Sonneck supports the following authentication methods, in order of least to greatest security (and from simplest to least complex):
1. **No password.** Anyone that can access Sonneck can do anything. One user, full admin. If you're just running this as an app on your computer and not gonna use another device, go ahead.
2. **Password** mode locks the app behind a single password. If you're on a shared computer or planning on using Sonneck on multiple devices, I recommend this option. I haven't enforced any rules for the password other than length, so make it as simple or complex as makes you feel safe. 
3. **Sign in with…** (OIDC/SSO) mode. The sign-in page kicks you over to your SSO provider for sign-in, and once you sign in the SSO provider gives Sonneck your name and profile pic. Sonneck Admins can manage user permissions in Admin Settings. IMO this will be overkill for all but the biggest libraries.

On first launch, a setup screen walks you through picking one of the above (OIDC/SSO is greyed out unless it's already configured — see [OIDC / SSO setup](docs/oidc-setup.md) for details). Setting `AUTH_METHOD` yourself locks that screen to your choice instead of leaving it pickable (a `singlepass` password is still entered there either way, since a password itself has no environment-variable equivalent).

### Public domain badge
A piece's badge is one of four states: **In Public Domain** or **Copyleft** (both set explicitly by you), or **Likely Public Domain** / **In Copyright** (computed automatically). The computed states use a small, checked-in region-rule table, reviewed against IMSLP's [Copyright Made Simple](https://imslp.org/wiki/IMSLP:Copyright_Made_Simple) and [Public domain](https://imslp.org/wiki/Public_domain) pages. `COPYRIGHT_REGION` (above) picks which region's rule applies to your whole library — the U.S. rule is based on the copyright year alone; the EU/UK/Canada rules are based on the composer's death year (falling back to an approximation from the copyright year if no death year is on record).

> [!IMPORTANT]
> **This is not legal advice.** The calculation is a labeled approximation meant to be a useful starting point, not a determination you should rely on without your own judgment. Especially in the US, there are some edge cases that can throw normal rules out the window; the [Hirtle chart](https://commons.wikimedia.org/wiki/Commons:Hirtle_chart#Works_except_sound_recordings_and_architecture) lays out more of those in detail. When in doubt, verify independently before treating a piece as public domain. To be absolutely sure, consult an appropriate lawyer.

### Backups & logs
**Backup:** a scheduled job, automatically done by the database using the above environment variables. Backups still retained can be found at `$BACKUP_DIR/sonneck-YYYY-MM-DD.sqlite`.

This backs up the **database only**. The `library/` folder (original book PDFs and extracted piece PDFs) is not included — that's on you to back up separately via your own volume/NAS snapshot/rclone-to-Dropbox/etc. mechanism.

**Restore:**
1. Stop the server.
2. Replace `$DATA_DIR/db/sonneck.sqlite` with the desired backup file (e.g. `cp $DATA_DIR/backups/sonneck-2026-08-01.sqlite $DATA_DIR/db/sonneck.sqlite`).
3. Start the server again.

**Logs:** Every log line (the same structured JSON that goes to stdout/`docker logs`) is also written to `$DATA_DIR/logs/sonneck-YYYY-MM-DD.log`, one file per day. Old log files are pruned on the same schedule and to the same `BACKUP_RETENTION_DAYS` window as backups — no separate log-retention setting.

### Admin CLI commands
Maintenance actions are exposed as subcommands on the same binary rather than HTTP endpoints, since they're more actions for server owners than mere admins. They're safe to run against a live server; they rely on SQLite's WAL mode (already enabled) and, where they touch on-disk files, write via a temp-file-then-atomic-rename so a concurrent request never sees a partial result.

If you're using Docker, do
```sh
docker exec -it <container-name> sonneck <command>
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
| `migrate-people` | Splits any piece/book still carrying only an old plain-text composer/arranger into real Person records. This already runs automatically on every server startup, so you're unlikely to need it — it's kept as a manual fallback. | To retry by hand after a failed automatic run, or against a different `DATA_DIR`, without restarting the server. |
| `reset-password` | Clears the stored password for **Password** mode's shared account, so a fresh one has to be set the next time it's configured. | If you've forgotten that password. |
| `link-oidc-account <user-id-or-name> <subject>` | Links an existing account to a specific identity-provider identity, without waiting for that person to sign in first. See [OIDC / SSO setup](docs/oidc-setup.md). | If `OIDC_ALLOW_REGISTRATION=false` and you need to pre-provision someone, or to fix an account that got linked to the wrong identity. |
| `export-csv` | Writes a full export of your library data to `$DATA_DIR/export/<timestamp>/` — one CSV file per database table (books, pieces, tags, keys, and so on). Read-only; doesn't touch the database or any existing files. | Any time you want your data out of Sonneck as plain CSV — a one-off backup in a format other tools can read, or just to take it with you. |

## Planned features
- **Dark mode.** Dear God, my eyes.
- **Setlists!** Plan out sets with the piece duration and tempo values.
- **Configurable citation format.** Just in case you don't like the defaults.
- **Sheet Viewer!** The practice view every app like this seems to have, with Bluetooth page turner support, server-saved annotations, and a built-in metronome, possibly with some simple gap support there. Maybe some music theory references too, why not; it's not like the circle of fifths has changed in the last 400 years.
- **Native desktop app builds.** For some reason, the venn diagram of "people who play from sheet music" and "people who know what Docker is" is shockingly small.
- Support for image files, and also support for a folder of image files to be uploaded/assembled into a piece
- Server-side printer support? Unsure about this one, but essentially the server would have a dedicated printer with the same settings saved, boiling a whole process down into a simple "Send to Printer" button. Dunno if this is achievable or just a fever dream.

## About the name
Sonneck is named after **Oscar Sonneck** (1873–1928), an American musicologist and librarian. In 1902 he became the first chief of the new Music Division at the Library of Congress, a post he held until 1917; there he built the division's holdings into one of the world's great music collections and devised a classification scheme still in use today, with modifications. After leaving that post, he joined the music publisher G. Schirmer, Inc. (still around today!) and become its vice president in 1921. He's regarded as the founding figure of American musicology — his bibliographic work on early American music laid the groundwork for the field. 

And most importantly, his last name sounded great for an app. :wink:

## AI disclaimer

<p align="left">
  <a href="https://aiclscale.org">
    <img alt="AICL-4 Expert vision, AI execution" src=".github/assets/aicl-4-badge.svg" width="300">
  </a>
</p>

This has been a series of learning exercises for me while I build a desperately-needed toolkit for my own use. While I had a quite a lot of ideas and built out a meticulously detailed framework, specifications, and guardrails, and contributed code and designed assets as I went, I did use AI, especially for much of the raw building-from-scratch gruntwork and bug-finding (hours of work became mere *seconds!*).

That being said, I still don’t trust it– I’ll gladly welcome the contributions of any human that wants to make this project more secure, reliable, robust, or just plain cleaner.

## Acknowledgements
- My beautiful girlfriend, for helping design the logo
- The frontend serif typeface is [Libre Baskerville](https://github.com/impallari/Libre-Baskerville) by Pablo Impallari, [Google Fonts](https://fonts.google.com/), licensed under the [SIL Open Font License 1.1](https://fonts.google.com/specimen/Libre+Baskerville/license). Self-hosted rather than loaded from Google Fonts at runtime.
- The frontend sans-serif typeface is [Cabin](https://github.com/impallari/Cabin) by Impallari Type and Rodrigo Fuenzalida, also for Google Fonts and licensed under the SIL Open Font License 1.1. Self-hosted rather than loaded from Google Fonts at runtime.
- The cursive S logo is taken from the [Gwendolyn](https://github.com/googlefonts/gwendolyn) font's capital S and the rest of the wordmark was built with [Mea Culpa](https://github.com/googlefonts/mea-culpa). Both fonts were designed by Robert Leuschke for Google Fonts and licensed under the SIL Open Font License 1.1. Logo and wordmark rendered as SVG and self-hosted.
- The music symbols supported in Markdown fields (`:forte:`, `:flat:`, `:segno:`, and the rest) render via [Bravura Text](https://github.com/steinbergmedia/bravura), the SMuFL music-notation font from Steinberg Media Technologies, licensed under the SIL Open Font License 1.1. Self-hosted as a tiny subset (a few KB, not the ~3MB full release) containing only the specific glyphs this app supports.
- My inspirations, for showing me what's possible with modern tech. [RomM](https://github.com/rommapp/romm), [Plex](https://www.plex.tv/your-media/), and [Calibre](https://calibre-ebook.com/) stand out.
- Despite some passing resemblance in name, we are in no way affiliated with a certain blue runs-fast creature. Whatever species it claims to be.
