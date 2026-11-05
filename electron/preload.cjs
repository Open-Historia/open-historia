/*! Open Historia — setup-window preload bridge © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The setup window shows an update installing as the game opens, with a button
// to open the game now instead, then the map download and, when files are still
// missing afterwards, a choice to try again or go on without the map — so it gets
// the narrowest possible bridge: four listeners in, four actions out (the last
// opens the beta's download in the player's browser). Context
// isolation stays on (the default) — the page never sees ipcRenderer itself.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ohSetup", {
  onProgress: (fn) => ipcRenderer.on("setup:progress", (_event, payload) => fn(payload)),
  onDone: (fn) => ipcRenderer.on("setup:done", () => fn()),
  onFailed: (fn) => ipcRenderer.on("setup:failed", (_event, payload) => fn(payload)),
  onUpdate: (fn) => ipcRenderer.on("setup:update", (_event, payload) => fn(payload)),
  updateLater: () => ipcRenderer.invoke("setup:update-later"),
  openBeta: () => ipcRenderer.invoke("setup:open-beta"),
  choose: (choice) => ipcRenderer.invoke("setup:choice", choice === "retry" ? "retry" : "continue"),
  cancel: () => ipcRenderer.invoke("setup:cancel"),
});
