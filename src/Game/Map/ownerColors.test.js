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

// The fold kept a-z only, so a name in any other script had no folded key and
// was found by its exact spelling alone: "РОССИЯ" was drawn in a hash colour
// beside "Россия". It now folds as its English twin does.
test("a name in another script folds as its English twin does", () => {
  const resolve = createOwnerRgbResolver(
    { Russia: [180, 30, 30], "Россия": [180, 30, 30], "中国": [220, 40, 40] },
    { "Российская Федерация": { name: "Российская Федерация", aliases: ["РФ"], color: "#334455" }, "Russian Federation": { name: "Russian Federation", aliases: ["RF"], color: "#334455" } },
  );
  assert.deepEqual(resolve("RUSSIA"), [180, 30, 30]);
  assert.deepEqual(resolve("РОССИЯ"), [180, 30, 30]);
  assert.deepEqual(resolve("rf"), [51, 68, 85]);
  assert.deepEqual(resolve("рф"), [51, 68, 85]);
  assert.deepEqual(resolve("日本"), fallbackRgbFromOwner("日本"), "another name in the same script is another country");
});

// Every name with fewer than three Latin letters used to be the same grey, so a
// map of countries named in Russian or Chinese drew them all alike.
test("countries named in another script each get a colour of their own, the same every time", () => {
  const grey = [96, 96, 96];
  const names = ["Россия", "Украина", "Беларусь", "中国", "日本", "مصر", "ישראל"];
  const colours = names.map((name) => fallbackRgbFromOwner(name));
  for (const [index, colour] of colours.entries()) {
    assert.notDeepEqual(colour, grey, names[index]);
    assert.deepEqual(fallbackRgbFromOwner(names[index]), colour, `${names[index]} is drawn the same every time`);
    assert.deepEqual(fallbackRgbFromOwner(names[index].toUpperCase()), colour, `${names[index]} in capitals is the same country`);
    for (const channel of colour) assert.ok(channel >= 64 && channel <= 189, `${names[index]} stays in the palette's range`);
  }
  assert.equal(new Set(colours.map((colour) => colour.join())).size, names.length, "no two of them alike");
  // A Latin name keeps the colour it always had.
  assert.deepEqual(fallbackRgbFromOwner("Spain"), [64 + 18 * 5, 64 + 0 * 5, 64 + 15 * 5]);
  assert.deepEqual(fallbackRgbFromOwner(""), grey, "no name at all is grey");
});

// The owner's website Modern Day, 2026-11-09: an older copy keyed "Kingdom of
// Spain" read a palette keyed "Spain" (the seed's, after the countries took
// their common names), and countries came out grey while Algeria kept its colour.
test("a country the palette does not name is drawn in its own registry colour, not grey", () => {
  const seedPalette = { Spain: [214, 183, 81], France: [77, 120, 147], Algeria: [183, 154, 117] };
  const olderWorld = {
    "Kingdom of Spain": { name: "Kingdom of Spain", color: "#c1a66e" },
    "French Republic": { name: "French Republic", color: "#4d7893" },
    Algeria: { name: "Algeria", color: "#000000" },
  };
  const resolve = createOwnerRgbResolver(seedPalette, olderWorld);
  assert.deepEqual(resolve("Kingdom of Spain"), [193, 166, 110]);
  assert.deepEqual(resolve("French Republic"), [77, 120, 147]);
  assert.deepEqual(resolve("Algeria"), [183, 154, 117], "the palette still comes first where it has the country");
});

test("a country with no colour of its own takes the palette's under a former or other name", () => {
  const resolve = createOwnerRgbResolver(
    { "Kingdom of Spain": [193, 166, 110], France: [77, 120, 147] },
    {
      Spain: { name: "Spain", formerNames: ["Kingdom of Spain"] },
      "French Republic": { name: "French Republic", aliases: ["France"] },
    },
  );
  assert.deepEqual(resolve("Spain"), [193, 166, 110], "renamed: its colour is still under the old name");
  assert.deepEqual(resolve("French Republic"), [77, 120, 147], "the palette knows it by an alias");
  assert.deepEqual(resolve("kingdom of spain"), [193, 166, 110]);
});

test("an owner is read as a former name only when no country answers to it now", () => {
  const resolve = createOwnerRgbResolver({}, {
    Germany: { name: "Germany", color: "#111111", formerNames: ["Prussia"] },
    "Kingdom of Prussia": { name: "Kingdom of Prussia", aliases: ["Prussia"], color: "#222222" },
  });
  assert.deepEqual(resolve("Prussia"), [34, 34, 34], "the country that bears the name now, not the one that once did");
  assert.deepEqual(resolve("prussia "), [34, 34, 34]);
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
