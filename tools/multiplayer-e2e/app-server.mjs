/*! Open Historia — the end-to-end run's app server © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One of the end-to-end run's app servers: the game's own server
// (server/server.js, serving the built dist/) on a data folder of its own.
//   node app-server.mjs <dataDir> <port> [host]
// The map's tiles are read from OH_E2E_ASSETS when the run gives one (shared by
// both servers, read only), and the server leaves the player's Discord alone.
// "host" stands in for the desktop app's engine-window handle
// (electron/main.cjs): open() only says yes, and the run opens engine.html in
// a browser tab itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const [dataDir, port, role] = process.argv.slice(2);
fs.mkdirSync(dataDir, { recursive: true });
process.env.OH_DATA_DIR = dataDir;
process.env.OH_ASSETS_DIR = process.env.OH_E2E_ASSETS || path.join(dataDir, "assets");
// A test server is not the player at play: no "Playing Open Historia".
process.env.OH_DISCORD_PRESENCE = "0";
process.env.PORT = String(port);
if (role === "host") {
  let open = false;
  globalThis.__ohSharedGameEngine = {
    status: () => ({ open }),
    open: async () => {
      open = true;
      console.log("[e2e] engine window requested");
      return { open };
    },
    close: () => {
      open = false;
      console.log("[e2e] engine window closed");
      return { open };
    },
  };
}
await import(pathToFileURL(path.join(REPO, "server", "server.js")).href);
console.log(`[e2e] ${role || "guest"} server on ${port}`);
