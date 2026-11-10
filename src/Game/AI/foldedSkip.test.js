/*! Open Historia — the folded time skip: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/foldedSkip.test.js
//
// Runs without node_modules: foldedSkip.js imports nothing, and gameplay.js is
// read as text.
//
// A time skip is one request, in every mode. What that promise rests on is
// checked here: when a refusal is the contract's fault (and only then is the
// skip asked again the old way), that a board op is applied once, that an
// agent's report reaches the agent it was written for, that nothing after a
// skip is a request of its own any more, and that function calling, the one
// thing that can add requests, is counted against the skip's budget.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  FOLDED_SKIP_SCHEMA_BUDGET,
  assignAgentReports,
  boardOpsOf,
  ceilingAfterRefusal,
  fitSkipRiders,
  liftBoardOps,
  providerRefusedContract,
  ridersThatWaited,
  withoutBoardOps,
} from "./foldedSkip.js";
import { foldJumpTool, getGameplayTool, validateGameplayPayload, AGENT_REPORTS_FIELD, GAMEPLAY_SCHEMAS, HISTORY_FIELD, NO_SKIP_HISTORY_JOB } from "./gameplaySchemas.js";

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

// The statuses cannot tell these apart from a refusal: the call gave way on
// something else first (a 400), and then the connection went. The task runner
// says how the call ended.
test("a call that ended on the connection was not refused, whatever statuses came before it", () => {
  // The JSON-text form refused, then the server could not be reached for the second request.
  assert.equal(providerRefusedContract([400]), true);
  assert.equal(providerRefusedContract([400], { transportFailure: true }), false);
  assert.equal(providerRefusedContract([422, 400], { transportFailure: true }), false);
  assert.equal(providerRefusedContract([429, 400], { transportFailure: true }), false);
  // A server that was never reached sent nothing at all, and one that closed
  // mid-answer had answered 200: neither was a refusal to begin with.
  assert.equal(providerRefusedContract([], { transportFailure: true }), false);
  assert.equal(providerRefusedContract([200], { transportFailure: true }), false);
  assert.equal(providerRefusedContract([400, 200], { transportFailure: true }), false);
  // An answer cut at the model's output limit came with a 200.
  assert.equal(providerRefusedContract([200]), false);
  // And a refusal stays one: the word is only ever the task runner's, about the connection.
  assert.equal(providerRefusedContract([400], { transportFailure: false }), true);
  assert.equal(providerRefusedContract([400], {}), true);
  assert.equal(providerRefusedContract([400, 400]), true, "refused as JSON text and again as a function call");
});

// ---------------------------------------------------------------------------
// What a skip's function can carry (the sizes themselves: foldedSkipSent.test.js)

// A size function from what each rider adds to a lean contract.
const sizes = (base, add) => (riders) => base + Object.entries(add).reduce((sum, [name, chars]) => sum + (riders[name] ? chars : 0), 0);
const ADD = { board: 1300, agentReports: 1000, history: 800 };

test("a skip carries every rider that fits, and leaves none out that does", () => {
  const fit = fitSkipRiders({ wanted: { board: true, agentReports: true, history: true }, historyDue: true, sizeOf: sizes(27000, ADD) });
  assert.deepEqual(fit.riders, { board: true, agentReports: true, history: true });
  assert.deepEqual(fit.leftOut, []);
  assert.equal(fit.chars, 30100);
  assert.equal(fit.fits, true);
  // Nothing is added that was not wanted.
  assert.deepEqual(fitSkipRiders({ wanted: { board: true }, sizeOf: sizes(27000, ADD) }).riders, { board: true, agentReports: false, history: false });
});

test("over the ceiling, the history field with no fold due goes first: nothing is lost", () => {
  const fit = fitSkipRiders({ wanted: { board: true, agentReports: true, history: true }, historyDue: false, sizeOf: sizes(28000, ADD) });
  assert.deepEqual(fit.leftOut, ["history"]);
  assert.deepEqual(fit.riders, { board: true, agentReports: true, history: false });
  assert.ok(fit.chars <= FOLDED_SKIP_SCHEMA_BUDGET);
});

test("a due fold goes before the agents, and the next skip the agents go before it", () => {
  const ask = (waited) => fitSkipRiders({ wanted: { board: true, agentReports: true, history: true }, historyDue: true, sizeOf: sizes(28000, ADD), waited });
  const first = ask([]);
  assert.deepEqual(first.leftOut, ["history"]);
  const waited = ridersThatWaited(first.leftOut, { historyDue: true });
  assert.deepEqual(waited, ["history"], "a due fold left out has waited");
  const second = ask(waited);
  assert.deepEqual(second.leftOut, ["agentReports"], "so it goes after the agents next time");
  assert.equal(second.riders.history, true);
  assert.deepEqual(ask(ridersThatWaited(second.leftOut, { historyDue: true })).leftOut, ["history"], "and the skip after, the agents are owed");
  // A history field with no job left out has not waited for anything.
  assert.deepEqual(ridersThatWaited(["history"], { historyDue: false }), []);
});

test("the board goes last, and a lean contract over the ceiling still asks, with nothing added", () => {
  const tight = fitSkipRiders({ wanted: { board: true, agentReports: true, history: true }, historyDue: true, sizeOf: sizes(28000, ADD), ceiling: 29400 });
  assert.deepEqual(tight.leftOut, ["history", "agentReports"]);
  assert.equal(tight.riders.board, true);
  const none = fitSkipRiders({ wanted: { board: true, agentReports: true, history: true }, sizeOf: sizes(31000, ADD) });
  assert.deepEqual(none.leftOut, ["history", "agentReports", "board"]);
  assert.deepEqual(none.riders, { board: false, agentReports: false, history: false });
  assert.equal(none.fits, false);
});

test("a refusal lowers the ceiling below what was refused, so the next skip folds with less, and never raises it", () => {
  assert.equal(ceilingAfterRefusal(FOLDED_SKIP_SCHEMA_BUDGET, 30100), 30099);
  assert.equal(ceilingAfterRefusal(29000, 30100), 29000, "a ceiling already lower stays");
  assert.equal(ceilingAfterRefusal(29000, undefined), 29000, "a refusal of unknown size changes nothing");
  // The skip after a refusal of all three riders folds again with two of them.
  const ceiling = ceilingAfterRefusal(FOLDED_SKIP_SCHEMA_BUDGET, 30100);
  const next = fitSkipRiders({ wanted: { board: true, agentReports: true, history: true }, historyDue: false, sizeOf: sizes(27000, ADD), ceiling });
  assert.deepEqual(next.riders, { board: true, agentReports: true, history: false });
  assert.ok(next.chars < 30100);
});

// The history may never fold for a session (review of 2026-11-09): a skip
// asked the old way never carried the fold, the request of its own the
// consolidator once made past 96 events is gone, and after a refusal every
// skip of the session was asked the old way. Now every skip folds again, and a
// fold cannot be crowded out for good.
test("a board with no entries gives way before anything with a job", () => {
  const fit = fitSkipRiders({ wanted: { board: true, agentReports: true, history: true }, historyDue: true, boardShown: false, sizeOf: sizes(28000, ADD) });
  assert.deepEqual(fit.leftOut, ["board"]);
  assert.deepEqual(fit.riders, { board: false, agentReports: true, history: true });
});

test("under a ceiling a refusal lowered, a fold that waited goes ahead of the board, so the history keeps folding", () => {
  // Room for the lean contract and one of the board and the fold.
  const ceiling = 28400;
  let waited = [];
  const folded = [];
  for (let skip = 0; skip < 6; skip += 1) {
    const fit = fitSkipRiders({ wanted: { board: true, agentReports: true, history: true }, historyDue: true, sizeOf: sizes(27000, ADD), ceiling, waited });
    assert.ok(fit.chars <= ceiling);
    folded.push(fit.riders.history);
    waited = ridersThatWaited(fit.leftOut, { historyDue: true });
  }
  assert.deepEqual(folded, [false, true, false, true, false, true], "the fold waits one skip at most");
  // And the board is kept whenever no waiting fold needs its room.
  const fresh = fitSkipRiders({ wanted: { board: true, history: true }, historyDue: true, sizeOf: sizes(27000, ADD), ceiling, waited: [] });
  assert.deepEqual(fresh.leftOut, ["history"]);
});

test("a skip shown no board does not keep the board's ops over a rider with a job", () => {
  assert.match(functionBody("runJumpSegments"), /boardShown: Boolean\(state\.foldedPrep\?\.board\),/);
});

test("a refused folded skip no longer turns folding off for the session", () => {
  assert.equal(gameplaySource.includes("foldedSkipRefused"), false);
  assert.match(gameplaySource, /let foldedSkipCeiling = FOLDED_SKIP_SCHEMA_BUDGET;/);
  const body = functionBody("runJumpSegments");
  assert.match(body, /ceiling: foldedSkipCeiling,/);
  assert.match(body, /waited: skipRidersWaiting,/);
  assert.match(body, /skipRidersWaiting = ridersThatWaited\(fit\.leftOut, \{ historyDue: Boolean\(dueHistoryJob\) \}\);/);
  // Weighed against the function the request will really carry: the task's
  // own tool for this segment's variables, as runJsonTask builds it.
  assert.match(body, /const baseTool = await jumpToolSent\(mode === "auto" \? "autoJumpForward" : "jumpForward", segmentVariables\);/);
  assert.match(body, /sizeOf: \(carried\) => geminiFunctionChars\(foldJumpTool\(baseTool, carried\)\),/);
  assert.match(functionBody("runJsonTask"), /const ratedTool = taskToolFor\(taskKey, statContract, variables\);/);
  // And the prompt asks for nothing the function leaves out.
  assert.match(body, /foldedBoard: riders\.board,/);
  assert.match(body, /foldedBoardDoubts: riders\.board \?/);
  assert.match(body, /foldedHistoryField: riders\.history,/);
  // A fold left out was never asked: it waits, and is no failure of the skip.
  assert.match(functionBody("foldedTurnReview"), /const fold = state\.foldedHistoryCarried \? \(state\.foldedPrep\?\.history \?\? null\) : null;/);
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

test("the lean contract has no board, no agents' reports and no history: each is added only when a skip carries it", () => {
  for (const task of ["jumpForward", "autoJumpForward"]) {
    const tool = getGameplayTool(task);
    assert.equal("projectOps" in tool.schema.properties.events.items.properties.impacts.properties, false, task);
    assert.equal(AGENT_REPORTS_FIELD in tool.schema.properties, false, task);
    assert.equal(HISTORY_FIELD in tool.schema.properties, false, task);
  }
});

test("the history fold is the last field of the contract, and only when a fold is due", () => {
  const lean = getGameplayTool("jumpForward");
  assert.equal(HISTORY_FIELD in foldJumpTool(lean, { agentReports: true }).schema.properties, false, "no fold due, no field");
  const all = foldJumpTool(lean, { agentReports: true, history: true });
  assert.deepEqual(Object.keys(all.schema.properties).slice(-2), [AGENT_REPORTS_FIELD, HISTORY_FIELD], "after the reports: the one an answer cut short can best do without");
  assert.deepEqual(all.schema.properties[HISTORY_FIELD].required, ["summary"]);
  assert.deepEqual(Object.keys(all.schema.properties[HISTORY_FIELD].properties), ["summary", "years", "canon", "eras", "document"], "the consolidator's own fields, the history in tiers among them");
  // Each tier's entries name their fields, as the consolidator's do: an object
  // with no properties came back from Gemini as {} (the quality A/B of 2026-11-07).
  const tiers = all.schema.properties[HISTORY_FIELD].properties;
  for (const tier of ["years", "canon", "eras"]) {
    assert.deepEqual(tiers[tier].items, GAMEPLAY_SCHEMAS.eventConsolidator.properties[tier].items, `${tier}: the consolidator's entry shape`);
  }
  assert.deepEqual(Object.keys(tiers.years.items.properties), ["year", "text"]);
  assert.deepEqual(Object.keys(tiers.canon.items.properties), ["date", "kind", "text", "key"]);
  assert.deepEqual(Object.keys(tiers.eras.items.properties), ["from", "to", "text"]);
  const historyOnly = foldJumpTool(lean, { board: false, history: true });
  assert.equal(HISTORY_FIELD in historyOnly.schema.properties, true, "a skip with no board and no agents still carries a fold that is due");
  assert.equal("projectOps" in historyOnly.schema.properties.events.items.properties.impacts.properties, false);
  // An answer that carries one passes the skip's own validation: it is judged
  // when it is read, never by the schema (a poor fold costs the fold, not the turn).
  const answer = { stopDate: "2026-02-01", summary: "A quiet month.", events: [{ date: "2026-01-05", title: "A depot opens", description: "A depot opens at the railhead." }], [HISTORY_FIELD]: { summary: "x", document: "" } };
  assert.equal(validateGameplayPayload("jumpForward", answer).valid, true);
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

test("every skip is folded, with Save AI requests on or off, decided once", () => {
  const body = functionBody("runJumpSegments");
  // No setting is read, and no refusal earlier in the session: every skip
  // starts folded, carrying what fits (fitSkipRiders).
  assert.match(body, /if \(state\.folded === undefined\) state\.folded = true;/);
  assert.equal(/state\.requests\?\.saving/.test(body), false, "whether requests are being saved no longer decides what a skip asks");
  assert.match(body, /if \(state\.folded && !state\.foldedPrep\) state\.foldedPrep = await prepareFoldedSkip\(/);
  // The same contract on every folded skip of a game where it fits (a provider caches the function with the prompt).
  assert.match(body, /wanted: \{ board: true, agentReports: dueAgentJobs\.length > 0, history: true \},/);
  assert.match(body, /toolTransform: \(tool\) => foldJumpTool\(tool, riders\)/);
  assert.match(body, /if \(state\.folded && agentJobs\.length && segmentGeneration\?\.source !== "fallback"\) state\.foldedAgentAnswer = payload\[AGENT_REPORTS_FIELD\];/, "reports are read only where agents were due");
  assert.match(body, /const dueAgentJobs = state\.folded && isFinalSegment \?/, "the agents report once, with the last segment");
  assert.match(body, /const dueHistoryJob = state\.folded && isFinalSegment \? buildSkipHistoryJob\(state\.foldedPrep\?\.history\?\.brief\) : "";/, "and so does the history fold");
  // The prompt asks only for what the function carries.
  assert.match(body, /const agentJobs = riders\.agentReports \? dueAgentJobs : \[\];/);
  assert.match(body, /const historyJob = riders\.history \? dueHistoryJob : "";/);
  // One request in every mode: a flawed answer is cut down, never sent back.
  assert.match(body, /salvage: true,/);
});

// A fold that could not be prepared was `{ separate: true }`, which reads as a
// fold that is due: every such skip logged its history as waiting on an
// answer it was never asked for, as a problem (review of 2026-11-09).
test("a fold that could not be prepared is no fold at all, never one that failed", () => {
  const prepare = functionBody("prepareFoldedSkip");
  assert.match(prepare, /let history = null;\n\s*try \{\n\s*history = await prepareSkipHistoryFold\(bundle, \{ campaignId \}\);/);
  assert.doesNotMatch(prepare, /separate: true|the pass after/);
  // Read only where the skip carried it, and only where one was prepared.
  assert.match(functionBody("foldedTurnReview"), /if \(fold\) \{\n\s*review\.history = \{\n\s*due: true,/);
});

test("the history a skip folds is planned before it and written from its own answer", () => {
  const prepare = functionBody("prepareSkipHistoryFold");
  assert.match(prepare, /planHistoryConsolidation\(bundle, \{ round: \(Number\(bundle\.game\?\.round\) \|\| 0\) \+ 1 \}\)/, "for the round the skip is about to produce");
  assert.match(prepare, /if \(!plan\.due\) return null;/);
  // A batch sent before the consolidator's own request went folds these events when it lands.
  assert.match(prepare, /if \(hasPendingBatch\("eventConsolidator", campaignId\)\) return null;/);
  assert.doesNotMatch(prepare, /separate/);
  assert.match(prepare, /buildTaskSystemPrompt\("eventConsolidator", \{ variables, lookups: null, reminders: false \}\)/, "the consolidator's own prompt, whole");

  const segments = functionBody("runJumpSegments");
  assert.match(segments, /if \(payload && typeof payload === "object" && HISTORY_FIELD in payload\) \{/);
  assert.match(segments, /delete payload\[HISTORY_FIELD\];/, "the fold never reaches anything that applies events");

  const review = functionBody("foldedTurnReview");
  assert.match(review, /\n {2}review\.history = \{ due: false \};/);
  assert.ok(review.indexOf("review.history = { due: false }") < review.indexOf("if (normalizeString(state.generation?.source) === \"fallback\") return review;"), "a canned turn folds nothing and asks for nothing");
  assert.match(review, /\.\.\.judgeSkipHistoryAnswer\(state\.foldedHistoryAnswer, \{ currentText: fold\.currentText, span: fold\.span, eraWords: fold\.eraWords \}\),/);

  // Written from the skip's answer, and only from it: the event consolidator,
  // a request of its own after a skip, went on 2026-11-07.
  assert.match(gameplaySource, /nextWorld = applySkipHistoryFold\(\{[\s\S]{0,200}?\}, review\?\.history \?\? null\);/);
  const pass = functionBody("applySkipHistoryFold");
  assert.match(pass, /if \(!skipFold\?\.due\) return world;/, "nothing was due before the skip: nothing is folded after it");
  assert.match(pass, /if \(!skipFold\.ok\) \{[\s\S]*?return world;\s*\n\s*\}/, "a fold that failed waits for the next skip");
  assert.equal(/runJsonTask|callAI|budget\.take/.test(pass), false, "a carried fold is written with no request");
  for (const gone of ["consolidateHistoryBatch", "compactHistoryIfNeeded", "consolidateHistoryNow"]) {
    assert.equal(gameplaySource.includes(gone), false, `${gone} is gone`);
  }
});

test("a refused folded request is asked again the old way, and only a refusal is", () => {
  const body = functionBody("runJumpSegments");
  assert.match(body, /refused = answer\.generation\?\.source === "fallback" && providerRefusedContract\(statuses, \{ transportFailure: answer\.transportFailure === true \}\);/);
  assert.match(body, /if \(signal\?\.aborted \|\| error\?\.name === "AbortError" \|\| !\(tooBig \|\| providerRefusedContract\(statuses, \{ transportFailure: error\?\.transportFailure === true \}\)\)\) throw error;/, "a cancel is never swallowed");
  const retry = body.slice(body.indexOf("if (refused) {"), body.indexOf("const { generation: segmentGeneration"));
  assert.match(retry, /state\.folded = false;/);
  assert.match(retry, /answer = await askSegment\(false\);/);
  assert.match(retry, /if \(answer\.generation\?\.source !== "fallback"\) \{\n\s*foldedSkipCeiling = ceilingAfterRefusal\(foldedSkipCeiling, state\.foldedChars\);/, "the ceiling drops only once the old way has worked");
  assert.ok(retry.indexOf("state.folded = false;") < retry.indexOf("answer = await askSegment(false);"));
  // A segment whose function carries no rider sends the lean contract, so
  // there is no folded request to refuse.
  assert.match(body, /if \(state\.folded && \(riders\.board \|\| riders\.agentReports \|\| riders\.history\)\) \{/);
});

// How the skip knows a call ended on the connection: the task runner says so,
// beside a fallback's result (a single-request skip) and on the error it throws
// (a segment of a longer one, which has no fallback).
test("the task runner says when a call ended on the connection, on its result and on the error it throws", () => {
  const body = functionBody("runJsonTask");
  assert.match(body, /transportFailure = connectionClosed \|\| isUnreachableError\(actualError\);/, "a server never reached, or a connection that closed mid-answer");
  assert.match(body, /payload: await fallback\(\),[^}]*\.\.\.\(transportFailure \? \{ transportFailure: true \} : \{\}\),\s*\};/, "beside the generation, which is written into the game's history");
  assert.match(body, /throw Object\.assign\(new Error\(`AI task "\$\{taskKey\}" failed: \$\{failureReason\}`\), transportFailure \? \{ transportFailure: true \} : \{\}\);/);
  assert.match(gameplaySource, /import \{ OUTPUT_LIMIT_MESSAGE, [^}]*\bisUnreachableError \} from "\.\/providerErrors\.js";/);
});

test("the finish reads a folded skip's review off its own answer, and a skip asked the old way has none", () => {
  const body = functionBody("finishTimelineJump");
  assert.match(body, /const folded = Boolean\(state\.folded\);/);
  // The folded one makes no request and cannot fail. The turn review a skip
  // asked the old way got went on 2026-11-07: its record is the empty one.
  assert.match(body, /const review = folded\s*\n\s*\? foldedTurnReview\(\{ context, merged, state \}\)\s*\n\s*: \{ asked: false, folded: false, parts: \{\}, reasons: \[\], boardShownEvents: \[\], agentReports: \[\], actionOutcomePlan: null \};/);
  const strip = body.slice(body.indexOf("if (!folded) {"), body.indexOf("const review ="));
  assert.match(strip, /merged\.events = normalizeArray\(merged\.events\)\.map\(withoutBoardOps\);/, "a board op is never left on an event the board pass will also move");
  assert.match(strip, /state\.hiddenEvents = normalizeArray\(state\.hiddenEvents\)\.map\(withoutBoardOps\);/);
  assert.doesNotMatch(strip, /moved by its own pass/, "no pass after the skip moves the board any more");
});

// A major event that rests only on a board entry is let through the segment
// check as provisional, to be proved by the board's ops. A skip asked the old
// way, or one whose function had no room for the board, has no board part, so
// nothing proves it: until 2026-11-09 every such event was judged unbacked
// (boardPassApply.js) and taken off the timeline.
test("with no board part, no event is provisional, and none leaves the timeline for want of board ops", () => {
  const finish = functionBody("finishTimelineJump");
  assert.match(finish, /boardProvisionalEventIds: review\.parts\?\.board \? state\.boardProvisionalEventIds : \[\],/);
  const apply = functionBody("applySimulationResult");
  assert.match(apply, /const boardAnswers = !review \|\| Boolean\(review\.parts\?\.board\);/, "the board's own request (no review) still proves them");
  assert.match(apply, /const provisionalIds = new Set\(boardAnswers\n\s*\? normalizeArray\(result\.boardProvisionalEventIds\)/);
  assert.match(gameplaySource, /impacts\.projectOps was not part of this answer: the Projects board did not move this time\./);
});

test("nothing after a skip is a request of its own: no director, no agent, no attribution, in any mode", () => {
  // With Save AI requests off each of these used to be a request (and each
  // agent due a report another): a busy skip made twenty or more.
  const finish = functionBody("finishTimelineJump");
  assert.equal(/runJsonTask\(/.test(finish), false, "the finish makes no request");
  assert.equal(/savingRequests\(\)|requests\?\.saving/.test(finish), false, "and reads no setting");
  // The three Directors run in mapConsequences.js, each answered from the
  // review's part (directorAnalyzers), which holds no request either.
  const directors = functionBody("directorAnalyzers");
  assert.equal(/runJsonTask\(|checks\.run\(/.test(directors), false, "a Director never asks");
  for (const part of ["units", "territory", "structures"]) {
    assert.ok(directors.includes(`review.parts.${part} ??`), `the ${part} check is the review's part, or none`);
  }
  assert.match(finish, /analyze: directorAnalyzers\(\{ bundle, review, receipt: state\.receipt \}\),/);
  for (const gone of ["runStandaloneActionOutcomeReview", "refreshSpyIntercepts", "runJsonTask(\"unitDirector\"", "runJsonTask(\"territoryDirector\"", "runJsonTask(\"structureDirector\""]) {
    assert.equal(gameplaySource.includes(gone), false, `${gone} is gone`);
  }
  // What a skip may spend on is one list (requestBudget.js), and no budget is
  // without a cap: nothing in the game can ask for one.
  const requests = functionBody("createJumpRequests");
  assert.match(requests, /createJumpBudget\(\{ cap: jumpRequestCap\(\{ segments: pieces, unlimited \}\), only: SKIP_SPENDERS \}\);/);
  // Unlimited requests raises the cap (requestBudget.js); it never takes it away.
  assert.match(requests, /const unlimited = unlimitedRequests\(\);/);
  assert.equal(/createJumpBudget\(\{(?![^}]*cap:)/.test(gameplaySource), false, "every budget has a cap");
  assert.match(requests, /budget\.reserve\("jump", pieces\);/, "every segment keeps its own request");
  // There is no upkeep after a skip to keep a request for: the Stats refresh
  // and the event consolidator went on 2026-11-07.
  assert.equal(/skipUpkeepDue|upkeep\?\.|reserve\("(?:history|stats|review)"/.test(gameplaySource), false);
  // The two that asked outside the list are told no before they build anything.
  assert.match(gameplaySource, /const insideSkip = Boolean\(requests\?\.budget\) && !requests\.budget\.allows\("geography"\);/);
  assert.match(functionBody("repairSkipStorylineMotion"), /const noRepairRequests = Boolean\(state\?\.requests\?\.budget\) && !state\.requests\.budget\.allows\("repair"\);/);
});

test("function calling inside a skip spends the skip's budget: a round is a request", () => {
  const task = functionBody("runJsonTask");
  // What the budget has free, and never past the mode's own limit (three, or
  // six with Unlimited requests on).
  assert.match(task, /const lookupRounds = budget && Array\.isArray\(lookups\?\.tools\) && lookups\.tools\.length\s*\n\s*\? Math\.min\(carriedRoundCount\(lookupCarry\) \+ budget\.free, lookupRoundLimit\(\{ unlimited: unlimitedRequests\(\) \}\)\)\s*\n\s*: null;/);
  assert.match(task, /maxRounds: Number\.isInteger\(lookups\.maxRounds\) \? Math\.min\(lookups\.maxRounds, lookupRounds\) : lookupRounds/);
  assert.match(task, /budget\?\.take\(`\$\{spender \|\| taskKey\}Lookup`\);/, "recorded as it is made");
  // Decided after the attempt's own request is taken, so `free` is what is left.
  assert.ok(task.indexOf("budget.take(outputAttempt === 1 ?") < task.indexOf("const lookupRounds ="));
  // Function calling is still the player's switch, and off while saving.
  assert.match(gameplaySource, /const lookupFunctionsEnabled = \(\) => !savingRequests\(\) && getMapSettingDefaultOn\(MAP_SETTING_KEYS\.lookupFunctions\);/);
});

test("the folded review takes the ops off the events before anything applies them", () => {
  const body = functionBody("foldedTurnReview");
  const lifted = body.indexOf("merged.events = rawEvents.map(withoutBoardOps);");
  assert.ok(lifted > 0 && lifted < body.indexOf("if (normalizeString(state.generation?.source) === \"fallback\") return review;"), "even on a canned turn");
  assert.match(body, /const eventOps = rawEvents\.map\(boardOpsOf\);/);
  assert.match(body, /review\.boardShownEvents = shown;/);
  assert.match(body, /validateGameplayPayload\("projects", candidate\)/, "held to the board's own schema");
  assert.match(body, /validateGameplayPayload\("spyIntercept", candidate\)/, "and each report to the agents' own");
  assert.match(body, /if \(state\.foldedPrep\?\.board && state\.foldedBoardCarried\) \{/, "an empty board is not looked at, nor one the function had no room for");
});

test("every check a Scene's map check makes always runs: no switch is read anywhere in the turn", () => {
  assert.equal(/reviewSection\(/.test(gameplaySource), false);
  assert.equal(/requestSettings\b/.test(gameplaySource), false, "the settings module is no longer needed here at all");
  const review = functionBody("runSceneReview");
  for (const builder of ["buildUnitDirectorInput(", "buildTerritoryDirectorInput(", "buildStructureDirectorInput("]) {
    assert.ok(review.includes(`= ${builder}`) || review.includes(`= await ${builder}`), `${builder} is called unconditionally`);
  }
  // A time skip's own checks (the timeline, the agents, order attribution) are no part of it.
  assert.equal(/buildCuratorInput\(|spyIntercept|requests\.budget/.test(review), false);
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
  assert.ok(functionBody("buildJumpStaticRules").includes("variables?.foldedSkip ? FOLDED_SKIP_CONSEQUENCES"), "or above, with the rules");
  // One wording for both readers.
  const block = functionBody("regionTypesBlock");
  assert.match(block, /\[Region types\]\\nThe scenario's author gave these kinds of region rules for moving units and placing things\. Keep every move, new unit and structure to them:/);
  assert.match(block, /return text\s*\n\s*\? /, "a map whose types have no rules adds nothing");
  assert.match(gameplaySource, /\["unitDirector", "structureDirector"\]\.includes\(taskKey\) && normalizeString\(variables\?\.regionTypeRules\)\) \{\s*\n\s*systemPrompt = `\$\{systemPrompt\}\\n\\n\$\{regionTypesBlock\(variables\.regionTypeRules\)\}`;/);
});

test("the folded rules reach the prompt only for a folded skip", () => {
  const body = functionBody("buildJumpLiveState");
  assert.match(body, /const foldedSkip = Boolean\(variables\.foldedSkip\);/);
  assert.match(body, /if \(foldedSkip && !rulesAbove\) blocks\.push\(FOLDED_SKIP_CONSEQUENCES\);/);
  // Where the template has a place for the standing rules, they are stated there instead, folded or not.
  assert.match(functionBody("buildJumpStaticRules"), /variables\?\.foldedSkip \? FOLDED_SKIP_CONSEQUENCES : "",/);
  assert.match(body, /const foldedBoard = foldedSkip && variables\.foldedBoard !== false;/);
  assert.match(body, /folded: foldedBoard,/, "the board's folded rules only where the function offers its ops");
  assert.match(body, /const agentReports = foldedSkip \? normalizeString\(variables\.foldedAgentReports\) : "";/);
  const rules = gameplaySource.slice(gameplaySource.indexOf("const FOLDED_SKIP_CONSEQUENCES = ["), gameplaySource.indexOf("].join(\"\\n\");", gameplaySource.indexOf("const FOLDED_SKIP_CONSEQUENCES = [")));
  for (const lever of ["regionControlOps", "regionTransfers", "Current Military Units", "markerOps", "actionIds", "projectOps"]) {
    assert.ok(rules.includes(lever), `the rules name ${lever}`);
  }
  assert.match(rules, /Nothing checks your events afterwards\./);
  // The history fold is the last block of the prompt: nothing of the skip's follows it.
  assert.match(body, /const historyJob = foldedSkip \? normalizeString\(variables\.foldedHistoryJob\) : "";/);
  assert.match(body, /if \(historyJob\) blocks\.push\(historyJob\);\n\s*else if \(foldedSkip && variables\.foldedHistoryField !== false\) blocks\.push\(NO_SKIP_HISTORY_JOB\);\s*\n\s*\n\s*return blocks\.filter\(Boolean\)\.join\("\\n\\n"\);/);
  // Without a job, the field the function offers on every turn is to be left out (the quality A/B of 2026-11-07).
  assert.match(NO_SKIP_HISTORY_JOB, new RegExp(`leave the "${HISTORY_FIELD}" field out`));
  assert.match(foldJumpTool(getGameplayTool("jumpForward"), { history: true }).schema.properties[HISTORY_FIELD].description, /else leave it out/);
});

// What the player is told a skip costs, under the skip buttons and in Settings.
test("the time panel says one request, and three only while function calling can add to it", () => {
  const time = readFileSync(new URL("../GameUI/time.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const caption = time.slice(time.indexOf("const RequestsTodayCaption = () => {"), time.indexOf("const JumpNode ="));
  // Both switches are held as state. A value read from storage while rendering
  // is one the compiler keeps from the first render: seen in the app, where the
  // line went on saying "1 request" after Save AI requests was switched off.
  assert.match(caption, /const \[saving, setSaving\] = useState\(\(\) => savingRequests\(\)\);/);
  assert.match(caption, /setSaving\(savingRequests\(\)\);/);
  assert.match(caption, /const lookupsOn = useMapSettingValue\(MAP_SETTING_KEYS\.lookupFunctions, "1"\) !== "0";/);
  assert.match(caption, /const \[unlimited, setUnlimited\] = useState\(\(\) => unlimitedRequests\(\)\);/);
  assert.match(caption, /setUnlimited\(unlimitedRequests\(\)\);/);
  assert.match(caption, /const cost = describeJumpCost\(\{ lookups: !saving && lookupsOn, unlimited \}\);/);
  for (const line of [
    "\"a skip uses 1 request\"",
    "\"a skip uses 1 request, plus one per extra segment\"",
    "`a skip uses 1 request, at most ${cost.max} when the model looks things up`",
    "`a skip uses 1 request, at most ${cost.max} when the model looks things up, plus one per extra segment`",
  ]) assert.ok(caption.includes(line), line);
  assert.equal(/twenty/.test(caption), false, "no mode in which a skip is twenty requests is left to describe");

  const settings = readFileSync(new URL("../GameUI/settings.jsx", import.meta.url), "utf8");
  // One switch, My key has no request limit: off, a skip is one request; on,
  // the most it may use is said from the same rule as the time panel's.
  assert.match(settings, /"Off \(default\): for a free key, where requests run out\. A time skip is one request /);
  assert.match(settings, /`On: for a paid key or a local model\. [^`]*A time skip may use up to \$\{noLimitCap\} requests, with up to \$\{noLimitRounds\} rounds of questions/);
  assert.match(settings, /const noLimitCost = describeJumpCost\(\{ lookups: true, unlimited: true \}\);/);
  assert.equal(/each checked by a request of their own|twenty requests or more/.test(settings), false);
});
