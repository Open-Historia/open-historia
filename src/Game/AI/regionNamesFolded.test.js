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
// Nothing else is read as a region: "there should be absolutely no keywording
// done in this game anywhere" (the owner, 2026-11-13).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { foldedRegionIndex, nearestRegionNames, regionNamedIn, regionsFoldedAs } from "./regionMatch.js";

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

test("the resolver asks the exact spelling, then the fold, then a town of that name, then the name among the regions the transfer can mean, and nothing that guesses", () => {
  const body = gameplay.slice(gameplay.indexOf("const deterministicResolve = (transfer) => {"), gameplay.indexOf("const pushUniqueTransfer = (target, transfer) => {"));
  const order = [
    "const matches = byName.get(query) ?? [];",
    "const folded = foldedRegion(candidate, fromKey);",
    "cityAnchoredRegionId(transfer, ownedCandidates)",
    "regionNamedIn(candidate, transferPool(transfer))",
  ].map((needle) => body.indexOf(needle));
  assert.ok(order.every((at) => at > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // No English affixes, no names inside names, no spellings an edit away, and
  // no town read out of an operation's note.
  assert.doesNotMatch(body, /matchRegionName|stripRegionAffixes|editDistance|\.note\b/);
  // A town is found by the exact name written, never by looking for it inside text.
  const resolver = gameplay.slice(gameplay.indexOf("const resolveRegionTransfers = async"), gameplay.indexOf("const resolveRegionControlOps = async"));
  assert.doesNotMatch(resolver, /haystack|\.includes\(` \$\{key\} `\)|NARRATED_CONTROL_TARGET_CUE|cityClaimedAsControlTarget|similarRegions|geographyResolver/);
});

test("a name the map does not have is the same miss in every language, and never resolves by its words", () => {
  const ukraine = [
    { id: "UKR.kharkiv", name: "Kharkiv", aliases: ["Kharkivska"] },
    { id: "UKR.kherson", name: "Kherson" },
  ];
  // The map's name, its alias, and either written with case, marks or spacing different.
  assert.equal(regionNamedIn("Kharkiv", ukraine)?.id, "UKR.kharkiv");
  assert.equal(regionNamedIn("  KHARKIVSKA ", ukraine)?.id, "UKR.kharkiv");
  // An English administrative word and its French twin are both no name of the map's.
  assert.equal(regionNamedIn("Kharkiv Oblast", ukraine), null);
  assert.equal(regionNamedIn("Oblast de Kharkiv", ukraine), null);
  // A spelling one letter away is no name of the map's either, in any language.
  assert.equal(regionNamedIn("Kharkov", ukraine), null);
  assert.equal(regionNamedIn("Kherzon", ukraine), null);
  // Two regions answering to one name settle nothing.
  assert.equal(regionNamedIn("Cordoba", [{ id: "a", name: "Córdoba" }, { id: "b", name: "Cordoba" }]), null);
  assert.equal(regionNamedIn("", ukraine), null);
  // The receipt that tells the model is the same sentence in both languages.
  assert.match(gameplay, /unresolved\.push\(\{\r?\n\s+label: normalizeString\(transfer\?\.regionName\) \|\| normalizeString\(transfer\?\.regionId\),\r?\n\s+fromCode: normalizeString\(transfer\?\.fromCode\),\r?\n\s+path,\r?\n\s+candidates: canonicalOwnerKey\(transfer\?\.fromCode\) \? regionsOwnedBy\(transfer\?\.fromCode\) : \[\],\r?\n\s+transferIndex,\r?\n\s+unmatched: true,/);
});

test("a name the map does not have is left out on every attempt and never costs a request", () => {
  const validator = gameplay.slice(gameplay.indexOf("export const validateGeneratedWorldChanges = async"), gameplay.indexOf("// A dissolution the engine will refuse"));
  // Only what a name cannot fix is ever sent back on a strict attempt.
  assert.match(validator, /const refusedTransfers = unresolvedTransfers\.filter\(\(entry\) => !entry\?\.unmatched\);\r?\n\s+if \(strict && refusedTransfers\.length > 0\) \{\r?\n\s+return buildTransferFeedback\(refusedTransfers\);/);
  assert.match(validator, /const refusedControlOps = unresolvedControlOps\.filter\(\(entry\) => !entry\?\.unmatched\);\r?\n\s+if \(strict && refusedControlOps\.length > 0\) \{\r?\n\s+return buildControlFeedback\(refusedControlOps\);/);
  // And the resolver asks no model at all.
  const resolver = gameplay.slice(gameplay.indexOf("const resolveRegionTransfers = async"), gameplay.indexOf("const resolveRegionControlOps = async"));
  assert.doesNotMatch(resolver, /runJsonTask|requests\b/);
  // The Game Master is told which were left out, beside its preview.
  assert.match(gameplay, /territoryNotes,\r?\n\s+\}\);\r?\n\s+if \(worldChangeError\) return worldChangeError;\r?\n\s+territoryNotes\.forEach\(note\);/);
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
