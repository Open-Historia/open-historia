/*! Open Historia — region renames tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/regionRenames.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { resolveRegionName } from "./regionNameFixes.js";
import { applyEventImpactsToWorld, normalizeWorldState } from "./gameState.js";

test("resolveRegionName resolves standard names and applies regionRenames overrides", () => {
  // Without renames: fallback to raw or known fixes
  assert.equal(resolveRegionName("BEL.3_1", "Vlaanderen"), "Vlaanderen");
  assert.equal(resolveRegionName("USA.44_1", "Texas"), "Texas");

  // With renames keyed by ID or lowercased ID
  const renamesById = { "bel.3_1": "South Netherlands" };
  assert.equal(resolveRegionName("BEL.3_1", "Vlaanderen", renamesById), "South Netherlands");

  // With renames keyed by region name
  const renamesByName = { texas: "Republic of New Texas" };
  assert.equal(resolveRegionName("USA.44_1", "Texas", renamesByName), "Republic of New Texas");

  // Placeholder names are ignored unless overridden
  assert.equal(resolveRegionName("XYZ", "N/A"), "");
  assert.equal(resolveRegionName("XYZ", "N/A", { xyz: "Custom Territory" }), "Custom Territory");
});

test("normalizeWorldState preserves and normalizes regionRenames", () => {
  const normalized = normalizeWorldState({
    regionRenames: {
      "BEL.3_1": "South Netherlands",
      "  Texas  ": "Lone Star State  ",
      "": "Invalid",
    },
  });

  assert.deepEqual(normalized.regionRenames, {
    "bel.3_1": "South Netherlands",
    texas: "Lone Star State",
  });
});

test("a region rename is recorded only from a markerOps rename of a region: name, and a city rename renames no region", () => {
  const initialWorld = normalizeWorldState({
    regionRenames: {},
    markers: [],
  });

  const eventWithMarkerOps = {
    id: "evt-rename-regions",
    title: "Regional Renaming Decree",
    date: "1940-05-10",
    impacts: {
      markerOps: [
        { op: "rename", name: "region: Flanders", newName: "South Netherlands" },
        { op: "rename", name: "Wallonia", newName: "Southern Belgium" },
      ],
    },
  };

  const outcome = applyEventImpactsToWorld({
    world: initialWorld,
    events: [eventWithMarkerOps],
  });
  const nextWorld = outcome.world;

  assert.equal(nextWorld.regionRenames["flanders"], "South Netherlands");
  assert.equal(nextWorld.regionRenames["wallonia"], undefined);
  assert.equal(nextWorld.cityRenames["wallonia"], "Southern Belgium");
});

// PR #945: a time skip renames a province, state or region with impacts.regionRenames, a field of its own. Live, with
// markerOps the only way, Gemini told the rename and wrote it as a change to the country or as a transfer of the region
// to itself.
test("an event's regionRenames rename the region on the map, kept through the answer's reader", async () => {
  const { normalizeGameplayPayload } = await import("../Game/AI/gameplaySchemas.js");
  const { EVENT_IMPACT_KEYS } = await import("../Game/AI/jumpAnswerShelves.js");
  assert.ok(EVENT_IMPACT_KEYS.includes("regionRenames"), "a misplaced one is put back on its event");
  const answer = normalizeGameplayPayload("jumpForward", { summary: "", events: [{ date: "2026-02-01", title: "Texas becomes Tejas", description: "", impacts: { regionRenames: [{ region: "region: Texas", newName: "Tejas" }] } }] });
  const event = answer.events[0];
  assert.deepEqual(event.impacts.regionRenames, [{ region: "region: Texas", newName: "Tejas" }]);
  const { world } = applyEventImpactsToWorld({ world: normalizeWorldState({ regionRenames: {} }), events: [{ id: "e1", ...event }] });
  assert.deepEqual(world.regionRenames, { texas: "Tejas" });
  assert.equal(resolveRegionName("USA.44_1", "Texas", world.regionRenames), "Tejas");
  // Without the prefix, or with only one half, it is the same, or nothing.
  const bare = applyEventImpactsToWorld({ world: normalizeWorldState({}), events: [{ id: "e2", date: "2026-02-01", title: "t", impacts: { regionRenames: [{ region: "Bavaria", newName: "Bayern" }, { region: "Saxony" }] } }] }).world;
  assert.deepEqual(bare.regionRenames, { bavaria: "Bayern" });
});
