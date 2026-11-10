/*! Open Historia — a region written by the map's name without its marks: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/regionNamesFolded.test.js
//
// "Script Events (and potentially just normal events?) seem to fail transfer
// specifically named regions" (a player, 2026-11). His scripted event gave
// Moldova "Chisinau, Laloveni, ... Balti"; the built-in map spells them
// Chişinău, Ialoveni, Bălţi. A name that is the map's own but for marks, case
// or punctuation is that region when one region alone folds to it; a region
// written by its own name is never taken for the region round a town of that
// name; and a name the map lacks is reported with the map's nearest names.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { foldedRegionIndex, nearestRegionNames, regionsFoldedAs } from "./regionMatch.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const seed = JSON.parse(readFileSync(new URL("../../../server/seed/default/regions.geojson", import.meta.url), "utf8"));
const regions = seed.features.map((feature) => ({ id: feature.properties.id, name: feature.properties.name, country: feature.properties.owner }));

test("the player's Moldovan names, written without the map's marks, each fold to one region of the built-in map", () => {
  const index = foldedRegionIndex(regions);
  const written = ["Chisinau", "Anenii Noi", "Causeni", "Stefan Voda", "Cantemir", "Leova", "Hincesti", "Criuleni", "Straseni", "Orhei", "Nisporeni", "Telenesti", "Soldanesti", "Falesti", "Singerei", "Floresti", "Balti", "Drochia", "Soroca", "Ocnita", "Edinet"];
  for (const name of written) {
    const hits = regionsFoldedAs(index, name);
    assert.equal(hits.length, 1, name);
    assert.equal(hits[0].country, "Moldova", name);
  }
  assert.equal(regionsFoldedAs(index, "balti")[0].name, "Bălţi");
  // Moldova's Calarasi and Romania's Călărași fold alike: only the losing side settles which.
  assert.deepEqual(regionsFoldedAs(index, "Calarasi").map((region) => region.country).sort(), ["Moldova", "Romania"]);
  assert.equal(regionsFoldedAs(index, "KARBALA")[0].name, "Karbala'");
  // A name the map does not have folds to nothing, and nothing is guessed.
  assert.deepEqual(regionsFoldedAs(index, "Sectorul Ciocana"), []);
});

test("a fold two regions share answers both, so the resolver takes neither unless the losing side holds only one", () => {
  const index = foldedRegionIndex([{ id: "a", name: "Córdoba" }, { id: "b", name: "Cordoba" }, { id: "c", name: "Sevilla" }]);
  assert.deepEqual(regionsFoldedAs(index, "cordoba").map((region) => region.id), ["a", "b"]);
  assert.match(gameplay, /const foldedRegion = \(written, ownerKey = ""\) => \{\r?\n\s+const hits = regionsFoldedAs\(byFold, written\);\r?\n\s+if \(hits\.length === 1\) return hits\[0\];\r?\n\s+if \(hits\.length > 1 && ownerKey\) \{/);
});

test("the resolver asks the exact spelling, then the fold, then a town of that name, then the matcher that guesses", () => {
  const body = gameplay.slice(gameplay.indexOf("const deterministicResolve = (transfer, event) => {"), gameplay.indexOf("const pushUniqueTransfer = (target, transfer) => {"));
  const order = [
    'cityAnchoredRegionId(transfer, ownedCandidates, "note")',
    "const matches = byName.get(query) ?? [];",
    "const folded = foldedRegion(candidate, fromKey);",
    'cityAnchoredRegionId(transfer, ownedCandidates, "name")',
    "matchRegionName(candidate, transferPool(transfer)",
  ].map((needle) => body.indexOf(needle));
  assert.ok(order.every((at) => at > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("claims and a group's regions fold the same way", () => {
  assert.match(gameplay, /const hits = regionsFoldedAs\(byFold, candidate\);\r?\n\s+const pick = hits\.length === 1 \? hits : hits\.filter\(\(region\) => ownerKeyOf\(region\.id\) !== claimantKey\);/);
  assert.match(gameplay, /const matches = aliased\.length === 1 \? aliased : named\.length \? named : regionsFoldedAs\(byFold, token\);/);
});

test("a dropped name is answered with the map's nearest names, never ids", () => {
  const iraq = regions.filter((region) => region.country === "Iraq");
  assert.equal(nearestRegionNames("Basra", iraq)[0], "Al-Basrah");
  const moldova = regions.filter((region) => region.country === "Moldova");
  assert.equal(nearestRegionNames("Laloveni", moldova)[0], "Ialoveni");
  assert.ok(nearestRegionNames("Basra", iraq).every((name) => !/IRQ/.test(name)));
  assert.deepEqual(nearestRegionNames("Zzzz", iraq), []);
  assert.match(gameplay, /const nearest = nearestRegionNames\(label, normalizeArray\(entry\?\.candidates\)\);/);
});
