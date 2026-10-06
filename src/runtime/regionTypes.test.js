/*! Open Historia — region types in the game tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/regionTypes.test.js
//
// The Workshop's Region Types were saved with the map and then ignored: the
// game drew every region in its owner's colour and nothing told the AI a
// region was impassable. These are the game's readings of a type.
import test from "node:test";
import assert from "node:assert/strict";
import { createPropertyExpression, latest } from "@maplibre/maplibre-gl-style-spec";

import {
  normalizeRegionTypes,
  regionTypeFeatureState,
  regionTypeRenderStyle,
  regionTypeRenderStyles,
  regionTypeRules,
  regionTypesHaveRules,
  regionTypeShownAt,
  regionTypeZoomKey,
} from "./regionTypes.js";
import { TYPE_FILL_STATE, withTypeFillOpacity } from "../Game/Map/regionTypePaint.js";
import { DEFAULT_TYPES } from "../Editor/useMapDocument.js";

const land = DEFAULT_TYPES[0];
const sea = {
  ...land,
  id: "sea",
  name: "Sea",
  overrideColor: [20, 60, 140],
  opacity: 0.275,
  passable: false,
};

test("the Workshop's default types change nothing in the game", () => {
  assert.equal(regionTypeRenderStyles(DEFAULT_TYPES).size, 0, "Land and Coastal draw as the game already does");
  assert.equal(regionTypesHaveRules(DEFAULT_TYPES), false);
  assert.equal(regionTypeRules(DEFAULT_TYPES, [{ id: "a", name: "Kent", typeId: "land" }]), "");
  assert.deepEqual(regionTypeFeatureState(null), { typeFill: null, typeOpacity: null, typeStroke: null, typeStrokeScale: null });
});

test("normalizing keeps a type's own settings and extras, fills the missing ones and drops the unusable", () => {
  const types = normalizeRegionTypes([
    { id: "sea", name: "Sea", overrideColor: [20, 60, 300], opacity: "0.3", note: "kept" },
    { id: "sea", name: "Duplicate" },
    { name: "No id" },
    null,
    { id: " hills ", zoomSettings: [{ minZoom: -2, maxZoom: 40 }] },
  ]);
  assert.deepEqual(types.map((type) => type.id), ["sea", "hills"]);
  assert.deepEqual(types[0].overrideColor, [20, 60, 255]);
  assert.equal(types[0].opacity, 0.3);
  assert.equal(types[0].note, "kept", "a round trip through the scenario loses nothing");
  assert.equal(types[0].passable, true);
  assert.deepEqual(types[0].strokeColor, [0, 0, 0]);
  assert.equal(types[1].name, "hills");
  assert.deepEqual(types[1].zoomSettings, [{ minZoom: 0, maxZoom: 24 }]);
  assert.deepEqual(normalizeRegionTypes("nonsense"), []);
});

test("a type's colour, opacity and border become feature-state against the game's own look", () => {
  const style = regionTypeRenderStyle(normalizeRegionTypes([{ ...sea, strokeColor: [255, 0, 0], strokeWidth: 3 }])[0]);
  assert.equal(style.fill, "rgb(20, 60, 140)");
  assert.equal(style.ownedScale, 0.5);
  assert.equal(style.unownedScale, 1);
  assert.equal(style.stroke, "rgba(255, 0, 0, 1)");
  assert.equal(style.strokeScale, 2);

  assert.deepEqual(regionTypeFeatureState(style, { owned: true, zoom: 5 }), {
    typeFill: "rgb(20, 60, 140)", typeOpacity: 0.5, typeStroke: "rgba(255, 0, 0, 1)", typeStrokeScale: 2,
  });
  assert.equal(regionTypeFeatureState(style, { owned: false, zoom: 5 }).typeOpacity, null, "unowned opacity left as Land's");
});

test("a zoom range hides a type outside it, counted in the Workshop's zoom levels", () => {
  const style = regionTypeRenderStyle({ ...land, id: "detail", zoomSettings: [{ minZoom: 6, maxZoom: 24 }] });
  assert.deepEqual(style.bands, [[6, 24]]);
  // Game zoom 5 is the Workshop's 6.
  assert.equal(regionTypeShownAt(style, 4.9), false);
  assert.equal(regionTypeShownAt(style, 5), true);
  assert.deepEqual(regionTypeFeatureState(style, { zoom: 3 }), { typeFill: null, typeOpacity: 0, typeStroke: null, typeStrokeScale: 0 });
  assert.equal(regionTypeFeatureState(style, { zoom: 7 }).typeOpacity, null);

  const styles = new Map([["detail", style], ["sea", regionTypeRenderStyle(sea)]]);
  assert.equal(regionTypeZoomKey(styles, 3), "detail:0;");
  assert.equal(regionTypeZoomKey(styles, 4), regionTypeZoomKey(styles, 3), "no band crossed, nothing to rewrite");
  assert.equal(regionTypeZoomKey(styles, 6), "detail:1;");
});

test("the map's paint reads the state with the game's own values as the fallback", () => {
  const fill = createPropertyExpression(
    ["coalesce", TYPE_FILL_STATE, ["feature-state", "fillColor"], "rgb(88, 98, 110)"],
    latest.paint_fill["fill-color"],
  );
  assert.equal(fill.result, "success", JSON.stringify(fill.value));
  const colour = (state) => fill.value.evaluate({ zoom: 5 }, { properties: {} }, state).toString();
  assert.equal(colour({ fillColor: "rgb(200, 0, 0)" }), "rgba(200,0,0,1)");
  assert.equal(colour({ fillColor: "rgb(200, 0, 0)", typeFill: "rgb(20, 60, 140)" }), "rgba(20,60,140,1)");

  const ramp = ["interpolate", ["linear"], ["zoom"], 2, withTypeFillOpacity(0.5), 8, withTypeFillOpacity(0.7)];
  const opacity = createPropertyExpression(ramp, latest.paint_fill["fill-opacity"]);
  assert.equal(opacity.result, "success", JSON.stringify(opacity.value));
  const at = (state) => opacity.value.evaluate({ zoom: 2 }, { properties: {} }, state);
  assert.equal(at({}), 0.5, "no state is the game's opacity");
  assert.equal(at({ typeOpacity: null }), 0.5);
  assert.equal(at({ typeOpacity: 0.5 }), 0.25);
  assert.equal(at({ typeOpacity: 0 }), 0);
  assert.equal(at({ typeOpacity: 4 }), 1, "never above 1");
});

test("the AI is told a type's movement and placement rules, naming its regions", () => {
  const types = [
    land,
    sea,
    { ...land, id: "hills", name: "Hills", pathfindingSpeed: 0.5 },
    { ...land, id: "roads", name: "Roads", pathfindingSpeed: 2 },
    { ...land, id: "void", name: "The Void", interactable: false },
    { ...land, id: "unused", name: "Unused", passable: false },
  ];
  assert.equal(regionTypesHaveRules(types), true);
  const regions = [
    { id: "r1", name: "North Sea", typeId: "sea" },
    { id: "r2", name: "Irish Sea", typeId: "sea" },
    { id: "r3", name: "Pennines", typeId: "hills" },
    { id: "r4", name: "Via Appia", typeId: "roads" },
    { id: "r5", name: "", typeId: "void" },
    { id: "r6", name: "Kent", typeId: "land" },
  ];
  assert.equal(regionTypeRules(types, regions), [
    "- Sea (2 regions: North Sea, Irish Sea): impassable: no unit enters or crosses these regions, so route around them.",
    "- Hills (1 region: Pennines): slow going: units cross these regions at 0.5 times their usual speed.",
    "- Roads (1 region: Via Appia): fast going: units cross these regions at 2 times their usual speed.",
    "- The Void (1 region: r5): out of play: place no unit and build no structure in these regions.",
  ].join("\n"), "a type no region uses says nothing");

  const many = Array.from({ length: 15 }, (_, index) => ({ id: `s${index}`, name: `Sea ${index}`, typeId: "sea" }));
  assert.match(regionTypeRules([sea], many, { namesPerType: 3 }), /^- Sea \(15 regions: Sea 0, Sea 1, Sea 2, and 12 more\): impassable/);
  assert.match(regionTypeRules([{ ...land, id: "sea", name: "Sea", pathfindingSpeed: 0 }], many.slice(0, 1)), /impassable/, "speed 0 is impassable");
});
