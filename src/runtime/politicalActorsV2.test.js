import test from "node:test";
import assert from "node:assert/strict";

import {
  POLITICAL_ACTORS_SCHEMA_VERSION,
  derivePoliticalDecisionAuthority,
  normalizePoliticalActors,
  normalizePoliticalActorRecord,
  resolvePoliticalParty,
  resolvePoliticalPowerBloc,
} from "./politicalActors.js";

test("decision authority derives operative executives without country hardcodes", () => {
  const parliamentary = derivePoliticalDecisionAuthority({
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: {
      form: "Federal parliamentary republic",
      headOfState: "Ceremonial President",
      headOfGovernment: "Federal Chancellor",
    },
    // Legacy normalization commonly copied the head of state here.
    leader: "Ceremonial President",
  });
  assert.equal(parliamentary.primary, "Federal Chancellor");
  assert.equal(parliamentary.role, "head-of-government");
  assert.equal(parliamentary.model, "parliamentary-executive");

  const partyState = derivePoliticalDecisionAuthority({
    politicalSystem: { type: "one_party_state", representation: "party_state" },
    government: { headOfState: "Formal Chair", headOfGovernment: "Premier" },
    leader: "Paramount Secretary",
  });
  assert.equal(partyState.primary, "Paramount Secretary");
  assert.equal(partyState.role, "supreme-political-leader");

  const semiPresidential = derivePoliticalDecisionAuthority({
    politicalSystem: { type: "semi_presidential_republic", representation: "electoral" },
    government: { headOfState: "President", headOfGovernment: "Prime Minister" },
    leader: "President",
  });
  assert.equal(semiPresidential.primary, "President");
  assert.equal(semiPresidential.model, "shared-semi-presidential-executive");
  assert.deepEqual(
    semiPresidential.participants.map((entry) => entry.officeholder),
    ["President", "Prime Minister"],
  );
});

test("Political Actors upgrades legacy party-name government references to stable party ids", () => {
  const normalized = normalizePoliticalActors({
    schemaVersion: 1,
    byPolity: {
      Ukraine: {
        polityKey: "Ukraine",
        government: {
          form: "Semi-presidential republic",
          rulingParties: ["Батьківщина"],
          coalition: ["UDAR", "Свобода"],
        },
        parties: [
          {
            id: "batkivshchyna",
            name: "Батьківщина",
            aliases: ["Batkivshchyna", "Fatherland"],
            ruling: true,
            support: { percent: 22.2 },
          },
          {
            id: "udar",
            name: "УДАР",
            aliases: ["UDAR"],
            coalition: true,
            support: { percent: 16.4 },
          },
          {
            id: "svoboda",
            name: "Свобода",
            aliases: ["Svoboda"],
            coalition: true,
            support: { percent: 5.2 },
          },
        ],
        goals: ["Preserve territorial integrity"],
        fears: ["State fragmentation"],
        ambitions: ["Deepen European integration"],
        traits: { riskTolerance: 64 },
        perceptions: { Russia: { threat: 91 } },
      },
    },
  });

  assert.equal(normalized.schemaVersion, POLITICAL_ACTORS_SCHEMA_VERSION);
  assert.equal(normalized.schemaVersion, 6);

  const actor = normalized.byPolity.Ukraine;
  assert.deepEqual(actor.government.rulingPartyIds, ["batkivshchyna"]);
  assert.deepEqual(actor.government.coalitionPartyIds, ["udar", "svoboda"]);
  assert.deepEqual(actor.government.rulingParties, ["Батьківщина"]);
  assert.deepEqual(actor.government.coalition, ["УДАР", "Свобода"]);
  assert.equal(actor.parties.find((party) => party.id === "batkivshchyna").ruling, true);
  assert.equal(actor.parties.find((party) => party.id === "udar").coalition, true);
  assert.equal(actor.traits.riskTolerance, 64);
  assert.equal(actor.perceptions.Russia.threat, 91);
});

test("party identity resolves ids, local names, short names, and aliases to one canonical record", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Ukraine: {
          polityKey: "Ukraine",
          parties: [
            {
              id: "batkivshchyna",
              name: "Батьківщина",
              shortName: "Батьківщина",
              aliases: ["Batkivshchyna", "Fatherland"],
            },
          ],
        },
      },
    }),
  };

  const canonical = resolvePoliticalParty(world, "Ukraine", "batkivshchyna");
  assert.ok(canonical);
  assert.equal(resolvePoliticalParty(world, "Ukraine", "Батьківщина"), canonical);
  assert.equal(resolvePoliticalParty(world, "Ukraine", "Batkivshchyna"), canonical);
  assert.equal(resolvePoliticalParty(world, "Ukraine", "Fatherland"), canonical);
});

test("normalization derives stable ids for legacy parties and bounds canonical numeric inputs", () => {
  const actor = normalizePoliticalActors({
    byPolity: {
      Testland: {
        government: { approval: 140, stability: -4 },
        parties: [
          { name: "National People's Front", support: { percent: 103.44 } },
        ],
        traits: { riskTolerance: 144, paranoia: -5 },
      },
    },
  }).byPolity.Testland;

  assert.equal(actor.parties[0].id, "national-people-s-front");
  assert.equal(actor.parties[0].support.percent, 100);
  assert.equal(actor.government.approval, 100);
  assert.equal(actor.government.stability, 0);
  assert.equal(actor.traits.riskTolerance, 100);
  assert.equal(actor.traits.paranoia, 0);
});

test("government ideology, national strategy, leadership traits, and perceptions remain separate owners", () => {
  const actor = normalizePoliticalActors({
    byPolity: {
      Testland: {
        ideology: "Legacy liberal",
        government: { ideology: "National conservative" },
        goals: ["Preserve regional influence"],
        fears: ["Encirclement"],
        traits: { opportunism: 72 },
        perceptions: { Rival: { trust: 18 } },
      },
    },
  }).byPolity.Testland;

  assert.equal(actor.government.ideology, "National conservative");
  assert.deepEqual(actor.goals, ["Preserve regional influence"]);
  assert.deepEqual(actor.fears, ["Encirclement"]);
  assert.equal(actor.traits.opportunism, 72);
  assert.equal(actor.perceptions.Rival.trust, 18);
  assert.equal("ideology" in actor, false);
});

test("absolute monarchies infer a court-faction representation without inventing fake parties", () => {
  const actor = normalizePoliticalActors({
    byPolity: {
      Kingdom: {
        government: { form: "Absolute monarchy", headOfState: "King A" },
        powerBlocs: [
          { id: "court", name: "Royal Court", influence: { label: "Dominant" } },
          { id: "army", name: "Military establishment", influence: { percent: 28 } },
        ],
      },
    },
  }).byPolity.Kingdom;

  assert.equal(actor.politicalSystem.type, "absolute_monarchy");
  assert.equal(actor.politicalSystem.representation, "court_factions");
  assert.deepEqual(actor.parties, []);
  assert.equal(actor.powerBlocs[0].influence.label, "Dominant");
  assert.equal(actor.powerBlocs[1].influence.percent, 28);
});

test("power-bloc identity resolves stable ids, names, short names, and aliases without becoming party identity", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Sultanate: {
          politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
          powerBlocs: [{
            id: "royal-court",
            name: "Royal Court",
            shortName: "Court",
            aliases: ["Palace"],
          }],
        },
      },
    }),
  };

  const canonical = resolvePoliticalPowerBloc(world, "Sultanate", "royal-court");
  assert.ok(canonical);
  assert.equal(resolvePoliticalPowerBloc(world, "Sultanate", "Royal Court"), canonical);
  assert.equal(resolvePoliticalPowerBloc(world, "Sultanate", "Court"), canonical);
  assert.equal(resolvePoliticalPowerBloc(world, "Sultanate", "Palace"), canonical);
  assert.equal(resolvePoliticalParty(world, "Sultanate", "Royal Court"), null);
});

test("explicit political representation wins over inference and permits qualitative influence", () => {
  const actor = normalizePoliticalActors({
    byPolity: {
      Republic: {
        government: { form: "Republic" },
        politicalSystem: { type: "personalist_regime", representation: "elite_factions" },
        powerBlocs: [{ name: "Security apparatus", influence: { label: "Strong" } }],
      },
    },
  }).byPolity.Republic;

  assert.equal(actor.politicalSystem.type, "personalist_regime");
  assert.equal(actor.politicalSystem.representation, "elite_factions");
  assert.equal(actor.powerBlocs[0].influence.label, "Strong");
  assert.equal("percent" in actor.powerBlocs[0].influence, false);
});

test("quantitative political landscape metadata survives normalization without conflating support and influence", () => {
  const actor = normalizePoliticalActorRecord({
    polityKey: "Republic X",
    politicalSystem: { type: "one_party_state", representation: "party_state" },
    parties: [{
      id: "workers",
      name: "Workers Party",
      support: { percent: 72, basis: "generated-estimate" },
      influence: { percent: 100, basis: "generated-estimate", label: "Dominant" },
    }],
    powerBlocs: [{
      id: "security",
      name: "Security Establishment",
      influence: { percent: 28, basis: "native-fallback-estimate", label: "Strong" },
    }],
  }, "Republic X");

  assert.deepEqual(actor.parties[0].support, { percent: 72, basis: "generated-estimate" });
  assert.deepEqual(actor.parties[0].influence, { percent: 100, basis: "generated-estimate", label: "Dominant" });
  assert.deepEqual(actor.powerBlocs[0].influence, { percent: 28, basis: "native-fallback-estimate", label: "Strong" });
});

test("null political landscape values stay missing instead of normalizing to fake zero percent", () => {
  const actor = normalizePoliticalActorRecord({
    polityKey: "Nullia",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    parties: [
      { id: "a", name: "A", support: null },
      { id: "b", name: "B", support: { percent: null } },
    ],
    powerBlocs: [{ id: "court", name: "Court", influence: { percent: null } }],
  }, "Nullia");

  assert.equal(actor.parties[0].support, undefined);
  assert.equal(actor.parties[1].support, undefined);
  assert.equal(actor.powerBlocs[0].influence, undefined);
});

test("regime character survives Political Actor normalization independently of system form and representation", () => {
  const actor = normalizePoliticalActorRecord({
    polityKey: "Russia",
    politicalSystem: {
      type: "semi_presidential_republic",
      representation: "electoral",
      regimeCharacter: "authoritarian",
    },
    government: { form: "Federal semi-presidential republic" },
  }, "Russia");

  assert.equal(actor.politicalSystem.type, "semi_presidential_republic");
  assert.equal(actor.politicalSystem.representation, "electoral");
  assert.equal(actor.politicalSystem.regimeCharacter, "authoritarian");
});
