import assert from "node:assert/strict";
import test from "node:test";

import { estimateNativePowerScore, powerTierForPolity, preparePowerStatusForGlobalCalibration, refreshPowerStatus, seedPowerBaselineScore, seedPowerTier } from "./powerStatus.js";

const makePeerWorld = () => ({
  polityOverrides: {
    Testland: { name: "Testland", aliases: [], status: "active" },
    Peera: { name: "Peera", status: "active" },
    Peerb: { name: "Peerb", status: "active" },
    Peerc: { name: "Peerc", status: "active" },
    Peerd: { name: "Peerd", status: "active" },
  },
  countryStats: {
    Testland: { economy: { gdp: 10_000 }, population: { total: 800 } },
    Peera: { economy: { gdp: 500 }, population: { total: 150 } },
    Peerb: { economy: { gdp: 250 }, population: { total: 100 } },
    Peerc: { economy: { gdp: 100 }, population: { total: 60 } },
    Peerd: { economy: { gdp: 25 }, population: { total: 25 } },
  },
  politicalActors: { byPolity: {} },
  countryTags: { Testland: ["nuclear"] },
  institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} },
  agreements: [],
  wars: [],
});

test("power-tier hysteresis advances at most once per campaign round", () => {
  let world = seedPowerTier(makePeerWorld(), "Testland", "minor-power", { basis: "authored", date: "2014-01-01", round: 1 });

  world = refreshPowerStatus(world, { date: "2014-02-01", round: 2 });
  assert.equal(powerTierForPolity(world, "Testland"), "minor-power");
  assert.equal(world.powerStatus.byPolity.Testland.candidateTier, "major-power");
  assert.equal(world.powerStatus.byPolity.Testland.candidateRounds, 1);

  // Multiple subsystem refreshes in the same completed round must not count as
  // multiple months/turns of sustained strategic weight.
  world = refreshPowerStatus(world, { date: "2014-02-01", round: 2 });
  world = refreshPowerStatus(world, { date: "2014-02-01", round: 2 });
  assert.equal(powerTierForPolity(world, "Testland"), "minor-power");
  assert.equal(world.powerStatus.byPolity.Testland.candidateRounds, 1);

  world = refreshPowerStatus(world, { date: "2014-03-01", round: 3 });
  assert.equal(powerTierForPolity(world, "Testland"), "major-power");
  assert.equal(world.powerStatus.byPolity.Testland.candidateTier, "");
  assert.equal(world.powerStatus.byPolity.Testland.candidateRounds, 0);
});

test("native power scoring is era-relative rather than tied to modern GDP units", () => {
  const makeWorld = (scale) => ({
    polityOverrides: {
      Alpha: { status: "active" },
      Beta: { status: "active" },
      Gamma: { status: "active" },
      Delta: { status: "active" },
      Epsilon: { status: "active" },
    },
    countryStats: {
      Alpha: { economy: { gdp: 100 * scale }, population: { total: 100 * scale } },
      Beta: { economy: { gdp: 60 * scale }, population: { total: 75 * scale } },
      Gamma: { economy: { gdp: 30 * scale }, population: { total: 50 * scale } },
      Delta: { economy: { gdp: 10 * scale }, population: { total: 25 * scale } },
      Epsilon: { economy: { gdp: 2 * scale }, population: { total: 10 * scale } },
    },
    politicalActors: { byPolity: {} },
    countryTags: {},
    institutions: { schemaVersion: 1, byId: {} },
    agreements: [],
    wars: [],
  });

  const medievalScale = makeWorld(1);
  const modernScale = makeWorld(1_000_000_000);
  for (const polity of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) {
    const a = estimateNativePowerScore(medievalScale, polity).score;
    const b = estimateNativePowerScore(modernScale, polity).score;
    assert.equal(a, b, `${polity} should keep the same relative power score when every material unit scales equally`);
  }
  assert.ok(estimateNativePowerScore(medievalScale, "Alpha").score > estimateNativePowerScore(medievalScale, "Beta").score);
  assert.ok(estimateNativePowerScore(medievalScale, "Epsilon").score < 35);
});

test("generated major/regional baselines are stable unless relative campaign state changes substantially", () => {
  const world = makePeerWorld();
  let major = seedPowerTier(world, "Testland", "major-power", { basis: "generated-estimate", round: 1 });
  major = refreshPowerStatus(major, { round: 2 });
  assert.equal(powerTierForPolity(major, "Testland"), "major-power");

  let regional = seedPowerTier(world, "Peera", "regional-power", { basis: "generated-estimate", round: 1 });
  regional = refreshPowerStatus(regional, { round: 2 });
  assert.equal(powerTierForPolity(regional, "Peera"), "regional-power");
});

test("institutional leadership contributes materially more strategic weight than ordinary membership", () => {
  const makeWorld = (role) => ({
    polityOverrides: {
      Ukraine: { name: "Ukraine", status: "active" },
      Poland: { status: "active" },
      Romania: { status: "active" },
      Latvia: { status: "active" },
      Moldova: { status: "active" },
    },
    countryStats: {
      Ukraine: { economy: { gdp: 133 }, population: { total: 45 } },
      Poland: { economy: { gdp: 545 }, population: { total: 38 } },
      Romania: { economy: { gdp: 190 }, population: { total: 20 } },
      Latvia: { economy: { gdp: 31 }, population: { total: 2 } },
      Moldova: { economy: { gdp: 8 }, population: { total: 3.5 } },
    },
    politicalActors: { byPolity: {} },
    countryTags: {},
    agreements: [],
    wars: [],
    institutions: {
      schemaVersion: 1,
      ledgerVersion: 1,
      byId: {
        "lublin-defense-pact": {
          id: "lublin-defense-pact",
          name: "Lublin Defense Pact",
          kind: "defense_pact",
          status: "active",
          foundedDate: "2014-01-01",
          members: [{ polity: "Ukraine", status: "member", role }],
        },
      },
    },
  });
  const member = estimateNativePowerScore(makeWorld("member"), "Ukraine").score;
  const leader = estimateNativePowerScore(makeWorld("leader"), "Ukraine").score;
  assert.ok(leader - member >= 7, `leadership should materially raise strategic weight (${member} -> ${leader})`);
});


test("native tier is computed from global era-relative baseline evidence rather than AI-authored tier labels", () => {
  let world = makePeerWorld();
  world = seedPowerBaselineScore(world, "Testland", 88, { basis: "generated-relative-baseline", round: 0 });
  assert.equal(powerTierForPolity(world, "Testland"), "major-power");
  assert.equal(world.powerStatus.byPolity.Testland.baselineScore, 88);
  assert.equal(world.powerStatus.byPolity.Testland.basis, "generated-relative-baseline");
});

test("generated relative baseline keeps useful power truth when full material stats are unavailable", () => {
  let world = {
    polityOverrides: { Germany: { status: "active" }, Latvia: { status: "active" } },
    politicalActors: { byPolity: {} },
    countryStats: {},
    countryTags: {},
    institutions: { schemaVersion: 1, byId: {} },
    agreements: [],
    wars: [],
  };
  world = seedPowerBaselineScore(world, "Germany", 82);
  world = seedPowerBaselineScore(world, "Latvia", 25);
  world = refreshPowerStatus(world, { round: 0, immediate: true });
  assert.equal(powerTierForPolity(world, "Germany"), "major-power");
  assert.equal(powerTierForPolity(world, "Latvia"), "minor-power");
});


test("native fallback tiers never bootstrap themselves into finite power evidence", () => {
  let world = {
    polityOverrides: {
      Alpha: { status: "active" },
      Beta: { status: "active" },
      Gamma: { status: "active" },
    },
    countryStats: {},
    politicalActors: { byPolity: {} },
    countryTags: {},
    agreements: [],
    wars: [],
    institutions: {
      schemaVersion: 1,
      byId: {
        pact: {
          id: "pact",
          name: "Pact",
          kind: "security_alliance",
          status: "active",
          priority: 90,
          members: { Alpha: { status: "member", role: "member" } },
        },
      },
    },
  };

  world = refreshPowerStatus(world, { date: "2014-03-22", round: 0, immediate: true });
  assert.equal(powerTierForPolity(world, "Alpha"), "minor-power");
  assert.equal(world.powerStatus.byPolity.Alpha.score, null);
  assert.equal(world.powerStatus.byPolity.Alpha.basis, "native-fallback");

  // Re-running after the fallback record exists used to turn that fallback
  // minor tier into a numeric 30+ score, causing Political World v2 to skip
  // the actual era-relative calibration call. It must remain unresolved.
  world = refreshPowerStatus(world, { date: "2014-03-22", round: 0, immediate: true });
  assert.equal(world.powerStatus.byPolity.Alpha.score, null);
  assert.equal(estimateNativePowerScore(world, "Alpha").score, null);
});

test("null/blank power scores never become zero-valued baseline evidence", () => {
  const world = makePeerWorld();
  const nullSeed = seedPowerBaselineScore(world, "Testland", null);
  const blankSeed = seedPowerBaselineScore(world, "Testland", "");
  assert.equal(nullSeed.powerStatus, undefined);
  assert.equal(blankSeed.powerStatus, undefined);
});

test("pre-fix poisoned campaign fallback scores are migrated back to unresolved evidence", () => {
  const world = {
    polityOverrides: { Alpha: { status: "active" } },
    politicalActors: { byPolity: {} },
    countryStats: {},
    countryTags: {},
    institutions: { schemaVersion: 1, byId: {} },
    agreements: [],
    wars: [],
    powerStatus: {
      schemaVersion: 1,
      byPolity: {
        Alpha: {
          polityKey: "Alpha",
          tier: "minor-power",
          score: 36.5,
          baselineScore: null,
          basis: "campaign-derived",
          reasons: ["minor-power scenario/campaign baseline; insufficient relative material data"],
        },
      },
    },
  };

  const refreshed = refreshPowerStatus(world, { date: "2014-03-22", round: 1, immediate: true });
  assert.equal(refreshed.powerStatus.byPolity.Alpha.tier, "minor-power");
  assert.equal(refreshed.powerStatus.byPolity.Alpha.score, null);
  assert.equal(refreshed.powerStatus.byPolity.Alpha.baselineScore, null);
  assert.equal(refreshed.powerStatus.byPolity.Alpha.basis, "native-fallback");
});


test("countryStats-only ghost identities never enter native power reference or refresh", () => {
  const world = {
    polityOverrides: {
      Alpha: { status: "active" },
      Beta: { status: "active" },
      Gamma: { status: "active" },
    },
    ownerCodes: ["Alpha", "Beta", "Gamma"],
    politicalActors: { byPolity: {} },
    countryStats: {
      Alpha: { economy: { gdp: 100 }, population: { total: 10 } },
      Beta: { economy: { gdp: 50 }, population: { total: 5 } },
      Gamma: { economy: { gdp: 10 }, population: { total: 1 } },
      "Stock Germany": { economy: { gdp: 99999 }, population: { total: 999 } },
      "Legacy France": { economy: { gdp: 88888 }, population: { total: 888 } },
    },
    countryTags: {},
    institutions: { schemaVersion: 1, byId: {} },
    agreements: [],
    wars: [],
  };

  const refreshed = refreshPowerStatus(world, { date: "2014-03-22", round: 1, immediate: true });
  assert.deepEqual(Object.keys(refreshed.powerStatus.byPolity).sort(), ["Alpha", "Beta", "Gamma"]);
  assert.equal(refreshed.powerStatus.byPolity["Stock Germany"], undefined);
  assert.equal(refreshed.powerStatus.byPolity["Legacy France"], undefined);
});

test("global recalibration staging drops generated ghost rows and preserves only authored canonical overrides", () => {
  const world = {
    polityOverrides: {
      Alpha: { name: "Alpha", aliases: ["A"], status: "active" },
      Beta: { name: "Beta", status: "active" },
    },
    ownerCodes: ["Alpha", "Beta"],
    politicalActors: { byPolity: {} },
    countryStats: {
      Alpha: {},
      Beta: {},
      "Stock Germany": {},
    },
    powerStatus: {
      schemaVersion: 1,
      byPolity: {
        Alpha: { polityKey: "Alpha", tier: "major-power", score: 90, baselineScore: 85, basis: "generated-relative-baseline" },
        Beta: { polityKey: "Beta", tier: "regional-power", score: 60, baselineScore: 60, basis: "authored" },
        "Stock Germany": { polityKey: "Stock Germany", tier: "major-power", score: 95, baselineScore: 95, basis: "generated-relative-baseline" },
      },
    },
  };

  const staged = preparePowerStatusForGlobalCalibration(world, ["Alpha", "Beta"]);
  assert.deepEqual(Object.keys(staged.powerStatus.byPolity), ["Beta"]);
  assert.equal(staged.powerStatus.byPolity.Beta.basis, "authored");
  assert.equal(staged.powerStatus.byPolity.Alpha, undefined, "old generated baselines must not anchor their own replacement");
  assert.equal(staged.powerStatus.byPolity["Stock Germany"], undefined, "derived/legacy ghost must be discarded");
});

test("dense ordinary institution membership raises leverage/strategic weight but cannot promote sovereign power tier", () => {
  let world = {
    polityOverrides: { Small: { status: "active" } },
    politicalActors: { byPolity: {} },
    countryStats: {},
    countryTags: {},
    agreements: [],
    wars: [],
    institutions: {
      schemaVersion: 1,
      byId: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
        `institution-${index}`,
        {
          id: `institution-${index}`,
          name: `Institution ${index}`,
          kind: "alliance",
          status: "active",
          priority: 90,
          members: [{ polity: "Small", status: "member", role: "member" }],
        },
      ])),
    },
  };
  world = seedPowerBaselineScore(world, "Small", 40, { round: 0 });
  world = refreshPowerStatus(world, { round: 1, immediate: true });

  const record = world.powerStatus.byPolity.Small;
  assert.equal(record.sovereignCapabilityScore, 40);
  assert.ok(record.institutionalLeverageScore > 0);
  assert.ok(record.strategicWeight > record.sovereignCapabilityScore);
  assert.equal(record.score, record.strategicWeight, "legacy continuous score remains strategic weight");
  assert.equal(record.tier, "minor-power", "membership cannot turn a 40/100 sovereign capability into regional power");
});

test("institutional leadership changes leverage but not sovereign capability or tier", () => {
  const makeWorld = (role) => {
    let world = {
      polityOverrides: { State: { status: "active" } },
      politicalActors: { byPolity: {} },
      countryStats: {},
      countryTags: {},
      agreements: [],
      wars: [],
      institutions: {
        schemaVersion: 1,
        byId: {
          pact: {
            id: "pact",
            name: "Regional Pact",
            kind: "security_alliance",
            status: "active",
            priority: 90,
            members: [{ polity: "State", status: "member", role }],
          },
        },
      },
    };
    world = seedPowerBaselineScore(world, "State", 48, { round: 0 });
    return refreshPowerStatus(world, { round: 1, immediate: true });
  };

  const member = makeWorld("member").powerStatus.byPolity.State;
  const leader = makeWorld("leader").powerStatus.byPolity.State;
  assert.equal(member.sovereignCapabilityScore, 48);
  assert.equal(leader.sovereignCapabilityScore, 48);
  assert.equal(member.tier, "minor-power");
  assert.equal(leader.tier, "minor-power");
  assert.ok(leader.institutionalLeverageScore > member.institutionalLeverageScore);
  assert.ok(leader.strategicWeight > member.strategicWeight);
});

test("current war relevance changes strategic activity without rewriting material tier", () => {
  let world = {
    polityOverrides: { Alpha: { status: "active" }, Beta: { status: "active" } },
    politicalActors: { byPolity: {} },
    countryStats: {},
    countryTags: {},
    agreements: [],
    wars: [{ id: "war", title: "Border War", status: "active", sideA: ["Alpha"], sideB: ["Beta"] }],
    institutions: { schemaVersion: 1, byId: {} },
  };
  world = seedPowerBaselineScore(world, "Alpha", 45, { round: 0 });
  world = refreshPowerStatus(world, { round: 1, immediate: true });
  const record = world.powerStatus.byPolity.Alpha;
  assert.equal(record.sovereignCapabilityScore, 45);
  assert.ok(record.strategicActivityScore > 0);
  assert.ok(record.strategicWeight > 45);
  assert.equal(record.tier, "minor-power");
});
