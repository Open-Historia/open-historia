/*! Open Historia — a dissolved polity leaves nothing behind: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.dissolution.test.js
//
// "Union of Soviet Socialist Republics annexes and dismantles State Committee
// on the State of Emergency ... a polity isn't annexed or dismantled
// completely despite specific instructions saying so. Furthermore, one test
// run I did resulted in claims staying from the dismantled polity (despite it
// not existing)" (a player, 2026-11). A dissolution was refused whenever the
// polity had any row left on the map, and when it went through, every claim
// and dispute it had stayed drawn.

import test from "node:test";
import assert from "node:assert/strict";

import { applyEventImpactsToWorld, dissolutionHeir } from "./gameState.js";

const UNION = "Union of Soviet Socialist Republics";
const JUNTA = "State Committee on the State of Emergency";
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const world = () => ({
  polityOverrides: { [UNION]: polity(UNION), [JUNTA]: polity(JUNTA), Latvia: polity("Latvia") },
  regionOwnershipOverrides: { r1: JUNTA, r2: JUNTA, r3: JUNTA, r4: JUNTA, r5: UNION, r6: JUNTA, r7: "Latvia" },
  // r6 is the Union's, held by the junta; r7 is the junta's by title, held by Latvia.
  regionSovereigntyOverrides: { r6: UNION, r7: JUNTA },
  regionClaimants: Object.fromEntries(["r1", "r2", "r3", "r4", "r5", "c1", "c2", "c3"].map((id) => [id, [JUNTA]])
    .concat([["c4", [JUNTA, "Latvia"]], ["r6", [UNION]], ["r7", [JUNTA]]])),
  units: [{ id: "u1", name: "Alpha Group", ownerCode: JUNTA, type: "infantry", lng: 37.6, lat: 55.7 }],
});
const dissolving = (transfers) => ({
  id: "e1",
  date: "1991-08-22",
  title: "The coup collapses",
  description: "The Union annexes and dismantles the committee.",
  impacts: { polityChanges: [{ operation: "dissolve", code: JUNTA }], regionTransfers: transfers },
});

test("annexed and dismantled with only part of its land written: the rest goes to the one heir, and it is gone", () => {
  const { world: next } = applyEventImpactsToWorld({
    events: [dissolving([{ regionId: "r1", fromCode: JUNTA, toCode: UNION }, { regionId: "r2", fromCode: JUNTA, toCode: UNION }])],
    world: world(),
  });
  assert.equal(next.polityOverrides[JUNTA].status, "dissolved");
  for (const id of ["r1", "r2", "r3", "r4", "r6"]) assert.equal(next.regionOwnershipOverrides[id], UNION, id);
  assert.equal(Object.values(next.regionOwnershipOverrides).some((owner) => owner === JUNTA), false, "no control");
  assert.equal(Object.values(next.regionSovereigntyOverrides).some((owner) => owner === JUNTA), false, "no title");
  // Its title to what Latvia holds passes to the heir, who stands in its place as the claimant.
  assert.equal(next.regionSovereigntyOverrides.r7, UNION);
  assert.deepEqual(next.regionClaimants.r7, [UNION]);
  assert.equal(next.regionSovereigntyOverrides.r6, undefined, "the Union holds its own region again");
  assert.equal(next.units.length, 0, "no units");
});

test("its claims go everywhere, however many, and other claimants' stay", () => {
  const many = world();
  for (let index = 0; index < 300; index += 1) many.regionClaimants[`x${index}`] = [JUNTA];
  const { world: next } = applyEventImpactsToWorld({
    events: [dissolving([{ regionId: "r1", fromCode: JUNTA, toCode: UNION }])],
    world: many,
  });
  const left = Object.entries(next.regionClaimants).filter(([, names]) => names.includes(JUNTA));
  assert.deepEqual(left, []);
  assert.deepEqual(next.regionClaimants.c4, ["Latvia"]);
  assert.ok(next.settledRegionClaims.includes("x299"), "a region with nobody left on it is settled");
});

test("land it only occupies goes back to its sovereign even with no heir; land it holds outright with no heir still refuses", () => {
  const occupier = {
    polityOverrides: { [UNION]: polity(UNION), [JUNTA]: polity(JUNTA) },
    regionOwnershipOverrides: { r6: JUNTA },
    regionSovereigntyOverrides: { r6: UNION },
    regionClaimants: { r6: [UNION] },
  };
  const gone = applyEventImpactsToWorld({ events: [dissolving([])], world: occupier }).world;
  assert.equal(gone.polityOverrides[JUNTA].status, "dissolved");
  assert.equal(gone.regionOwnershipOverrides.r6, UNION);
  assert.equal("r6" in gone.regionClaimants, false);

  const holder = { ...occupier, regionOwnershipOverrides: { r6: JUNTA, r9: JUNTA }, regionSovereigntyOverrides: { r6: UNION } };
  const kept = applyEventImpactsToWorld({ events: [dissolving([])], world: holder }).world;
  assert.notEqual(kept.polityOverrides[JUNTA].status, "dissolved");
  assert.equal(kept.regionOwnershipOverrides.r9, JUNTA);
  assert.equal(kept.regionOwnershipOverrides.r6, JUNTA, "nothing is half done when it is refused");
});

test("the heir is the one polity the event hands its land to, or the one it creates; several is none", () => {
  const changes = [{ change: { operation: "dissolve" }, code: JUNTA }];
  assert.equal(dissolutionHeir({ code: JUNTA, polityChanges: changes, regionTransfers: [{ fromCode: JUNTA, toCode: UNION }] }), UNION);
  assert.equal(dissolutionHeir({ code: JUNTA, polityChanges: changes, regionTransfers: [{ fromCode: JUNTA, toCode: UNION }, { fromCode: JUNTA, toCode: "Latvia" }] }), "");
  assert.equal(dissolutionHeir({ code: JUNTA, polityChanges: [...changes, { change: { operation: "create" }, code: "Republic of Moldova" }] }), "Republic of Moldova");
  assert.equal(dissolutionHeir({ code: JUNTA, regionControlOps: [{ op: "control", fromCode: JUNTA, toCode: UNION }] }), UNION);
});

test("a dissolution the engine will refuse is told to the next turn, with the land by name", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /const heir = dissolutionHeir\(\{\r?\n\s+code,/);
  assert.match(gameplay, /was not dissolved: the event gives \$\{kept\.length\} of its regions/);
  assert.match(gameplay, /const names = kept\.map\(\(id\) => catalogNames\.get\(id\)\)\.filter\(Boolean\)\.slice\(0, 4\);/);
});

// Only the model was told: the player saw the polity still on the map and no
// word of why. The same receipt note now carries the player's own line.
test("a refused dissolution is told to the player too, by the polity's name, beside its event", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /to nobody\. Give its land to one polity in the same event\.`,\r?\n\s+dissolutionRefusedNote\(\{ polity: code, count: kept\.length \}, titleAt\(path\)\)\);/);

  const { dissolutionRefusedNote } = await import("./receiptPlayerNotes.js");
  assert.deepEqual(dissolutionRefusedNote({ polity: JUNTA, count: 3 }, "The coup collapses"), {
    text: `${JUNTA} was not dissolved: 3 of its regions were given to no one.`,
    event: "The coup collapses",
  });
  assert.equal(dissolutionRefusedNote({ polity: JUNTA, count: 1 }).text, `${JUNTA} was not dissolved: 1 of its regions was given to no one.`);

  // And it is what the engine does: the polity stays, with the land it held.
  const holder = { polityOverrides: { [UNION]: polity(UNION), [JUNTA]: polity(JUNTA) }, regionOwnershipOverrides: { r1: JUNTA, r2: JUNTA, r3: JUNTA } };
  const kept = applyEventImpactsToWorld({ events: [dissolving([])], world: holder }).world;
  assert.notEqual(kept.polityOverrides[JUNTA].status, "dissolved");
  assert.equal(Object.values(kept.regionOwnershipOverrides).filter((owner) => owner === JUNTA).length, 3);
});
