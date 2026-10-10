/*! Open Historia — basemaps and detailed maps in a suggestion: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/basemapSuggestions.test.js
//
// A player who changes a community scenario's maps can suggest it back. What
// has to hold:
//   - the maps players may switch to (the built-in ones ticked, the scenario's
//     other basemaps of its own) are changes of their own, one per basemap;
//   - the detailed map is a change apart from the basemap under it: either can
//     change without the other;
//   - a suggestion's .zip carries each basemap's payload as a file, and reads
//     it back.

import test from "node:test";
import assert from "node:assert/strict";

import { diffScenarioBundles, summarizeChangesForComment } from "./scenarioChanges.js";
import { buildSuggestion, buildSuggestionZip, readSuggestionFile } from "./scenarioSuggestion.js";
import { sectionOfChange } from "./suggestionSections.js";

const embedded = (data) => ({ mode: "embedded", data });
const DRAWN = { type: "FeatureCollection", features: [{ type: "Feature", properties: { fill: "#335" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] };
const PICTURE = "data:image/png;base64,AAAA";

const bundle = ({ world = {}, assets = {} } = {}) => ({
  schema: "open-historia-scenario-bundle/2",
  scenario: { name: "Westeros", features: {} },
  data: { game: { country: "Stark" }, world: { author: "Ann", background: { kind: "vector" }, ...world } },
  assets: { backgroundData: embedded({ geojson: DRAWN }), ...assets },
});
const mapChanges = (base, next) => diffScenarioBundles(base, next).filter((change) => change.area === "map");

test("a scenario compared with itself has no basemap changes", () => {
  const world = { allowedBasemaps: ["topo"], ownBasemaps: [{ id: "terrain", name: "Terrain", kind: "image" }], background: { kind: "vector", tiled: { id: "got-world", version: 2, name: "Westeros relief" } } };
  const assets = { ownBasemapsData: embedded({ terrain: { dataUrl: PICTURE } }) };
  assert.deepEqual(mapChanges(bundle({ world, assets }), bundle({ world, assets })), []);
});

test("the built-in maps players may switch to are one change, and none is not the default", () => {
  const [ticked] = mapChanges(bundle(), bundle({ world: { allowedBasemaps: ["topo", "imagery"] } }));
  assert.equal(ticked.kind, "allowed-basemaps");
  assert.equal(ticked.from, null);
  assert.deepEqual(ticked.to, ["imagery", "topo"]);
  const [none] = mapChanges(bundle(), bundle({ world: { allowedBasemaps: [] } }));
  assert.deepEqual(none.to, [], "[] (none) is a change from null (the default)");
  assert.equal(sectionOfChange(ticked), "basemaps");
});

test("each of the scenario's other basemaps is added, changed or removed on its own", () => {
  const base = bundle({
    world: { ownBasemaps: [{ id: "political", name: "Political", kind: "image" }, { id: "old", name: "Old", kind: "vector" }] },
    assets: { ownBasemapsData: embedded({ political: { dataUrl: PICTURE }, old: { geojson: DRAWN } }) },
  });
  const next = bundle({
    world: { ownBasemaps: [{ id: "political", name: "Politics", kind: "image" }, { id: "terrain", name: "Terrain", kind: "image" }] },
    assets: { ownBasemapsData: embedded({ political: { dataUrl: PICTURE }, terrain: { dataUrl: "data:image/png;base64,BBBB" } }) },
  });
  const changes = mapChanges(base, next);
  assert.deepEqual(changes.map((change) => change.id).sort(), ["own-basemap-add:terrain", "own-basemap-change:political", "own-basemap-remove:old"]);
  const added = changes.find((change) => change.kind === "own-basemap-add");
  assert.deepEqual(added.to.data, { dataUrl: "data:image/png;base64,BBBB" }, "the payload rides with an added basemap");
  const renamed = changes.find((change) => change.kind === "own-basemap-change");
  assert.equal(renamed.from.name, "Political");
  assert.equal(renamed.to.name, "Politics");
  assert.equal(renamed.from.hash, renamed.to.hash, "a rename keeps the picture");
  assert.ok(changes.every((change) => sectionOfChange(change) === "basemaps"));
});

test("the detailed map changes apart from the basemap under it", () => {
  const onDetailed = (tiled, extra = {}) => bundle({ world: { background: { kind: "vector", tiled, ...extra } } });
  // Put on: the basemap under it is the same, so only the detailed map changes.
  const [on] = mapChanges(bundle(), onDetailed({ id: "got-world", version: 1, name: "Westeros relief" }));
  assert.equal(on.kind, "detailed-map");
  assert.equal(on.from, null);
  assert.deepEqual(on.to, { id: "got-world", version: 1, name: "Westeros relief" });
  assert.equal(sectionOfChange(on), "detailedMap");
  // A newer version, the fill ramp, and taking it off are each a change of it.
  assert.equal(mapChanges(onDetailed({ id: "got-world", version: 1 }), onDetailed({ id: "got-world", version: 2 }))[0].to.version, 2);
  const ramp = mapChanges(onDetailed({ id: "got-world", version: 1 }), onDetailed({ id: "got-world", version: 1 }, { fillOpacity: [[3, 0.2]] }));
  assert.deepEqual(ramp[0].to.fillOpacity, [[3, 0.2]]);
  const [off] = mapChanges(onDetailed({ hash: "ABC", name: "Mine" }), bundle());
  assert.equal(off.to, null);
  assert.equal(off.from.hash, "abc");
  // Only its name moved: no change.
  assert.deepEqual(mapChanges(onDetailed({ id: "got-world", version: 1, name: "A" }), onDetailed({ id: "got-world", version: 1, name: "B" })), []);
  // And a new basemap under the same detailed map is a basemap change alone.
  const other = { type: "FeatureCollection", features: [{ ...DRAWN.features[0], properties: { fill: "#533" } }] };
  const kinds = mapChanges(
    onDetailed({ id: "got-world", version: 1 }),
    { ...onDetailed({ id: "got-world", version: 1 }), assets: { backgroundData: embedded({ geojson: other }) } },
  ).map((change) => change.kind);
  assert.deepEqual(kinds, ["background"]);
});

test("the comment on the post names the basemap changes", () => {
  const changes = mapChanges(
    bundle(),
    bundle({
      world: { allowedBasemaps: ["topo"], ownBasemaps: [{ id: "terrain", name: "Terrain", kind: "image" }], background: { kind: "vector", tiled: { id: "got-world", version: 1 } } },
      assets: { ownBasemapsData: embedded({ terrain: { dataUrl: PICTURE } }) },
    }),
  );
  const lines = summarizeChangesForComment(changes);
  assert.ok(lines.includes("1 change to the other basemaps"));
  assert.ok(lines.includes("Built-in maps players can switch to changed"));
  assert.ok(lines.includes("Detailed map changed"));
});

test("a suggestion's .zip carries each basemap as a file and reads it back", async () => {
  const changes = mapChanges(
    bundle(),
    bundle({
      world: { ownBasemaps: [{ id: "terrain", name: "Terrain", kind: "vector" }], background: { kind: "vector", tiled: { id: "got-world", version: 1 } }, allowedBasemaps: [] },
      assets: { ownBasemapsData: embedded({ terrain: { geojson: DRAWN } }) },
    }),
  );
  const suggestion = buildSuggestion({ changes, scenario: { name: "Westeros" } });
  assert.equal(suggestion.changes.length, 3, "every new kind survives the file's checks");
  const zip = await buildSuggestionZip(suggestion);
  const read = await readSuggestionFile(new Uint8Array(await zip.arrayBuffer()));
  const added = read.changes.find((change) => change.kind === "own-basemap-add");
  assert.deepEqual(added.to.data, { geojson: DRAWN });
  assert.equal(added.to.file, undefined);
  assert.deepEqual(read.changes.find((change) => change.kind === "allowed-basemaps").to, []);
  assert.equal(read.changes.find((change) => change.kind === "detailed-map").to.id, "got-world");
});

test("a basemap named by an id that is not safe is dropped from the file", () => {
  const bad = { id: "own-basemap-add:x", area: "map", kind: "own-basemap-add", key: "../../evil", to: { name: "x", kind: "image", hash: "h" } };
  const proto = { ...bad, id: "own-basemap-add:p", key: "__proto__" };
  assert.deepEqual(buildSuggestion({ changes: [bad, proto], scenario: {} }).changes, []);
});

test("a detailed map among the scenario's maps is a change of its own, named and never carried", async () => {
  const base = bundle({
    world: { ownBasemaps: [{ id: "terrain", name: "Terrain", kind: "vector" }] },
    assets: { ownBasemapsData: embedded({ terrain: { geojson: DRAWN } }) },
  });
  const relief = { id: "relief", name: "Relief", kind: "tiled", tiled: { id: "got-world", version: 2 }, over: "terrain" };
  const next = bundle({
    world: { ownBasemaps: [{ id: "terrain", name: "Terrain", kind: "vector" }, relief] },
    assets: { ownBasemapsData: embedded({ terrain: { geojson: DRAWN } }) },
  });
  const [added] = mapChanges(base, next);
  assert.equal(added.id, "own-basemap-add:relief");
  assert.equal(added.to.kind, "tiled");
  assert.deepEqual(added.to.data, { tiled: { id: "got-world", version: 2 }, over: "terrain" });
  // Shown over another map: a change.
  const moved = bundle({
    world: { ownBasemaps: [{ id: "terrain", name: "Terrain", kind: "vector" }, { ...relief, over: "" }] },
    assets: { ownBasemapsData: embedded({ terrain: { geojson: DRAWN } }) },
  });
  assert.deepEqual(mapChanges(next, moved).map((change) => change.id), ["own-basemap-change:relief"]);
  // Through the .zip and back.
  const zip = await buildSuggestionZip(buildSuggestion({ changes: [added], scenario: { name: "Westeros" } }));
  const read = await readSuggestionFile(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual(read.changes[0].to.data, added.to.data);
});

test("the starting map's name is a map setting of its own", () => {
  const [renamed] = mapChanges(bundle(), bundle({ world: { background: { kind: "vector", name: "Westeros" } } }));
  assert.equal(renamed.kind, "map-field");
  assert.equal(renamed.field, "startingMapName");
  assert.equal(renamed.from, "");
  assert.equal(renamed.to, "Westeros");
});
