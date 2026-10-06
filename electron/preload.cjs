/*! Open Historia — setup-window preload bridge © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The setup window shows download progress and, when files are still missing
// afterwards, a choice to try again or go on without the map — so it gets the
// narrowest possible bridge: three listeners in, two actions out. Context
// isolation stays on (the default) — the page never sees ipcRenderer itself.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ohSetup", {
  onProgress: (fn) => ipcRenderer.on("setup:progress", (_event, payload) => fn(payload)),
  onDone: (fn) => ipcRenderer.on("setup:done", () => fn()),
  onFailed: (fn) => ipcRenderer.on("setup:failed", (_event, payload) => fn(payload)),
  choose: (choice) => ipcRenderer.invoke("setup:choice", choice === "retry" ? "retry" : "continue"),
  cancel: () => ipcRenderer.invoke("setup:cancel"),
});
