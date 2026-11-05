import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  derivePregameBootstrapCoverageRequirements,
  validatePregameBootstrapCoverage,
} from "./pregameBootstrapCoverage.js";

const fireRisesWorld = () => ({
  polityOverrides: {
    "Union of America": { name: "Union of America", status: "active" },
    "American Constitutional Government": { name: "American Constitutional Government", status: "active" },
    "American People's Liberation Army": { name: "American People's Liberation Army", status: "active" },
    "Patriot Front": { name: "Patriot Front", status: "active" },
    "Atomwaffen Division": { name: "Atomwaffen Division", status: "active" },
    China: { name: "China", status: "active" },
    Taiwan: { name: "Taiwan", status: "active" },
  },
  wars: [],
  storylines: [],
});

const canonicalPolities = [
  "Union of America",
  "American Constitutional Government",
  "American People's Liberation Army",
  "Patriot Front",
  "Atomwaffen Division",
  "China",
  "Taiwan",
];

const briefing = `
The European and Asian Theaters. China, observing the paralysis of the American hegemon, prepares for a potential direct intervention in Taiwan.
Communities across America began preparing for an unknown future, and extremist elements ranging from ultranationalist neo-Nazi networks like the Atomwaffen Division to heavily armed militias openly stockpiled weapons.
The systemic breakdown escalated further on August 20, 2020, when paramilitary organizations, notably the American People's Liberation Army (APLA) and the Patriot Front, publicly declared armed defiance against federal authority.
`;

test("Round-Zero coverage derives only explicit authoritative armed-opposition actors", () => {
  const requirements = derivePregameBootstrapCoverageRequirements({
    briefing,
    world: fireRisesWorld(),
    canonicalPolities,
  });

  assert.deepEqual(
    requirements.map((entry) => entry.polity).sort(),
    ["American People's Liberation Army", "Patriot Front"],
  );
  assert.equal(requirements.some((entry) => entry.polity === "Atomwaffen Division"), false, "weapon stockpiling alone is not a persistent conflict obligation");
  assert.equal(requirements.some((entry) => entry.polity === "China"), false, "preparing for a potential intervention is not current belligerency");
  assert.equal(requirements.some((entry) => entry.polity === "Taiwan"), false);
});

test("Fire Rises regression: Union-vs-ACG alone cannot account for briefing-named armed opposition", () => {
  const world = fireRisesWorld();
  const candidate = {
    canonicalUpdates: [
      {
        ref: "w1",
        kind: "war",
        title: "Second American Civil War",
        status: "active",
        sideA: ["Union of America"],
        sideB: ["American Constitutional Government"],
      },
      {
        ref: "s1",
        kind: "storyline",
        processKind: "political_crisis",
        status: "active",
        title: "Institutional Collapse and Factional Mobilization",
        participants: ["Union of America", "American Constitutional Government"],
      },
    ],
  };

  const error = validatePregameBootstrapCoverage(candidate, {
    briefing,
    world,
    canonicalPolities,
  });
  assert.match(error, /American People's Liberation Army/);
  assert.match(error, /Patriot Front/);
  assert.match(error, /do not invent a new war unless the scenario canon supports one/);
});

test("armed actors may be conserved by the appropriate unresolved non-war process without inventing war sides", () => {
  const world = fireRisesWorld();
  const candidate = {
    canonicalUpdates: [
      {
        ref: "w1",
        kind: "war",
        title: "Second American Civil War",
        status: "active",
        sideA: ["Union of America"],
        sideB: ["American Constitutional Government"],
      },
      {
        ref: "s1",
        kind: "storyline",
        processKind: "political_crisis",
        status: "active",
        title: "Institutional Collapse and Factional Mobilization",
        participants: [
          "Union of America",
          "American Constitutional Government",
          "American People's Liberation Army",
          "Patriot Front",
        ],
      },
    ],
  };

  assert.equal(validatePregameBootstrapCoverage(candidate, {
    briefing,
    world,
    canonicalPolities,
  }), "");
});

test("already-canonical active conflict/process state satisfies Round-Zero coverage without duplication", () => {
  const world = {
    ...fireRisesWorld(),
    storylines: [{
      id: "scenario-american-fracture",
      kind: "crisis",
      status: "active",
      participants: ["American People's Liberation Army", "Patriot Front"],
    }],
  };

  assert.equal(validatePregameBootstrapCoverage({ canonicalUpdates: [] }, {
    briefing,
    world,
    canonicalPolities,
  }), "");
});

test("relations alone do not satisfy an armed-actor coverage obligation", () => {
  const candidate = {
    canonicalUpdates: [
      { ref: "r1", kind: "relation", a: "Union of America", b: "American People's Liberation Army", score: -100 },
      { ref: "r2", kind: "relation", a: "Union of America", b: "Patriot Front", score: -100 },
    ],
  };
  const error = validatePregameBootstrapCoverage(candidate, {
    briefing,
    world: fireRisesWorld(),
    canonicalPolities,
  });
  assert.match(error, /omits authoritative armed actors/);
});

test("explicit war language creates coverage anchors for named current belligerents", () => {
  const world = {
    polityOverrides: {
      Alpha: { name: "Alpha", status: "active" },
      Beta: { name: "Beta", status: "active" },
    },
    wars: [],
    storylines: [],
  };
  const requirements = derivePregameBootstrapCoverageRequirements({
    briefing: "Alpha declared war on Beta after negotiations collapsed.",
    world,
    canonicalPolities: ["Alpha", "Beta"],
  });
  assert.deepEqual(requirements.map((entry) => entry.polity).sort(), ["Alpha", "Beta"]);
});


test("coverage stays actor-local when a third polity merely observes another war", () => {
  const world = {
    polityOverrides: {
      China: { name: "China", status: "active" },
      Russia: { name: "Russia", status: "active" },
      Ukraine: { name: "Ukraine", status: "active" },
    },
    wars: [],
    storylines: [],
  };
  const requirements = derivePregameBootstrapCoverageRequirements({
    briefing: "China observes Russia as Russia remains at war with Ukraine.",
    world,
    canonicalPolities: ["China", "Russia", "Ukraine"],
  });
  assert.deepEqual(requirements.map((entry) => entry.polity).sort(), ["Russia", "Ukraine"]);
});


test("Round-Zero orchestration enforces authoritative coverage before acceptance and again inside guarded publication", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const start = source.indexOf("export const maybeGeneratePregameHistory = async");
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf("// ---- Idle diplomacy drip", start));
  assert.match(body, /derivePregameBootstrapCoverageRequirements\(\{/);
  assert.match(body, /coverageRequirements: pregameCoverageRequirements/);
  assert.match(body, /const freshCoverageRequirements = derivePregameBootstrapCoverageRequirements\(\{/);
  assert.match(body, /const freshCoverageError = validatePregameBootstrapCoverage\(payload/);
  assert.match(body, /if \(freshCoverageError\) throw new Error\(freshCoverageError\)/);
  assert.match(body, /authoritative armed-actor coverage anchor\(s\)/);
});
