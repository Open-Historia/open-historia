import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlayerPoliticalKnowledgeView,
  buildPoliticalKnowledgeView,
  buildPublicPoliticalView,
  POLITICAL_KNOWLEDGE_LEVELS,
} from "./politicalKnowledge.js";

const makeWorld = () => ({
  polityOverrides: {
    "Russian Federation": {
      name: "Russian Federation",
      aliases: ["Russia"],
      status: "active",
    },
  },
  politicalActors: {
    schemaVersion: 1,
    byPolity: {
      "Russian Federation": {
        polityKey: "Russian Federation",
        government: {
          form: "Federal semi-presidential republic",
          ideology: "National conservative",
          headOfState: "Vladimir Putin",
          headOfGovernment: "Dmitry Medvedev",
          rulingParties: ["United Russia"],
          coalitionName: "Test Coalition",
          approval: 78,
          stability: 74,
        },
        leader: "Vladimir Putin",
        parties: [
          {
            id: "united-russia",
            name: "United Russia",
            ideology: "National conservative",
            shortName: "UR",
            support: { percent: 53 },
            leader: "Dmitry Medvedev",
            goals: ["Preserve political dominance"],
            publicPriorities: ["Economic stability"],
            publicForeignPolicy: ["Preserve regional influence"],
            publicDescription: "The governing party.",
            color: "#2563eb",
            internalStrategy: "Do not leak this",
            secretForeignPolicy: ["Do not leak this either"],
          },
        ],
        goals: ["Maintain regional influence", "Preserve strategic depth"],
        tags: ["authoritarian", "great-power"],
        traits: {
          riskTolerance: 78,
          paranoia: 71,
          opportunism: 84,
        },
        fears: ["Strategic encirclement"],
        ambitions: ["Restore dominant regional influence"],
        perceptions: {
          NATO: { threat: 82, cohesionEstimate: 58 },
        },
        domesticPressures: ["Nationalist pressure"],
        behavioralDisposition: {
          assertiveness: 76,
          escalationAcceptance: 63,
        },
      },
    },
  },
});

test("public political view exposes public political facts but never raw hidden internals", () => {
  const view = buildPublicPoliticalView(makeWorld(), "Russia");

  assert.equal(view?.government?.form, "Federal semi-presidential republic");
  assert.equal(view?.government?.headOfState, "Vladimir Putin");
  assert.equal(view?.government?.headOfGovernment, "Dmitry Medvedev");
  assert.equal(view?.government?.coalitionName, "Test Coalition");
  assert.equal(view?.parties?.[0]?.support?.percent, 53);
  assert.equal(view?.parties?.[0]?.shortName, "UR");
  assert.equal(view?.parties?.[0]?.leader, "Dmitry Medvedev");
  assert.deepEqual(view?.parties?.[0]?.publicPriorities, ["Economic stability"]);
  assert.deepEqual(view?.parties?.[0]?.publicForeignPolicy, ["Preserve regional influence"]);
  assert.equal(view?.parties?.[0]?.publicDescription, "The governing party.");
  assert.equal(view?.parties?.[0]?.color, "#2563eb");
  assert.deepEqual(view?.goals, ["Maintain regional influence", "Preserve strategic depth"]);

  assert.equal("approval" in (view?.government || {}), false);
  assert.equal("stability" in (view?.government || {}), false);
  assert.equal("traits" in (view || {}), false);
  assert.equal("fears" in (view || {}), false);
  assert.equal("ambitions" in (view || {}), false);
  assert.equal("perceptions" in (view || {}), false);
  assert.equal("domesticPressures" in (view || {}), false);
  assert.equal("behavioralDisposition" in (view || {}), false);
  assert.equal("internalStrategy" in (view?.parties?.[0] || {}), false);
  assert.equal("secretForeignPolicy" in (view?.parties?.[0] || {}), false);
});

test("intelligence view adds only a narrative assessment, not canonical trait numbers", () => {
  const view = buildPoliticalKnowledgeView(makeWorld(), "Russian Federation", {
    level: POLITICAL_KNOWLEDGE_LEVELS.CLASSIFIED,
    intelligenceAssessment: {
      summary: "Leadership appears unusually willing to accept controlled escalation risk.",
      confidence: "High",
      source: "HUMINT / diplomatic reporting",
      findings: [
        {
          topic: "NATO",
          assessment: "Senior leadership appears to doubt alliance political cohesion.",
          confidence: "Moderate",
        },
      ],
      // Unknown/raw fields must not cross this seam.
      rawTraits: { paranoia: 71 },
    },
  });

  assert.equal(view?.level, "classified");
  assert.equal(view?.intelligence?.confidence, "High");
  assert.equal(view?.intelligence?.findings?.[0]?.topic, "NATO");
  assert.equal("rawTraits" in (view?.intelligence || {}), false);
  assert.equal("traits" in (view?.public || {}), false);
});

test("public mode ignores an intelligence assessment entirely", () => {
  const view = buildPoliticalKnowledgeView(makeWorld(), "Russia", {
    level: POLITICAL_KNOWLEDGE_LEVELS.PUBLIC,
    intelligenceAssessment: {
      summary: "Should not be visible.",
    },
  });

  assert.equal(view?.level, "public");
  assert.equal("intelligence" in (view || {}), false);
});

test("GM view exposes a detached clone of canonical Political Actor truth", () => {
  const world = makeWorld();
  const view = buildPoliticalKnowledgeView(world, "Russia", {
    level: POLITICAL_KNOWLEDGE_LEVELS.GM,
  });

  assert.equal(view?.canonical?.traits?.paranoia, 71);
  assert.equal(view?.canonical?.behavioralDisposition?.escalationAcceptance, 63);

  view.canonical.traits.paranoia = 1;
  assert.equal(world.politicalActors.byPolity["Russian Federation"].traits.paranoia, 71);
});

test("unknown polity returns no political knowledge view", () => {
  assert.equal(buildPoliticalKnowledgeView(makeWorld(), "Atlantis"), null);
});


test("player political knowledge is classified only after a matching live source has actually reported", () => {
  const world = makeWorld();
  world.intelligence = { "Republic of Poland": 90, "Russian Federation": 40 };
  world.spies = [{ id: "pl-ru", owner: "Republic of Poland", target: "Russia", status: "active", suspected: false }];
  const intercepts = {
    Russia: {
      reportId: "spy-report-1",
      spyId: "pl-ru",
      gatheredAt: "2014-03-22",
      planted: false,
      politicalAssessment: {
        summary: "Leadership appears increasingly willing to accept controlled escalation risk.",
        confidence: "High",
        findings: [{ topic: "Alliance perception", text: "Senior leaders appear to doubt alliance political cohesion." }],
      },
      exchanges: [],
    },
  };

  const view = buildPlayerPoliticalKnowledgeView(world, "Russian Federation", {
    viewerPolity: "Republic of Poland",
    intercepts,
  });
  assert.equal(view?.level, "classified");
  assert.equal(view?.intelligence?.confidence, "High");
  assert.equal(view?.intelligence?.source, "HUMINT reporting");
  assert.equal(view?.intelligence?.gatheredAt, "2014-03-22");
  assert.equal("planted" in (view?.intelligence || {}), false);
  assert.equal("traits" in (view?.public || {}), false);
});

test("a suspected source degrades political knowledge without revealing that the source was turned", () => {
  const world = makeWorld();
  world.intelligence = { "Republic of Poland": 90, "Russian Federation": 40 };
  world.spies = [{ id: "pl-ru", owner: "Republic of Poland", target: "Russia", status: "turned", suspected: true }];
  const intercepts = {
    Russia: {
      spyId: "pl-ru",
      gatheredAt: "2014-03-22",
      planted: true,
      politicalAssessment: {
        summary: "Leadership appears unusually cautious about escalation.",
        confidence: "High",
        findings: [{ topic: "Risk appetite", text: "Decision-makers appear reluctant to gamble." }],
      },
    },
  };

  const view = buildPlayerPoliticalKnowledgeView(world, "Russia", {
    viewerPolity: "Republic of Poland",
    intercepts,
  });
  assert.equal(view?.level, "assessed");
  assert.equal(view?.intelligence?.confidence, "Low");
  assert.match(view?.intelligence?.source || "", /source integrity concerns/i);
  assert.equal("planted" in (view?.intelligence || {}), false);
  assert.ok(!JSON.stringify(view).match(/turned/i), "player projection must not disclose the hidden turned status");
});

test("old political intelligence remains as stale assessed knowledge after the reporting source is gone", () => {
  const world = makeWorld();
  world.intelligence = { "Republic of Poland": 90, "Russian Federation": 40 };
  world.spies = [{ id: "pl-ru", owner: "Republic of Poland", target: "Russia", status: "exposed" }];
  const intercepts = {
    Russia: {
      spyId: "pl-ru",
      gatheredAt: "2014-03-22",
      politicalAssessment: {
        summary: "The security establishment appears to be gaining influence.",
        confidence: "High",
        findings: [{ topic: "Elite pressure", text: "Security officials increasingly shape cabinet choices." }],
      },
    },
  };

  const view = buildPlayerPoliticalKnowledgeView(world, "Russia", {
    viewerPolity: "Republic of Poland",
    intercepts,
  });
  assert.equal(view?.level, "assessed");
  assert.equal(view?.intelligence?.stale, true);
  assert.equal(view?.intelligence?.confidence, "Moderate");
  assert.match(view?.intelligence?.source || "", /no longer active/i);
});

test("public political knowledge preserves quantitative landscape basis without exposing hidden internals", () => {
  const world = {
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        "Republic X": {
          polityKey: "Republic X",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          parties: [{ id: "a", name: "A", support: { percent: 37, basis: "generated-estimate" } }],
          powerBlocs: [{ id: "army", name: "Army", influence: { percent: 20, basis: "campaign-derived" } }],
        },
      },
    },
  };
  const view = buildPublicPoliticalView(world, "Republic X");
  assert.deepEqual(view.parties[0].support, { percent: 37, basis: "generated-estimate" });
  assert.deepEqual(view.powerBlocs[0].influence, { percent: 20, basis: "campaign-derived" });
});

test("public political knowledge preserves party-state influence basis for the Country panel", () => {
  const world = {
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        "Party State X": {
          polityKey: "Party State X",
          politicalSystem: { type: "single_party_state", representation: "party_state" },
          parties: [{ id: "state-party", name: "State Party", influence: { percent: 100, basis: "generated-estimate" } }],
        },
      },
    },
  };
  const view = buildPublicPoliticalView(world, "Party State X");
  assert.deepEqual(view.parties[0].influence, { percent: 100, basis: "generated-estimate" });
});
