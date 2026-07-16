import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRegionOwnershipReference,
  buildWorldSummary,
} from "../src/Game/AI/promptContext.js";

test("buildRegionOwnershipReference exposes exact ids and effective current owners", () => {
  const catalog = [
    { countryCode: "AAA", id: "AAA.1_1", name: "North" },
    { countryCode: "AAA", id: "AAA.2_1", name: "South" },
    { countryCode: "BBB", id: "BBB.1_1", name: "East" },
    { countryCode: "CCC", id: "custom_frontier", name: "Frontier" },
  ];
  const world = {
    regionOwnershipOverrides: {
      "AAA.2_1": "BBB",
      custom_frontier: "CCC",
    },
  };

  const reference = buildRegionOwnershipReference(world, catalog);

  assert.match(reference, /AAA: AAA\.1_1=North/);
  assert.match(reference, /BBB: AAA\.2_1=South; BBB\.1_1=East/);
  assert.match(reference, /CCC: custom_frontier=Frontier/);
});

test("buildRegionOwnershipReference stays bounded and prioritizes regions named in the current turn", () => {
  const catalog = Array.from({ length: 500 }, (_, index) => ({
    country: "Aland",
    countryCode: "AAA",
    id: `AAA.${index + 1}_1`,
    name: `Province ${index + 1}`,
  }));

  const reference = buildRegionOwnershipReference({}, catalog, {
    focusText: "Invade Province 500",
    maxCharacters: 4000,
    maxRegions: 80,
  });

  assert.ok(reference.length <= 4000);
  assert.match(reference, /AAA\.500_1=Province 500/);
  assert.match(reference, /showing \d+ of 500 visible regions/);
});

test("buildRegionOwnershipReference reserves space for an explicitly named target country", () => {
  const playerRegions = Array.from({ length: 250 }, (_, index) => ({
    country: "Playerland",
    countryCode: "PLY",
    id: `PLY.${index + 1}_1`,
    name: `Player Province ${index + 1}`,
    ownerCode: "PLY",
  }));
  const targetRegions = Array.from({ length: 10 }, (_, index) => ({
    country: "France",
    countryCode: "FRA",
    id: `FRA.${index + 1}_1`,
    name: `French Region ${index + 1}`,
    ownerCode: "FRA",
  }));

  const reference = buildRegionOwnershipReference({}, [...playerRegions, ...targetRegions], {
    focusText: "PLY orders the annexation of France",
    maxCharacters: 20000,
    maxRegions: 180,
    playerCode: "PLY",
  });

  for (const region of targetRegions) {
    assert.match(reference, new RegExp(`${region.id.replace(".", "\\.")}=${region.name}`));
  }
});

test("buildRegionOwnershipReference excludes stock regions hidden by a custom map", () => {
  const reference = buildRegionOwnershipReference(
    {
      customRegions: true,
      regionOwnershipOverrides: {
        "EARTH.1_1": "EAR",
        reg_marches: "FAN",
      },
    },
    [
      { countryCode: "EAR", id: "EARTH.1_1", inCustomGeometry: false, name: "Hidden Earth" },
      { countryCode: "OLD", id: "reg_marches", inCustomGeometry: true, name: "Marches", ownerCode: "FAN" },
    ],
  );

  assert.doesNotMatch(reference, /EARTH\.1_1|Hidden Earth/);
  assert.match(reference, /FAN: reg_marches=Marches/);
});

test("buildRegionOwnershipReference does not truncate the map after 24 regions", () => {
  const catalog = Array.from({ length: 30 }, (_, index) => ({
    countryCode: "AAA",
    id: `AAA.${index + 1}_1`,
    name: `Region ${index + 1}`,
  }));

  const reference = buildRegionOwnershipReference({}, catalog);

  assert.match(reference, /AAA\.1_1=Region 1/);
  assert.match(reference, /AAA\.30_1=Region 30/);
});

test("buildWorldSummary includes exact ids for its compact recent-transfer summary", async () => {
  const summary = await buildWorldSummary(
    {
      game: { country: "AAA", difficulty: "standard", gameDate: "1900-01-01", round: 1 },
      world: { regionOwnershipOverrides: { "AAA.1_1": "BBB" } },
    },
    [{ country: "Aland", countryCode: "AAA", id: "AAA.1_1", name: "North" }],
  );

  assert.match(summary, /North \[AAA\.1_1\] \(Aland\) -> BBB/);
});
