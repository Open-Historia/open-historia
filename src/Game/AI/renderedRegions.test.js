import test from "node:test";
import assert from "node:assert/strict";

import { filterToRenderedRegions } from "./promptContext.js";

test("a map's own regions stay in its catalog whatever their ids look like; the stock world's rows it does not use go", () => {
  const catalog = [
    { id: "CHN.1_1", name: "Anhui", country: "Qing Empire", custom: true },
    { id: "CHN.2_1", name: "Beijing", country: "China" },
    { id: "reg_abc", name: "Manchuria", country: "Qing Empire", custom: true },
    { id: "MNG.1_1", name: "Arkhangai", country: "Mongolia" },
  ];
  const world = { customRegions: true, regionOwnershipOverrides: { "MNG.1_1": "Bogd Khanate" } };
  assert.deepEqual(filterToRenderedRegions(catalog, world).map((region) => region.id), ["CHN.1_1", "reg_abc", "MNG.1_1"]);
  assert.equal(filterToRenderedRegions(catalog, { customRegions: false }).length, 4);
});
