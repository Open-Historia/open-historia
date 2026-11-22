import test from "node:test";
import assert from "node:assert/strict";
import { applyPoliticalEditorStateToWorld, politicalActorToEditorState, politicalEditorComposition } from "./countryEditorPolitical.js";

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

test("scenario political editor round-trips legislature and party electoral detail without erasing hidden state", () => {
  const actor = structuredClone(baseActor);
  actor.government.legislature = "National Assembly";
  actor.government.legislatureSeats = 200;
  actor.government.nextElection = "2030-06-01";
  actor.parties[0] = {
    ...actor.parties[0],
    nameNative: "Conservatori",
    shortNameNative: "CON",
    ideologyFamily: "socialLiberalism",
    subideology: "Constitutional Liberalism",
    role: "governing",
    seats: 85,
    founded: "1912",
    color: "#123456",
    internalStrategy: "Protect existing government commitments",
  };
  actor.parties[1].seats = 65;

  const editor = politicalActorToEditorState(actor);
  assert.equal(editor.legislature, "National Assembly");
  assert.equal(editor.legislatureSeats, "200");
  assert.equal(editor.nextElection, "2030-06-01");
  assert.equal(editor.parties[0].nameNative, "Conservatori");
  assert.equal(editor.parties[0].shortNameNative, "CON");
  assert.equal(editor.parties[0].subideology, "Constitutional Liberalism");
  assert.equal(editor.parties[0].role, "governing");
  assert.equal(editor.parties[0].seats, "85");
  assert.equal(editor.parties[0].founded, "1912");
  assert.equal(editor.parties[0].color, "#123456");

  editor.legislatureSeats = "190";
  editor.nextElection = "2031-06-01";
  editor.parties[0].seats = "80";
  editor.parties[1].seats = "70";
  const world = { politicalActors: { byPolity: { "Test Empire": actor } } };
  const saved = applyPoliticalEditorStateToWorld(world, "Test Empire", editor);
  assert.equal(saved.government.legislature, "National Assembly");
  assert.equal(saved.government.legislatureSeats, 190);
  assert.equal(saved.government.nextElection, "2031-06-01");
  assert.equal(saved.parties[0].seats, 80);
  assert.equal(saved.parties[1].seats, 70);
  assert.equal(saved.parties[0].nameNative, "Conservatori");
  assert.equal(saved.parties[0].shortNameNative, "CON");
  assert.equal(saved.parties[0].founded, "1912");
  assert.equal(saved.parties[0].color, "#123456");
  assert.equal(saved.parties[0].internalStrategy, "Protect existing government commitments");
});

test("electoral authoring rejects impossible seats, invalid counts and duplicate party IDs without changing the world", () => {
  const actor = structuredClone(baseActor);
  const world = { politicalActors: { byPolity: { "Test Empire": actor } } };
  const editor = politicalActorToEditorState(actor);
  editor.legislatureSeats = "100";
  editor.parties[0].seats = "70";
  editor.parties[1].seats = "50";
  assert.throws(() => applyPoliticalEditorStateToWorld(world, "Test Empire", editor), /exceed|more seats/i);
  assert.deepEqual(world.politicalActors.byPolity["Test Empire"], actor);

  editor.parties[0].seats = "-1";
  assert.throws(() => applyPoliticalEditorStateToWorld(world, "Test Empire", editor), /non-negative|whole number|integer/i);
  editor.parties[0].seats = "50.5";
  assert.throws(() => applyPoliticalEditorStateToWorld(world, "Test Empire", editor), /whole number|integer/i);

  editor.parties[0].seats = "50";
  editor.parties[1].seats = "50";
  editor.parties[1].id = editor.parties[0].id;
  assert.throws(() => applyPoliticalEditorStateToWorld(world, "Test Empire", editor), /duplicate.*party id/i);
  editor.parties[1].id = editor.parties[0].id.toUpperCase();
  assert.throws(() => applyPoliticalEditorStateToWorld(world, "Test Empire", editor), /duplicate.*party id/i);

  editor.parties[1].id = "liberals";
  editor.parties[0].supportPercent = "75";
  editor.parties[1].supportPercent = "40";
  assert.throws(() => applyPoliticalEditorStateToWorld(world, "Test Empire", editor), /support.*exceed.*100/i);
  assert.deepEqual(world.politicalActors.byPolity["Test Empire"], actor);
});

test("an unnamed removed party cannot shift governing roles onto the wrong surviving party", () => {
  const actor = structuredClone(baseActor);
  const editor = politicalActorToEditorState(actor);
  editor.parties[0].name = "";
  editor.parties[1].ruling = false;
  editor.parties[1].coalition = true;
  const world = { politicalActors: { byPolity: { "Test Empire": actor } } };
  const saved = applyPoliticalEditorStateToWorld(world, "Test Empire", editor);
  assert.equal(saved.parties.length, 1);
  assert.equal(saved.parties[0].id, "liberals");
  assert.deepEqual(saved.government.rulingPartyIds, []);
  assert.deepEqual(saved.government.coalitionPartyIds, ["liberals"]);
});

test("a zero-seat party stays distinct from a party whose seats are unset", () => {
  const actor = structuredClone(baseActor);
  const world = { politicalActors: { byPolity: { "Test Empire": actor } } };
  const editor = politicalActorToEditorState(actor);
  assert.equal(editor.parties[0].seats, "");
  editor.legislatureSeats = "200";
  editor.parties[0].seats = "0";
  editor.parties[1].seats = "";
  const saved = applyPoliticalEditorStateToWorld(world, "Test Empire", editor);
  assert.equal(saved.parties[0].seats, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(saved.parties[1], "seats"), false);
});

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


test("renaming stable party and bloc IDs preserves hidden canonical fields while editor row identity stays separate", () => {
  const actor = structuredClone(baseActor);
  actor.parties[0].aliases = ["Old Tories"];
  actor.parties[0].internalStrategy = "Preserve the landed coalition";
  actor.parties[0].color = "#123456";
  actor.powerBlocs[0].privateGoal = "Preserve officer autonomy";
  actor.powerBlocs[0].color = "#654321";
  const world = { politicalActors: { schemaVersion: 6, byPolity: { "Test Empire": actor } } };
  const editor = politicalActorToEditorState(actor);
  const partyKey = editor.parties[0]._editorKey;
  const blocKey = editor.powerBlocs[0]._editorKey;
  assert.notEqual(partyKey, editor.parties[0].id);
  assert.notEqual(blocKey, editor.powerBlocs[0].id);
  editor.parties[0].id = "new-conservatives";
  editor.powerBlocs[0].id = "new-army";
  const saved = applyPoliticalEditorStateToWorld(world, "Test Empire", editor);
  const party = saved.parties.find((entry) => entry.id === "new-conservatives");
  const bloc = saved.powerBlocs.find((entry) => entry.id === "new-army");
  assert.deepEqual(party.aliases, ["Old Tories"]);
  assert.equal(party.internalStrategy, "Preserve the landed coalition");
  assert.equal(party.color, "#123456");
  assert.equal(bloc.privateGoal, "Preserve officer autonomy");
  assert.equal(bloc.color, "#654321");
  assert.ok(saved.government.rulingPartyIds.includes("new-conservatives"));
});

// Review of #937 (2026-11-03): a record that already held more seats than its legislature (an older AI compile)
// blocked every save of that country, a 0-seat legislature was saved as none but counted as a total of 0, and any
// text passed as a party colour.
test("a record already over its totals still saves other edits, a 0-seat legislature is no total, and colours are hex", () => {
  const actor = structuredClone(baseActor);
  actor.government.legislatureSeats = 100;
  actor.parties[0].seats = 70;
  actor.parties[1].seats = 50;
  const world = { politicalActors: { byPolity: { "Test Empire": actor } } };
  const editor = politicalActorToEditorState(actor);
  editor.nextElection = "2031-06-01";
  const saved = applyPoliticalEditorStateToWorld(structuredClone(world), "Test Empire", editor);
  assert.equal(saved.government.nextElection, "2031-06-01", "an unrelated edit saves");
  editor.parties[0].seats = "75";
  assert.throws(() => applyPoliticalEditorStateToWorld(structuredClone(world), "Test Empire", editor), /exceeding the legislature's 100 seats/);
  editor.parties[0].seats = "60";
  assert.doesNotThrow(() => applyPoliticalEditorStateToWorld(structuredClone(world), "Test Empire", editor), "moving towards the total saves");

  const fresh = politicalActorToEditorState(structuredClone(baseActor));
  fresh.legislatureSeats = "0";
  fresh.parties[0].seats = "10";
  assert.equal(politicalEditorComposition(fresh).totalSeats, null);
  assert.doesNotThrow(() => politicalEditorComposition(fresh));

  fresh.parties[0].color = "dark blue";
  assert.throws(() => applyPoliticalEditorStateToWorld({ politicalActors: { byPolity: { "Test Empire": structuredClone(baseActor) } } }, "Test Empire", fresh), /hex colour/);
  fresh.parties[0].color = "#2BC1F3";
  assert.equal(applyPoliticalEditorStateToWorld({ politicalActors: { byPolity: { "Test Empire": structuredClone(baseActor) } } }, "Test Empire", fresh).parties[0].color, "#2BC1F3");
});

test("freeform ideology and political position save without erasing legacy taxonomy and hidden state", () => {
  const actor = structuredClone(baseActor);
  actor.parties[0].ideologyFamily = "authoritarianDemocracy";
  actor.parties[0].subideology = "Kleptocracy";
  actor.parties[0].internalStrategy = "Sensitive internal plan";
  const editor = politicalActorToEditorState(actor);
  assert.equal(editor.parties[0].politicalPosition, "");
  editor.parties[0].ideology = "Statism, civic nationalism";
  editor.parties[0].politicalPosition = "Right-wing";
  const world = { politicalActors: { byPolity: { "Test Empire": actor } } };
  const saved = applyPoliticalEditorStateToWorld(world, "Test Empire", editor);
  assert.equal(saved.parties[0].ideology, "Statism, civic nationalism");
  assert.equal(saved.parties[0].politicalPosition, "Right-wing");
  assert.equal(saved.parties[0].ideologyFamily, "authoritarianDemocracy");
  assert.equal(saved.parties[0].subideology, "Kleptocracy");
  assert.equal(saved.parties[0].internalStrategy, "Sensitive internal plan");
  assert.equal(actor.parties[0].politicalPosition, undefined);
  const roundtrip = politicalActorToEditorState(saved);
  assert.equal(roundtrip.parties[0].politicalPosition, "Right-wing");
  roundtrip.parties[0].politicalPosition = "";
  const cleared = applyPoliticalEditorStateToWorld(
    { politicalActors: { byPolity: { "Test Empire": saved } } }, "Test Empire", roundtrip);
  assert.equal(cleared.parties[0].politicalPosition, undefined);
  assert.equal(cleared.parties[0].subideology, "Kleptocracy");
});
