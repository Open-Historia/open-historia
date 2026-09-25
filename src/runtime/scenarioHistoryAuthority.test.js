import test from "node:test";
import assert from "node:assert/strict";

import { materializeScenarioCanon } from "./scenarioCanon.js";
import {
  isReferenceDatePermitted,
  previousScenarioDate,
  resolveScenarioHistoryAuthority,
} from "./scenarioHistoryAuthority.js";

const currentWorld = ({ authority, divergence = null, universe = { id: "reference-world", type: "custom" } }) => materializeScenarioCanon({}, {
  canonContext: {
    universe,
    referenceAuthority: authority,
    referencePacks: [{ id: "some-reference-pack", enabled: true }],
    divergence,
  },
});

test("historical-style round-zero authority includes the scenario start date", () => {
  const authority = resolveScenarioHistoryAuthority({
    world: currentWorld({ authority: "round-zero-only" }),
    scenarioDate: "2014-03-22",
  });

  assert.equal(authority.cutoffDate, "2014-03-22");
  assert.equal(authority.cutoffInclusive, true);
  assert.equal(authority.referenceHorizonDate, "2014-03-22");
  assert.equal(isReferenceDatePermitted("2014-03-22", authority), true);
  assert.equal(isReferenceDatePermitted("2014-03-23", authority), false);
});

test("pre-divergence authority excludes the divergence day itself", () => {
  const world = currentWorld({
    authority: "pre-divergence-only",
    divergence: {
      date: "1963-11-22",
      description: "1963-11-22: The reference timeline changes.",
    },
  });
  const authority = resolveScenarioHistoryAuthority({ world, scenarioDate: "2014-03-22" });

  assert.equal(authority.cutoffDate, "1963-11-22");
  assert.equal(authority.cutoffInclusive, false);
  assert.equal(authority.referenceHorizonDate, "1963-11-21");
  assert.equal(isReferenceDatePermitted("1963-11-21", authority), true);
  assert.equal(isReferenceDatePermitted("1963-11-22", authority), false);
  assert.equal(isReferenceDatePermitted("2014-03-22", authority), false);
});

test("exclusive date horizon crosses month and leap-year boundaries correctly", () => {
  assert.equal(previousScenarioDate("2000-03-01"), "2000-02-29");
  assert.equal(previousScenarioDate("1900-03-01"), "1900-02-28");
  assert.equal(previousScenarioDate("2000-01-01"), "1999-12-31");
});

test("fictional/custom canon with no reference authority exposes no external reference horizon", () => {
  const authority = resolveScenarioHistoryAuthority({
    world: currentWorld({ authority: "none", universe: { id: "wasteland", type: "fictional" } }),
    scenarioDate: "2287-10-23",
  });

  assert.equal(authority.referenceAllowed, false);
  assert.equal(authority.referenceHorizonDate, "");
  assert.equal(isReferenceDatePermitted("2077-10-23", authority), false);
});

test("custom/non-Gregorian divergence labels remain valid semantic authority boundaries", () => {
  const world = materializeScenarioCanon({}, {
    canonContext: {
      universe: { id: "custom-era", type: "fictional" },
      referenceAuthority: "pre-divergence-only",
      divergence: { date: "Third Age 3018" },
    },
  });
  const authority = resolveScenarioHistoryAuthority({ world, scenarioDate: "Third Age 3020" });
  assert.equal(authority.referenceAllowed, true);
  assert.equal(authority.cutoffDate, "Third Age 3018");
  assert.equal(authority.cutoffInclusive, false);
  assert.equal(authority.referenceHorizonDate, "", "native code must not invent calendar arithmetic for opaque dates");
});
