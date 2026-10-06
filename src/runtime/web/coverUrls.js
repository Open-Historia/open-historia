/*! Open Historia — scenario and game covers as object URLs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The covers the website (and the Android app) keeps in IndexedDB, as URLs the
// library, the loading cover and the editor can show.
//
// Every listing of the scenarios or the games used to turn each cover's bytes
// into a base64 data: URL anew: several megabytes of string per cover per
// listing, and the library, the game's loading cover and the translator all
// list them while a game loads. On a phone that churned hundreds of MB in a
// few seconds, which is where iOS Safari killed the tab ("A problem repeatedly
// occurred"). Now each cover becomes one object URL over its bytes, made once
// per version of the record and handed out again; the previous one is revoked
// when the cover changes. Nothing stores these URLs: they are for showing
// only, and they end with the page.
//
// A cover is either its bytes ({ contentType, bytes }) or the marker a record
// keeps once its bytes live in the covers store ({ contentType, byteLength });
// both name the same version, so `known` can answer from the marker alone and
// the bytes are read only for a URL not made yet.

export const createCoverUrlCache = ({
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
} = {}) => {
  const byKey = new Map(); // "scenario:<id>" | "game:<id>" -> { token, url }
  const versionOf = (token, cover) =>
    `${token}|${cover.bytes?.byteLength ?? cover.byteLength ?? 0}|${cover.contentType || "application/octet-stream"}`;
  const urlFor = (key, token, cover) => {
    const known = byKey.get(key);
    if (!cover?.bytes) {
      if (known) {
        revokeObjectURL(known.url);
        byKey.delete(key);
      }
      return null;
    }
    const contentType = cover.contentType || "application/octet-stream";
    const version = versionOf(token, cover);
    if (known?.token === version) return known.url;
    if (known) revokeObjectURL(known.url);
    const url = createObjectURL(new Blob([cover.bytes], { type: contentType }));
    byKey.set(key, { token: version, url });
    return url;
  };
  // The URL already made for this version of the cover, or null.
  urlFor.known = (key, token, cover) => {
    const known = byKey.get(key);
    return cover && known?.token === versionOf(token, cover) ? known.url : null;
  };
  return urlFor;
};

export const coverObjectUrl = createCoverUrlCache();
