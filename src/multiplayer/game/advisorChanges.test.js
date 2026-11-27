/*! Open Historia — a player's advisor conversation changed through the host: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/game/advisorChanges.test.js
//
// The page's save of its advisor conversation is said as what changed
// (advisorChangesOf), and the host applies that to the seat's conversation as
// it keeps it (withAdvisorChanges): the result is the save, the host's own
// papers kept, and a save made before the view caught up still says it all.

import test from "node:test";
import assert from "node:assert/strict";

import { advisorChangesOf, withAdvisorChanges } from "./advisorChanges.js";
import { PLAYER_REQUESTS } from "./messages.js";
import { validate } from "../protocol/validate.js";
import {
  advisorContacts,
  advisorMessagesFor,
  archiveAdvisorContact,
  createAdvisorContact,
  replaceAdvisorThread,
  reorderAdvisorContact,
} from "../../runtime/advisorThreads.js";
import { recordAdvisorActionReceipt } from "../../Game/GameUI/advisorActionReview.js";

const chief = (entries) => advisorMessagesFor(entries).map((entry) => entry.text ?? entry.id);
const said = (text, role = "user") => ({ role, text, id: `m-${text.length}-${text.slice(0, 6)}` });
const base = [said("Riga asks."), said("Riga is told.", "advisor"), { role: "notice", id: "notice-doc-1", kind: "document", reportId: "r1" }];

// What the page does: its own mutator on the view, then the request.
const roundTrip = (held, mutate, kept = held) => {
  const wanted = mutate(held);
  const changes = advisorChangesOf(held, wanted);
  return { wanted, changes, after: changes ? withAdvisorChanges(kept, changes) : kept };
};

test("a new line sends only itself, and the host's conversation becomes the page's", () => {
  const { changes, after, wanted } = roundTrip(base, (held) => replaceAdvisorThread(held, "chief", [...advisorMessagesFor(held), said("Riga asks again.")]));
  assert.deepEqual(changes, { threads: [{ thread: "chief", keep: 2, messages: [said("Riga asks again.")], clear: false }] });
  assert.equal(validate(PLAYER_REQUESTS.advisor, { t: "advisor", id: "0123456789abcdef", ...changes }).ok, true);
  assert.deepEqual(after, wanted);
});

test("a save made before the view caught up with the last one still says everything since what the page holds", () => {
  // The page saves its question, then the streamed answer, both from the view it held before either.
  const first = replaceAdvisorThread(base, "chief", [...advisorMessagesFor(base), said("Q")]);
  const second = replaceAdvisorThread(base, "chief", [...advisorMessagesFor(base), said("Q"), said("A", "advisor")]);
  const host = withAdvisorChanges(withAdvisorChanges(base, advisorChangesOf(base, first)), advisorChangesOf(base, second));
  assert.deepEqual(chief(host), ["Riga asks.", "Riga is told.", "notice-doc-1", "Q", "A"]);
});

test("a paper the host flagged meanwhile is kept, where it was, by a save from a view without it", () => {
  const hostHas = [...base, { role: "notice", id: "notice-doc-2", kind: "document", reportId: "r2" }];
  const { after } = roundTrip(base, (held) => replaceAdvisorThread(held, "chief", [...advisorMessagesFor(held), said("Next.")]), hostHas);
  assert.deepEqual(chief(after), ["Riga asks.", "Riga is told.", "notice-doc-1", "notice-doc-2", "Next."]);
  // Cleared, it goes with the conversation.
  const cleared = roundTrip(hostHas, (held) => replaceAdvisorThread(held, "chief", [], { clearNotices: true }));
  assert.equal(cleared.changes.threads[0].clear, true);
  assert.deepEqual(chief(cleared.after), []);
});

test("the people of the conversation go whole, in their order, and a minister's thread after them", () => {
  const minister = { id: "advisor-minister-1", name: "Ivars", title: "Minister of Defence", personality: "Blunt.", recipientType: "advisor-minister" };
  const second = { id: "advisor-minister-2", name: "Aija", title: "Minister of Finance", personality: "Careful.", recipientType: "advisor-minister" };
  const made = roundTrip(base, (held) => createAdvisorContact(createAdvisorContact(held, minister), second));
  assert.deepEqual(advisorContacts(made.after).map((contact) => contact.id), ["advisor-minister-1", "advisor-minister-2"]);
  const reordered = roundTrip(made.after, (held) => reorderAdvisorContact(held, "advisor-minister-2", "advisor-minister-1"));
  assert.deepEqual(advisorContacts(reordered.after).map((contact) => contact.id), ["advisor-minister-2", "advisor-minister-1"]);
  const archived = roundTrip(reordered.after, (held) => archiveAdvisorContact(held, "advisor-minister-1"));
  assert.equal(advisorContacts(archived.after).find((contact) => contact.id === "advisor-minister-1").archived, true);
  // A new contact and its first line in one save: the thread is written once its contact is there.
  const third = { id: "advisor-minister-3", name: "Raimonds", title: "Minister of the Interior", personality: "Quiet.", recipientType: "advisor-minister" };
  const both = roundTrip(archived.after, (held) => {
    const withContact = createAdvisorContact(held, third);
    return replaceAdvisorThread(withContact, "advisor-minister-3", [{ role: "user", text: "Report.", threadId: "advisor-minister-3" }]);
  });
  assert.deepEqual(advisorMessagesFor(both.after, "advisor-minister-3").map((entry) => entry.text), ["Report."]);
  assert.deepEqual(both.after, both.wanted);
});

test("a receipt the host answered rides on its own; a conversation's save is never authority for one", () => {
  const reply = { role: "advisor", id: "reply-1", text: "Raise the reserves.", actionProposals: [{ id: "proposal-1", operation: "create", actionId: "act-1", title: "Reserves", text: "Raise the reserves.", kind: "action" }] };
  const held = [...base, reply];
  const receipt = { status: "queued", actionId: "act-1", title: "Reserves" };
  const { changes, after } = roundTrip(held, (entries) => recordAdvisorActionReceipt(entries, "chief", "reply-1", "proposal-1", receipt));
  assert.deepEqual(changes, { receipts: [{ thread: "chief", message: "reply-1", proposal: "proposal-1", receipt }] });
  assert.deepEqual(after.find((entry) => entry.id === "reply-1").actionReceipts, { "proposal-1": receipt });
  // A receipt slipped into a thread's lines is not taken.
  const forged = withAdvisorChanges(held, { threads: [{ thread: "chief", keep: 2, messages: [{ ...reply, actionReceipts: { "proposal-1": receipt } }], clear: false }] });
  assert.equal(forged.find((entry) => entry.id === "reply-1").actionReceipts, undefined);
});

test("a save that changes nothing the host keeps asks nothing", () => {
  assert.equal(advisorChangesOf(base, base), null);
  // A reply still being written is not saved.
  assert.equal(advisorChangesOf(base, [...base, { role: "advisor", text: "…", streaming: true }]), null);
});

test("what is malformed is refused with the reason, and nothing is written", () => {
  assert.throws(() => withAdvisorChanges(base, { threads: [{ thread: "advisor-nobody-1", keep: 0, messages: [said("Hello?")], clear: false }] }), /unknown Advisor conversation/);
  assert.throws(() => withAdvisorChanges(base, { receipts: [{ thread: "chief", message: "nope", proposal: "proposal-1", receipt: { status: "queued", actionId: "a" } }] }), /no longer available/);
});
