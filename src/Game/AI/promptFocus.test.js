// Run: node --test src/Game/AI/promptFocus.test.js
//
// What a time skip shows in full: the powers it can never leave out, the
// snapshot that says what changed, the neighbours and the relevant countries.
// There is no spotlight on distant powers any more (the quality A/B of
// 2026-11-07): nothing names a power for the model to give a turn to.
import test from "node:test";
import assert from "node:assert/strict";

import {
  POWERS_IN_VIEW,
  buildPromptSnapshot,
  changedSinceSnapshot,
  hashText,
  neighbourPowers,
  normalizePromptSnapshot,
  splitInView,
  storylinePowers,
} from "./promptFocus.js";
import { selectFocusPowers } from "./regionFocus.js";
import { normalizePromptReference } from "../../runtime/promptSnapshot.js";

const power = (label, regions = 10, extra = {}) => ({ label, regions, line: `${label}|${regions}`, tags: [], note: "", ...extra });

test("a snapshot tells which powers changed: their count, their line, their tags, their lore, or being new", () => {
  const before = buildPromptSnapshot({ round: 4, date: "1930-05-01", powers: [power("Ruritania"), power("Slavonia"), power("Borduria", 5, { tags: ["monarchy"] }), power("Syldavia", 3, { note: "Old lore." })] });
  const after = buildPromptSnapshot({
    round: 5,
    powers: [
      power("Ruritania", 12),
      power("Slavonia"),
      power("Borduria", 5, { tags: ["republic"] }),
      power("Syldavia", 3, { note: "New lore." }),
      power("Free Carpathia", 1),
    ],
  });
  const changed = changedSinceSnapshot(before, after);
  assert.deepEqual([...changed].sort(), ["borduria", "free carpathia", "ruritania", "syldavia"]);
  assert.equal(changed.has("slavonia"), false);
});

test("without a snapshot nothing is known to be unchanged", () => {
  const now = buildPromptSnapshot({ powers: [power("Ruritania")] });
  assert.equal(changedSinceSnapshot(null, now), null);
  assert.equal(changedSinceSnapshot({ v: 99, powers: {} }, now), null, "a snapshot of another version is no snapshot");
});

test("a snapshot survives the save's normaliser, and junk does not", () => {
  const snapshot = buildPromptSnapshot({ round: 7, powers: [power("Ruritania"), power("Slavonia", 3)] });
  const stored = normalizePromptSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(stored, snapshot);
  assert.equal(changedSinceSnapshot(stored, snapshot).size, 0);
  assert.equal(normalizePromptSnapshot("nonsense"), null);
  assert.deepEqual(normalizePromptSnapshot({ v: 1, powers: { "": [1, "a", "b", "c"], bad: "x" } }).powers, {});
  assert.deepEqual(normalizePromptReference({ round: 3, notes: { ruritania: { name: "Ruritania", note: "A kingdom." }, empty: { name: "X", note: "" } } }),
    { round: 3, notes: { ruritania: { name: "Ruritania", note: "A kingdom." } } });
});

test("the hash is stable and short", () => {
  assert.equal(hashText("Ruritania"), hashText("Ruritania"));
  assert.notEqual(hashText("Ruritania"), hashText("Ruritania "));
  assert.match(hashText(""), /^[0-9a-f]{8}$/);
});

test("neighbours are the powers whose regions touch the player's, by box or declared adjacency", () => {
  const rows = [
    { id: "r1", country: "Ruritania", bounds: [[0, 0], [1, 1]] },
    { id: "r2", country: "Ruritania", bounds: [[1, 0], [2, 1]], adjacencies: ["far1"] },
    { id: "s1", country: "Slavonia", bounds: [[2, 0], [3, 1]] },
    { id: "s2", country: "Slavonia", bounds: [[2, 1], [3, 2]] },
    { id: "b1", country: "Borduria", bounds: [[-1, 0], [0, 1]] },
    { id: "far1", country: "Syldavia", bounds: [[50, 50], [51, 51]] },
    { id: "far2", country: "Atlantis", bounds: [[80, 80], [81, 81]] },
  ];
  const neighbours = neighbourPowers(rows, (row) => row.country, "Ruritania");
  assert.deepEqual(neighbours, ["Slavonia", "Borduria", "Syldavia"]);
  assert.equal(neighbours.includes("Atlantis"), false);
  assert.deepEqual(neighbourPowers(rows, (row) => row.country, ""), []);
});

test("storyline parties are those of the storylines still running", () => {
  assert.deepEqual(storylinePowers([
    { status: "active", participants: ["Ruritania", "Slavonia"] },
    { status: "resolved", participants: ["Atlantis"] },
    { status: "dormant", participants: ["Borduria", "Slavonia"] },
  ]), ["Ruritania", "Slavonia", "Borduria"]);
});

const owners = (count, prefix = "Land") => Array.from({ length: count }, (_, index) => ({ key: `${prefix} ${index + 1}`, label: `${prefix} ${index + 1}`, regions: 100 - index }));

test("the player, every power at war and every power the orders name are in view, however many there are", () => {
  const warring = owners(40, "Belligerent");
  const bystanders = owners(60, "Bystander");
  const ranked = selectFocusPowers({
    owners: [{ key: "Ruritania", label: "Ruritania", regions: 3 }, { key: "Faraway", label: "Faraway", regions: 2 }, ...warring, ...bystanders],
    player: "Ruritania",
    actions: [{ status: "planned", title: "Send an envoy", text: "Send an envoy to Faraway.", invitees: ["Faraway"] }],
    wars: [{ status: "active", sideA: warring.slice(0, 20).map((entry) => entry.label), sideB: warring.slice(20).map((entry) => entry.label) }],
    neighbours: bystanders.slice(0, 50).map((entry) => entry.label),
  });
  const { inView, rest } = splitInView(ranked);
  const names = new Set(inView.map((entry) => entry.label));
  assert.ok(names.has("Ruritania"), "the player");
  assert.ok(names.has("Faraway"), "the power the orders name");
  for (const entry of warring) assert.ok(names.has(entry.label), `${entry.label}, at war`);
  const optional = inView.filter((entry) => !["Ruritania", "Faraway"].includes(entry.label) && !entry.label.startsWith("Belligerent"));
  assert.equal(optional.length, POWERS_IN_VIEW, "the cap only ever drops powers in view for a lesser reason");
  assert.ok(rest.length > 0);
  assert.ok(rest.every((entry) => !entry.label.startsWith("Belligerent")));
});

test("the new signals each give their reason", () => {
  const ranked = selectFocusPowers({
    owners: [
      { key: "Ruritania", label: "Ruritania", regions: 3 },
      { key: "Slavonia", label: "Slavonia", regions: 3 },
      { key: "Borduria", label: "Borduria", regions: 3 },
      { key: "Syldavia", label: "Syldavia", regions: 3 },
      { key: "Atlantis", label: "Atlantis", regions: 3 },
      { key: "Nowhere", label: "Nowhere", regions: 3 },
    ],
    player: "Ruritania",
    neighbours: ["Slavonia"],
    changed: ["borduria"],
    storylines: ["Syldavia"],
    relevant: ["Atlantis"],
    // Anything else a caller passes names no power into view.
    spotlight: ["Nowhere"],
  });
  const reasons = Object.fromEntries(ranked.map((entry) => [entry.label, entry.reasons]));
  assert.deepEqual(reasons.Slavonia, ["neighbour"]);
  assert.deepEqual(reasons.Borduria, ["changed since the last skip"]);
  assert.deepEqual(reasons.Syldavia, ["in a live storyline"]);
  assert.deepEqual(reasons.Atlantis, ["relevant country"]);
  assert.deepEqual(reasons.Nowhere, []);
  const { rest } = splitInView(ranked);
  assert.deepEqual(rest.map((entry) => entry.label), ["Nowhere"]);
});

test("a relevant country weighs what a neighbour does, and is in view as a neighbour is", () => {
  const ranked = selectFocusPowers({
    owners: [
      { key: "Ruritania", label: "Ruritania", regions: 3 },
      { key: "Slavonia", label: "Slavonia", regions: 3 },
      { key: "Atlantis", label: "Atlantis", regions: 3 },
    ],
    player: "Ruritania",
    neighbours: ["Slavonia"],
    relevant: ["Atlantis"],
  });
  const score = Object.fromEntries(ranked.map((entry) => [entry.label, entry.score]));
  assert.equal(score.Atlantis, score.Slavonia);
  assert.deepEqual(splitInView(ranked).inView.map((entry) => entry.label).sort(), ["Atlantis", "Ruritania", "Slavonia"]);
});
