/*! Open Historia — a player's shared game, served from the host's view © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game the documents a player's screen reads are not this device's:
// they are the player's VIEW, sent by the host (host/projection.js), holding
// only what that player may know. Every screen reads its documents through one
// URL family, /api/runtime/json/<key> (runtime/assets.js), so this answers
// those reads from the view while a shared game is on. A new view reaches every
// cache and listener through publishJsonWriteBatch, the same door a finished
// turn comes through.
//
// A write to one of them never reaches the host's game as it is: a player asks
// the host for a change (game/messages.js). The game's screens save by writing
// a whole document, though, so a write is not an error either. It is handed to
// `onWrite`, which reads it for what a player's own screen may change
// (client/seatWrites.js) and asks the host or keeps it on this device, and the
// page is answered with the document it now holds: the host's view, with what
// is this device's own laid over it (`patch`). Everything else the write would
// have changed is simply not there.
//
// What stays this device's own: the map's files (from a local copy of the same
// scenario: the stand-in game this device opens for the shared one), the
// library, the settings, and the advisor's conversation, which is the player's
// private exchange with their own adviser on their own AI key.
//
// Installed once at start-up in every build, after the website's own /api
// router (runtime/web/router.js) so it sees each request first. It does nothing
// until a shared game begins, and single player never notices it.

// Documents that come from the host. The first five are the game itself: a
// screen that asks for one before the first view arrives waits for it.
export const VIEW_KEYS = Object.freeze(["world", "game", "events", "chat", "actions", "intercepts", "colors", "flags"]);
const REQUIRED_KEYS = new Set(["world", "game", "events", "chat", "actions"]);
const VIEW_KEY_SET = new Set(VIEW_KEYS);
// The rollback archive is the host's; a player has none.
const HOST_ONLY_KEYS = new Set(["snapshots", "snapshotsIndex"]);

let installed = false;
let current = null;

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const refusal = (message) => jsonResponse({ error: message }, 409);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A document as the page holds it: the host's view, with this device's own
// fields laid over it.
const heldDoc = (session, key) => {
  const view = session.docs.get(key);
  const own = session.patches.get(key);
  return own && isRecord(view) ? { ...view, ...own } : view;
};
const publishHeld = (session, keys) => {
  const entries = [];
  for (const key of keys) {
    const url = session.docs.has(key) ? session.urlFor?.(key) : "";
    if (url) entries.push({ url, value: heldDoc(session, key) });
  }
  if (entries.length) session.publish?.(entries);
};
// A save is answered with the document the page holds, and the page's caches
// then tell every screen the document changed. A screen that saves whenever it
// finds something missing (which the host's view may never have) would save
// again at once, without end. Past this many saves of one document in this
// long, the next is turned away, which ends such a run like any failed save.
const SAVES_ALLOWED = 30;
const SAVES_WINDOW_MS = 5000;
const tooManySaves = (session, key, now) => {
  const recent = (session.saves.get(key) ?? []).filter((at) => now - at < SAVES_WINDOW_MS);
  recent.push(now);
  session.saves.set(key, recent);
  return recent.length > SAVES_ALLOWED;
};
const headerOf = (input, init, name) => {
  const headers = init?.headers ?? (typeof input === "object" ? input?.headers : null);
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) ?? "");
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? String(headers[found] ?? "") : "";
};

const bodyOf = async (input, init) => {
  try {
    const raw = init?.body ?? (typeof input === "object" && typeof input?.text === "function" ? await input.clone().text() : "");
    return typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

const waitForKey = (session, key, timeoutMs) => new Promise((resolve) => {
  if (session.docs.has(key)) return resolve(true);
  const timer = setTimeout(() => {
    session.waiters.delete(check);
    resolve(false);
  }, timeoutMs);
  const check = () => {
    if (!session.docs.has(key)) return false;
    clearTimeout(timer);
    resolve(true);
    return true;
  };
  session.waiters.add(check);
  return undefined;
});

export const installRemoteRuntime = ({ target = globalThis, waitMs = 20_000 } = {}) => {
  if (installed || typeof target?.fetch !== "function") return;
  installed = true;
  const originalFetch = target.fetch.bind(target);

  target.fetch = async (input, init) => {
    const session = current;
    if (!session) return originalFetch(input, init);
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input?.url ?? "", target.location?.href ?? "http://localhost/");
    } catch {
      return originalFetch(input, init);
    }
    if (target.location?.origin && url.origin !== target.location.origin) return originalFetch(input, init);
    const method = String(init?.method ?? (typeof input === "object" ? input?.method : "") ?? "GET").toUpperCase() || "GET";

    if (url.pathname === "/api/runtime/turn-commit") {
      return refusal("In a shared game, the host resolves every round.");
    }
    // One restore point, read on its own (runtime/assets.js loadRollbackSnapshot):
    // the host's, like the archive it comes from. It holds the whole world as it
    // was, which no player's screen is sent; a player has none.
    if (url.pathname.startsWith("/api/runtime/snapshots/")) {
      return jsonResponse({ error: "In a shared game, the restore points are the host's." }, 404);
    }
    const match = /^\/api\/runtime\/json\/([A-Za-z]+)$/.exec(url.pathname);
    if (!match) return originalFetch(input, init);
    const key = match[1];

    if (HOST_ONLY_KEYS.has(key)) {
      return method === "GET" || method === "HEAD" ? jsonResponse([]) : refusal("In a shared game, only the host can roll back.");
    }
    if (!VIEW_KEY_SET.has(key)) return originalFetch(input, init);

    if (method === "GET" || method === "HEAD") {
      if (!session.docs.has(key)) {
        if (!REQUIRED_KEYS.has(key)) return originalFetch(input, init);
        if (!(await waitForKey(session, key, waitMs))) return jsonResponse({ error: `The host has not sent ${key} yet.` }, 503);
      }
      return jsonResponse(heldDoc(session, key));
    }
    if (!session.docs.has(key)) return refusal("In a shared game, changes go to the host as requests; this one was not sent.");
    if (tooManySaves(session, key, Date.now())) return refusal("In a shared game, changes go to the host as requests; this one was repeated too fast and was not read.");
    // What of the write is this player's own to change is the hook's to say.
    // The page is answered with the document it now holds, as a store answers
    // a save with what it stored (runtime/assets.js writeJson caches that); the
    // hook may hand back that document in the shape the page's own writers
    // save it in, which is the shape their caches expect.
    let answer;
    try {
      answer = session.onWrite?.({ key, wanted: await bodyOf(input, init), held: heldDoc(session, key) });
    } catch {
      // a hook that fell over changes nothing: the page still holds its view
    }
    if (current !== session) return refusal("The shared game ended.");
    // A writer that asked for no echo caches what it sent, not this answer: it
    // is shown the document it holds once its own save has settled.
    if (/return=minimal/i.test(headerOf(input, init, "Prefer"))) {
      target.setTimeout?.(() => {
        if (current === session) publishHeld(session, [key]);
      }, 0);
    }
    return jsonResponse(answer === undefined ? heldDoc(session, key) : answer);
  };
};

// Begin serving a shared game. `publish` pushes documents into the page's
// caches (runtime/assets.js publishJsonWriteBatch) and `urlFor(key)` gives a
// document's current URL (JSON_URLS[key]); both are passed in so this module
// stays free of the page's runtime and testable on its own.
export const startRemoteRuntime = ({ publish, urlFor, onWrite } = {}) => {
  const session = { docs: new Map(), patches: new Map(), saves: new Map(), rev: -1, waiters: new Set(), publish, urlFor, onWrite };
  current = session;
  return {
    // A view from the host: only the documents that changed, whole. An older
    // view than the one already shown is ignored.
    apply({ rev, docs }) {
      if (current !== session || !(rev > session.rev) || !docs || typeof docs !== "object") return false;
      session.rev = rev;
      const arrived = [];
      for (const key of Object.keys(docs)) {
        if (!VIEW_KEY_SET.has(key)) continue;
        session.docs.set(key, docs[key]);
        arrived.push(key);
      }
      publishHeld(session, arrived);
      for (const check of [...session.waiters]) if (check()) session.waiters.delete(check);
      return true;
    },
    // This device's own fields of a document, laid over every view of it from
    // here on: `fields` are merged in, and one given as undefined is taken out
    // again. The page is shown the result unless `quiet` (a view is about to be
    // applied, which shows it).
    patch(key, fields, { quiet = false } = {}) {
      if (current !== session || !VIEW_KEY_SET.has(key) || !isRecord(fields)) return;
      const own = { ...(session.patches.get(key) ?? {}) };
      for (const [field, value] of Object.entries(fields)) {
        if (value === undefined) delete own[field];
        else own[field] = value;
      }
      if (Object.keys(own).length) session.patches.set(key, own);
      else session.patches.delete(key);
      if (!quiet) publishHeld(session, [key]);
    },
    // A document as the page holds it now.
    held: (key) => (current === session ? heldDoc(session, key) : undefined),
    has: (key) => current === session && session.docs.has(key),
    get rev() {
      return current === session ? session.rev : -1;
    },
  };
};

export const stopRemoteRuntime = () => {
  current = null;
};

export const remoteRuntimeActive = () => current !== null;
