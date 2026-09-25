/*! Open Historia — what a file picker offers, per build © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a browser an input's accept list is a courtesy: it filters the picker to
// the files that make sense. Inside the Android app it did harm. Capacitor's
// chooser (BridgeWebChromeClient showFilePicker) turns a list into MIME types,
// dropping every extension Android cannot name, and the system picker then
// shows ONLY files of those types — the rest are not greyed out, they are not
// listed at all:
//   * ".pmtiles", ".shp", ".kml" name nothing, so a PMTiles basemap sitting in
//     Downloads never appeared in the Workshop's basemap upload (seen on
//     Android 15);
//   * a zip or JSON another app saved under application/x-zip-compressed,
//     application/octet-stream or text/plain was hidden from the library's
//     import, so a perfectly good export could not be picked.
// So inside the app every file is offered and the importer judges the bytes, as
// it does anyway. A list of images only keeps its filter: that is what puts the
// photo gallery in the picker, and every image type has a name.
import { nativeReady } from "./native/bridge.js";

const IMAGE_ENTRY = /^(image\/[\w.+*-]+|\.(avif|bmp|gif|jpe?g|png|svg|webp))$/i;

export const isImageOnlyAccept = (accept) => {
  const entries = String(accept ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 && entries.every((entry) => IMAGE_ENTRY.test(entry));
};

// The accept attribute to give an <input type="file">: the list as written in a
// browser or the desktop app, nothing (every file) inside the Android app unless
// the list is images only.
export const acceptFor = (accept, { native = nativeReady() } = {}) =>
  (native && !isImageOnlyAccept(accept) ? undefined : accept);
