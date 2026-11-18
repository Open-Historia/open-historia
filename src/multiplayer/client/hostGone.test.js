// Run: node --test src/multiplayer/client/hostGone.test.js
//
// "I closed the lobby but this person says they are still in it" (the owner, 2026-11-18): a guest cut off from its
// host is refused what it does, with why; a game the host's going ended is said once in the menu, and nothing of it
// is kept to reopen it on the next page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { CUT_OFF_REFUSAL, HOST_CLOSED, HOST_GONE, cutOffRefusal, hostGoneWords, keepEndedNotice, takeEndedNotice } from "./hostGone.js";

const memoryStorage = () => {
  const kept = new Map();
  return {
    getItem: (key) => (kept.has(key) ? kept.get(key) : null),
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: (key) => kept.delete(key),
    keys: () => [...kept.keys()],
  };
};

test("a guest cut off from the host has its requests refused, with why; the host and a connected guest do not", () => {
  assert.equal(cutOffRefusal({ role: "guest", connection: "reconnecting" }), CUT_OFF_REFUSAL);
  assert.equal(cutOffRefusal({ role: "guest", connection: "connected" }), "");
  assert.equal(cutOffRefusal({ role: "host", connection: "loopback" }), "");
});

test("why a game ended, by the host's going: closed, or no longer reachable", () => {
  assert.equal(hostGoneWords("host-closed"), HOST_CLOSED);
  assert.equal(hostGoneWords("host-gone"), HOST_GONE);
  assert.equal(hostGoneWords("gave-up"), HOST_GONE);
  assert.equal(hostGoneWords("banned"), "", "a guest sent away is told as before");
});

test("the menu's word on a game the host's going ended is said once, and nothing else is kept", () => {
  const storage = memoryStorage();
  keepEndedNotice(storage, HOST_CLOSED);
  assert.equal(storage.keys().length, 1);
  assert.equal(takeEndedNotice(storage), HOST_CLOSED);
  assert.equal(takeEndedNotice(storage), "", "once");
  assert.deepEqual(storage.keys(), []);
  assert.equal(takeEndedNotice(null), "");
});

// A page reloaded while the host is gone opens the menu: a guest's page keeps no join to take up again (only the host's
// own tab keeps that it hosts, client/sharedGame.js resumeHosting), and the ended notice is all that is kept.
test("a guest's page keeps no join to take up again on a reload", () => {
  const source = fs.readFileSync(new URL("./sharedGame.js", import.meta.url), "utf8");
  const stored = [...source.matchAll(/(?:sessionStorage|localStorage)\.setItem\(([^,]+),/g)].map((match) => match[1].trim());
  assert.deepEqual(stored, ["HOSTING_KEY"], "only the host's tab keeps that it hosts");
  assert.match(source, /takeEndedNotice\(sessionStorage\)/);
});
