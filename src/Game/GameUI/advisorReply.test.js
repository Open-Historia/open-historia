// Runs in a BARE CHECKOUT: advisorReply.js and everything it imports are
// import-free on purpose.
//
// The advisor's reply is taken apart here, and its actions block is turned into
// queue edits here. A regression in either silently deletes or duplicates queued
// orders (which drive the next time skip), or offers a button that places a unit
// the scenario forbids.
import test from "node:test";
import assert from "node:assert/strict";

import { describeReplyProblems, filterAdvisorDeployments, planAdvisorActionEdits } from "./advisorBlocks.js";
import { buildMessageDrafts } from "./advisorDrafts.js";
import { buildInstitutionDrafts } from "./advisorInstitutionDrafts.js";
import { parseAdvisorReply } from "./advisorReply.js";

const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";

// Stands in for gameState.js normalizeActionEntry: an id, and null for an
// entry with nothing in it.
let minted = 0;
const normalize = (entry) => {
  const title = String(entry.title ?? "").trim();
  const text = String(entry.text ?? "").trim();
  if (!title && !text) return null;
  minted += 1;
  return { id: `new-${minted}`, title: title || text, text: text || title, kind: entry.kind, source: entry.source, status: entry.status };
};

const queue = () => [
  { id: "a1", title: "Raise taxes", text: "Raise taxes", kind: "action", status: "planned" },
  {
    id: "a2", title: "Deploy request: 3rd Army", text: "Deploy request", kind: "action", status: "planned",
    unitRevert: { unitId: "unit-3", remove: true },
  },
  {
    id: "a3", title: "Deploy request: 1st Fleet", text: "Deploy request", kind: "action", status: "resolved",
    unitRevert: { unitId: "unit-1", remove: true },
  },
];

// ── planAdvisorActionEdits ───────────────────────────────────────────────────

test("a removal takes the entry out of the queue and says so", () => {
  const { next, items, problems, reverts } = planAdvisorActionEdits(queue(), [{ id: "a1", remove: true }], normalize);
  assert.deepEqual(next.map((action) => action.id), ["a2", "a3"]);
  assert.deepEqual(items, [{ change: "removed", title: "Raise taxes" }]);
  assert.deepEqual(problems, []);
  assert.deepEqual(reverts, []);
});

// B94: the advisor scrapping a placed army left the translucent unit on the map
// for the rest of the campaign.
test("removing a planned troop order hands back its unit revert", () => {
  const { next, reverts } = planAdvisorActionEdits(queue(), [{ id: "a2", remove: true }], normalize);
  assert.deepEqual(next.map((action) => action.id), ["a1", "a3"]);
  assert.deepEqual(reverts, [{ unitId: "unit-3", remove: true }]);
});

test("removing an order a skip already resolved keeps its outcome", () => {
  const { next, reverts } = planAdvisorActionEdits(queue(), [{ id: "a3", remove: true }], normalize);
  assert.deepEqual(next.map((action) => action.id), ["a1", "a2"]);
  assert.deepEqual(reverts, []);
});

test("an update changes only the fields it names", () => {
  const { next, items } = planAdvisorActionEdits(queue(), [{ id: "a1", text: "Raise taxes by 2%", kind: "chat" }], normalize);
  assert.deepEqual(next[0], { id: "a1", title: "Raise taxes", text: "Raise taxes by 2%", kind: "chat", status: "planned" });
  assert.deepEqual(items, [{ change: "updated", title: "Raise taxes" }]);
});

test("a stale id is queued as a new action, and the advisor is told", () => {
  const { next, items, problems } = planAdvisorActionEdits(queue(), [{ id: "gone", title: "Fortify the pass" }], normalize);
  assert.equal(next.length, 4);
  assert.equal(next[3].title, "Fortify the pass");
  assert.equal(next[3].source, "advisor");
  assert.equal(next[3].status, "planned");
  assert.deepEqual(items, [{ change: "added", title: "Fortify the pass" }]);
  assert.match(problems[0], /edit of gone matched no queued action, so it was queued as a new one/);
});

test("malformed entries change nothing and are each reported", () => {
  const current = queue();
  const { next, items, problems } = planAdvisorActionEdits(current, [
    "not an object",
    { remove: true },
    { id: "missing", remove: true },
    { id: "gone" },
    {},
  ], normalize);
  assert.deepEqual(next, current);
  assert.deepEqual(items, []);
  assert.equal(problems.length, 5);
  assert.match(problems[0], /not an object/);
  assert.match(problems[1], /removal named no id/);
  assert.match(problems[2], /removal of missing matched no queued action/);
  assert.match(problems[3], /edit of gone matched no queued action and had no title or text, so nothing was queued/);
  assert.match(problems[4], /had no title or text, so nothing was queued/);
});

test("the queue it was given is never modified", () => {
  const current = queue();
  const snapshot = JSON.parse(JSON.stringify(current));
  planAdvisorActionEdits(current, [{ id: "a1", remove: true }, { id: "a2", title: "Renamed" }, { title: "New" }], normalize);
  assert.deepEqual(current, snapshot);
});

// ── filterAdvisorDeployments ─────────────────────────────────────────────────

const unit = (over = {}) => ({ type: "infantry", name: "3rd Army", lng: 24.1, lat: 50.2, ...over });

test("well-formed deployments pass, each with its index", () => {
  const out = filterAdvisorDeployments([unit(), unit({ name: "1st Wing", type: "AIR" })]);
  assert.deepEqual(out.map((entry) => [entry.name, entry.index]), [["3rd Army", 0], ["1st Wing", 1]]);
});

test("a deployment with no real type, name or coordinates gets no button, and says why", () => {
  const problems = [];
  const out = filterAdvisorDeployments([
    unit({ type: "tank" }),
    unit({ name: "  " }),
    unit({ name: "Null Island", lng: 0, lat: 0 }),
    unit({ name: "Nowhere", lng: "east" }),
    null,
    unit({ name: "Good" }),
  ], null, problems);
  assert.deepEqual(out.map((entry) => [entry.name, entry.index]), [["Good", 0]]);
  assert.equal(problems.length, 5);
  assert.match(problems[0], /"3rd Army" had the type "tank"/);
  assert.match(problems[1], /entry 2 had no name/);
  assert.match(problems[2], /"Null Island" had no real lng\/lat/);
  assert.match(problems[3], /"Nowhere" had no real lng\/lat/);
  assert.match(problems[4], /entry 5 was not an object/);
});

// B201: an air wing in a medieval scenario that allows only infantry and garrison.
test("a type the scenario does not allow gets no button, and its index holds", () => {
  const problems = [];
  const out = filterAdvisorDeployments(
    [unit({ name: "1st Air Wing", type: "air" }), unit({ name: "Levy", type: "Infantry" })],
    ["infantry", "garrison"],
    problems,
  );
  assert.deepEqual(out.map((entry) => [entry.name, entry.index]), [["Levy", 1]], "Levy keeps index 1, which placedDeployments records");
  assert.match(problems[0], /"1st Air Wing" is air, which this scenario does not allow \(only infantry, garrison\)/);
});

test("an empty allowed list means every type", () => {
  assert.equal(filterAdvisorDeployments([unit({ type: "naval" })], []).length, 1);
  assert.equal(filterAdvisorDeployments([unit({ type: "naval" })], null).length, 1);
});

// ── draft receipts ───────────────────────────────────────────────────────────

test("a letter draft with no country or no blockquote is reported", () => {
  const problems = [];
  const drafts = buildMessageDrafts(
    [{ country: "France" }, { country: "" }, { targetType: "embassy", country: "Spain" }],
    "Some prose, and no letter quoted in it.",
    problems,
  );
  assert.equal(drafts.length, 0);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /the draft to France had no > blockquote/);
  assert.match(problems[1], /draft 2 named no country/);
  assert.match(problems[2], /the draft to Spain had the targetType "embassy"/);
});

test("an institution draft of an unknown type, or past the eighth, is reported", () => {
  const problems = [];
  const vote = (n) => ({ type: "vote", institutionId: "league", proposalId: `p${n}`, choice: "yes" });
  const drafts = buildInstitutionDrafts([
    { type: "dissolve", institutionId: "league" },
    { type: "vote", institutionId: "league", proposalId: "p0", choice: "maybe" },
    ...Array.from({ length: 9 }, (_, n) => vote(n + 1)),
  ], problems);
  assert.equal(drafts.length, 8);
  assert.match(problems[0], /entry 1 had the type "dissolve"/);
  assert.match(problems[1], /entry 2 had the choice "maybe"/);
  assert.match(problems[2], /only the first 8 usable entries get a button; 1 more were left out/);
});

// ── parseAdvisorReply ────────────────────────────────────────────────────────

test("a reply's fences are stripped and each becomes what the panel draws", () => {
  const reply = [
    "We should hold the river.",
    "",
    "> Dear Poland, we propose a pact.",
    fence("senddraft", '[{"country":"Poland"}]'),
    fence("deploy", JSON.stringify([unit(), unit({ name: "1st Air Wing", type: "air" })])),
    fence("institutiondraft", '[{"type":"vote","institutionId":"league","proposalId":"p1","choice":"yes"}]'),
    fence("actions", '[{"title":"Hold the river"}]'),
  ].join("\n");
  const parsed = parseAdvisorReply(reply, { allowedUnitTypes: ["infantry"] });
  assert.ok(!parsed.text.includes("```"));
  assert.ok(parsed.text.startsWith("We should hold the river."));
  assert.equal(parsed.messageDrafts[0].country, "Poland");
  assert.equal(parsed.messageDrafts[0].text, "Dear Poland, we propose a pact.");
  assert.deepEqual(parsed.deployments.map((entry) => entry.name), ["3rd Army"]);
  assert.equal(parsed.institutionDrafts.length, 1);
  assert.deepEqual(parsed.actionsProposal, [{ title: "Hold the river" }]);
  assert.deepEqual(parsed.draftProblems, []);
  assert.deepEqual(parsed.institutionDraftProblems, []);
  assert.equal(parsed.deployProblems.length, 1);
  assert.match(parsed.deployProblems[0], /1st Air Wing/);
});

test("a block that is not valid JSON, or not a list, is reported whole", () => {
  const parsed = parseAdvisorReply([
    "Text.",
    fence("deploy", "{not json"),
    fence("senddraft", '{"country":"France"}'),
  ].join("\n"));
  assert.equal(parsed.deployments, null);
  assert.equal(parsed.messageDrafts, null);
  assert.match(parsed.deployProblems[0], /^it was invalid JSON/);
  assert.match(parsed.draftProblems[0], /^it was not a list/);
});

test("a reply with no fences has no problems", () => {
  const parsed = parseAdvisorReply("Just advice.");
  assert.equal(parsed.text, "Just advice.");
  assert.deepEqual([parsed.draftProblems, parsed.institutionDraftProblems, parsed.deployProblems], [[], [], []]);
});

// I155: the receipt covered only chart, actions and projects, so the advisor
// believed it had offered buttons that were never drawn.
test("the receipt names every block type that drew nothing", () => {
  const problems = describeReplyProblems({
    draftProblems: ["the draft to France had no > blockquote holding its letter just before the block, so no button was drawn for it"],
    institutionDraftProblems: ["entry 1 named no institutionId, so no button was drawn for it"],
    deployProblems: ["\"1st Air Wing\" is air, which this scenario does not allow (only infantry), so no button was drawn for it"],
  });
  assert.equal(problems.length, 3);
  assert.match(problems[0], /^in your senddraft block, the draft to France/);
  assert.match(problems[1], /^in your institutiondraft block, entry 1/);
  assert.match(problems[2], /^in your deploy block, "1st Air Wing"/);
});
