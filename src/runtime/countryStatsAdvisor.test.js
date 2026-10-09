import test from "node:test";
import assert from "node:assert/strict";

import { describeCountryStatsForAdvisor } from "./countryStats.js";

// The sheet from the report: the panel showed 47% food and 42% energy autonomy
// while the advisor, never shown the sheet, insisted both were over 80%.
const ROC = {
  capital: "Nanjing",
  government: "Nationalist One-Party State (Kuomintang)",
  leader: "Chiang Kai-shek",
  stability: 83,
  indices: {
    sovereignty: 80,
    foodAutonomy: 47,
    energyAutonomy: 42,
    economicIndependence: 62,
    internalSecurity: 69,
    internationalReputation: 87,
  },
  gdpBreakdown: { agriculture: 48, industry: 32, services: 20 },
  population: { total: 410_000_000 },
  economy: {
    gdp: 433_000_000_000,
    gdpPerCapita: 1057,
    gdpGrowth: 6.2,
    inflation: 12.5,
    unemployment: 7,
    publicDebt: 65.5,
    budgetBalance: -0.4,
    currency: "Chinese Yuan (Fapi)",
  },
};

test("the advisor is handed the panel's figures as authoritative", () => {
  const text = describeCountryStatsForAdvisor(ROC, { name: "Republic of China", intelligence: 48 });
  assert.match(text, /Official National Statistics — Republic of China/);
  assert.match(text, /override any instruction above to estimate/);
  assert.match(text, /Food autonomy 47%/);
  assert.match(text, /Energy autonomy 42%/);
  assert.match(text, /National stability: 83\/100/);
  assert.match(text, /Intelligence service: 48\/100/);
  assert.match(text, /Total population: 410M/);
  assert.match(text, /GDP €433B/);
  assert.match(text, /growth \+6.2%/);
  assert.match(text, /GDP per capita €1,057/);
  assert.match(text, /budget balance -0.4% of GDP/);
  assert.match(text, /domestic currency Chinese Yuan \(Fapi\)/);
  assert.match(text, /agriculture 48%, industry 32%, services 20%/);
});

test("a custom sheet is described under the scenario's own labels", () => {
  const definition = {
    custom: true,
    sections: [{
      key: "realm",
      label: "Realm",
      stats: [
        { key: "piety", label: "Piety", kind: "index", decimals: 0 },
        { key: "treasury", label: "Treasury", kind: "currency", prefix: "£", suffix: "thousand", decimals: 0 },
      ],
    }],
  };
  const text = describeCountryStatsForAdvisor(
    { stability: 60, customStats: { piety: 71, treasury: 1200 } },
    { name: "England", definition },
  );
  assert.match(text, /Realm: Piety 71\/100; Treasury £1,200 thousand/);
  assert.doesNotMatch(text, /Strategic indices/);
});

test("no sheet, no section", () => {
  assert.equal(describeCountryStatsForAdvisor(null, { name: "Nowhere" }), "");
  assert.equal(describeCountryStatsForAdvisor({}, { name: "Nowhere" }), "");
});

test("the recorded trend rides along, oldest first, for charts over time", () => {
  const history = [
    { date: "1961-08-03", stability: 80, foodAutonomy: 45, energyAutonomy: 40, gdp: 400e9, gdpGrowth: 5.8 },
    { date: "1962-02-03", stability: 83, foodAutonomy: 47, energyAutonomy: 42, gdp: 433e9, gdpGrowth: 6.2 },
  ];
  const text = describeCountryStatsForAdvisor(ROC, { name: "Republic of China", history });
  assert.match(text, /Recorded trend \(oldest first/);
  assert.match(text, /1961-08-03: stability 80, food 45%, energy 40%, GDP €400B, growth \+5.8%\n\s+1962-02-03: stability 83, food 47%, energy 42%, GDP €433B, growth \+6.2%/);
});

test("a single sample is not a trend", () => {
  const text = describeCountryStatsForAdvisor(ROC, { name: "Republic of China", history: [{ date: "1962-02-03", stability: 83, gdp: 433e9 }] });
  assert.doesNotMatch(text, /Recorded trend/);
});
