/*! Open Historia — city presentation architecture checks © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const cities = fs.readFileSync(new URL("./Cities.jsx", import.meta.url), "utf8");
const nations = fs.readFileSync(new URL("./Nations.jsx", import.meta.url), "utf8");

test("cities use ranked game markers with dedicated capital stars", () => {
  assert.match(cities, /id="cities-shapes"[\s\S]*?type="circle"/);
  assert.match(cities, /id="cities-capitals"[\s\S]*?type="symbol"/);
  assert.match(cities, /"text-field": "★"/);
  assert.match(cities, /circle-radius/);
  assert.match(cities, /circle-stroke-width/);
  assert.match(cities, /isStockCapital/);
  assert.match(cities, /isCustomCapital/);
});

test("capital labels stay white while the capital marker carries the gold accent", () => {
  assert.match(cities, /"text-color": "rgba\(228, 185, 61, 0\.99\)"/);
  assert.match(cities, /"text-color": "rgba\(247,246,240,0\.96\)"/);
  assert.match(cities, /"text-color": "rgba\(250,249,244,0\.99\)"/);
  assert.doesNotMatch(cities, /248, 222, 174/);
  assert.match(cities, /text-halo-width/);
  assert.match(cities, /text-radial-offset": 1\.0/);
});


test("minor settlements are progressively revealed instead of saturating regional zooms", () => {
  assert.match(cities, /const populationLabelFilter/);
  assert.match(cities, /5\.25, 1500000/);
  assert.match(cities, /8\.25, 150000/);
  assert.match(cities, /const customLabelFilter/);
  assert.match(cities, /\[">=", \["zoom"\], 5\.8\]/);
  assert.match(cities, /\[">=", \["zoom"\], 6\.5\]/);
  assert.match(cities, /\[">=", \["zoom"\], 8\.0\]/);
});

test("capitals use a restrained gold star instead of the old ring treatment", () => {
  const capitalLayers = [...cities.matchAll(/id="cities-capitals"/g)];
  assert.equal(capitalLayers.length, 2);
  assert.match(cities, /"text-field": "★"/);
  assert.match(cities, /"text-color": "rgba\(228, 185, 61, 0\.99\)"/);
  assert.match(cities, /"text-halo-color": "rgba\(6, 9, 13, 0\.96\)"/);
  assert.doesNotMatch(cities, /244, 211, 151/);
  assert.match(cities, /0\.62/);
});


test("dedicated capital stars remain part of native city hit-testing", () => {
  assert.match(nations, /const featureLayers = \[[\s\S]*?"cities-shapes",\s*"cities-capitals",/);
  assert.match(nations, /queryRenderedFeatures\(event\.point, \{ layers: featureLayers \}\)/);
});
