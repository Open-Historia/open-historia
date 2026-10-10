/*! Open Historia — the scenario's own map, fingerprinted as the library does: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/ownMapHash.test.js
//
// The Maps window marks the scenario's own map "In use" on the Your basemaps
// card that holds the same map. The library knows its basemaps by a checksum
// of their payload (server/basemapHash.js); the editor takes the
// same checksum of the scenario's saved background to find that card.

import test from "node:test";
import assert from "node:assert/strict";

import { ownMapHash } from "./ownMapHash.js";
import { hashPayload } from "../../server/basemapHash.js";

const picture = { kind: "image", dataUrl: "data:image/png;base64,iVBORw0KGgo=", aspect: 2 };
const drawing = { kind: "vector", geojson: { type: "FeatureCollection", features: [{ type: "Feature", properties: { fill: "#334455" }, geometry: { type: "Point", coordinates: [10, 20] } }] } };

test("a picture or a drawing gets the checksum the library gave it", async () => {
  assert.equal(await ownMapHash(picture), hashPayload({ dataUrl: picture.dataUrl }));
  assert.equal(await ownMapHash(drawing), hashPayload({ geojson: drawing.geojson }));
});

test("a plain sea, or no map of its own, has no checksum", async () => {
  assert.equal(await ownMapHash({ kind: "plain" }), null);
  assert.equal(await ownMapHash(null), null);
  assert.equal(await ownMapHash({ kind: "vector" }), null);
});
