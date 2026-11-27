import test from "node:test";
import assert from "node:assert/strict";
import { createPropertyExpression, latest } from "@maplibre/maplibre-gl-style-spec";
import { STOCK_LABEL_RAMP, CUSTOM_CURVED_LABEL_RAMP, LIVE_LABEL_RAMP, buildCountryTextOpacity, buildCountryTextSize } from "./polityLabelPaint.js";

const ramps = [
  [STOCK_LABEL_RAMP, 0.72, "areaScale"],
  [STOCK_LABEL_RAMP, 0.78, "areaScale"],
  [CUSTOM_CURVED_LABEL_RAMP, 0.78, "areaScale"],
  [LIVE_LABEL_RAMP, 1, "fitScale"],
];
const evaluate = (expr, field, layout = false) => {
  const compiled = createPropertyExpression(expr, field, (layout ? latest.layout_symbol : latest.paint_symbol)[field]);
  assert.equal(compiled.result, "success", JSON.stringify(compiled.value));
  return (zoom, feature = {}) => compiled.value.evaluate({ zoom }, { properties: { lat: 52, areaScale: 2000, fitScale: 2000, ...feature } }, {});
};
const rampAt = (ramp, zoom) => {
  if (zoom <= ramp[0]) return ramp[1];
  for (let i = 2; i < ramp.length; i += 2) {
    if (zoom <= ramp[i]) {
      return ramp[i - 1] + (ramp[i + 1] - ramp[i - 1]) * (zoom - ramp[i - 2]) / (ramp[i] - ramp[i - 2]);
    }
  }
  return ramp.at(-1);
};
test("N029: default legacy opacity expression retains every shipped sampled alpha and size guard", () => {
  for (const [base, multiplier, scale] of ramps) for (const globe of [false, true]) {
    const oldRamp = [...base, 6.2, 0];
    const oldStops = [...new Set([...Array.from({ length: 13 }, (_, i) => 2 + i * 0.5), ...oldRamp.filter((_, i) => i % 2 === 0)])].sort((a,b) => a-b);
    const expr = buildCountryTextOpacity(base, multiplier, globe, scale);
    const stops = expr.slice(3).filter((_, i) => i % 2 === 0);
    assert.deepEqual(stops, oldStops);
    for (let i = 0; i < oldStops.length; i += 1) {
      // The former renderer's own ramp sample (including the tile sample
      // just beyond the default layer cutoff) is preserved exactly.
      assert.equal(expr[4 + 2*i][1], Number(rampAt(oldRamp, oldStops[i]).toFixed(4)));
    }
    const opacity = evaluate(expr, "text-opacity");
    assert.ok(opacity(4.5) > 0);
    assert.equal(opacity(6, { lat: 0, [scale]: 1e9 }), 0, "255 px glyph cap safety fade still applies");
  }
});
test("N029: every legacy paint ramp is valid throughout the slider range, fades, and never reappears", () => {
  for (let tick = 50; tick <= 90; tick += 1) {
    const cutoff = tick / 10;
    for (const [ramp, multiplier, scale] of ramps) for (const globe of [false, true]) {
      const expr = buildCountryTextOpacity(ramp, multiplier, globe, scale, cutoff);
      const stops = expr.slice(3).filter((_, i) => i % 2 === 0);
      assert.ok(stops.every((stop, i) => i === 0 || stop > stops[i-1]));
      const opacity = evaluate(expr, "text-opacity");
      if (cutoff === 6.2) continue; // default legacy layer's exclusive maxzoom is preserved
      assert.equal(opacity(cutoff), 0);
      assert.equal(opacity(cutoff + 0.1), 0);
      assert.equal(opacity(12), 0);
      assert.ok(opacity(cutoff - 0.3) > 0, "small labels survive nearly to cutoff");
      assert.equal(opacity(cutoff - 0.3, { lat: 0, [scale]: 1e9 }), 0);
      if (cutoff === 9) assert.ok(opacity(7.5) > 0, "small countries remain visible farther in");
    }
  }
  const size = evaluate(buildCountryTextSize(1, false, "fitScale"), "text-size", true);
  assert.equal(size(8) / size(7), 2, "legacy fit scaling is unchanged");
});
