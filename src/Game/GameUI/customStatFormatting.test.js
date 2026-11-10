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

test("historical units and existing precision, compact and signed formatting survive", () => {
  assert.equal(formatCustomStatValue(treasury, 1250.5, en), "1,250.50 silver marks");
  assert.equal(formatCustomStatValue({ ...treasury, prefix: "ℳ", suffix: "" }, -12.5, en), "ℳ-12.50");
  assert.equal(formatCustomStatValue({ kind: "percentage", suffix: "%", decimals: 1 }, 12.5, en), "12.5%");
  assert.equal(formatCustomStatValue({ suffix: "°", decimals: 0 }, 20, en), "20°");
  assert.equal(formatCustomStatValue({ suffix: "sacks", compact: true, decimals: 1 }, 12500, en), "12.5K sacks");
  assert.equal(formatCustomStatValue({ decimals: 1 }, 1234.5, { locale: "de-DE" }), "1.234,5");
});
