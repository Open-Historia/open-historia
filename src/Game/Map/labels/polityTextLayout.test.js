import test from "node:test";
import assert from "node:assert/strict";
import {
  POLITY_TEXT_FADE_OUT_START_ZOOM,
  POLITY_TEXT_MAX_ZOOM,
  POLITY_TEXT_VISUAL_SCALE,
  PTR_WORLD_PIXELS_AT_REFERENCE_ZOOM,
  planMetricTextSupport,
  polityTextOpacityAtZoom,
  scalePolityTextSupportPoints,
} from "./polityTextLayout.js";

test("PTR-1 metric support uses one uniform scale derived from real raster metrics", () => {
  const plan = planMetricTextSupport({
    rasterWidthPx: 1200,
    rasterFontSizePx: 120,
    requestedFontPxAtZoom4: 60,
    baselineLength: 1,
    minSupportFraction: 0,
  });
  const expectedScale = (60 / 120) / PTR_WORLD_PIXELS_AT_REFERENCE_ZOOM;
  assert.ok(Math.abs(plan.worldUnitsPerRasterPixel - expectedScale) < 1e-15);
  assert.ok(Math.abs(plan.supportLength - 1200 * expectedScale) < 1e-15);
  assert.ok(Math.abs(plan.effectiveFontPxAtZoom4 - 60) < 1e-9);
});

test("PTR-1 metric support uniformly shrinks text when the legal baseline is shorter", () => {
  const plan = planMetricTextSupport({
    rasterWidthPx: 2000,
    rasterFontSizePx: 100,
    requestedFontPxAtZoom4: 100,
    baselineLength: 0.08,
    maxSupportFraction: 0.9,
  });
  assert.ok(Math.abs(plan.supportLength - 0.072) < 1e-12);
  assert.ok(plan.effectiveFontPxAtZoom4 < 100);
  assert.ok(plan.worldUnitsPerRasterPixel * 2000 <= 0.072 + 1e-12);
});


test("PTR-1.4 expands under-filled typography to use most of the legal polity baseline", () => {
  const plan = planMetricTextSupport({
    rasterWidthPx: 1000,
    rasterFontSizePx: 100,
    requestedFontPxAtZoom4: 20,
    baselineLength: 0.1,
    minSupportFraction: 0.86,
    maxSupportFraction: 0.97,
    maxUpscaleFactor: 10,
  });
  assert.ok(Math.abs(plan.supportLength - 0.086) < 1e-12);
  assert.ok(Math.abs(plan.supportFraction - 0.86) < 1e-12);
  assert.ok(plan.effectiveFontPxAtZoom4 > 20);
});

test("PTR-1.4 caps aggressive span expansion for pathological very-short names", () => {
  const plan = planMetricTextSupport({
    rasterWidthPx: 100,
    rasterFontSizePx: 100,
    requestedFontPxAtZoom4: 10,
    baselineLength: 1,
    minSupportFraction: 0.86,
    maxSupportFraction: 0.97,
    maxUpscaleFactor: 3.5,
  });
  assert.ok(plan.supportLength <= plan.naturalSupportLength * 3.5 + 1e-15);
  assert.ok(plan.supportFraction < 0.86);
});

test("PTR-1.5 territory plan uses almost the full axis for normal long names", async () => {
  const { planTerritorialTextSupport } = await import("./polityTextLayout.js");
  const plan = planTerritorialTextSupport({
    rasterWidthPx: 1400,
    rasterHeightPx: 140,
    rasterFontSizePx: 128,
    axisSpanWorld: 0.2,
    crossSpanWorld: 0.08,
    targetSpanFraction: 0.93,
    maxHeightFraction: 0.42,
  });
  assert.ok(Math.abs(plan.supportFraction - 0.93) < 1e-12);
});

test("PTR-1.5 territory plan caps very short names by cross-axis room", async () => {
  const { planTerritorialTextSupport } = await import("./polityTextLayout.js");
  const plan = planTerritorialTextSupport({
    rasterWidthPx: 220,
    rasterHeightPx: 140,
    rasterFontSizePx: 128,
    axisSpanWorld: 0.2,
    crossSpanWorld: 0.05,
    targetSpanFraction: 0.93,
    maxHeightFraction: 0.42,
  });
  assert.ok(plan.supportFraction < 0.5);
  assert.ok(plan.maxHeightWorld <= 0.05 * 0.42 + 1e-12);
});


test("PTR-1.8 fades smoothly before the close-zoom cutoff instead of disappearing in one frame", () => {
  const base = { minZoom: 0, maxZoom: 7.1, fadeInZoomSpan: 0.18, fadeOutStartZoom: 6.35 };
  assert.equal(polityTextOpacityAtZoom({ ...base, zoom: 6.0 }), 1);
  const mid = polityTextOpacityAtZoom({ ...base, zoom: 6.7 });
  assert.ok(mid > 0 && mid < 1, `expected partial opacity, got ${mid}`);
  assert.ok(polityTextOpacityAtZoom({ ...base, zoom: 7.0 }) < mid);
  assert.equal(polityTextOpacityAtZoom({ ...base, zoom: 7.1 }), 0);
  assert.equal(polityTextOpacityAtZoom({ ...base, zoom: 7.2 }), 0);
});

test("polity text yields to provinces and cities before close zoom", () => {
  assert.equal(POLITY_TEXT_MAX_ZOOM, 6.20);
  assert.equal(POLITY_TEXT_FADE_OUT_START_ZOOM, 5.00);
  assert.equal(polityTextOpacityAtZoom({ zoom: 4.9 }), 1);
  const mid = polityTextOpacityAtZoom({ zoom: 5.5 });
  assert.ok(mid > 0 && mid < 1, `expected partial opacity at z5.5, got ${mid}`);
  assert.ok(polityTextOpacityAtZoom({ zoom: 5.9 }) < mid);
  assert.equal(polityTextOpacityAtZoom({ zoom: 6.20 }), 0);
  assert.equal(polityTextOpacityAtZoom({ zoom: 7.0 }), 0);
});


test("PTR visual scale contracts a finished support path to 0.88x without moving its center", () => {
  assert.equal(POLITY_TEXT_VISUAL_SCALE, 0.88);
  const center = [10, 20];
  const points = [[0, 20], [10, 30], [20, 20]];
  const scaled = scalePolityTextSupportPoints({ points, center });
  const expected = [[1.2, 20], [10, 28.8], [18.8, 20]];
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(Math.abs(scaled[index][0] - expected[index][0]) < 1e-12);
    assert.ok(Math.abs(scaled[index][1] - expected[index][1]) < 1e-12);
  }
  assert.deepEqual(center, [10, 20]);
});
