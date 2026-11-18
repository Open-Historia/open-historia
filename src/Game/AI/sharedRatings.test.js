/*! Open Historia — countries' military figures in a shared game, asked of the host: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/sharedRatings.test.js
//
// A page playing a shared game rated no country's military figures, and its
// host only those at war after a round, so the Stats pane's ranking stayed
// empty (the gap audit of 2026-11-18). The page asks the host now, as it asks
// for a stat sheet (gameplayLazy.js ensureMilitaryFigures; the host's side is
// multiplayer/host/gameHost.js "ratings").

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { ensureMilitaryFigures } from "./gameplayLazy.js";
import { setSharedRequester } from "../../multiplayer/client/sharedGameBridge.js";
import { startRemoteRuntime, stopRemoteRuntime } from "../../multiplayer/client/remoteRuntime.js";
import { PLAYER_REQUESTS } from "../../multiplayer/game/messages.js";
import { validate } from "../../multiplayer/protocol/validate.js";

const inSharedGame = async (requester, run) => {
  setSharedRequester(requester);
  startRemoteRuntime({ publish: () => {}, urlFor: () => "" });
  try {
    return await run();
  } finally {
    stopRemoteRuntime();
    setSharedRequester(null);
  }
};

test("in a shared game the figures a pane wants are asked of the host, each country once, and nobody waits on the answer", async () => {
  const asked = [];
  const settled = await inSharedGame(async (t, fields) => {
    asked.push({ t, ...fields });
    return { ok: true, error: "" };
  }, () => ensureMilitaryFigures(["Aland", " Aland ", "Borduria", ""], { reason: "the military ranking" }));
  assert.equal(settled, null, "the host's AI rates them; they come with the next view");
  assert.deepEqual(asked, [{ t: "ratings", countries: ["Aland", "Borduria"] }]);
  assert.equal(validate(PLAYER_REQUESTS.ratings, { ...asked[0], id: "0".repeat(16) }).ok, true, "a request the host reads");
  // A host that refuses, or cannot be reached, leaves the pane as it was, quietly.
  assert.equal(await inSharedGame(async () => ({ ok: false, error: "Take a country first." }), () => ensureMilitaryFigures(["Aland"])), null);
  assert.equal(await inSharedGame(async () => { throw new Error("gone"); }, () => ensureMilitaryFigures(["Aland"])), null);
  let more = 0;
  assert.equal(await inSharedGame(async () => { more += 1; return { ok: true }; }, () => ensureMilitaryFigures([])), null);
  assert.equal(more, 0, "nothing to ask, nothing asked");
});

// The own-key path loads the game's own rating (gameplay.js), which node cannot: where its figures go is pinned from
// the source. They are sent to the host, never written on the page.
test("figures left to this device are rated as single player rates them and handed to the host", () => {
  const lazy = fs.readFileSync(new URL("./gameplayLazy.js", import.meta.url), "utf8").split("\r\n").join("\n");
  const own = lazy.slice(lazy.indexOf("const ratingsFromHost = async"), lazy.indexOf("export const ensureMilitaryFigures = "));
  assert.match(own, /answer\.result\?\.answer === "own"/);
  assert.match(own, /\(await gameplay\(\)\)\.ensureMilitaryFigures\(left, \{\n\s*\.\.\.options,\n\s*commit: async \(read\) => \{/);
  assert.match(own, /await requestFromHost\("ownRatings", \{ ratings \}\);/);
  const sent = { t: "ownRatings", id: "0".repeat(16), ratings: [{ country: "Aland", military: { quality: 55 }, population: 4.2e6 }, { country: "Borduria" }] };
  assert.equal(validate(PLAYER_REQUESTS.ownRatings, sent).ok, true);
});
