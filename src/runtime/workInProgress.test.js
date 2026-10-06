/*! Open Historia — work a button is still doing tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/workInProgress.test.js
//
// A scenario card's Update gave no sign that it was working, so it was pressed
// again, and each press downloaded the post's file and replaced the scenario
// once more. What has to hold:
//   - work that is running cannot be started a second time, from any of the
//     cards that show the same scenario;
//   - every card is told when it starts and when it ends, a failure included;
//   - what is running outlives the component that started it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkInProgress } from "./workInProgress.js";

test("work that is running is not started again until it has ended", () => {
  const updates = createWorkInProgress();
  assert.equal(updates.begin("old-world"), true);
  assert.equal(updates.begin("old-world"), false, "the second press starts nothing");
  assert.equal(updates.begin("new-world"), true, "another scenario's update is its own");
  assert.deepEqual([...updates.running()].sort(), ["new-world", "old-world"]);
  updates.end("old-world");
  assert.equal(updates.running().has("old-world"), false);
  assert.equal(updates.running().has("new-world"), true);
  assert.equal(updates.begin("old-world"), true, "once it has ended it can be pressed again");
});

test("every listener hears a start and an end, and nothing when nothing changed", () => {
  const updates = createWorkInProgress();
  const seen = [];
  const stop = updates.subscribe(() => seen.push([...updates.running()]));
  updates.begin("old-world");
  updates.begin("old-world");
  updates.end("old-world");
  updates.end("old-world");
  assert.deepEqual(seen, [["old-world"], []], "a refused start and a second end tell nobody");
  stop();
  updates.begin("old-world");
  assert.equal(seen.length, 2, "a listener that left hears no more");
});

test("the set is replaced, never changed in place, so a reader can tell it moved", () => {
  const updates = createWorkInProgress();
  const idle = updates.running();
  assert.equal(updates.running(), idle, "unchanged between changes");
  updates.begin("old-world");
  const busy = updates.running();
  assert.notEqual(busy, idle);
  assert.equal(idle.size, 0, "the set a reader already holds is left as it was");
  updates.begin("old-world");
  assert.equal(updates.running(), busy, "a refused start changes nothing");
});

test("a failed update ends like any other, and the work outlives whoever started it", async () => {
  const updates = createWorkInProgress();
  const update = async (id, work) => {
    if (!updates.begin(id)) return "already running";
    try {
      return await work();
    } catch (error) {
      return `failed: ${error.message}`;
    } finally {
      updates.end(id);
    }
  };
  let finish;
  const first = update("old-world", () => new Promise((resolve) => { finish = () => resolve("updated"); }));
  // The library is remounted while the download is on its way: a new reader
  // of the same store still sees it running, and its press starts nothing.
  assert.equal(updates.running().has("old-world"), true);
  assert.equal(await update("old-world", async () => "updated twice"), "already running");
  finish();
  assert.equal(await first, "updated");
  assert.equal(updates.running().size, 0);
  assert.equal(await update("old-world", async () => { throw new Error("offline"); }), "failed: offline");
  assert.equal(updates.running().size, 0, "a failure gives the button back");
});
