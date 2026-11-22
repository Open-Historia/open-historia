/*! Open Historia — a drafted letter the player sent, known by its id: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/advisorDraftSent.test.js
//
// The advisor's "Draft to X" button hands a letter to the diplomacy composer
// with the draft's id; the message the player sends from it carries that id
// (`fromDraft`), through a save and a thread's log, and the button reads it
// (advisorDrafts.js sentLetterDate). No letter's words are compared with
// another's. advisor.jsx and chat.jsx cannot be imported under node, so their
// wiring is read as source, as the other GameUI tests do.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { normalizeChats } from "../../runtime/gameState.js";
import { eventsFromLegacyChat, projectChatThread } from "../../runtime/chatThreads.js";
import { draftIdOf, sentLetterDate } from "./advisorDrafts.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the draft a message was sent from survives a save and the thread's log", () => {
  const id = draftIdOf("advisor-reply-5", 2);
  const [chat] = normalizeChats([{
    id: "chat-1",
    countries: [{ name: "Republic of Estonia" }],
    messages: [
      { id: "m1", role: "user", speaker: "Republic of Latvia", text: "Riga accepts.", time: "1990-05-04", fromDraft: id },
      { id: "m2", role: "leader", speaker: "Republic of Estonia", text: "Tallinn is glad.", time: "1990-05-04" },
    ],
  }]);
  assert.equal(chat.messages[0].fromDraft, id);
  assert.equal("fromDraft" in chat.messages[1], false, "a line from no draft saves as it always did");
  const replayed = projectChatThread(eventsFromLegacyChat(chat)).messages;
  assert.equal(replayed.find((message) => message.id === "m1").fromDraft, id);
  assert.equal(sentLetterDate({ id, targetType: "private", country: "Republic of Estonia", text: "anything" }, [chat]), "1990-05-04");
});

test("the advisor hands each letter over with its id, and the composer sends it on the message", () => {
  const advisor = read("./advisor.jsx");
  assert.match(advisor, /parsedDrafts\.map\(\(draft, index\) => \(\{ \.\.\.draft, id: draftIdOf\(msg\.id, index\) \}\)\)/);
  assert.match(advisor, /requestDiplomaticChat\(target, \{ draft: draft\.text, fromDraft: draft\.id \|\| "" \}\)/);
  const chat = read("./chat.jsx");
  // The composer remembers which letter it holds, forgets it when emptied, and stamps it on the line it sends.
  assert.match(chat, /setPlayerInput\(draft\);\n[^\n]*\n[^\n]*\n\s*draftFromRef\.current = String\(draftFrom \|\| ""\);/);
  assert.match(chat, /if \(!playerInput\.trim\(\)\) draftFromRef\.current = "";/);
  assert.match(chat, /const fromDraft = draftFromRef\.current;\n\s*draftFromRef\.current = "";/);
  assert.match(chat, /\.\.\.\(fromDraft \? \{ fromDraft \} : \{\}\),\n\s*\.\.\.\(catchUp\.text/);
  assert.equal(chat.match(/setComposerDraft\(\{ chatId: [a-zA-Z.]+, text: draftText, fromDraft \}\)/g)?.length, 4);
  // And no letter is matched by its words any more.
  assert.doesNotMatch(read("./advisorDrafts.js"), /const overlap|SAME_LETTER|letterWords/);
});
