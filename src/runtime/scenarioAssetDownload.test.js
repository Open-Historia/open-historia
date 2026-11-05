/*! Open Historia — a scenario asset that is absent vs one that failed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioAssetDownload.test.js
//
// downloadScenarioJsonAsset answers null only for an asset the scenario does
// not have (404). A download that failed, or a file too big to parse on a
// phone, used to answer null too, and the Workshop, taking it for "no flags,
// no tags, no background, stock geometry", wrote exactly that over the
// author's map on the next save.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { downloadScenarioJsonAsset } from "./library.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const respond = (body, status) => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  };
  return seen;
};

test("an asset the scenario has comes back parsed, and the coarse regions are asked for as such", async () => {
  const seen = respond(JSON.stringify({ Avalon: [1, 2, 3] }), 200);
  assert.deepEqual(await downloadScenarioJsonAsset("vinland", "colors"), { Avalon: [1, 2, 3] });
  await downloadScenarioJsonAsset("vinland", "regionsGeojson", { coarse: true });
  assert.equal(seen[1], "/api/scenarios/vinland/assets/regionsGeojson?coarse=1");
});

test("an asset the scenario does not have is null", async () => {
  respond(JSON.stringify({ error: "Asset not found: flags" }), 404);
  assert.equal(await downloadScenarioJsonAsset("vinland", "flags"), null);
});

test("a failed download is an error, never an absent asset", async () => {
  respond(JSON.stringify({ error: "Invalid string length" }), 500);
  await assert.rejects(downloadScenarioJsonAsset("vinland", "regionsGeojson"), /could not be loaded \(HTTP 500\)/);

  respond("{ \"type\": \"FeatureCollection\", \"features\": [", 200);
  await assert.rejects(downloadScenarioJsonAsset("vinland", "regionsGeojson"), SyntaxError, "a file that does not parse is not a missing file");

  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(downloadScenarioJsonAsset("vinland", "tags"), /Failed to fetch/);
});
