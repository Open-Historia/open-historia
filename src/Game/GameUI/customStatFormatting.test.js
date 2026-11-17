import test from "node:test";
import assert from "node:assert/strict";
import { formatCustomStatValue } from "./customStatFormatting.js";

const treasury = { kind: "currency", suffix: "silver marks", decimals: 2 };
const en = { locale: "en-US" };

test("unavailable custom values have no fabricated figure or unit", () => {
  for (const value of [undefined, null, "", "  ", false, [], {}, NaN, Infinity, "unknown"]) {
    assert.equal(formatCustomStatValue(treasury, value, en), "—");
  }
  assert.equal(formatCustomStatValue(treasury, 0, en), "0.00 silver marks");
  assert.equal(formatCustomStatValue(treasury, "0", en), "0.00 silver marks");
});

test("existing custom GDP in authored euros converts visibly to campaign GBP without changing the source number", () => {
  const gdp = { key: "gdp", label: "GDP", kind: "currency", prefix: "€", compact: true, decimals: 1 };
  const each = { key: "gdpPerCapita", label: "GDP/capita", kind: "currency", prefix: "€", compact: true, decimals: 0 };
  const rawGdp = 1_793_750_000_000;
  const rawEach = 12_550;
  assert.equal(formatCustomStatValue(gdp, rawGdp, { ...en, economicDisplayCurrency: "GBP" }), "£1.6T");
  assert.equal(formatCustomStatValue(each, rawEach, { ...en, economicDisplayCurrency: "GBP" }), "£10.9K");
  assert.equal(formatCustomStatValue(gdp, rawGdp, { ...en, economicDisplayCurrency: "USD" }), "$2.1T");
  assert.equal(formatCustomStatValue(gdp, rawGdp, { ...en, economicDisplayCurrency: "EUR" }), "€1.8T");
  assert.equal(formatCustomStatValue(gdp, rawGdp, en), "€1.8T", "no explicit preference preserves legacy custom display");
  assert.equal(rawGdp, 1_793_750_000_000, "custom GDP values must remain unchanged");
});

// GDP is the stat with the gdp key, whatever its author called it: the label
// is the author's words, in any language, and was once read in English only.
test("a GDP stat converts by its key alone: labelled in any language, exactly as one labelled GDP", () => {
  const gbp = { ...en, economicDisplayCurrency: "GBP" };
  const english = formatCustomStatValue({ key: "gdp", label: "GDP", kind: "currency", prefix: "€", compact: true }, 1_793_750_000_000, gbp);
  assert.equal(english, "£1.6T");
  for (const label of ["PIB", "ВВП", "国内生产总值", "", "Harvest yield"]) {
    assert.equal(formatCustomStatValue({ key: "gdp", label, kind: "currency", prefix: "€", compact: true }, 1_793_750_000_000, gbp), english, label);
  }
  assert.equal(formatCustomStatValue({ key: "gdpPerCapita", label: "PIB par habitant", kind: "currency", prefix: "€", compact: true }, 12_550, gbp), "£10.9K");
});

test("scenario-specific monetary fields and historical units are never converted", () => {
  const gbp = { ...en, economicDisplayCurrency: "GBP" };
  const notGdp = { key: "treasury", label: "Treasury", kind: "currency", prefix: "€", compact: true };
  // A GDP-looking label on another key is the author's own metric.
  const lookalike = { key: "harvest", label: "GDP", kind: "currency", prefix: "€", compact: true };
  const otherCurrency = { key: "gdp", label: "GDP", kind: "currency", prefix: "¥", compact: true };
  const historic = { key: "gdp", label: "GDP", kind: "currency", prefix: "ℳ", compact: true };
  assert.equal(formatCustomStatValue(notGdp, 7_500_000, gbp), "€7.5M");
  assert.equal(formatCustomStatValue(lookalike, 1_000_000, gbp), "€1.0M");
  assert.equal(formatCustomStatValue(otherCurrency, 1_000_000, gbp), "¥1.0M", "ambiguous yen/yuan symbol must not be guessed");
  assert.equal(formatCustomStatValue(historic, 1_000_000, gbp), "ℳ1.0M");
  assert.equal(formatCustomStatValue({ key: "gdp", label: "GDP", kind: "number", prefix: "€" }, 100, gbp), "€100");
  assert.equal(formatCustomStatValue({ key: "gdp", label: "GDP", kind: "currency", prefix: "€" }, null, gbp), "—");
});

test("historical units and existing precision, compact and signed formatting survive", () => {
  assert.equal(formatCustomStatValue(treasury, 1250.5, en), "1,250.50 silver marks");
  assert.equal(formatCustomStatValue({ ...treasury, prefix: "ℳ", suffix: "" }, -12.5, en), "ℳ-12.50");
  assert.equal(formatCustomStatValue({ kind: "percentage", suffix: "%", decimals: 1 }, 12.5, en), "12.5%");
  assert.equal(formatCustomStatValue({ suffix: "°", decimals: 0 }, 20, en), "20°");
  assert.equal(formatCustomStatValue({ suffix: "sacks", compact: true, decimals: 1 }, 12500, en), "12.5K sacks");
  assert.equal(formatCustomStatValue({ decimals: 1 }, 1234.5, { locale: "de-DE" }), "1.234,5");
});
