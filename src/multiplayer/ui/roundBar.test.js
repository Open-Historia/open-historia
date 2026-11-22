/*! Open Historia — what a shared game's round bar says: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/ui/roundBar.test.js
//
// The review of 2026-11-18 (ui 1, 6, 7, 8, 15, 16): a failed or cancelled
// round showed a clock running down to 0:00 on nothing, a cancel read "could
// not be resolved", the host's screen gone read "Paused", nothing moved while a
// round was resolved, counts were glued onto pieces of English, the bar laid
// itself out in half the screen, and Stop ended everyone's game in one click.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { askingLabel, barStatus, clock, failureText, readyText, roundClockText, unreadLabel, waitsForTheHost } from "./roundBar.js";

test("the clock says the time left, or why there is none", () => {
  const planning = { phase: "planning", round: 4, failed: 0, paused: false };
  assert.equal(roundClockText({ round: planning, remaining: 19 * 60_000 + 58_000 }), "19:58");
  assert.equal(roundClockText({ round: { ...planning, paused: true } }), "Paused");
  assert.equal(roundClockText({ round: { ...planning, paused: true, hostAway: true } }), "Waiting for the host's screen to come back");
  // A round that failed or was cancelled: planned again, but nothing runs it but the host.
  const failed = { ...planning, failed: 4, failure: "The model's quota is used up." };
  assert.equal(waitsForTheHost(failed), true);
  assert.equal(roundClockText({ round: failed, remaining: 19 * 60_000 }), "Waiting for the host to run it again", "never a clock running down on nothing");
  assert.equal(roundClockText({ round: failed, role: "host" }), "Waiting for you to run it again");
  // Run again: resolving, its failure still said until it lands, and how long it has been resolving.
  assert.equal(waitsForTheHost({ ...failed, phase: "resolving" }), false);
  assert.equal(roundClockText({ round: { ...failed, phase: "resolving" }, elapsed: 83_000 }), "1:23");
  assert.equal(roundClockText({ round: { phase: "revealing", paused: false }, remaining: 61_000 }), "1:01");
  assert.equal(roundClockText({ round: { phase: "lobby" } }), "");
  assert.equal(clock(3 * 3600_000 + 5_000), "3:00:05");
});

test("a cancelled round is said as cancelled; one that failed, with why", () => {
  assert.equal(failureText({ failed: 4, failureKind: "cancelled", failure: "The host cancelled the round." }), "The host cancelled round 4. Its orders are still queued.");
  assert.equal(failureText({ failed: 4, failureKind: "failed", failure: "The model's quota is used up." }), "Round 4 could not be resolved: The model's quota is used up.");
  assert.equal(failureText({ failed: 4, failure: "" }), "Round 4 could not be resolved: the host's AI did not answer.");
});

test("every line is whole, its count in it", () => {
  assert.equal(readyText({ ready: ["A", "B"], counted: 3, needed: 2 }), "2 of 3 ready (countdown at 2)");
  assert.equal(readyText({ ready: [], counted: 1, needed: 0 }), "0 of 1 ready");
  assert.equal(unreadLabel(1), "1 new notice");
  assert.equal(unreadLabel(3), "3 new notices");
});

// "Make this whole overlay thing not always be on screen" (the owner, 2026-11-18): each state out of the ordinary is
// one short mark on the bar, its sentence in the mark's title and in the dropdown it opens.
test("the bar says a state out of the ordinary in a word or two, the most pressing one, and opens where it is said in full", () => {
  const planning = { phase: "planning", round: 5, failed: 0, paused: false };
  assert.equal(barStatus({ round: planning }), null, "an ordinary round has no mark");
  const cut = barStatus({ round: { ...planning, failed: 4 }, cutOff: "Reconnecting to the host…" });
  assert.deepEqual([cut.kind, cut.label, cut.title, cut.problem], ["reconnecting", "Reconnecting…", "Reconnecting to the host…", true], "cut off from the host comes first");
  const failed = { ...planning, failed: 4, failureKind: "failed", failure: "The model's quota is used up." };
  assert.deepEqual(barStatus({ round: failed, role: "guest" }), { kind: "failed", label: "Round 4 failed", short: "Failed", title: failureText(failed), problem: true, opens: "players" });
  assert.equal(barStatus({ round: failed, role: "host" }).opens, "host", "the host's mark opens where Try again now is");
  assert.deepEqual([barStatus({ round: { ...failed, failureKind: "cancelled" } }).label, barStatus({ round: { ...failed, failureKind: "cancelled" } }).short], ["Round 4 cancelled", "Cancelled"]);
  assert.equal(barStatus({ round: { ...failed, phase: "resolving" } }), null, "run again, the round's step says what it is doing");
  const away = barStatus({ round: { ...planning, paused: true, hostAway: true } });
  assert.deepEqual([away.kind, away.label, away.title], ["host-away", "Host away", "Waiting for the host's screen to come back"]);
  assert.equal(barStatus({ round: { ...planning, paused: true } }), null, "paused by the host: the clock says Paused");
  assert.equal(barStatus({ round: planning, watching: "Latvia is gone: you are watching." }).label, "Watching");
  assert.equal(barStatus({ round: planning, role: "guest", busyLine: "busy" }), null, "the host's busy game is the host's to know");
  assert.deepEqual(barStatus({ round: planning, role: "host", busyLine: "Your game is still applying an earlier change (12 s)." }),
    { kind: "busy", label: "Busy", title: "Your game is still applying an earlier change (12 s).", problem: true, opens: "host" });
  assert.equal(askingLabel(1), "1 player asks to change country");
  assert.equal(askingLabel(2), "2 players ask to change country");
});

// What the overlay is made of, read as text: it is JSX, which plain node does not load. These pin the rules of its
// layout, its dropdowns and its Stop, the way serverImports.test.js pins one of the server's.
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `${from} … ${to}`);
  return text.slice(start, end);
};
const overlay = fs.readFileSync(new URL("./SharedGameOverlay.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const bar = between(overlay, "const RoundBar = ", "export function SharedGameView");

test("the round bar is one slim row of the essentials, as wide as what it holds", () => {
  assert.ok(bar.length > 1000, "the round bar was found");
  assert.doesNotMatch(bar, /translateX\(-50%\)/, "centred by a transform, it had half the screen to lay out in");
  assert.match(bar, /width: "fit-content"/);
  assert.match(bar, /useIsMobile\(\)/);
  const strip = between(bar, 'role="toolbar"', "{playersMenu}");
  assert.match(strip, /flexWrap: "nowrap"/, "one row, on a phone too");
  // On it: the round, its clock, where it lands, the mark, Ready, Players, Host. Not one host control.
  assert.doesNotMatch(strip, /hostControl\(|<HostInvite|<RepliesSetting|<GameMasterBox|<SeatList|<NoticeList|<LeaveButton|<ChangeRequests|<PayItYourself/);
  assert.match(strip, /\{ready \? "Ready ✓" : compact \? "Ready" : "I'm ready"\}/);
  assert.match(strip, /aria-expanded=\{showPlayers\}/);
  assert.match(strip, /\{host \? \(\s*<button\s+ref=\{hostButton\}[^]*?aria-expanded=\{showHost\}/, "Host, for the host alone");
  // Nothing open by default but what a player needs: Players for one who watches, Host for a host whose game opens paused.
  assert.match(bar, /useState\(watching \? "players" : ""\)/);
});

test("every host control is in the Host dropdown, and its Stop asks before it ends everyone's game", () => {
  const hostMenu = between(bar, "const hostMenu = ", "const roundName = ");
  for (const control of ['"resume" : "pause"', '"resolveNow"', '"cancelRound"']) assert.ok(hostMenu.includes(`hostControl(round?.paused ? ${control})`) || hostMenu.includes(`hostControl(${control})`), control);
  for (const part of ["<PayItYourself", "<ChangeRequests", "<SeatList seats={shared.lobby?.seats} host handsOnly />", "<HostInvite", "<RepliesSetting", "<HostAnswersSetting", "<GameMasterBox", '<LeaveButton role={role} label="Stop sharing" />', "Try again now", "End round now", "Cancel round"]) {
    assert.ok(hostMenu.includes(part), part);
  }
  const playersMenu = between(bar, "const playersMenu = ", "const hands = ");
  assert.doesNotMatch(playersMenu, /hostControl\(|<HostInvite|<RepliesSetting|<GameMasterBox| host[ }]/, "the Players dropdown is the same for everyone");
  assert.match(playersMenu, /<NoticeList notices=\{notices\} readAt=\{readBefore\} \/>/);
  assert.match(playersMenu, /<CountryPicker/);
  assert.doesNotMatch(overlay, /onClick=\{leave\}>\{role === "host"/, "Stop never ends the game in one click");
  assert.match(overlay, /Stop sharing for everyone/);
  // The host's lines are translated whole; only the names in them are not.
  assert.equal((overlay.match(/data-no-translate/g) ?? []).length, 1);
});

test("a dropdown closes on a click outside it or Escape, which gives the focus back to its button", () => {
  assert.match(bar, /document\.addEventListener\("pointerdown", outside, true\);/);
  assert.match(bar, /if \(!rootRef\.current\?\.contains\(event\.target\)\) setOpen\(""\);/);
  assert.match(bar, /if \(event\.key !== "Escape"\) return;\n\s*\(open === "host" \? hostButton : playersButton\)\.current\?\.focus\(\);\n\s*setOpen\(""\);/);
  assert.match(overlay, /role="dialog"/);
  assert.match(bar, /aria-haspopup="dialog"/);
  // Cut off from the host, a guest in the game is told on the bar, never by a box over it.
  assert.match(overlay, /\{inGame \? null : cutOff\}/);
  assert.match(overlay, /cutOff=\{cutOff \? RECONNECTING : ""\}/);
});

test("the bar takes the player's interface theme from the HUD's own tokens, with no gradient and no motion", () => {
  const look = between(overlay, "const barText = ", "const Badge = ");
  assert.match(look, /backgroundColor: "var\(--oh-ui-glass-pill, var\(--oh-hud-bg-strong\)\)"/, "the date widget's glass");
  assert.match(look, /border: "1px solid var\(--oh-hud-border\)"/);
  assert.match(look, /backdropFilter: "var\(--oh-hud-blur\)"/);
  assert.match(look, /backgroundColor: "var\(--oh-ui-overlay-strong, /, "a dropdown is the theme's floating panel");
  assert.match(overlay, /const button = \{\n\s*alignItems: "center", background: "var\(--oh-ui-glass-chip, /);
  assert.match(overlay, /const primary = \{ \.\.\.button, background: "var\(--oh-ui-glass-active, /);
  assert.doesNotMatch(overlay, /gradient\(|animation|transition:/i);
});
