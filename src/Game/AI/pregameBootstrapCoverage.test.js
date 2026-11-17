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

// The owner, 2026-11-06: "dont do keywording its super unreliable". The
// requirements used to be read out of the briefing by English word lists, and
// an answer that left out an actor they picked was refused (another request,
// and again at every open of the game); the same briefing in French required
// nothing. Nothing is read from a briefing's words now.
test("no coverage requirement is read out of a briefing's words, in any language", () => {
  assert.deepEqual(derivePregameBootstrapCoverageRequirements({ briefing, world: fireRisesWorld(), canonicalPolities }), []);
  assert.deepEqual(derivePregameBootstrapCoverageRequirements({ briefing: "In 1990 Iraq declared war on Kuwait. The war ended in 1991.", world: {}, canonicalPolities: ["Iraq", "Kuwait"] }), []);
  assert.equal(validatePregameBootstrapCoverage({ canonicalUpdates: [] }, { briefing, world: fireRisesWorld(), canonicalPolities }), "", "an answer is not refused over a briefing's wording");
});

// What a caller states outright is still held to.
const stated = [{ polity: "American People's Liberation Army", evidence: "named by the scenario" }, { polity: "Patriot Front" }];

test("a stated requirement is met by an unresolved non-war process, without inventing war sides", () => {
  const world = fireRisesWorld();
  const candidate = {
    canonicalUpdates: [
      { ref: "w1", kind: "war", title: "Second American Civil War", status: "active", sideA: ["Union of America"], sideB: ["American Constitutional Government"] },
      { ref: "s1", kind: "storyline", processKind: "political_crisis", status: "active", title: "Institutional Collapse and Factional Mobilization", participants: ["Union of America", "American Constitutional Government", "American People's Liberation Army", "Patriot Front"] },
    ],
  };
  assert.equal(validatePregameBootstrapCoverage(candidate, { world, requirements: stated }), "");
});

test("already-canonical active conflict or process state meets a stated requirement", () => {
  const world = { ...fireRisesWorld(), storylines: [{ id: "scenario-american-fracture", kind: "crisis", status: "active", participants: ["American People's Liberation Army", "Patriot Front"] }] };
  assert.equal(validatePregameBootstrapCoverage({ canonicalUpdates: [] }, { world, requirements: stated }), "");
});

test("relations alone do not meet a stated requirement", () => {
  const candidate = {
    canonicalUpdates: [
      { ref: "r1", kind: "relation", a: "Union of America", b: "American People's Liberation Army", score: -100 },
      { ref: "r2", kind: "relation", a: "Union of America", b: "Patriot Front", score: -100 },
    ],
  };
  assert.match(validatePregameBootstrapCoverage(candidate, { world: fireRisesWorld(), requirements: stated }), /omits authoritative armed actors/);
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
