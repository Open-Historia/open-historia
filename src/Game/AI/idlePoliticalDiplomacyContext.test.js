import test from "node:test";
import assert from "node:assert/strict";

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

test("idle Political World context prioritizes major and regional powers over arbitrary alphabetical actors", () => {
  const bundle = {
    game: { country: "Player" },
    chats: [],
    world: {
      politicalActors: {
        schemaVersion: 6,
        byPolity: {
          Player: actor("Player"),
          Albania: actor("Albania"),
          Brazil: actor("Brazil"),
          China: actor("China"),
          Russia: actor("Russia"),
        },
      },
      powerStatus: {
        schemaVersion: 1,
        byPolity: {
          China: { tier: "major-power" },
          Russia: { tier: "major-power" },
          Brazil: { tier: "regional-power" },
          Albania: { tier: "minor-power" },
        },
      },
      institutions: { byId: {} },
      relations: [],
      agreements: [],
      wars: [],
      puppets: [],
    },
  };

  const decisionSet = buildIdleDiplomacyPoliticalDecisionSet(bundle, { maxActors: 2 });
  assert.deepEqual(selectedActors(decisionSet), ["China", "Russia"]);
});
