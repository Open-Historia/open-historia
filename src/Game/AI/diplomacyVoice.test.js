/*! Open Historia — a country's message is told whose it is: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/diplomacyVoice.test.js
//
// "the ai is mistaking itself as being the player country talking to the
// united states (its talking to washington but it is playing the united
// states)"; "just look at the prompt and make it clearer what country the ai
// is meant to be" (the owner, 2026-10-25).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every request that writes a country's message to the player says which country it is, and who the player is", () => {
  const gameplay = read("./gameplay.js");
  // A note between turns and an event's note: the same words, with the player named.
  assert.match(gameplay, /const noteVoiceText = \(player\) => \[\s+"\[Whose voice\]",\s+`\$\{player\} is the PLAYER: the country the note is written TO\. You are never \$\{player\}\.`/);
  assert.equal((gameplay.match(/\$\{noteVoiceText\(/g) || []).length, 2, "idle diplomacy and event outreach");
  // A turn of a conversation: the countries it writes as, by name, and the player's lines as the player's.
  assert.match(gameplay, /`You write ONLY as \$\{aiParticipants\.join\(", "\)\}/);
  assert.match(gameplay, /the lines marked \$\{player\} in the conversation are what it said to you\. Answer them as the polity you write for, never as \$\{player\}\./);
  // And what every note and message is written against.
  const schemas = read("./gameplaySchemas.js");
  assert.match(schemas, /The speaker's own first message, in its leader's voice, TO the player: never the player's words./);
  // And who that speaker is: one of the chat's countries, never a bloc's line pinned on a country it addresses.
  assert.match(schemas, /Who sends it: one of countries, as written. Never the player./);
  assert.match(schemas, /send_message: spoken message only, in the actor's own voice, written TO the others/);
});
