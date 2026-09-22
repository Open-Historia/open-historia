/*! Open Historia — writable data-dir resolver © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The single writable data root, shared by every server store (games, scenarios,
// basemaps, flags, map-editor docs, ui-settings, lang packs, hub cache, import
// pings). Defaults to server/data — the layout desktop and Termux have always
// used, so those builds are byte-identical.
//
// An EMBEDDED server — the desktop app runs server.js in-process under Electron —
// sets OH_DATA_DIR to a writable user-data path, because the server/data that
// ships inside the app archive is READ-ONLY. (The Android app has no server at
// all: its library is the web backend's IndexedDB; see docs/mobile.md.)
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.OH_DATA_DIR
  ? path.resolve(process.env.OH_DATA_DIR)
  : path.join(__dirname, "data");
