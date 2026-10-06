/*! Open Historia — the folded time skip: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/foldedSkip.test.js
//
// Runs without node_modules: foldedSkip.js imports nothing, and gameplay.js is
// read as text.
//
// A time skip is one request while requests are being saved. What that promise
// rests on is checked here: when a refusal is the contract's fault (and only
// then is the skip asked again the old way), that a board op is applied once,
// and that an agent's report reaches the agent it was written for.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  assignAgentReports,
  boardOpsOf,
  liftBoardOps,
  providerRefusedContract,
  withoutBoardOps,
} from "./foldedSkip.js";
import { foldJumpTool, getGameplayTool, validateGameplayPayload, AGENT_REPORTS_FIELD } from "./gameplaySchemas.js";

const gameplaySource = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const functionBody = (name) => {
  const start = gameplaySource.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} is in gameplay.js`);
  const next = gameplaySource.indexOf("\nconst ", start + 10);
  const exported = gameplaySource.indexOf("\nexport const ", start + 10);
  const end = Math.min(...[next, exported].filter((at) => at > start));
  return gameplaySource.slice(start, end);
};

// ---------------------------------------------------------------------------
// When a refusal is the contract's fault

test("a request every response refused, one of them a 400 or a 422, was refused as sent", () => {
  assert.equal(providerRefusedContract([400]), true);
  assert.equal(providerRefusedContract([422]), true);
  assert.equal(providerRefusedContract([429, 400]), true, "a rate limit first does not hide the refusal");
  assert.equal(providerRefusedContract(["400"]), true, "a status that arrived as text");
});

test("an answered request, a busy model and a rate limit are not the contract's fault", () => {
  assert.equal(providerRefusedContract([]), false, "nothing was sent");
  assert.equal(providerRefusedContract([200]), false);
  assert.equal(providerRefusedContract([400, 200]), false, "refused in one form and answered in another: it was the form");
  assert.equal(providerRefusedContract([429, 429]), false);
  assert.equal(providerRefusedContract([503]), false);
  assert.equal(providerRefusedContract([401]), false, "a bad key fails the same with any contract");
  assert.equal(providerRefusedContract(null), false);
});

// ---------------------------------------------------------------------------
// The board's ops, lifted off the events

test("an event's board ops are read as objects only, and the event is left as it was", () => {
  const event = { title: "A", impacts: { projectOps: [{ op: "update", name: "X" }, null, "update X", [1]], unitOps: [{ op: "move" }] } };
  assert.deepEqual(boardOpsOf(event), [{ op: "update", name: "X" }]);
  assert.deepEqual(boardOpsOf({ title: "B" }), []);
  assert.deepEqual(boardOpsOf(null), []);
  assert.equal(event.impacts.projectOps.length, 4, "reading takes nothing away");
});

test("the same event without its board ops keeps everything else, and is a copy", () => {
  const event = { title: "A", date: "2026-01-02", impacts: { projectOps: [{ op: "update", name: "X" }], unitOps: [{ op: "move", unitId: "u" }] } };
  const bare = withoutBoardOps(event);
  assert.deepEqual(bare, { title: "A", date: "2026-01-02", impacts: { unitOps: [{ op: "move", unitId: "u" }] } });
  assert.equal(event.impacts.projectOps.length, 1, "the original is not touched");
  const none = { title: "B", impacts: { unitOps: [] } };
  assert.equal(withoutBoardOps(none), none, "an event with no board ops comes back as it is");
  assert.equal(withoutBoardOps({ title: "C" }).title, "C");
  assert.equal(withoutBoardOps(null), null);
  assert.deepEqual(withoutBoardOps({ title: "D", impacts: { projectOps: [] } }), { title: "D", impacts: {} }, "an empty list goes too");
});

test("lifted ops name their event by its place in the list the board pass is shown", () => {
  const shown = [{ id: "a" }, { id: "b" }, { id: "hidden" }];
  const written = new Map([[shown[0], [{ op: "update", name: "Rail" }]], [shown[2], [{ op: "milestone", name: "Rail" }, { op: "update", name: "Port" }]]]);
  assert.deepEqual(liftBoardOps(shown, (event) => written.get(event)), [
    { op: "update", name: "Rail", eventIndex: 0 },
    { op: "milestone", name: "Rail", eventIndex: 2 },
    { op: "update", name: "Port", eventIndex: 2 },
  ]);
  assert.deepEqual(liftBoardOps(shown, () => undefined), [], "no event carried one");
  assert.deepEqual(liftBoardOps([{ id: "a" }], () => [{ op: "update", name: "Rail", eventIndex: 9 }]), [{ op: "update", name: "Rail", eventIndex: 0 }], "the position is the engine's, never the model's");
});

// ---------------------------------------------------------------------------
// The agents' reports

const JOBS = [{ key: "agent_1", name: "Russia" }, { key: "agent_2", name: "People's Republic of China" }];
const report = (agent, subject) => ({ agent, exchanges: [{ subject }] });

test("a report goes to the agent whose key it carries, without the key", () => {
  const assigned = assignAgentReports(JOBS, [report("agent_2", "tariffs"), report("agent_1", "grain")]);
  assert.deepEqual(assigned.map(({ job, report: filed }) => [job.key, filed.exchanges[0].subject, "agent" in filed]), [
    ["agent_1", "grain", false],
    ["agent_2", "tariffs", false],
  ]);
});

test("a model that named the country instead is still understood", () => {
  const assigned = assignAgentReports(JOBS, [report("the agent inside Russia", "grain"), report("People's Republic of China", "tariffs")]);
  assert.deepEqual(assigned.map(({ job }) => job.key), ["agent_1", "agent_2"]);
  const folded = assignAgentReports(JOBS, [report("Agent in RUSSIA", "grain")]);
  assert.deepEqual(folded.map(({ job }) => job.key), ["agent_1"]);
  const custom = assignAgentReports(JOBS, [report("PRC", "tariffs")], { sameName: (left, right) => left === "PRC" && right === "People's Republic of China" });
  assert.deepEqual(custom.map(({ job }) => job.key), ["agent_2"], "the caller's own rule for what a name is");
});

test("a report for nobody listed is nobody's, and an agent gets only the first written for it", () => {
  assert.deepEqual(assignAgentReports(JOBS, [report("agent_7", "x"), report("France", "y"), report("", "z")]), []);
  const twice = assignAgentReports(JOBS, [report("agent_1", "first"), report("agent_1", "second")]);
  assert.deepEqual(twice.map(({ report: filed }) => filed.exchanges[0].subject), ["first"]);
  assert.deepEqual(assignAgentReports(JOBS, "not a list"), []);
  assert.deepEqual(assignAgentReports(JOBS, [null, "agent_1", ["agent_1"]]), []);
  assert.deepEqual(assignAgentReports([], [report("agent_1", "x")]), []);
});

// ---------------------------------------------------------------------------
// The contract

test("the contract a skip is sent by default has no board and no agents' reports", () => {
  for (const task of ["jumpForward", "autoJumpForward"]) {
    const tool = getGameplayTool(task);
    assert.equal("projectOps" in tool.schema.properties.events.items.properties.impacts.properties, false, task);
    assert.equal(AGENT_REPORTS_FIELD in tool.schema.properties, false, task);
  }
});

test("folding adds the board under each event's impacts, and the agents' reports last, each only when asked for", () => {
  const lean = getGameplayTool("jumpForward");
  const board = foldJumpTool(lean);
  const impacts = board.schema.properties.events.items.properties.impacts.properties;
  assert.equal(Object.keys(impacts).at(-1), "projectOps", "after every other consequence");
  assert.equal(impacts.projectOps.items.properties.op.enum.includes("update"), true);
  for (const dropped of ["priority", "linkedUnitIds", "linkedMarkerIds", "focus", "project", "onComplete", "startedAt"]) {
    assert.equal(dropped in impacts.projectOps.items.properties, false, `${dropped} is not an event's to set`);
  }
  assert.equal(AGENT_REPORTS_FIELD in board.schema.properties, false);

  const both = foldJumpTool(lean, { agentReports: true });
  assert.equal(Object.keys(both.schema.properties).at(-1), AGENT_REPORTS_FIELD, "written after the events they must agree with");
  assert.deepEqual(both.schema.properties[AGENT_REPORTS_FIELD].items.required, ["agent", "exchanges"]);

  const agentsOnly = foldJumpTool(lean, { board: false, agentReports: true });
  assert.equal("projectOps" in agentsOnly.schema.properties.events.items.properties.impacts.properties, false, "an empty board is not kept");
  assert.equal(AGENT_REPORTS_FIELD in agentsOnly.schema.properties, true);

  assert.equal(foldJumpTool(lean, { board: false, agentReports: false }), lean, "nothing to add: the tool as it was");
  assert.equal(lean.schema.properties.events.items.properties.impacts.properties.projectOps, undefined, "and the tool it was given is never changed");
  const other = { name: "submit_other", schema: { type: "object", properties: { summary: { type: "string" } } } };
  assert.equal(foldJumpTool(other), other, "anything that is not a skip's tool comes back as it was");
});

test("an answer written to either contract passes the skip's validation", () => {
  const event = (impacts) => ({ date: "2026-01-05", title: "A depot opens", description: "A depot opens at the northern railhead.", impacts });
  const base = { stopDate: "2026-02-01", summary: "A quiet month." };
  const lean = { ...base, events: [event({ unitOps: [{ op: "move", unitId: "u-1", at: "Kharkiv" }] })] };
  const folded = {
    ...base,
    events: [event({ projectOps: [{ op: "update", projectId: "p-1", name: "Northern Rail Corridor", progress: 50, lastUpdate: "Section two is laid." }] })],
    [AGENT_REPORTS_FIELD]: [{ agent: "agent_1", exchanges: [{ counterpart: "France", date: "2026-01-09", subject: "Grain", messages: [{ speaker: "Russia", text: "We can hold the price." }, { speaker: "France", text: "Put it in writing." }] }] }],
  };
  for (const [label, payload] of [["lean", lean], ["folded", folded]]) {
    for (const task of ["jumpForward", "autoJumpForward"]) {
      const verdict = validateGameplayPayload(task, payload);
      assert.equal(verdict.valid, true, `${label} answer to ${task}: ${verdict.error}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The wiring, read from gameplay.js (which does not load under bare node)

test("a skip is folded exactly when requests are being saved, decided once", () => {
  const body = functionBody("runJumpSegments");
  assert.match(body, /if \(state\.folded === undefined\) state\.folded = Boolean\(state\.requests\?\.saving\) && !foldedSkipRefused;/);
  assert.match(body, /if \(state\.folded && !state\.foldedPrep\) state\.foldedPrep = await prepareFoldedSkip\(/);
  assert.match(body, /toolTransform: \(tool\) => foldJumpTool\(tool, \{ board: Boolean\(state\.foldedPrep\?\.board\), agentReports: agentJobs\.length > 0 \}\)/);
  assert.match(body, /const agentJobs = state\.folded && isFinalSegment \?/, "the agents report once, with the last segment");
});

test("a refused folded request is asked again the old way, and only a refusal is", () => {
  const body = functionBody("runJumpSegments");
  assert.match(body, /refused = answer\.generation\?\.source === "fallback" && providerRefusedContract\(statuses\);/);
  assert.match(body, /if \(signal\?\.aborted \|\| error\?\.name === "AbortError" \|\| !\(tooBig \|\| providerRefusedContract\(statuses\)\)\) throw error;/, "a cancel is never swallowed");
  const retry = body.slice(body.indexOf("if (refused) {"), body.indexOf("const { generation: segmentGeneration"));
  assert.match(retry, /state\.folded = false;/);
  assert.match(retry, /answer = await askSegment\(false\);/);
  assert.match(retry, /if \(answer\.generation\?\.source !== "fallback"\) foldedSkipRefused = true;/, "remembered only once the old way has worked");
  assert.ok(retry.indexOf("state.folded = false;") < retry.indexOf("answer = await askSegment(false);"));
});

test("the finish reads a folded skip's review off its own answer, and asks for one only when it was not folded", () => {
  const body = functionBody("finishTimelineJump");
  assert.match(body, /const folded = Boolean\(state\.folded && state\.requests\?\.saving\);/);
  assert.match(body, /\? \(folded \? foldedTurnReview\(\{ context, merged, state \}\) : await runTurnReview\(\{ context, merged, signal, state \}\)\)\s*\n\s*: null;/);
  const strip = body.slice(body.indexOf("if (!folded) {"), body.indexOf("const review ="));
  assert.match(strip, /merged\.events = normalizeArray\(merged\.events\)\.map\(withoutBoardOps\);/, "a board op is never left on an event the board pass will also move");
  assert.match(strip, /state\.hiddenEvents = normalizeArray\(state\.hiddenEvents\)\.map\(withoutBoardOps\);/);
});

test("the folded review takes the ops off the events before anything applies them", () => {
  const body = functionBody("foldedTurnReview");
  const lifted = body.indexOf("merged.events = rawEvents.map(withoutBoardOps);");
  assert.ok(lifted > 0 && lifted < body.indexOf("if (normalizeString(state.generation?.source) === \"fallback\") return review;"), "even on a canned turn");
  assert.match(body, /const eventOps = rawEvents\.map\(boardOpsOf\);/);
  assert.match(body, /review\.boardShownEvents = shown;/);
  assert.match(body, /validateGameplayPayload\("projects", candidate\)/, "held to the board's own schema");
  assert.match(body, /validateGameplayPayload\("spyIntercept", candidate\)/, "and each report to the agents' own");
  assert.match(body, /if \(state\.foldedPrep\?\.board\) \{/, "an empty board is not looked at");
});

test("every check after a skip always runs: no switch is read anywhere in the turn", () => {
  assert.equal(/reviewSection\(/.test(gameplaySource), false);
  assert.equal(/requestSettings\b/.test(gameplaySource), false, "the settings module is no longer needed here at all");
  const review = functionBody("runTurnReview");
  for (const builder of ["buildUnitDirectorInput(", "buildTerritoryDirectorInput(", "buildStructureDirectorInput(", "buildCuratorInput("]) {
    assert.ok(review.includes(`= ${builder}`) || review.includes(`= await ${builder}`), `${builder} is called unconditionally`);
  }
});

// A scenario's region types can carry rules for moving and placing (an
// impassable sea, land out of play). They were told to the unit and structure
// directors only, in the requests those made anyway. A folded skip asks neither
// director, and moves the units and builds the structures itself.
test("a folded skip is told the map's own rules for moving and placing, as the directors were", () => {
  assert.match(functionBody("prepareFoldedSkip"), /regionTypeRules: await regionTypeRulesFor\(bundle\.world\)\.catch\(\(\) => ""\),/);
  assert.match(functionBody("runJumpSegments"), /foldedRegionTypeRules: normalizeString\(state\.foldedPrep\?\.regionTypeRules\),/);
  const live = functionBody("buildJumpLiveState");
  assert.match(live, /const regionTypes = foldedSkip \? regionTypesBlock\(variables\.foldedRegionTypeRules\) : "";\s*\n\s*if \(regionTypes\) blocks\.push\(regionTypes\);/);
  assert.ok(live.indexOf("blocks.push(FOLDED_SKIP_CONSEQUENCES)") < live.indexOf("regionTypesBlock(variables.foldedRegionTypeRules)"), "after the rule that the events place things themselves");
  // One wording for both readers.
  const block = functionBody("regionTypesBlock");
  assert.match(block, /\[Region types\]\\nThe scenario's author gave these kinds of region rules for moving units and placing things\. Keep every move, new unit and structure to them:/);
  assert.match(block, /return text\s*\n\s*\? /, "a map whose types have no rules adds nothing");
  assert.match(gameplaySource, /\["unitDirector", "structureDirector"\]\.includes\(taskKey\) && normalizeString\(variables\?\.regionTypeRules\)\) \{\s*\n\s*systemPrompt = `\$\{systemPrompt\}\\n\\n\$\{regionTypesBlock\(variables\.regionTypeRules\)\}`;/);
});

test("the folded rules reach the prompt only for a folded skip", () => {
  const body = functionBody("buildJumpLiveState");
  assert.match(body, /const foldedSkip = Boolean\(variables\.foldedSkip\);/);
  assert.match(body, /if \(foldedSkip\) blocks\.push\(FOLDED_SKIP_CONSEQUENCES\);/);
  assert.match(body, /folded: foldedSkip,/);
  assert.match(body, /const agentReports = foldedSkip \? normalizeString\(variables\.foldedAgentReports\) : "";/);
  const rules = gameplaySource.slice(gameplaySource.indexOf("const FOLDED_SKIP_CONSEQUENCES = ["), gameplaySource.indexOf("].join(\"\\n\");", gameplaySource.indexOf("const FOLDED_SKIP_CONSEQUENCES = [")));
  for (const lever of ["regionControlOps", "regionTransfers", "Current Military Units", "markerOps", "actionIds", "projectOps"]) {
    assert.ok(rules.includes(lever), `the rules name ${lever}`);
  }
  assert.match(rules, /Nothing checks your events afterwards\./);
});
