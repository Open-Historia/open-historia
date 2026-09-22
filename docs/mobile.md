# Android app — everything on the device

The Android app is the game's own web bundle inside a Capacitor 7 WebView, built with `--mode android`, with the world map inside the APK. After install it plays in airplane mode: the library lives on the phone, the map is read from the bundle, files save through the share sheet, and a model on the player's own network is reached through native HTTP. The community hub and the player's AI provider are the only things that use the network.

It has been three different things. First a thin WebView that asked for the address of a server the player ran themselves (a desktop on the LAN, or Termux on the phone). Then, from 2026-09-04, the website's bundle verbatim, which connected to a community content node and streamed every map tile from it — an app that could not open without the network. Since 2026-09-22 it is what this page describes. (A fourth design — the real Express server run in-process by nodejs-mobile — was documented in detail here and never built; the docs that described it have been rewritten.)

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Client | `dist-android/` → `mobile/www/` | `npm run build:android` = `seed-web-defaults.mjs` + `vite build --mode android`. Defines both `VITE_OH_WEB` and `VITE_OH_NATIVE` as compile-time literals (`vite.config.ts`). |
| Backend | `src/runtime/web/*` in the page | `installWebApiRouter()` patches `window.fetch`; every same-origin `/api/*` is answered from IndexedDB `open-historia-web` (scenarios, games, editor docs, basemaps, flags, settings). The same code serves openhistoria.com. |
| Map data | `www/assets/` inside the APK | `regions.pmtiles` (z8, 21.1 MB), `countries.pmtiles` (z8, 12.6 MB), `cities.pmtiles`, `default-regions.geojson` (12.8 MB), `regions-seed.geojson`, `cities-seed.json`. Pinned by sha256 in `mobile/map-assets.android.json`; fetched and verified by `mobile/scripts/stage-map-assets.mjs` into `mobile/map-cache/`; laid into the bundle by `stage-www.mjs`. `/api/runtime/pmtiles/<key>` → `/assets/<key>.pmtiles` (the interceptor's `/assets` fallback, since `VITE_OH_PMTILES_URL` is unset in `.env.android`), read by HTTP Range from Capacitor's local server; `noCompress 'pmtiles'` in `build.gradle` keeps the archives stored, so a range read never inflates from byte 0. |
| Boot | `src/runtime/web/nativeBoot.js` | The boot screen waits only on the library seeding, then settles on `{ local: true }` ("Everything is on this device"). No node directory, no heartbeat. |
| Files out | `src/runtime/saveFile.js` → `native/fileSave.js` | Every export, log and editor download goes through one door: `Filesystem.writeFile` into the app cache + `Share.share`. Export and "Save log file + game" are offered in the app. |
| Files in | `<input type="file">` | Capacitor's WebChromeClient opens the system picker; imports work unchanged. |
| AI | `src/Game/AI/main.jsx` + `native/http.js` | Cloud providers: direct streaming fetch, as everywhere. A LAN endpoint (Ollama, LM Studio — no CORS headers) goes through `CapacitorHttp.request` from the app process, whole-body (no token streaming, no abort in flight). Cleartext is allowed by the manifest. |
| Hashes | `src/runtime/sha256.js` | `http://app.paxhistoria` is not a secure context, so `crypto.subtle` is withheld. WebCrypto where present, `@noble/hashes` otherwise; flag and basemap dedup and the archive warm all use it. |
| Workers | `src/Game/AI/runtimeIoBridge.js` | A Web Worker never sees the page's fetch patch. The Country Stats worker's runtime reads/writes travel to the page as `io` messages and back as `io-result`; switched on by a `config` message on web builds only. |
| Update | `src/runtime/web/router.js` `app-update` | Reads `releases/download/android/latest.json`, which `android-apk.yml` now writes. `versionCode`/`versionName` come from the run number. |

Origin: `http://app.paxhistoria` (`capacitor.config.json`). It must not change — it is the key to every player's IndexedDB library. `allowNavigation` is gone (external links, including the APK download, open in the system browser), and `CapacitorHttp` is disabled as a fetch patch so it never sits under the interceptor.

## Build

CI: `.github/workflows/android-apk.yml` (`workflow_dispatch` or an `android-v*` tag): `npm run build:android` → in `mobile/`: `npm ci`, `npm run map` (cached on the manifest's hash), `npm run www`, `npx cap sync android`, `./gradlew assembleRelease` with `OH_ANDROID_BUILD=<run number>` — signed with the `ANDROID_KEYSTORE_*` secrets when present, debug-signed otherwise — then publishes `open-historia.apk` and `latest.json` to the rolling `android` release.

Locally (Windows; see the toolchain notes in the repo memory):

```
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=C:\Users\Public\oh-jdk-sockets"
npm run build:android
cd mobile; npm ci; npm run map; npm run www; npx cap sync android
cd android; .\gradlew assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

`mobile/www/` and `mobile/map-cache/` are build outputs (gitignored). A signed build needs one keystore for the life of the app: a fresh debug keystore on every CI runner is a different certificate, and Android refuses to install over a package signed with another one — which is why the first signed build cannot upgrade an older debug-signed install in place.

## Size

About 56 MB: the bundle (~14 MB compressed once the website-only images are pruned), 35 MB of pmtiles stored as-is, and ~33 MB of JSON that deflates to roughly 8 MB. The 55 MB desktop-only GeoJSON variants never ship; the web-sized ones do.

## Verification

Fresh install, airplane mode on: the boot screen reads "Everything is on this device" and comes down within a couple of seconds; the built-in scenario opens with borders past z6.5 and country labels; the Scenario Workshop opens with stock regions and cities; a scenario and a game export through the share sheet and import back through the picker; the diagnostics log saves. Airplane mode off: a jump with a cloud key streams; a jump against Ollama on the LAN answers (buffered); the hub lists and downloads; the update banner appears when `latest.json` carries a higher build.
