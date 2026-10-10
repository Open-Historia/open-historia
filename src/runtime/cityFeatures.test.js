import test from "node:test";
import assert from "node:assert/strict";

import { addCityNameTranslations, cityFeatureName, cityLabelExpression } from "./cityFeatures.js";

// Evaluates the subset of MapLibre expressions the city label uses.
const evaluate = (expression, properties) => {
  if (!Array.isArray(expression)) return expression;
  const [op, ...args] = expression;
  if (op === "get") return properties[args[0]];
  if (op === "coalesce") {
    for (const arg of args) {
      const value = evaluate(arg, properties);
      if (value != null) return value;
    }
    return null;
  }
  if (op === "downcase") return String(evaluate(args[0], properties)).toLowerCase();
  if (op === "match") {
    const input = evaluate(args[0], properties);
    for (let index = 1; index + 1 < args.length; index += 2) {
      if (args[index] === input) return evaluate(args[index + 1], properties);
    }
    return evaluate(args.at(-1), properties);
  }
  throw new Error(`unexpected expression ${op}`);
};

const PACK = new Map([["Munich", "München"], ["Moscow", "Moskau"], ["Vienna", "Wien"]]);
const lookup = (name) => PACK.get(name) ?? null;

test("only names the language pack translates are kept, each once", () => {
  const translations = new Map();
  assert.equal(addCityNameTranslations(translations, ["Munich", "Tallahassee", "", null, "Munich"], lookup), true);
  assert.deepEqual([...translations], [["Munich", "München"]]);
  assert.equal(addCityNameTranslations(translations, ["Munich", "Tallahassee"], lookup), false, "nothing new");
  assert.equal(addCityNameTranslations(translations, ["Moscow"], lookup), true);
  assert.equal(translations.get("Moscow"), "Moskau");
});

test("a translation equal to the name is not kept", () => {
  const translations = new Map();
  assert.equal(addCityNameTranslations(translations, ["Paris"], () => "Paris"), false);
  assert.equal(translations.size, 0);
});

test("the city label is a rename as written, else the pack's name, else the name", () => {
  const translations = new Map([["Munich", "München"], ["Vienna", "Wien"]]);
  const expression = cityLabelExpression({ vienna: "Vindobona" }, translations);
  assert.equal(evaluate(expression, { city: "Munich" }), "München");
  assert.equal(evaluate(expression, { name: "Munich" }), "München");
  assert.equal(evaluate(expression, { city: "Vienna" }), "Vindobona", "a rename wins and is never translated");
  assert.equal(evaluate(expression, { city: "Tallahassee" }), "Tallahassee");
  assert.equal(evaluate(expression, { city: "munich" }), "munich", "names are exact");
});

test("without renames or translations the label is the plain name", () => {
  assert.deepEqual(cityLabelExpression({}, new Map()), ["coalesce", ["get", "city"], ["get", "name"], ""]);
  assert.deepEqual(cityLabelExpression(null), ["coalesce", ["get", "city"], ["get", "name"], ""]);
});

test("the name is read as the layers read it", () => {
  assert.equal(cityFeatureName({ city: "Lagos", name: "Eko" }), "Lagos");
  assert.equal(cityFeatureName({ name: "Eko" }), "Eko");
  assert.equal(cityFeatureName({ city: 12 }), "");
  assert.equal(cityFeatureName(undefined), "");
});
