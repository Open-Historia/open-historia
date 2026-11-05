/*! Open Historia — report delivery tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/reportDelivery.test.js
//
// Runs without node_modules: reportDelivery.js imports only AI/audience.js,
// which imports nothing.
//
// The invariant: every document that changes hands reaches the player by the
// one channel a government would receive it through — or not at all, when it
// is a secret between others and no agent of the player's is among them.

import test from "node:test";
import assert from "node:assert/strict";

import {
  describeDocumentsForAdvisor,
  documentExchange,
  documentExchangeId,
  documentNote,
  documentNotices,
  withoutOrphanedNotices,
  documentsForEvent,
  documentsReadableBy,
  isDocumentExchange,
  markIntercepted,
  planReportDeliveries,
  withoutOrphanedDocuments,
} from "./reportDelivery.js";
import { audienceSeesReport, viewerAudience } from "../Game/AI/audience.js";

const PLAYER = "Ukraine";
const doc = (id, visibleTo, extra = {}) => ({ id, title: `Document ${id}`, body: `The text of ${id}.`, visibleTo, sourceEventId: `event-${id}`, ...extra });

test("each document goes by the channel its holders make natural", () => {
  const after = [
    doc("communique", null),
    doc("letter", ["Ukraine", "Russian Federation"], { from: "Russian Federation" }),
    doc("assessment", ["Ukraine"]),
    doc("protocol", ["Russian Federation", "Federal Republic of Germany"]),
    doc("other", ["French Republic", "Italian Republic"]),
  ];
  const deliveries = planReportDeliveries({ before: [], after, player: PLAYER, agents: [{ target: "Russian Federation" }] });
  assert.deepEqual(deliveries.map((delivery) => `${delivery.report.id}:${delivery.channel}`), [
    "communique:event",
    "letter:diplomacy",
    "assessment:event",
    "protocol:intelligence",
  ], "the Franco-Italian secret reaches nobody on the player's side");
  const letter = deliveries.find((delivery) => delivery.report.id === "letter");
  assert.deepEqual(letter.with, ["Russian Federation"]);
  assert.equal(letter.sender, "Russian Federation");
  const protocol = deliveries.find((delivery) => delivery.report.id === "protocol");
  assert.equal(protocol.target, "Russian Federation");
  assert.deepEqual(protocol.counterparts, ["Federal Republic of Germany"]);
});

test("only what changed hands this turn is delivered", () => {
  const before = [doc("letter", ["Ukraine", "Russian Federation"]), doc("protocol", ["Russian Federation", "Federal Republic of Germany"])];
  const quiet = planReportDeliveries({ before, after: before, player: PLAYER, agents: [{ target: "Russian Federation" }] });
  assert.deepEqual(quiet, [], "nothing new, nothing delivered — not even to an agent who has been there all along");
  const shared = [before[0], { ...before[1], visibleTo: [...before[1].visibleTo, "Ukraine"] }];
  const [delivery] = planReportDeliveries({ before, after: shared, player: PLAYER });
  assert.equal(delivery.channel, "diplomacy", "a copy handed to the player comes through its holders");
  assert.deepEqual(delivery.with, ["Russian Federation", "Federal Republic of Germany"]);
  const passedOn = [before[0], { ...shared[1], receivedFrom: { Ukraine: "Federal Republic of Germany" } }];
  const [fromBerlin] = planReportDeliveries({ before, after: passedOn, player: PLAYER });
  assert.deepEqual([fromBerlin.with, fromBerlin.sender], [["Federal Republic of Germany"], "Federal Republic of Germany"],
    "passed on by one holder, it comes from that holder alone");
  const widenedElsewhere = [before[0], { ...before[1], visibleTo: [...before[1].visibleTo, "French Republic"] }];
  assert.equal(planReportDeliveries({ before, after: widenedElsewhere, player: PLAYER, agents: [{ target: "French Republic" }] })[0].channel, "intelligence",
    "an agent in the government that just received a copy steals it");
});

test("a document with several holders is spoken by its sender, else the first of them", () => {
  const after = [
    doc("treaty", ["Ukraine", "Republic of Poland", "Lithuania"], { from: "Lithuania" }),
    doc("note", ["Ukraine", "Republic of Poland", "Lithuania"], { from: "Atlantis" }),
  ];
  const [treaty, note] = planReportDeliveries({ after, player: PLAYER });
  assert.equal(treaty.sender, "Lithuania");
  assert.equal(note.sender, "Republic of Poland", "a sender who is not a holder is not believed");
  const message = documentNote(treaty).messages[0];
  assert.equal(message.speaker, "Lithuania");
  assert.match(message.text, /^📄 \*\*Document treaty\*\*\n\nThe text of treaty\.$/);
  assert.deepEqual(documentNote(treaty).countries, ["Republic of Poland", "Lithuania"]);
});

test("a stolen document is filed once, marked for the narrator, and told apart from traffic", () => {
  const protocol = doc("protocol", ["Russian Federation", "Federal Republic of Germany"], { dateline: "2014-05-02", from: "Federal Republic of Germany" });
  const deliveries = planReportDeliveries({ after: [protocol], player: PLAYER, agents: [{ target: "Russian Federation" }] });
  const exchange = documentExchange(deliveries[0], { date: "2014-05-20" });
  assert.equal(exchange.id, "doc-protocol");
  assert.equal(exchange.counterpart, "Federal Republic of Germany");
  assert.equal(exchange.subject, "Document protocol");
  assert.equal(exchange.date, "2014-05-02");
  assert.equal(exchange.messages[0].speaker, "Federal Republic of Germany");
  assert.ok(isDocumentExchange(exchange));
  assert.ok(!isDocumentExchange({ id: "russian-federation:4:0" }));

  const marked = markIntercepted([protocol], deliveries, PLAYER);
  assert.deepEqual(marked[0].interceptedBy, ["Ukraine"]);
  assert.deepEqual(planReportDeliveries({ before: [], after: marked, player: PLAYER, agents: [{ target: "Russian Federation" }] }), [],
    "a copy already stolen is not stolen again");
  const internal = documentExchange(planReportDeliveries({ after: [doc("memo", ["Russian Federation"])], player: PLAYER, agents: [{ target: "Russian Federation" }] })[0]);
  assert.equal(internal.counterpart, "internal document");
});

test("the event card shows what came with the event, and the advisor reads everything the government has", () => {
  const reports = [
    doc("communique", null, { sourceEventId: "e1" }),
    doc("assessment", ["Ukraine"], { sourceEventId: "e1" }),
    doc("letter", ["Ukraine", "Russian Federation"], { sourceEventId: "e1" }),
    doc("protocol", ["Russian Federation", "Federal Republic of Germany"], { sourceEventId: "e1", interceptedBy: ["Ukraine"] }),
    doc("secret", ["French Republic"], { sourceEventId: "e1" }),
  ];
  assert.deepEqual(documentsForEvent(reports, "e1", PLAYER).map((report) => report.id), ["communique", "assessment"],
    "the letter came through diplomacy and the protocol through the agent, not the card");
  assert.deepEqual(documentsReadableBy(reports, PLAYER).map((report) => report.id), ["protocol", "letter", "assessment", "communique"]);
  assert.deepEqual(planReportDeliveries({ after: reports, player: "" }), [], "no player, no deliveries");
});

test("the player's government reads by the same audience rule as a leader", () => {
  const reports = [
    doc("communique", null),
    doc("letter", [" ukraine ", "Russian Federation"]),
    doc("protocol", ["Russian Federation"], { interceptedBy: ["UKRAINE"] }),
    doc("secret", ["French Republic"], { interceptedBy: ["Russian Federation"] }),
    doc("malformed", "Ukraine"),
    null,
  ];
  const audience = viewerAudience([PLAYER]);
  const byRule = reports.filter((report) => report && audienceSeesReport(audience, report)).map((report) => report.id).reverse();
  assert.deepEqual(byRule, ["protocol", "letter", "communique"]);
  assert.deepEqual(documentsReadableBy(reports, PLAYER).map((report) => report.id), byRule);
  assert.deepEqual(documentsReadableBy(reports, "").map((report) => report.id), ["communique"], "no government, only what was published");
});

test("an undone turn takes its stolen copies out of the agents' file", () => {
  const traffic = { id: "russian-federation:4:0", counterpart: "Belarus", messages: [{ speaker: "Russian Federation", cipher: "…" }] };
  const kept = { id: documentExchangeId("Old Protocol"), counterpart: "Belarus", messages: [{ speaker: "Russian Federation", cipher: "…" }] };
  const undone = { id: documentExchangeId("new-memo"), counterpart: "internal document", messages: [{ speaker: "Russian Federation", cipher: "…" }] };
  const onlyUndone = { id: documentExchangeId("lone"), counterpart: "Serbia", messages: [{ speaker: "Hungary", cipher: "…" }] };
  const intercepts = {
    "Russian Federation": { gatheredAt: "2014-05-01", round: 4, planted: false, exchanges: [undone, kept, traffic] },
    Hungary: { gatheredAt: "2014-05-01", round: 4, planted: false, exchanges: [onlyUndone] },
  };
  const restoredReports = [
    doc("Old Protocol", ["Russian Federation", "Belarus"], { interceptedBy: ["Ukraine"] }),
    // On file, but the turn that stole it was undone: nobody holds a stolen copy.
    doc("lone", ["Hungary", "Serbia"]),
  ];
  const next = withoutOrphanedDocuments(intercepts, restoredReports);
  assert.deepEqual(next["Russian Federation"].exchanges.map((exchange) => exchange.id), [kept.id, traffic.id],
    "the agent's traffic and the copy still on file stay; the undone memo goes");
  assert.equal(next.Hungary, undefined, "an agent left with nothing drops out of the file");
  assert.equal(documentExchangeId("Old Protocol"), "doc-old-protocol");
  const untouched = { "Russian Federation": { exchanges: [kept, traffic] } };
  assert.equal(withoutOrphanedDocuments(untouched, restoredReports), untouched, "nothing to take out: the same object back");
});

test("the advisor flags each new paper once, never a published one, and an undo takes the flag back with the paper", () => {
  const after = [
    doc("communique", null),
    doc("letter", ["Ukraine", "Russian Federation"], { from: "Russian Federation" }),
    doc("assessment", ["Ukraine"]),
    doc("protocol", ["Russian Federation", "Federal Republic of Germany"]),
  ];
  const deliveries = planReportDeliveries({ after, player: PLAYER, agents: [{ target: "Russian Federation" }] });
  const notices = documentNotices(deliveries, { lastEventId: "e-last", date: "2014-05-21" });
  assert.deepEqual(notices.map((notice) => [notice.reportId, notice.channel, notice.from ?? "", notice.eventId]), [
    ["letter", "diplomacy", "Russian Federation", "event-letter"],
    ["assessment", "event", "", "event-assessment"],
    ["protocol", "intelligence", "Russian Federation", "event-protocol"],
  ], "the communiqué is news, not a paper on the desk");
  assert.ok(notices.every((notice) => notice.role === "notice" && notice.kind === "document" && notice.time === "2014-05-21"));

  const conversation = [{ role: "user", text: "What do we know?" }, ...notices, { role: "advisor", text: "Plenty." }];
  const restored = [doc("letter", ["Ukraine", "Russian Federation"])];
  assert.deepEqual(withoutOrphanedNotices(conversation, restored, PLAYER).map((message) => message.reportId ?? message.role),
    ["user", "letter", "advisor"], "the assessment and the stolen protocol were undone with their turn");
  const stolenStill = [doc("protocol", ["Russian Federation", "Federal Republic of Germany"], { interceptedBy: ["Ukraine"] }), ...after.slice(1, 3)];
  assert.equal(withoutOrphanedNotices(conversation, stolenStill, PLAYER), conversation, "nothing to take out: the same list back");
});

test("the advisor is told how the government came by each paper", () => {
  const reports = [
    doc("communique", null),
    doc("assessment", ["Ukraine"]),
    doc("letter", ["Ukraine", "Russian Federation"], { from: "Russian Federation", dateline: "2014-05-01" }),
    doc("protocol", ["Russian Federation", "Federal Republic of Germany"], { interceptedBy: ["Ukraine"] }),
    doc("secret", ["French Republic"]),
  ];
  const block = describeDocumentsForAdvisor(reports, PLAYER);
  assert.match(block, /^\[Documents Our Government Holds\]/);
  assert.match(block, /"Document letter" \(2014-05-01\) · from Russian Federation · held with Russian Federation: The text of letter\./);
  assert.match(block, /"Document protocol" · a copy our agents took from Russian Federation, Federal Republic of Germany — they do not know we have it/);
  assert.match(block, /"Document assessment" · ours alone/);
  assert.match(block, /"Document communique" · published/);
  assert.doesNotMatch(block, /Document secret/);
  assert.equal(describeDocumentsForAdvisor([doc("secret", ["French Republic"])], PLAYER), "");
});
