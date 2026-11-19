// Run: node --test src/multiplayer/client/hostGone.test.js
//
// "I closed the lobby but this person says they are still in it" (the owner, 2026-11-18): a guest cut off from its
// host is refused what it does, with why; a game the host's going ended is said once in the menu, and nothing of it
// is kept to reopen it on the next page. "When the game ends, it should actually kick the player from the game" (the
// owner, 2026-11-18): however a shared game ends for a page that was in it, the player is taken out at once, with
// nothing to press, back to the menu, which says why.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { BANNED, CUT_OFF_REFUSAL, HOST_CLOSED, HOST_GONE, REMOVED, cutOffRefusal, endedWords, keepEndedNotice, takeEndedNotice } from "./hostGone.js";
import { joinFailure } from "./joinProgress.js";

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

test("why a shared game ended for a player who was in it, by how its session ended", () => {
  const was = (connection, reason) => endedWords({ wasIn: true, connection, reason });
  // The host pressed Stop, or its app or engine window closed (the goodbye), or its lobby closed meanwhile.
  assert.equal(was("lost", "host-closed"), HOST_CLOSED);
  assert.equal(was("rejected", "closed"), HOST_CLOSED);
  // The host can no longer be reached: its lobby left the relays, or the bounded time ran out.
  assert.equal(was("lost", "host-gone"), HOST_GONE);
  assert.equal(was("lost", "gave-up"), HOST_GONE);
  // The host removed or banned this player.
  assert.equal(was("rejected", "kicked"), REMOVED);
  assert.equal(was("rejected", "banned"), BANNED);
  // Any other end of the session is said in the words a failed joining has for it, never left unsaid.
  assert.equal(was("rejected", "replaced"), joinFailure({ connection: "rejected", reason: "replaced" }));
  assert.equal(was("rejected", "misbehaving"), joinFailure({ connection: "rejected", reason: "misbehaving" }));
  assert.equal(was("lost", "something-new"), joinFailure({ connection: "lost", reason: "something-new" }));
  assert.ok(was("lost", "something-new"));
  // A reason is looked up by its id alone: nothing an object holds of its own is taken for one.
  assert.equal(was("rejected", "constructor"), joinFailure({ connection: "rejected", reason: "constructor" }));
});

test("a joining that never got in is told why it failed, as before", () => {
  for (const [connection, reason] of [["rejected", "banned"], ["lost", "host-not-found"], ["lost", "cannot-connect"], ["rejected", "full"]]) {
    assert.equal(endedWords({ wasIn: false, connection, reason, network: "open" }), joinFailure({ connection, reason, network: "open" }));
  }
  assert.equal(endedWords({ connection: "invalid", message: "That code is not one." }), "That code is not one.");
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

// sharedGame.js and the overlay load the page's runtime: their wiring is read.
const page = fs.readFileSync(new URL("./sharedGame.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `${from} is there`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `${to} follows ${from}`);
  return source.slice(start, end);
};

test("every end of a guest's session takes the page out of the shared game, at once, with why", () => {
  const onState = between(page, "    onState: (connection, detail = {}) => {", "    onProblem:");
  const ends = onState.slice(onState.indexOf('if (!["rejected", "lost", "invalid"].includes(connection)) return;'));
  assert.match(ends, /const wasIn = Boolean\(session\.player\);/);
  assert.match(ends, /void endForThisPage\(endedWords\(\{ wasIn, connection, reason: detail\.reason, message: detail\.message, network: state\.network \}\), \{ wasIn \}\);/);
  assert.doesNotMatch(ends, /set\(/, "no end is only said, with the game left open");
});

test("the host's screen whose engine window stopped answering is taken out too, back to its own game", () => {
  const onGone = between(page, "    onGone: () => {", "\n    },");
  assert.match(onGone, /void endForThisPage\(ENGINE_GONE\);/);
  assert.doesNotMatch(onGone, /set\(/);
});

test("the way out: the menu's word kept, the game left as Leave leaves it, and the page back at the menu", () => {
  const door = between(page, "const endForThisPage = async", "\n};\n");
  assert.match(door, /if \(wasIn\) keepEndedNotice\(/);
  assert.match(door, /await leaveSharedGame\(\{ endedWith: words, reloading: wasIn \}\);/);
  assert.match(door, /finally \{\n\s+if \(wasIn && typeof window !== "undefined"\) window\.location\.reload\(\);/);
  // A game is said ended only on the way out of it (or on the menu, after): never with its screens left open.
  const leave = between(page, "export const leaveSharedGame = async", "\n};\n");
  const ended = [...page.matchAll(/mode: "ended"/g)].map((match) => match.index);
  const leaveAt = page.indexOf(leave);
  const before = page.indexOf("let state = endedBefore ?");
  assert.ok(ended.length >= 1);
  const onTheWayOut = (at) => at > leaveAt && at < leaveAt + leave.length;
  const onTheMenu = (at) => at > before && !page.slice(before, at).includes("\n");
  for (const at of ended) assert.ok(onTheWayOut(at) || onTheMenu(at), `"ended" set outside the way out, at ${at}`);
  // Taken out at once: no request goes on, and the round bar and screens give way to the box before anything is awaited.
  assert.ok(leave.indexOf("current = null;") < leave.indexOf("if (endedWith) set({ mode: \"ended\", error: endedWith, leaving: true });"));
  assert.ok(leave.indexOf("if (endedWith) set(") < leave.indexOf("await "));
  // Nothing of the game left in the library: a stand-in still being made is waited for before it is closed.
  assert.ok(leave.indexOf("await leaving.preparing;") >= 0 && leave.indexOf("await leaving.preparing;") < leave.indexOf("await closeStandInOf(leaving);"));
});

test("the box that says a shared game ended has nothing to press to leave it", () => {
  const overlay = fs.readFileSync(new URL("../ui/SharedGameOverlay.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const box = between(overlay, 'if (shared.mode === "ended") {', "\n  }\n");
  assert.doesNotMatch(box, /\bleave\b\(|leaveSharedGame/, "the page is out of the game already, or being taken out");
  assert.match(box, /shared\.leaving \? null : <button type="button" style=\{button\} onClick=\{dismissEndedNotice\}>OK<\/button>/);
});
