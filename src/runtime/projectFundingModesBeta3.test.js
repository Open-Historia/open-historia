import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorldState } from "./gameState.js";
import { ownerMeans, tickProjects } from "./projectEngine.js";
import { readFileSync } from "node:fs";

const project = (monthlyCost = 12_000, more = {}) => ({
  id: "p1", name: "Castle Repair", ownerCode: "Old Kingdom",
  funding: "normal", status: "active", progress: 0, spent: 0,
  plan: { durationDays: 90, monthlyCost, effects: [], milestones: [] },
  ...more,
});
const advance = (world, board = [project()]) =>
  tickProjects({ projects: board, world, host: "Old Kingdom", fromDate: "1475-01-01", toDate: "1475-01-31", round: 2 });

test("without an explicit mode, GDP-proxy projects of an unassessed economy work at their planned pace and claim no funds", () => {
  const world = normalizeWorldState({ countryStats: {} });
  assert.equal(world.projectFundingMode, "gdp-proxy");
  const result = advance(world);
  assert.equal(result.projects[0].spent, 0);
  assert.ok(result.projects[0].progress > 0);
});

test("scenario-authored non-monetary mode progresses with no GDP and records no fictional money", () => {
  const world = normalizeWorldState({ projectFundingMode: "nonmonetary", countryStats: {} });
  const result = advance(world);
  assert.ok(result.projects[0].progress > 0);
  assert.equal(result.projects[0].spent, 0);
  assert.equal(result.projects[0].paidShare, 1);
  const means = ownerMeans(world, "Old Kingdom", result.projects);
  assert.equal(means.mode, "nonmonetary");
  assert.equal(means.budget, null);
  assert.equal(means.committed, 0);
  assert.equal(means.covered, 1);
  assert.equal(world.countryStats["Old Kingdom"], undefined);
});

test("explicit mode outranks GDP presence; no hidden treasury deduction occurs", () => {
  const world = normalizeWorldState({
    projectFundingMode: "nonmonetary",
    countryStats: { "Old Kingdom": { stability: 50, economy: { gdp: 1_000_000 } } },
  });
  const result = advance(world);
  assert.ok(result.projects[0].progress > 0);
  assert.equal(result.projects[0].spent, 0);
  assert.equal(world.countryStats["Old Kingdom"].economy.gdp, 1_000_000);
});

test("an unknown mode is read as GDP-proxy and books nothing for an unassessed economy", () => {
  const world = normalizeWorldState({ projectFundingMode: "infinite-money", countryStats: {} });
  assert.equal(world.projectFundingMode, "gdp-proxy");
  assert.equal(advance(world).projects[0].spent, 0);
});

test("non-monetary mode resumes previously stalled work without inventing a payment", () => {
  const world = normalizeWorldState({ projectFundingMode: "nonmonetary", countryStats: {} });
  const result = advance(world, [project(12_000, { status: "stalled", stallReason: "funds" })]);
  assert.equal(result.projects[0].status, "active");
  assert.ok(result.projects[0].progress > 0);
  assert.equal(result.projects[0].spent, 0);
  assert.ok(result.outcomes.some((outcome) => outcome.type === "resume"));
});

test("nonmonetary work remains deterministic under partitioned time skips", () => {
  const world = normalizeWorldState({ projectFundingMode: "nonmonetary", countryStats: {} });
  const whole = advance(world);
  const a = tickProjects({ projects: [project()], world, host: "Old Kingdom", fromDate: "1475-01-01", toDate: "1475-01-15", round: 2 });
  const b = tickProjects({ projects: a.projects, world, host: "Old Kingdom", fromDate: "1475-01-15", toDate: "1475-01-31", round: 2 });
  assert.ok(Math.abs(b.projects[0].progress - whole.projects[0].progress) <= 0.0001, "partition rounding never changes a full day of work");
  assert.equal(b.projects[0].spent, 0);
  assert.deepEqual([...a.outcomes, ...b.outcomes], whole.outcomes);
});

test("scenario editor saves an explicit author choice and new games copy it from the template", () => {
  const editor = readFileSync(new URL("../Game/GameUI/libraryBar.jsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../../server/libraryStore.js", import.meta.url), "utf8");
  assert.match(editor, /projectFundingMode: world\.projectFundingMode/);
  assert.match(editor, /projectFundingMode: editorState\.projectFundingMode/);
  assert.match(server, /"projectFundingMode"/);
});

test("the Projects panel passes scenario funding policy to the engine's reduced world view", () => {
  const panel = readFileSync(new URL("../Game/GameUI/projects.jsx", import.meta.url), "utf8");
  assert.match(panel, /const projectFundingMode = useRuntimeState\("world", selectProjectFundingMode\)/);
  assert.match(panel, /const engineWorld = useMemo\(\(\) => \(\{ countryStats, projects, projectFundingMode \}\)/);
});
