# The fork's beta desktop build

This fork ships its own desktop build so people can test it **without giving up the
official app**. Both are installed at once, both open the same saves, and a tester can
switch between them mid-campaign.

Nothing here changes the stable build. A checkout with no beta stamp packages exactly
what upstream packages.

## What a tester gets

| | Official app | This fork's beta |
| --- | --- | --- |
| Installer | `Open-Historia-Setup.exe` | `Open-Historia-Beta-Setup.exe` |
| Installs to | `…\Programs\Open Historia` | `…\Programs\Open Historia Beta` |
| Start Menu | Open Historia | Open Historia Beta |
| Window title | Open Historia | Open Historia Beta — fork build |
| In-game marker | none | a `BETA · unofficial fork build` pill |
| Updates from | Open-Historia/open-historia | SeventhDread/open-historia |
| Saves, scenarios, settings, world map | **shared — one library, both apps** | |

Installing the beta does not touch the official install, and uninstalling either leaves
the other (and the saves) alone.

## The library both builds share

Everything the game writes lives in one folder, named after the stable app:

- Windows — `%APPDATA%\open-historia\server\data`
- macOS — `~/Library/Application Support/open-historia/server/data`
- Linux — `~/.config/open-historia/server/data`

`games/` (saves), `scenarios/`, `ui-settings.json` (including AI keys), the flag and
basemap libraries, and the ~200MB downloaded world map under `public/assets` — all of it
is read and written by both builds. The beta therefore needs no second map download and
no re-entering of API keys.

The beta keeps its **own** Chromium profile (`%APPDATA%\Open Historia Beta`): caches,
cookies and the per-app single-instance lock. That is what lets the two apps exist as
separate applications; none of it is game data.

### Do not run both at once

Two builds writing the same save files can lose a turn. Each build writes
`library-lock.json` into the shared folder while it runs, and the beta refuses to start —
with a dialog offering *Quit* or *Start anyway* — if the other one is already holding it.
A lock left behind by a crash is ignored (the process it names is gone).

### How compatible are the saves, really

Structurally: fully. Saves are plain JSON per game, there is no schema version gate on
them, and upstream's world-state normaliser passes unknown fields through untouched, so a
save the beta wrote opens in the official app and vice versa.

The honest caveat is **fork-only content**, not format. If a beta feature stores state the
official build has no concept of, playing that save in the official build can drop it —
the field survives a read, but not necessarily a full turn of rewrites. Anyone testing a
campaign they care about should copy `server/data/games/<id>` somewhere safe first.

## Publishing a beta

The `Desktop beta (fork)` workflow (`.github/workflows/desktop-beta.yml`) builds Windows,
macOS and Linux and publishes them to the **`desktop-beta`** pre-release:

```sh
gh workflow run "Desktop beta (fork)"          # publishes to the desktop-beta tag
gh workflow run "Desktop beta (fork)" -f tag=desktop-beta-2026-08   # or a tag of your own
```

Pushing a `desktop-beta-v*` tag does the same thing. Each run stamps its run id into the
build and into the release's `latest.json`; a running beta compares the two and offers the
newer build to testers. The tag must stay `desktop-beta` for that to work — it is the URL
baked into the app (`BETA_UPDATE_MANIFEST` in `electron/main.cjs`).

Locally: `npm run dist:win:beta` (or `:mac:beta`, `:linux:beta`). Close any running copy
first — electron-builder writes into `release/` and will happily clobber a running app.

## How it works, in four files

- **`scripts/stamp-channel.mjs`** writes `electron/channel.json` (gitignored). Its presence
  is the only thing that makes a build "the beta". `stamp-channel.mjs stable` deletes it.
- **`electron/main.cjs`** reads that stamp and, for the beta: renames the app (its own
  Chromium profile), points the save library at the stable app's folder, claims the
  cross-build lock, sets the window title, and hands the fork's update + feedback URLs to
  the server.
- **`electron-builder.beta.yml`** is the installer identity: appId, product name, artifact
  names. Passing it with `--config` replaces the `build` block in `package.json`, which is
  why it is a complete config rather than a patch.
- **`.github/workflows/desktop-beta.yml`** builds and publishes.

`extraMetadata` would have been the obvious way to pass the channel through
electron-builder. It is avoided on purpose: it works by rewriting the project's own
`package.json` mid-build, and an interrupted build leaves that file stripped.

## Before opening a PR upstream

Three things are fork-only and must come out. They are marked in-place with
`FORK-ONLY — REMOVE BEFORE ANY UPSTREAM MERGE`:

1. `src/runtime/ForkBuildBadge.jsx` (delete)
2. its import + `<ForkBuildBadge />` in `src/App.jsx`
3. the `/api/fork-build` route in `server/server.js`

The rest is upstream-safe and arguably useful to upstream as-is: the shared-library
resolution is a no-op for the stable build, `OH_DESKTOP_UPDATE_URL` only overrides a
default when set, and the lock protects any two builds that share a library.
