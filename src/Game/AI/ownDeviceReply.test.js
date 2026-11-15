/*! Open Historia — a table's reply written on a player's own device: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/ownDeviceReply.test.js
//
// "build C and D, and the host can choose, but no sending api keys" (the owner,
// 2026-11-15). D: in a shared game the governments the AI plays are answered
// on the device of whoever wrote to them, with that player's own key. The
// device's reply is words alone: it runs on a page that may not write the game
// (and whose game is the host's view), so the turn that writes it must not
// answer a peace, open a vote, touch an institution or keep a memory, and the
// only thing it gives back is what was said.
//
// gameplay.js cannot be loaded under node (it reaches the map and the model),
// so these read the source, as the other tests of that file do; the reply is
// run for real, in two browsers, by tools/multiplayer-e2e.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyChatActionBatch, normalizeChatAction } from "./chatActions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").split("\r\n").join("\n");
const gameplay = read("gameplay.js");
// One exported function's source, from its declaration to the next export.
const functionSource = (name) => {
  const start = gameplay.indexOf(`export const ${name} = `);
  assert.ok(start >= 0, `${name} is exported`);
  const next = gameplay.indexOf("\nexport const ", start + 1);
  return gameplay.slice(start, next < 0 ? undefined : next);
};
const batch = functionSource("runChatActionBatch");
const reply = functionSource("writeTableReply");

test("the device's reply is one table's turn, asked for words alone, of the governments the host named", () => {
  assert.match(reply, /await runChatActionBatch\(\{/);
  assert.equal(reply.match(/runChatActionBatch\(/g).length, 1, "one request, as any table's turn is");
  assert.match(reply, /wordsOnly: true/);
  assert.match(reply, /governments: normalizeArray\(governments\)/);
  assert.equal(/useCanonicalState/.test(reply), false, "from what the player's own screen holds, never the game's own state");
  // It gives back what was said, and nothing the page could write.
  assert.match(reply, /\.filter\(\(event\) => event\?\.kind === "message"\)/);
  for (const never of ["mutate", "commit", "saveGame", "writeJson", "answerPeaceInChat"]) assert.equal(reply.includes(never), false, never);
});

test("a turn of words alone answers no peace, touches no institution, keeps no memory, and keeps only what was said", () => {
  // No peace is answered: the governments are not told they may, and the game's own answer is behind that.
  assert.match(batch, /const peaceTalks = stored\.institutionId \|\| stored\.lifecycleInstitutionId \|\| formalBusinessRequested \|\| wordsOnly\s*\? \[\]/);
  assert.match(batch, /if \(peaceTalks\.length\) \{[\s\S]*?await answerPeaceInChat\(/, "peace is carried out only where a peace talk was put to the model");
  assert.equal(batch.match(/answerPeaceInChat\(/g).length, 1);
  // An institution's table is never a turn of words alone, so nothing of an institution is committed from one.
  const refusal = batch.indexOf("if (wordsOnly && (stored.institutionId || stored.lifecycleInstitutionId)) return { events: [], applied: [], rejected: [], actions: [] };");
  assert.ok(refusal > 0);
  for (const commit of ["commitInstitutionalChatGovernanceBatch(", "commitInstitutionLifecycleChatBatch(", "runJsonTask("]) {
    assert.ok(batch.indexOf(commit) > refusal, `${commit} comes after the refusal`);
  }
  assert.match(batch, /if \(stored\.institutionId && !lifecycleGovernanceThread\) \{\s*committedInstitution = await commitInstitutionalChatGovernanceBatch/);
  assert.match(batch, /\} else if \(stored\.lifecycleInstitutionId && lifecycleActions\.length\) \{\s*committedLifecycle = await commitInstitutionLifecycleChatBatch/);
  // No memory of the talks, which is kept with a thread this turn does not write.
  assert.match(batch, /const memorySummary = wordsOnly \? "" : normalizeString\(payload\?\.memorySummary\);/);
  // Only what was said is kept of the model's answer.
  assert.match(batch, /\.filter\(\(action\) => !wordsOnly \|\| normalizeChatAction\(action\)\?\.type === "send_message"\)/);
  // And the model is told so, in the same request.
  assert.match(batch, /wordsOnly\s*\? \[\s*"\[What this reply is\]",/);
  assert.match(batch, /Saying a thing here does not do it/);
  // The function itself writes no document: what a turn writes is its caller's to save.
  for (const never of ["mutateChatsState(", "mutateWorldState(", "mutateGameData(", "mutateCanonicalTurnState("]) assert.equal(batch.includes(never), false, never);
});

test("on a player's device the people at the table are everyone the host did not name, whatever that device's own game says", () => {
  assert.match(batch, /const statedGovernments = Array\.isArray\(governments\)\s*\? new Set\(governments\.map\(regionKey\)\.filter\(Boolean\)\)\s*: null;/);
  assert.match(batch, /const otherPeople = \(statedGovernments\s*\? memberNames\.filter\(\(name\) => !statedGovernments\.has\(regionKey\(name\)\)\)/);
  assert.match(batch, /const threadOwner = !statedGovernments && peopleKeys\.size > 1/, "the thread there is already the player's own view of it");
  // Who answers is who is left: the members that are not people.
  assert.match(batch, /const answering = memberNames\s*\.filter\(\(name\) => !otherPeople\.some\(\(person\) => regionKey\(person\) === regionKey\(name\)\)\)/);
  assert.match(batch, /humanParticipants: \[player, \.\.\.otherPeople\]/, "and an action for a person is refused");
});

test("what is kept of a model's answer that tried more than words: the messages, in order, from the governments alone", () => {
  const answer = [
    { type: "add_member", actorName: "France", targetName: "Germany" },
    { type: "send_message", actorName: "France", content: "Paris will host the conference." },
    { type: "create_poll", actorName: "France", pollRef: "p1", question: "Shall we meet?", options: ["Yes", "No"] },
    { type: "rename_chat", actorName: "France", title: "The Paris Conference" },
    { type: "send_message", actorName: "Russian Federation", content: "Moscow agrees to everything." },
    { type: "institution_cast_vote", actorName: "France", proposalId: "p-9", vote: "yes" },
    { type: "send_message", actorName: "France", content: "It expects an answer by the week's end." },
  ];
  // The filter the turn applies before anything is acted on.
  const kept = answer.filter((action) => normalizeChatAction(action)?.type === "send_message");
  assert.equal(kept.length, 3);
  const outcome = applyChatActionBatch(kept, {
    aiParticipants: ["France"],
    humanParticipants: ["Russian Federation", "United States"],
    knownPolities: ["France", "Russian Federation", "United States", "Germany"],
    messageIds: [],
    polls: [],
  }, { time: "1985-01-01" });
  assert.deepEqual(outcome.events.map((event) => [event.kind, event.by, event.text]), [
    ["message", "France", "Paris will host the conference."],
    ["message", "France", "It expects an answer by the week's end."],
  ], "a line written for a person is refused here, before the host refuses it again");
  assert.equal(outcome.rejected.length, 1);
});

test("the reply is asked on a page playing a shared game, which is where every other turn is refused", () => {
  const lazy = read("gameplayLazy.js");
  assert.match(lazy, /export const writeTableReply = async \(\.\.\.args\) => \(await gameplay\(\)\)\.writeTableReply\(\.\.\.args\);/);
  assert.match(lazy, /export const runChatActionBatch = hostOnly\(/, "the table's own turn stays the host's");
  assert.match(lazy, /export const answerPeaceInChat = hostOnly\(/);
  // The panel asks it only for a line the host left to this device.
  const panel = read("../GameUI/chat.jsx");
  assert.match(panel, /const own = ownReplyAsked\(target, answer\);\s*if \(own\) void answerOnThisDevice\(\{ \.\.\.own, text, playerCountry \}\);/);
  const runner = read("../GameUI/ownTableReplies.js");
  assert.match(runner, /send: \(fields\) => requestFromHost\("reply", fields\)/);
  assert.equal(/api_key|apiKey|getApiKey|localStorage/.test(runner), false, "the runner handles no key: the model call reads the device's own, as any call does");
});
