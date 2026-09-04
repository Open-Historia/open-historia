import assert from "node:assert/strict";
import test from "node:test";

import {
  POLITY_LABEL_TIERS,
  buildPolityLabelCollections,
  curveMinZoomForPolityLabelTier,
  selectPolityPointFallbacks,
  summarizePolityLabelDiagnostics,
} from "../src/runtime/countryLabels.js";
import { derivePolitySurfaces } from "../src/Game/Map/vnext/politySurfaces.js";

const surface = (owner, coordinates) => ({
  type: "Feature",
  properties: { owner },
  geometry: { type: "MultiPolygon", coordinates },
});

const box = (owner, west, south, east, north) => surface(owner, [[[
  [west, south], [east, south], [east, north], [west, north], [west, south],
]]]);

const byOwner = (result, owner) => result.labelData.features
  .find((feature) => feature.properties.owner === owner);

const diagnosticsByOwner = (result) => new Map(
  summarizePolityLabelDiagnostics(result).map((entry) => [entry.owner, entry]),
);

test("Map vNext emits one live label for a polity with disconnected landmasses", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Union", [
      [[[0, 0], [12, 0], [12, 3], [0, 3], [0, 0]]],
      [[[30, 0], [31, 0], [31, 1], [30, 1], [30, 0]]],
    ])],
  });

  assert.equal(result.labelData.features.length, 1);
  assert.equal(result.labelData.features[0].properties.owner, "Union");
});

test("one owner remains one label even if malformed input repeats the owner", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Kazakhstan", 45, 40, 88, 56),
      box("Kazakhstan", 70, 44, 78, 49),
    ],
  });

  assert.equal(result.labelData.features.length, 1);
  assert.equal(result.labelData.features[0].properties.owner, "Kazakhstan");
  assert.equal(summarizePolityLabelDiagnostics(result)[0].labelCount, 1);
});

test("Map vNext polity labels use the scenario name and remain inside a concave shape", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Old Name", [[[
      [0, 0], [5, 0], [5, 1], [1, 1], [1, 5], [0, 5], [0, 0],
    ]]])],
  }, { nameResolver: () => "Live Federation" });

  const label = result.labelData.features[0];
  assert.equal(result.labelData.features.length, 1);
  assert.equal(label.properties.name, "LIVE FEDERATION");
  const coordinates = label.geometry.type === "Point"
    ? [label.geometry.coordinates]
    : label.geometry.coordinates;
  assert.ok(coordinates.every(([lng, lat]) => (
    (lng <= 1.001 && lat <= 5.001) || (lng <= 5.001 && lat <= 1.001)
  )));
});

test("Map vNext emits one native whole-word label without detached glyphs", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Arc", [[[
      [-10, 0], [-5, -1], [0, 0], [5, 3], [8, 8], [9, 14],
      [7, 20], [4, 24], [2, 22], [4, 18], [5, 13], [4, 9],
      [2, 5], [-2, 2], [-6, 1], [-10, 2], [-10, 0],
    ]]])],
  }, { nameResolver: () => "Arc Republic" });

  assert.equal(result.labelData.features.length, 1);
  assert.equal(result.labelData.features[0].properties.name, "ARC REPUBLIC");
  assert.equal(result.curvedLabelData.features.length, 0);
  assert.equal(result.glyphLabelData.features.length, 0);
  assert.equal(result.labelData.features[0].geometry.type, "Point");
  assert.ok(["point", "hybrid"].includes(result.labelData.features[0].properties.mode));
  if (result.labelData.features[0].properties.mode === "hybrid") {
    assert.equal(result.lineLabelData.features.length, 1);
    assert.equal(result.labelData.features[0].properties.safeWarp, true);
  }
});

test("Map vNext keeps giant polity geometry stable when the viewport changes", () => {
  const surfaces = {
    type: "FeatureCollection",
    features: [box("Continental Union", -20, 35, 160, 75)],
  };
  const left = buildPolityLabelCollections(surfaces, {
    viewportBounds: { west: 0, south: 40, east: 50, north: 70 },
  });
  const right = buildPolityLabelCollections(surfaces, {
    viewportBounds: { west: 80, south: 40, east: 130, north: 70 },
  });

  assert.deepEqual(left, right);
  assert.ok(left.labelData.features[0].properties.letterSpacing >= 0.05);
});

test("continental polity keeps one logical label with disjoint point + line presentations", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [box("Canada", -140, 45, -52, 70)],
  });

  const label = byOwner(result, "Canada");
  assert.equal(result.labelData.features.length, 1);
  assert.equal(label.geometry.type, "Point");
  assert.equal(label.properties.mode, "hybrid");
  assert.equal(result.lineLabelData.features.length, 1);
  assert.equal(result.pointLabelData.features.length, 1);
  assert.equal(result.pointLabelData.features[0].properties.presentation, "overview");
  assert.equal(result.lineLabelData.features[0].properties.presentation, "detail");
  assert.ok(label.properties.curveMinZoom > label.properties.minZoom);
  assert.ok(label.properties.fitScale > 0);
  assert.ok(label.properties.estimatedOccupancy >= 0.52);
});

test("compact and continental polities both stay one whole-word feature", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Compact", 10, 45, 12, 47),
      box("Continental", -125, 25, -65, 50),
    ],
  });

  assert.deepEqual(
    result.labelData.features.map((feature) => feature.properties.name).sort(),
    ["COMPACT", "CONTINENTAL"],
  );
  assert.equal(result.labelData.features.length, 2);
  assert.equal(result.curvedLabelData.features.length, 0);
  assert.equal(result.glyphLabelData.features.length, 0);
});

test("live polity labels expand when ownership transfers add territory", () => {
  const region = (id, owner, minX, maxX) => ({
    type: "Feature",
    properties: { id, owner },
    geometry: {
      type: "Polygon",
      coordinates: [[[minX, 0], [maxX, 0], [maxX, 4], [minX, 4], [minX, 0]]],
    },
  });
  const regions = {
    type: "FeatureCollection",
    features: [region("ukraine", "Ukraine", 0, 4), region("border-zone", "Russia", 4, 8)],
  };
  const labelFor = (surfaces, owner) => byOwner(buildPolityLabelCollections(surfaces), owner);

  const before = labelFor(derivePolitySurfaces(regions).data, "Ukraine");
  const after = labelFor(
    derivePolitySurfaces(regions, { "border-zone": "Ukraine" }).data,
    "Ukraine",
  );

  assert.ok(after.properties.priorityScale > before.properties.priorityScale);
  assert.ok(after.properties.shapeWidth > before.properties.shapeWidth);
  assert.notEqual(after.properties.fitScale, before.properties.fitScale);
});



test("hybrid presentation never has a zoom gap or simultaneous logical duplicates", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Ukraine", 22, 44, 41, 53),
      box("Russia", 25, 45, 175, 75),
      box("France", -5, 42, 8, 51),
    ],
  });
  const diagnostics = diagnosticsByOwner(result);

  assert.equal(result.labelData.features.length, 3);
  assert.ok([...diagnostics.values()].every((entry) => entry.labelCount === 1));

  for (const entry of diagnostics.values()) {
    assert.ok(entry.minZoom >= 0);
    if (entry.mode === "hybrid") {
      assert.ok(entry.curveMinZoom > entry.minZoom);
      assert.equal(entry.safeWarp, true);
      assert.ok(["world", "early", "standard"].includes(entry.curveBand));
      const point = result.pointLabelData.features.find((f) => f.properties.owner === entry.owner);
      const line = result.lineLabelData.features.find((f) => f.properties.owner === entry.owner);
      assert.ok(point);
      assert.ok(line);
      assert.equal(point.properties.curveMinZoom, line.properties.curveMinZoom);
      assert.equal(point.properties.curveBand, line.properties.curveBand);
      assert.equal(line.properties.safeWarp, true);
      assert.ok((line.geometry.coordinates?.length ?? 0) <= 7,
        `${entry.owner} safe warp should be deliberately simple`);
    } else {
      assert.equal(entry.mode, "point");
      assert.ok(result.pointLabelData.features.some((f) => f.properties.owner === entry.owner));
      assert.ok(!result.lineLabelData.features.some((f) => f.properties.owner === entry.owner));
    }
  }
});

test("regression matrix: large states stretch, Europe enters early, long Congo name stays bounded", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Russia", 25, 45, 175, 75),
      box("Canada", -140, 45, -52, 70),
      box("China", 74, 18, 135, 53),
      box("United States", -125, 25, -66, 49),
      box("Brazil", -74, -34, -34, 5),
      box("Kazakhstan", 46, 40, 88, 56),
      box("Ukraine", 22, 44, 41, 53),
      box("Poland", 14, 49, 24, 55),
      box("Germany", 5, 47, 15, 55),
      box("France", -5, 42, 8, 51),
      box("Democratic Republic of the Congo", 12, -14, 32, 6),
      box("Latvia", 20, 55, 29, 58),
    ],
  });
  const d = diagnosticsByOwner(result);

  assert.equal(result.labelData.features.length, 12);
  assert.ok([...d.values()].every((entry) => entry.labelCount === 1));

  for (const owner of ["Russia", "Canada", "China", "United States", "Kazakhstan"]) {
    const entry = d.get(owner);
    assert.equal(entry.mode, "hybrid", owner);
    assert.ok(entry.minZoom <= 1.75, `${owner} minZoom=${entry.minZoom}`);
    if (["Russia", "Canada", "China", "United States"].includes(owner)) {
      assert.equal(entry.curveBand, "world", `${owner} should use the gentle world warp`);
      assert.ok(entry.curveMinZoom <= 1.1, `${owner} world curveMinZoom=${entry.curveMinZoom}`);
    } else {
      assert.ok(entry.curveMinZoom <= 3.85, `${owner} curveMinZoom=${entry.curveMinZoom}`);
    }
    assert.ok(entry.estimatedOccupancy >= 0.52, `${owner} overview occupancy=${entry.estimatedOccupancy}`);
    assert.ok(entry.lineEstimatedOccupancy >= 0.50, `${owner} line occupancy=${entry.lineEstimatedOccupancy}`);
  }

  for (const owner of ["Ukraine", "Poland", "Germany", "France"]) {
    const entry = d.get(owner);
    assert.ok(entry.minZoom <= 2.45, `${owner} minZoom=${entry.minZoom}`);
  }

  const brazil = d.get("Brazil");
  assert.ok(brazil.minZoom <= 1.75);
  assert.ok(brazil.estimatedOccupancy >= 0.42);

  const drc = d.get("Democratic Republic of the Congo");
  const russia = d.get("Russia");
  assert.notEqual(drc.tier, "continental", `DRC should not outrank short continental names: ${drc.tier}`);
  assert.ok(drc.fontPxAtZoom4 < russia.fontPxAtZoom4 * 0.72,
    `DRC ${drc.fontPxAtZoom4}px vs Russia ${russia.fontPxAtZoom4}px`);

  const latvia = d.get("Latvia");
  assert.ok(latvia.minZoom <= 3.25);
});

test("high-zoom compact-state policy keeps the UK robust and microstates geographically modest", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("United Kingdom", -8, 49, 2, 59),
      box("Bosnia and Herzegovina", 15.7, 42.5, 19.7, 45.3),
      box("Transnistria", 28.5, 46, 30.2, 48.2),
      box("Luxembourg", 5.7, 49.4, 6.6, 50.2),
      box("Liechtenstein", 9.47, 47.05, 9.64, 47.28),
      box("San Marino", 12.4, 43.89, 12.52, 43.99),
      box("Poland", 14, 49, 24, 55),
    ],
  });
  const d = diagnosticsByOwner(result);

  assert.equal(d.get("United Kingdom").mode, "point",
    "compact major powers must never disappear behind a line-label handoff");
  assert.ok(d.get("United Kingdom").minZoom <= 1.75);

  for (const owner of ["Bosnia and Herzegovina", "Transnistria", "Luxembourg", "Liechtenstein", "San Marino"]) {
    const entry = d.get(owner);
    assert.equal(entry.mode, "point", `${owner} should not become a curved banner`);
    assert.ok(entry.fontPxAtZoom4 < d.get("Poland").fontPxAtZoom4 * 0.45,
      `${owner} ${entry.fontPxAtZoom4}px should stay subordinate to Poland ${d.get("Poland").fontPxAtZoom4}px`);
  }

  assert.ok(d.get("Liechtenstein").fontPxAtZoom4 < 1);
  assert.ok(d.get("San Marino").fontPxAtZoom4 < 1);
});

test("continental tracking stays cohesive instead of spending the whole territory on gaps", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Russia", 25, 45, 175, 75),
      box("Canada", -140, 45, -52, 70),
      box("China", 74, 18, 135, 53),
    ],
  });
  const d = diagnosticsByOwner(result);

  assert.ok(d.get("Russia").letterSpacing <= 1.55);
  assert.ok(d.get("Canada").letterSpacing <= 1.55);
  assert.ok(d.get("China").letterSpacing <= 1.55);
  assert.ok(d.get("Russia").estimatedOccupancy >= 0.50);
});

test("R6 balanced Pax fit uses a polity's dominant axis without overfilling it", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Germany", 5, 47, 11, 57),
      box("Ukraine", 24, 45, 36, 51),
      box("Liechtenstein", 9.47, 47.05, 9.64, 47.28),
    ],
  });
  const d = diagnosticsByOwner(result);
  const germany = d.get("Germany");
  const ukraine = d.get("Ukraine");
  const liechtenstein = d.get("Liechtenstein");

  assert.ok(germany.axisSpan > germany.shapeWidth * 1.2,
    `Germany axis ${germany.axisSpan} should exceed horizontal bbox ${germany.shapeWidth}`);
  assert.ok(Math.abs(germany.rotation ?? 0) >= 60,
    `Germany should read vertically/diagonally, rotation=${germany.rotation}`);
  assert.ok(germany.estimatedOccupancy >= 0.68 && germany.estimatedOccupancy <= 0.80,
    `Germany should strongly fill, but not overfill, its dominant span: ${germany.estimatedOccupancy}`);
  assert.ok(ukraine.estimatedOccupancy >= 0.68 && ukraine.estimatedOccupancy <= 0.80,
    `Ukraine should strongly fill, but not overfill, its east-west span: ${ukraine.estimatedOccupancy}`);
  assert.ok(liechtenstein.fontPxAtZoom4 < 1,
    `microstate sizing must remain subordinate, got ${liechtenstein.fontPxAtZoom4}px`);
});

test("R6 close-zoom guarantee is separate from initial visibility", () => {
  const byTier = new Map(POLITY_LABEL_TIERS.map((tier) => [tier.id, tier]));
  for (const id of ["regional", "small", "local"]) {
    const tier = byTier.get(id);
    assert.ok(tier.forceOverlapZoom > tier.minZoom, `${id} should collide normally before close zoom`);
    assert.ok(tier.forceOverlapZoom < 7.1, `${id} must eventually receive a guaranteed close label`);
  }
  assert.equal(byTier.get("continental").forceOverlapZoom, byTier.get("continental").minZoom);
  assert.equal(byTier.get("major").forceOverlapZoom, byTier.get("major").minZoom);
});

test("R6 dampens extreme long-thin point labels and restores safe warping", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Norway", 4, 58, 9, 71),
      box("Sweden", 11, 56, 22, 69),
      box("Ukraine", 22, 44, 41, 53),
    ],
  });
  const d = diagnosticsByOwner(result);
  const norway = d.get("Norway");
  const sweden = d.get("Sweden");
  const ukraine = d.get("Ukraine");

  assert.ok(norway.targetOccupancy < sweden.targetOccupancy,
    `long-thin Norway should be damped (${norway.targetOccupancy}) below Sweden (${sweden.targetOccupancy})`);
  assert.ok(norway.fontPxAtZoom4 < sweden.fontPxAtZoom4 * 1.45,
    `Norway should not become a giant banner: ${norway.fontPxAtZoom4}px vs ${sweden.fontPxAtZoom4}px`);
  assert.equal(ukraine.mode, "hybrid", "a wide, smooth polity should retain native territory-following text");
  assert.ok(ukraine.lineEstimatedOccupancy >= 0.50 && ukraine.lineEstimatedOccupancy <= 0.72);
});



test("R7 safe-warp handoff never creates a line for a renderer-risky corkscrew", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Corkscrew", [[[
      [0, 0], [8, 0], [11, 2], [8, 4], [3, 3], [1, 6],
      [5, 9], [11, 8], [13, 11], [9, 15], [3, 14], [0, 10],
      [2, 7], [-1, 4], [0, 0],
    ]]])],
  });

  const logical = byOwner(result, "Corkscrew");
  assert.equal(logical.properties.mode, "point");
  assert.equal(logical.properties.safeWarp, false);
  assert.equal(logical.properties.curveBand, "none");
  assert.equal(result.lineLabelData.features.length, 0);
  assert.equal(result.pointLabelData.features[0].properties.presentation, "persistent");
});

test("R7 simplified native warp is bounded to seven points and gentle turns", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Longland", [[[
      [0, 0], [12, -1], [25, 0], [38, 3], [50, 7], [62, 8],
      [70, 6], [70, 15], [60, 17], [48, 15], [36, 11], [24, 8],
      [12, 7], [0, 8], [0, 0],
    ]]])],
  });

  const logical = byOwner(result, "Longland");
  if (logical.properties.mode === "hybrid") {
    const line = result.lineLabelData.features[0];
    assert.equal(logical.properties.safeWarp, true);
    if (logical.properties.curveBand === "world") {
      assert.equal(line.geometry.coordinates.length, 3);
    } else {
      assert.ok(line.geometry.coordinates.length >= 5 && line.geometry.coordinates.length <= 7);
    }
    assert.ok(logical.properties.warpMaxSegmentTurnDegrees <= 32);
    assert.ok(logical.properties.warpDetourRatio <= 1.18);
  } else {
    // Conservative rejection is valid: point persistence is preferable to a
    // risky handoff that can erase the polity on the next zoom step.
    assert.equal(result.lineLabelData.features.length, 0);
    assert.equal(result.pointLabelData.features[0].properties.presentation, "persistent");
  }
});


test("R11 renderer and generator share world/early/standard curve thresholds", () => {
  for (const tier of POLITY_LABEL_TIERS) {
    assert.equal(curveMinZoomForPolityLabelTier(tier, "standard"), tier.curveMinZoom);
    assert.equal(
      curveMinZoomForPolityLabelTier(tier, "early"),
      Math.max(tier.minZoom + 0.75, tier.curveMinZoom - 0.55),
    );
    assert.equal(
      curveMinZoomForPolityLabelTier(tier, "world"),
      Math.max(tier.minZoom + 0.15, 0.95),
    );
  }
});


test("R8 keeps the point fallback until the warped label is actually rendered", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [box("Ukraine", 22, 44, 41, 53)],
  });
  const logical = byOwner(result, "Ukraine");
  assert.equal(logical.properties.mode, "hybrid");

  const withoutRenderedWarp = selectPolityPointFallbacks(result.pointLabelData, new Set());
  assert.equal(withoutRenderedWarp.features.some((feature) => feature.properties.owner === "Ukraine"), true);

  const withRenderedWarp = selectPolityPointFallbacks(result.pointLabelData, new Set(["Ukraine"]));
  assert.equal(withRenderedWarp.features.some((feature) => feature.properties.owner === "Ukraine"), false);
});

test("R8 never removes point-persistent labels when another polity warps", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Finland", 20, 59, 32, 70),
      box("Ukraine", 22, 44, 41, 53),
    ],
  });
  const selected = selectPolityPointFallbacks(result.pointLabelData, new Set(["Ukraine"]));
  assert.equal(selected.features.some((feature) => feature.properties.owner === "Finland"), true);
});

test("R8 keeps DENMARK on its core and adds GREENLAND as a territory label", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Kingdom of Denmark", [
      [[[-52, 60], [-18, 60], [-18, 82], [-52, 82], [-52, 60]]],
      [[[8, 54], [13, 54], [13, 58], [8, 58], [8, 54]]],
    ])],
  }, { nameResolver: () => "DENMARK" });

  assert.equal(result.labelData.features.length, 1, "territory labels must not create a second polity record");
  const denmark = byOwner(result, "Kingdom of Denmark");
  assert.ok(denmark.geometry.coordinates[0] > 0, `DENMARK should anchor on Europe, got ${denmark.geometry.coordinates[0]}`);

  const greenland = result.pointLabelData.features.find((feature) => feature.properties.labelKind === "territory");
  assert.ok(greenland, "GREENLAND supplemental territory label should exist");
  assert.equal(greenland.properties.name, "GREENLAND");
  assert.ok(greenland.geometry.coordinates[0] < -10);
  assert.equal(summarizePolityLabelDiagnostics(result).length, 1, "territory labels stay outside polity diagnostics");
});


test("R11 world warping is scale/geometry driven and keeps the R8 point safety net", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("Continental Alpha", 0, 0, 85, 26),
      box("Continental Beta", 100, 5, 180, 33),
    ],
  });
  const d = diagnosticsByOwner(result);

  for (const owner of ["Continental Alpha", "Continental Beta"]) {
    const entry = d.get(owner);
    assert.equal(entry.mode, "hybrid");
    assert.equal(entry.curveBand, "world");
    assert.ok(entry.curveMinZoom <= 1.1);
    assert.equal(entry.warpPointCount, 3);
    assert.ok(entry.warpMaxSegmentTurnDegrees <= 42);

    const beforeRender = selectPolityPointFallbacks(result.pointLabelData, new Set());
    assert.ok(beforeRender.features.some((feature) => feature.properties.owner === owner));

    const afterRender = selectPolityPointFallbacks(result.pointLabelData, new Set([owner]));
    assert.ok(!afterRender.features.some((feature) => feature.properties.owner === owner));
  }
});

test("R12 a detached landmass of consequence carries the owner's name", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("United States", [
      [[[-125, 25], [-66, 25], [-66, 49], [-125, 49], [-125, 25]]],
      [[[-168, 55], [-141, 55], [-141, 71], [-168, 71], [-168, 55]]],
      [[[-160, 19], [-159.8, 19], [-159.8, 19.2], [-160, 19.2], [-160, 19]]],
    ])],
  });

  assert.equal(result.labelData.features.length, 1, "one logical record per polity");
  const core = byOwner(result, "United States");
  assert.ok(core.geometry.coordinates[0] > -130 && core.geometry.coordinates[1] < 50,
    `the logical label stays on the contiguous mainland, got ${core.geometry.coordinates}`);

  const parts = result.pointLabelData.features.filter((feature) => feature.properties.labelKind === "territory");
  assert.equal(parts.length, 1, "Alaska gets one owner label; the speck island gets none");
  assert.equal(parts[0].properties.name, "UNITED STATES");
  assert.equal(parts[0].properties.sourceOwner, "United States");
  assert.ok(parts[0].geometry.coordinates[0] < -140 && parts[0].geometry.coordinates[1] > 55);
  assert.equal(summarizePolityLabelDiagnostics(result).length, 1, "part labels stay outside polity diagnostics");
});

test("R12 the label anchors on the landmass with the most ground, not the most mercator", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Canada", [
      [[[-140, 48], [-60, 48], [-60, 62], [-140, 62], [-140, 48]]],
      [[[-90, 76], [-62, 76], [-62, 83], [-90, 83], [-90, 76]]],
    ])],
  });

  const label = byOwner(result, "Canada");
  assert.ok(label.geometry.coordinates[1] < 70,
    `Canada should anchor on the mainland, got lat ${label.geometry.coordinates[1]}`);
  assert.ok(Math.abs(label.properties.rotation) < 10,
    `a wide mainland reads horizontally, rotation=${label.properties.rotation}`);
  const arctic = result.pointLabelData.features.find((feature) => feature.properties.labelKind === "territory");
  assert.ok(arctic && arctic.geometry.coordinates[1] > 76, "the Arctic landmass carries a CANADA label of its own");
});

test("R12 compact shapes read horizontally; long shapes follow their own axis", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      box("China", 74, 18, 135, 53),
      box("Chile", -75.5, -55, -67, -17),
    ],
  });
  const d = diagnosticsByOwner(result);
  assert.ok(Math.abs(d.get("China").rotation) < 10, `China rotation=${d.get("China").rotation}`);
  assert.ok(Math.abs(d.get("Chile").rotation) > 75, `Chile rotation=${d.get("Chile").rotation}`);
});
