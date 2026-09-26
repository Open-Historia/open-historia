/*! Open Historia — reports tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/reports.test.js
//
// Runs without node_modules: reports.js imports nothing.

import test from "node:test";
import assert from "node:assert/strict";

import {
    REPORTS_LIMIT,
    applyReportOps,
    describeReportsForPrompt,
    normalizeReportEntry,
    normalizeReportOp,
    normalizeReports,
    reportsFor,
} from "./reports.js";

const KNOWN = new Map([["france", "France"], ["germany", "Germany"], ["french republic", "France"]]);
const resolvePolity = (name) => KNOWN.get(String(name).trim().toLowerCase()) ?? "";
const pact = { op: "create", reportId: "pact-1", title: "Secret Protocol to the Treaty of Amity", body: "Article I. Neither party shall…", visibleTo: ["France", "Germany"], dateline: "1914-06-01" };

test("a stored report keeps its holders, and an empty distribution reads as public", () => {
    const report = normalizeReportEntry({ id: "r1", title: " Cable ", body: "FROM: Paris\r\nTO: Berlin", visibleTo: ["France", "france", ""] });
    assert.deepEqual(report.visibleTo, ["France"]);
    assert.equal(report.body, "FROM: Paris\nTO: Berlin");
    assert.equal(normalizeReportEntry({ id: "r2", title: "Communiqué", body: "…", visibleTo: [] }).visibleTo, null);
    assert.equal(normalizeReportEntry({ id: "r3", title: "Communiqué", body: "…" }).visibleTo, null);
    assert.equal(normalizeReportEntry({ id: "r4", title: "", body: "…" }), null, "a report needs a title");
    assert.equal(normalizeReportEntry({ id: "r5", title: "x", body: "" }), null, "…and a body");
});

test("the list drops duplicates by id and is bounded", () => {
    const many = Array.from({ length: REPORTS_LIMIT + 5 }, (_unused, index) => ({ id: `r${index}`, title: `T${index}`, body: "b" }));
    assert.equal(normalizeReports(many).length, REPORTS_LIMIT);
    assert.equal(normalizeReports([{ id: "a", title: "t", body: "b" }, { id: "a", title: "t2", body: "b" }]).length, 1);
});

test("a create op is read from what the model writes, a share from its id and new holders", () => {
    assert.deepEqual(normalizeReportOp(pact), { op: "create", reportId: "pact-1", title: pact.title, body: pact.body, visibleTo: ["France", "Germany"], dateline: "1914-06-01" });
    assert.equal(normalizeReportOp({ title: "Letter", body: "Dear…" }).op, "create", "a title and a body are a create");
    assert.deepEqual(normalizeReportOp({ op: "share", reportId: "pact-1", visibleTo: ["Italy"] }), { op: "share", reportId: "pact-1", visibleTo: ["Italy"] });
    assert.deepEqual(normalizeReportOp({ op: "update", id: "pact-1", addVisibleTo: ["Italy"] }), { op: "share", reportId: "pact-1", visibleTo: ["Italy"] });
    assert.equal(normalizeReportOp({ op: "share", reportId: "pact-1" }), null, "a share of nothing widens nothing");
    assert.equal(normalizeReportOp({ op: "create", title: "x" }), null);
    assert.equal(normalizeReportOp("nonsense"), null);
});

test("a create is held by the polities the world knows; an unknown holder is reported; nobody known refuses it", () => {
    const { reports, created, rejected } = applyReportOps([], [
        pact,
        { op: "create", title: "Note", body: "…", visibleTo: ["French Republic", "Atlantis"] },
        { op: "create", title: "Lost", body: "…", visibleTo: ["Atlantis"] },
        { op: "create", title: "Communiqué", body: "…", visibleTo: [] },
    ], { eventId: "e1", date: "1914-06-02", round: 3, resolvePolity });
    assert.equal(reports.length, 3);
    assert.deepEqual(reports[0].visibleTo, ["France", "Germany"]);
    assert.equal(reports[0].id, "pact-1");
    assert.equal(reports[0].sourceEventId, "e1");
    assert.equal(reports[0].createdRound, 3);
    assert.equal(reports[0].dateline, "1914-06-01");
    assert.deepEqual(reports[1].visibleTo, ["France"], "the alias is canonicalised");
    assert.deepEqual(created[1].unknown, ["Atlantis"]);
    assert.equal(reports[2].visibleTo, null, "empty is public");
    assert.equal(reports[2].dateline, "1914-06-02", "the event's date when none is given");
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /none of its holders/);
});

test("a share widens who holds a report, by id or by title, and never narrows it", () => {
    const start = applyReportOps([], [pact, { op: "create", title: "Communiqué", body: "…" }], { resolvePolity }).reports;
    const { reports, shared, rejected } = applyReportOps(start, [
        { op: "share", reportId: "pact-1", visibleTo: ["Germany", "France"] },
        { op: "share", reportId: "Secret Protocol to the Treaty of Amity", visibleTo: ["France"] },
        { op: "share", reportId: "Communiqué", visibleTo: ["Germany"] },
        { op: "share", reportId: "nope", visibleTo: ["Germany"] },
        { op: "share", reportId: "pact-1", visibleTo: ["Atlantis"] },
    ], { resolvePolity });
    assert.deepEqual(reports[0].visibleTo, ["France", "Germany"], "already held: nothing added, nothing lost");
    assert.equal(reports[1].visibleTo, null, "a public document stays public");
    assert.equal(shared.length, 3);
    assert.equal(rejected.length, 2);
});

test("a create that reuses a known id gets a fresh one rather than overwriting the document", () => {
    const start = applyReportOps([], [pact], { resolvePolity }).reports;
    const { reports } = applyReportOps(start, [{ ...pact, title: "Another" }], { resolvePolity });
    assert.equal(reports.length, 2);
    assert.notEqual(reports[1].id, "pact-1");
});

test("an audience reads the reports addressed to it, newest first; the narrator reads all", () => {
    const list = applyReportOps([], [
        pact,
        { op: "create", title: "Berlin memo", body: "…", visibleTo: ["Germany"] },
        { op: "create", title: "Communiqué", body: "…" },
    ], { resolvePolity }).reports;
    const seesAs = (polity) => (visibleTo) => visibleTo === null || visibleTo.some((name) => name === polity);
    assert.deepEqual(reportsFor(list, seesAs("France")).map((report) => report.title), ["Communiqué", "Secret Protocol to the Treaty of Amity"]);
    assert.deepEqual(reportsFor(list, seesAs("Italy")).map((report) => report.title), ["Communiqué"]);
    assert.equal(reportsFor(list, null).length, 3);
});

test("the prompt is shown one bounded line per report, holders named, and nothing when there are none", () => {
    const list = applyReportOps([], [pact, { op: "create", title: "Communiqué", body: "x".repeat(400) }], { resolvePolity }).reports;
    const text = describeReportsForPrompt(list, { bodyChars: 40 });
    assert.match(text, /^\[Reports on File\]\n- /);
    assert.match(text, /pact-1 · "Secret Protocol to the Treaty of Amity" \(1914-06-01\) · held by France, Germany: Article I/);
    assert.match(text, /"Communiqué" · public: x{39}…/);
    assert.ok(text.indexOf("Communiqué") < text.indexOf("pact-1"), "newest first");
    assert.equal(describeReportsForPrompt([], {}), "");
    assert.equal(describeReportsForPrompt(list, { sees: (visibleTo) => visibleTo === null }).split("\n").length, 2, "scoped to the audience");
});

// The jump template carries the rule (it was a directive appended at call time
// until 2026-09-26).
test("the jump is told what a report is, who holds it, and the boundary with the map", async () => {
    const { default: prompts } = await import("../Game/AI/defaultPrompts.json", { with: { type: "json" } });
    for (const task of ["jumpForward", "autoJumpForward"]) {
        const text = prompts.tasks[task];
        const rule = text.slice(text.indexOf("[Reports — documents, not summaries]"));
        assert.match(rule, /^\[Reports — documents, not summaries\]/);
        assert.match(rule, /impacts\.reports/);
        assert.match(rule, /visibleTo/);
        assert.match(rule, /never moves the map/);
    }
});

test("a document keeps who sent it, and a copy passed on keeps who passed it", () => {
  const created = applyReportOps([], [{ op: "create", reportId: "pact", title: "Secret Protocol", body: "Article I.", visibleTo: ["France", "Germany"], from: "Germany" }]);
  assert.equal(created.reports[0].from, "Germany");
  const shared = applyReportOps(created.reports, [{ op: "share", reportId: "pact", visibleTo: ["Italy"], from: "Germany" }]);
  assert.deepEqual(shared.reports[0].receivedFrom, { Italy: "Germany" });
  const byOutsider = applyReportOps(created.reports, [{ op: "share", reportId: "pact", visibleTo: ["Spain"], from: "Portugal" }]);
  assert.equal(byOutsider.reports[0].receivedFrom, undefined, "a giver who never held it is not recorded");
  const round = normalizeReports(JSON.parse(JSON.stringify(shared.reports)));
  assert.deepEqual([round[0].from, round[0].receivedFrom], ["Germany", { Italy: "Germany" }], "both survive a save");
});

test("the narrator is told who stole a copy; a holder reading its own file is not", () => {
  const reports = [{ id: "pact", title: "Secret Protocol", body: "Article I.", visibleTo: ["France", "Germany"], interceptedBy: ["Italy"] }];
  assert.match(describeReportsForPrompt(reports), /a copy stolen by Italy/);
  assert.doesNotMatch(describeReportsForPrompt(reports, { sees: (visibleTo) => visibleTo === null || visibleTo.includes("France") }), /stolen/);
});
