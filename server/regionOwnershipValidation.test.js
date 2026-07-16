import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRegionTransfers } from "../src/Game/AI/regionOwnershipValidation.js";

const regionCatalog = [
  { countryCode: "AAA", id: "AAA.1_1", name: "North", ownerCode: "AAA" },
  { countryCode: "AAA", id: "AAA.2_1", name: "South", ownerCode: "AAA" },
  { countryCode: "BBB", id: "BBB.1_1", name: "East", ownerCode: "BBB" },
];
const countryCatalog = [
  { code: "AAA", name: "Aland" },
  { code: "BBB", name: "Borland" },
];

const validate = (impacts, options = {}) => validateRegionTransfers({
  candidate: { impacts, summary: "Changed borders." },
  countryCatalog,
  regionCatalog,
  world: {},
  ...options,
});

test("validateRegionTransfers rejects phantom region ids and suggests exact candidates", () => {
  const error = validate({
    regionTransfers: [{ fromCode: "AAA", regionId: "NOT_REAL", regionName: "North", toCode: "BBB" }],
  });

  assert.match(error, /NOT_REAL.*not on the active map/);
  assert.match(error, /AAA\.1_1=North/);
});

test("validateRegionTransfers accepts existing and same-response-created polity codes", () => {
  assert.equal(validate({
    regionTransfers: [{ fromCode: "AAA", regionId: "AAA.1_1", toCode: "BBB" }],
  }), "");
  assert.equal(validate({
    polityChanges: [{ code: "NEW", name: "New State" }],
    regionTransfers: [{ fromCode: "AAA", regionId: "AAA.1_1", toCode: "NEW" }],
  }), "");
  assert.match(validate({
    regionTransfers: [{ fromCode: "AAA", regionId: "AAA.1_1", toCode: "MADE_UP" }],
  }), /MADE_UP.*not an existing or newly created polity code/);
});

test("validateRegionTransfers tracks current ownership across a response", () => {
  const error = validateRegionTransfers({
    candidate: {
      events: [
        { impacts: { regionTransfers: [{ fromCode: "AAA", regionId: "AAA.1_1", toCode: "BBB" }] } },
        { impacts: { regionTransfers: [{ fromCode: "AAA", regionId: "AAA.1_1", toCode: "AAA" }] } },
      ],
    },
    countryCatalog,
    regionCatalog,
    world: {},
  });

  assert.match(error, /fromCode "AAA" does not match current owner "BBB"/);
});

test("validateRegionTransfers rejects stock ids outside active custom geometry", () => {
  const error = validate({
    regionTransfers: [{ regionId: "AAA.1_1", toCode: "BBB" }],
  }, {
    regionCatalog: [
      { countryCode: "AAA", id: "AAA.1_1", inCustomGeometry: false, name: "Hidden" },
      { countryCode: "AAA", id: "reg_visible", inCustomGeometry: true, name: "Visible", ownerCode: "AAA" },
    ],
    world: { customRegions: true },
  });

  assert.match(error, /AAA\.1_1.*not on the active map/);
});

test("validateRegionTransfers fails closed when custom geometry has not loaded", () => {
  const error = validate({
    regionTransfers: [{ regionId: "AAA.1_1", toCode: "BBB" }],
  }, {
    regionCatalog: [
      { countryCode: "AAA", id: "AAA.1_1", inCustomGeometry: false, name: "Hidden Earth" },
    ],
    world: { customRegions: true },
  });

  assert.match(error, /AAA\.1_1.*not on the active map/);
});

test("custom maps reject inactive global country codes but accept scenario ownerCodes", () => {
  const customCatalog = [
    { countryCode: "USA", id: "reg_visible", inCustomGeometry: true, name: "Marches", ownerCode: "FAN" },
  ];
  const globalOnlyError = validate({
    regionTransfers: [{ fromCode: "FAN", regionId: "reg_visible", toCode: "USA" }],
  }, {
    countryCatalog: [{ code: "USA", name: "United States" }],
    regionCatalog: customCatalog,
    world: { customRegions: true, ownerCodes: ["FAN", "EXILE"] },
  });
  assert.match(globalOnlyError, /USA.*not an existing or newly created polity code/);

  assert.equal(validate({
    regionTransfers: [{ fromCode: "FAN", regionId: "reg_visible", toCode: "EXILE" }],
  }, {
    countryCatalog: [{ code: "USA", name: "United States" }],
    regionCatalog: customCatalog,
    world: { customRegions: true, ownerCodes: ["FAN", "EXILE"] },
  }), "");
});
