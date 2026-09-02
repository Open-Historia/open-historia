import assert from "node:assert/strict";
import test from "node:test";

import { buildBasemapRenderKey, resolveBasemapId } from "../src/runtime/assets.js";

test("runtime basemap selection preserves the scenario choice by default", () => {
  assert.equal(resolveBasemapId({ scenarioId: "dark-gray" }), "dark-gray");
});

test("a valid runtime basemap overrides the scenario and can be reset", () => {
  assert.equal(resolveBasemapId({ overrideId: "physical", scenarioId: "dark-gray" }), "physical");
  assert.equal(resolveBasemapId({ overrideId: "atlas-relief", scenarioId: "dark-gray" }), "atlas-relief");
  assert.equal(resolveBasemapId({ overrideId: "", scenarioId: "dark-gray" }), "dark-gray");
});

test("invalid basemap ids fall back to the neutral built-in default", () => {
  assert.equal(resolveBasemapId({ overrideId: "missing", scenarioId: "missing" }), "ocean");
});

test("changing the runtime basemap produces a fresh map instance key", () => {
  const scenario = buildBasemapRenderKey({ projection: "mercator", basemapId: "dark-gray" });
  const override = buildBasemapRenderKey({ projection: "mercator", basemapId: "physical" });
  assert.notEqual(scenario, override);
});
