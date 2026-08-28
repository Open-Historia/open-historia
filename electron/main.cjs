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

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");

// Everything the app writes lives under Electron's per-user data directory.
// Program Files is read-only for a normal user and the app bundle is read-only
// full stop, so nothing may be written next to the code (see server/dataDir.js).
const USER_ROOT = app.getPath("userData");
const DATA_DIR = path.join(USER_ROOT, "server", "data");
const ASSETS_DIR = path.join(USER_ROOT, "public", "assets");

// The map manifest lists paths relative to a project root ("public/assets/...",
// "server/data/scenarios/..."), so pointing the fetcher's cwd at USER_ROOT lands
// every file exactly where DATA_DIR and ASSETS_DIR already expect it — no
// changes to the fetcher, and one place that decides the layout.
process.env.OH_DATA_DIR = DATA_DIR;
process.env.OH_ASSETS_DIR = ASSETS_DIR;

// Main-process crashes are the ones that reach the player as a bare "A
// JavaScript error occurred in the main process" dialog with nothing to act on —
// the EADDRINUSE port clash was exactly that. They also happen BEFORE the server
// exists, so this writes the same JSONL directly rather than POSTing to /api/log
// like the page does. Same file, same shape; logStore.js owns rotation and
// redaction for everything written later.
const LOG_FILE = path.join(DATA_DIR, "logs", "app.log");
const logMain = (level, event, message, data) => {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify({
      at: new Date().toISOString(),
      level,
      source: "main",
      event,
      message: String(message ?? "").slice(0, 8000),
      ...(data === undefined ? {} : { data }),
    }) + "\n", "utf8");
  } catch {
    // Diagnostics must never become the failure they were meant to explain.
  }
};

process.on("uncaughtException", (error) => {
  logMain("error", "main.uncaughtException", error && error.message, {
    stack: error && error.stack ? String(error.stack).slice(0, 8000) : undefined,
    code: error && error.code,
  });
});
process.on("unhandledRejection", (reason) => {
  logMain("error", "main.unhandledRejection", reason && (reason.message || String(reason)), {
    stack: reason && reason.stack ? String(reason.stack).slice(0, 8000) : undefined,
  });
});

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

const createMainWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#0d1122",
    show: false,
    title: "Open Historia",
  });
  // Links to GitHub/Discord open in the real browser rather than replacing the
  // game with a page the player cannot navigate back from.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
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
    // Bind the wildcard, not 127.0.0.1: server.js listens on every interface, so
    // a loopback-only probe would call a port free that a 0.0.0.0 publisher
    // (Docker's default) already owns — exactly the case this exists for.
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
    logMain("warn", "server.portInUse", `Port ${requested} is in use; using ${port} instead.`);
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
};

// One instance only: a second launch would hit EADDRINUSE on the server port and
// die, which reads to the player as "the app is broken".
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot);
  app.on("window-all-closed", () => app.quit());
  ipcMain.handle("setup:cancel", () => app.quit());
}
