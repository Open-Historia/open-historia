import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectsSummaryText } from "./promptContext.js";
import { buildJumpProjectsDirective } from "./projectsDirective.js";
import { describeOutcomes } from "../../runtime/projectEngine.js";
import { publicProjectOutcomes } from "../../runtime/projectDisclosure.js";

const projects = [
  { id: "public", name: "Port Modernization", ownerCode: "France", status: "active", secrecy: "public", progress: 30, funding: "normal", summary: "Enlarge the port.", plan: { monthlyCost: 2000 } },
  { id: "covert", name: "Operation Silent", ownerCode: "France", status: "active", secrecy: "covert", progress: 70, funding: "normal", summary: "Secret nuclear delivery.", plan: { monthlyCost: 9000 } },
  { id: "restricted", name: "Restricted Research", ownerCode: "Germany", status: "active", secrecy: "restricted", progress: 50, funding: "normal", summary: "Classified technology.", plan: { monthlyCost: 9000 } },
];
const game = { country: "France", gameDate: "2026-01-01" };

test("time-skip public board omits covert and restricted programme details, advisor retains them", () => {
  const publicBoard = buildProjectsSummaryText({ projects }, game, { compact: true, publicOnly: true });
  assert.match(publicBoard, /Port Modernization/);
  assert.doesNotMatch(publicBoard, /Operation Silent|Restricted Research|nuclear/);
  const directive = buildJumpProjectsDirective(publicBoard, { folded: true });
  assert.doesNotMatch(directive, /Operation Silent|Restricted Research|nuclear/);
  const privateBoard = buildProjectsSummaryText({ projects }, game);
  assert.match(privateBoard, /Operation Silent/);
  assert.match(privateBoard, /Secret nuclear delivery/);
});

test("time-skip project forecast never names a classified milestone without public disclosure", () => {
  const outcomes = [
    { type: "milestone", date: "2026-01-02", project: "Port Modernization", owner: "France", title: "Dock complete" },
    { type: "complete", date: "2026-01-02", project: "Operation Silent", owner: "France" },
    { type: "milestone", date: "2026-01-02", project: "Restricted Research", owner: "Germany", title: "Prototype ready" },
    { type: "complete", date: "2026-01-02", project: "Unidentified Programme", owner: "Germany" },
  ];
  const safe = publicProjectOutcomes(outcomes, projects, "France");
  assert.deepEqual(safe.map((row) => row.project), ["Port Modernization"]);
  const narrative = describeOutcomes(safe);
  assert.match(narrative, /Port Modernization/);
  assert.doesNotMatch(narrative, /Operation Silent|Restricted Research|Unidentified Programme/);
});

test("ambiguous titles do not authorize a public event by guessing which project completed", () => {
  const outcomes = [{ type: "complete", date: "2026-01-02", project: "Joint Work", owner: "France" }];
  const listed = [
    { id: "a", ownerCode: "France", name: "Joint Work", secrecy: "public" },
    { id: "b", ownerCode: "France", name: "Joint Work", secrecy: "covert" },
  ];
  assert.deepEqual(publicProjectOutcomes(outcomes, listed, "France"), []);
});
