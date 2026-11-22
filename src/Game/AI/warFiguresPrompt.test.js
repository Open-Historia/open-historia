// Run: node --test src/Game/AI/warFiguresPrompt.test.js
//
// A skip that started a war cost three requests: itself, then the military
// ratings of the war's countries and the people and economy of those in
// conflict with a player, each asked after the turn. "have it already contain
// that" (the owner, 2026-11-02): the skip writes those figures in its own
// answer, and the requests after it are made only for what it left out.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getGameplayTool, validateGameplayPayload, withFrontOrders, withWarFigures } from "./gameplaySchemas.js";
import { mergeSegmentPayloads } from "./jumpSegments.js";
import { WAR_FIGURES_FIELD, WAR_FIGURES_HEADING, WAR_FIGURES_WANTED_MOST, buildWarFiguresBlock, readWarFigures } from "./warFiguresPrompt.js";

test("the skip is told whose figures the war wants, the scale and the line to write", () => {
  const block = buildWarFiguresBlock({
    wanted: ["Ukraine", "Russia", "ukraine"],
    known: [{ name: "Germany", backend: { population: 83000000, gdp: 4000, budgetBalance: -1, publicDebt: 60 } }],
    rated: [{ name: "Germany", military: { quality: 70, technology: 80, land: 65, sea: 50, air: 70, spending: 75 } }, { name: "Poland", military: { quality: 60 } }],
  });
  assert.ok(block.startsWith(WAR_FIGURES_HEADING));
  assert.match(block, /NONE YET \(at war, and the game has no figures of them\): Ukraine, Russia$/m);
  assert.match(block, /^- Germany: people 83000000, economy 4000, budget -1, debt 60, quality 70, technology 80, land 65, sea 50, air 70, spending 75$/m);
  assert.match(block, /^- Poland: quality 60$/m);
  assert.match(block, /a line of warUpdates in this answer starts a war with or brings into one/);
  assert.match(block, /^Borduria \| people \d+ \| economy/m);
  assert.match(block, /tell none of them in an event/);
});

test("a world with no figures yet lets the skip set the scale, and asks of no more than the most", () => {
  const many = Array.from({ length: WAR_FIGURES_WANTED_MOST + 3 }, (_, index) => `Land ${index}`);
  const block = buildWarFiguresBlock({ wanted: many });
  assert.match(block, /no country has figures yet; yours set it/);
  assert.equal((block.match(/Land \d+/g) ?? []).length, WAR_FIGURES_WANTED_MOST);
  assert.match(buildWarFiguresBlock({}), /^NONE YET: none\.$/m);
});

test("the answer is read as the format writes it: its labels, plain digits, bars or colons, any order, percents", () => {
  const read = readWarFigures([
    "France | people 67000000 | economy 2800 | budget -4.5% | debt 110 | quality 72 | technology 82 | land 68 | sea 75 | air 78 | spending 80 | manpower 11 | cavalry 25% | siege 0.1",
    "- Belgium: air 45, people 11600000, economy 600, technology 75, sea 25",
    "the war goes on",
    "France | people 1 | quality 1",
    "Nowhere | colour blue",
    "Japan | People 125000000 | QUALITY 70.",
  ].join("\n"));
  assert.deepEqual(read, [
    {
      name: "France",
      backend: { population: 67000000, gdp: 2800, budgetBalance: -4.5, publicDebt: 110 },
      military: { quality: 72, technology: 82, land: 68, sea: 75, air: 78, spending: 80, manpowerShare: 11, cavalryShare: 0.25, siegeShare: 0.1 },
    },
    { name: "Belgium", backend: { population: 11600000, gdp: 600 }, military: { technology: 75, sea: 25, air: 45 } },
    { name: "Japan", backend: { population: 125000000 }, military: { quality: 70 } },
  ]);
  assert.deepEqual(readWarFigures(""), []);
  assert.deepEqual(readWarFigures(["Aland | quality 50", "Borduria | people 2000"]), [
    { name: "Aland", military: { quality: 50 } },
    { name: "Borduria", backend: { population: 2000 } },
  ]);
});

test("no synonym, number word or digit grouping is read, in any language: such a figure is unread, never misread", () => {
  // The reading took English synonyms ("pop", "tech", "navy", "armour",
  // "artillery"), English number words ("million") and commas or spaces as
  // thousands, so the same figure was read in English and lost, or misread,
  // in the next language ("4,2" is 4.2 in French; "1,234" is 1.234 in German).
  for (const piece of ["pop 47000000", "tech 70", "navy 30", "armour 0.3", "artillery 0.2", "population 47000000", "gdp 1400",
    "people 47,000,000", "people 47 000 000", "people 47.000.000", "people 47 million", "economy 1.4 billion", "budget -4,2", "people 4.2e7"]) {
    assert.deepEqual(readWarFigures(`Spain | ${piece}`), [], piece);
  }
  // A comma between pieces never cuts a figure in two.
  assert.deepEqual(readWarFigures("Spain: people 47,000,000, quality 60"), [{ name: "Spain", military: { quality: 60 } }]);
});

test("a game in another language reads the same figures as its English twin, the labels being the game's own", () => {
  const english = readWarFigures("Russia | people 146000000 | quality 60 | sea 55");
  for (const name of ["Россия", "俄罗斯", "Russie"]) {
    assert.deepEqual(readWarFigures(`${name} | people 146000000 | quality 60 | sea 55`), [{ ...english[0], name }], name);
  }
  // A label written in another language is none of the format's: the prompt
  // asks for them as shown, never translated.
  assert.deepEqual(readWarFigures("Россия | население 146000000 | качество 60"), []);
  const block = buildWarFiguresBlock({ wanted: ["Россия"] });
  assert.match(block, /Write the labels exactly as shown, never translated, and the figures in plain digits/);
  assert.match(block, /NONE YET \(at war, and the game has no figures of them\): Россия$/m);
});

test("the field is sent with fronts on, last and required, and every answer may carry it", () => {
  const tool = getGameplayTool("jumpForward");
  assert.ok(!(WAR_FIGURES_FIELD in tool.schema.properties), "not in the lean contract");
  const sent = withWarFigures(withFrontOrders(tool));
  const keys = Object.keys(sent.schema.properties);
  assert.equal(keys.at(-1), WAR_FIGURES_FIELD);
  assert.ok(keys.indexOf("frontOrders") < keys.indexOf(WAR_FIGURES_FIELD));
  assert.ok(sent.schema.required.includes(WAR_FIGURES_FIELD));
  assert.equal(withWarFigures(sent), sent);
  assert.equal(withWarFigures(getGameplayTool("gameMaster")), getGameplayTool("gameMaster"), "only a skip's tool");
  const answer = { events: [], stopDate: "2016-05-13", summary: "Quiet.", [WAR_FIGURES_FIELD]: "Aland | people 2000" };
  assert.equal(validateGameplayPayload("jumpForward", answer).valid, true);
});

test("every segment's lines reach the turn, and the turn keeps them before anything asks after it", () => {
  const merged = mergeSegmentPayloads([
    { events: [], warFigures: "Aland | people 2000\nBorduria | people 3000" },
    { events: [], warFigures: "" },
    { events: [], warFigures: "Carpathia | quality 40" },
  ]);
  assert.deepEqual(merged.warFigures, ["Aland | people 2000", "Borduria | people 3000", "Carpathia | quality 40"]);

  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(gameplay, /return frontsOn\(\) \? withWarFigures\(withFrontOrders\(shown\)\) : shown;/);
  assert.match(gameplay, /const figures = warFiguresBlockOf\(world, game\);\n {2}if \(figures\) blocks\.push\(figures\);/);
  assert.match(gameplay, /warFigures: merged\.warFigures,/);
  const kept = gameplay.indexOf("worldWithImpacts = keepWarFigures(worldWithImpacts, result.warFigures);");
  assert.ok(kept > 0);
  assert.ok(kept < gameplay.indexOf("requestConflictSheets(nextWorld, nextGame);"), "before the requests for what is left");
});
