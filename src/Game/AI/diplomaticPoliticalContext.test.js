import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildDiplomaticPoliticalContext,
  DIPLOMATIC_POLITICAL_DECISION_MAX_CHARS,
} from "./diplomaticPoliticalContext.js";

const makeWorld = () => ({
  politicalActors: {
    schemaVersion: 6,
    byPolity: {
      "Speaker Republic": {
        polityKey: "Speaker Republic",
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: {
          form: "Parliamentary republic",
          ideology: "Pragmatic liberal conservatism",
          headOfGovernment: "Prime Minister Delta",
          rulingPartyIds: ["speaker-party"],
        },
        traits: { riskTolerance: 72, pragmatism: 61, caution: 34 },
        goals: ["Preserve alliance cohesion", "Secure energy resilience"],
        fears: ["Domestic economic backlash"],
        ambitions: ["Shape the regional diplomatic agenda"],
        domesticPressures: ["Industrial groups resist a prolonged sanctions shock"],
        behavioralDisposition: {
          assertiveness: 68,
          riskTolerance: 72,
          escalationPressure: 55,
          compromisePressure: 38,
          threatPerception: 74,
        },
        perceptions: {
          "Player State": { threat: 18, opportunity: 66, reliability: 71 },
        },
        parties: [{
          id: "speaker-party",
          name: "Civic Coalition",
          ideology: "Liberal conservatism",
          ruling: true,
          support: { percent: 44 },
          privateGoal: "SECRET speaker goal may guide reasoning but must not be presented as public fact",
        }],
        powerBlocs: [],
      },
      "Player State": {
        polityKey: "Player State",
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: {
          form: "Parliamentary republic",
          ideology: "Centrist coalition",
          headOfGovernment: "Prime Minister Player",
          rulingPartyIds: ["player-party"],
        },
        traits: { paranoia: 99 },
        goals: ["Publicly defend sovereignty"],
        fears: ["SECRET PLAYER FEAR MUST NOT LEAK"],
        ambitions: ["SECRET PLAYER AMBITION MUST NOT LEAK"],
        behavioralDisposition: { assertiveness: 99, riskTolerance: 99 },
        parties: [{ id: "player-party", name: "Player Party", ruling: true }],
        powerBlocs: [],
      },
    },
  },
  relations: [{ id: "speaker-player", a: "Speaker Republic", b: "Player State", status: "friendly", score: 42 }],
  agreements: [],
  wars: [],
  institutions: {},
});

test("Phase009C diplomacy uses the speaking polity's bounded Political Decision Context", () => {
  const result = buildDiplomaticPoliticalContext({
    world: makeWorld(),
    speakingAs: "Speaker Republic",
    playerCountry: "Player State",
  });

  assert.ok(result);
  assert.equal(result.context.actorPolity, "Speaker Republic");
  assert.equal(result.context.counterpartPolity, "Player State");
  assert.match(result.text, /Private Political Reasoning — Diplomatic Speaker/);
  assert.match(result.text, /Domestic economic backlash|Industrial groups resist a prolonged sanctions shock/i);
  assert.match(result.text, /Preserve alliance cohesion/i);
  assert.match(result.text, /internal reasoning context, not a speech to quote/i);
  assert.ok(result.context.text.length <= DIPLOMATIC_POLITICAL_DECISION_MAX_CHARS);
});

test("Phase009C keeps counterpart hidden Political Actor state outside the diplomatic speaker capsule", () => {
  const result = buildDiplomaticPoliticalContext({
    world: makeWorld(),
    speakingAs: "Speaker Republic",
    playerCountry: "Player State",
  });

  assert.ok(result);
  assert.doesNotMatch(result.text, /SECRET PLAYER FEAR MUST NOT LEAK/);
  assert.doesNotMatch(result.text, /SECRET PLAYER AMBITION MUST NOT LEAK/);
  assert.doesNotMatch(result.text, /paranoia.*very high/i);
  assert.match(result.text, /Counterpart public\/intel/i);
});

test("Phase009C fails open for missing Political Actor state without fabricating a capsule", () => {
  const result = buildDiplomaticPoliticalContext({
    world: makeWorld(),
    speakingAs: "Unknown Polity",
    playerCountry: "Player State",
  });
  assert.equal(result, null);
});

test("latest Beta leader prompt attaches the Phase009C political bridge without reviving old institution chat plumbing", () => {
  const mainSource = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  assert.match(mainSource, /import \{ buildDiplomaticPoliticalContext \} from "\.\/diplomaticPoliticalContext\.js"/);
  assert.match(mainSource, /const politicalDecision = buildDiplomaticPoliticalContext\(\{/);
  assert.match(mainSource, /world: worldData/);
  assert.match(mainSource, /speakingAs: speaker/);
  assert.match(mainSource, /playerCountry: playerCountry \|\| gameData\?\.country/);
  assert.match(mainSource, /\$\{rendered\}\$\{politicalSection\}\$\{espionage\}/);
  assert.doesNotMatch(mainSource, /institutionSection/);
});
