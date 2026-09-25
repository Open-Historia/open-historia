/*! Open Historia — what a claimant is: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/claimantRoles.test.js
//
// The owner's rework (2026-09-23): "the user is able to in the map editor say
// whether a claimant is a country claiming the territory as their own, a
// terrorist organisation, a gang, one side of a civil conflict/war or whatever
// they want by typing it in. and that is used as context for the ai whenever it
// does something using that country" — and "when the ai creates disputed
// territories they can fill in this field as well".
//
// One free-text line per polity, its `role` (server/polityRole.js): typed in the
// Workshop, written by the AI with a claim, a contest, a control flip or a
// polity change, carried through the export, and shown to the model beside the
// claimant's name wherever the claimant appears — never inside the name.

import test from "node:test";
import assert from "node:assert/strict";

import {
  POLITY_ROLE_MAX,
  describePolity,
  findPolityRecord,
  normalizePolityRole,
  polityRoleOf,
  withPolityRole,
} from "./polityRole.js";
import { applyEventImpactsToWorld, normalizeWorldState } from "../src/runtime/gameState.js";
import { withMapClaims } from "../src/runtime/mapClaims.js";
import { screenTerritoryBasis } from "../src/runtime/territoryBasis.js";
import { claimStamper } from "../src/Editor/claimOverrides.js";
import { buildGameSeed } from "../src/Editor/exportPreset.js";
import { buildLookupContext, executeLookup } from "../src/Game/AI/lookupTools.js";
import { summarizeTerritorialState } from "../src/Game/AI/nativeTerritoryDirector.js";
import { buildCanonicalWarContext } from "../src/Game/AI/nativeWarLedger.js";
import { GAME_MASTER_SCHEMA, JUMP_FORWARD_SCHEMA } from "../src/Game/AI/gameplaySchemas.js";

const ISIS = "a jihadist terrorist organisation";
const REBELS = "the rebel side of the Syrian civil war";

// --- the field itself --------------------------------------------------------

test("a role is one line of the author's own words, capped", () => {
  assert.equal(normalizePolityRole("  a   street\n gang "), "a street gang");
  assert.equal(normalizePolityRole(null), "");
  assert.equal(normalizePolityRole({ role: "x" }), "", "an object is not words");
  assert.equal(normalizePolityRole("x".repeat(POLITY_ROLE_MAX + 50)).length, POLITY_ROLE_MAX);
  assert.equal(withPolityRole("Islamic State", ISIS), `Islamic State (${ISIS})`);
  assert.equal(withPolityRole("Syria", ""), "Syria", "a name with no role is the name");
});

test("a polity's role is found under its own name, any case, an alias or a former name", () => {
  const registry = {
    "Islamic State": { name: "Islamic State", aliases: ["ISIS"], formerNames: ["Islamic State of Iraq"], role: ISIS },
  };
  assert.equal(polityRoleOf(registry, "Islamic State"), ISIS);
  assert.equal(polityRoleOf(registry, "islamic state"), ISIS);
  assert.equal(polityRoleOf(registry, "ISIS"), ISIS);
  assert.equal(polityRoleOf(registry, "Islamic State of Iraq"), ISIS);
  assert.equal(polityRoleOf(registry, "Syria"), "");
  assert.equal(findPolityRecord(null, "x"), null);
  assert.equal(describePolity(registry, "ISIS"), `ISIS (${ISIS})`);
});

test("the world keeps a polity's role through normalization", () => {
  const world = normalizeWorldState({ polityOverrides: { Cartel: { name: "Cartel", role: "  a  drug cartel " }, Mexico: { name: "Mexico" } } });
  assert.equal(world.polityOverrides.Cartel.role, "a drug cartel");
  assert.equal("role" in world.polityOverrides.Mexico, false, "no role, no field");
});

// --- the AI writes it --------------------------------------------------------

const claimEvent = (impacts) => ({ date: "2016-01-01", title: "t", description: "d", impacts });
const apply = (world, impacts) => applyEventImpactsToWorld({ events: [claimEvent(impacts)], world, colors: {} }).world;
const syriaWorld = () => ({
  regionClaimants: {},
  regionOwnershipOverrides: { "syr-aleppo": "Syria" },
  polityOverrides: { Syria: { name: "Syria", aliases: [], color: "#aa0000" } },
});

test("a claim raised by the AI can say what its claimant is, and an unknown claimant is founded with it", () => {
  const next = apply(syriaWorld(), {
    regionClaims: [{ regionId: "syr-aleppo", claimantCode: "Islamic State", claimantRole: ISIS }],
  });
  assert.deepEqual(next.regionClaimants["syr-aleppo"], ["Islamic State"]);
  assert.equal(next.polityOverrides["Islamic State"].role, ISIS, "the founded claimant knows what it is");
  assert.equal(next.regionOwnershipOverrides["syr-aleppo"], "Syria", "a claim moves no border");
});

test("restating a claim with a new role changes the role and not the stripes; saying nothing keeps it", () => {
  let world = apply(syriaWorld(), { regionClaims: [{ regionId: "syr-aleppo", claimantCode: "Syrian Opposition", claimantRole: "rebels" }] });
  world = apply(world, { regionClaims: [{ regionId: "syr-aleppo", claimantCode: "Syrian Opposition", claimantRole: REBELS }] });
  assert.deepEqual(world.regionClaimants["syr-aleppo"], ["Syrian Opposition"], "one claim, not two");
  assert.equal(world.polityOverrides["Syrian Opposition"].role, REBELS);
  world = apply(world, { regionClaims: [{ regionId: "syr-aleppo", claimantCode: "Syrian Opposition" }] });
  assert.equal(world.polityOverrides["Syrian Opposition"].role, REBELS);
  world = apply(world, { regionClaims: [{ regionId: "syr-aleppo", claimantCode: "Syrian Opposition", drop: true, claimantRole: "ignored" }] });
  assert.equal(world.polityOverrides["Syrian Opposition"].role, REBELS, "a dropped claim describes nobody");
});

test("a claimant the world knows only from a claimant list gets a record for its role", () => {
  const world = { ...syriaWorld(), regionClaimants: { "syr-aleppo": ["Kurdish Militias"] } };
  const next = apply(world, { regionClaims: [{ regionId: "syr-aleppo", claimantCode: "Kurdish Militias", claimantRole: "the Kurdish militias of the north" }] });
  assert.equal(next.polityOverrides["Kurdish Militias"].role, "the Kurdish militias of the north");
});

test("a contest and a control flip can say what the new side is", () => {
  let world = apply(syriaWorld(), {
    regionControlOps: [{ op: "contest", regionId: "syr-aleppo", fromCode: "Syria", actorCode: "Syrian Opposition", actorRole: REBELS }],
  });
  assert.ok(world.regionClaimants["syr-aleppo"].includes("Syrian Opposition"), "a contest disputes the region");
  assert.equal(world.polityOverrides["Syrian Opposition"].role, REBELS);
  world = apply(world, {
    regionControlOps: [{ op: "control", regionId: "syr-aleppo", fromCode: "Syria", toCode: "Islamic State", toRole: ISIS }],
  });
  assert.equal(world.regionOwnershipOverrides["syr-aleppo"], "Islamic State");
  assert.equal(world.polityOverrides["Islamic State"].role, ISIS);
});

test("a control flip that is only a claim keeps what its side is on the claim it becomes", () => {
  const op = Object.freeze({ op: "control", regionId: "syr-aleppo", fromCode: "Syria", toCode: "Syrian Opposition", toRole: REBELS, basis: "claim" });
  assert.equal(screenTerritoryBasis({ regionControlOps: [op] }).regionClaims[0].claimantRole, REBELS);
  const already = Object.freeze({ regionId: "syr-aleppo", claimantCode: "Syrian Opposition" });
  const merged = screenTerritoryBasis({ regionControlOps: [op], regionClaims: Object.freeze([already]) }).regionClaims;
  assert.equal(merged.length, 1, "the claim the model wrote is the one kept");
  assert.equal(merged[0].claimantRole, REBELS);
  assert.equal("claimantRole" in already, false, "the model's own claim is not mutated");
  const world = apply(syriaWorld(), { regionControlOps: [op] });
  assert.deepEqual(world.regionClaimants["syr-aleppo"], ["Syrian Opposition"]);
  assert.equal(world.regionOwnershipOverrides["syr-aleppo"], "Syria", "a claim moves no border");
  assert.equal(world.polityOverrides["Syrian Opposition"].role, REBELS);
});

test("a polity change can set a role, and one that says nothing keeps it", () => {
  let world = apply(syriaWorld(), { polityChanges: [{ operation: "create", code: "Free Syrian Army", role: REBELS }] });
  assert.equal(world.polityOverrides["Free Syrian Army"].role, REBELS);
  world = apply(world, { polityChanges: [{ operation: "update", code: "Free Syrian Army", reputation: 40, role: "" }] });
  assert.equal(world.polityOverrides["Free Syrian Army"].role, REBELS, "a model's empty optional field is not a change");
  world = apply(world, { polityChanges: [{ operation: "update", code: "Free Syrian Army", role: "the new government of Syria" }] });
  assert.equal(world.polityOverrides["Free Syrian Army"].role, "the new government of Syria");
});

test("a role survives a rename", () => {
  let world = apply(syriaWorld(), { polityChanges: [{ operation: "create", code: "Free Syrian Army", role: REBELS }] });
  world = apply(world, { polityChanges: [{ operation: "rename", code: "Free Syrian Army", name: "Syrian National Army" }] });
  assert.equal(world.polityOverrides["Syrian National Army"]?.role, REBELS);
});

test("the AI's schemas offer the field wherever it can create a dispute or a polity", () => {
  for (const schema of [JUMP_FORWARD_SCHEMA, GAME_MASTER_SCHEMA]) {
    const text = JSON.stringify(schema);
    for (const field of ["claimantRole", "actorRole", "toRole"]) assert.ok(text.includes(`"${field}"`), `${field} is offered`);
    assert.ok(/"role":\{"type":"string"/.test(text), "polityChanges offers a role");
  }
});

// --- the Workshop writes it --------------------------------------------------

const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const region = (id, owner, extra = {}) => ({ type: "Feature", id, properties: { id, name: id, owner, typeId: "land", ...extra }, geometry: square });
const doc = (polities) => ({ name: "syria", metadata: { kind: "import-world" }, types: [{ id: "land", name: "Land" }], features: [], colorOverrides: {}, flags: {}, tags: {}, polities });

test("the Workshop's export carries each claimant's role, and the map's disputes as the world's own list", () => {
  const seed = buildGameSeed(
    doc({
      Syria: { name: "Syria", code: "Syria", aliases: ["Syria"], status: "active", note: "" },
      "Islamic State": { name: "Islamic State", code: "Islamic State", aliases: ["Islamic State"], status: "active", note: "", role: `  ${ISIS} ` },
    }),
    { type: "FeatureCollection", features: [region("r1", "Syria", { claimants: ["Islamic State", "Islamic State"] }), region("r2", "Syria")] },
  );
  assert.equal(seed.world.polityOverrides["Islamic State"].role, ISIS);
  assert.equal("role" in seed.world.polityOverrides.Syria, false);
  assert.deepEqual(seed.world.regionClaimants, { r1: ["Islamic State"] }, "the AI reads world.regionClaimants, so the map's disputes go there too");
  assert.deepEqual(seed.world.settledRegionClaims, [], "a scenario starts with no dispute already over");
});

test("the Workshop opens with the world's disputes stamped over the map file's, as the game reads them", () => {
  const features = new Map(["a", "b", "c", "d"].map((id) => {
    const values = new Map([["claimants", id === "a" || id === "c" ? ["From the file"] : null]]);
    return [id, { getId: () => id, get: (key) => values.get(key), set: (key, value) => values.set(key, value) }];
  }));
  const stamp = claimStamper({ claimants: { a: ["From the world"], b: ["New in the world"], d: [] }, settled: ["c"] });
  for (const feature of features.values()) stamp(feature);
  assert.deepEqual(features.get("a").get("claimants"), ["From the world"], "a world row wins");
  assert.deepEqual(features.get("b").get("claimants"), ["New in the world"]);
  assert.equal(features.get("c").get("claimants"), null, "a settled dispute has no claimants");
  assert.equal(features.get("d").get("claimants"), null, "an empty world row ends it too");
  const untouched = { getId: () => "z", set: () => assert.fail("nothing to stamp") };
  claimStamper(null)(untouched);
});

// --- the map's own disputes reach every reader -------------------------------

test("the world is read with the map file's disputes, and nothing the world says is changed", () => {
  const catalog = [
    { id: "a", claimants: ["China"] },
    { id: "b", claimants: ["Argentina"] },
    { id: "c", claimants: ["Morocco"] },
    { id: "d" },
  ];
  const world = { regionClaimants: { b: ["United Kingdom"] }, settledRegionClaims: ["c"] };
  const read = withMapClaims(world, catalog);
  assert.deepEqual(read.regionClaimants, { a: ["China"], b: ["United Kingdom"] });
  assert.deepEqual(world.regionClaimants, { b: ["United Kingdom"] }, "the world passed in is not mutated");
  assert.equal(withMapClaims(world, [{ id: "b", claimants: ["Argentina"] }]), world, "nothing to add: the same object");
  assert.equal(withMapClaims(world, null), world);
});

// --- the model reads it --------------------------------------------------------

const syriaForLookups = () => ({
  regionOwnershipOverrides: { "syr-aleppo": "Syria", "syr-raqqa": "Islamic State" },
  regionClaimants: { "syr-aleppo": ["Islamic State", "Syrian Opposition"], "syr-raqqa": ["Syria"] },
  polityOverrides: {
    Syria: { name: "Syria", aliases: [] },
    "Islamic State": { name: "Islamic State", aliases: [], role: ISIS },
    "Syrian Opposition": { name: "Syrian Opposition", aliases: [], role: REBELS },
  },
  wars: [{ id: "w1", status: "active", title: "Syrian civil war", sideA: ["Syria"], sideB: ["Syrian Opposition"] }],
});
const lookupRegions = [
  { id: "syr-aleppo", name: "Aleppo", geometry: { type: "Polygon", coordinates: [[[37, 36], [38, 36], [38, 37], [37, 37], [37, 36]]] } },
  { id: "syr-raqqa", name: "Raqqa", geometry: { type: "Polygon", coordinates: [[[38, 35], [39, 35], [39, 36], [38, 36], [38, 35]]] } },
];

test("the lookups give what each claimant is beside names that stay exact", () => {
  const context = buildLookupContext({ regions: lookupRegions, world: syriaForLookups(), player: "Syria" });
  const aleppo = executeLookup(context, "region_info", { regionId: "syr-aleppo" });
  assert.deepEqual(aleppo.claimants, ["Islamic State", "Syrian Opposition"], "names as they are, to copy into an operation");
  assert.deepEqual(aleppo.claimantRoles, { "Islamic State": ISIS, "Syrian Opposition": REBELS });
  const power = executeLookup(context, "power_info", { name: "Islamic State" });
  assert.equal(power.role, ISIS);
  const contested = executeLookup(context, "contested_regions", {});
  assert.equal(contested.claimantRoles["Syrian Opposition"], REBELS);
  const powers = executeLookup(context, "list_powers", {});
  assert.equal(powers.powers.find((entry) => entry.name === "Islamic State").role, ISIS);
  const wars = executeLookup(context, "war_ledger", {});
  assert.equal(wars.participantRoles["Syrian Opposition"], REBELS);
});

test("the territory director and the war ledger say what the claimants and the sides are", () => {
  const state = summarizeTerritorialState(syriaForLookups());
  assert.deepEqual(state.claimantRoles, { "Islamic State": ISIS, "Syrian Opposition": REBELS });
  assert.deepEqual(state.regionClaimants["syr-aleppo"], ["Islamic State", "Syrian Opposition"]);
  assert.match(buildCanonicalWarContext(syriaForLookups()), new RegExp(`Syrian Opposition is ${REBELS}`));
});

test("the prompts that list claimants and chat participants carry roles beside the names", async () => {
  const { readFileSync } = await import("node:fs");
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const gameplay = source("../src/Game/AI/gameplay.js");
  assert.ok(gameplay.includes("What these claimants are:"), "the territorial context has a legend");
  assert.ok(gameplay.includes("if (polity.role) lines.push(`What it is: ${polity.role}`);"), "the dossier");
  assert.ok(gameplay.includes("claimantRole says what it is"), "the actions reference tells the model it can write it");
  assert.ok(gameplay.includes("actorRole (on a contest) or toRole (on a control) says what it is"), "so does the jump's map-truth directive");
  assert.ok(source("../src/Game/AI/main.jsx").includes("— what it is: ${role}"), "a leader knows what its chat's participants are");
  assert.ok(source("../src/Game/AI/promptContext.js").includes("— what it is: ${entry.role}"), "the world roster");
  const reader = source("../src/runtime/gameState.js");
  assert.ok(reader.includes("withMapClaims(normalizeWorldState(raw), catalog)") && reader.includes("getPrimedScenarioRegionCatalog(),"), "both world readers see the map's disputes");
});
