/*! Open Historia — what waits while a turn is being made: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/heldRetryGates.test.js
//
// Read as source, like checksHold.test.js: time.jsx cannot be imported without
// the whole app. Two faults, both about which controls answer while a turn is
// being made:
//
//   - The retry of a held turn raised only its own flag, and every control in
//     the Timeline panel asked isLoading alone. The skips, Auto-jump, Go and
//     Undo stayed live through a retry that can take minutes; a skip started
//     then ran a second turn from the same pre-jump world, and the later write
//     replaced the earlier.
//   - « (the Events panel) did nothing for the whole of a skip, a guard from
//     before skips were watched live: a player who pressed » to find Cancel
//     could not get back to the events being written.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const time = fs.readFileSync(new URL("./time.jsx", import.meta.url), "utf8");

const slice = (start, end) => {
    const from = time.indexOf(start);
    assert.notEqual(from, -1, `${start} not found`);
    const to = time.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `${end} not found after ${start}`);
    return time.slice(from, to);
};

test("a held turn's retry greys out every way of starting another turn", () => {
    const panel = slice("const TimelineSkipPanel = ({", "const TimelineHistoryPanel = ({");
    assert.match(panel, /const busy = isLoading \|\| isRetryingHeld;/);
    assert.match(panel, /const blocked = busy \|\| sceneInProgress;/);
    // The duration buttons, Auto-jump and the custom amount all read `blocked`.
    assert.match(panel, /<JumpNode isLoading=\{blocked\} opt=\{opt\} onJump=\{onJump\} \/>/);
    assert.match(panel, /if \(blocked\) \{\s*return;\s*\}\s*onAutoJump\(\);/);
    assert.match(panel, /if \(!Number\.isFinite\(amount\) \|\| amount <= 0 \|\| blocked\) return;/);
    assert.match(panel, /disabled=\{blocked \|\| !customValue\}/);
    // Undo reads `busy`: a scene in progress does not stop an undo, a turn being made does.
    assert.match(panel, /disabled=\{busy\}\s*onClick=\{\(\) => \{ if \(!busy\) onUndo\(\); \}\}/);
    assert.equal(/disabled=\{isLoading\}/.test(panel), false, "nothing in the panel asks isLoading alone any more");
});

test("behind the buttons, nothing that writes a turn starts while a skip or a retry holds the controller", () => {
    assert.match(slice("const runJump = async (", "const cancelJump = "), /if \(!gameData \|\| days == null \|\| isLoading \|\| jumpAbortRef\.current\) \{\s*return;/);
    assert.match(slice("const retryHeld = async (", "const discardHeld = "), /if \(isRetryingHeld \|\| isLoading \|\| jumpAbortRef\.current \|\| !held\) return;/);
    assert.match(slice("const runUndo = async (", "const runIntervene = async"), /if \(isLoading \|\| jumpAbortRef\.current \|\| undoCount <= 0\) \{\s*return false;/);
    assert.match(slice("const runIntervene = async", "const polityLookup = "), /if \(isLoading \|\| jumpAbortRef\.current \|\| !canInterveneTurn\) return false;/);
    // Both the skip and the retry hold it for exactly as long as they run.
    for (const [start, end] of [["const runJump = async (", "const cancelJump = "], ["const retryHeld = async (", "const discardHeld = "]]) {
        const body = slice(start, end);
        const held = body.indexOf("jumpAbortRef.current = controller;");
        const released = body.indexOf("jumpAbortRef.current = null;");
        assert.ok(held > -1 && released > held, `${start} holds and releases the controller`);
        assert.match(body.slice(0, released), /\} finally \{\s*$/, "released in a finally, so a failure cannot leave everything locked");
    }
});

test("the Events panel's Rollback and Intervene wait for a retry as they wait for a skip", () => {
    assert.match(time, /canRollbackTurn=\{undoCount > 0 && !isLoading && !skipInFlight && !isRetryingHeld && !olderTurnRecord\}/);
    assert.match(time, /canIntervene=\{canInterveneTurn && undoCount > 0 && !isLoading && !skipInFlight && !isRetryingHeld && !olderTurnRecord\}/);
});

test("« opens the Events panel during a skip that is being watched live", () => {
    const toggle = slice("function togglePanel(panelName) {", "const runJump = async (");
    assert.match(toggle, /if \(isLoading && panelName !== "skip" && !\(panelName === "history" && skipInFlight\)\) \{\s*return;/);
    // Behind the spinner (live skips off) nothing streams into it, so it still waits.
    assert.match(time, /const \[skipInFlight, setSkipInFlight\] = useState\(false\);/);
    assert.match(time, /setSkipInFlight\(live\);/);
    assert.match(time, /onClick=\{\(\) => togglePanel\("history"\)\}/);
});
