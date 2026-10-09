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

// A button that stops turning has said only that the work is over. What it
// left to say (it failed, and why) is kept with it, for every card that shows
// the scenario and for a library remounted meanwhile.
test("what the work left to say is kept until it is started again", () => {
  const updates = createWorkInProgress();
  assert.equal(updates.notes().size, 0);
  updates.begin("old-world");
  updates.end("old-world", "Update failed: offline");
  assert.equal(updates.notes().get("old-world"), "Update failed: offline");
  assert.equal(updates.running().has("old-world"), false, "the button is given back as well");
  // Another scenario's work says nothing about this one.
  updates.begin("new-world");
  updates.end("new-world");
  assert.equal(updates.notes().get("old-world"), "Update failed: offline");
  assert.equal(updates.notes().has("new-world"), false, "work that simply finished leaves nothing to say");
  // Pressed again: the last attempt's note is not the news while this one runs.
  updates.begin("old-world");
  assert.equal(updates.notes().has("old-world"), false);
  updates.end("old-world", "   ");
  assert.equal(updates.notes().has("old-world"), false, "a blank note is no note");
});

test("a note is a new map on every change, and a listener hears one change for one end", () => {
  const updates = createWorkInProgress();
  const empty = updates.notes();
  let heard = 0;
  updates.subscribe(() => { heard += 1; });
  updates.begin("old-world");
  assert.equal(updates.notes(), empty, "starting with nothing to clear changes no map");
  updates.end("old-world", "Update failed: offline");
  const noted = updates.notes();
  assert.notEqual(noted, empty);
  assert.equal(empty.size, 0, "the map a reader already holds is left as it was");
  assert.equal(heard, 2, "one for the start, one for the end with its note");
  updates.end("old-world", "said twice");
  assert.equal(updates.notes(), noted, "work that is not running cannot leave a note");
  assert.equal(heard, 2);
});

test("the scenario card shows what the last Update left to say, on every shelf", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../Game/GameUI/libraryBar.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /const scenarioUpdateNotes = useSyncExternalStore\(scenarioUpdates\.subscribe, scenarioUpdates\.notes, scenarioUpdates\.notes\);/);
  assert.equal(source.split('updateNote={scenarioUpdateNotes.get(scenario.id) ?? ""}').length - 1, 2, "both shelves");
  assert.match(source, /scenarioUpdates\.end\(scenario\.id, outcome\);/);
  assert.match(source, /tell\(`Update failed: \$\{nextError\.message\}`\);/);
  assert.match(source, /\{updateNote && updateAvailable && !updating && \(/, "only while the card still offers Update, and not under the ring");
});
