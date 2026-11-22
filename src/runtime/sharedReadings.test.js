/*! Open Historia — whose AI makes the readings a shared game makes by itself: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/sharedReadings.test.js
//
// After every round, and when a scenario's fronts were built, the engine of a
// shared game read figures on the host's AI whatever "replies" said (the
// review of 2026-11-18, cost 6 and wars 9). They follow the setting now.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { hostReadsFigures, setHostReadsFigures, setReadingsOrder, writeInHostOrder } from "./sharedReadings.js";
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
// between a player's request and the next (rule 2: every change to the world is one entry of it). And the owner's
// "Start the game does nothing" (2026-11-18): a reading's entry was entered and held open until the reading let it go,
// and one never let go held Start behind it for good. The entry is the write itself now, and ends with it.
test("a reading's write is one entry of the host's order while the engine shares a game, and ends when the write ends; at once anywhere else", async () => {
  const alone = [];
  assert.equal(await writeInHostOrder("ratings", (context) => { alone.push(context); return "written"; }), "written");
  assert.deepEqual(alone, [{ inEntry: false }], "single player, every page, and the engine before and after sharing");
  // The engine's (engineMain.js): the write is run as one entry of its queue.
  const queue = createWorldQueue();
  const labels = [];
  setReadingsOrder((label, write) => {
    labels.push(label);
    return queue.run(`reading:${label}`, write);
  });
  try {
    const seen = [];
    let release;
    // A player's request is being applied when the reading comes back from the AI.
    void queue.run("order", () => new Promise((resolve) => { release = resolve; }).then(() => seen.push("order")));
    const reading = writeInHostOrder("ratings", async ({ inEntry }) => {
      seen.push(`reading in an entry: ${inEntry}`);
      // Nothing else is applied while it writes.
      await new Promise((resolve) => setImmediate(resolve));
      seen.push("reading written");
      return "kept";
    });
    void queue.run("post", async () => seen.push("post"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [], "it waits for the entry being applied");
    release();
    assert.equal(await reading, "kept", "the reading gets what its write did");
    await queue.settled();
    assert.deepEqual(seen, ["order", "reading in an entry: true", "reading written", "post"], "its own entry, in the order it came, the next waiting for it");
    assert.deepEqual(labels, ["ratings"]);
    // A write that fails ends its entry, and the reading is told.
    await assert.rejects(writeInHostOrder("ratings", async () => { throw new Error("the campaign changed"); }), /the campaign changed/);
    let after = false;
    await queue.run("next", async () => { after = true; });
    assert.equal(after, true, "and the queue goes on");
  } finally {
    setReadingsOrder(null);
  }
  const again = [];
  await writeInHostOrder("ratings", (context) => { again.push(context); });
  assert.deepEqual(again, [{ inEntry: false }], "cleared once sharing stops");
});

// gameplay.js does not load in node: where each reading writes is pinned from the source.
test("every reading the game makes out of turn writes in the host's order; the host taking a reading in an entry of its own takes the lock at once", () => {
  const gameplay = source("../Game/AI/gameplay.js");
  const between = (from, to) => gameplay.slice(gameplay.indexOf(from), gameplay.indexOf(to, gameplay.indexOf(from)));
  // The one door: inside an entry the queue is the lock, taken at once; anywhere else waited for and taken in one step.
  const door = between("const statsWrite = ", "const inReadingOrder = ");
  assert.match(door, /if \(entered\) beginSimulation\(\);\n\s*else await enterSimulation\(\{ signal \}\);/);
  assert.match(door, /if \(inEntry\) return locked\(true, fence\);\n\s*if \(inOrder\) return writeInHostOrder\(inOrder, \(\{ inEntry: entered, fence: given = null \}\) => locked\(entered, given\)\);\n\s*return locked\(false, null\);/);
  // And every write it makes is handed the entry's fence (host/worldQueue.js): nothing of an entry the host's queue let go lands.
  assert.match(door, /return await write\(\{ inEntry: entered, fence: entryFence \}\);/);
  assert.match(door, /\} finally \{\n\s*giveBack\(\);\n\s*\}/, "the lock is let go however the write ends");
  assert.match(door, /entryFence\?\.onClose\?\.\(giveBack\);/, "and when the host's queue lets the entry go, whether or not its write comes back");
  assert.equal((gameplay.match(/beginStatsWrite|readingEntry/g) ?? []).length, 0, "no entry is ever held open");
  assert.match(between("export const ensureConflictBackends = ", "export const takeMilitaryRatings"), /statsWrite\(campaign, null, \{ inOrder: "conflict-figures" \}, async \(\{ fence \}\) => \{[\s\S]*\}, \{ emitEvents: false, fence \}\);/);
  assert.match(between("export const ensureMilitaryFigures = ", "// `rateIntelligence`"), /takeMilitaryRatings\(read, \{ campaign, inOrder: "ratings" \}\)/, "the figures it rated by itself");
  assert.match(between("export const takeMilitaryRatings = ", "export const ensureMilitaryFigures = "), /await statsWrite\(campaign, null, \{ inOrder, inEntry, fence \}, async \(\{ fence: given \}\) => \{[\s\S]*\}, \{ emitEvents: false, fence: given \}\);/);
  assert.match(between("export const refreshStaleStatSheets = ", "export const assessPoliticalLandscape = "), /statsWrite\(campaign, null, \{ inOrder: "stats-refresh" \}, async \(\{ inEntry, fence \}\) => \{[\s\S]*persistStatSheet\(\{[\s\S]*inEntry,\n\s*fence,\n/);
  for (const [from, to] of [["const generateScenarioCustomStatSheet = ", "// Structured national stat sheet"], ["export const generateCountryStatSheet = ", "export const refinePlayerAction = "]]) {
    const body = between(from, to);
    assert.ok((body.match(/statsWrite\(campaign, signal, \{ inOrder: "stat-sheet" \}/g) ?? []).length >= 1, from);
    assert.equal((body.match(/statsWrite\(/g) ?? []).length, (body.match(/statsWrite\(campaign, signal, \{ inOrder: "stat-sheet" \}/g) ?? []).length, `${from}: every write in the host's order`);
    // Each with the entry's fence.
    assert.equal((body.match(/statsWrite\(campaign, signal, \{ inOrder: "stat-sheet" \}, (?:async )?\(\{ (?:inEntry, )?fence \}\) =>/g) ?? []).length, (body.match(/statsWrite\(/g) ?? []).length, `${from}: every write with its entry's fence`);
  }
  // In the host's entry a sheet is the main thread's commit: the Stats worker's minute held Start behind it.
  const persist = between("const persistStatSheet = ", "// What a scenario's own sheet rests on");
  assert.match(persist, /source = "country-stats", inEntry = false, fence = null \} = \{\}\) => \{\n\s*if \(!inEntry\) try \{/);
  assert.match(persist, /\}, \{ emitEvents: false, fence \}\);/, "and carries the entry's fence");
  const rating = between("const storeFirstIntelligenceRating = ", "const intelligenceRatingInstruction");
  assert.match(rating, /if \(!inEntry\) await waitForSimulationIdle\(\{ signal \}\);/);
  assert.match(rating, /inEntry \? write\(\{ fence \}\) : inReadingOrder\("intelligence-rating", write\)/);
  assert.match(rating, /\}, \{ fence: given \}\);/);
  assert.match(between("export const assessPoliticalLandscape = ", "const politicalActorOf = "), /await inReadingOrder\("parties", \(\{ fence \}\) => mutateWorldState\([\s\S]*\}, \{ fence \}\)\);/);
  // The host taking a device's sheet is a request's own entry: no second one, and no wait for a lock.
  const take = between("export const takeCountryStatSheet = ", "export const pendingCountryStatSheet");
  assert.match(take, /await statsWrite\(campaign, null, \{ inEntry, fence \}, async \(\{ fence: given \}\) => \{/);
  assert.match(take, /storeFirstIntelligenceRating\(name, \{ intelligence: rating \}, \{ campaign, inEntry, fence \}\)/);
  assert.match(between("export const takePoliticalLandscape = ", "// which is handed only this one sheet"), /\}, \{ fence \}\);/);
  const engine = source("../multiplayer/host/engineMain.js");
  assert.match(engine, /writeInOrder = \(label, write, options\) => hosting\.write\(label, write, options\);\n\s*setReadingsOrder\(\(label, write, options\) => hosting\.write\(`reading:\$\{label\}`, write, options\)\);/, "set as sharing begins: the write is the entry");
  assert.match(engine, /writeInOrder = \(label, write\) => write\(\{ fence: null \}\);\n\s*setReadingsOrder\(null\);/, "and cleared as it stops");
  // Every entry of the engine's that takes the lock takes it at once: the round, and what the host takes in a request's entry.
  assert.equal((engine.match(/enterSimulation/g) ?? []).length, 0, "no entry waits on the lock");
  assert.match(engine, /takeCountryStatSheet\(\{ name: await countryOfGame\(country\), sheet, continuity, rating, inEntry: true, fence \}\)/);
  assert.match(engine, /writeInOrder\("ratings", \(\{ fence \}\) => takeMilitaryRatings\(read, \{ inEntry: true, fence \}\), \{ fenced: true \}\)/);
  assert.match(engine, /takeRatings: \(ratings, \{ fence = null \} = \{\}\) => takeMilitaryRatings\(ratings, \{ inEntry: true, fence \}\)/);
});
