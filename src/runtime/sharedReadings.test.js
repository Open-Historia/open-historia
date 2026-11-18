/*! Open Historia — whose AI makes the readings a shared game makes by itself: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/sharedReadings.test.js
//
// After every round, and when a scenario's fronts were built, the engine of a
// shared game read figures on the host's AI whatever "replies" said (the
// review of 2026-11-18, cost 6 and wars 9). They follow the setting now.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { hostReadsFigures, readingEntry, setHostReadsFigures, setReadingsOrder } from "./sharedReadings.js";
import { createWorldQueue } from "../multiplayer/host/worldQueue.js";

const source = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").split("\r\n").join("\n");

test("the game's own readings are made on this device's AI unless the shared game it hosts leaves figures to each player's", () => {
  assert.equal(hostReadsFigures(), true, "single player, and every page, as ever");
  setHostReadsFigures(false);
  assert.equal(hostReadsFigures(), false);
  setHostReadsFigures(true);
  assert.equal(hostReadsFigures(), true);
});

// gameplay.js and the engine do not load in node: where the setting is read is pinned from the source.
test("the readings after a round, when fronts are built, and for an agent's target follow it; the engine sets it from the lobby", () => {
  const gameplay = source("../Game/AI/gameplay.js");
  const conflict = gameplay.slice(gameplay.indexOf("const requestConflictSheets = ("), gameplay.indexOf("const foldName = "));
  assert.match(conflict, /if \(!frontsOn\(\) \|\| !hostReadsFigures\(\)\) return;/, "conflict backends and the figures of those at war");
  assert.match(gameplay, /if \(entry\.op === "deploy" && hostReadsFigures\(\)\) void ensureCountryAssessed\(entry\.target/, "an agent's target");
  const engine = source("../multiplayer/host/engineMain.js");
  assert.match(engine, /setHostReadsFigures\(settings\.replies !== "own"\);\n\s*preparing = true;/, "before the game's start, its fronts' readings too");
  assert.match(engine, /setHostReadsFigures\(status\?\.lobby\?\.settings\?\.replies !== "own"\);/, "and as the host changes it");
  assert.match(engine, /setHostingSharedGame\(false\);\n\s*setWorldLanguage\(""\);\n\s*setHostReadsFigures\(true\);/, "and single player's again once sharing stops");
});

// FOLLOWUPS A6: with the host's AI answering, the engine's own readings wrote the world beside the host's one queue,
// between a player's request and the next (rule 2: every change to the world is one entry of it).
test("a reading's write is one entry of the host's order while the engine shares a game, held open until it ends; at once anywhere else", async () => {
  assert.equal(readingEntry("ratings"), null, "single player, every page, and the engine before and after sharing");
  // The engine's (engineMain.js): an entry of its queue, begun, hands back the function that ends it.
  const queue = createWorldQueue();
  const labels = [];
  setReadingsOrder((label) => new Promise((entered) => {
    labels.push(label);
    void queue.run(`reading:${label}`, () => new Promise((leave) => entered(leave)));
  }));
  try {
    const seen = [];
    let release;
    // A player's request is being applied when the reading comes back from the AI.
    void queue.run("order", () => new Promise((resolve) => { release = resolve; }).then(() => seen.push("order")));
    const reading = (async () => {
      const leave = await readingEntry("ratings");
      seen.push("reading");
      // Nothing else is applied while it writes.
      await new Promise((resolve) => setImmediate(resolve));
      seen.push("reading written");
      leave();
    })();
    void queue.run("post", async () => seen.push("post"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [], "it waits for the entry being applied");
    release();
    await reading;
    await queue.settled();
    assert.deepEqual(seen, ["order", "reading", "reading written", "post"], "its own entry, in the order it came, the next waiting for it");
    assert.deepEqual(labels, ["ratings"]);
  } finally {
    setReadingsOrder(null);
  }
  assert.equal(readingEntry("ratings"), null, "cleared once sharing stops");
});

// gameplay.js does not load in node: where each reading writes is pinned from the source.
test("every reading the game makes out of turn writes in the host's order; the host taking a device's reading writes in its own entry", () => {
  const gameplay = source("../Game/AI/gameplay.js");
  const between = (from, to) => gameplay.slice(gameplay.indexOf(from), gameplay.indexOf(to, gameplay.indexOf(from)));
  assert.match(between("export const ensureConflictBackends = ", "export const takeMilitaryRatings"), /beginStatsWrite\(campaign, null, \{ inOrder: "conflict-figures" \}\)[\s\S]*endSimulation\(\);\n\s*leave\(\);/);
  assert.match(between("export const ensureMilitaryFigures = ", "// `rateIntelligence`"), /takeMilitaryRatings\(read, \{ campaign, inOrder: "ratings" \}\)/, "the figures it rated by itself");
  assert.match(between("export const takeMilitaryRatings = ", "export const ensureMilitaryFigures = "), /beginStatsWrite\(campaign, null, \{ inOrder \}\)[\s\S]*endSimulation\(\);\n\s*leave\(\);/);
  for (const [from, to] of [["const generateScenarioCustomStatSheet = ", "// Structured national stat sheet"], ["export const generateCountryStatSheet = ", "export const refinePlayerAction = "]]) {
    const body = between(from, to);
    assert.equal((body.match(/await beginStatsWrite\(/g) ?? []).length, (body.match(/beginStatsWrite\(campaign, signal, \{ inOrder: "stat-sheet" \}\)/g) ?? []).length, from);
    assert.equal((body.match(/endSimulation\(\);\n\s*leave\(\);/g) ?? []).length, (body.match(/await beginStatsWrite\(/g) ?? []).length, `${from}: every entry is ended`);
  }
  assert.match(between("const storeFirstIntelligenceRating = ", "const intelligenceRatingInstruction"), /inOrder \? inReadingOrder\("intelligence-rating", write\) : write\(\)/);
  assert.match(between("export const assessPoliticalLandscape = ", "const politicalActorOf = "), /await inReadingOrder\("parties", \(\) => mutateWorldState\(/);
  // The host taking a device's sheet is a request's own entry: no second one.
  const take = between("export const takeCountryStatSheet = ", "export const pendingCountryStatSheet");
  assert.match(take, /await beginStatsWrite\(campaign\);/);
  assert.match(take, /storeFirstIntelligenceRating\(name, \{ intelligence: rating \}, \{ campaign, inOrder: false \}\)/);
  const engine = source("../multiplayer/host/engineMain.js");
  assert.match(engine, /writeInOrder = \(label, write\) => hosting\.write\(label, write\);\n\s*setReadingsOrder\(/, "set as sharing begins");
  assert.match(engine, /writeInOrder = \(label, write\) => write\(\);\n\s*setReadingsOrder\(null\);/, "and cleared as it stops");
});
