import test from "node:test";
import assert from "node:assert/strict";
import {
  createOwnerRgbResolver,
  fallbackRgbFromOwner,
  normalizePoliticalRgb,
  ownerDisplayCss,
  parseColorToRgb,
} from "./ownerColors.js";

const palette = { Spain: [200, 40, 40], "Côte d'Ivoire": [240, 150, 30] };
const registry = {
  "British Empire": { color: "#c0507a" },
  "Holy Roman Empire": { color: "rgb(90, 60, 30)", aliases: ["HRE"] },
  Venice: { aliases: ["Serenissima"] },
};

test("colors.json first, by name", () => {
  const resolve = createOwnerRgbResolver(palette, registry);
  assert.deepEqual(resolve("Spain"), [200, 40, 40]);
});

test("a code becomes the name the palette is keyed by", () => {
  const resolve = createOwnerRgbResolver(palette, registry);
  assert.deepEqual(resolve("ESP"), [200, 40, 40]);
});

test("a polity whose colour lives only in the registry takes it", () => {
  const resolve = createOwnerRgbResolver(palette, registry);
  assert.deepEqual(resolve("British Empire"), [192, 80, 122]);
});

test("folded names and registry aliases reach the same colour", () => {
  const resolve = createOwnerRgbResolver({ ...palette, Venice: [10, 20, 30] }, registry);
  assert.deepEqual(resolve("cote divoire"), [240, 150, 30]);
  assert.deepEqual(resolve("hre"), [90, 60, 30]);
  assert.deepEqual(resolve("Serenissima"), [10, 20, 30], "an alias with no registry colour falls to the palette");
});

test("an unknown owner hashes its name, and no owner has no colour", () => {
  const resolve = createOwnerRgbResolver(palette, registry);
  assert.deepEqual(resolve("Roman Empire"), fallbackRgbFromOwner("Roman Empire"));
  assert.equal(resolve(""), null);
  assert.equal(resolve("   "), null);
  assert.equal(resolve(null), null);
});

test("the resolver copes with a palette or registry not loaded yet", () => {
  const resolve = createOwnerRgbResolver(null, undefined);
  assert.deepEqual(resolve("Spain"), fallbackRgbFromOwner("Spain"));
});

test("units and structures get the territory's display colour", () => {
  const resolve = createOwnerRgbResolver(palette, registry);
  const [r, g, b] = normalizePoliticalRgb([192, 80, 122]);
  assert.equal(ownerDisplayCss(resolve, "British Empire", "grey"), `rgb(${r}, ${g}, ${b})`);
  assert.equal(ownerDisplayCss(resolve, "", "rgb(226, 222, 205)"), "rgb(226, 222, 205)");
});

test("parseColorToRgb reads hex, short hex and rgb()", () => {
  assert.deepEqual(parseColorToRgb("#c0507a"), [192, 80, 122]);
  assert.deepEqual(parseColorToRgb("c07"), [204, 0, 119]);
  assert.deepEqual(parseColorToRgb("rgba(300, 5, 6, 0.5)"), [255, 5, 6]);
  assert.equal(parseColorToRgb("tomato"), null);
  assert.equal(parseColorToRgb(""), null);
});
