# Android app — everything on the device

The Android app is the game's own web bundle inside a Capacitor 7 WebView, built with `--mode android`, with the world map inside the APK. After install it plays in airplane mode: the library lives on the phone, the map is read from the bundle, files save through the share sheet, and a model on the player's own network is reached through native HTTP. The community hub and the player's AI provider are the only things that use the network.

It has been three different things. First a thin WebView that asked for the address of a server the player ran themselves (a desktop on the LAN, or Termux on the phone). Then, from 2026-09-04, the website's bundle verbatim, which connected to a community content node and streamed every map tile from it — an app that could not open without the network. Since 2026-09-22 it is what this page describes. (A fourth design — the real Express server run in-process by nodejs-mobile — was documented in detail here and never built; the docs that described it have been rewritten.)

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Client | `dist-android/` → `mobile/www/` | `npm run build:android` = `seed-web-defaults.mjs` + `vite build --mode android`. Defines both `VITE_OH_WEB` and `VITE_OH_NATIVE` as compile-time literals (`vite.config.ts`). |
| Backend | `src/runtime/web/*` in the page | `installWebApiRouter()` patches `window.fetch`; every same-origin `/api/*` is answered from IndexedDB `open-historia-web` (scenarios, games, editor docs, basemaps, flags, settings). The same code serves openhistoria.com. |
| Map data | `www/assets/` inside the APK | `regions.pmtiles` (z8, 21.1 MB), `countries.pmtiles` (z8, 12.6 MB), `cities.pmtiles`, `default-regions.geojson` (12.8 MB), `regions-seed.geojson`, `cities-seed.json`. Pinned by sha256 in `mobile/map-assets.android.json`; fetched and verified by `mobile/scripts/stage-map-assets.mjs` into `mobile/map-cache/`; laid into the bundle by `stage-www.mjs`. `/api/runtime/pmtiles/<key>` → `/assets/<key>.pmtiles` (the interceptor's `/assets` fallback, since `VITE_OH_PMTILES_URL` is unset in `.env.android`), read **whole, once**, and sliced in memory (`src/runtime/wholeFileSource.js`). Never by Range: Capacitor's local server answers `Range: bytes=a-b` with a 206 and the right headers but a body that runs from `a` to the end of the file — on Android 15 a 16 KB read of the regions archive returned 16 MB, and every tile read before the archive had warmed failed to decompress (no country labels, no cities). `noCompress 'pmtiles'` in `build.gradle` keeps the archives stored in the APK. |
| Screen | `capacitor.config.json` `android.adjustMarginsForEdgeToEdge: "auto"`, `res/values/styles.xml` | Android 15 draws every app edge to edge; without margins the game's top bar sat under the status-bar clock and icons. The WebView gets margins for the system bars and the display cutout, and the bars show the game's own background (`#131315`) with light icons. |
| Offline sea | `public/offline-relief/`, `src/runtime/networkStatus.js` | With no network at all the map, the Workshop and the country picker draw the bundled ETOPO1 relief (levels 0–3, 2.2 MB, public domain) instead of the remote ESRI/terrain tiles, and the preload skips warming them: no failed requests, a real sea. The WebView only knows it is offline because the manifest asks for `ACCESS_NETWORK_STATE` (a normal permission, no prompt) — without it `navigator.onLine` is always true. See game-map.md §3. |
| No web analytics | `vite.config.ts` `dropWebAnalytics` | `index.html`'s Google tag is the website's; the android build strips it and fails if any of it survives. |
| Fonts | `src/assets/fonts/` | The loading screen's Cinzel and EB Garamond ship in the bundle (Fontsource 5.3.0, Latin + Latin Extended, OFL) instead of coming from Google Fonts — for every build, so offline and on the desktop too. |
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

The release key exists since 2026-09-22: `open-historia-release.jks` (PKCS12, RSA 4096, alias `open-historia`, valid to 2056, certificate SHA-256 `0b9c9323…2806f9`), kept by the owner outside every repo, and in the repository secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`, so every CI build is signed with it. `apksigner verify --print-certs` shows which key signed an APK.

## Size

About 59 MB (the signed release build measured 59.1 MB on 2026-09-22; a debug build is a couple of MB larger): the bundle (~14 MB compressed once the website-only images are pruned), 35 MB of pmtiles stored as-is, and ~33 MB of JSON that deflates to roughly 8 MB. The 55 MB desktop-only GeoJSON variants never ship; the web-sized ones do.

## Verification

Checked on 2026-09-22 on the Android 15 emulator (x86_64 Google APIs image, WebView 124, 4 GB), driven over the WebView's DevTools socket (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`), with the network off — airplane mode and Wi-Fi and mobile data, because airplane mode alone leaves the emulator's network up:

- A wiped install shows "Everything is on this device" after about 4 s and the library after about 15 s; later launches take about as long (the startup preload is about 7 s of it).
- A new game on Modern Day draws borders, curved country labels and cities, with region outlines at z7. Each archive is read exactly once, whole; no Range request leaves the page.
- The Workshop opens in about 3 s with 4,848 regions, 202 countries and 2,527 features.
- A scenario (489 KB) and a game (23 KB) export through the share sheet and import back through the system picker.
- An update installed over the app keeps its library (same signing key).
- With the network on, `CapacitorHttp` reaches a stand-in with no CORS headers on the host (a plain fetch to it fails, as against stock Ollama) and brings back a 2 MB reply after 8 s intact.
- With a game and the Workshop open the JS heap is about 230 MB.
- Offline, every request stays on the device (55 local files for a first launch and a new game; nothing to ESRI, AWS, Google Analytics or Google Fonts) and none fails; the map, the Workshop and the country picker draw the bundled relief. Losing or regaining the network mid-game redraws the map in a few seconds with the other basemap and the country colours intact.
- The loading cover names the country just picked (it named the scenario's default until the patch that set it arrived); the AI-key dialog says the tutorial video needs a connection instead of showing the WebView's error page; the country search no longer raises the keyboard over the picker.

The release build, signed locally with the release key, was run the same way. Not checked yet: a physical phone, a turn with a real cloud key, the community hub, the update banner against a published `latest.json`, and a build signed by CI.
