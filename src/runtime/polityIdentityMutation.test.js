import test from "node:test";
import assert from "node:assert/strict";
import { resolvePolityIdentity } from "./polityIdentity.js";

const collisionWorld = {
  polityOverrides: {
    "Soviet Union": {
      name: "Soviet Union",
      status: "active",
      mapRefs: { gadm0: ["PRK"] },
    },
  },
  regionOwnershipOverrides: {},
};

test("mapRefs remain available to ordinary contextual identity resolution", () => {
  const result = resolvePolityIdentity("PRK", collisionWorld, {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  assert.equal(result.status, "map-ref");
  assert.equal(result.resolved, "Soviet Union");
});

test("political mutation identity can reject mapRefs and stock geography as lineage evidence", () => {
  const result = resolvePolityIdentity("PRK", collisionWorld, {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: false,
    allowMapRefs: false,
  });
  assert.equal(result.status, "unresolved");
  assert.equal(result.resolved, "");
  assert.deepEqual(result.candidates, []);
});

test("political mutation identity still resolves an explicitly declared dormant lineage", () => {
  const world = {
    polityOverrides: {
      "North Korea": {
        name: "Democratic People's Republic of Korea",
        aliases: ["DPRK", "PRK"],
        status: "dissolved",
        mapRefs: { gadm0: ["PRK"] },
      },
    },
    regionOwnershipOverrides: {},
  };
  const result = resolvePolityIdentity("PRK", world, {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: false,
    allowMapRefs: false,
  });
  assert.equal(result.status, "exact-declared");
  assert.equal(result.resolved, "North Korea");
});

test("disabling mapRefs does not disable exact current names or explicit aliases", () => {
  const world = {
    polityOverrides: {
      "French Republic": {
        name: "French Republic",
        aliases: ["France"],
        status: "active",
        mapRefs: { gadm0: ["FRA"] },
      },
    },
    regionOwnershipOverrides: {},
  };
  for (const token of ["French Republic", "France"]) {
    const result = resolvePolityIdentity(token, world, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: false,
      allowMapRefs: false,
    });
    assert.equal(result.status, "exact-declared");
    assert.equal(result.resolved, "French Republic");
  }
});
