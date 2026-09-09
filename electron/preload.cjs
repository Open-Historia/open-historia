/*! Open Historia — setup-window preload bridge © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The setup window shows download progress and nothing else, so it gets the
// narrowest possible bridge: two listeners in, one action out. Context isolation
// stays on (the default) — the page never sees ipcRenderer itself.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ohSetup", {
  onProgress: (fn) => ipcRenderer.on("setup:progress", (_event, payload) => fn(payload)),
  onDone: (fn) => ipcRenderer.on("setup:done", () => fn()),
  cancel: () => ipcRenderer.invoke("setup:cancel"),
});
