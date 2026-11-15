/*! Open Historia — what a shared game's documents add up to © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A view is checked, not trusted to have arrived (host/gameHost.js pushViews,
// client/remoteRuntime.js check): with every view the host sends a digest of
// each document as the player is to hold it after that view, and the page
// shows a view only when what it would then hold adds up to the same. A view
// lost on the way, two views crossed, or a page that missed one while it
// reconnected is found by the next view, and the page asks for the whole of it
// again. Before, a guest who reconnected ignored every view after it (the
// host counted from zero again and the page wanted a higher number) and played
// on in a frozen world that looked live.
//
// The digest is of a document's JSON text, which both ends write the same way:
// the page's copy is the host's text parsed, and JSON in and out again is the
// same text. It guards against loss, not forgery: the channel is encrypted and
// tied to the host's key (session/), so nobody between can change a view.
//
// Import-free: the host's engine, every page and node tests use the same code.

// cyrb53 (public domain): 53 bits, quick over megabytes of text.
export const digestText = (text) => {
  const value = String(text ?? "");
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

// A document the player holds, or null for one it does not.
export const digestDoc = (value) => digestText(JSON.stringify(value ?? null));

// The digest of a document nobody holds.
export const EMPTY_DIGEST = digestText("null");
