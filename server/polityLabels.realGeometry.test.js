/*! Open Historia — production polity-label real-geometry regression harness © 2026 Open Historia contributors, AGPL-3.0-or-later. */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { aggregatePolityGeometry } from "../src/Game/Map/vnext/polityGeometry.js";
import { buildPolityLabelCollections } from "../src/Game/Map/vnext/polityLabels.js";

const MODERN_REGIONS = JSON.parse(
  fs.readFileSync(new URL("./seed/default/regions.geojson", import.meta.url), "utf8"),
);

const REPRESENTATIVE_OWNERS = Object.freeze([
  "United States",
  "Canada",
  "Russia",
  "China",
  "France",
  "Germany",
  "Belarus",
  "Poland",
  "Ukraine",
  "Austria",
  "Slovakia",
  "Hungary",
  "Italy",
  "Norway",
  "Kazakhstan",
  "Denmark",
  "Greece",
  "New Zealand",
  "Chile",
]);

// The text each fixture is laid out with. The seed now calls these countries
// by their common names; the thresholds below were measured on their former
// formal names, which stay the typographic input so every measurement holds.
const LABEL_TEXT = Object.freeze({
  "United States": "United States of America",
  Russia: "Russian Federation",
  China: "People's Republic of China",
  France: "French Republic",
  Germany: "Federal Republic of Germany",
  Belarus: "Republic of Belarus",
  Poland: "Republic of Poland",
  Austria: "Republic of Austria",
  Slovakia: "Slovak Republic",
  Italy: "Italian Republic",
  Norway: "Kingdom of Norway",
  Kazakhstan: "Republic of Kazakhstan",
  Denmark: "Kingdom of Denmark",
  Greece: "Hellenic Republic",
  Chile: "Republic of Chile",
});
const labelText = (owner) => LABEL_TEXT[owner] ?? owner;

const representativeRegions = {
  type: "FeatureCollection",
  features: MODERN_REGIONS.features.filter((feature) => (
    REPRESENTATIVE_OWNERS.includes(String(feature?.properties?.owner ?? ""))
  )),
};

const representativeGeometry = aggregatePolityGeometry(representativeRegions);
const geometryByOwner = new Map(
  representativeGeometry.features.map((feature) => [feature.properties.owner, feature]),
);

const layoutFor = (owner, name = labelText(owner)) => {
  const geometry = geometryByOwner.get(owner);
  assert.ok(geometry, `missing real-geometry fixture for ${owner}`);
  return buildPolityLabelCollections(
    { type: "FeatureCollection", features: [geometry] },
    { nameResolver: () => name },
  );
};

const primaryLabelFor = (collections, owner) => (
  collections.labelData.features.find((feature) => feature?.properties?.owner === owner)
);

const primaryLineFor = (collections, owner) => (
  collections.lineLabelData.features.find((feature) => feature?.properties?.owner === owner)
);


const pointOnSegment = (point, a, b, epsilon = 1e-8) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const px = point[0] - a[0];
  const py = point[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= epsilon * epsilon) {
    return px * px + py * py <= epsilon * epsilon;
  }
  const cross = dx * py - dy * px;
  if (Math.abs(cross) > epsilon * Math.max(1, Math.sqrt(lengthSquared))) return false;
  const dot = px * dx + py * dy;
  return dot >= -epsilon && dot <= lengthSquared + epsilon;
};

const pointInRingState = (point, ring) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[previous];
    const b = ring[index];
    if (pointOnSegment(point, a, b)) return 0;
    if ((a[1] > point[1]) === (b[1] > point[1])) continue;
    const x = a[0] + ((point[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
    if (x > point[0]) inside = !inside;
  }
  return inside ? 1 : -1;
};

const pointInPolygon = (point, polygon) => {
  if (pointInRingState(point, polygon?.[0] ?? []) < 0) return false;
  for (const hole of polygon?.slice(1) ?? []) {
    if (pointInRingState(point, hole) > 0) return false;
  }
  return true;
};

const featurePolygons = (feature) => feature?.geometry?.type === "Polygon"
  ? [feature.geometry.coordinates]
  : feature?.geometry?.type === "MultiPolygon"
    ? feature.geometry.coordinates
    : [];

const pointInOwnerFeature = (point, feature) => {
  for (const longitudeShift of [0, 360, -360]) {
    const shifted = [point[0] + longitudeShift, point[1]];
    if (featurePolygons(feature).some((polygon) => pointInPolygon(shifted, polygon))) return true;
  }
  return false;
};

const lineInsideOwnerFeature = (coordinates, feature) => {
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    for (let sample = 0; sample <= 20; sample += 1) {
      const fraction = sample / 20;
      const point = [
        a[0] + (b[0] - a[0]) * fraction,
        a[1] + (b[1] - a[1]) * fraction,
      ];
      if (!pointInOwnerFeature(point, feature)) return false;
    }
  }
  return true;
};

const screenPxAtZoom = (fontPxAtZoom4, zoom) => (
  Number(fontPxAtZoom4 ?? 0) * (2 ** (zoom - 4))
);

test("real-geometry harness preserves highly fragmented production polity inputs", () => {
  const usa = geometryByOwner.get("United States");
  const china = geometryByOwner.get("China");
  const denmark = geometryByOwner.get("Denmark");

  assert.ok(usa?.properties?.regionCount >= 250, `USA regionCount=${usa?.properties?.regionCount}`);
  assert.ok(usa?.geometry?.coordinates?.length > 64, "USA fixture must exceed the old 64-polygon fitting cap");
  assert.ok(china?.properties?.regionCount >= 180, `China regionCount=${china?.properties?.regionCount}`);
  assert.ok(china?.geometry?.coordinates?.length > 100, "China fixture must preserve real administrative fragmentation");
  assert.ok(denmark?.geometry?.coordinates?.length > 1, "Denmark fixture must include detached landmasses");
});

test("PTR canonical logical records expose deterministic territorial baselines independent of legacy line eligibility", () => {
  const collections = buildPolityLabelCollections(representativeGeometry, { nameResolver: labelText });
  for (const owner of [
    "Russia",
    "China",
    "France",
    "Germany",
    "Belarus",
    "Poland",
    "Ukraine",
  ]) {
    const label = primaryLabelFor(collections, owner);
    assert.ok(label, `missing canonical label for ${owner}`);
    const baseline = label.properties.cartographicBaseline;
    assert.ok(Array.isArray(baseline) && baseline.length >= 2, `${owner} missing canonical PTR baseline`);
    for (const point of baseline) {
      assert.equal(point.length, 2);
      assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]));
    }
  }
});

test("production worker-safe label engine is deterministic on representative real geometry", () => {
  const first = buildPolityLabelCollections(representativeGeometry, { nameResolver: labelText });
  const second = buildPolityLabelCollections(representativeGeometry, { nameResolver: labelText });

  assert.deepEqual(second, first);
  for (const owner of REPRESENTATIVE_OWNERS) {
    assert.ok(primaryLabelFor(first, owner), `missing primary logical label for ${owner}`);
  }
});

test("real-geometry harness exercises the production name resolver", () => {
  const short = layoutFor("China", "CHINA");
  const formal = layoutFor("China", "PEOPLE'S REPUBLIC OF CHINA");

  assert.equal(primaryLabelFor(short, "China")?.properties?.name, "CHINA");
  assert.equal(
    primaryLabelFor(formal, "China")?.properties?.name,
    "PEOPLE'S REPUBLIC OF CHINA",
  );
});

test("CP2 real geometry: short/formal/localized names preserve anchor, axis and spine", () => {
  const variants = [
    ["China", ["CHINA", "PEOPLE'S REPUBLIC OF CHINA", "中华人民共和国"]],
    ["United States", ["USA", "UNITED STATES OF AMERICA"]],
  ];

  for (const [owner, names] of variants) {
    const layouts = names.map((name) => layoutFor(owner, name));
    const baseline = primaryLabelFor(layouts[0], owner);
    const baselineLine = primaryLineFor(layouts[0], owner);
    assert.ok(baseline, `missing baseline logical label for ${owner}`);

    for (let index = 1; index < layouts.length; index += 1) {
      const candidate = primaryLabelFor(layouts[index], owner);
      const candidateLine = primaryLineFor(layouts[index], owner);
      assert.ok(candidate, `missing ${owner} variant ${names[index]}`);
      assert.deepEqual(candidate.geometry, baseline.geometry, `${owner} anchor moved after rename`);
      assert.equal(candidate.properties.rotation, baseline.properties.rotation, `${owner} axis changed after rename`);
      assert.equal(candidate.properties.curveBand, baseline.properties.curveBand, `${owner} curve class changed after rename`);
      assert.equal(candidate.properties.safeWarp, baseline.properties.safeWarp, `${owner} line eligibility changed after rename`);
      assert.equal(candidate.properties.pathLength, baseline.properties.pathLength, `${owner} path length changed after rename`);
      assert.equal(candidate.properties.pathWidth, baseline.properties.pathWidth, `${owner} path width changed after rename`);
      assert.equal(Boolean(candidateLine), Boolean(baselineLine), `${owner} line existence changed after rename`);
      if (baselineLine && candidateLine) {
        assert.deepEqual(candidateLine.geometry, baselineLine.geometry, `${owner} territorial spine changed after rename`);
      }
    }
  }
});

test("CP3 real geometry: selected components are fitted without administrative-piece truncation", () => {
  const checks = [
    ["United States", 200],
    ["China", 150],
    ["Russia", 250],
  ];

  for (const [owner, minimumPieces] of checks) {
    const collections = layoutFor(owner);
    const primary = primaryLabelFor(collections, owner);
    assert.ok(primary, `missing primary label for ${owner}`);
    assert.ok(primary.properties.geometryPieceCount >= minimumPieces,
      `${owner} component should retain real fragmentation, got ${primary.properties.geometryPieceCount}`);
    assert.equal(primary.properties.fittedPieceCount, primary.properties.geometryPieceCount,
      `${owner} fitter dropped component polygons`);
    assert.equal(primary.properties.fittedAreaShare, 1, `${owner} must fit the complete selected component`);
  }
});

test("CP4 real geometry: primary point anchors remain inside owner territory", () => {
  const collections = buildPolityLabelCollections(representativeGeometry, { nameResolver: labelText });
  for (const owner of REPRESENTATIVE_OWNERS) {
    const label = primaryLabelFor(collections, owner);
    const geometry = geometryByOwner.get(owner);
    assert.ok(label, `missing primary label for ${owner}`);
    assert.ok(geometry, `missing owner geometry for ${owner}`);
    assert.equal(
      pointInOwnerFeature(label.geometry.coordinates, geometry),
      true,
      `${owner} anchor escaped owner territory at ${JSON.stringify(label.geometry.coordinates)}`,
    );
    assert.equal(label.properties.placementInside, true, `${owner} did not publish a validated placement`);
  }
});

test("CP4 real geometry: every accepted line path remains inside owner territory", () => {
  const collections = buildPolityLabelCollections(representativeGeometry, { nameResolver: labelText });
  assert.ok(collections.lineLabelData.features.length > 0, "fixture must exercise curved labels");
  for (const line of collections.lineLabelData.features) {
    const owner = String(line?.properties?.sourceOwner ?? line?.properties?.owner ?? "");
    const geometry = geometryByOwner.get(owner);
    assert.ok(geometry, `missing source geometry for line owner ${owner}`);
    assert.equal(
      lineInsideOwnerFeature(line.geometry.coordinates, geometry),
      true,
      `${owner} line path escaped owner territory`,
    );
  }
});

test("CP4.2 real geometry: atlas-style fixtures receive territorial baselines without country-specific rules", () => {
  const owners = [
    "United States",
    "Canada",
    "Russia",
    "China",
    "France",
    "Germany",
    "Belarus",
    "Poland",
    "Ukraine",
    "Austria",
    "Slovakia",
    "Hungary",
    "Italy",
    "Norway",
  ];

  for (const owner of owners) {
    const collections = layoutFor(owner);
    const label = primaryLabelFor(collections, owner);
    const line = primaryLineFor(collections, owner);
    assert.ok(label, `missing primary label for ${owner}`);
    assert.ok(line, `${owner} should expose a territorial baseline`);
    assert.equal(label.properties.safeWarp, true, `${owner} baseline must be renderer-safe`);
    assert.notEqual(label.properties.baselineKind, "point", `${owner} should not collapse to point-only layout`);
    assert.ok(
      label.properties.curveMinZoom <= label.properties.minZoom + 0.16,
      `${owner} baseline should enter with the polity, min=${label.properties.minZoom}, curve=${label.properties.curveMinZoom}`,
    );
  }
});

test("CP4.2 real geometry: subtle European flow and broad continental flow are both preserved", () => {
  const subtle = [
    "Germany",
    "Belarus",
    "Poland",
    "Ukraine",
    "Austria",
    "Slovakia",
    "Hungary",
  ];
  for (const owner of subtle) {
    const label = primaryLabelFor(layoutFor(owner), owner);
    assert.ok(label.properties.placementBendRatio >= 0.012,
      `${owner} should retain visible territorial flow, bend=${label.properties.placementBendRatio}`);
    assert.ok(label.properties.warpMaxSegmentTurnDegrees <= 46,
      `${owner} baseline should stay calm, max turn=${label.properties.warpMaxSegmentTurnDegrees}`);
  }

  const russia = primaryLabelFor(layoutFor("Russia"), "Russia");
  assert.ok(russia.properties.placementBendRatio >= 0.045,
    `Russia should keep a broad continental arc, bend=${russia.properties.placementBendRatio}`);
  assert.ok(russia.properties.pathTurnDegrees >= 20,
    `Russia's baseline should not collapse to a chord, turn=${russia.properties.pathTurnDegrees}`);
  assert.ok(russia.properties.warpMaxSegmentTurnDegrees <= 32,
    `Russia should bend slowly rather than kink, max=${russia.properties.warpMaxSegmentTurnDegrees}`);
});

test("CP4.3 line typography exposes the curved glyph-support span while keeping renderer headroom", () => {
  const owners = [
    "United States",
    "Russia",
    "China",
    "France",
    "Germany",
    "Belarus",
    "Poland",
    "Ukraine",
    "Austria",
    "Slovakia",
    "Hungary",
  ];

  for (const owner of owners) {
    const label = primaryLabelFor(layoutFor(owner), owner);
    assert.ok(label?.properties?.safeWarp, `${owner} must keep a line baseline`);
    assert.ok(label.properties.lineEstimatedOccupancy >= 0.66,
      `${owner} should use enough of the line to expose territorial flow, occupancy=${label.properties.lineEstimatedOccupancy}`);
    assert.ok(label.properties.lineEstimatedOccupancy <= 0.78,
      `${owner} should keep renderer fit headroom, occupancy=${label.properties.lineEstimatedOccupancy}`);
  }

  // The production A/B diagnostic established a hard USA failure at 20px and a
  // successful render at 18px at z2.25. CP4.3 must expose more of the curved
  // support without crossing that known renderer boundary.
  const usa = primaryLabelFor(layoutFor("United States"), "United States");
  assert.ok(screenPxAtZoom(usa.properties.lineFontPxAtZoom4, 2.25) < 18,
    `USA z2.25 line size=${screenPxAtZoom(usa.properties.lineFontPxAtZoom4, 2.25)}`);
});

test("CP4.3 acceptance measures curvature under the actual centered text footprint", () => {
  const expectations = [
    ["United States", 0.045],
    ["Russia", 0.045],
    ["China", 0.045],
    ["France", 0.030],
    ["Germany", 0.030],
    ["Poland", 0.025],
    ["Belarus", 0.018],
    ["Ukraine", 0.018],
    ["Austria", 0.018],
    ["Slovakia", 0.018],
    ["Hungary", 0.018],
  ];

  for (const [owner, minimumBend] of expectations) {
    const label = primaryLabelFor(layoutFor(owner), owner);
    assert.ok(
      label.properties.visibleTextBendRatio >= minimumBend,
      `${owner} visible glyph support is still too straight: ${label.properties.visibleTextBendRatio}`,
    );
  }

  for (const owner of ["United States", "Russia", "China"]) {
    const label = primaryLabelFor(layoutFor(owner), owner);
    assert.ok(label.properties.warpMaxSegmentTurnDegrees <= 32,
      `${owner} world baseline exceeds renderer-safe turn headroom: ${label.properties.warpMaxSegmentTurnDegrees}`);
  }
});

test("CP4.2 containment validator does not treat a duplicated closing vertex as an infinite boundary", () => {
  const concave = {
    type: "Feature",
    properties: { owner: "Concave Fixture" },
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[0, 0], [5, 0], [5, 1], [1, 1], [1, 5], [0, 5], [0, 0]]]],
    },
  };
  const result = buildPolityLabelCollections({ type: "FeatureCollection", features: [concave] });
  const label = primaryLabelFor(result, "Concave Fixture");
  assert.ok(label);
  assert.equal(pointInOwnerFeature(label.geometry.coordinates, concave), true);
  assert.equal(result.lineLabelData.features.length, 0,
    "a diagonal crossing the concave void must not be accepted as an interior baseline");
});

// Remaining geometry-v2 acceptance criteria belong to CP5/CP6.
test.todo("real geometry: equivalent owner surfaces remain stable across administrative subdivision changes");
test.todo("real geometry: overview/detail presentations simplify one placement instead of relocating it");

test("PTR-1.5 publishes a bold typography envelope independent of the conservative legacy corridor", () => {
  const checks = [
    "Russia",
    "China",
    "United States",
    "France",
    "Germany",
  ];
  for (const owner of checks) {
    const label = primaryLabelFor(layoutFor(owner), owner);
    assert.ok(label, `missing ${owner}`);
    assert.ok(label.properties.ptrAxisSpanWorld > 0, `${owner} missing PTR axis span`);
    assert.ok(label.properties.ptrCrossSpanWorld > 0, `${owner} missing PTR cross span`);
    assert.ok(Number.isFinite(label.properties.ptrPreferredAngle), `${owner} missing PTR angle`);
  }

  const france = primaryLabelFor(layoutFor("France"), "France");
  assert.ok(
    Math.abs(france.properties.ptrPreferredAngle) >= 30
      && Math.abs(france.properties.ptrPreferredAngle) <= 48,
    `France should publish a diagonal typography axis, got ${france.properties.ptrPreferredAngle}`,
  );

  const russia = primaryLabelFor(layoutFor("Russia"), "Russia");
  const usa = primaryLabelFor(layoutFor("United States"), "United States");
  const china = primaryLabelFor(layoutFor("China"), "China");
  assert.ok(russia.properties.ptrAxisSpanWorld * 4096 > russia.properties.pathLength,
    "Russia PTR envelope should be broader than the legacy safe corridor");
  assert.ok(usa.properties.ptrAxisSpanWorld * 4096 > usa.properties.pathLength,
    "USA PTR envelope should be broader than the legacy safe corridor");
  assert.ok(china.properties.ptrAxisSpanWorld * 4096 > china.properties.pathLength,
    "China PTR envelope should be broader than the legacy safe corridor");
});

test("PTR-1.6 publishes a bounded ownership coverage field for renderer-side placement scoring", () => {
  for (const owner of [
    "Russia",
    "China",
    "United States",
    "France",
    "Norway",
  ]) {
    const label = primaryLabelFor(layoutFor(owner), owner);
    const grid = label?.properties?.ptrCoverageGrid;
    assert.ok(grid, `${owner} should publish ptrCoverageGrid`);
    assert.equal(grid.resolution, 48, `${owner} grid resolution`);
    assert.equal(grid.rows.length, 48, `${owner} grid rows`);
    assert.ok(grid.rows.some((row) => row.includes("1")), `${owner} grid should contain owned cells`);
    assert.equal(grid.bounds.length, 4, `${owner} grid bounds`);
  }
});

test("PTR-1.8 publishes multiple sovereign sites generically for significant disconnected landmasses", () => {
  const collections = buildPolityLabelCollections(representativeGeometry, { nameResolver: labelText });
  assert.ok(collections.ptrLabelData?.features?.length > collections.labelData.features.length,
    "fixture should expose at least one supplemental sovereign PTR site");

  const sovereignSites = collections.ptrLabelData.features.filter((feature) => (
    ["sovereign-primary", "sovereign-secondary"].includes(feature?.properties?.labelSiteRole)
  ));
  assert.equal(sovereignSites.length, collections.ptrLabelData.features.length,
    "PTR site collection must contain sovereign sites only");
  assert.ok(sovereignSites.some((feature) => feature?.properties?.labelSiteRole === "sovereign-secondary"),
    "fixture must exercise a disconnected secondary sovereign label site");
  for (const site of sovereignSites) {
    assert.ok(String(site?.properties?.sourceOwner ?? "").trim(), "PTR site must retain canonical source owner");
    assert.ok(Number(site?.properties?.ptrAxisSpanWorld) > 0, "PTR site must publish a usable territorial axis");
    assert.ok(Number(site?.properties?.ptrCrossSpanWorld) > 0, "PTR site must publish a usable territorial cross span");
  }
});
