import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEventImpactsToWorld,
  isPolityLandless,
  normalizeWorldState,
} from "../src/runtime/gameState.js";
import { buildPolityMapRefs, buildOwnerRenameMap } from "./ownerMigration.js";

// Control is not sovereignty: the map paints who administers a region, the
// sparse sovereignty ledger remembers who lawfully owns it, and the stripes
// show the difference.

const baseWorld = () => ({
  polityOverrides: {
    Ruritania: { name: "Ruritania", aliases: [], color: "", note: "" },
    Borduria: { name: "Borduria", aliases: [], color: "", note: "" },
    Syldavia: { name: "Syldavia", aliases: [], color: "", note: "" },
  },
  regionOwnershipOverrides: { r1: "Ruritania", r2: "Ruritania", r3: "Borduria" },
  regionClaimants: {},
  agreements: [],
});

const apply = (world, impacts, date = "1930-05-10") =>
  applyEventImpactsToWorld({
    colors: {},
    events: [{ id: "e1", date, title: "t", description: "d", impacts }],
    world,
  }).world;

test("a wartime control flip anchors the lawful sovereign and stripes the region", () => {
  const world = apply(baseWorld(), {
    regionControlOps: [{ op: "control", regionId: "r1", fromCode: "Ruritania", toCode: "Borduria", note: "captured" }],
  });
  assert.equal(world.regionOwnershipOverrides.r1, "Borduria", "the occupier administers the region");
  assert.equal(world.regionSovereigntyOverrides.r1, "Ruritania", "legal title stays with the sovereign");
  assert.deepEqual(world.regionClaimants.r1, ["Ruritania"], "the displaced sovereign is a claimant");
  assert.equal(isPolityLandless(world, "Ruritania"), false, "an occupied homeland is still a homeland");
});

test("a contest adds a contender without moving the border; clearing it never erases the sovereign", () => {
  let world = apply(baseWorld(), {
    regionControlOps: [{ op: "contest", regionId: "r3", fromCode: "Borduria", actorCode: "Syldavia" }],
  });
  assert.equal(world.regionOwnershipOverrides.r3, "Borduria");
  assert.deepEqual(world.regionClaimants.r3, ["Syldavia"]);
  assert.equal(world.regionSovereigntyOverrides.r3, undefined, "normal territory has no sovereignty row");

  world = apply(world, {
    regionControlOps: [{ op: "control", regionId: "r3", fromCode: "Borduria", toCode: "Syldavia" }],
  });
  assert.deepEqual(world.regionClaimants.r3, ["Borduria"]);
  world = apply(world, {
    regionControlOps: [{ op: "clear_contest", regionId: "r3", fromCode: "Syldavia", claimantCode: "Borduria" }],
  });
  assert.deepEqual(world.regionClaimants.r3, ["Borduria"], "the lawful sovereign stays visible while occupied");
  assert.equal(world.regionSovereigntyOverrides.r3, "Borduria");
});

test("a legal transfer moves the title and the administration, and settles the dispute", () => {
  let world = apply(baseWorld(), {
    regionControlOps: [{ op: "control", regionId: "r1", fromCode: "Ruritania", toCode: "Borduria" }],
  });
  world = apply(world, {
    regionTransfers: [{ regionId: "r1", fromCode: "Ruritania", toCode: "Borduria", note: "ceded by treaty" }],
  });
  assert.equal(world.regionOwnershipOverrides.r1, "Borduria");
  assert.equal(world.regionSovereigntyOverrides.r1, undefined, "sovereign and controller agree again");
  assert.equal(world.regionClaimants.r1, undefined, "the cession ends the stripe");
});

test("a legal transfer under a third-party occupation keeps the occupier and shows the new sovereign", () => {
  let world = apply(baseWorld(), {
    regionControlOps: [{ op: "control", regionId: "r2", fromCode: "Ruritania", toCode: "Syldavia" }],
  });
  world = apply(world, {
    regionTransfers: [{ regionId: "r2", fromCode: "Ruritania", toCode: "Borduria" }],
  });
  assert.equal(world.regionOwnershipOverrides.r2, "Syldavia", "the occupier still holds the ground");
  assert.equal(world.regionSovereigntyOverrides.r2, "Borduria");
  assert.ok(world.regionClaimants.r2.includes("Borduria"));
});

test("normalisation keeps the sovereignty map sparse and the override's provenance fields", () => {
  const world = normalizeWorldState({
    ...baseWorld(),
    regionSovereigntyOverrides: { r1: "Ruritania", r3: "Syldavia" },
    polityOverrides: {
      Ruritania: { name: "Ruritania", status: "active", mapRefs: { gadm0: ["rur"] }, mapLabel: "RURITANIA", verbatim: true },
    },
  });
  assert.deepEqual(world.regionSovereigntyOverrides, { r3: "Syldavia" }, "a row equal to the controller is dropped");
  assert.deepEqual(world.polityOverrides.Ruritania.mapRefs, { gadm0: ["RUR"] });
  assert.equal(world.polityOverrides.Ruritania.status, "active");
  assert.equal(world.polityOverrides.Ruritania.mapLabel, "RURITANIA");
  assert.equal(world.polityOverrides.Ruritania.verbatim, true);
});

test("the polity lifecycle: create, rename keeps the key, dissolve waits for the land to be settled", () => {
  let world = apply(baseWorld(), {
    polityChanges: [{ operation: "create", code: "Free Syldavia", name: "Free Syldavia", color: "#112233" }],
  });
  assert.equal(world.polityOverrides["Free Syldavia"].status, "active");

  world = apply(world, {
    polityChanges: [{ operation: "rename", code: "Borduria", name: "Bordurian Republic" }],
  });
  assert.equal(world.polityOverrides.Borduria.name, "Bordurian Republic", "the display name changes");
  assert.ok(world.polityOverrides.Borduria.aliases.includes("Borduria"), "the old name folds onto the key");
  assert.equal(world.regionOwnershipOverrides.r3, "Borduria", "ownership keeps the stable key");

  world = apply(world, {
    polityChanges: [{ operation: "dissolve", code: "Ruritania" }],
  });
  assert.notEqual(world.polityOverrides.Ruritania.status, "dissolved", "refused while it still holds land");

  world = apply(world, {
    regionTransfers: [{ regionId: "r1", fromCode: "Ruritania", toCode: "Borduria" }, { regionId: "r2", fromCode: "Ruritania", toCode: "Borduria" }],
    polityChanges: [{ operation: "dissolve", code: "Ruritania" }],
  });
  assert.equal(world.polityOverrides.Ruritania.status, "dissolved", "dissolved once the same event settled its land");
  assert.ok(world.polityOverrides.Ruritania, "the record survives so old history still folds onto it");
});

test("the owner migration derives stock-geography provenance per polity and never merges a split base country", () => {
  const registry = { RUR: "Ruritania", BOR: "Borduria" };
  const ctx = {
    registry,
    polityOverrides: { "Kingdom of Ruritania": { name: "Kingdom of Ruritania", aliases: [] } },
    countryNameOverrides: {},
    ownershipOverrides: { "RUR.1_1": "Kingdom of Ruritania", "RUR.2_1": "Kingdom of Ruritania", "BOR.1_1": "Kingdom of Ruritania", "BOR.2_1": "Borduria" },
    features: [
      { properties: { id: "RUR.1_1", GID_0: "RUR" } },
      { properties: { id: "RUR.2_1", GID_0: "RUR" } },
      { properties: { id: "BOR.1_1", GID_0: "BOR" } },
      { properties: { id: "BOR.2_1", GID_0: "BOR" } },
    ],
  };
  const refs = buildPolityMapRefs(ctx, buildOwnerRenameMap(ctx));
  assert.deepEqual(refs["Kingdom of Ruritania"], { gadm0: ["RUR"] }, "RUR belongs to the kingdom alone");
  assert.equal(refs.Borduria, undefined, "BOR is split between two actors, so nobody inherits it");
});
