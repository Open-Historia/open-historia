/*! Open Historia — a player's advisor conversation changed through the host © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game the host keeps every seat's advisor conversation
// (runtime/seatAdvisors.js) and sends each player their own in their view
// (host/projection.js, the view's "advisor"). Its one writer is the host's
// engine: a player's screen saves the conversation as it always has (the
// advisor panel's mutateAdvisorState), and the page turns that save into the
// "advisor" request (client/sharedGame.js), which says what changed:
//
//   records   the conversation's people, whole: its ministers and characters,
//             their group chats, the chief advisor's profile (advisorThreads.js
//             roles). Small, and their order is the contact list's.
//   threads   each conversation whose messages changed: how many of the ones
//             the view held still stand (`keep`), and the messages after them.
//             A save of a whole long conversation sends only its new lines,
//             and a second save made before the view caught up with the first
//             still says everything since what the page holds. `clear`: the
//             player cleared it, the papers flagged in it with it.
//   receipts  what the host answered to an approved proposal of the advisor's
//             (advisorActionReview.js recordAdvisorActionReceipt), which a
//             conversation's own save is never authority for.
//
// The papers the advisor flags (role "notice") are the host's own to write
// (gameplay.js postDocumentNotices): a save neither adds nor drops one, save a
// conversation cleared. Nothing in the conversation is any other player's or
// the world's: it is the seat's own counsel, so the host takes it as asked,
// through the game's own functions, which refuse what is malformed.
//
// Pure: the page computes the request with advisorChangesOf, the host applies
// it with withAdvisorChanges. A save larger than one request may carry
// (game/messages.js ADVISOR_*_MAX) is refused whole, and said, never cut short:
// a list cut short would drop the people or lines past its end.

import { CHIEF_ADVISOR_PROFILE_ROLE, CHIEF_ADVISOR_THREAD, ADVISOR_CONTACT_ROLE, ADVISOR_GROUP_ROLE, advisorMessagesFor, replaceAdvisorThread } from "../../runtime/advisorThreads.js";
import { recordAdvisorActionReceipt } from "../../Game/GameUI/advisorActionReview.js";


const RECORD_ROLES = new Set([ADVISOR_CONTACT_ROLE, ADVISOR_GROUP_ROLE, CHIEF_ADVISOR_PROFILE_ROLE]);
const MESSAGE_ROLES = new Set(["user", "advisor", "error", "notice"]);
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const threadOf = (entry) => String(entry?.threadId ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || CHIEF_ADVISOR_THREAD;
const isMessage = (entry) => MESSAGE_ROLES.has(entry?.role);
const isPersonRecord = (entry) => RECORD_ROLES.has(entry?.role);
// A message as the host keeps it from a save: no receipt (receipts come their
// own way), no notice (the host's own), and nothing still being written.
const lineOf = (entry) => {
  const { actionReceipts: _receipts, ...rest } = entry;
  return rest;
};
const linesOf = (entries, thread) => advisorMessagesFor(entries, thread).filter((entry) => entry.role !== "notice" && !entry.streaming).map(lineOf);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// What the page's save changed, from the conversation the view held (`held`)
// to the one it saves (`wanted`): { records?, threads?, receipts? }, or null
// when it changed nothing the host keeps.
export const advisorChangesOf = (held, wanted) => {
  const before = list(held);
  const after = list(wanted);
  const changes = {};
  const records = after.filter(isPersonRecord);
  if (!same(before.filter(isPersonRecord), records)) changes.records = records;
  const threads = [];
  const ids = [...new Set([...before, ...after].filter(isMessage).map(threadOf))];
  for (const thread of ids) {
    const was = linesOf(before, thread);
    const now = linesOf(after, thread);
    // Cleared: nothing of it is left, the papers flagged in it and the replies
    // the host answered among them (advisorThreads.js clearNotices).
    const inIt = (entry) => isMessage(entry) && threadOf(entry) === thread;
    const clear = before.some(inIt) && !after.some(inIt);
    if (same(was, now) && !clear) continue;
    let keep = 0;
    while (keep < was.length && keep < now.length && same(was[keep], now[keep])) keep += 1;
    threads.push({ thread, keep, messages: now.slice(keep), clear });
  }
  if (threads.length) changes.threads = threads;
  const receipts = [];
  const heldReplies = new Map(before.filter((entry) => entry?.role === "advisor" && entry.id).map((entry) => [`${threadOf(entry)}|${entry.id}`, entry]));
  for (const entry of after) {
    if (entry?.role !== "advisor" || !entry.id || !isRecord(entry.actionReceipts)) continue;
    const prior = heldReplies.get(`${threadOf(entry)}|${entry.id}`)?.actionReceipts ?? {};
    for (const [proposal, receipt] of Object.entries(entry.actionReceipts)) {
      if (!same(prior[proposal], receipt)) receipts.push({ thread: threadOf(entry), message: String(entry.id), proposal, receipt });
    }
  }
  if (receipts.length) changes.receipts = receipts;
  return Object.keys(changes).length ? changes : null;
};

// The seat's conversation (`entries`, as the host keeps it) with a request's
// changes applied, through the game's own functions: the people first (a
// thread is written only for someone in it), then each conversation, then the
// receipts. Throws with the reason when a change does not hold.
export const withAdvisorChanges = (entries, { records, threads, receipts } = {}) => {
  let next = list(entries);
  if (Array.isArray(records)) {
    const people = records.filter((entry) => isRecord(entry) && isPersonRecord(entry));
    // Each in a slot the people held before, in their new order; more after the
    // rest, and a slot nobody fills now gone.
    let at = 0;
    next = next.flatMap((entry) => (isPersonRecord(entry) ? (at < people.length ? [people[at++]] : []) : [entry]));
    next = [...next, ...people.slice(at)];
  }
  for (const change of list(threads)) {
    const thread = threadOf({ threadId: change?.thread });
    const keep = Math.max(0, Math.trunc(Number(change?.keep) || 0));
    const lines = list(change?.messages).filter((entry) => isRecord(entry) && entry.role !== "notice").map(lineOf);
    const standing = linesOf(next, thread);
    next = replaceAdvisorThread(next, thread, [...standing.slice(0, keep), ...lines], { clearNotices: change?.clear === true });
  }
  for (const entry of list(receipts)) {
    next = recordAdvisorActionReceipt(next, threadOf({ threadId: entry?.thread }), String(entry?.message ?? ""), String(entry?.proposal ?? ""), entry?.receipt);
  }
  return next;
};
