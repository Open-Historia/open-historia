/*! Open Historia — only the latest request may land tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/latestRequest.test.js
//
// The Workshop opened on scenario A, closed while A's map was downloading and
// opened on B showed A's map, and saving wrote it over B. The new game picker
// had the same race with countries and borders. Each load now asks whether it
// is still the latest before it lands.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLatestRequest } from "./latestRequest.js";

test("a load lands only while nothing has opened or closed since it began", async () => {
  const gate = createLatestRequest();
  const shown = [];
  const load = (name, delay) => {
    const isCurrent = gate.begin();
    return new Promise((resolve) => setTimeout(resolve, delay)).then(() => {
      if (isCurrent()) shown.push(name);
    });
  };
  // A opens, then B opens before A's slow load is back.
  await Promise.all([load("A", 20), load("B", 5)]);
  assert.deepEqual(shown, ["B"], "A's late answer never lands in B's panel");
});

test("closing the panel drops the load in flight", () => {
  const gate = createLatestRequest();
  const isCurrent = gate.begin();
  assert.equal(isCurrent(), true);
  gate.cancel();
  assert.equal(isCurrent(), false);
  const other = createLatestRequest();
  assert.equal(other.begin()(), true, "each panel keeps its own count");
});
