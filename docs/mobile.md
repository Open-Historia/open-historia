# Android App (Embedded Server)

The Android app is a [Capacitor](https://capacitorjs.com/) WebView that **runs the real Open Historia Node server in-process on the phone** via [`nodejs-mobile-cordova`](https://github.com/nodejs-mobile/nodejs-mobile-cordova) — no Termux, no separate machine, nothing to configure. A tiny boot shell (`mobile/www/index.html`) starts the embedded Node process, waits for it to answer on `127.0.0.1:3000`, then navigates the WebView into it same-origin so the game runs exactly as it does on desktop. First launch downloads ~200 MB of map binaries from a GitHub Release; the app also self-updates by comparing its stamped build number against the rolling release notes.

It can still be pointed at a remote/LAN/Termux server on purpose — the embedded server is just the zero-setup default.

---

## Architecture at a glance

```
┌─────────────────────────────  APK  ──────────────────────────────┐
│                                                                    │
│  WebView                          nodejs-mobile (native libnode)   │
│  mobile/www/index.html            mobile/nodejs-project/main.js    │
│    boot screen / self-update  ──▶   1 pick writable OH_DATA_DIR    │
│    startNode() → window.nodejs      2 seed from ./seed (first run) │
│    waitForServer() polls   ◀──┐     3 fetchMapAssets (background)  │
│    → location.replace(URL)    │     4 import ./server/server.js    │
│                               │              │                     │
│                        127.0.0.1:3000 ◀──────┘  (loopback bind)    │
└────────────────────────────────────────────────────────────────────┘
        │ first run                                    ▲ self-update check
        ▼                                              │
  GitHub Release "map-data"                     GitHub Release "android"
  (~200 MB pmtiles/geojson)                     (pax-historia.apk + Build:N notes)
```

The WebView and the server share the **same origin** (`http://127.0.0.1:3000`). That loopback bind + same-origin is the entire security model — no cross-origin writes are possible, so the server keeps its normal (unauthenticated, single-user) behavior. See [World state](world-state.md) for what the server actually serves once the WebView is inside it.

### Committed vs. assembled

Only three files under `mobile/nodejs-project/` are source-controlled; everything else is **build output** produced by `scripts/build-mobile-server.mjs` and git-ignored (`mobile/nodejs-project/.gitignore`).

| Path | Committed? | Role |
|---|---|---|
| `mobile/www/index.html` | ✅ source | Boot shell: embedded-server boot, manual-connect fallback, self-update UI |
| `mobile/nodejs-project/main.js` | ✅ source | nodejs-mobile entry point (the file `nodejs.start("main.js", …)` runs) |
| `mobile/nodejs-project/fetchMapAssets.mjs` | ✅ source | First-run map-binary download into the writable data dir |
| `mobile/nodejs-project/.gitignore` | ✅ source | Marks the rest as build output |
| `mobile/nodejs-project/server/` | assembled | Copied from repo `server/` (the real server) |
| `mobile/nodejs-project/dist/` | assembled | Built game bundle (`vite build`), heavy tiles stripped |
| `mobile/nodejs-project/public/lang/` | assembled | Server's read-only language fallback |
| `mobile/nodejs-project/seed/` | assembled | Default scenarios + manifests, minus heavy map files |
| `mobile/nodejs-project/node_modules/` | assembled | `express` only (~3.4 MB) — the server's sole npm runtime dep |
| `mobile/nodejs-project/package.json` | assembled | `express`-only manifest, mirrors the root pin |
| `mobile/nodejs-project/map-assets.json` | assembled | Copy of `scripts/map-assets.json` for the runtime fetch |
| `mobile/nodejs-project/runtime-data/` | runtime | Default `OH_DATA_DIR` when the launcher doesn't override it |
| `mobile/capacitor.config.json` | ✅ source | Capacitor app id / scheme config |
| `mobile/package.json` | ✅ source | Capacitor CLI + `@capacitor/android` (see caveat: plugin not yet added) |
| `mobile/android/` | ✅ source | Generated native Gradle project |
| `mobile/assets/logo.png` | ✅ source | Icon/splash source for `@capacitor/assets` |

---

## The boot shell — `mobile/www/index.html`

This is the Capacitor `webDir` entry: a self-contained HTML/CSS/JS boot screen (styled inline, dark `#0b1020`). It renders one of three "cards" and drives the whole launch flow before handing control to the on-device server.

### The three cards (UI states)

| Card id | Shown when | Contents |
|---|---|---|
| `booting` | Default launch; embedded server starting or a saved remote reconnecting | `Starting your server…` status, "First launch downloads the world map (~200 MB)" sub-note, hidden `useRemote` button |
| `setup` | Embedded server unavailable, or user chooses "connect to a different server" | URL input (default `http://localhost:3000`), `Connect & Play`, `Use this phone's built-in server`, error line |
| `update` | A newer build is published (see self-update) | `Download update` / `Continue without updating` |

`show(el)` (`mobile/www/index.html`) toggles which card is `display:flex`.

### Controls

| Control | id | Handler | Effect |
|---|---|---|---|
| Connect & Play | `connect` | `connect(input.value)` | Probe the typed URL, save it, `location.replace` into it |
| Use this phone's built-in server | `useEmbedded` | `startEmbeddedServer(true)` | Force the embedded boot path |
| Connect to a different server instead | `useRemote` | `showSetup` | Abandon embedded boot, show manual connect |
| Download update | `downloadUpdate` | `location.href = update.url` | Download `pax-historia.apk` from the release |
| Continue without updating | `skipUpdate` | `startNormalFlow()` | Ignore the update, proceed to normal launch |
| (server URL field) | `server` | Enter key → `connect` | Manual server address |

### Key variables

| Name | Value / source | Purpose |
|---|---|---|
| `KEY` | `"pax-server-url"` | localStorage key for the last chosen server URL |
| `EMBEDDED_URL` | `"http://127.0.0.1:3000"` | Where the embedded server always listens — **must stay in sync with `main.js`'s `PORT` default** |
| `APP_BUILD` | `"__APP_BUILD__"` (placeholder) | Stamped to `github.run_number` at CI build time; `"dev"` when unstamped |
| `RELEASE_API` | `.../repos/Open-Historia/open-historia/releases/tags/android` | The release the self-update check reads |
| `nodeStarted` | boolean | Guards against starting the Node process twice |
| `autoTimer` | timeout handle | Delays auto-reconnect to a saved remote server |

### Boot / launch flow

1. **`checkForUpdate()`** runs first (see [Self-update](#self-update)). If an update is found it shows the `update` card and stops; otherwise it calls `startNormalFlow()`.
2. **`startNormalFlow()`** (`mobile/www/index.html`):
   - If a saved URL exists **and it is not** `EMBEDDED_URL` (i.e. the user deliberately picked a remote/LAN server before), it shows `booting`, "Connecting to <saved>…", and auto-connects after 1.2 s (`autoTimer`).
   - Otherwise it calls `startEmbeddedServer(false)` — the default zero-setup path.
3. **`startEmbeddedServer(forced)`**:
   - `startNode()` grabs `window.nodejs` (exposed by nodejs-mobile-cordova) and calls `nodejs.start("main.js", cb, { redirectOutputToLogcat: true })`. `redirectOutputToLogcat` surfaces the embedded server's `console.log` in `adb logcat`. Guarded by `nodeStarted`.
   - If `window.nodejs` is missing (an old build without the plugin), it falls back to the `setup` card.
   - `waitForServer()` polls `probe(EMBEDDED_URL, 3000)` every 1.5 s until it answers, up to a **90 s deadline** (cold first start has to extract the project, seed, and start listening).
   - On success: save `EMBEDDED_URL` to localStorage and `location.replace(EMBEDDED_URL)` — the WebView is now the game.
   - On timeout: "The built-in server didn't respond." and reveal the `useRemote` escape hatch.
4. **`connect(raw)`** (manual path): `normalize()` the URL (adds `http://`, strips trailing slashes), `probe()` it, save + `location.replace()` on success, else show `setup` with an error.

### `probe()` — why native HTTP matters

`probe(url, timeout)` hits `<url>/api/library`. It **prefers `window.Capacitor.Plugins.CapacitorHttp`** over `fetch`. Reason (documented inline at `mobile/www/index.html`): the WebView's `fetch` is subject to CORS and Chrome's **Private Network Access** rules for loopback targets, which would block probing `127.0.0.1`; native requests are not. Only the probe uses native HTTP — the subsequent `location.replace` navigation is unaffected. A native response counts as reachable when `100 ≤ status < 500`.

---

## The embedded entry — `mobile/nodejs-project/main.js`

nodejs-mobile runs this file inside the app. It's plain Node + `fs`, so `node mobile/nodejs-project/main.js` on a desktop behaves identically (used for testing). It performs four steps, in order:

| Step | What it does | Notes |
|---|---|---|
| 1. Writable data dir | `DATA_DIR = OH_DATA_DIR ?? <here>/runtime-data`, then sets `process.env.OH_DATA_DIR` **and** `process.env.PORT` (default `"3000"`) before importing the server | The bundled `server/data` is read-only inside the APK; the native launcher may override with e.g. the app's Documents dir. `mkdirSync(..., {recursive:true})`. |
| 2. First-run seed | If `<DATA_DIR>/scenario-manifest.json` does **not** exist and `./seed` does, `fs.cpSync(seedDir, DATA_DIR, {recursive:true})` | "Already seeded" is detected purely by the presence of the scenario manifest. Failure is warned, not fatal (empty library). |
| 3. Map assets (best-effort) | `import("./fetchMapAssets.mjs")` then `fetchMapAssets(DATA_DIR)` in the **background** (`.catch` only) | Never blocks server start; the map fills in as tiles land. A missing fetcher is warned and ignored. |
| 4. Start the server | `await import("./server/server.js")` | The server reads `OH_DATA_DIR` + `PORT` from the env set in step 1. |

Env contract set by `main.js`:

| Env var | Set to | Read by |
|---|---|---|
| `OH_DATA_DIR` | resolved `DATA_DIR` | `server/dataDir.js` and every store |
| `PORT` | existing value or `"3000"` | `server/server.js` |

### The writable data dir — `server/dataDir.js`

`server/dataDir.js` exports the single `DATA_DIR` that every server store (games, scenarios, basemaps, flags, map-editor docs, ui-settings, lang packs, hub cache) reads:

```
DATA_DIR = OH_DATA_DIR ? path.resolve(OH_DATA_DIR) : <server>/data
```

When `OH_DATA_DIR` is unset (desktop / Termux) the app is byte-identical to those builds; when the embedded server sets it, all writes go to the sandbox path instead of the read-only APK bundle.

---

## First-run map download — `mobile/nodejs-project/fetchMapAssets.mjs`

The ~200 MB of pmtiles/geojson can't ship inside an APK, so they're downloaded on first run from the **`map-data` GitHub Release** (the same release + checksums the desktop `scripts/fetch-map-assets.mjs` uses). `fetchMapAssets(dataDir)` is idempotent and best-effort — it never throws in a way that stops the server.

### Manifest — `scripts/map-assets.json` (copied to the project as `map-assets.json`)

| Field | Value | Meaning |
|---|---|---|
| `owner` / `repo` | `Open-Historia` / `open-historia` | Release host |
| `release` | `map-data` | Release tag the assets hang off |
| `assets[]` | `{ path, asset, bytes, sha256 }` | Each map binary: repo-relative `path`, release `asset` filename, expected size + checksum |

The fetcher builds `base = https://github.com/<owner>/<repo>/releases/download/<release>` and reads the manifest from `<here>/map-assets.json`, falling back to `../../scripts/map-assets.json` on desktop (`fetchMapAssets.mjs`).

### Where each asset lands — `targetFor(dataDir, assetPath)`

Every asset is routed into the **writable** `OH_DATA_DIR`, never the read-only bundle:

| Manifest `path` prefix | Written to | Example |
|---|---|---|
| `server/data/…` | `<DATA_DIR>/…` | `server/data/scenarios/default/regions.geojson` → `<DATA_DIR>/scenarios/default/regions.geojson` |
| `public/assets/…` | `<DATA_DIR>/assets/…` | `public/assets/regions.pmtiles` → `<DATA_DIR>/assets/regions.pmtiles` |
| anything else | `<DATA_DIR>/<path>` verbatim | keeps it out of the read-only bundle |

### Download algorithm (per asset)

1. `stat(dst)` — if the file exists with the exact `bytes` **and** matching `sha256`, count it `present` and skip.
2. Otherwise `fetch(<base>/<asset.asset>, {redirect:"follow"})`; non-2xx → error.
3. Verify `sha256(buf) === asset.sha256` (checksum mismatch aborts that file).
4. Write to `<dst>.download`, then atomically `rename` into place (`downloaded++`).
5. Any failure logs a warning, unlinks the temp file, and continues (`failed++`) — one bad asset never stops the rest or the server.

Summary line: `[embedded] map assets: N downloaded, M current, K failed`. Requires a `fetch` implementation (guards against too-old Node).

### How the tiles reach the WebView — `resolveRuntimeBinaryAsset`

The server's PMTiles route `GET/HEAD /api/runtime/pmtiles/:assetKey` (`server/server.js`) streams a binary resolved by `resolveRuntimeBinaryAsset(assetKey)` in `server/libraryStore.js`. Resolution order:

1. A scenario-specific override upload, if present.
2. **`<DATA_DIR>/assets/<file>`** — the copy `fetchMapAssets` downloaded (this is why embedded works).
3. `public/assets/<file>` in the bundle — the desktop fallback (doesn't exist in the APK, since `build-mobile-server.mjs` strips it).

So on the phone the fetched copy is preferred; on desktop the bundled copy is served, unchanged. `DATA_ASSETS_DIR = <DATA_DIR>/assets` is defined in `server/libraryStore.js`.

---

## Self-update

The app updates itself by reading the rolling GitHub release on every launch — there's no store distribution.

**Flow** (`checkForUpdate()` in `mobile/www/index.html`):

1. If `APP_BUILD` isn't all digits (`/^\d+$/`), it's a dev build → return `null` (never self-updates).
2. `fetch(RELEASE_API)` with a 4 s timeout, `Accept: application/vnd.github+json`.
3. Parse the release `body` for `Build:\s*(\d+)` (case-insensitive). This "Build: N" line is written into the release notes by CI (see below).
4. If `remoteBuild <= APP_BUILD` → no update. Otherwise find the asset named exactly **`pax-historia.apk`** and return `{ build, url: asset.browser_download_url }`.
5. The `update` card's `Download update` sets `location.href` to that URL; Android downloads the APK and the user opens it to install over the existing app.

A small build badge (`build <N>` or `build dev`) is pinned bottom-right for support/debugging.

| Piece | Where |
|---|---|
| Build number placeholder | `APP_BUILD = "__APP_BUILD__"` in `index.html` |
| Stamp step | `sed -i "s/__APP_BUILD__/${{ github.run_number }}/"` in `.github/workflows/android-apk.yml` |
| Version signal | `Build: <run_number>` line appended to the release notes by the workflow |
| Update artifact name | `pax-historia.apk` (matched exactly by `a.name === "pax-historia.apk"`) |

---

## Release channels — stable vs. beta

The channel a build watches is determined **entirely by the `RELEASE_API` URL baked into `index.html`** (which repo + which release tag).

| Channel | `RELEASE_API` repo | Release tag | Notes |
|---|---|---|---|
| Stable (this work-repo / upstream) | `Open-Historia/open-historia` | `android` | The committed value in `mobile/www/index.html` |
| Fork build | `Tommi-K/pax-historia` | `android` | Same tag, different repo (seen in the fork worktree) |

**Accuracy note:** in the current code there is a **single rolling `android` release**, and no `android-beta` tag or `android-apk-beta.yml` workflow exists anywhere in the repo — `RELEASE_API` and the workflow's `gh release` calls both hardcode `android`. A stable-vs-beta split for the Android app therefore means *pointing `RELEASE_API` at a different repo/tag* (as the fork already does), not a second workflow. If a dedicated `android-beta` channel is wanted, the pattern would mirror the app-bundle `app-stable`/`app-beta` releases: publish to an `android-beta` tag and stamp/read that tag in a parallel shell — but that is not yet implemented here. Do not assume an `android-beta` release exists.

---

## Build pipeline

Two stages, both driven by `.github/workflows/android-apk.yml` (also runnable locally).

### Stage 1 — assemble the Node project: `scripts/build-mobile-server.mjs`

Run **after** `vite build` (it requires `dist/index.html`). It wipes and rebuilds the copied dirs each run, leaving the committed `main.js`/`fetchMapAssets.mjs` alone. Heavy files (`*.pmtiles`, `*.geojson`, `cities-seed.json`, matched by the `HEAVY` regex) are stripped everywhere — they're fetched at runtime instead.

| Step | Action |
|---|---|
| guard | Die unless run from repo root (`server/server.js`) and `dist/index.html` exists |
| 1 | Copy `server/` verbatim; copy `dist/` with `copyLight` (strips heavy tiles vite copied from `public/`) |
| 2 | Copy `public/lang/` (server's read-only lang fallback); `public/assets` pmtiles are **not** copied |
| 3 | Seed: copy `scenario-manifest.json`, `game-manifest.json`, `scenarios/` from `server/data` (heavy files stripped) into `seed/` |
| 4 | Copy `scripts/map-assets.json` → `map-assets.json` |
| 5 | Write an `express`-only `package.json` (mirrors the root's pinned express, default `^5.1.0`) |
| 6 | `npm install --omit=dev` into the project (skippable with `--no-install`) so the APK bundles `node_modules` |

Result: `mobile/nodejs-project/` ready for `cap sync` (dist ~21 MB, node_modules ~3.4 MB, seed carries no heavy files).

### Stage 2 — build the APK: `.github/workflows/android-apk.yml`

Triggers: `workflow_dispatch` or pushing an `android-v*` tag. `permissions: contents: write`.

| Step | Command / purpose |
|---|---|
| Checkout / Node 20 / Java 21 (temurin) | Toolchain |
| **Stamp the build number** | `sed` replaces `__APP_BUILD__` with `github.run_number` in `mobile/www/index.html` |
| **Build game + assemble server** | `npm ci` → `npm run build` → `node scripts/build-mobile-server.mjs` |
| **Build the APK** | `cd mobile` → `npm ci` → `npx cap sync android` → `./gradlew assembleDebug --no-daemon` |
| **Collect** | `cp mobile/android/app/build/outputs/apk/debug/app-debug.apk pax-historia.apk` |
| upload-artifact | `pax-historia-apk` |
| **Publish** | `gh release create android` (or `edit` if it exists) with the `Build: <run_number>` notes, then `gh release upload android pax-historia.apk --clobber` |

The APK is a **debug** build attached to the rolling `android` release; players download `pax-historia.apk` and sideload it.

---

## Capacitor config — `mobile/capacitor.config.json`

| Field | Value | Meaning |
|---|---|---|
| `appId` | `io.github.arkniem.paxhistoria` | Android application id — **must never change** (see invariants) |
| `appName` | `Open Historia` | Display name |
| `webDir` | `www` | The boot shell (`mobile/www/index.html`) is the packaged web root |
| `server.androidScheme` | `http` | WebView origin scheme (matches the `http://127.0.0.1` embedded server) |
| `server.hostname` | `app.paxhistoria` | Base WebView origin before navigating into the server |
| `server.cleartext` | `true` | Allow cleartext (loopback HTTP) |
| `server.allowNavigation` | `["*"]` | Permit navigating to any host (embedded loopback, or a LAN/remote server) — **see below before changing this** |
| `android.allowMixedContent` | `true` | Allow mixed content in the WebView |

`mobile/package.json` currently declares only `@capacitor/core` + `@capacitor/android` (deps) and `@capacitor/cli` + `@capacitor/assets` (dev). Scripts: `sync` (`cap sync android`), `open`, `apk`.

### `allowNavigation` is two settings wearing one coat

`["*"]` looks like an obvious thing to tighten: the WebView will navigate to any
origin, and it does so over cleartext to a host the player typed. It is not
obvious, because Capacitor feeds this one array to **two consumers with
incompatible syntaxes**, and getting it wrong fails in the unhelpful direction.

**Consumer 1 — the navigation allowlist.** `Bridge.shouldOverrideLoad` allows a
navigation when the target host equals the app's own host, *or* when
`HostMask` matches it. `HostMask` (`com/getcapacitor/util/HostMask.java`)
splits mask and host on `.`, requires an equal number of parts once the mask has
more than one, and matches each part exactly or against a literal `*`. So
`192.168.*.*` matches `192.168.1.20`, and a single-label mask like `localhost`
is a suffix match on the final label. A navigation that is *not* allowed is not
blocked — it is handed to `Intent.ACTION_VIEW`, i.e. it opens in the system
browser. That is a reasonable failure mode, not a dead end.

**Consumer 2 — the bridge's origin scope.** `Bridge.setAllowedOriginRules`
prefixes every entry that does not start with `http` with `https://` and adds it
to the set passed to `WebViewCompat.addWebMessageListener`, which decides **which
origins get the `androidBridge` object injected**. AndroidX documents that grammar
as `SCHEME "://" [ HOSTNAME_PATTERN [ ":" PORT ] ]`, where `HOSTNAME_PATTERN` is
a plain hostname, an IP literal, or a sub-domain pattern with a **leading `*.`** —
and a bare `*` is a standalone rule meaning "any origin". A wildcard in the middle
of a host is not in that grammar.

**The trap.** When `addWebMessageListener` throws, `MessageHandler` catches it and
falls back to `webView.addJavascriptInterface(this, "androidBridge")` — which
injects the bridge into **every page the WebView loads**, with no origin check at
all. So an entry that reads as a tightening (`192.168.*.*`) is a valid *navigation*
mask and an invalid *origin rule*, and buying the narrower navigation may cost the
origin scoping entirely. The failure is silent: no crash, no log the app surfaces.

**Entries that are valid to both consumers:** exact hostnames (`localhost`), IP
literals (`127.0.0.1`), and leading-label patterns (`*.local`). Anything with an
interior `*` is navigation-only.

### The decision, per app variant

- **Embedded server (this document's app).** The WebView navigates to exactly
  `http://127.0.0.1:3000` — a known host. `allowNavigation` should be
  `["127.0.0.1", "localhost"]`: valid in both consumers, and it means a link
  inside the game to an outside origin opens in the real browser instead of
  loading inside the app with the bridge attached. **This is the recommended
  change and it is safe to make.**

- **Thin client (`mobile/www/index.html` on `main`).** The player types the
  server's address, so the set of hosts is not known at build time and the only
  masks that would cover a LAN IP have interior wildcards — the trap above.
  `["*"]` stays until either the app stops navigating away from its own origin,
  or Capacitor grows a way to set the navigation allowlist at runtime.

Whether today's `["*"]` is already in the fallback path is worth ten minutes on a
device: it produces the rule `https://*`, whose validity under the grammar above
is genuinely ambiguous. Load a page, and check whether `androidBridge` exists on a
**non-app** origin. If it does, the bridge is already global and the thin client's
`["*"]` costs nothing extra to keep; if it does not, `https://*` is being honoured
and any interior-wildcard entry would be a regression. Either way, treat the
WebView as reachable by whatever server it connects to: it speaks cleartext HTTP
to a host on the local network.

---

## nodejs-mobile-cordova ↔ Capacitor build caveats

Combining a **Cordova** plugin (`nodejs-mobile-cordova`) with a **Capacitor** app is the fragile part of this build, and it is the one step **not yet committed**. The status list in `mobile/README-embedded-server.md` §"NOT yet done" and the note in the workflow's *Build the APK* step both flag it.

**Not-yet-done manual step (the linchpin):**
```sh
cd mobile
npm i nodejs-mobile-cordova     # adds the native libnode + window.nodejs bridge
npx cap sync android            # copies mobile/nodejs-project into the app, wires the plugin
```
Until this is done and committed, `window.nodejs` is undefined and the boot shell falls back to the manual-connect card (`startEmbeddedServer`'s "This build has no built-in server" branch). Confirming evidence: `mobile/package.json` and `package-lock.json` list **no** `nodejs-mobile-cordova`, so the checked-in native project cannot yet boot an embedded server.

| Caveat | Detail | Where it bites |
|---|---|---|
| **`www` folder** | Capacitor treats `webDir: "www"` as the web root and re-copies `mobile/www` into the native app's assets on every `cap sync`. The Cordova plugin's own convention is a Node project under `www/nodejs-project`. This repo deliberately keeps the Node project at `mobile/nodejs-project` (outside `webDir`) and assembles it with `build-mobile-server.mjs`, so `cap sync` must bundle it for the plugin without it being clobbered by web-asset syncing. Don't move the heavy Node project into `www`. |
| **CMake / native libnode path** | `nodejs-mobile-cordova` compiles/links a native `libnode` per ABI through CMake/NDK during the Gradle build. This is where per-ABI size and path issues surface. `README-embedded-server.md` calls this out: *"nodejs-mobile adds a native libnode per ABI; check the APK size and split per-ABI if needed."* |
| **Plugin must be committed for CI** | `.github/workflows/android-apk.yml` runs `cap sync` non-interactively; the plugin has to be present in `mobile/` (installed + native project regenerated) for `cap sync` to bundle it. The Cordova bridge is included via `:capacitor-cordova-android-plugins` (`mobile/android/settings.gradle`). |
| **On-device verification pending** | Cold-start time, the 90 s `waitForServer` window, and the ~200 MB first-run download UX are only verifiable on a real device (per the README status). Desktop verification covers `dataDir.js`, `main.js` seeding, the assembly script, and the pmtiles route. |

Debugging tip: `nodejs.start(..., { redirectOutputToLogcat: true })` sends the embedded server's `console.log` to `adb logcat`.

---

## Invariants that must never change

| Constant | Value | Why it's load-bearing |
|---|---|---|
| `appId` | `io.github.arkniem.paxhistoria` | The Android package id. Changing it makes the self-update install a *second* app instead of upgrading in place, orphaning every existing install. |
| Update asset name | `pax-historia.apk` | The self-update matches `a.name === "pax-historia.apk"` (`index.html`) and the workflow uploads exactly that name. A rename breaks self-update for everyone. |
| Embedded port / URL | `PORT` default `3000` in `main.js` **and** `EMBEDDED_URL = http://127.0.0.1:3000` in `index.html` | These two are a matched pair — the boot shell polls and navigates to exactly what the server binds. Change one, change both. |
| `Build: N` release-note format | regex `Build:\s*(\d+)` | The self-update parses the release body for this; the workflow must keep writing it. |

---

## Local development & testing

```sh
# from the repo root
npm ci
npm run build                 # produces dist/
npm run build:mobile-server   # runs scripts/build-mobile-server.mjs (installs express)

# exercise the embedded entry exactly as the phone will (desktop Node):
OH_DATA_DIR=/tmp/oh PORT=3000 node mobile/nodejs-project/main.js
#   → seeds /tmp/oh, downloads the map (~200 MB), serves http://127.0.0.1:3000

# APK (after installing the plugin — the manual step above):
cd mobile && npx cap sync android && cd android && ./gradlew assembleDebug
```

Because `main.js`, `fetchMapAssets.mjs`, and the server are all plain Node, the desktop run is a faithful rehearsal of the on-device boot — only the nodejs-mobile bridge and the native APK build differ.

---

## Related pages

- [World state](world-state.md) — what the embedded server serves once the WebView navigates into `127.0.0.1:3000`.
- The map editor and its asset pipeline share the `map-data` release and `resolveRuntimeBinaryAsset` path used here.
