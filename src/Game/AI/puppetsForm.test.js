/*! Open Historia — an event that makes a puppet records it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/puppetsForm.test.js
//
// "Polities just never become puppet states through actions/events" (a player,
// 2026-10-28). The skip knew the puppetUpdates format but was never told an
// event that makes a puppet owes one.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyDiplomaticUpdates, bindPuppetUpdatesToEvents, decodePuppetUpdates } from "./nativeDiplomaticDirector.js";
import { normalizeWorldState } from "../../runtime/gameState.js";

test("the skip is told that an event making a puppet gets its install line, beside the events", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /Any event that makes one polity the puppet, vassal, protectorate, satellite, client state or tributary of another .* gets the matching install line in puppetUpdates, with that event's number/);
  assert.match(gameplay, /An event that frees, annexes or sees a puppet throw off its overlord gets a release, annex or revolt line the same way\./);
  // Told "the event carries the line", models wrote it inside the event's impacts, and the check cut it (2026-11-03).
  assert.match(gameplay, /These lines, like every relation, agreement and war record, are the answer's own, beside its events: never inside an event or its impacts\./);
});

test("an event and its install line make the puppet", () => {
  const world = normalizeWorldState({ polityOverrides: { Aland: { code: "Aland", name: "Aland" }, Borduria: { code: "Borduria", name: "Borduria" } } });
  const events = [{ id: "e1", date: "2024-03-05", title: "Borduria becomes a protectorate of Aland", description: "Aland takes over Borduria's foreign policy." }];
  const updates = bindPuppetUpdatesToEvents(decodePuppetUpdates("install~Aland~Borduria~protectorate~60~open~1~treaty"), events);
  const { world: after } = applyDiplomaticUpdates({
    world, relationUpdates: [], agreementUpdates: [], puppetUpdates: updates, events,
    stopDate: "2024-03-31", round: 2, regionCatalog: [{ id: "r1", country: "Aland" }, { id: "r2", country: "Borduria" }], limit: Infinity,
  });
  assert.deepEqual(after.puppets.map((row) => [row.overlord, row.puppet, row.kind, row.status, row.sourceEventIds]), [["Aland", "Borduria", "protectorate", "active", ["e1"]]]);
});
