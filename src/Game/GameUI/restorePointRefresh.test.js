/*! Open Historia — the Rollback button counts the restore point the turn just saved: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/restorePointRefresh.test.js
//
// Read as source: gameplay.js and time.jsx cannot be imported without the
// whole app. The bug was ORDER. The turn is written, the round changes and the
// timeline counts its restore points; the restore point itself is saved after
// the agents' reports, so it was never counted and the Rollback button stayed
// hidden while the cheats menu, which reads when opened, could roll back.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const gameplay = fs.readFileSync(new URL("../AI/gameplay.js", import.meta.url), "utf8");
const time = fs.readFileSync(new URL("./time.jsx", import.meta.url), "utf8");

test("saving a restore point is announced after the write, not before", () => {
    const from = gameplay.indexOf("const captureRollbackSnapshot = async");
    const capture = gameplay.slice(from, gameplay.indexOf("\n};", from));
    const written = capture.indexOf("writeJson(JSON_URLS.snapshots");
    const announced = capture.indexOf('new Event("oh:restore-point-saved")');
    assert.ok(written > -1 && announced > written);
});

test("the Rollback count and the Intervene check both re-read on it", () => {
    // Both read the newest restore point, so both go through the reading that
    // listens for it.
    assert.match(time, /addEventListener\("oh:restore-point-saved", refresh\)/);
    assert.match(time, /useRestorePointReading\(loadRollbackSnapshotCount, 0, \[gameData\?\.round\]\)/);
    assert.match(time, /useRestorePointReading\(\s*async \(\) => Boolean\(await canInterveneInLastTurn\(\)\)/);
});

test("a restore point that could not be saved is said on the Events page, not only in the console", () => {
    const from = gameplay.indexOf("const captureRollbackSnapshot = async");
    const capture = gameplay.slice(from, gameplay.indexOf("\n};", from));
    assert.match(capture, /return true;[\s\S]*catch[\s\S]*return false;/);
    assert.match(gameplay, /const restorePointSaved = await captureRollbackSnapshot\(/);
    assert.match(gameplay, /\r?\n {4}restorePointSaved,\r?\n/);
    assert.match(time, /setRestorePointMissing\(result\.restorePointSaved === false\)/);
    assert.match(time, /could not be saved as a restore point, so it cannot be rolled back/);
});
