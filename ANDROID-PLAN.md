# Open Historia Native on Android: feasibility spike

Branch `native/android-spike` (lab), from `native/godot-app` 86a5db1b. Spike run 2026-11-05 on this machine: Godot 4.7.2 template export, NDK r29 (29.0.14206865), Rust 1.99.1 + cargo-ndk 4.1.2, emulator `oh35` (Android 15, x86_64, 4 GB; `-gpu host` = NVIDIA T1200 through the emulator's GLES 3.1 translator; SwiftShader cannot draw the UI, see section 3).

## Verdict

Feasible, with the same architecture as desktop. A debug APK built here (x86_64) installs on the emulator, unpacks its engine files, starts **Node 24.18 built from source for Android** as a child process from the app's native library folder, and the Godot UI reaches the vault door, the main menu, the Scenarios page (Modern Day served by the engine's server) and the country picker with the map baked by the Rust GDExtension and 202 nations with flags. Screenshots: `scratchpad/shots/hostgpu-boot.jpg`, `hostgpu-door-open.jpg`, `hostgpu-scenarios.jpg`, `hostgpu-newgame.jpg`.

Chosen: **(c) stock Node 24 cross-built with the NDK, run as a separate process exactly like desktop's `node.exe`**, with the Rust GDExtension and `ohfronts-host` built by `cargo ndk`, packaged by Godot's stock Android template (no Gradle build, no Kotlin plugin yet). nodejs-mobile (a) was tried and fails (Node 18, no ICU); the WebView route (b) means rewriting the 28k lines of sidecar handlers.

The engine is the easy part. The real cost is the phone UI (section 4) and the Android lifecycle (a foreground service so skips survive the screen turning off).

## 1. The engine on Android

The desktop app talks to a Node process over stdin/stdout JSON lines (`Sidecar` in `oh_gdext/src/lib.rs`, `engine_link.gd`, `native/sidecar/main.mjs`). Android lets an app `exec` a binary only from its own native library folder (`nativeLibraryDir`, extracted because the Godot template sets `extractNativeLibs=true`). So any binary we ship as `lib/<abi>/libX.so` can be started with `std::process::Command`, exactly like `node.exe` on Windows. Verified on the emulator: the APK's `lib/x86_64/*.so` land in `/data/app/.../lib/x86_64/` with mode `rwx`, and `Sidecar.library_dir()` (new, reads `/proc/self/maps`) finds that folder.

### (a) nodejs-mobile (`libnode.so` 18.20.4, the newest release, Oct 2024)

Tried for real: `libnode.so` + a 4 KB launcher executable (`ohnode.cpp`, `int main → node::Start`, in commit 181a1618, removed after) shipped as `libohnode.so`, run on the emulator both from `adb shell` and from inside the APK (the app unpacked the payload, `Sidecar` started the launcher from `nativeLibraryDir`, the sidecar printed its first lines, then stopped on the error below).

Measured:
- `node -v` cold start 1.06 s; `libnode.so` 65 MB (x86_64) / 62 MB (arm64), unstripped (has `.debug_*` and `.symtab`), 17.7 MB gzip for arm64.
- **No ICU at all**: `process.versions` has no `icu`, `Intl` is undefined, and `\p{...}` in a `u` regex is a SyntaxError. The sidecar dies at once: `The game's server stopped: Invalid regular expression: /^[$_\p{ID_Start}]$/` (path-to-regexp in Express). The bundles hold 160 (engine) + 60 (workers) + 3 (labels) `\p{` regexes, 16 `Intl.` uses, ~200 `localeCompare`, ~85 `toLocale*String`, ~80 `normalize(`.
- Node 18 lacks APIs the bundles use: global `WebSocket` (engine, multiplayer), `navigator` (workers, server), `fs.openAsBlob` (workshop.mjs ×2), `Set.prototype.union/intersection/difference` (engine ×6), `Array.prototype.toReversed` (engine), `RegExp.escape` (engine + server, Node 24), `Promise.withResolvers`, `Object.groupBy`, `File`. Present: `fetch`, `AbortSignal.any`, `AbortSignal.timeout`, `structuredClone`, `DecompressionStream`, `Blob`, `crypto`, `worker_threads`.
- Shims could cover the APIs, but not ICU. Rebuilding nodejs-mobile with ICU is the same work as (c) below, on an older Node.

Rejected.

### (b) The engine bundle in an Android WebView

The Capacitor app (`mobile/`) runs the whole game in a WebView with `src/runtime/web/` (32 files, ~7.7k lines) standing in for `server/server.js` (router, IndexedDB library store, flag/basemap stores). For the native app that would mean:
- A Godot Android plugin (Kotlin) holding an off-screen WebView, a JS bridge (`addJavascriptInterface` + `evaluateJavascript`), and a message pump to `EngineLink`.
- Porting the 39 sidecar handlers (28,457 lines; 28 import `node:` modules: fs ×32, path ×34, crypto ×22, child_process ×9, worker_threads ×8, http, net, vm, zlib) to browser APIs, plus `main.mjs`, `shims.js` (1,180 lines), `rustFronts.mjs` (no child processes in a WebView, so war simulation falls back to JS or a JNI bridge).
- A background WebView is throttled and can be killed with the activity; long skips (tens of seconds) need a foreground service anyway.
- Upside: no Node binary (~20-25 MB less per ABI), V8 with JIT is already on the phone.

Effort: months, and a second copy of every handler to keep in step with desktop. Rejected.

### (c) Node 24 built from source for Android (chosen)

Node's own `android-configure` (Linux/macOS hosts) cross-builds the `node` executable with the NDK, full ICU included, same major as the desktop runtime (v24.18.0 here). Built in Docker (`ubuntu:22.04`, NDK r29 Linux) with `native/android/node/build.sh`. What it took (all in the script):
- The host toolset must be the container's gcc (`CC_host=gcc CXX_host=g++ LINK_host=g++ AR_host=ar`); otherwise V8's host tools (`torque`, `mksnapshot`) are compiled with the Android clang and fail on `backtrace()`.
- The host V8 (for `mksnapshot`) is compiled as Linux, where `trap-handler.h` turns the WebAssembly trap handler on, but gyp's `OS=android` leaves out the posix handler sources, so the `mksnapshot` link fails (`undefined reference to RegisterDefaultTrapHandler`). Node ships the fix as `./android-configure patch` (forces `V8_TRAP_HANDLER_SUPPORTED false`); run it before configuring. In this spike the patch was found late, so the two posix sources were compiled for the host and added to the host archive by hand instead; the script uses Node's patch and has not been run end to end yet.
- Build only the `node` target (`make -C out BUILDTYPE=Release node`): the default target also builds `cctest`, which uses `aligned_alloc` (API 28+) and fails at API 24.
- `CFLAGS_host=-O1` speeds up the host half; `-O0` breaks V8's `always_inline` functions under gcc.

Build time: about 6.5 hours of wall clock here, but the machine was shared (two emulators, Godot exports, a fat-LTO Rust build) and two flag changes forced full host rebuilds. A clean CI run on a 16-core Linux runner should take roughly 45-75 min per ABI; cache it by Node version.

Measured on the emulator (x86_64):
- `node -v` 0.06 s. `process.versions.icu` 78.3; `Intl.Segmenter`, `Intl.DateTimeFormat('fr')` ("novembre"), `/\p{ID_Start}/u`, `normalize('NFD')`, global `WebSocket`, `navigator`, `fs.openAsBlob`, `Set.prototype.union`, `RegExp.escape`, `Promise.withResolvers` all present.
- Binary: 115 MB unstripped, **95 MB stripped** (V8 + full ICU data + OpenSSL), **34 MB gzip**. Needs only `libc++_shared.so`, which Godot's template already ships.
- The unchanged sidecar (`main.mjs`, server worker, engine bundle, 39 handlers) starts under it: server listening ~1.1 s after spawn, `ready` right after; `hello`, `library.list` (Modern Day) and `countries.list` (202 nations with flag files) answer. Only `node-datachannel` (multiplayer's native addon) is missing.

The stripped `node` ships as `lib/<abi>/libohnode.so` (a `[dependencies]` entry in `oh.gdextension`); `EngineLink._start_android` runs it with `LD_LIBRARY_PATH` set to the library folder. Two processes (Godot + Node) plus `ohfronts-host` during war turns, same as desktop.

Smaller variants for later: `--with-intl=small-icu` (English only, about -25 MB, but the game has 22 languages) or `--with-intl=system-icu` against Android's ICU4C NDK API (API 31+ only).

### Other runtimes considered, not tried
- Termux's `nodejs` package (Node 24/25 for Android with ICU) proves (c) works on phones, but it links Termux's own prefix (`libicu*`, `libssl`, `libcares`, `libsqlite`) and patches paths; not downloaded (third-party binaries).
- QuickJS/Hermes embedded in Rust: no Node APIs, no JIT; the fronts fallback and the engine bundle would be far slower. Rejected.
- Bun/Deno: no Android builds.

## 2. Rust on Android

- `cargo ndk -t x86_64 -t arm64-v8a -P 24 build -p oh_gdext -p ohfronts --release` builds both crates once `ohweb` (wry) is kept off Android (`Cargo.toml` target cfg + a stub `load_api` in `webpanel.rs`; `WebPanel` then reports "not built for Android"). Fat LTO, stripped:
  - x86_64: `liboh_gdext.so` 4.1 MB, `ohfronts-host` 2.9 MB.
  - arm64-v8a: `liboh_gdext.so` 3.7 MB, `ohfronts-host` 2.3 MB.
  - Fat-LTO builds took 21 min (x86_64) and 45 min (arm64) on the loaded machine; use thin LTO day to day.
- The GDExtension loads on Android: the classes register, `MapBaker` bakes the 3,662-region world for the country picker, and `Sidecar` spawns and pipes the engine. The new static `Sidecar.library_dir()` finds `nativeLibraryDir` from `/proc/self/maps`; GDScript calls it through `ClassDB.class_call_static`, so desktop builds with an older DLL still compile.
- `ohfronts-host` runs as an executable on Android unchanged: shipped as `lib/<abi>/libohfronts.so`, `OH_RUST_FRONTS_HOST` points `rustFronts.mjs` at it, and it answers `ping` on the emulator (`{"t":"pong","id":1}`). So war simulation stays the same Rust as desktop, in its own process, with the JS fallback still there. Making it a library called in-process would save one process and ~3 MB but needs a Node addon (N-API) build for Android; not worth it now.
- `jsmath.rs` uses ucrtbase `pow` on Windows only; Android takes the `#[cfg(not(windows))]` path, same as Linux/mac. Bit-exactness vs. V8 on arm64 still needs the golden suite run on a device (`cargo ndk test` or `cargo-ndk-runner` + adb).

## 3. Godot export with the GDExtension

- No Gradle build needed: the stock `android_debug.apk` template has `extractNativeLibs=true`, and Godot copies every library and `[dependencies]` entry of `oh.gdextension` for the chosen ABIs into `lib/<abi>/`.
- New Android preset (`export_presets.cfg` preset.3: `io.github.arkniem.openhistoria.native`, arm64-v8a + x86_64, internet permission, immersive), `rendering/textures/vram_compression/import_etc2_astc=true`, `display/window/handheld/orientation=4` (sensor landscape).
- Engine files (sidecar, server, node_modules subset, public) go into the PCK as `android_payload/app.zip` + `app.stamp` (`native/android/stage.mjs`); `AndroidPayload` (`scripts/shell/android_payload.gd`) unpacks them on a WorkerThreadPool task into `user://app` on first start (and when the stamp changes); `UI.repo_path` points there on Android; `EngineLink._start_android` starts `libohnode.so <app>/native/sidecar/main.mjs` with `OH_NATIVE_ROOT=user://data`, `LD_LIBRARY_PATH`, `HOME`, `TMPDIR`, `OH_RUST_FRONTS_HOST`, `OH_DISCORD_PRESENCE=0`.
- Results on the emulator:
  - Export 22 s on an idle machine (5-9 min while Docker was compiling); install 7 s.
  - Works: GDExtension, boot scripts, vault door, main menu (Games/Scenarios/Community/Lobbies/Settings), scenario cards with the engine's cover art, the country picker with the baked map and flags.
  - Payload unpacking with Godot's `ZIPReader` straight from the APK asset took **43 minutes** (each `read_file` searches the central directory, through a compressed asset Godot reads by seeking). Now the zip is copied out once (sequential read) and unpacked with the system's `/system/bin/unzip` (toybox): **3.9-4.8 s** for 1,560 files / 117 MB, `ZIPReader` kept as the fallback.
  - On the very first launch `UI.repo_path` files (fonts, logo, icon) are not unpacked yet while `_ready` builds the boot UI, so the startup screen falls back to system fonts once. Fix: unpack before building the shell, or put fonts/logo in the PCK.
  - **SwiftShader (`-gpu swiftshader_indirect`) cannot draw the UI**: `CanvasShaderGLES3` and `SceneShaderGLES3` fail to link ("Fragment shader active uniforms exceed GL_MAX_FRAGMENT_UNIFORM_VECTORS (261)") and the screen stays the clear colour (under heavy host load System UI also stopped responding). With `-gpu host` everything draws. Phones report 256-1024 vectors, so check a low-end Mali/Adreno; this app's emulator recipe must use `-gpu host`.
  - Not available in the APK: Discord, WebPanel, multiplayer (`node-datachannel`), the AVIF helper. The engine logged one 404 for the stock country tiles from the CDN (the catalog falls back to the world's own polities); not investigated.
  - Another session's emulator was up at the same time and the adb server was restarted under this one several times: always pass `-s emulator-5554`.

## 4. What the desktop UI needs for phones (not built)

The UI is designed at 1440×900 and scaled by `Hotkeys.screen_scale()` = max(macOS backing scale, min(w/1920, h/1080), 1). On a 2400×1080 phone that is 1.0: desktop pixel sizes on a ~420 dpi screen, about 2.6× too small to read or tap. Needed, in the order they matter:
1. **Scale and safe area.** On Android use the density (`DisplayServer.screen_get_scale()`, 2.625 on a Pixel 6) for touch sizing, and lay out against the resulting ~914×411 dp landscape (or ~411×914 portrait) viewport instead of 1440×900; respect `DisplayServer.get_display_safe_area()` (cut-outs, gesture bar). React's switch is `useIsMobile` (max-width 700 px) and `APP_HEIGHT`; the native app needs an equivalent `UI.phone` flag that every panel reads.
2. **Phone layouts per panel**, mirroring beta's React phone layouts (memory: project-mobile-ui-pass): advisor, country panel, stats windows, debug console and settings workspace become full-screen sheets; map cards (Regions/Units/Features) become bottom sheets (right-side cards on a sideways phone); a card and a bottom panel take turns; top bar and dock shrink. Biggest files: chat_panel 5.5k lines, advisor_panel 5.1k, cheats_panel 4.6k, country_panel 3.7k, settings_workspace 3.0k, institutions_view 2.6k, map_cards 2.0k, war_room 1.9k (183 scripts, 115k lines in all).
3. **Touch input.** 25 scripts handle hover (`mouse_entered`, `InputEventMouseMotion`, tooltips: 379 `tooltip_text` uses) and 7 use right-click; only 7 scripts know touch/gesture events (map_navigator, map_view, workshop_map, war_room_map, vault_door, main, sound_engine). Needs: pinch-zoom and two-finger pan on every map (MapView, globe, War Room, Workshop), long-press for right-click menus, tap-to-show for tooltips, 44 px minimum hit targets, drag thresholds for lists.
4. **Keyboard.** `LineEdit`/`TextEdit` raise the virtual keyboard, but panels must move up when it shows (`DisplayServer.virtual_keyboard_get_height()`); Enter must not send in composers on phones (same rule the React app still misses).
5. **Back button.** `NOTIFICATION_WM_GO_BACK_REQUEST` closes the newest overlay (React's `useBackToClose`); with nothing open it should not quit mid-game.
6. **Lifecycle.** Pause/resume (`NOTIFICATION_APPLICATION_PAUSED`): flush `local-storage.json`, tell the sidecar (`presence`), keep a skip alive in a foreground service or resume it.
7. **Desktop-only features to hide or replace:** WebPanel (setup video, Fantasy Map Generator: wry has an Android backend but needs the Kotlin glue), DevTools window, Discord presence and invites, AVIF via the Windows WIC helper (`imagecodec`), the self-updater (Play/Store or APK feed instead), `OS.shell_open` links (fine on Android), file pickers for import/export (Godot's `DisplayServer.file_dialog` maps to the SAF picker on Android 4.3+), multiplayer (`node-datachannel` is a native addon: needs an Android build or a WebRTC alternative).
8. **GPU budget.** Mobile GPUs: the Compatibility renderer is right, but check shaders against `GL_MAX_FRAGMENT_UNIFORM_VECTORS` (SwiftShader reports 261 and Godot's own canvas and scene shaders fail to link there, so nothing draws), terrain/globe at 40-60 fps on a T1200 means far less on phones, so tilted 3D terrain may need to be off by default.

## 5. Steps to a full app

| # | Step | Size |
|---|------|------|
| 1 | CI job (Linux runner): build Node 24 for arm64-v8a + x86_64 with `native/android/node/build.sh` (`docker run -v <work>:/work -v <repo>/native/android/node/out:/out -v <repo>/native/android/node:/build ubuntu:22.04 bash /build/build.sh arm64`), cache by Node version; run once on a real arm64 phone | 1-2 days |
| 1b | `node native/android/build.mjs --abi arm64-v8a,x86_64 --godot <Godot console exe>` (cargo ndk, copies libs + node into `native/godot/bin/android/<abi>/`, stages the payload, exports) is the local one-shot; put the same steps in the workflow | 0.5 day |
| 2 | CI job: `cargo ndk` both ABIs, stage payload, Godot Android export (release template, release keystore from secrets), split APKs or AAB per ABI | 2-3 days |
| 3 | Payload: unpack with progress on the boot screen, verify by stamp, delete stale files, keep user data in `user://data` | 1 day |
| 4 | Lifecycle: foreground service (Godot Android plugin, Kotlin) so a skip survives the screen turning off; pause/resume notifications; kill the sidecar with the app; phantom-process limit check (Android 12+) | 3-5 days |
| 5 | Engine on device: run the sidecar smoke (`smoke.mjs`), all handlers loading, one real skip with a test key, fronts golden suite on arm64 | 2-3 days |
| 6 | Phone UI pass (section 4, items 1-6) | 4-8 weeks |
| 7 | Desktop-only features: WebPanel on Android (wry + Kotlin), multiplayer native addon for Android, AVIF decode (Rust `image`/dav1d or Godot's own), imports/exports through SAF | 2-4 weeks |
| 8 | Size: per-ABI APKs, drop or download-on-demand `public/audio` (31 MB) and `public/lang` (32 MB), system ICU for Node on API 31+, compress `.so` | 2-3 days |
| 9 | Performance pass on real phones (low-end arm64 with 4 GB): map draw, memory caps for Node (`--max-old-space-size`), thermal | 1-2 weeks |
| 10 | Store/feed: signing, update feed for the APK (the Capacitor app's feed is dead: memory project-android-apk-rename-and-dead-update-feed), Play listing if wanted | 2-3 days |

## 6. Measurements

All on the x86_64 emulator with host GPU (desktop CPU, shared with builds; expect 2-4x slower on a mid-range phone).

| What | Value |
|---|---|
| Debug APK, x86_64 only (as built) | 196 MB: node 95 MB stored uncompressed, payload zip 59 MB, libgodot 28 MB compressed, gdext + fronts 7 MB stored, dex 2 MB |
| Same with the `.so` files compressed (Godot stores GDExtension libs uncompressed) | ~140 MB |
| Estimated release APK per ABI | ~120 MB full; ~82 MB without `public/audio` (30 MB, does not compress) and `public/lang` (9.5 MB zipped), fetched on demand |
| Payload | 1,560 files, 105.5 MB staged, 56.6 MB zip: audio 31 MB, lang 32 MB, flags 5 MB, server 13 MB, sidecar dist 16 MB (no source maps), node_modules subset 7 MB (81 packages) |
| On disk after install | APK + extracted `lib/` (~185 MB) + unpacked payload 117 MB + data |
| Cold first start (data cleared) | activity 1.5 s; payload unpacked in 3.9 s (alongside `_ready`); engine spawned at +7.8 s, server listening at +8.9 s |
| Warm start | activity 1.4 s; engine spawned at +6.6 s (boot scripts), server listening at +7.4 s |
| Node alone | `node -v` 0.06 s; sidecar spawn to server listening 0.7-1.1 s |
| Memory at the menu | Godot 334 MB PSS (458 MB RSS), Node 145 MB PSS |
| Memory with the country picker open (map baked, catalog loaded) | Godot 420 MB PSS, Node 345 MB PSS: **~765 MB** for the two |
| nodejs-mobile 18.20.4, for comparison | `libnode.so` 62-65 MB unstripped, 17.7 MB gzip, `node -v` 1.06 s; unusable (no ICU) |

## 7. Risks

- **Node on Android is "experimental" upstream.** Each Node bump may need build fixes (the host-toolset fix here; Termux carries ~20 patches for its prefix). Mitigation: pin the version, build in CI, smoke-test on the emulator per bump.
- **Exec from `nativeLibraryDir`** relies on `extractNativeLibs=true`, which Google discourages for size (libs stored twice: compressed in the APK, extracted on disk). Play still accepts it; an AAB build must set `useLegacyPackaging true` (Gradle build) to keep it.
- **Phantom process killer** (Android 12+): child processes of an app count against a device-wide limit of 32 and can be killed when the app is in the background using CPU. Two children here (node, ohfronts-host, plus worker threads which are not processes). A foreground service during skips avoids most of it; the fallback is in-process Node (libnode + `node::Start` on a thread), which loses restartability.
- **Memory.** ~765 MB for Godot + Node once a map is open, before any turn; a 4 GB phone has ~1.5 GB free. Cap V8 (`--max-old-space-size`), expect the low-memory killer to take Node first when the app is in the background, and measure a full skip on a real phone.
- **arm64 Node not built yet.** Only the x86_64 Node was built and run; arm64 uses the same script (its `mksnapshot` runs V8's arm64 simulator on the host) and needs a device run.
- **Size.** Two runtimes (Godot ~25-28 MB compressed per ABI, Node ~34 MB) plus the payload; Godot stores GDExtension libraries uncompressed, so compress them in a Gradle build or accept ~60 MB more per ABI.
- **Phone UI is the real cost**: weeks of layout work across 115k lines of GDScript UI, the desktop design does not shrink.
- **GL limits** on mobile GPUs (uniform counts, texture sizes, precision) need a pass on real devices; the emulator's SwiftShader already rejects one shader variant.
