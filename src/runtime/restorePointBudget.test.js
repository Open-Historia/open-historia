/*! Open Historia — the restore points kept, by count and by size, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/restorePointBudget.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { MAX_RESTORE_POINTS, ROLLBACK_ARCHIVE_BYTES, restorePointBytes, restorePointsWithin } from "./restorePointBudget.js";

const point = (id, bytes) => ({ id, bytes });

test("a long campaign's restore points stop where the archive would outgrow what the server takes", () => {
  // A player's log, 2026-11-06, round 637: twelve whole turns came to more than the server's 512 MB, and every restore
  // point after was refused (HTTP 413).
  const MB = 1024 * 1024;
  const kept = restorePointsWithin(Array.from({ length: 12 }, (_, index) => point(`snap-${index}`, 45 * MB)));
  assert.deepEqual(kept.map((snapshot) => snapshot.id), ["snap-0", "snap-1", "snap-2", "snap-3", "snap-4", "snap-5", "snap-6", "snap-7"]);
  assert.ok(kept.length * 45 * MB <= ROLLBACK_ARCHIVE_BYTES);
  assert.ok(ROLLBACK_ARCHIVE_BYTES < 512 * MB, "below the server's limit for the archive");
  const server = fs.readFileSync(new URL("../../server/server.js", import.meta.url), "utf8");
  assert.match(server, /const largeJsonParser = express\.json\(\{ limit: "512mb" \}\);/, "the limit this budget stays under");
});

test("a short game keeps its twelve, newest first, and the newest is kept whatever it weighs", () => {
  const small = Array.from({ length: 15 }, (_, index) => point(`snap-${index}`, 1000));
  assert.equal(restorePointsWithin(small).length, MAX_RESTORE_POINTS);
  assert.deepEqual(restorePointsWithin([point("huge", ROLLBACK_ARCHIVE_BYTES * 2), point("older", 10)]).map((snapshot) => snapshot.id), ["huge"]);
  assert.deepEqual(restorePointsWithin(null), []);
});

test("a restore point saved before sizes were kept is measured once, as written", () => {
  const old = { id: "snap-old", state: { world: { a: 1 } } };
  assert.equal(restorePointBytes(old), JSON.stringify(old).length);
  assert.equal(restorePointBytes(point("snap-new", 77)), 77);
});
