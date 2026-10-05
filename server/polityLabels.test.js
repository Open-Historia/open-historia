import assert from "node:assert/strict";
import test from "node:test";

// Exercise the exact worker-safe label engine used by Political Cartography v2.
import {
  POLITY_LABEL_TIERS,
  buildPolityLabelCollections,
  curveMinZoomForPolityLabelTier,
  selectPolityPointFallbacks,
  summarizePolityLabelDiagnostics,
} from "../src/Game/Map/vnext/polityLabels.js";
// The per-owner geometry the boundary worker hands the label engine.
import { aggregatePolityGeometry } from "../src/Game/Map/vnext/polityGeometry.js";

const surface = (owner, coordinates) => ({
  type: "Feature",
  properties: { owner },
  geometry: { type: "MultiPolygon", coordinates },
});

const box = (owner, west, south, east, north) => surface(owner, [[[
  [west, south], [east, south], [east, north], [west, north], [west, south],
]]]);


const gentleContinentalArc = (owner, offset = 0) => surface(owner, [[[
  [offset + 0, 0],
  [offset + 15, -2],
  [offset + 30, -3],
  [offset + 45, -1],
  [offset + 60, 3],
  [offset + 75, 8],
  [offset + 85, 12],
  [offset + 85, 28],
  [offset + 70, 23],
  [offset + 55, 18],
  [offset + 40, 14],
  [offset + 25, 12],
  [offset + 10, 11],
  [offset + 0, 10],
  [offset + 0, 0],
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

test("curved continental polity keeps one logical label with disjoint point + line presentations", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [gentleContinentalArc("Canada")],
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
  assert.ok(label.properties.estimatedOccupancy >= 0.40);
  assert.ok(label.properties.lineEstimatedOccupancy >= 0.50);
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

  const before = labelFor(aggregatePolityGeometry(regions), "Ukraine");
  const after = labelFor(
    aggregatePolityGeometry(regions, { "border-zone": "Ukraine" }),
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
    assert.ok(entry.minZoom <= 1.75, `${owner} minZoom=${entry.minZoom}`);
    assert.ok(entry.estimatedOccupancy >= 0.52, `${owner} overview occupancy=${entry.estimatedOccupancy}`);
    // CP4.2: meaningful polities receive a stable territorial baseline even when
    // that baseline is geometrically straight. A rectangle should therefore be
    // near-straight, not point-only and not artificially bowed.
    assert.equal(entry.mode, "hybrid", `${owner} should expose a baseline presentation`);
    assert.equal(entry.baselineKind, "near-straight", `${owner} rectangle should remain near-straight`);
    assert.ok(entry.placementBendRatio <= 0.01, `${owner} rectangle bend=${entry.placementBendRatio}`);
    assert.ok(result.lineLabelData.features.some((f) => f.properties.owner === owner));
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

  assert.equal(d.get("United Kingdom").mode, "hybrid",
    "a meaningful compact polity may use a near-straight territorial baseline");
  assert.ok(d.get("United Kingdom").minZoom <= 1.75);
  assert.ok(result.pointLabelData.features.some((f) => f.properties.owner === "United Kingdom"),
    "renderer fallback remains available until the baseline is confirmed");
  assert.ok(result.lineLabelData.features.some((f) => f.properties.owner === "United Kingdom"),
    "the UK should also expose its cartographic baseline");

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

test("CP4 compact diagonal geometry may beat the horizontal readability preference", () => {
  const points = [
    [-1.965, -5.039], [5.407, 0.124], [1.965, 5.039], [-5.407, -0.124], [-1.965, -5.039],
  ].map(([lng, lat]) => [lng + 20, lat + 25]);
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Diagonal", [[points]])],
  });
  const label = byOwner(result, "Diagonal");

  assert.equal(label.properties.mode, "hybrid", "straight diagonal territory should expose its baseline");
  assert.equal(label.properties.baselineKind, "near-straight", "straight diagonal baseline must not invent curvature");
  assert.ok(label.properties.placementBendRatio <= 0.01);
  assert.ok(label.properties.geometryElongation < 1.8, "fixture must sit below the old hard-horizontal threshold");
  assert.ok(Math.abs(label.properties.rotation) >= 25,
    `a clear diagonal interior axis should beat horizontal, rotation=${label.properties.rotation}`);
  assert.equal(label.properties.placementInside, true);
});

test("R6 balanced atlas fit uses a polity's dominant axis without overfilling it", () => {
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
  assert.equal(ukraine.mode, "hybrid", "a straight wide polity should still expose its territorial baseline");
  assert.equal(ukraine.baselineKind, "near-straight");
  assert.ok(ukraine.placementBendRatio <= 0.01, `rectangle Ukraine bend=${ukraine.placementBendRatio}`);
});



test("R7 cartographic baseline trims a corkscrew to a calm interior corridor", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Corkscrew", [[[
      [0, 0], [8, 0], [11, 2], [8, 4], [3, 3], [1, 6],
      [5, 9], [11, 8], [13, 11], [9, 15], [3, 14], [0, 10],
      [2, 7], [-1, 4], [0, 0],
    ]]])],
  });

  const logical = byOwner(result, "Corkscrew");
  assert.equal(logical.properties.mode, "hybrid");
  assert.equal(logical.properties.safeWarp, true);
  assert.ok(result.lineLabelData.features.length === 1);
  assert.ok(logical.properties.warpMaxSegmentTurnDegrees <= 46,
    `trimmed corridor max turn=${logical.properties.warpMaxSegmentTurnDegrees}`);
  assert.ok(logical.properties.warpDetourRatio <= 1.25,
    `trimmed corridor detour=${logical.properties.warpDetourRatio}`);
  assert.ok(logical.properties.placementBendRatio <= 0.105,
    `trimmed corridor bend=${logical.properties.placementBendRatio}`);
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
    assert.ok(line.geometry.coordinates.length >= 5 && line.geometry.coordinates.length <= 7,
      "validated native warp stays bounded to a small territorial spine");
    assert.ok(logical.properties.warpMaxSegmentTurnDegrees <= 32);
    assert.ok(logical.properties.warpDetourRatio <= 1.18);
  } else {
    // Conservative rejection is valid: point persistence is preferable to a
    // risky handoff that can erase the polity on the next zoom step.
    assert.equal(result.lineLabelData.features.length, 0);
    assert.equal(result.pointLabelData.features[0].properties.presentation, "persistent");
  }
});


test("CP4.2 renderer and generator let territorial baselines enter with their polity tier", () => {
  for (const tier of POLITY_LABEL_TIERS) {
    assert.equal(
      curveMinZoomForPolityLabelTier(tier, "standard"),
      Math.max(tier.minZoom + 0.15, tier.minZoom),
    );
    assert.equal(
      curveMinZoomForPolityLabelTier(tier, "early"),
      Math.max(tier.minZoom + 0.10, tier.minZoom),
    );
    assert.equal(
      curveMinZoomForPolityLabelTier(tier, "world"),
      Math.max(tier.minZoom + 0.05, 0.85),
    );
  }
});

test("R8 keeps the point fallback until the warped label is actually rendered", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [gentleContinentalArc("Ukraine")],
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

const region = (id, owner, gid0, west, south, east, north) => ({
  type: "Feature",
  properties: { id, owner, gid0 },
  geometry: {
    type: "Polygon",
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  },
});
const JUTLAND_WEST = region("dk-w", "Kingdom of Denmark", "DNK", 8, 54, 10.5, 58);
const JUTLAND_EAST = region("dk-e", "Kingdom of Denmark", "DNK", 10.5, 54, 13, 58);
const GREENLAND = region("gl", "Kingdom of Denmark", "GRL", -52, 60, -18, 82);
const ownerParts = (result, owner) => result.pointLabelData.features.filter((feature) => (
  feature.properties.labelKind === "territory" && feature.properties.sourceOwner === owner
));

test("R8 keeps the polity's label on its home ground when a dependency is larger", () => {
  const result = buildPolityLabelCollections(
    aggregatePolityGeometry({ type: "FeatureCollection", features: [JUTLAND_WEST, JUTLAND_EAST, GREENLAND] }),
    { nameResolver: () => "DENMARK" },
  );

  assert.equal(result.labelData.features.length, 1, "a dependency must not create a second polity record");
  const denmark = byOwner(result, "Kingdom of Denmark");
  assert.ok(denmark.geometry.coordinates[0] > 0, `DENMARK should anchor on Europe, got ${denmark.geometry.coordinates[0]}`);

  const parts = ownerParts(result, "Kingdom of Denmark");
  assert.equal(parts.length, 1, "Greenland carries the owner's name like any landmass of consequence");
  assert.equal(parts[0].properties.name, "DENMARK");
  assert.equal(parts[0].properties.labelSiteRole, "sovereign-secondary");
  assert.ok(parts[0].geometry.coordinates[0] < -10);
  assert.equal(summarizePolityLabelDiagnostics(result).length, 1, "part labels stay outside polity diagnostics");
});

test("R8 labels every landmass of a union whose name contains another polity's", () => {
  const regions = [
    JUTLAND_WEST,
    JUTLAND_EAST,
    GREENLAND,
    region("no", "Denmark-Norway", "NOR", 5, 59, 31, 71),
    region("is", "Denmark-Norway", "ISL", -17, 63.5, -12, 66.5),
  ].map((feature) => ({ ...feature, properties: { ...feature.properties, owner: "Denmark-Norway" } }));
  const result = buildPolityLabelCollections(
    aggregatePolityGeometry({ type: "FeatureCollection", features: regions }),
    { nameResolver: () => "DENMARK-NORWAY" },
  );

  const core = byOwner(result, "Denmark-Norway");
  assert.ok(core.geometry.coordinates[0] > 7 && core.geometry.coordinates[1] < 58.5,
    `the core label sits on the home ground, got ${core.geometry.coordinates}`);
  const parts = ownerParts(result, "Denmark-Norway");
  const inside = (feature, west, south, east, north) => {
    const [lng, lat] = feature.geometry.coordinates;
    return lng >= west && lng <= east && lat >= south && lat <= north;
  };
  assert.ok(parts.some((feature) => inside(feature, 5, 59, 31, 71)), "Norway carries a label");
  assert.ok(parts.some((feature) => inside(feature, -17, 63.5, -12, 66.5)), "Iceland carries a label");
  assert.ok(parts.some((feature) => inside(feature, -52, 60, -18, 82)), "Greenland carries a label");
  const names = new Set(result.pointLabelData.features.map((feature) => feature.properties.name));
  assert.deepEqual([...names], ["DENMARK-NORWAY"], "no label is named after a hard-coded territory");
});

test("R8 special-cases no polity name: without stock countries the largest landmass is the core", () => {
  const geometry = (owner) => surface(owner, [
    [[[-52, 60], [-18, 60], [-18, 82], [-52, 82], [-52, 60]]],
    [[[8, 54], [13, 54], [13, 58], [8, 58], [8, 54]]],
  ]);
  const denmark = buildPolityLabelCollections({ type: "FeatureCollection", features: [geometry("Kingdom of Denmark")] },
    { nameResolver: () => "NORTHLAND" });
  const other = buildPolityLabelCollections({ type: "FeatureCollection", features: [geometry("Northland")] },
    { nameResolver: () => "NORTHLAND" });

  assert.deepEqual(
    denmark.pointLabelData.features.map((feature) => feature.geometry.coordinates),
    other.pointLabelData.features.map((feature) => feature.geometry.coordinates),
  );
  assert.ok(byOwner(denmark, "Kingdom of Denmark").geometry.coordinates[0] < -10);
});


test("R11 world warping is scale/geometry driven and keeps the R8 point safety net", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      gentleContinentalArc("Continental Alpha", 0),
      gentleContinentalArc("Continental Beta", 90),
    ],
  });
  const d = diagnosticsByOwner(result);

  for (const owner of ["Continental Alpha", "Continental Beta"]) {
    const entry = d.get(owner);
    assert.equal(entry.mode, "hybrid");
    assert.equal(entry.curveBand, "world");
    assert.ok(entry.curveMinZoom <= 1.1);
    assert.ok(entry.warpPointCount >= 5 && entry.warpPointCount <= 7);
    assert.ok(entry.warpMaxSegmentTurnDegrees <= 34);

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
