// Run: node --test src/multiplayer/client/playerName.test.js
//
// "make it so you can pick your username when invited to a lobby" (the owner, 2026-11-18): the name is asked where a
// player joins, kept on this device, and sent as it was typed, spaces folded and no longer than a name may be.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { PLAYER_NAME_MAX, cleanPlayerName, rememberPlayerName, rememberedPlayerName } from "./playerName.js";

const memoryStorage = () => {
  const kept = new Map();
  return { getItem: (key) => (kept.has(key) ? kept.get(key) : null), setItem: (key, value) => kept.set(key, String(value)) };
};

test("the name is kept on this device and given back next time", () => {
  const storage = memoryStorage();
  assert.equal(rememberedPlayerName(storage), "");
  rememberPlayerName("  Ana   of  Riga ", storage);
  assert.equal(rememberedPlayerName(storage), "Ana of Riga");
  rememberPlayerName("   ", storage);
  assert.equal(rememberedPlayerName(storage), "Ana of Riga", "an empty name does not replace the kept one");
  assert.equal(rememberedPlayerName({ getItem: () => { throw new Error("blocked"); } }), "");
});

test("the name sent is the one typed, folded and held to the seat's limit", () => {
  assert.equal(cleanPlayerName("x".repeat(80)).length, PLAYER_NAME_MAX);
  assert.equal(cleanPlayerName(null), "");
});

// The seat's name in the lobby (game/messages.js SEAT name: str(40)) holds what is sent.
test("the limit is the lobby's own for a seat's name", () => {
  const messages = fs.readFileSync(new URL("../game/messages.js", import.meta.url), "utf8");
  assert.ok(messages.includes(`name: str(${PLAYER_NAME_MAX})`));
});

test("both ways in ask for the name and send it", () => {
  for (const file of ["../ui/LobbiesTab.jsx", "../ui/DiscordInvites.jsx"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /joinSharedGame\(\{ token: [^,]+, name: cleanPlayerName\(name\) \}\)/, file);
    assert.match(source, /Your name in the game/, file);
  }
});
