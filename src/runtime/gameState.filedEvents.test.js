/*! Open Historia — events kept off the timeline, in a save © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.filedEvents.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// A turn keeps the events its writer produced but the engine kept off the
// timeline (runtime/filedEvents.js), so the Events panel can show them greyed
// instead of letting them vanish. The save bounds and repairs that list like
// every other part of a history entry, and an entry without one carries none.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeWorldState } from "./gameState.js";
import { FILED_EVENTS_MAX, FILED_FATES } from "./filedEvents.js";

test("a turn's filed events survive a save, bounded and repaired", () => {
  const world = normalizeWorldState({
    simulationHistory: [
      {
        date: "2019-11-27",
        eventIds: ["a"],
        filedEvents: [
          { title: "Omani Panel Reports Compliance", route: "ROUTINE_MILITARY_PRECURATION", date: "2019-08-27" },
          { title: "", route: "EXACT_DUPLICATE" },
          ...Array.from({ length: FILED_EVENTS_MAX + 3 }, (_, index) => ({ title: `Filler ${index}`, route: "NATIVE_PROCESS_FILLER" })),
        ],
      },
      { date: "2019-10-28", eventIds: ["b"] },
    ],
  });
  const [latest, older] = world.simulationHistory;
  assert.equal(latest.filedEvents.length, FILED_EVENTS_MAX);
  assert.equal(latest.filedEvents[0].title, "Omani Panel Reports Compliance");
  assert.equal(latest.filedEvents[0].fate, FILED_FATES.offTimeline);
  assert.ok(latest.filedEvents[0].note);
  assert.equal("filedEvents" in older, false);
});
