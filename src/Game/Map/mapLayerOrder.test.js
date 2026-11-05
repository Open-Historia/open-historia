import test from "node:test";
import assert from "node:assert/strict";
import { MAP_LAYER_ORDER, buildEffectiveMapLayerOrder, enforceMapLayerOrder } from "./mapLayerOrder.js";

const index = (id) => MAP_LAYER_ORDER.indexOf(id);

test("political fills and borders remain below cities markers and units", () => {
  for (const political of [
    "regions-fill",
    "custom-regions-fill-far",
    "custom-regions-repair-fill-far",
    "custom-regions-fill",
    "custom-regions-repair-fill",
    "ownership-transition-flood",
    "ownership-transition-sweep-fill",
    "polity-boundaries-shadow",
    "polity-boundaries",
  ]) {
    assert.ok(index(political) >= 0, `${political} is missing from canonical order`);
    assert.ok(index(political) < index("cities-shapes"));
    assert.ok(index(political) < index("cities-capitals"));
    assert.ok(index(political) < index("cities-labels"));
    assert.ok(index(political) < index("markers-shapes-strategic"));
    assert.ok(index(political) < index("units-fill"));
  }
});

test("sovereign polity boundaries remain above political fills", () => {
  assert.ok(index("polity-boundaries-shadow") > index("custom-regions-disputed-vnext"));
  assert.ok(index("polity-boundaries") > index("polity-boundaries-shadow"));
  assert.ok(index("polity-boundaries") > index("regions-fill"));
});

test("late political fills are deterministically moved underneath existing object layers", () => {
  let order = [
    "basemap",
    "polity-boundaries",
    "cities-shapes",
    "cities-capitals",
    "cities-labels",
    "units-fill",
    "custom-regions-fill",
  ];
  const layers = new Set(order);
  const map = {
    getLayer: (id) => layers.has(id) ? { id } : undefined,
    getLayersOrder: () => [...order],
    getStyle: () => ({ layers: order.map((id) => ({ id })) }),
    moveLayer: (id) => {
      order = order.filter((item) => item !== id);
      order.push(id);
    },
  };

  assert.equal(enforceMapLayerOrder(map), true);
  assert.deepEqual(order, [
    "basemap",
    "custom-regions-fill",
    "polity-boundaries",
    "cities-shapes",
    "cities-capitals",
    "cities-labels",
    "units-fill",
  ]);
  assert.equal(enforceMapLayerOrder(map), false);
});

test("NatGeo reference lines and labels are promoted above political fills but below OH polity typography", () => {
  const styleLayers = [
    { id: "basemap-fill" },
    { id: "natgeo-road", metadata: { "openhistoria:natgeo-reference-tier": "line" } },
    { id: "natgeo-admin1-label", metadata: { "openhistoria:natgeo-reference-tier": "label" } },
  ];
  const map = { getStyle: () => ({ layers: styleLayers }) };
  const effective = buildEffectiveMapLayerOrder(map);
  assert.ok(effective.indexOf("natgeo-road") > effective.indexOf("custom-regions-disputed-vnext"));
  assert.ok(effective.indexOf("natgeo-road") < effective.indexOf("polity-boundaries-shadow"));
  assert.ok(effective.indexOf("natgeo-admin1-label") > effective.indexOf("polity-boundaries"));
  assert.ok(effective.indexOf("natgeo-admin1-label") < effective.indexOf("country-curved-labels"));
  assert.ok(effective.indexOf("natgeo-admin1-label") < effective.indexOf("polity-text-renderer"));
});

test("layer-order enforcement physically promotes tagged NatGeo references out from under fills", () => {
  let order = [
    "basemap-fill",
    "natgeo-road",
    "natgeo-city",
    "custom-regions-fill",
    "custom-regions-disputed-vnext",
    "polity-boundaries-shadow",
    "polity-boundaries",
    "polity-text-renderer",
    "cities-labels",
  ];
  const styleLayers = [
    { id: "basemap-fill" },
    { id: "natgeo-road", metadata: { "openhistoria:natgeo-reference-tier": "line" } },
    { id: "natgeo-city", metadata: { "openhistoria:natgeo-reference-tier": "label" } },
  ];
  const layers = new Set(order);
  const map = {
    getLayer: (id) => layers.has(id) ? { id } : undefined,
    getLayersOrder: () => [...order],
    getStyle: () => ({ layers: styleLayers }),
    moveLayer: (id) => {
      order = order.filter((item) => item !== id);
      order.push(id);
    },
  };

  assert.equal(enforceMapLayerOrder(map), true);
  assert.ok(order.indexOf("natgeo-road") > order.indexOf("custom-regions-disputed-vnext"));
  assert.ok(order.indexOf("natgeo-road") < order.indexOf("polity-boundaries-shadow"));
  assert.ok(order.indexOf("natgeo-city") > order.indexOf("polity-boundaries"));
  assert.ok(order.indexOf("natgeo-city") < order.indexOf("polity-text-renderer"));
});

test("a battlefield's taken ground lies over the fills and under the borders, its paths under the labels, its troops under the units", () => {
  const paint = [...Array.from({ length: 12 }, (_, slot) => `fronts-paint-under-${slot}`), ...Array.from({ length: 12 }, (_, slot) => `fronts-paint-${slot}`)];
  assert.ok(index("fronts-paint-under-11") < index("fronts-paint-0"), "every picture is cleared before any is coloured");
  const ground = ["fronts-arrows-past", "fronts-arrows-shadow", "fronts-arrows-edge", "fronts-arrows"];
  const troops = ["fronts-sides", "fronts-sides-count", "fronts-troops-dug", "fronts-troops", "fronts-troops-kind", "fronts-troops-name"];
  for (const id of [...paint, ...ground, ...troops]) assert.ok(index(id) >= 0, `${id} is missing from canonical order`);
  for (const id of paint) {
    assert.ok(index(id) > index("custom-regions-fill"));
    assert.ok(index(id) > index("custom-regions-disputed-vnext"));
    assert.ok(index(id) > index("ownership-transition-sweep-fill"));
    assert.ok(index(id) < index("polity-boundaries-shadow"), "a border is still seen across taken ground");
  }
  for (const id of ground) {
    assert.ok(index(id) > index("polity-boundaries"));
    assert.ok(index(id) > index("group-areas-outline"));
    assert.ok(index(id) < index("units-heading"));
    assert.ok(index(id) < index("country-curved-labels"));
    assert.ok(index(id) < index("polity-text-renderer"));
    assert.ok(index(id) < index("cities-shapes"));
  }
  assert.deepEqual([...ground].sort((a, b) => index(a) - index(b)), ground);
  for (const id of troops) {
    assert.ok(index(id) > index("cities-labels"));
    assert.ok(index(id) > index("markers-labels-local"));
    assert.ok(index(id) < index("units-fill"));
  }
  assert.deepEqual([...troops].sort((a, b) => index(a) - index(b)), troops);
  assert.equal(new Set(MAP_LAYER_ORDER).size, MAP_LAYER_ORDER.length, "no layer is listed twice");
});

test("PTR-0 polity text renderer stays above legacy polity labels and below cities", () => {
  assert.ok(index("polity-text-renderer") > index("country-labels"));
  assert.ok(index("polity-text-renderer") < index("cities-shapes"));
  assert.ok(index("polity-text-renderer") < index("cities-capitals"));
  assert.ok(index("polity-text-renderer") < index("cities-labels"));
});
