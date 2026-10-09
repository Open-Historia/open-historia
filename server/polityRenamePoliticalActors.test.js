import test from "node:test";
import assert from "node:assert/strict";
import { reconcileMapPolityAuthoringOps, removePoliticalActorFromWorld, renamePolityInWorld } from "./polityRename.js";

const actorFixture = () => ({
  polityKey: "Old Republic",
  name: "Old Republic",
  schemaVersion: 6,
  government: {
    form: "parliamentary republic",
    headOfGovernment: { name: "Alice Prime" },
    rulingPartyIds: ["civic"],
  },
  parties: [{ id: "civic", name: "Civic Party", support: { percent: 44.5 } }],
  traits: { riskTolerance: 62, opportunism: 41 },
  perceptions: { Rivalia: { trust: -35, threat: 71 } },
  politicalPressures: {
    axes: { security: 68, economic: 42 },
    issues: [{ id: "border", pressure: 77 }],
  },
  privateSentinel: {
    hiddenFactionState: ["cabinet-split", "security-hawks"],
    nested: { keepExactly: true },
  },
});

test("polity rename re-keys one Political Actor and preserves its private state", () => {
  const actor = actorFixture();
  const world = {
    polityOverrides: {
      "Old Republic": { code: "Old Republic", name: "Old Republic", aliases: [] },
    },
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        "Old Republic": actor,
        Neighbor: { polityKey: "Neighbor", name: "Neighbor", government: { form: "republic" } },
      },
    },
    countryStats: { "Old Republic": { population: 123 } },
  };
  const before = structuredClone(world);

  const result = renamePolityInWorld(world, "Old Republic", "New Republic");

  assert.equal(result.from, "Old Republic");
  assert.equal(result.to, "New Republic");
  assert.equal(world.politicalActors.byPolity["Old Republic"].polityKey, "Old Republic", "input world must not be mutated");
  assert.deepEqual(world, before, "rename seam returns a new world rather than mutating the input");

  const byPolity = result.world.politicalActors.byPolity;
  assert.deepEqual(Object.keys(byPolity).sort(), ["Neighbor", "New Republic"].sort());
  assert.equal(byPolity["Old Republic"], undefined);
  assert.equal(byPolity["New Republic"].polityKey, "New Republic");
  assert.equal(byPolity["New Republic"].name, "New Republic");

  const expected = structuredClone(actor);
  expected.polityKey = "New Republic";
  expected.name = "New Republic";
  assert.deepEqual(byPolity["New Republic"], expected, "rename changes identity fields only; hidden PWv2 state survives byte-for-byte structurally");
  assert.deepEqual(byPolity["New Republic"].privateSentinel, actor.privateSentinel);
  assert.deepEqual(byPolity["New Republic"].perceptions, actor.perceptions);
  assert.deepEqual(byPolity["New Republic"].politicalPressures, actor.politicalPressures);
});

test("polity rename can find a stale Political Actor key by its canonical polityKey", () => {
  const actor = actorFixture();
  const world = {
    polityOverrides: {
      "Old Republic": { code: "Old Republic", name: "Old Republic", aliases: [] },
    },
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        stale_internal_key: actor,
      },
    },
  };

  const result = renamePolityInWorld(world, "Old Republic", "New Republic");
  assert.equal(result.world.politicalActors.byPolity.stale_internal_key, undefined);
  assert.equal(result.world.politicalActors.byPolity["New Republic"].polityKey, "New Republic");
  assert.deepEqual(result.world.politicalActors.byPolity["New Republic"].privateSentinel, actor.privateSentinel);
});

test("polity rename refuses to merge two Political Actor ledgers", () => {
  const world = {
    polityOverrides: {
      "Old Republic": { code: "Old Republic", name: "Old Republic", aliases: [] },
    },
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        "Old Republic": actorFixture(),
        "New Republic": { polityKey: "New Republic", name: "New Republic", privateSentinel: { separate: true } },
      },
    },
  };

  assert.throws(
    () => renamePolityInWorld(world, "Old Republic", "New Republic"),
    /cannot merge two political ledgers/i,
  );
});

test("polity rename keeps the source polity's keyed value over a stale same-name auxiliary key", () => {
  const world = {
    polityOverrides: {
      "Old Republic": { code: "Old Republic", name: "Old Republic", aliases: [] },
    },
    politicalActors: {
      schemaVersion: 6,
      byPolity: { "Old Republic": actorFixture() },
    },
    countryStats: {
      "Old Republic": { population: 123, sentinel: "source" },
      "New Republic": { population: 999, sentinel: "stale-target-key" },
      Neighbor: { population: 456, sentinel: "unrelated" },
    },
  };

  const result = renamePolityInWorld(world, "Old Republic", "New Republic");
  assert.equal(result.world.countryStats["Old Republic"], undefined);
  assert.deepEqual(result.world.countryStats["New Republic"], { population: 123, sentinel: "source" });
  assert.deepEqual(result.world.countryStats.Neighbor, { population: 456, sentinel: "unrelated" });
});

test("Political World profile deletion removes only the matching actor and preserves the rest of the world", () => {
  const world = {
    polityOverrides: {
      "Old Republic": { code: "Old Republic", name: "Old Republic", aliases: [] },
      Neighbor: { code: "Neighbor", name: "Neighbor", aliases: [] },
    },
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        stale_internal_key: actorFixture(),
        Neighbor: { polityKey: "Neighbor", name: "Neighbor", privateSentinel: { keep: true } },
      },
    },
    wars: [{ id: "w1", sideA: ["Old Republic"], sideB: ["Neighbor"] }],
    relations: [{ a: "Old Republic", b: "Neighbor", score: -20 }],
  };
  const before = structuredClone(world);

  const result = removePoliticalActorFromWorld(world, "Old Republic");

  assert.equal(result.removedKey, "stale_internal_key");
  assert.equal(result.world.politicalActors.byPolity.stale_internal_key, undefined);
  assert.deepEqual(result.world.politicalActors.byPolity.Neighbor, before.politicalActors.byPolity.Neighbor);
  assert.deepEqual(result.world.polityOverrides, before.polityOverrides, "deleting a Political World profile must not delete the polity");
  assert.deepEqual(result.world.wars, before.wars, "deleting a Political World profile must not rewrite unrelated canonical ledgers");
  assert.deepEqual(result.world.relations, before.relations);
  assert.deepEqual(world, before, "profile deletion returns a new world rather than mutating the input");
});

test("deleting a missing Political World profile is a no-op", () => {
  const world = {
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        Neighbor: { polityKey: "Neighbor", name: "Neighbor" },
      },
    },
  };
  const result = removePoliticalActorFromWorld(world, "Missing Republic");
  assert.equal(result.removedKey, "");
  assert.equal(result.world, world);
});

test("Workshop polity authoring ops migrate an existing Political Actor instead of creating a second one", () => {
  const world = {
    polityOverrides: {
      "Old Republic": { code: "Old Republic", name: "Old Republic", aliases: [] },
      Neighbor: { code: "Neighbor", name: "Neighbor", aliases: [] },
    },
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        "Old Republic": actorFixture(),
        Neighbor: { polityKey: "Neighbor", name: "Neighbor" },
      },
    },
    wars: [{ id: "w1", sideA: ["Old Republic"], sideB: ["Neighbor"] }],
    relations: [{ a: "Old Republic", b: "Neighbor", score: -20 }],
  };

  const result = reconcileMapPolityAuthoringOps(world, [
    { op: "rename", from: "Old Republic", to: "New Republic" },
  ]);

  assert.equal(result.politicalActors.byPolity["Old Republic"], undefined);
  assert.equal(result.politicalActors.byPolity["New Republic"].polityKey, "New Republic");
  assert.deepEqual(result.politicalActors.byPolity["New Republic"].privateSentinel, actorFixture().privateSentinel);
  assert.deepEqual(result.wars[0].sideA, ["New Republic"]);
  assert.equal(result.relations[0].a, "New Republic");
});

test("Workshop polity removal clears the stale Political World profile", () => {
  const world = {
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        "Old Republic": actorFixture(),
        Neighbor: { polityKey: "Neighbor", name: "Neighbor" },
      },
    },
  };

  const result = reconcileMapPolityAuthoringOps(world, [{ op: "remove", key: "Old Republic" }]);

  assert.equal(result.politicalActors.byPolity["Old Republic"], undefined);
  assert.ok(result.politicalActors.byPolity.Neighbor);
});
