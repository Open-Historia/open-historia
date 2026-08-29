# The SeventhDread beta desktop build

The `Seventh-Dread-Beta` branch ships its own desktop build so people can test it **without
giving up the official app**. Both are installed at once, both open the same saves, and a
tester can switch between them mid-campaign.

Nothing here changes the stable build. A checkout with no beta stamp packages exactly
what `main` packages.

## What a tester gets

| | Official app | The SeventhDread beta |
| --- | --- | --- |
| Installer | `Open-Historia-Setup.exe` | `Open-Historia-SeventhDread-Beta-Setup.exe` |
| Installs to | `…\Programs\Open Historia` | `…\Programs\Open Historia SeventhDread Beta` |
| Start Menu & uninstall entry | Open Historia | Open Historia (SeventhDread Beta) |
| Icon & in-app logo | the compass | the compass with a purple BETA banner |
| Window title | Open Historia | Open Historia (SeventhDread Beta) — beta build |
| In-game marker | none | a `SEVENTHDREAD BETA · unofficial beta build` pill |
| Released as | `desktop-stable`, marked Latest | `desktop-seventhdread-beta`, marked Pre-release |
| Saves, scenarios, settings, world map | **shared — one library, both apps** | |

Both releases live in the same repository; the **tag** is what keeps them apart.

Installing the beta does not touch the official install, and uninstalling either leaves
the other (and the saves) alone.

## Reporting a bug from the beta

**Settings → Diagnostics → 📋 Copy log** (or **💾 Save as file** for a long one) puts a
plain-text log in the report: which build and campaign, then the saves opened, orders
queued, turns taken and everything that went wrong, in order. It is the fastest thing a
tester can attach, and the only one that survives a crash — the log is written to
browser storage as it goes, so the entries from before a reload are still in it
afterwards, marked with where the reload happened.

Clearing it just before reproducing a bug gives a log containing only the steps that
caused it, which is worth more than a full one.

Two toggles sit in the same section, and both are remembered across save changes and
restarts:

- **Keep a diagnostics log** — on by default. Turning it off stops recording and deletes
  what is stored on the device.
- **Detailed logging** — off by default. Turn it on when a maintainer asks, or before
  reproducing a bug you want captured in full: it adds every AI task and its rejections
  (including retries that then worked), what each turn changed in the world, every server
  request and every save with its size, which panels you opened, and full error stacks.
  The section lists all of it. It fills the log faster, so the log holds less history —
  and it quotes more of your campaign.

The log has a size budget and drops its oldest entries once it is reached, so it never
grows without bound; the report says when that has happened rather than leaving an
unexplained gap.

API keys are never in it (they are redacted as each entry is recorded, both by matching
the keys this device has stored and by shape). Country names, queued orders and error
messages are, so it is worth a glance before posting it in public.

## The library both builds share

Everything the game writes lives in one folder, named after the stable app:

- Windows — `%APPDATA%\open-historia\server\data`
- macOS — `~/Library/Application Support/open-historia/server/data`
- Linux — `~/.config/open-historia/server/data`

`games/` (saves), `scenarios/`, `ui-settings.json` (including AI keys), the flag and
basemap libraries, and the ~200MB downloaded world map under `public/assets` — all of it
is read and written by both builds. The beta therefore needs no second map download and
no re-entering of API keys.

The beta keeps its **own** Chromium profile (`%APPDATA%\Open Historia (SeventhDread Beta)`):
caches, cookies and the per-app single-instance lock. That is what lets the two apps exist as
separate applications; none of it is game data.

### Where the BETA branding comes from

The client bundle is identical in both builds — it asks for `/logo.png`, `/icon-192.png`
and `/icon-512.png` either way. In a beta build the embedded server answers those three
URLs with the badged copies from `electron/beta-assets/` before the static mount sees
them, so the library header, the startup screen and the window's favicon all carry the
banner without a second set of source assets or a second client build.

### Do not run both at once

Two builds writing the same save files can lose a turn. Each build writes
`library-lock.json` into the shared folder while it runs, and the beta refuses to start —
with a dialog offering *Quit* or *Start anyway* — if the other one is already holding it.
A lock left behind by a crash is ignored (the process it names is gone).

### How compatible are the saves, really

Structurally: fully. Saves are plain JSON per game, there is no schema version gate on
them, and upstream's world-state normaliser passes unknown fields through untouched, so a
save the beta wrote opens in the official app and vice versa.

The honest caveat is **beta-only content**, not format. If a beta feature stores state the
official build has no concept of, playing that save in the official build can drop it —
the field survives a read, but not necessarily a full turn of rewrites. Anyone testing a
campaign they care about should copy `server/data/games/<id>` somewhere safe first.

## Publishing a beta

The `Desktop beta (SeventhDread)` workflow
(`.github/workflows/desktop-seventhdread-beta.yml`) builds Windows, macOS and Linux and
publishes them to the **`desktop-seventhdread-beta`** pre-release. From the repository's
Actions tab:

> **Actions** → **Desktop beta (SeventhDread)** → **Run workflow** →
> *Use workflow from:* `Seventh-Dread-Beta` → **Run workflow**

Picking the right branch matters. GitHub only lists a `workflow_dispatch` workflow if a copy
of the file exists on the **default** branch, so `main` carries one too — but the copy on the
branch you select is what actually runs. A guard step fails the run in seconds if it is
dispatched from anything but `Seventh-Dread-Beta`, so a misclick cannot package official code
as the beta. (`android-apk-beta.yml` is on `main` for the same reason.)

Each run stamps its run id into the build and into the release's `latest.json`; a running beta
compares the two and offers the newer build to testers. The tag must stay
`desktop-seventhdread-beta` for that to work — it is the URL baked into the app
(`BETA_UPDATE_MANIFEST` in `electron/main.cjs`). The workflow's `tag` input exists only for
one-off builds that deliberately go somewhere else; leave it alone for a normal release.

The release is created with `--prerelease` and `--target` the built commit, so it is labelled
Pre-release, never takes the `Latest` badge from `desktop-stable`, and its tag points at the
beta branch rather than at `main`.

Locally: `npm run dist:win:beta` (or `:mac:beta`, `:linux:beta`). Close any running copy
first — electron-builder writes into `release/` and will happily clobber a running app.

## How it works, in four files

- **`scripts/stamp-channel.mjs`** writes `electron/channel.json` (gitignored). Its presence
  is the only thing that makes a build "the beta". `stamp-channel.mjs stable` deletes it.
- **`electron/main.cjs`** reads that stamp and, for the beta: renames the app (its own
  Chromium profile), points the save library at the stable app's folder, claims the
  cross-build lock, sets the window title, and hands the beta's update + feedback URLs to
  the server.
- **`electron-builder.beta.yml`** is the installer identity: appId, product name, artifact
  names, and the installer icon. Passing it with `--config` replaces the `build` block in
  `package.json`, which is why it is a complete config rather than a patch.
- **`electron/beta-assets/`** holds the badged artwork — the app icon, the in-app logo and
  the 192px favicon, each the upstream asset with a purple BETA banner across its bottom
  fifth. `scripts/make-beta-icons.ps1` regenerates all three if upstream's artwork changes.
  The word is only legible from ~32px up; below that the banner's colour is what tells the
  two apps apart on a taskbar.
- **`.github/workflows/desktop-seventhdread-beta.yml`** builds and publishes. A copy also
  sits on `main` so the Actions tab lists it; that copy is inert — dispatch-only, and the
  guard step means it refuses to build anything but this branch.

`extraMetadata` would have been the obvious way to pass the channel through
electron-builder. It is avoided on purpose: it works by rewriting the project's own
`package.json` mid-build, and an interrupted build leaves that file stripped.

## Before merging this branch into `main`

This branch lives in the official repository, so the beta scaffolding is one merge away from
every official player. Four things are beta-only and must come out. They are marked in-place
with `FORK-ONLY — REMOVE BEFORE ANY UPSTREAM MERGE`:

1. `src/runtime/ForkBuildBadge.jsx` (delete)
2. its import + `<ForkBuildBadge />` in `src/App.jsx`
3. the `/api/fork-build` route in `server/server.js`
4. the beta-branding route in `server/server.js`, with `electron/beta-assets/`, its
   `OH_BETA_ASSETS_DIR` line in `electron/main.cjs`, and the `!electron/beta-assets`
   entry in `package.json`'s `build.files`

Also out: `electron-builder.beta.yml`, the `dist:*:beta` scripts, this document, and the
beta section of the README — unless the release is meant to continue after the merge, in
which case they stay and only the four items above come out.

Nothing on this list matters until that day. A stable build ships no `electron/channel.json`,
so `/api/fork-build` answers `{}`, the badge never mounts and the beta artwork never loads.

The rest is `main`-safe and arguably useful there as-is: the shared-library resolution is a
no-op for the stable build, `OH_DESKTOP_UPDATE_URL` only overrides a default when set, and the
lock protects any two builds that share a library.
