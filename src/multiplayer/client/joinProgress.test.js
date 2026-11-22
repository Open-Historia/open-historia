/*! Open Historia — what the lobby says while people connect: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/joinProgress.test.js
//
// A lobby that said "Finding the host…" whatever was happening, and showed the
// host nobody who had not yet taken a country, is what these lines replace:
// every step a player can be stuck on has its own words, every way joining
// ends has its own reason, and the host is told who is trying and who failed.

import test from "node:test";
import assert from "node:assert/strict";
import { hostLines, joinFailure, joinStage, peopleOf, scenarioMissing } from "./joinProgress.js";
import { DENY_REASONS, REJECT_REASONS } from "../session/messages.js";

test("each step of joining has its own line, and looking for the host has none", () => {
  const stage = (connection, detail) => joinStage({ role: "guest", connection, detail });
  assert.equal(stage("finding", { heard: false, failures: 0 }), "", "the screen's own words stand");
  assert.equal(stage("", null), "");
  const lines = [
    stage("finding", { heard: true, failures: 0 }),
    stage("connecting", { heard: true, failures: 0 }),
    stage("finding", { heard: true, failures: 1 }),
    stage("connecting", { heard: true, failures: 1 }),
    stage("joining", { heard: true, failures: 0 }),
    stage("connected", { heard: true, failures: 0 }),
    stage("reconnecting", { heard: true, failures: 0 }),
  ];
  assert.ok(lines.every(Boolean), JSON.stringify(lines));
  assert.equal(new Set(lines).size, lines.length, "no two steps read the same");
  assert.match(lines[0], /Found the host/);
  assert.match(lines[2], /could not be reached/);
  assert.match(lines[2], /try 2/);
  assert.match(lines[5], /Loading the lobby/);
  // The host's own screen never says it is looking for a host.
  assert.match(joinStage({ role: "host", connection: "loopback" }), /Opening the game/);
});

test("every way joining ends has a reason of its own", () => {
  const lost = ["host-not-found", "no-answer", "cannot-connect", "no-welcome", "host-closed", "gave-up"]
    .map((reason) => joinFailure({ connection: "lost", reason }));
  const rejected = [...new Set([...REJECT_REASONS, ...DENY_REASONS])]
    .map((reason) => joinFailure({ connection: "rejected", reason }));
  for (const line of [...lost, ...rejected]) assert.ok(line.length > 15, line);
  assert.equal(new Set(lost).size, lost.length);
  assert.match(joinFailure({ connection: "lost", reason: "host-not-found" }), /invite code/);
  assert.match(joinFailure({ connection: "lost", reason: "cannot-connect" }), /no connection between your computer and theirs/);
  assert.match(joinFailure({ connection: "rejected", reason: "version" }), /same version/);
  assert.match(joinFailure({ connection: "rejected", reason: "full" }), /full/);
  // Anything unforeseen still says something, and a bad code its own message.
  assert.ok(joinFailure({ connection: "lost", reason: "" }));
  assert.ok(joinFailure({ connection: "rejected", reason: "something-new" }));
  assert.equal(joinFailure({ connection: "invalid", message: "An invite code is 60 characters." }), "An invite code is 60 characters.");
  assert.ok(joinFailure({ connection: "invalid" }));
});

test("a failed connection says whose network it looks like", () => {
  const told = (network) => joinFailure({ connection: "lost", reason: "cannot-connect", network });
  assert.match(told("symmetric"), /This computer's network looks like the one in the way/);
  assert.match(told("blocked"), /This computer's network looks like the one in the way/);
  assert.match(told("open"), /probably the host's/);
  assert.doesNotMatch(told("unknown"), /This computer's network/);
  assert.doesNotMatch(told(""), /This computer's network/);
});

test("the host is told who is choosing, who is connecting and who could not", () => {
  assert.deepEqual(hostLines(null), []);
  assert.deepEqual(hostLines({ choosing: [], joining: [], unreachable: [], network: "open" }), []);
  const lines = hostLines({ choosing: ["Ana"], joining: ["Ben", "Cleo"], unreachable: ["Cleo", "Dan"], network: "open" });
  assert.equal(lines.length, 4);
  // Each a whole sentence, the names apart from it: nothing English is glued
  // onto a name ("Cleo (trying again)"), and no name is in the words to translate.
  assert.deepEqual(lines.map((line) => [line.text, peopleOf(line)]), [
    ["In the lobby, choosing a country:", "Ana"],
    ["Connecting now:", "Ben"],
    ["Trying again to connect:", "Cleo"],
    ["These players found this lobby, but no connection between their computer and this one could be opened:", "Dan"],
  ]);
  assert.deepEqual(lines.map((line) => line.problem), [false, false, false, true]);
  // The network's own warnings name nobody.
  assert.equal(hostLines({ network: "symmetric" }).at(-1).people, undefined);
});

test("the host is warned when its own network is the kind nobody can connect to", () => {
  assert.match(hostLines({ network: "symmetric" }).at(-1).text, /Someone on another network should host/);
  assert.match(hostLines({ network: "blocked" }).at(-1).text, /could not find its public address/);
  assert.deepEqual(hostLines({ network: "open" }), []);
  assert.deepEqual(hostLines({ network: "unknown" }), []);
  // Nobody getting in, on a network that looks fine: say what to try.
  const stuck = hostLines({ unreachable: ["Ana", "Ben"], network: "open" });
  assert.equal(stuck.length, 2);
  assert.match(stuck[1].text, /let someone else host/);
  // Somebody did get in: it is not this computer.
  assert.equal(hostLines({ choosing: ["Cleo"], unreachable: ["Ana", "Ben"], network: "open" }).length, 2);
});

test("a long list of names is cut, and a missing scenario is named", () => {
  const many = Array.from({ length: 20 }, (_, index) => `Player ${index + 1}`);
  const [line] = hostLines({ joining: many });
  assert.match(peopleOf(line), /Player 12…$/);
  assert.doesNotMatch(peopleOf(line), /Player 13/);
  assert.match(scenarioMissing("The Fire Rises"), /"The Fire Rises"/);
  assert.match(scenarioMissing(""), /a scenario/);
});

test("a wrong clock is said while joining, when it ends, and on the host's screen", () => {
  assert.match(joinStage({ role: "guest", connection: "finding", detail: { heard: false, failures: 0, clock: true } }), /clock looks wrong/);
  // Once in, it is no longer what holds anything up.
  assert.match(joinStage({ role: "guest", connection: "connected", detail: { clock: true } }), /Loading the lobby/);
  const ended = joinFailure({ connection: "lost", reason: "clock" });
  assert.match(ended, /clock is wrong/);
  assert.match(ended, /time zone/);
  assert.match(ended, /Settings → Time & language → Date & time/);
  const host = hostLines({ clockRefused: true, network: "open" });
  assert.equal(host.length, 1);
  assert.equal(host[0].problem, true);
  assert.match(host[0].text, /nobody can find this lobby/);
});
