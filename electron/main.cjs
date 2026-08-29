/*! Open Historia — desktop app shell © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The desktop app used to be a .bat file: it made the player install Node, ran
// `npm install`, built the client with Vite ON THEIR MACHINE, and left a console
// window open for the whole session. This replaces all of that. The client is
// already built when it ships, the server runs inside this process, and the game
// gets a real window — no terminal, nothing to keep open.
//
// CommonJS on purpose: package.json is `"type": "module"`, so a .js file here
// would be ESM, and Electron's main process is most predictable as CJS. The
// server is ESM and is pulled in with a dynamic import().

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, MenuItem } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");
const {
  claimSharedLibrary: claimLibrary,
  releaseSharedLibrary: releaseLibrary,
} = require("./libraryLock.cjs");

// Which build this is. scripts/stamp-channel.mjs writes electron/channel.json for
// the SeventhDread beta build (`npm run dist:win:beta` and the release workflow);
// the stable build ships no such file, reads "stable", and every branch below is
// the behaviour it has always had. OH_CHANNEL overrides it for `npm run electron`,
// which is the only way to exercise the beta paths unpackaged.
const CHANNEL = (() => {
  if (process.env.OH_CHANNEL) return String(process.env.OH_CHANNEL);
  try {
    const stamp = fs.readFileSync(path.join(__dirname, "channel.json"), "utf8");
    return String(JSON.parse(stamp).channel || "stable");
  } catch {
    return "stable"; // no stamp: the stable build, or a dev run
  }
})();
const IS_BETA = CHANNEL === "beta";
// One name for the beta: its Chromium profile, its window title and the
// shared-library lock, matching the Start Menu shortcut the installer creates
// (electron-builder.beta.yml `nsis.shortcutName`). The installer's `productName`
// drops the parentheses because they would push the install folder onto a fallback
// name — see the comment there; the two are allowed to differ because nothing
// derives one from the other.
const BETA_APP_NAME = "Open Historia (SeventhDread Beta)";

// Electron derives userData — the Chromium profile, and with it the
// single-instance lock — from the app name, which for both builds is package.json's
// "name" (%APPDATA%/open-historia). Two builds sharing that profile cannot run
// independently: whichever starts second sees the first's lock and quits without a
// window, which reads as "the beta is broken". Renaming the beta's profile is the
// fix, and it has to happen here, before anything reads a path: the installer's
// productName does NOT reach Electron (it only names the exe and the shortcut).
//
// This moves ONLY Chromium's own state. Saves, scenarios, settings and the map
// live under USER_ROOT below, which is deliberately the stable app's folder.
if (IS_BETA) app.setName(BETA_APP_NAME);

// Where a beta build looks for ITS updates and sends ITS feedback. The repo is now
// the same one the stable app is released from — what keeps the two apart is the
// TAG. server.js defaults the desktop track to .../desktop-stable/latest.json, so
// without this override a tester would be offered the official installer as an
// "update" and quietly leave the build they signed up to test. The tag is fixed on
// purpose: it is baked into every shipped build, so the release workflow must keep
// publishing to it rather than to a per-build tag.
//
// This is HALF of the beta's update story, and the halves must not drift apart.
// This URL is what makes the banner APPEAR: server.js fetches it and the page
// compares its build id against OH_DESKTOP_BUILD. What then INSTALLS the update is
// electron-updater, which ignores this entirely and reads the app-update.yml
// packed into the build from `publish` in electron-builder.beta.yml. That block
// names the same tag as this line, and has to: point them at different tags and a
// tester is told an update exists by one feed while the other cannot find it.
// AUTO_UPDATE_SUPPORTED below therefore needs no beta case — every build looks
// only at the feed it was packaged with.
const BETA_UPDATE_MANIFEST =
  "https://github.com/Open-Historia/open-historia/releases/download/desktop-seventhdread-beta/latest.json";
const BETA_FEEDBACK_URL = "https://github.com/Open-Historia/open-historia/issues";

// Everything the app writes lives under Electron's per-user data directory.
// Program Files is read-only for a normal user and the app bundle is read-only
// full stop, so nothing may be written next to the code (see server/dataDir.js).
//
// The directory is named after the STABLE app rather than after whichever build
// is running. For the stable app that is what getPath("userData") already
// returns, so nothing moves; for the beta (renamed just above, so its own
// userData) it means both builds open ONE library — one set of saves, one copy
// of the ~200MB map, one set of AI keys — and a player can go back to the stable
// app mid-campaign. Chromium's own per-build state stays in getPath("userData")
// and is deliberately not shared. Unpackaged runs keep using userData, so a dev
// build cannot scribble on a real install's library.
//
// The literal name is "open-historia", NOT the "Open Historia" the installer
// shows: that folder is Electron's default from package.json's `name`, and it is
// where the saves on every existing install already live. Getting this string
// wrong fails silently — it opens an empty library rather than erroring — so it
// is checked against a real install, never assumed.
const SHARED_LIBRARY_NAME = "open-historia";
const USER_ROOT = app.isPackaged
  ? path.join(app.getPath("appData"), SHARED_LIBRARY_NAME)
  : app.getPath("userData");
const DATA_DIR = path.join(USER_ROOT, "server", "data");
const ASSETS_DIR = path.join(USER_ROOT, "public", "assets");

// Sharing one library means two builds must never write it at once — see
// libraryLock.cjs, which holds the whole rule (and is a separate file so it can be
// tested; this one requires electron and `node --test` cannot load it).
const LOCK_FILE = path.join(USER_ROOT, "library-lock.json");
const LOCK_LABEL = IS_BETA ? BETA_APP_NAME : "Open Historia";

// Returns false if the player chose to quit rather than share the library.
const claimSharedLibrary = () =>
  claimLibrary(LOCK_FILE, {
    label: LOCK_LABEL,
    ask: (holder) =>
      dialog.showMessageBoxSync({
        type: "warning",
        title: `${LOCK_LABEL} — saves in use`,
        message: `${holder} is already running.`,
        detail:
          `${LOCK_LABEL} shares its saves, scenarios and settings with it, and two ` +
          "copies writing at once can lose a turn or corrupt a save. Close the " +
          "other one first.",
        buttons: ["Quit", "Start anyway"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }) === 1,
  });

const releaseSharedLibrary = () => releaseLibrary(LOCK_FILE);

// Read by server.js. A stable build sets neither, and server.js keeps its own
// upstream defaults; only the beta redirects its update check at its own release.
process.env.OH_CHANNEL = CHANNEL;
if (IS_BETA) {
  process.env.OH_DESKTOP_UPDATE_URL = BETA_UPDATE_MANIFEST;
  process.env.OH_FORK_FEEDBACK_URL = BETA_FEEDBACK_URL;
  // The BETA-badged artwork the server serves in place of the compass. Inside the
  // asar, which is fine: express only reads these.
  process.env.OH_BETA_ASSETS_DIR = path.join(__dirname, "beta-assets");
}

// The map manifest lists paths relative to a project root ("public/assets/...",
// "server/data/scenarios/..."), so pointing the fetcher's cwd at USER_ROOT lands
// every file exactly where DATA_DIR and ASSETS_DIR already expect it — no
// changes to the fetcher, and one place that decides the layout.
process.env.OH_DATA_DIR = DATA_DIR;
process.env.OH_ASSETS_DIR = ASSETS_DIR;

// The build id the release workflow stamped in. The server passes it to the page so
// the update banner can compare it against the published one. Deliberately routed
// this way rather than through a preload: attaching a preload to the game window is
// what broke the app last time, and this adds nothing to how the window is created.
try {
  process.env.OH_DESKTOP_BUILD = String(
    JSON.parse(fs.readFileSync(path.join(__dirname, "build-id.json"), "utf8")).build || "",
  );
} catch {
  /* dev build: unstamped, so no update is ever offered */
}

// --- automatic updates ------------------------------------------------------

// The app used to answer "a new version exists" by opening the installer's
// download URL in the player's browser and leaving them to run it. It now
// downloads and applies the update itself; the download link stays only as the
// fallback for the cases below.
//
// This is reachable from the page WITHOUT a preload and without IPC, because
// startServer() imports server.js into THIS process — the Express routes and the
// updater are the same process, so the server can call straight into it through
// the handle published on globalThis at the bottom of this block. That matters:
// attaching a preload to the game window is what broke the app last time.
//
// macOS is excluded. Squirrel.Mac validates the running app's code signature
// before applying anything, and the release workflow builds unsigned
// (CSC_IDENTITY_AUTO_DISCOVERY: false) because there is no Developer ID
// certificate yet. Attempting it there produces an error and nothing else, so mac
// keeps the manual download until there is a certificate to sign with.
const AUTO_UPDATE_SUPPORTED = process.platform !== "darwin";

// What the banner polls. One object, replaced rather than mutated, so a read is
// always internally consistent.
let updateState = { state: "idle", percent: 0, version: "", error: "" };
const setUpdateState = (patch) => { updateState = { ...updateState, ...patch }; };

const setupAutoUpdater = () => {
  // A dev run has no app-update.yml inside it, so electron-updater would only
  // ever error; an unpackaged app also cannot be replaced by an installer.
  if (!AUTO_UPDATE_SUPPORTED || !app.isPackaged) return null;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return null; // not packaged with the app: fall back to the download link
  }
  // The banner decides when to download — a player on a metered connection
  // should not have ~100MB pulled out from under them by opening the game.
  autoUpdater.autoDownload = false;
  // If they download but never press Restart, it installs on the next quit
  // instead of being thrown away.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setUpdateState({ state: "checking", error: "" }));
  autoUpdater.on("update-available", (info) => setUpdateState({ state: "available", percent: 0, version: String(info?.version || ""), error: "" }));
  autoUpdater.on("update-not-available", () => setUpdateState({ state: "none", percent: 0 }));
  autoUpdater.on("download-progress", (progress) => setUpdateState({ state: "downloading", percent: Math.max(0, Math.min(100, Math.round(progress?.percent || 0))) }));
  autoUpdater.on("update-downloaded", (info) => setUpdateState({ state: "ready", percent: 100, version: String(info?.version || ""), error: "" }));
  // Every failure lands here — no signature, no latest.yml, offline mid-download.
  // The banner reads it and offers the installer download instead, so a broken
  // updater degrades to exactly the behaviour this replaced.
  autoUpdater.on("error", (error) => setUpdateState({ state: "error", error: String(error?.message || error || "Update failed.") }));
  return autoUpdater;
};

// Published on globalThis for server.js, which is imported into THIS process and
// serves /api/app-update/{status,download,restart} straight off it. Called from
// boot() before the server starts, so the routes are never live without it.
const installAutoUpdater = () => {
  const autoUpdater = setupAutoUpdater();
  if (!autoUpdater) return;
  globalThis.__ohAutoUpdate = {
    status: () => updateState,
    download: () => {
      // checkForUpdates has to have run first — downloadUpdate with nothing found
      // rejects. Chaining them here means the page needs one call, not two.
      setUpdateState({ state: "checking", error: "" });
      autoUpdater
        .checkForUpdates()
        .then((result) => (result?.updateInfo ? autoUpdater.downloadUpdate() : null))
        .catch((error) => setUpdateState({ state: "error", error: String(error?.message || error) }));
    },
    // isSilent: the whole point is that the player does not meet an installer.
    // The NSIS build is assisted (oneClick: false) and per-user (perMachine:
    // false), so a silent update rewrites the existing install with no wizard and
    // no elevation prompt. isForceRunAfter reopens the game once it is done.
    //
    // Deferred: the HTTP response for this request still has to be written, and
    // quitAndInstall tears the process down immediately.
    restart: () => { setTimeout(() => autoUpdater.quitAndInstall(true, true), 400); },
  };
};

const APP_ROOT = path.join(__dirname, "..");
// asarUnpack keeps scripts/ outside the archive so a child process can run it.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const FETCH_SCRIPT = unpacked(path.join(APP_ROOT, "scripts", "fetch-map-assets.mjs"));
const MANIFEST = path.join(APP_ROOT, "scripts", "map-assets.json");

let mainWindow = null;
let setupWindow = null;

// --- map data ---------------------------------------------------------------

// Which manifest entries are still missing or the wrong size. Cheap (a stat per
// file) and it is what decides whether the setup screen is shown at all, so a
// second launch goes straight into the game.
//
// Size is NOT an integrity check — it only answers "is the download finished".
// A file of the right length whose contents are not the map we published passes
// this and would then be used forever, because nothing downstream looked again.
// verifyMapData() below closes that: it runs the fetcher's --ensure pass after
// the window is up, which checks the SHA-256 of anything it has not already
// verified and quietly re-downloads what doesn't match.
const missingAssets = () => {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return []; // no manifest is not a reason to block the player
  }
  return (manifest.assets ?? []).filter((asset) => {
    try {
      return fs.statSync(path.join(USER_ROOT, asset.path)).size !== asset.bytes;
    } catch {
      return true;
    }
  });
};

// Runs the existing fetcher as a child process and turns its --progress lines
// into window progress. ELECTRON_RUN_AS_NODE makes our own binary behave as
// plain Node, so the player never needs Node installed.
const downloadMapData = (onProgress) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [FETCH_SCRIPT, "--ensure", "--progress"], {
      cwd: USER_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("@progress ")) continue;
        try {
          onProgress(JSON.parse(line.slice("@progress ".length)));
        } catch {
          /* a malformed progress line is not worth failing a download over */
        }
      }
    });
    // Never rejects: a failed download must still let the player into the game
    // (the fetcher leaves any existing file in place and warns).
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });

// Verify the map data against the manifest's checksums in the background, after
// the game is already on screen. The fetcher remembers what it has verified, so
// this is a handful of stats on a normal launch and a re-hash only when a file
// changed underneath us. Deliberately silent and non-blocking: the player never
// waits on it, and a repair looks like the same best-effort download the setup
// screen does.
const verifyMapData = () => {
  const child = spawn(process.execPath, [FETCH_SCRIPT, "--ensure"], {
    cwd: USER_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => console.warn(`[map-verify] ${String(chunk).trim()}`));
  child.on("error", () => {});
};

// --- windows ----------------------------------------------------------------

const createSetupWindow = () =>
  new BrowserWindow({
    width: 560,
    height: 320,
    resizable: false,
    // No menu bar, no dev chrome — this is a setup dialog, not a browser.
    autoHideMenuBar: true,
    backgroundColor: "#0d1122",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });

// Electron builds NO context menu on its own — a right-click just does
// nothing, in an editable field or not. Chrome's spellchecker (spellcheck:
// true, the default, made explicit below) still runs and underlines
// misspellings, but with no menu there is nowhere to pick a suggested
// correction, let alone cut/copy/paste. This is the standard fix: build one
// from `params` on every "context-menu" event. Suggestions/dictionary first
// (only when the click actually landed on a misspelled word), then the usual
// edit actions — each one only offered when `editFlags` says it applies, so
// e.g. a right-click on plain, non-editable text doesn't offer "Paste".
const attachEditingContextMenu = (win) => {
  win.webContents.on("context-menu", (_event, params) => {
    const menu = new Menu();
    const { editFlags, dictionarySuggestions, misspelledWord } = params;

    if (misspelledWord) {
      if (dictionarySuggestions.length === 0) {
        menu.append(new MenuItem({ label: "No spelling suggestions", enabled: false }));
      } else {
        for (const suggestion of dictionarySuggestions) {
          menu.append(new MenuItem({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion),
          }));
        }
      }
      menu.append(new MenuItem({
        label: "Add to dictionary",
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(misspelledWord),
      }));
      menu.append(new MenuItem({ type: "separator" }));
    }

    if (editFlags.canUndo) menu.append(new MenuItem({ label: "Undo", role: "undo" }));
    if (editFlags.canRedo) menu.append(new MenuItem({ label: "Redo", role: "redo" }));
    if (editFlags.canUndo || editFlags.canRedo) menu.append(new MenuItem({ type: "separator" }));

    if (editFlags.canCut) menu.append(new MenuItem({ label: "Cut", role: "cut" }));
    if (editFlags.canCopy) menu.append(new MenuItem({ label: "Copy", role: "copy" }));
    if (editFlags.canPaste) menu.append(new MenuItem({ label: "Paste", role: "paste" }));
    if (editFlags.canSelectAll) menu.append(new MenuItem({ label: "Select All", role: "selectAll" }));

    // Right-clicking blank space with nothing selected/editable earns none of
    // the above — popping up an empty menu would just be a dead flash. Pinned
    // to `win` explicitly rather than relying on popup()'s "focused window"
    // default, which is one assumption fewer to hold if a second window is
    // ever added.
    if (menu.items.length > 0) menu.popup({ window: win });
  });
};

const createMainWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#0d1122",
    show: false,
    // The beta says so in the one place a player always sees, even after they
    // have both builds pinned to the taskbar and forgotten which is which.
    title: IS_BETA ? `${BETA_APP_NAME} — beta build` : "Open Historia",
    // Explicit even though it's already Electron's default — the whole reason
    // this window needs a context menu at all is to surface what this enables.
    webPreferences: { spellcheck: true },
  });
  // Links to GitHub/Discord open in the real browser rather than replacing the
  // game with a page the player cannot navigate back from.
  //
  // Only http(s) and mailto get out. shell.openExternal hands whatever it is
  // given to the OS, which will happily act on schemes that are not "a link":
  // file: opens a local file in its registered application, smb:/\\host leaks a
  // Windows credential hash to a remote server, and any app-registered handler
  // is fair game. The page renders AI output and community text, so what reaches
  // here is not always something the player wrote.
  const openableExternally = (target) => {
    try {
      return ["https:", "http:", "mailto:"].includes(new URL(target).protocol);
    } catch {
      return false;
    }
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (openableExternally(url)) shell.openExternal(url);
    else console.warn(`[shell] refused to open ${url} externally`);
    return { action: "deny" };
  });

  // Keep the game IN the game window. This window has no address bar, no back
  // button and an auto-hidden menu, so a link that navigates it away strands the
  // player on a page they cannot leave — and hands anything that can render a
  // link a full-window canvas to imitate the app on. Same-origin navigation (the
  // local server the app itself serves) is the app working normally; anything
  // else is a link, and links open in the real browser.
  win.webContents.on("will-navigate", (event, targetUrl) => {
    const appOrigin = `http://localhost:${process.env.PORT || 3000}`;
    if (targetUrl.startsWith(`${appOrigin}/`) || targetUrl === appOrigin) return;
    event.preventDefault();
    if (openableExternally(targetUrl)) shell.openExternal(targetUrl);
  });
  attachEditingContextMenu(win);
  // The page carries its own <title>, and Chromium hands that to the window the
  // moment it loads — which would quietly undo the Beta title above. Refusing the
  // update keeps the taskbar entry honest for the whole session.
  if (IS_BETA) win.on("page-title-updated", (event) => event.preventDefault());
  win.once("ready-to-show", () => win.show());
  return win;
};

// --- boot -------------------------------------------------------------------

// Find a port nothing else holds, starting at `start`. requestSingleInstanceLock
// already stops US from double-binding, but it cannot help when something else
// owns the port — Docker publishing 3000, another dev server, Grafana. Then
// server.js's app.listen() fails and the failure reaches the main process as an
// uncaught exception: the raw "A JavaScript error occurred in the main process"
// dialog, with no hint that a port is the problem. server.js DOES have a friendly
// EADDRINUSE handler, but it attaches to the returned server on the line AFTER
// listen(), which is too late if listen() throws synchronously rather than
// emitting. Probing first sidesteps the whole question: by the time server.js
// runs, the port it is about to take is known free.
const findFreePort = (start, attempts = 20) =>
  new Promise((resolve, reject) => {
    if (attempts <= 0) {
      reject(new Error(`No free port found in ${start - 20}-${start}.`));
      return;
    }
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(findFreePort(start + 1, attempts - 1)));
    probe.once("listening", () => probe.close(() => resolve(start)));
    // Bind the wildcard, not 127.0.0.1. server.js now binds loopback by default
    // (OH_HOST), but a player can point it at every interface, and a loopback-only
    // probe would call a port free that a 0.0.0.0 publisher (Docker's default)
    // already owns — exactly the case this exists for. Probing wider than we bind
    // can only skip a port that would have worked, which costs nothing.
    probe.listen(start);
  });

// Starting the server is importing it: server.js calls app.listen() at module
// scope. It reads OH_DATA_DIR / OH_ASSETS_DIR / PORT, all set before the import.
const startServer = async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const requested = Number(process.env.PORT) || 3000;
  const port = await findFreePort(requested);
  if (port !== requested) {
    console.log(`Port ${requested} is in use — starting Open Historia on ${port} instead.`);
  }
  // Both server.js and the loadURL below read this, so they cannot disagree.
  process.env.PORT = String(port);
  await import(`file://${path.join(APP_ROOT, "server", "server.js").replace(/\\/g, "/")}`);
};

const boot = async () => {
  installAutoUpdater();
  const pending = missingAssets();
  if (pending.length) {
    setupWindow = createSetupWindow();
    await setupWindow.loadFile(path.join(__dirname, "setup.html"));
    setupWindow.show();
    const totalBytes = pending.reduce((sum, asset) => sum + asset.bytes, 0);
    let doneBytes = 0;
    let currentAsset = "";
    await downloadMapData(({ asset, received, total }) => {
      if (asset !== currentAsset) {
        if (currentAsset) doneBytes += pending.find((a) => a.asset === currentAsset)?.bytes ?? 0;
        currentAsset = asset;
      }
      setupWindow?.webContents.send("setup:progress", {
        asset,
        received: doneBytes + received,
        total: totalBytes,
        assetTotal: total,
      });
    });
    setupWindow?.webContents.send("setup:done");
  }

  await startServer();
  mainWindow = createMainWindow();
  const port = process.env.PORT || 3000;
  await mainWindow.loadURL(`http://localhost:${port}`);
  setupWindow?.close();
  setupWindow = null;
  // The game is up; now confirm the map on disk is still the map we shipped.
  verifyMapData();
};

// One instance only: a second launch would hit EADDRINUSE on the server port and
// die, which reads to the player as "the app is broken".
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("will-quit", releaseSharedLibrary);
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    // The other build may already own the shared library. Asking needs a window
    // toolkit, so it happens here rather than at module scope, and it happens
    // BEFORE boot: answering "Quit" ends the launch with nothing started.
    if (!claimSharedLibrary()) {
      app.quit();
      return undefined;
    }
    return boot();
  });
  app.on("window-all-closed", () => app.quit());
  ipcMain.handle("setup:cancel", () => app.quit());
}
