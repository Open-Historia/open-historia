import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatEconomicDisplayValue } from "../../runtime/economicDisplayCurrency.js";

const panel = readFileSync(new URL("./projects.jsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./settings.jsx", import.meta.url), "utf8");
const planner = readFileSync(new URL("../AI/gameplay.js", import.meta.url), "utf8");
const advisor = readFileSync(new URL("../AI/main.jsx", import.meta.url), "utf8");
const schemas = readFileSync(new URL("../AI/gameplaySchemas.js", import.meta.url), "utf8");

test("Projects monetary examples use the same fixed USD accounting conversion as National GDP", () => {
  assert.equal(formatEconomicDisplayValue(2_930_000, "EUR", { compact: true }), "€2.5M");
  assert.equal(formatEconomicDisplayValue(11_300_000, "EUR", { compact: true }), "€9.7M");
  assert.equal(formatEconomicDisplayValue(2_930_000, "USD", { compact: true }), "$2.9M");
});

test("Projects currency display follows the live saved campaign preference in every money field", () => {
  assert.match(panel, /useSyncExternalStore\(subscribeEconomicDisplayCurrency, getActiveEconomicDisplayCurrency\)/);
  assert.match(panel, /readGameData\(\{ force: true \}\)[\s\S]*?setActiveEconomicDisplayCurrency\(game\.economicDisplayCurrency\)/);
  assert.doesNotMatch(panel, /setActiveEconomicDisplayCurrency\(economicDisplayCurrency\)/);
  assert.match(settings, /saveGame\(activeGameId, \{ gamePatch: \{ economicDisplayCurrency: next \} \}\)[\s\S]*?refreshRuntimeState\("game"\)/);
  assert.match(panel, /const formatMoney = \(value, displayCurrency\) => \{\s*const amount = typeof value === "string" && value\.trim\(\) !== "" \? Number\(value\) : value;\s*return formatEconomicDisplayValue\(amount, displayCurrency, \{ compact: true \}\);\s*\};/);
  assert.match(panel, /formatMoney\(means\.budget, displayCurrency\)/);
  assert.match(panel, /formatMoney\(means\.committed, displayCurrency\)/);
  assert.match(panel, /formatMoney\(dailyCostOf\(project\) \* DAYS_PER_MONTH, displayCurrency\)/);
  assert.match(panel, /formatMoney\(project\.spent, displayCurrency\)/);
  assert.match(panel, /formatMoney\(plan\.monthlyCost, displayCurrency\)/);
  assert.match(panel, /<ProjectCard[\s\S]*?displayCurrency=\{displayCurrency\}/);
  assert.match(panel, /<NewProject[^>]*displayCurrency=\{displayCurrency\}/);
  assert.match(panel, /<PlanFacts[^>]*displayCurrency=\{displayCurrency\}/);
});

test("Project plan AI specifies constant 2026 USD and keeps domestic currency separate", () => {
  assert.match(planner, /Domestic currency: \$\{currency\}.*not the accounting unit/);
  assert.match(planner, /Canonical GDP \$\{readableFigure\(gdp\)\} USD/);
  assert.match(planner, /Project budget \$\{readableFigure\(means\.budget\)\} USD/);
  assert.match(planner, /monthlyCost:.*constant 2026 USD/);
  assert.match(planner, /non-monetary scenarios set monthlyCost to 0/);
  assert.doesNotMatch(planner, /monthlyCost: what it costs a month at normal funding, in the country's GDP currency/);
  assert.doesNotMatch(planner, /Its economy is not on record: give the monthly cost in whatever unit this world counts money in; it is paid in full\./);
  assert.match(advisor, /monthlyCost:.*constant 2026 USD accounting units/);
  assert.doesNotMatch(advisor, /monthlyCost:.*in the country's GDP currency/);
  assert.match(schemas, /monthlyCost:.*canonical constant 2026 USD/);
});
