import test from "node:test";
import assert from "node:assert/strict";

import { setPuppetStatesEnabled } from "../../runtime/puppets.js";
import { buildIdleDiplomacyPoliticalDecisionSet } from "./idlePoliticalDiplomacyContext.js";

const actor = (polityKey) => ({
  polityKey,
  politicalSystem: { type: "republic", representation: "electoral" },
  government: { form: "Republic" },
  parties: [],
  powerBlocs: [],
  traits: {},
  goals: [],
  fears: [],
  ambitions: [],
  domesticPressures: [],
  perceptions: {},
});

const worldWithActors = (puppets) => ({
  politicalActors: {
    schemaVersion: 6,
    byPolity: {
      Player: actor("Player"),
      "Fallback State": actor("Fallback State"),
      "Direct Puppet": actor("Direct Puppet"),
      Overlord: actor("Overlord"),
    },
  },
  institutions: { byId: {} },
  relations: [],
  agreements: [],
  wars: [],
  puppets,
});

const selectedActors = (decisionSet) => decisionSet.contexts.map((context) => context.actorPolity);

test("idle Political World context prioritizes the player's direct Puppet relationship", () => {
  setPuppetStatesEnabled(true);
  const bundle = {
    game: { country: "Player" },
    chats: [],
    world: worldWithActors([{
      id: "player-puppet",
      overlord: "Player",
      puppet: "Direct Puppet",
      kind: "satellite",
      loyalty: 55,
      secrecy: "covert",
      status: "active",
      knownTo: [],
    }]),
  };

  const decisionSet = buildIdleDiplomacyPoliticalDecisionSet(bundle, { maxActors: 1 });
  assert.deepEqual(selectedActors(decisionSet), ["Direct Puppet"]);
});

test("idle Political World context prioritizes the player's own overlord", () => {
  setPuppetStatesEnabled(true);
  const bundle = {
    game: { country: "Player" },
    chats: [],
    world: worldWithActors([{
      id: "player-subordinate",
      overlord: "Overlord",
      puppet: "Player",
      kind: "client",
      loyalty: 40,
      secrecy: "covert",
      status: "active",
      knownTo: [],
    }]),
  };

  const decisionSet = buildIdleDiplomacyPoliticalDecisionSet(bundle, { maxActors: 1 });
  assert.deepEqual(selectedActors(decisionSet), ["Overlord"]);
});

test("idle Political World context respects the Puppet States feature switch", () => {
  const bundle = {
    game: { country: "Player" },
    chats: [],
    world: worldWithActors([{
      id: "player-puppet",
      overlord: "Player",
      puppet: "Direct Puppet",
      kind: "satellite",
      loyalty: 55,
      secrecy: "open",
      status: "active",
      knownTo: [],
    }]),
  };

  setPuppetStatesEnabled(false);
  try {
    const decisionSet = buildIdleDiplomacyPoliticalDecisionSet(bundle, { maxActors: 1 });
    assert.deepEqual(selectedActors(decisionSet), ["Fallback State"]);
  } finally {
    setPuppetStatesEnabled(true);
  }
});
