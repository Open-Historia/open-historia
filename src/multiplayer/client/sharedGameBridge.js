/*! Open Historia — what the game's screens need of a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's own panels (orders, diplomacy, the time controls) ask two things
// of a shared game: is this page playing one (its documents are then the host's
// view, client/remoteRuntime.js), and how does a change reach the host. This
// answers both without loading any of the multiplayer code: sharedGame.js
// registers the request function when a shared game opens.

import { remoteRuntimeActive } from "./remoteRuntime.js";

let requester = null;

export const inSharedGame = () => remoteRuntimeActive();

export const setSharedRequester = (request) => {
  requester = typeof request === "function" ? request : null;
};

// { ok, error }; never rejects.
export const requestFromHost = (t, fields = {}) => (requester
  ? requester(t, fields)
  : Promise.resolve({ ok: false, error: "Not in a shared game." }));
