// The canonical war record (warRecord.js): one shape, one id per war for all
// time, one side bound, nothing live ever cut. The owner, 2026-11-13: "the
// entire war foundational archetecture is pretty weak".
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ENDED_WARS,
  MAX_WAR_SIDE_MEMBERS,
  contentWarId,
  mintWarId,
  namesFightWar,
  normalizeWarRecord,
  normalizeWarRecords,
  referencedWarIds,
  resolveWarReference,
  warIdStem,
  warIndex,
  warMembers,
  warSideOf,
} from "./warRecord.js";

const war = (id, extra = {}) => ({ id, status: "active", sideA: ["France"], sideB: ["Germany"], startedDate: "2016-01-01", ...extra });

test("a record keeps the shape it always had, and a renewal says what it renews", () => {
  const record = normalizeWarRecord(war("war-fr-de-2016", { title: "Rhine War" }));
  assert.deepEqual(Object.keys(record), [
    "id", "title", "status", "sideA", "sideB", "startedDate", "endedDate", "lastUpdatedDate",
    "cause", "note", "sourceEventIds", "storylineIds", "createdRound", "updatedRound",
  ]);
  assert.equal(normalizeWarRecord(war("war-fr-de-2016-r2", { renews: "war-fr-de-2016" })).renews, "war-fr-de-2016");
  assert.equal(normalizeWarRecord(null), null);
  assert.equal(normalizeWarRecord({ id: "x", sideA: ["France"], sideB: [] }), null);
});

test("a side holds every member it is given, whatever order they come in", () => {
  const thirty = Array.from({ length: 30 }, (_, index) => `Ally ${String.fromCharCode(65 + (index % 26))}${index}`);
  const record = normalizeWarRecord(war("w", { sideA: thirty }));
  assert.equal(record.sideA.length, 30);
  assert.deepEqual(new Set(normalizeWarRecord(war("w", { sideA: [...thirty].reverse() })).sideA), new Set(record.sideA));
  assert.equal(warMembers(Array.from({ length: 200 }, (_, index) => `Member ${index}x`)).length, MAX_WAR_SIDE_MEMBERS);
});

test("names are exact but for case and spacing; numbers are not polities", () => {
  assert.deepEqual(warMembers(["  France ", "france", "Russian  Federation", "1", "2"]), ["France", "Russian Federation"]);
  // Two parties written on one side with nobody on the other are one on each.
  const shifted = normalizeWarRecord({ id: "w", sideA: ["United Kingdom", "Ireland"], sideB: ["1", "2"] });
  assert.deepEqual([shifted.sideA, shifted.sideB], [["United Kingdom"], ["Ireland"]]);
});

test("an id is never an array position", () => {
  const unnamed = { status: "active", sideA: ["Peru"], sideB: ["Chile"], startedDate: "1879-04-05" };
  const once = normalizeWarRecords([war("war-a"), unnamed]);
  const twice = normalizeWarRecords([unnamed, war("war-a")]);
  const id = (list) => list.find((entry) => entry.sideA[0] === "Peru").id;
  assert.equal(id(once), id(twice));
  assert.equal(id(once), contentWarId(unnamed));
  // Two unnamed wars between the same sides on the same day are still two wars.
  assert.equal(new Set(normalizeWarRecords([unnamed, { ...unnamed }]).map((entry) => entry.id)).size, 2);
});

test("a renewal's id is new, and its stem is the war it renews", () => {
  assert.equal(mintWarId("war-uk-ireland-2016", new Set()), "war-uk-ireland-2016");
  assert.equal(mintWarId("war-uk-ireland-2016", new Set(["war-uk-ireland-2016"])), "war-uk-ireland-2016-r2");
  assert.equal(mintWarId("war-uk-ireland-2016-r2", new Set(["war-uk-ireland-2016", "war-uk-ireland-2016-r2"])), "war-uk-ireland-2016-r3");
  assert.equal(warIdStem("war-uk-ireland-2016-r3"), "war-uk-ireland-2016");
  // A year is not a renewal number.
  assert.equal(warIdStem("war-uk-ireland-2016"), "war-uk-ireland-2016");
  assert.equal(mintWarId("bad~id", new Set()), "bad-id");
});

test("an ended war's id means the war that renews it while that one is not over", () => {
  const wars = normalizeWarRecords([
    war("w", { status: "ended", endedDate: "2017-01-01" }),
    war("w-r2", { renews: "w", status: "ended", endedDate: "2018-01-01" }),
    war("w-r3", { renews: "w-r2" }),
    war("old", { status: "ended", endedDate: "2010-01-01" }),
  ]);
  const index = warIndex(wars);
  assert.equal(resolveWarReference(index, "w").id, "w-r3");
  assert.equal(resolveWarReference(index, "w-r2").id, "w-r3");
  assert.equal(resolveWarReference(index, "old").id, "old");
  assert.equal(resolveWarReference(index, "never"), null);
});

test("nothing live is ever cut, and an ended war that is still named is kept", () => {
  const ended = Array.from({ length: MAX_ENDED_WARS + 50 }, (_, index) =>
    war(`ended-${index}`, { status: "ended", lastUpdatedDate: `1${String(index).padStart(3, "0")}-01-01`, endedDate: `1${String(index).padStart(3, "0")}-01-01` }));
  const live = Array.from({ length: 90 }, (_, index) => war(`live-${index}`, { sideA: [`Country ${index}x`] }));
  const world = { peaceTreaties: [{ warId: "ended-0" }], reparations: [{ warId: "ended-1" }] };
  const wars = normalizeWarRecords([...ended, ...live], { keep: referencedWarIds(world) });
  assert.equal(wars.filter((entry) => entry.status === "active").length, 90);
  const kept = new Set(wars.map((entry) => entry.id));
  // The oldest two are named by a treaty and reparations; the newest MAX_ENDED_WARS are history.
  assert.ok(kept.has("ended-0") && kept.has("ended-1"));
  assert.ok(!kept.has("ended-2"));
  assert.equal(wars.filter((entry) => entry.status === "ended").length, MAX_ENDED_WARS + 2);
  // Live first, then ended, newest first.
  assert.deepEqual(wars.slice(0, 90).map((entry) => entry.status), Array(90).fill("active"));
});

test("a war's opening event is remembered whatever follows", () => {
  const ids = Array.from({ length: 60 }, (_, index) => `e${index}`);
  const record = normalizeWarRecord(war("w", { sourceEventIds: ids }));
  assert.equal(record.sourceEventIds[0], "e0");
  assert.equal(record.sourceEventIds.at(-1), "e59");
  assert.equal(record.sourceEventIds.length, 24);
});

test("sides are read by membership, never by position", () => {
  const coalition = normalizeWarRecord(war("w", { sideA: ["France", "Belgium", "Netherlands"], sideB: ["Germany", "Austria"] }));
  assert.equal(warSideOf(coalition, "netherlands"), "A");
  assert.equal(warSideOf(coalition, "Austria"), "B");
  assert.equal(warSideOf(coalition, "Spain"), "");
  assert.equal(namesFightWar(coalition, ["Austria", "Netherlands"]), true);
  assert.equal(namesFightWar(coalition, ["France", "Belgium"]), false);
  assert.equal(namesFightWar(coalition, ["France", "Spain", "Germany"]), false);
});
