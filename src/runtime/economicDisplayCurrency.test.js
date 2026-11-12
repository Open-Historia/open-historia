import assert from "node:assert/strict";
import test from "node:test";
import {
  ECONOMIC_DISPLAY_CURRENCIES, DEFAULT_ECONOMIC_DISPLAY_CURRENCY,
  economicDisplayRate, economicDisplayUnitLabel, formatEconomicDisplayValue,
  fromDisplayCurrency, getActiveEconomicDisplayCurrency, normalizeEconomicDisplayCurrency,
  setActiveEconomicDisplayCurrency, subscribeEconomicDisplayCurrency, toDisplayCurrency,
  validEconomicDisplayCurrency, assertEconomicDisplayCurrencyChoice,
} from "./economicDisplayCurrency.js";

test("fixed reference sources and exact cross-rates preserve one canonical USD unit", () => {
  assert.deepEqual(ECONOMIC_DISPLAY_CURRENCIES.map(({ code }) => code), ["USD", "EUR", "GBP", "RUB", "INR", "CNY"]);
  assert.equal(DEFAULT_ECONOMIC_DISPLAY_CURRENCY, "USD");
  assert.equal(economicDisplayRate("USD"), 1);
  assert.equal(toDisplayCurrency(1166.4, "EUR"), 1000);
  assert.equal(toDisplayCurrency(1166.4, "GBP"), 867.6);
  assert.equal(toDisplayCurrency(1166.4, "INR"), 105316);
  assert.equal(toDisplayCurrency(1166.4, "CNY"), 8147.8);
  assert.equal(toDisplayCurrency(1, "RUB"), 78.2267);
});

test("currency conversion round trips even for small historical economies, without rounding canonical values", () => {
  for (const { code } of ECONOMIC_DISPLAY_CURRENCIES) {
    for (const value of [0, 0.00013, -1000.8, 5e8, 3.75e12]) {
      const displayed = toDisplayCurrency(value, code);
      assert.ok(Math.abs(fromDisplayCurrency(displayed, code) - value) < Math.max(1e-8, Math.abs(value) * 1e-12), code);
    }
  }
  assert.equal(toDisplayCurrency(NaN, "EUR"), null);
  assert.equal(fromDisplayCurrency(Infinity, "RUB"), null);
  assert.equal(toDisplayCurrency("100", "EUR"), null);
});

test("invalid or missing legacy currency falls back to canonical USD without modifying a save", () => {
  for (const invalid of ["", "AUD", "ABC", null, undefined, 1, { code: "GBP" }]) {
    assert.equal(normalizeEconomicDisplayCurrency(invalid), "USD");
    assert.equal(validEconomicDisplayCurrency(invalid), false);
  }
  assert.equal(normalizeEconomicDisplayCurrency(" eur "), "EUR");
  assert.equal(economicDisplayUnitLabel("EUR"), "2026-EUR equivalent");
});

test("malformed explicit preference patches are rejected before writes; legacy omissions are accepted", () => {
  for (const value of ["AUD", "eur", "", null, 1, {}]) {
    assert.throws(() => assertEconomicDisplayCurrencyChoice({ economicDisplayCurrency: value }), /must be one of/);
  }
  assert.doesNotThrow(() => assertEconomicDisplayCurrencyChoice({}));
  assert.doesNotThrow(() => assertEconomicDisplayCurrencyChoice({ economicDisplayCurrency: "RUB" }));
});

test("formatting handles GDP, per-capita, missing and negative changes", () => {
  assert.equal(formatEconomicDisplayValue(2e12, "USD", { compact: true }), "$2.0T");
  assert.equal(formatEconomicDisplayValue(2e12, "EUR", { compact: true }), "€1.7T");
  assert.match(formatEconomicDisplayValue(22500, "GBP", { perCapita: true }), /^£/);
  assert.match(formatEconomicDisplayValue(-25e9, "RUB", { compact: true }), /^₽-/);
  assert.equal(formatEconomicDisplayValue(null, "EUR"), "—");
});

test("live selection is ephemeral and subscribers are notified once per actual change", () => {
  const baseline = getActiveEconomicDisplayCurrency();
  let notifications = 0;
  const unsubscribe = subscribeEconomicDisplayCurrency(() => { notifications += 1; });
  try {
    setActiveEconomicDisplayCurrency("GBP");
    setActiveEconomicDisplayCurrency("GBP");
    assert.equal(getActiveEconomicDisplayCurrency(), "GBP");
    assert.equal(notifications, baseline === "GBP" ? 0 : 1);
    unsubscribe();
    setActiveEconomicDisplayCurrency("RUB");
    assert.equal(notifications, baseline === "GBP" ? 0 : 1);
  } finally {
    setActiveEconomicDisplayCurrency(baseline);
  }
});
