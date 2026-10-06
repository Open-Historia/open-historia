/*! Open Historia — what the game's screens need of a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's own panels (orders, diplomacy, the time controls) ask three things
// of a shared game: is this page playing one (its documents are then the host's
// view, client/remoteRuntime.js), is it the host or a guest, and how does a
// change reach the host. This answers them without loading any of the
// multiplayer code: sharedGame.js registers the role and the request function
// when a shared game opens.

import { remoteRuntimeActive } from "./remoteRuntime.js";

let requester = null;
let role = ""; // "host" | "guest" | "" (no shared game)
const roleListeners = new Set();

export const inSharedGame = () => remoteRuntimeActive();

// Said on the window when a round the host resolved has reached this page: its
// events are in the page's documents, none of them shown yet. The time controls
// open the Events panel on it, as they do on a time skip the page ran itself.
export const SHARED_ROUND_LANDED = "oh:shared-round-landed";

// A guest's rounds, replies and stat sheets are all the host's work, on the
// host's AI key; the role says which one this page is. For useSyncExternalStore.
export const sharedGameRole = () => role;
export const subscribeSharedGameRole = (listener) => {
  roleListeners.add(listener);
  return () => roleListeners.delete(listener);
};
export const setSharedGameRole = (next) => {
  const value = next === "host" || next === "guest" ? next : "";
  if (value === role) return;
  role = value;
  for (const listener of [...roleListeners]) listener();
};

export const setSharedRequester = (request) => {
  requester = typeof request === "function" ? request : null;
};

// { ok, error }; never rejects. `options.timeoutMs` for a request the host
// answers only once its own AI has (a stat sheet).
export const requestFromHost = (t, fields = {}, options = {}) => (requester
  ? requester(t, fields, options)
  : Promise.resolve({ ok: false, error: "Not in a shared game." }));
