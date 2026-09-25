import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPoliticalActorOperation,
  applyPoliticalActorOperations,
  POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE,
  POLITICAL_ACTOR_GENERATED_OP_EXAMPLES,
  POLITICAL_ACTOR_OPS,
  validatePoliticalActorOperationShape,
} from "./politicalActorOps.js";
import { getPoliticalProfile, normalizePoliticalActors } from "./politicalActors.js";

test("live Baltic GM repair shorthand is rejected before it can masquerade as a canonical PWv2 write", () => {
  const system = validatePoliticalActorOperationShape({
    op: "set-political-system",
    polityKey: "The Baltic Union",
    system: "Constitutional Republic",
  }, { allowNativeDerived: false });
  assert.match(system, /patch\/system object/i);

  const government = validatePoliticalActorOperationShape({
    op: "set-government",
    polityKey: "The Baltic Union",
    government: "Parliamentary Democracy",
  }, { allowNativeDerived: false });
  assert.match(government, /non-empty patch object/i);
});

test("structured system/government patches are accepted", () => {
  assert.equal(validatePoliticalActorOperationShape({
    op: "set-political-system",
    polityKey: "The Baltic Union",
    patch: {
      type: "parliamentary_republic",
      representation: "electoral",
      regimeCharacter: "democratic",
      publicLabel: "Parliamentary Republic",
    },
  }, { allowNativeDerived: false }), "");

  assert.equal(validatePoliticalActorOperationShape({
    op: "set-government",
    polityKey: "The Baltic Union",
    patch: { form: "Parliamentary Republic" },
  }, { allowNativeDerived: false }), "");
});

test("set-government no longer reports an empty/no-op patch as applied", () => {
  const world = { politicalActors: { schemaVersion: 1, byPolity: {} } };
  const outcome = applyPoliticalActorOperation(world, {
    op: "set-government",
    polityKey: "The Baltic Union",
    patch: {},
  });
  assert.equal(outcome.applied, false);
  assert.match(outcome.error, /non-empty patch object/i);
});

test("generated ops cannot write native-derived pressure/disposition state", () => {
  const error = validatePoliticalActorOperationShape({
    op: "set-behavioral-disposition",
    polityKey: "Ruritania",
    state: { risk: 70 },
  }, { allowNativeDerived: false });
  assert.match(error, /native-derived/i);
});


test("every provider-writable political operation has one prompt example that passes native shape validation", () => {
  const nativeOnly = new Set([
    POLITICAL_ACTOR_OPS.SET_POLITICAL_PRESSURES,
    POLITICAL_ACTOR_OPS.SET_BEHAVIORAL_DISPOSITION,
  ]);
  const expected = Object.values(POLITICAL_ACTOR_OPS).filter((op) => !nativeOnly.has(op)).sort();
  const actual = Object.keys(POLITICAL_ACTOR_GENERATED_OP_EXAMPLES).sort();
  assert.deepEqual(actual, expected);

  for (const [op, args] of Object.entries(POLITICAL_ACTOR_GENERATED_OP_EXAMPLES)) {
    const error = validatePoliticalActorOperationShape({
      op,
      polityKey: "Example Republic",
      ...JSON.parse(JSON.stringify(args)),
    }, { allowNativeDerived: false });
    assert.equal(error, "", `${op} example drifted from native validation: ${error}`);
    assert.match(POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE, new RegExp(`(^|\\n)- ${op} argsJson=`));
  }
});

test("create-party guidance preserves the required nested party envelope", () => {
  assert.match(POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE, /create-party argsJson=\{\"party\":\{/);
  assert.match(POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE, /party fields MUST be nested under party/);

  const valid = validatePoliticalActorOperationShape({
    op: "create-party",
    polityKey: "The Baltic Union",
    party: { id: "liberals", name: "Baltic Liberal Party", ideology: "liberalism" },
  }, { allowNativeDerived: false });
  assert.equal(valid, "");

  const malformed = validatePoliticalActorOperationShape({
    op: "create-party",
    polityKey: "The Baltic Union",
    id: "liberals",
    name: "Baltic Liberal Party",
    ideology: "liberalism",
  }, { allowNativeDerived: false });
  assert.match(malformed, /requires a party with a name or id/i);
});


test("a foundational election bundle applies in dependency order to a sparse emergent actor", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          government: { form: "Parliamentary Republic" },
          politicalSystem: { type: "parliamentary_republic", representation: "electoral", regimeCharacter: "democratic" },
        },
      },
    }),
  };

  const result = applyPoliticalActorOperations(world, [
    { op: "create-party", polityKey: "The Baltic Union", party: { id: "liberals", name: "Baltic Liberal Party", ideology: "liberalism" } },
    { op: "create-party", polityKey: "The Baltic Union", party: { id: "agrarians", name: "Baltic Agrarian Union", ideology: "agrarianism" } },
    { op: "set-party-support", polityKey: "The Baltic Union", partyId: "liberals", percent: 42 },
    { op: "set-party-support", polityKey: "The Baltic Union", partyId: "agrarians", percent: 31 },
    { op: "set-party-leader", polityKey: "The Baltic Union", partyId: "liberals", leader: { name: "Example Liberal Leader" } },
    { op: "form-coalition", polityKey: "The Baltic Union", rulingPartyIds: ["liberals"], coalitionPartyIds: ["agrarians"], coalitionName: "Liberal-Agrarian Coalition" },
    { op: "replace-leader", polityKey: "The Baltic Union", office: "headOfGovernment", leader: { name: "Example Prime Minister" } },
    { op: "set-strategy", polityKey: "The Baltic Union", patch: { goals: ["Consolidate sovereignty"], fears: ["Russian reconquest"], ambitions: ["Integrate the Baltic state"], domesticPressures: ["Regional integration"] } },
    { op: "set-traits", polityKey: "The Baltic Union", traits: { pragmatism: 75, consensusDriven: 70 } },
    { op: "set-perceptions", polityKey: "The Baltic Union", perceptions: { "Russian Empire": { threat: 90, opportunity: 20, weakness: 35, cohesionEstimate: 70 } } },
  ]);

  assert.equal(result.failed, 0, JSON.stringify(result.results, null, 2));
  assert.equal(result.applied, 10);
  const actor = getPoliticalProfile(world, "The Baltic Union");
  assert.equal(actor.parties.length, 2);
  assert.equal(actor.parties.find((party) => party.id === "liberals")?.support?.percent, 42);
  assert.equal(actor.government.rulingPartyIds[0], "liberals");
  assert.equal(actor.government.coalitionPartyIds[0], "agrarians");
  assert.equal(actor.government.headOfGovernment?.name, "Example Prime Minister");
  assert.deepEqual(actor.goals, ["Consolidate sovereignty"]);
  assert.equal(actor.traits.pragmatism, 75);
  assert.equal(actor.perceptions["Russian Empire"].threat, 90);
});

test("generated guidance makes governing membership distinct from government metadata", () => {
  assert.match(POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE, /set-government[^\n]*does NOT establish governing party membership/i);
  assert.match(POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE, /form-coalition[^\n]*single-party or minority government/i);
  assert.match(POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE, /set-government plus replace-leader alone does not say which party or parties govern/i);
});

test("generated guidance tells government formation to reuse existing canonical party ids", () => {
  assert.match(POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE, /reuse their exact existing ids/i);
  assert.match(POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE, /do not create replacement\/near-duplicate parties/i);
});

test("native form-coalition rejects unknown parties while accepting parties created earlier in sequence", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          parties: [{ id: "existing-party", name: "Existing Party" }],
        },
      },
    }),
  };

  const invalid = applyPoliticalActorOperation(world, {
    op: "form-coalition",
    polityKey: "The Baltic Union",
    rulingPartyIds: ["invented-party"],
    coalitionPartyIds: [],
  });
  assert.equal(invalid.applied, false);
  assert.match(invalid.error || "", /Unknown party: invented-party/i);

  const result = applyPoliticalActorOperations(world, [
    { op: "create-party", polityKey: "The Baltic Union", party: { id: "new-party", name: "New Party" } },
    { op: "form-coalition", polityKey: "The Baltic Union", rulingPartyIds: ["existing-party"], coalitionPartyIds: ["new-party"] },
  ]);
  assert.equal(result.failed, 0, JSON.stringify(result.results, null, 2));
  const actor = getPoliticalProfile(world, "The Baltic Union");
  assert.deepEqual(actor.government.rulingPartyIds, ["existing-party"]);
  assert.deepEqual(actor.government.coalitionPartyIds, ["new-party"]);
});
