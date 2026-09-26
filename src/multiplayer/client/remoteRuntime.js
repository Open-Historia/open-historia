/*! Open Historia — a player's shared game, served from the host's view © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game the documents a player's screen reads are not this device's:
// they are the player's VIEW, sent by the host (host/projection.js), holding
// only what that player may know. Every screen reads its documents through one
// URL family, /api/runtime/json/<key> (runtime/assets.js), so this answers
// those reads from the view while a shared game is on, and turns away writes
// to them: a player asks the host for a change (game/messages.js), it never
// writes the host's game. A new view reaches every cache and listener through
// publishJsonWriteBatch, the same door a finished turn comes through.
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
      return jsonResponse(session.docs.get(key));
    }
    session.onRefusedWrite?.(key);
    return refusal("In a shared game, changes go to the host as requests; this one was not sent.");
  };
};

// Begin serving a shared game. `publish` pushes documents into the page's
// caches (runtime/assets.js publishJsonWriteBatch) and `urlFor(key)` gives a
// document's current URL (JSON_URLS[key]); both are passed in so this module
// stays free of the page's runtime and testable on its own.
export const startRemoteRuntime = ({ publish, urlFor, onRefusedWrite } = {}) => {
  current = { docs: new Map(), rev: -1, waiters: new Set(), publish, urlFor, onRefusedWrite };
  return {
    // A view from the host: only the documents that changed, whole. An older
    // view than the one already shown is ignored.
    apply({ rev, docs }) {
      const session = current;
      if (!session || !(rev > session.rev) || !docs || typeof docs !== "object") return false;
      session.rev = rev;
      const entries = [];
      for (const key of Object.keys(docs)) {
        if (!VIEW_KEY_SET.has(key)) continue;
        session.docs.set(key, docs[key]);
        const url = session.urlFor?.(key);
        if (url) entries.push({ url, value: docs[key] });
      }
      if (entries.length) session.publish?.(entries);
      for (const check of [...session.waiters]) if (check()) session.waiters.delete(check);
      return true;
    },
    has: (key) => Boolean(current?.docs.has(key)),
    get rev() {
      return current?.rev ?? -1;
    },
  };
};

export const stopRemoteRuntime = () => {
  current = null;
};

export const remoteRuntimeActive = () => current !== null;
