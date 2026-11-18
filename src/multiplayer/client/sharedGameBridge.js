/*! Open Historia — what the game's screens need of a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's own panels (orders, diplomacy, the time controls) ask three things
// of a shared game: is this page playing one (its documents are then the host's
// view, client/remoteRuntime.js), is it the host or a guest, and how does a
// change reach the host. This answers them without loading any of the
// multiplayer code: sharedGame.js registers the role and the request function
// when a shared game opens.

import { remoteRuntimeActive } from "./remoteRuntime.js";
import { baseForRecord } from "./roundBase.js";

let requester = null;
let role = ""; // "host" | "guest" | "" (no shared game)
const roleListeners = new Set();

export const inSharedGame = () => remoteRuntimeActive();

// Said on the window when a round the host resolved has reached this page: its
// events are in the page's documents, none of them shown yet. The time controls
// open the Events panel on it, as they do on a time skip the page ran itself.
export const SHARED_ROUND_LANDED = "oh:shared-round-landed";

// The world this page held before the newest round landed (client/roundBase.js),
// which the Events panel replays the round's events on, one at a time, as it
// replays a skip single player ran (time.jsx, the staged reveal). Kept by
// sharedGame.js as the round lands; null for any turn but that round's.
let roundBase = null;
export const setSharedRoundBase = (base) => {
  roundBase = base ?? null;
};
export const sharedRoundBase = (record) => (remoteRuntimeActive() ? baseForRecord(roundBase, record) : null);

// The role says which one this page is: the host's screen or a guest's. For
// useSyncExternalStore.
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

// The countries people play in this shared game: the lobby's seats a person's
// device holds, whoever minds them now. A screen answers a country differently
// when a person plays it (a peace is put to them by name, and they answer it
// themselves). Empty in no shared game. For useSyncExternalStore, with the role's
// subscription.
const NOBODY = Object.freeze([]);
let people = NOBODY;
export const sharedGamePeople = () => people;
export const setSharedGamePeople = (names) => {
  const next = [...new Set((Array.isArray(names) ? names : []).map((name) => String(name ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (next.length === people.length && next.every((name, at) => name === people[at])) return;
  people = next.length ? Object.freeze(next) : NOBODY;
  for (const listener of [...roleListeners]) listener();
};
// How many days each round of this shared game moves the world (the lobby's
// settings, host/settings.js daysPerRound): the Timeline panel shows the round
// in place of the skip lengths, which no page of a shared game can run. 0 in no
// shared game. For useSyncExternalStore, with the role's subscription.
let roundDays = 0;
export const sharedRoundDays = () => roundDays;
export const setSharedRoundDays = (days) => {
  const next = Number.isFinite(Number(days)) && Number(days) >= 1 ? Math.trunc(Number(days)) : 0;
  if (next === roundDays) return;
  roundDays = next;
  for (const listener of [...roleListeners]) listener();
};

export const playedByPerson = (country) => {
  const key = String(country ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return Boolean(key) && people.some((name) => name.toLowerCase() === key);
};

// The rules of the shared game as the host's lobby states them (host/settings.js:
// who pays for what, the Game Master), for the screens that say them: null in no
// shared game. For useSyncExternalStore, with the role's subscription.
let rules = null;
export const sharedGameSettings = () => rules;
export const setSharedGameSettings = (settings) => {
  const next = settings && typeof settings === "object" ? settings : null;
  if (JSON.stringify(next) === JSON.stringify(rules)) return;
  rules = next ? Object.freeze({ ...next }) : null;
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
