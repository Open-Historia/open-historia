import test from "node:test";
import assert from "node:assert/strict";
import { normalizePolityLabelMaxZoom, polityLabelVisibilityFor, POLITY_LABEL_DEFAULT_MAX_ZOOM, POLITY_LABEL_MIN_ZOOM, POLITY_LABEL_MAX_ZOOM } from "./polityLabelVisibility.js";
import { polityTextOpacityAtZoom } from "../Game/Map/labels/polityTextLayout.js";

test("N029: normalize the local slider's setting and preserve the exact default fade", () => {
  for (const value of [undefined, null, "", " ", "bad", NaN, Infinity, true, false, {}, []]) {
    assert.equal(normalizePolityLabelMaxZoom(value), 6.2);
    assert.deepEqual(polityLabelVisibilityFor(value), { maxZoom: 6.2, fadeOutStartZoom: 5 });
  }
  assert.equal(normalizePolityLabelMaxZoom(-4), POLITY_LABEL_MIN_ZOOM);
  assert.equal(normalizePolityLabelMaxZoom("900"), POLITY_LABEL_MAX_ZOOM);
  assert.equal(normalizePolityLabelMaxZoom("8.26"), 8.3);
  assert.equal(normalizePolityLabelMaxZoom("6.20"), POLITY_LABEL_DEFAULT_MAX_ZOOM);
  for (let i = 0; i <= 120; i += 1) {
    const zoom = i / 10;
    assert.equal(polityTextOpacityAtZoom({ zoom, ...polityLabelVisibilityFor("") }), polityTextOpacityAtZoom({ zoom }));
  }
});
test("N029: high and low cutoffs move the fade envelope, not the record's entry zoom", () => {
  const low = polityLabelVisibilityFor(5);
  const high = polityLabelVisibilityFor(9);
  assert.deepEqual(low, { maxZoom: 5, fadeOutStartZoom: 3.8 });
  assert.deepEqual(high, { maxZoom: 9, fadeOutStartZoom: 7.8 });
  assert.equal(polityTextOpacityAtZoom({ zoom: 7, ...high }), 1);
  assert.equal(polityTextOpacityAtZoom({ zoom: 5, ...low }), 0);
  assert.equal(polityTextOpacityAtZoom({ zoom: 7, minZoom: 7.2, ...high }), 0);
  for (const policy of [low, high]) {
    const mid = polityTextOpacityAtZoom({ zoom: policy.maxZoom - 0.6, ...policy });
    assert.ok(Math.abs(mid - 0.5) < 1e-9);
    assert.equal(polityTextOpacityAtZoom({ zoom: policy.maxZoom, ...policy }), 0);
    assert.equal(polityTextOpacityAtZoom({ zoom: policy.maxZoom + 1, ...policy }), 0);
  }
});
