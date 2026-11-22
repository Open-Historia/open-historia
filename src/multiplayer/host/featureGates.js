/*! Open Historia — what a shared game's switched-off features refuse © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host's game plays by its own feature switches (runtime/gameFeatures.js),
// stated in the lobby, and every player's screen plays by the host's: a guest's
// screen hides the Spy tab, the fleets or the air arm the host's game has off.
// The host itself took such a request all the same, though: an agent placed in
// a game with no espionage, a fleet sailed in one with no navies (the gap audit
// of 2026-11-18), which a changed page, or one a moment behind the lobby, could
// send. One rule per request, read here, before the request does anything, with
// the host's reason (the map's rule 10).
//
// Runtime-free: the features are the host's as its game resolves them.

import { isFeatureEnabled, warsOf } from "../../runtime/gameFeatures.js";

const NO_ESPIONAGE = "This game has no espionage.";
const NO_NAVIES = "This game has no navies.";
const NO_AIR = "This game has no air units.";
const NO_BATTLEFIELDS = "This game has no battlefields.";
const NO_SOCIAL_MEDIA = "This game has no social media.";

const clean = (value) => String(value ?? "").trim().toLowerCase();

// Each request a feature decides, and what it needs of the game's switches:
// the refusal, or "" when the request may go on.
const GATES = Object.freeze({
  agent: (features) => (isFeatureEnabled(features, "espionage") ? "" : NO_ESPIONAGE),
  fleet: (features) => (warsOf(features).navies ? "" : NO_NAVIES),
  airstrike: (features) => (warsOf(features).air ? "" : NO_AIR),
  // The war room is a battlefield's: with none, nothing is there to order.
  warroom: (features) => (warsOf(features).battlefields ? "" : NO_BATTLEFIELDS),
  post: (features) => (isFeatureEnabled(features, "socialMedia") ? "" : NO_SOCIAL_MEDIA),
  // A formation is raised of a kind the game fights with.
  deploy: (features, request) => {
    const type = clean(request?.type);
    if (type === "naval" && !warsOf(features).navies) return NO_NAVIES;
    if (type === "air" && !warsOf(features).air) return NO_AIR;
    return "";
  },
});

// The host's reason for refusing `request` in a game with these features, or
// "". A host that states no features (an older engine, a test) refuses nothing.
export const featureRefusal = (request, features) => {
  if (!features || typeof features !== "object") return "";
  const gate = GATES[request?.t];
  return gate ? gate(features, request) : "";
};

export const GATED_REQUESTS = Object.freeze(Object.keys(GATES));
