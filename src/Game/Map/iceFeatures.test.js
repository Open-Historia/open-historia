/*! Open Historia — frozen water as the map marks it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/iceFeatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import { featureIdsOf, iceFilters, iceRegionIds, regionIdExpression, regionIdFilter } from "./iceFeatures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").split("\r\n").join("\n");

test("the frozen water is drawn as ice, and the water that could freeze is not marked", () => {
  const world = { frozen: ["lake-ladoga", "gulf-of-finland", " lake-ladoga ", "", null], freezing: ["lake-ladoga", "gulf-of-finland", "lake-onega", "white-sea"] };
  assert.deepEqual(iceRegionIds(world), { frozen: ["gulf-of-finland", "lake-ladoga"] });
  // Water the last turn left frozen is ice even where the scenario no longer lists it as freezing.
  assert.deepEqual(iceRegionIds({ frozen: ["old-lake"] }), { frozen: ["old-lake"] });
  assert.deepEqual(iceRegionIds(), { frozen: [] });
});

test("the regions are picked out by their id, as the map's region sources key them", () => {
  assert.deepEqual(regionIdExpression(), ["to-string", ["coalesce", ["get", "id"], ["get", "GID_1"], ""]]);
  assert.notEqual(regionIdExpression(), regionIdExpression(), "made anew each time, since the map keeps what it is handed");
  assert.deepEqual(regionIdFilter(["b", "a", "b"]), ["match", regionIdExpression(), ["b", "a"], true, false]);
  assert.deepEqual(regionIdFilter(["a", "b"], ["b"]), ["match", regionIdExpression(), ["a"], true, false]);
  assert.equal(regionIdFilter(["a"], ["a"]), null);
  assert.equal(regionIdFilter([]), null);
  assert.equal(regionIdFilter(undefined), null);
});

test("a region the map repaired is iced on the repair, where it is drawn, and not on its own broken shape", () => {
  const filters = iceFilters({ frozen: ["lake", "sea"], repaired: ["sea", "elsewhere"] });
  assert.deepEqual(filters.frozen.own, ["match", regionIdExpression(), ["lake"], true, false]);
  assert.deepEqual(filters.frozen.repair, ["match", regionIdExpression(), ["sea"], true, false]);
  assert.deepEqual(iceFilters({ frozen: ["lake"] }).frozen, { own: ["match", regionIdExpression(), ["lake"], true, false], repair: null });
  // The ids the repair source holds, read from its data.
  assert.deepEqual(featureIdsOf({ features: [{ properties: { id: "sea" } }, { properties: { GID_1: "RUS.1_1" } }, { id: 7 }, { properties: { id: "sea" } }, null] }), ["7", "RUS.1_1", "sea"]);
  assert.deepEqual(featureIdsOf(null), []);
});

test("the ice lies over the season's tint and under the borders, on the regions' own sources, and the scene mounts it", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const layers = ["ice-fill", "ice-fill-repair", "ice-cracks", "ice-cracks-repair", "ice-cracks-b", "ice-cracks-b-repair", "ice-edge", "ice-edge-repair"];
  for (const id of layers) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...layers].sort((a, b) => index(a) - index(b)), layers);
  for (const id of layers) {
    assert.ok(index(id) > index("custom-regions-fill") && index(id) > index("custom-regions-repair-fill"), "over the water's own fill");
    assert.ok(index(id) > index("seasons-tint") && index(id) < index("war-walls-rubble") && index(id) < index("polity-boundaries-shadow"));
  }
  const component = read("IceLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]), layers, "every layer it declares is in the order, and no other");
  assert.match(component, /const OWN = "custom-regions-source";/);
  assert.match(component, /const REPAIR = "custom-regions-repair-source";/);
  // A thin tint the basemap shows through, and two tiles of cracks over it.
  assert.match(component, /const ICE_PAINT = \{ "fill-color": ICE_TINT, "fill-opacity": 0\.3 \};/);
  assert.match(component, /"fill-pattern": iceImageId\(layer\)/);
  // The ice is shown whatever the switch says, and water that could freeze is not marked at all.
  assert.doesNotMatch(component, /hint|freezingRegions|seasonsWeather/);
  assert.ok(!MAP_LAYER_ORDER.some((id) => /ice-hint/.test(id)));
  assert.match(component, /map\.on\("styleimagemissing", asked\);/);
  assert.match(read("MapScene.jsx"), /<SeasonLayers isGlobe=\{isGlobe\} \/>\s*<IceLayers \/>/);
  // Nations.jsx still keys its regions the way the ice picks them out.
  assert.match(read("Nations.jsx"), /const SCENARIO_REGION_ID_EXPRESSION = \["to-string", \["coalesce", \["get", "id"\], \["get", "GID_1"\], ""\]\];/);
  assert.match(read("Nations.jsx"), /id="custom-regions-source"/);
  assert.match(read("Nations.jsx"), /id="custom-regions-repair-source"/);
});
