import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBoundedPoliticalDecisionContextSet,
  buildPoliticalDecisionContext,
  DEFAULT_POLITICAL_DECISION_MAX_ACTORS,
  POLITICAL_DECISION_CONTEXT_VERSION,
} from "./politicalDecisionContext.js";
import { POLITICAL_KNOWLEDGE_LEVELS } from "../../runtime/politicalKnowledge.js";
import { seedPowerBaselineScore } from "../../runtime/powerStatus.js";

const makeWorld = () => ({
  politicalActors: {
    schemaVersion: 6,
    byPolity: {
      "Actor Republic": {
        polityKey: "Actor Republic",
        politicalSystem: { type: "semi_presidential_republic", representation: "electoral" },
        government: {
          form: "Semi-presidential republic",
          ideology: "Security-minded liberal conservatism",
          headOfState: "President Alpha",
          headOfGovernment: "Prime Minister Beta",
          approval: 43,
          stability: 61,
          rulingPartyIds: ["governing-party"],
          coalitionPartyIds: ["coalition-party"],
        },
        leader: { name: "President Alpha" },
        traits: {
          riskTolerance: 72,
          caution: 31,
          opportunism: 81,
          paranoia: 64,
          pragmatism: 55,
          militarism: 58,
        },
        goals: [
          "Preserve the frontier buffer",
          "Keep alliance guarantees credible",
          "Protect export access",
          "Fourth goal",
          "Fifth goal",
          "Sixth goal",
          "Seventh goal should be bounded",
        ],
        fears: ["Alliance abandonment", "Domestic humiliation"],
        ambitions: ["Become the region's agenda setter"],
        domesticPressures: [
          "Nationalist media demands a firmer response",
          "Business groups fear sanctions",
        ],
        politicalPressures: {
          updatedAt: "2014-03-22",
          issues: {
            security: { salience: 87, strain: 68, lean: 75, persistence: 0.9, momentum: 18 },
            war_weariness: { salience: 52, strain: 41, lean: 60, persistence: 0.7, momentum: -4 },
            economic_stress: { salience: 35, strain: 57, lean: 20, persistence: 0.8, momentum: 3 },
          },
        },
        behavioralDisposition: {
          assertiveness: 78,
          riskTolerance: 71,
          escalationPressure: 66,
          compromisePressure: 32,
          regimeVulnerability: 44,
          deterrenceSensitivity: 39,
          opportunityPerception: 76,
          threatPerception: 73,
          updatedAt: "2014-03-22",
        },
        perceptions: {
          "Counterpart State": {
            threat: 92,
            opportunity: 74,
            weakness: 81,
            cohesionEstimate: 24,
          },
          "Regional Alliance": { cohesionEstimate: 36, threat: 50 },
        },
        parties: [
          {
            id: "governing-party",
            name: "Governing Party",
            ideology: "National liberalism",
            support: { percent: 39 },
            ruling: true,
            goals: ["Secure privileged access to the northern ports"],
            publicPriorities: ["Accelerate defense procurement"],
            publicForeignPolicy: ["Pressure the regional alliance for concessions"],
            publicDescription: "A security-first governing party.",
            internalPressure: "Security caucus wants visible resolve",
          },
          {
            id: "coalition-party",
            name: "Coalition Party",
            ideology: "Agrarian centrism",
            support: { percent: 12 },
            coalition: true,
          },
          {
            id: "opposition-front",
            name: "Opposition Front",
            ideology: "National populism",
            support: { percent: 31 },
            privateGoal: "Force an early election",
          },
          {
            id: "green-left",
            name: "Green Left",
            ideology: "Green social democracy",
            support: { percent: 9 },
          },
        ],
        powerBlocs: [],
      },
      "Counterpart State": {
        polityKey: "Counterpart State",
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: {
          form: "Presidential republic",
          ideology: "Civic nationalism",
          headOfState: "President Gamma",
          headOfGovernment: "President Gamma",
          approval: 88,
          stability: 90,
          rulingPartyIds: ["counterpart-ruling"],
        },
        traits: {
          riskTolerance: 9,
          paranoia: 96,
        },
        fears: ["SECRET counterpart fear must not leak"],
        ambitions: ["SECRET counterpart ambition must not leak"],
        perceptions: {
          "Actor Republic": { threat: 4, weakness: 9 },
        },
        behavioralDisposition: {
          assertiveness: 10,
          riskTolerance: 9,
          escalationPressure: 5,
          compromisePressure: 90,
        },
        goals: ["Defend constitutional sovereignty"],
        parties: [
          {
            id: "counterpart-ruling",
            name: "Counterpart Civic Party",
            ideology: "Civic nationalism",
            support: { percent: 55 },
          },
        ],
        powerBlocs: [],
      },
      "Court Kingdom": {
        polityKey: "Court Kingdom",
        politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
        government: {
          form: "Absolute monarchy",
          headOfState: "King Delta",
          headOfGovernment: "King Delta",
        },
        leader: "King Delta",
        traits: { caution: 80 },
        goals: ["Preserve dynastic rule"],
        powerBlocs: [
          { id: "royal-court", name: "Royal Court", kind: "ruling court", influence: { label: "dominant" } },
          { id: "merchant-elite", name: "Merchant Elite", kind: "elite faction", influence: { label: "significant" } },
        ],
        parties: [],
      },
      "Supreme State": {
        polityKey: "Supreme State",
        politicalSystem: { type: "one_party_state", representation: "party_state" },
        government: {
          form: "Party-state republic",
          headOfState: "Formal Chair",
          headOfGovernment: "Premier Formal",
          rulingPartyIds: ["workers-party"],
        },
        leader: "Supreme Leader",
        parties: [{ id: "workers-party", name: "Workers Party", ruling: true }],
      },
    },
  },
  polityOverrides: {
    "Actor Republic": { name: "The Actor Republic", aliases: ["Actorland"] },
    "Counterpart State": { name: "Counterpart State", aliases: ["Counterpart"] },
  },
  relations: [
    {
      id: "actor-counterpart",
      a: "Actorland",
      b: "Counterpart State",
      score: 62,
      status: "friendly",
      summary: "Warm official ties despite growing private suspicion.",
    },
  ],
  agreements: [
    {
      id: "mutual-consultation",
      type: "alliance",
      status: "active",
      title: "Mutual Consultation Pact",
      parties: ["Actor Republic", "Counterpart"],
      terms: "Consult before major security decisions.",
    },
  ],
  wars: [
    {
      id: "regional-war",
      status: "active",
      title: "Regional War",
      sideA: ["Actor Republic"],
      sideB: ["Third State"],
      startDate: "2014-03-01",
    },
  ],
});

test("Phase009A builds a bounded actor-relative political decision capsule", () => {
  const world = makeWorld();
  const context = buildPoliticalDecisionContext(world, "Actorland", {
    counterpartPolity: "Counterpart State",
  });

  assert.equal(context.schemaVersion, POLITICAL_DECISION_CONTEXT_VERSION);
  assert.equal(context.actorPolity, "The Actor Republic");
  assert.equal(context.counterpartPolity, "Counterpart State");
  assert.equal(context.political.government.ideology, "Security-minded liberal conservatism");
  assert.equal(context.political.goals.length, 6);
  assert.equal(context.political.entities.governing[0].name, "Governing Party");
  assert.deepEqual(context.political.entities.governing[0].goals, ["Secure privileged access to the northern ports"]);
  assert.deepEqual(context.political.entities.governing[0].publicForeignPolicy, ["Pressure the regional alliance for concessions"]);
  assert.equal(context.political.entities.opposition[0].name, "Opposition Front");
  assert.equal(context.political.pressureIssues[0].issue, "security");
  assert.equal(context.political.perceptions[0].target, "Counterpart State");
  assert.equal(context.political.perceptions[0].focusedCounterpart, true);
  assert.equal(context.bilateral.relation.status, "friendly");
  assert.equal(context.bilateral.agreements[0].id, "mutual-consultation");

  assert.match(context.text, /KNOWLEDGE BOUNDARY/);
  assert.match(context.text, /CURRENT-STATE AUTHORITY: this capsule is the actor's canonical current political state\. Scenario\/world-before-round-one temperament is starting context only/);
  assert.match(context.text, /Government ideology: Security-minded liberal conservatism/);
  assert.match(context.text, /goals: Secure privileged access to the northern ports/);
  assert.match(context.text, /foreign policy: Pressure the regional alliance for concessions/);
  assert.match(context.text, /Security: very high salience/);
  assert.match(context.text, /Counterpart State \[FOCUS\]: Threat very high/);
  assert.match(context.text, /Relation: friendly \(\+62\)/);
});

test("actor perception remains explicitly separate from objective bilateral reality", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Actor Republic", {
    counterpartPolity: "Counterpart State",
  });

  assert.equal(context.political.perceptions[0].metrics.threat, 92);
  assert.equal(context.bilateral.relation.score, 62);
  assert.match(context.text, /ACTOR PERCEPTIONS \(BELIEF, NOT OBJECTIVE TRUTH\)/);
  assert.match(context.text, /Threat very high/);
  assert.match(context.text, /OBJECTIVE BILATERAL \/ CONFLICT CONTEXT/);
  assert.match(context.text, /friendly \(\+62\)/);
});

test("counterpart Political Knowledge never leaks hidden canonical traits, fears, perceptions, or disposition", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Actor Republic", {
    counterpartPolity: "Counterpart State",
    knowledgeLevel: POLITICAL_KNOWLEDGE_LEVELS.GM,
  });

  // GM is intentionally downgraded at this seam. The actor may get public or
  // assessed/classified narrative knowledge, never the counterpart's canonical internals.
  assert.equal(context.counterpartKnowledge.level, POLITICAL_KNOWLEDGE_LEVELS.PUBLIC);
  assert.equal("canonical" in context.counterpartKnowledge, false);
  assert.match(context.text, /Public government: Presidential republic/);
  assert.match(context.text, /Public stated goals: Defend constitutional sovereignty/);
  assert.doesNotMatch(context.text, /SECRET counterpart fear/);
  assert.doesNotMatch(context.text, /SECRET counterpart ambition/);
  assert.doesNotMatch(context.text, /Paranoia: very high/);
});

test("assessed/classified counterpart knowledge accepts narrative intelligence without raw hidden state", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Actor Republic", {
    counterpartPolity: "Counterpart State",
    knowledgeLevel: POLITICAL_KNOWLEDGE_LEVELS.CLASSIFIED,
    intelligenceAssessment: {
      summary: "Leadership appears divided over escalation.",
      confidence: "Moderate",
      findings: [
        { topic: "cabinet", text: "Security ministers are pressing for restraint." },
      ],
    },
  });

  assert.equal(context.counterpartKnowledge.level, POLITICAL_KNOWLEDGE_LEVELS.CLASSIFIED);
  assert.match(context.text, /Intelligence assessment: Leadership appears divided over escalation/);
  assert.match(context.text, /Security ministers are pressing for restraint/);
  assert.doesNotMatch(context.text, /SECRET counterpart fear/);
});

test("the builder is read-only and never mints unknown Political Actors", () => {
  const world = makeWorld();
  const before = structuredClone(world);

  const missing = buildPoliticalDecisionContext(world, "Unknown State");
  assert.equal(missing, null);
  assert.deepEqual(world, before);

  const context = buildPoliticalDecisionContext(world, "Actor Republic");
  assert.ok(context);
  context.political.government.ideology = "MUTATED OUTPUT";
  context.political.entities.governing[0].name = "MUTATED ENTITY";
  assert.deepEqual(world, before);
});

test("regime-agnostic political systems expose power blocs without inventing electoral parties", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Court Kingdom");
  assert.equal(context.political.politicalSystem.representation, "court_factions");
  assert.equal(context.political.entities.governing[0].name, "Royal Court");
  assert.equal(context.political.entities.opposition[0].name, "Merchant Elite");
  assert.match(context.text, /Royal Court/);
  assert.doesNotMatch(context.text, /No governing party\/power-bloc row resolved/);
});

test("formal officeholders remain separate from a distinct supreme political leader", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Supreme State");
  assert.equal(context.political.decisionAuthority.primary, "Supreme Leader");
  assert.equal(context.political.decisionAuthority.role, "supreme-political-leader");
  assert.match(context.text, /Head of state: Formal Chair/);
  assert.match(context.text, /Head of government: Premier Formal/);
  assert.match(context.text, /Political \/ supreme leader: Supreme Leader/);
  assert.match(context.text, /Primary political decision-maker \(native\): Supreme Leader/);
});

test("parliamentary capsules identify the operative head of government despite a legacy head-of-state leader", () => {
  const world = makeWorld();
  world.politicalActors.byPolity["Parliamentary State"] = {
    polityKey: "Parliamentary State",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: {
      form: "Parliamentary republic",
      headOfState: "Ceremonial President",
      headOfGovernment: "Prime Minister Delta",
    },
    leader: "Ceremonial President",
    traits: { riskTolerance: 55 },
    parties: [],
    powerBlocs: [],
  };

  const verbose = buildPoliticalDecisionContext(world, "Parliamentary State");
  assert.equal(verbose.political.decisionAuthority.primary, "Prime Minister Delta");
  assert.equal(verbose.political.decisionAuthority.model, "parliamentary-executive");
  assert.match(verbose.text, /Primary political decision-maker \(native\): Prime Minister Delta/);

  const compact = buildPoliticalDecisionContext(world, "Parliamentary State", { maxChars: 1700 });
  assert.match(compact.text, /Decision-maker: Prime Minister Delta \(head-of-government; parliamentary-executive; high confidence\)/);
});

test("context limits and native text budget are enforced", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Actor Republic", {
    counterpartPolity: "Counterpart State",
    limits: {
      traits: 2,
      goals: 2,
      fears: 1,
      ambitions: 1,
      domesticPressures: 1,
      pressureIssues: 1,
      governingEntities: 1,
      oppositionEntities: 1,
      perceptions: 1,
    },
    maxChars: 1400,
  });

  assert.equal(context.political.goals.length, 2);
  assert.equal(context.political.fears.length, 1);
  assert.equal(context.political.pressureIssues.length, 1);
  assert.equal(context.political.entities.governing.length, 1);
  assert.equal(context.political.entities.opposition.length, 1);
  assert.equal(context.political.perceptions.length, 1);
  assert.ok(context.text.length <= 1500);
  assert.match(context.text, /(?:truncated at native bound|lower-priority detail omitted)/);
});


test("tight World Director-sized capsules prioritize C4, governing-party motives and perceptions before optional detail", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Actor Republic", {
    counterpartPolity: "Counterpart State",
    limits: {
      traits: 5, goals: 4, fears: 4, ambitions: 4, domesticPressures: 4,
      pressureIssues: 4, governingEntities: 3, oppositionEntities: 3,
      perceptions: 3, relations: 4, agreements: 4, wars: 3, institutions: 8,
    },
    maxChars: 1700,
  });

  assert.ok(context.text.length <= 1700);
  assert.match(context.text, /CURRENT-STATE AUTHORITY: this capsule is the actor's canonical current political state\. Scenario\/world-before-round-one temperament is starting context only/);
  assert.match(context.text, /Disposition: .*assert high.*risk high.*escalate high/i);
  assert.match(context.text, /Governing force: Governing Party/);
  assert.match(context.text, /foreign policy: Pressure the regional alliance for concessions/);
  assert.match(context.text, /Goals: Preserve the frontier buffer/);
  assert.match(context.text, /Belief — Counterpart State \[FOCUS\]: Threat very high/);
});



test("compact decision capsules use the caller's task focus to surface later canonical strategy rows without reordering canonical state", () => {
  const world = makeWorld();
  const actor = world.politicalActors.byPolity["Actor Republic"];
  actor.fears.push("Fuel-price shock could fracture the governing coalition");
  actor.domesticPressures.push("Port exporters demand immediate relief from maritime restrictions");

  const before = structuredClone(actor);
  const context = buildPoliticalDecisionContext(world, "Actor Republic", {
    counterpartPolity: "Counterpart State",
    decisionFocusText: "We propose restoring maritime export access and emergency fuel-price relief for port trade.",
    maxChars: 1700,
  });

  assert.match(context.text, /Goals: Protect export access/);
  assert.match(context.text, /Fears: Fuel-price shock could fracture the governing coalition/);
  assert.match(context.text, /Domestic pressure: Port exporters demand immediate relief from maritime restrictions/);
  assert.deepEqual(world.politicalActors.byPolity["Actor Republic"], before, "focus selection must stay projection-only");
});

test("compact decision capsules preserve authored order when the caller supplies no usable task focus", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Actor Republic", {
    counterpartPolity: "Counterpart State",
    maxChars: 1700,
  });

  assert.match(context.text, /Goals: Preserve the frontier buffer; Keep alliance guarantees credible/);
  assert.match(context.text, /Fears: Alliance abandonment/);
  assert.match(context.text, /Domestic pressure: Nationalist media demands a firmer response/);
});

test("bounded multi-actor wrapper deduplicates aliases, skips missing actors, and respects maxActors", () => {
  const world = makeWorld();
  const result = buildBoundedPoliticalDecisionContextSet(world, {
    actorPolities: [
      "Actor Republic",
      "Actorland",
      "Counterpart State",
      "Unknown State",
      "Court Kingdom",
    ],
    maxActors: 2,
    perActorMaxChars: 1800,
  });

  assert.equal(DEFAULT_POLITICAL_DECISION_MAX_ACTORS, 8);
  assert.equal(result.contexts.length, 2);
  assert.equal(result.contexts[0].actorPolity, "The Actor Republic");
  assert.equal(result.contexts[1].actorPolity, "Counterpart State");
  assert.match(result.text, /ACTOR CAPSULE 1\/2/);
  assert.match(result.text, /Never transfer private facts across actors/);
});

test("no-counterpart capsules include bounded actor-linked diplomatic reality without inventing a focal opponent", () => {
  const context = buildPoliticalDecisionContext(makeWorld(), "Actor Republic");
  assert.equal(context.counterpartPolity, undefined);
  assert.equal(context.bilateral.relations.length, 1);
  assert.equal(context.bilateral.relations[0].id, "actor-counterpart");
  assert.equal(context.bilateral.wars[0].relationship, "actor-involved");
  assert.match(context.text, /No single counterpart focus was requested/);
  assert.match(context.text, /The Actor Republic ↔ Counterpart State \| friendly \+62/);
});

test("counterpart war projection distinguishes co-belligerents from belligerents", () => {
  const world = makeWorld();
  world.wars[0].sideA.push("Counterpart State");
  const context = buildPoliticalDecisionContext(world, "Actor Republic", {
    counterpartPolity: "Counterpart State",
  });
  assert.equal(context.bilateral.wars[0].relationship, "co-belligerents");
  assert.match(context.text, /co-belligerents/);
});

test("nested trait/perception metrics are bounded and rendered semantically instead of object stringification", () => {
  const world = makeWorld();
  world.politicalActors.byPolity["Actor Republic"].traits.foreignPolicy = {
    riskTolerance: 72,
    doctrine: ["deterrence", "alliance credibility"],
  };
  world.politicalActors.byPolity["Actor Republic"].perceptions["Counterpart State"].military = {
    readiness: 88,
  };
  const context = buildPoliticalDecisionContext(world, "Actor Republic", {
    counterpartPolity: "Counterpart State",
  });
  assert.match(context.text, /Foreign Policy: Risk Tolerance high/);
  assert.match(context.text, /Military Readiness very high/);
  assert.doesNotMatch(context.text, /\[object Object\]/);
});

test("multi-actor context set enforces a total native character budget", () => {
  const result = buildBoundedPoliticalDecisionContextSet(makeWorld(), {
    actorPolities: ["Actor Republic", "Counterpart State", "Court Kingdom", "Supreme State"],
    maxActors: 4,
    perActorMaxChars: 2400,
    maxTotalChars: 2500,
  });
  assert.ok(result.text.length <= 2500);
  assert.ok(result.contexts.length >= 1);
  assert.ok(result.omittedActorPolities.length >= 1);
});


test("same coarse power tier still exposes materially different continuous strategic weight", () => {
  let world = makeWorld();
  world = seedPowerBaselineScore(world, "Actor Republic", 52, { round: 0 });
  world = seedPowerBaselineScore(world, "Counterpart State", 68, { round: 0 });

  const actor = buildPoliticalDecisionContext(world, "Actor Republic");
  const counterpart = buildPoliticalDecisionContext(world, "Counterpart State");

  assert.equal(actor.geopolitical.powerTier, "regional-power");
  assert.equal(counterpart.geopolitical.powerTier, "regional-power");
  assert.equal(actor.geopolitical.sovereignCapabilityScore, 52);
  assert.equal(counterpart.geopolitical.sovereignCapabilityScore, 68);
  assert.equal(actor.geopolitical.strategicWeight, 54, "active-war relevance is separate from the 52/100 sovereign baseline");
  assert.ok(counterpart.geopolitical.strategicWeight > actor.geopolitical.strategicWeight);
  assert.match(actor.text, /Sovereign capability: 52\/100/);
  assert.match(actor.text, /Current strategic weight: 54\/100/);
});

test("compact decision capsule keeps continuous power evidence inside the bounded actor budget", () => {
  let world = makeWorld();
  world = seedPowerBaselineScore(world, "Actor Republic", 54, { round: 0 });
  world.institutions = {
    schemaVersion: 1,
    byId: {
      pact: {
        id: "pact",
        name: "Regional Pact",
        kind: "security_alliance",
        status: "active",
        priority: 90,
        members: [{ polity: "Actor Republic", status: "member", role: "leading-member" }],
      },
    },
  };
  const context = buildPoliticalDecisionContext(world, "Actor Republic", { maxChars: 1200 });
  assert.ok(context.text.length <= 1200);
  assert.match(context.text, /power regional-power; sovereign 54\/100; weight/);
  assert.match(context.text, /Power leverage: institutions \+/);
});
