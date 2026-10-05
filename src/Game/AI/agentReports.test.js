/*! Open Historia — when an agent is due a report: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/agentReports.test.js
//
// Each report is a whole request. With saving off every agent used to report
// after every applied turn — five agents, five requests a skip, the interactive
// scenes included. These pin the calendar both paths now share.

import test from "node:test";
import assert from "node:assert/strict";

import { AGENT_REPORT_EVERY_ROUNDS, agentsDueToReport } from "./agentReports.js";

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

test("the turn review asks only on collection rounds; the per-agent reports do not wait for one", () => {
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
