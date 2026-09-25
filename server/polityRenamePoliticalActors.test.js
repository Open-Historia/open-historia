import test from "node:test";
import assert from "node:assert/strict";
import { renamePolityInWorld } from "./polityRename.js";

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
