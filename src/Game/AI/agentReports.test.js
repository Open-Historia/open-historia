/*! Open Historia — when an agent is due a report: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/agentReports.test.js
//
// These pin the calendar the turn review asks for the agents' reports on, and
// which agents report in a time skip's own answer.

import test from "node:test";
import assert from "node:assert/strict";

import { AGENT_REPORT_EVERY_ROUNDS, SKIP_AGENT_REPORT_LIMIT, agentsDueToReport, agentsReportingWithSkip } from "./agentReports.js";

const agent = (target, deployedAt = "2014-01-01") => ({ target, deployedAt, status: "active" });
const targets = (list) => list.map((spy) => spy.target);

test("an agent placed since the last skip that has never reported is due once", () => {
    const agents = [agent("Poland", "2014-03-01"), agent("Belarus", "2013-06-01")];
    const filed = { Belarus: { round: 6 } };
    const { justPlaced, overdue } = agentsDueToReport({ agents, filed, round: 7, originDate: "2014-03-01" });
    assert.deepEqual(targets(justPlaced), ["Poland"]);
    assert.deepEqual(targets(overdue), []);
});

test("a fresh report makes an agent wait AGENT_REPORT_EVERY_ROUNDS whole rounds", () => {
    const agents = [agent("Belarus")];
    const due = (round) => targets(agentsDueToReport({ agents, filed: { Belarus: { round: 4 } }, round, originDate: "2014-06-01" }).overdue);
    assert.equal(AGENT_REPORT_EVERY_ROUNDS, 3);
    assert.deepEqual(due(5), []);
    assert.deepEqual(due(6), []);
    assert.deepEqual(due(7), []);
    assert.deepEqual(due(8), ["Belarus"]);
});

test("an agent with nothing on file, or a report from a round an undo took back, is overdue", () => {
    const agents = [agent("Belarus"), agent("Ukraine")];
    const { overdue } = agentsDueToReport({ agents, filed: { Ukraine: { round: 12 } }, round: 8, originDate: "2014-06-01" });
    assert.deepEqual(targets(overdue), ["Belarus", "Ukraine"]);
});

test("the turn review asks only on collection rounds; without them an overdue agent is due on any round", () => {
    const agents = [agent("Belarus")];
    const filed = { Belarus: { round: 1 } };
    const at = (round, collectionRounds) => targets(agentsDueToReport({ agents, filed, round, originDate: "2014-06-01", collectionRounds }).overdue);
    assert.deepEqual(at(7, true), []);
    assert.deepEqual(at(9, true), ["Belarus"]);
    assert.deepEqual(at(7, false), ["Belarus"]);
});

test("an agent is never both newly placed and overdue", () => {
    const { justPlaced, overdue } = agentsDueToReport({ agents: [agent("Poland", "2014-03-01")], filed: {}, round: 9, originDate: "2014-03-01" });
    assert.deepEqual(targets(justPlaced), ["Poland"]);
    assert.deepEqual(targets(overdue), []);
});

test("BC dates compare as game dates", () => {
    const { justPlaced } = agentsDueToReport({ agents: [agent("Carthage", "-0149-03-01"), agent("Numidia", "-0152-01-01")], filed: {}, round: 2, originDate: "-0150-01-01" });
    assert.deepEqual(targets(justPlaced), ["Carthage"]);
});

test("no agents, nothing due", () => {
    assert.deepEqual(agentsDueToReport(), { justPlaced: [], overdue: [] });
});

// --- the reports that ride on a time skip's own answer ---
//
// While requests are being saved the reports cost no request, only the length
// of the skip's answer: everyone reports, up to a limit, the longest silent first.

test("every agent reports with the skip while there are few of them", () => {
    const agents = [agent("Poland"), agent("Belarus"), agent("Ukraine")];
    const filed = { Poland: { round: 6 }, Belarus: { round: 6 }, Ukraine: { round: 6 } };
    assert.equal(SKIP_AGENT_REPORT_LIMIT, 4);
    assert.deepEqual(targets(agentsReportingWithSkip({ agents, filed, round: 7, originDate: "2014-06-01" })), ["Poland", "Belarus", "Ukraine"],
        "a report last round does not make an agent wait: nothing is being saved by waiting");
});

test("past the limit, the longest silent go first and the rest wait for the next skip", () => {
    const agents = ["A", "B", "C", "D", "E", "F"].map((target) => agent(target));
    const filed = { A: { round: 6 }, B: { round: 2 }, C: { round: 5 }, D: { round: 6 }, E: { round: 4 } };
    // F has nothing on file at all, then B (round 2), E (4), C (5); A and D reported last round.
    assert.deepEqual(targets(agentsReportingWithSkip({ agents, filed, round: 7, originDate: "2014-06-01" })), ["F", "B", "E", "C"]);
    // Next skip the four have reports from round 7, and the two left out are the oldest.
    const next = { ...filed, F: { round: 7 }, B: { round: 7 }, E: { round: 7 }, C: { round: 7 } };
    assert.deepEqual(targets(agentsReportingWithSkip({ agents, filed: next, round: 8, originDate: "2014-07-01" })).slice(0, 2), ["A", "D"]);
});

test("an agent placed since the last skip reports first, and a report from an undone round counts as none", () => {
    const agents = [agent("Old"), agent("Undone"), agent("New", "2014-06-10")];
    const filed = { Old: { round: 3 }, Undone: { round: 12 } };
    assert.deepEqual(targets(agentsReportingWithSkip({ agents, filed, round: 7, originDate: "2014-06-01", limit: 2 })), ["New", "Undone"]);
});

test("the limit is the caller's to change, and nothing reports when there is nobody", () => {
    const agents = [agent("A"), agent("B")];
    assert.deepEqual(targets(agentsReportingWithSkip({ agents, filed: {}, round: 2, limit: 1 })), ["A"], "equally silent: the order they were placed in");
    assert.deepEqual(agentsReportingWithSkip({ agents, filed: {}, round: 2, limit: 0 }), []);
    assert.deepEqual(agentsReportingWithSkip(), []);
    assert.deepEqual(agentsReportingWithSkip({ agents: "nobody" }), []);
});
