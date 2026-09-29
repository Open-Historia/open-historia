// Run: node --test src/Game/AI/promptContext.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// What the prompt builders choose to show when a list is longer than its
// budget: the things the turn is about come first, and a cut says so.
import test from "node:test";
import assert from "node:assert/strict";

import { buildPromptContext } from "./promptContext.js";

const game = { country: "Ruritania", gameDate: "1930-05-12", round: 4, startDate: "1930-01-01" };

test("marker attention reads the queued orders, not the answered ones", async () => {
  const markers = Array.from({ length: 60 }, (_, index) => ({
    id: `m${index}`,
    name: `Depot ${String.fromCharCode(65 + (index % 26))}${Math.floor(index / 26)}x`,
    kind: "depot",
    status: "active",
    lat: 50,
    lng: 10,
  }));
  markers.push({ id: "kiel", name: "Kiel Canal", kind: "canal", status: "active", lat: 54.3, lng: 10.1 });
  // Ten answered orders, each naming another marker, after the one queued
  // order that names the canal: a window of the last ten actions used to be
  // all answered ones.
  const actions = [
    { id: "a-live", title: "Widen the Kiel Canal", text: "Widen the Kiel Canal for the new cruisers.", status: "planned" },
    ...markers.slice(0, 10).map((marker, index) => ({
      id: `a-old-${index}`,
      title: `Inspect ${marker.name}`,
      text: `Inspect ${marker.name}.`,
      status: "resolved",
    })),
  ];
  const context = await buildPromptContext({
    game,
    world: { markers, language: "English" },
    events: [],
    actions,
    chats: [],
  }, { requiredKeys: ["markersSummary"], taskKey: "advisor" });
  assert.match(context.markersSummary, /Kiel Canal/);
});
