/*! Open Historia — what a shared game's switched-off features refuse: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/featureGates.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { GATED_REQUESTS, featureRefusal } from "./featureGates.js";
import { PLAYER_REQUEST_NAMES } from "../game/messages.js";
import { resolveFeatures } from "../../runtime/gameFeatures.js";

const off = (overrides) => resolveFeatures(null, overrides);

// The gap audit of 2026-11-18: only Rostra's posts, the war room's transports and the air strikes read a switch on
// the host; an agent was placed in a game with no espionage, a fleet sailed in one with no navies.
test("a request for what the host's game has switched off is refused with the host's reason", () => {
  const all = resolveFeatures(null, null);
  for (const t of GATED_REQUESTS) assert.equal(featureRefusal({ t, type: "naval" }, all), "", `${t} is taken while everything is on`);
  assert.equal(featureRefusal({ t: "agent", op: "deploy" }, off({ espionage: { enabled: false } })), "This game has no espionage.");
  const noNavies = off({ fronts: { navies: false } });
  assert.equal(featureRefusal({ t: "fleet" }, noNavies), "This game has no navies.");
  assert.equal(featureRefusal({ t: "deploy", type: "naval" }, noNavies), "This game has no navies.");
  assert.equal(featureRefusal({ t: "deploy", type: "infantry" }, noNavies), "", "a land formation is raised as ever");
  const noAir = off({ fronts: { air: false } });
  assert.equal(featureRefusal({ t: "airstrike" }, noAir), "This game has no air units.");
  assert.equal(featureRefusal({ t: "deploy", type: "air" }, noAir), "This game has no air units.");
  assert.equal(featureRefusal({ t: "warroom" }, off({ fronts: { battlefields: false } })), "This game has no battlefields.");
  assert.equal(featureRefusal({ t: "post" }, off({ socialMedia: { enabled: false } })), "This game has no social media.");
  // What no feature decides is never refused here; nor anything by a host that states no features.
  assert.equal(featureRefusal({ t: "order" }, off({ espionage: { enabled: false } })), "");
  assert.equal(featureRefusal({ t: "agent" }, null), "");
});

test("every gated request is one a player can send", () => {
  for (const t of GATED_REQUESTS) assert.ok(PLAYER_REQUEST_NAMES.includes(t), t);
});
