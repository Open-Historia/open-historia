import test from "node:test";
import assert from "node:assert/strict";
import { builtInFlagChoices, filterBuiltInFlags, suggestedBuiltInFlag } from "./builtInFlags.js";

const choices = builtInFlagChoices();
const codes = (list) => list.map((flag) => flag.code);

test("every built-in flag carries a country name, and the list is in name order", () => {
  assert.ok(choices.length > 200);
  const germany = choices.find((flag) => flag.code === "DEU");
  assert.equal(germany.name, "Germany");
  assert.equal(germany.alpha2, "de");
  assert.equal(germany.imageUrl, "https://flagcdn.com/de.svg");
  for (const flag of choices) assert.ok(flag.name && flag.name !== flag.code, `${flag.code} has a name`);
  const names = choices.map((flag) => flag.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test("search finds a flag by country name, not only by code", () => {
  assert.deepEqual(codes(filterBuiltInFlags(choices, "germany")), ["DEU"]);
  assert.ok(codes(filterBuiltInFlags(choices, "Germ")).includes("DEU"));
  assert.ok(codes(filterBuiltInFlags(choices, "DEU")).includes("DEU"));
  assert.ok(codes(filterBuiltInFlags(choices, "de")).includes("DEU"), "alpha-2 still matches");
});

test("an official full name finds its country", () => {
  assert.ok(codes(filterBuiltInFlags(choices, "Russian Federation")).includes("RUS"));
});

test("an empty search keeps every flag", () => {
  assert.equal(filterBuiltInFlags(choices, "  ").length, choices.length);
});

test("the picker suggests the flag for a standard country, and nothing for any other polity", () => {
  assert.equal(suggestedBuiltInFlag(choices, "Germany")?.code, "DEU");
  assert.equal(suggestedBuiltInFlag(choices, "DEU")?.code, "DEU");
  assert.equal(suggestedBuiltInFlag(choices, "Holy Roman Empire"), null);
  assert.equal(suggestedBuiltInFlag(choices, ""), null);
  assert.equal(suggestedBuiltInFlag(choices, null), null);
});
