/*! Open Historia — unprompted-note echo guard tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// From a live game: the player wrote "We think you suck!" and the next
// unprompted note from China was the same sentence, posted into that thread as
// China's own words. A second note in the same thread ("We appreciate your solar
// partnership…") answered nothing that had been said, because the model had only
// ever seen one summary line of the conversation it was being appended to.

import assert from "node:assert/strict";
import test from "node:test";

import { echoesExistingMessage, renderChatForPrompt, renderOpenChatsForPrompt } from "./chatEcho.js";

const thread = [
  { role: "user", speaker: "France", text: "We think you suck!" },
  { role: "leader", speaker: "China", text: "Our position on the strait has not changed." },
];

test("the reported echo is caught, punctuation and case included", () => {
  assert.equal(echoesExistingMessage("We think you suck!", thread), true);
  assert.equal(echoesExistingMessage("we think you suck", thread), true);
  assert.equal(echoesExistingMessage("  WE THINK YOU SUCK!!  ", thread), true);
});

test("an echo with a clause tacked on is still an echo", () => {
  // Containment in either direction: the failure mode is a model repeating the
  // line and continuing from it.
  assert.equal(echoesExistingMessage("We think you suck, and we will act accordingly.", thread), true);
  assert.equal(echoesExistingMessage("Our position on the strait", thread), true);
});

test("a genuine new note is not blocked", () => {
  assert.equal(echoesExistingMessage("We propose a summit in Geneva next month.", thread), false);
  assert.equal(echoesExistingMessage("We appreciate your solar partnership.", thread), false);
});

test("short interjections never block a note", () => {
  // "ok" / "no" legitimately recur; blocking on them would silence the feature.
  const terse = [{ speaker: "China", text: "No." }, { speaker: "France", text: "Ok" }];
  assert.equal(echoesExistingMessage("No.", terse), false);
  assert.equal(echoesExistingMessage("Ok", terse), false);
  assert.equal(echoesExistingMessage("", thread), false);
  assert.equal(echoesExistingMessage(null, thread), false);
});

test("empty or malformed history is safe", () => {
  assert.equal(echoesExistingMessage("Anything at all here", []), false);
  assert.equal(echoesExistingMessage("Anything at all here", null), false);
  assert.equal(echoesExistingMessage("Anything at all here", [null, {}, { text: null }]), false);
});

test("a rendered chat names every speaker, the player included", () => {
  const out = renderChatForPrompt({ countries: [{ name: "China" }], messages: thread });
  assert.match(out, /^With China:/);
  assert.match(out, /France: We think you suck!/);
  assert.match(out, /China: Our position on the strait has not changed\./);
  // The ambiguity that caused this: a bare "China: France: ..." summary line.
  assert.ok(!/China: France:/.test(out));
});

test("a message with no speaker is labelled by its side, not left blank", () => {
  const out = renderChatForPrompt({ countries: [{ name: "China" }], messages: [{ role: "user", text: "Hello" }] });
  assert.match(out, /the player: Hello/);
});

test("open chats render oldest-first, closed ones are excluded, and the list is capped", () => {
  const chats = [
    { countries: [{ name: "Italy" }], status: "closed", messages: [{ speaker: "Italy", text: "Closed thread" }] },
    ...Array.from({ length: 7 }, (_, i) => ({ countries: [{ name: `P${i}` }], messages: [{ speaker: `P${i}`, text: `line ${i}` }] })),
  ];
  const out = renderOpenChatsForPrompt(chats, { limit: 5 });
  assert.ok(!out.includes("Closed thread"), "a closed chat is not offered for a reply");
  assert.equal(out.split("With ").length - 1, 5, "capped at the limit");
  assert.ok(out.includes("With P6:"), "the most recent is kept");
  assert.ok(!out.includes("With P0:"), "the oldest is dropped first");
  assert.equal(renderOpenChatsForPrompt([]), "There are no open conversations with the player.");
});
