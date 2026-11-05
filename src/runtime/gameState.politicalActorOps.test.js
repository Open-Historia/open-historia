/*! Open Historia Continuum — event -> PWv2 political mutation integration. */
import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld } from "./gameState.js";
import { getPoliticalProfile } from "./politicalActors.js";
import { buildPoliticalDecisionContext } from "../Game/AI/politicalDecisionContext.js";

const event = (impacts) => ({
  date: "2014-09-19",
  title: "Constitutional transition",
  description: "The Old Republic is renamed and installs a new government and head of state.",
  impacts,
});

const originalActor = {
  polityKey: "Old Republic",
  name: "Old Republic",
  politicalSystem: { type: "republic", representation: "parliamentary" },
  government: {
    form: "old parliamentary republic",
    ideology: "centrist",
    headOfState: { name: "Old President" },
    headOfGovernment: { name: "Old Prime Minister" },
  },
  leader: { name: "Old President" },
  traits: { riskTolerance: 31, opportunism: 22 },
  fears: ["constitutional breakdown"],
  ambitions: ["regional stability"],
  perceptions: { Rivalia: { trust: -30, threat: 65 } },
  politicalPressures: {
    updatedAt: "2014-09-18",
    issues: {
      security: { salience: 61, strain: 44, lean: 70, persistence: 0.82, momentum: 3 },
      reform: { salience: 72, strain: 58, lean: 65, persistence: 0.76, momentum: 5 },
    },
  },
  privateSentinel: { preserveMe: true, nested: ["cabinet", "party", "security"] },
};

test("one event may rename a polity and then mutate that same canonical Political Actor under the new name", () => {
  const { world } = applyEventImpactsToWorld({
    colors: {},
    world: {
      polityOverrides: {
        "Old Republic": { code: "Old Republic", name: "Old Republic", aliases: [] },
      },
      politicalActors: {
        schemaVersion: 1,
        byPolity: { "Old Republic": originalActor },
      },
      countryStats: {
        "Old Republic": {
          government: "old parliamentary republic",
          leader: "Old President",
          population: { total: 1000000 },
        },
      },
    },
    events: [event({
      polityChanges: [{ code: "Old Republic", name: "New Republic" }],
      politicalActorOps: [
        {
          op: "set-government",
          polityKey: "New Republic",
          argsJson: JSON.stringify({ patch: { form: "transitional parliamentary republic", ideology: "reformist" } }),
        },
        {
          op: "replace-leader",
          polityKey: "New Republic",
          argsJson: JSON.stringify({ office: "headOfState", leader: { name: "New President" } }),
        },
      ],
    })],
  });

  assert.equal(world.politicalActors.byPolity["Old Republic"], undefined, "the stale Political Actor key is removed");
  assert.deepEqual(Object.keys(world.politicalActors.byPolity), ["New Republic"], "rename does not duplicate the actor");

  const actor = getPoliticalProfile(world, "New Republic");
  assert.ok(actor);
  assert.equal(actor.polityKey, "New Republic");
  assert.equal(actor.name, "New Republic");
  assert.equal(actor.government.form, "transitional parliamentary republic");
  assert.equal(actor.government.ideology, "reformist");
  assert.equal(actor.government.headOfState.name, "New President");
  assert.equal(actor.leader.name, "New President");
  assert.deepEqual(actor.privateSentinel, originalActor.privateSentinel, "private/hidden PWv2 state survives the rename and later op");
  assert.deepEqual(actor.perceptions, originalActor.perceptions);
  assert.equal(actor.politicalPressures?.schemaVersion, 1, "pressure state is normalized to the canonical schema");
  assert.equal(actor.politicalPressures?.updatedAt, originalActor.politicalPressures.updatedAt);
  assert.deepEqual(actor.politicalPressures?.issues, originalActor.politicalPressures.issues, "normalized pressure payload survives the rename and later op");

  assert.equal(world.countryStats["Old Republic"], undefined);
  assert.equal(world.countryStats["New Republic"].government, "transitional parliamentary republic");
  assert.equal(world.countryStats["New Republic"].leader, "New President");
  assert.deepEqual(world.countryStats["New Republic"].population, { total: 1000000 }, "legacy Stats projection must not erase unrelated canonical stats");

  const nextDecisionContext = buildPoliticalDecisionContext(world, "New Republic", { maxChars: 5600 });
  assert.ok(nextDecisionContext?.text.includes("New President"), "the next bounded PWv2 context sees the new canonical leader");
  assert.ok(nextDecisionContext?.text.includes("transitional parliamentary republic"), "the next bounded PWv2 context sees the new government");
  assert.ok(!nextDecisionContext?.text.includes("Old President"), "the stale leader does not survive into decision context");
});
