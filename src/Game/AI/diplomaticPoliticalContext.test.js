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
        goals: [
          "Preserve alliance cohesion",
          "Secure energy resilience",
          "Negotiate reciprocal maritime inspection rules when shipping access is contested",
        ],
        fears: ["Domestic economic backlash", "A shipping blockade could isolate major ports"],
        ambitions: ["Shape the regional diplomatic agenda"],
        domesticPressures: [
          "Industrial groups resist a prolonged sanctions shock",
          "Port operators demand predictable maritime inspection access",
        ],
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
  assert.match(result.text, /CURRENT-STATE AUTHORITY: this capsule is the actor's canonical current political state\. Scenario\/world-before-round-one temperament is starting context only/);
  assert.match(result.text, /Domestic economic backlash|Industrial groups resist a prolonged sanctions shock/i);
  assert.match(result.text, /Preserve alliance cohesion/i);
  assert.match(result.text, /internal reasoning context, not a speech to quote/i);
  assert.ok(result.context.text.length <= DIPLOMATIC_POLITICAL_DECISION_MAX_CHARS);
});



test("diplomacy supplies the current player proposal as compact Political World selection focus", () => {
  const result = buildDiplomaticPoliticalContext({
    world: makeWorld(),
    speakingAs: "Speaker Republic",
    playerCountry: "Player State",
    decisionFocusText: "We propose reciprocal maritime inspections so shipping and port access can continue.",
  });

  assert.ok(result);
  assert.match(result.text, /Negotiate reciprocal maritime inspection rules/);
  assert.match(result.text, /A shipping blockade could isolate major ports/);
  assert.match(result.text, /Port operators demand predictable maritime inspection access/);
});

test("confidence-building diplomacy surfaces later security strategy instead of name-matching noise", () => {
  const world = makeWorld();
  const actor = world.politicalActors.byPolity["Speaker Republic"];
  actor.goals = [
    "Consolidate a recent territorial gain",
    "Preserve influence over nearby states",
    "Exploit political, military, institutional, and alliance ambiguity before opponents can coordinate",
    "Use military, covert, intelligence, economic, and diplomatic instruments to create favorable faits accomplis",
    "Test adversary red lines and alliance cohesion",
  ];
  actor.fears = [
    "Loss of strategic initiative",
    "Rapid collective deterrence",
    "Prolonged conflict or military overreach",
  ];
  actor.domesticPressures = [
    "Economic vulnerabilities",
    "Speaker Republic bureaucratic constraints",
  ];
  const before = structuredClone(actor);

  const result = buildDiplomaticPoliticalContext({
    world,
    speakingAs: "Speaker Republic",
    playerCountry: "Player State",
    decisionFocusText: "Player State proposes a bilateral military confidence-building agreement with exercise notifications, observers, and unchanged alliance commitments.",
  });

  assert.ok(result);
  assert.match(result.text, /Goals: Exploit political, military, institutional, and alliance ambiguity/);
  assert.match(result.text, /Use military, covert, intelligence, economic, and diplomatic instruments/);
  assert.match(result.text, /Fears: Prolonged conflict or military overreach/);
  assert.match(result.text, /Domestic pressure: Economic vulnerabilities/);
  assert.doesNotMatch(result.text, /Domestic pressure: Speaker Republic bureaucratic constraints/);
  assert.deepEqual(world.politicalActors.byPolity["Speaker Republic"], before);
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
  assert.match(mainSource, /decisionFocusText: focusText/);
  assert.match(mainSource, /decisionFocusText: playerMessage/);
  assert.match(mainSource, /\$\{rendered\}\$\{politicalSection\}\$\{espionage\}/);
  assert.doesNotMatch(mainSource, /institutionSection/);
});
