import test from "node:test";
import assert from "node:assert/strict";
import { applyPoliticalEditorStateToWorld, politicalActorToEditorState } from "./countryEditorPolitical.js";

const baseActor = {
  polityKey: "Test Empire",
  government: {
    form: "Constitutional Monarchy",
    ideology: "Conservative constitutionalism",
    headOfState: "King Example I",
    headOfGovernment: "Prime Minister Old",
    status: "stable",
    coalitionName: "National Cabinet",
    rulingPartyIds: ["conservatives"],
    coalitionPartyIds: ["liberals"],
  },
  politicalSystem: { type: "constitutional_monarchy", representation: "electoral", regimeCharacter: "hybrid" },
  goals: ["Preserve the realm"],
  fears: ["Encirclement"],
  ambitions: ["Regional leadership"],
  domesticPressures: ["Industrial unrest"],
  traits: { foreignPolicy: { resolve: 77 } },
  behavioralDisposition: { assertiveness: 61, updatedAt: "1912-01-01" },
  parties: [
    { id: "conservatives", name: "Conservative Party", support: { percent: 45 }, publicPriorities: ["Order"], ruling: true },
    { id: "liberals", name: "Liberal Party", support: { percent: 35 }, coalition: true },
  ],
  powerBlocs: [{ id: "army", name: "Army High Command", influence: { percent: 70, label: "strong" }, internalStrategy: "Preserve readiness" }],
};

test("Country Editor round-trips PWv2 fields and preserves hidden canonical state", () => {
  const world = { politicalActors: { schemaVersion: 6, byPolity: { "Test Empire": baseActor } } };
  const editor = politicalActorToEditorState(baseActor);
  editor.headOfGovernment = "Prime Minister New";
  editor.governmentIdeology = "National liberal conservatism";
  editor.goalsText = "Preserve the realm\nSecure maritime access";
  editor.parties[1].coalition = false;
  editor.parties[1].ruling = true;
  editor.parties[1].supportPercent = "41";
  editor.powerBlocs[0].influencePercent = "74";

  const saved = applyPoliticalEditorStateToWorld(world, "Test Empire", editor);
  assert.equal(saved.government.headOfGovernment, "Prime Minister New");
  assert.equal(saved.government.ideology, "National liberal conservatism");
  assert.deepEqual(saved.goals, ["Preserve the realm", "Secure maritime access"]);
  assert.deepEqual(saved.government.rulingPartyIds.sort(), ["conservatives", "liberals"].sort());
  assert.deepEqual(saved.government.coalitionPartyIds, []);
  assert.equal(saved.parties.find((party) => party.id === "liberals").support.percent, 41);
  assert.equal(saved.powerBlocs[0].influence.percent, 74);
  assert.equal(saved.powerBlocs[0].internalStrategy, "Preserve readiness");
  assert.equal(saved.traits.foreignPolicy.resolve, 77);
  assert.equal(saved.behavioralDisposition.assertiveness, 61);
});

test("Country Editor can create a canonical PWv2 profile without creating a second database", () => {
  const world = {};
  const editor = politicalActorToEditorState(null);
  editor.governmentForm = "Autocracy";
  editor.governmentIdeology = "Monarchism";
  editor.headOfState = "Tsar Example II";
  editor.goalsText = "Preserve dynastic rule";
  editor.parties = [{ id: "court", name: "Court Party", ruling: true, coalition: false, supportPercent: "55" }];

  const saved = applyPoliticalEditorStateToWorld(world, "Example Empire", editor);
  assert.equal(world.politicalActors.byPolity["Example Empire"], saved);
  assert.equal(saved.government.form, "Autocracy");
  assert.equal(saved.government.headOfState, "Tsar Example II");
  assert.deepEqual(saved.government.rulingPartyIds, ["court"]);
});

test("Country Editor exposes every canonical trait while keeping unset distinct from zero", async () => {
  const { POLITICAL_TRAIT_REGISTRY } = await import("../../runtime/politicalTraitRegistry.js");
  const actor = { polityKey: "Trait Republic", traits: { caution: 0, pragmatism: 85, legacyTemper: 42 } };
  const editor = politicalActorToEditorState(actor);
  assert.equal(Object.keys(editor.traitValues).length, POLITICAL_TRAIT_REGISTRY.length);
  assert.equal(editor.traitValues.caution, "0");
  assert.equal(editor.traitValues.pragmatism, "85");
  assert.equal(editor.traitValues.militarism, "");

  const world = { politicalActors: { schemaVersion: 6, byPolity: { "Trait Republic": actor } } };
  editor.traitValues.pragmatism = "91";
  editor.traitValues.militarism = "";
  editor.perceptionsJson = JSON.stringify({ rival: { threat: 72 } });
  const saved = applyPoliticalEditorStateToWorld(world, "Trait Republic", editor);
  assert.equal(saved.traits.caution, 0);
  assert.equal(saved.traits.pragmatism, 91);
  assert.equal(saved.traits.militarism, undefined);
  assert.equal(saved.traits.legacyTemper, 42);
  assert.equal(saved.perceptions.rival.threat, 72);
});

test("Political Debug snapshot shows full trait catalog and native-derived values", async () => {
  const { politicalDebugSnapshotFromWorld } = await import("./countryEditorPolitical.js");
  const world = {
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        "Debug Republic": {
          polityKey: "Debug Republic",
          government: { form: "Parliamentary Republic" },
          traits: { pragmatism: 88, caution: 70 },
          behavioralDisposition: { assertiveness: 44 },
        },
      },
    },
  };
  const snapshot = politicalDebugSnapshotFromWorld(world, "Debug Republic");
  assert.equal(snapshot.actor.government.form, "Parliamentary Republic");
  assert.equal(snapshot.traitCatalog.traits.find((entry) => entry.key === "pragmatism").value, 88);
  assert.equal(snapshot.traitCatalog.traits.find((entry) => entry.key === "militarism").status, "unset");
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot, "decisionAuthority"));
  assert.ok(snapshot.derivedDisposition);
});
