/*! Open Historia — a call to arms asked in a chat, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/callToArmsInChat.test.js
//
// "get rid of this and instead have the country send you a message requesting assistance and the buttons appear
// there. it should not explain what happens if you choose each option as that breaks immersion" (the owner,
// 2026-11-06).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { CALL_STANDS_ROUNDS, callsForTurn, normalizeCallToArms } from "../../runtime/alliances.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").split("\r\n").join("\n");

test("a call keeps the message that asks it", () => {
  const call = { id: "call:w1:aland", warId: "w1", ally: "Aland", defender: "Brod", attackers: ["Cora"], via: { kind: "agreement", id: "a1", title: "the Treaty of Brod" }, round: 4 };
  assert.equal(normalizeCallToArms({ ...call, messageId: "msg-call-call-w1-aland" }).messageId, "msg-call-call-w1-aland");
  assert.equal("messageId" in normalizeCallToArms(call), false, "one asked before calls had messages has none");
});

test("the turn has the country that was attacked ask, in its own voice and the game's language, in the thread with it", () => {
  const gameplay = read("./gameplay.js");
  const block = gameplay.slice(gameplay.indexOf("for (const call of normalizeArray(worldWithImpacts?.callsToArms))"), gameplay.indexOf("// A document the player now holds"));
  assert.ok(block.length > 0);
  // Every open call to a country a person plays that has no message yet, once: one opened this turn, and one that
  // never had a message (an old save's, or one whose message could not be sent), stamped with the turn it is asked.
  assert.match(block, /if \(call\?\.status !== "open" \|\| normalizeString\(call\.messageId\)\) continue;/);
  assert.doesNotMatch(block, /Number\(call\.round\) !== Number\(nextGame\.round\)/);
  assert.match(block, /people\.some\(\(person\) => regionKey\(person\) === regionKey\(call\.ally\)\)/);
  // From the defender, to the ally, folded into a thread already open with it, and the message's id kept on the call.
  assert.match(block, /countries: \[call\.defender\],\n\s+to: call\.ally,\n\s+speaker: call\.defender,/);
  assert.match(block, /openingMessageId: messageId,/);
  assert.match(block, /entry\?\.id === call\.id \? \{ \.\.\.entry, messageId, askedRound: Number\(nextGame\.round\) \|\| 0 \}/);
  // The words are the packs' (uiString), and they ask: nothing of reputation, war or what an answer does.
  const asks = [...block.matchAll(/uiString\("([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(asks, [
    "We have been attacked by {{enemy}}. Under {{treaty}}, we call on you to come to our defence.",
    "We have been attacked by {{enemy}}. As our ally, we call on you to come to our defence.",
    "We have been attacked. Under {{treaty}}, we call on you to come to our defence.",
    "We have been attacked. As our ally, we call on you to come to our defence.",
    "A call for help",
  ]);
  for (const text of asks) assert.doesNotMatch(text, /reputation|war|break|unanswered/i);
  const catalog = JSON.parse(fs.readFileSync(new URL("../../../public/lang/catalog-en.json", import.meta.url), "utf8"));
  for (const text of asks) assert.ok(catalog.includes(text), text);
});

test("its answers sit under that message, and say nothing of what they do", () => {
  const cards = read("../GameUI/warAndPeace.jsx");
  const card = cards.slice(cards.indexOf("export const CallToArmsCard"), cards.indexOf("const OFFER_STATUS_TEXT"));
  assert.match(card, />Honour the alliance</);
  assert.match(card, />Break the treaty</);
  assert.doesNotMatch(card, /reputation|puts you at war|counts as broken|TREATY_BROKEN_REPUTATION/);
  assert.match(card, /send\(op, call\.id\)/);
  const chat = read("../GameUI/chat.jsx");
  assert.ok(chat.includes("{threadCalls.byMessage.has(String(msg.id ?? \"\")) ? <CallToArmsCard call={threadCalls.byMessage.get(String(msg.id ?? \"\"))} viewer={playerCountry} /> : null}"));
  assert.ok(chat.includes("{threadCalls.stranded.map((call) => <CallToArmsCard key={call.id} call={call} viewer={playerCountry} />)}"));
});

// A call with no message (an old save's, or one whose message could not be sent) showed only at the foot of a
// one-on-one thread with the defender, and with no such thread nowhere; after CALL_STANDS_ROUNDS it was marked
// refused all the same, the treaty broken and the reputation lost for a call the player never saw.
test("a call no message has asked is never refused for silence, and an asked one stands from the turn it was asked", () => {
  const war = { id: "w1", status: "active", sideA: ["Cora"], sideB: ["Brod"] };
  const call = { id: "call:w1:aland", warId: "w1", ally: "Aland", defender: "Brod", attackers: ["Cora"], via: { kind: "agreement", id: "a1", title: "the Treaty of Brod" }, round: 4, status: "open" };
  const at = (round, calls) => callsForTurn({ world: {}, wars: [war], began: [], calls, players: ["Aland"], round });
  const unheard = at(4 + CALL_STANDS_ROUNDS + 5, [call]);
  assert.equal(unheard.calls[0].status, "open");
  assert.deepEqual(unheard.broken, []);
  // Asked late, at turn 10: it stands CALL_STANDS_ROUNDS turns from then, not from the turn it opened.
  const late = { ...call, messageId: "msg-call-call-w1-aland", askedRound: 10 };
  assert.equal(normalizeCallToArms(late).askedRound, 10);
  assert.equal(at(10 + CALL_STANDS_ROUNDS - 1, [late]).calls[0].status, "open");
  const silent = at(10 + CALL_STANDS_ROUNDS, [late]);
  assert.deepEqual([silent.calls[0].status, silent.broken.map((entry) => entry.ally)], ["refused", ["Aland"]]);
});
