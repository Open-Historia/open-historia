import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortCountryRelations } from "./countryDiplomacyView.js";

const relations = [
  { counterpart: "BLR", counterpartName: "Republic of Belarus", score: 60, summary: "Friendly cooperation", displayStatus: "friendly" },
  { counterpart: "BFA", counterpartName: "Burkina Faso", score: -40, summary: "Reparations concluded", displayStatus: "strained" },
  { counterpart: "UKR", counterpartName: "Ukraine", score: 50, summary: "Regional support", displayStatus: "cordial" },
  { counterpart: "CHN", counterpartName: "People's Republic of China", score: -40, summary: "Trade dispute", displayStatus: "strained" },
];

test("diplomatic roster retains canonical relations and sorts strongest first without changing source", () => {
  const previous = relations.map((row) => row.counterpart);
  assert.deepEqual(filterAndSortCountryRelations(relations).map((row) => row.counterpart), ["BLR", "UKR", "BFA", "CHN"]);
  assert.deepEqual(relations.map((row) => row.counterpart), previous);
});

test("diplomatic roster supports weakest-first and alphabetic sort", () => {
  assert.deepEqual(filterAndSortCountryRelations(relations, { sort: "weakest" }).map((row) => row.counterpart), ["BFA", "CHN", "UKR", "BLR"]);
  assert.deepEqual(filterAndSortCountryRelations(relations, { sort: "alphabetical" }).map((row) => row.counterpart), ["BFA", "CHN", "BLR", "UKR"]);
});

test("search covers known country names, relationship descriptions, and statuses", () => {
  assert.deepEqual(filterAndSortCountryRelations(relations, { search: "  UKRAINE  " }).map((row) => row.counterpart), ["UKR"]);
  assert.deepEqual(filterAndSortCountryRelations(relations, { search: "reparations" }).map((row) => row.counterpart), ["BFA"]);
  assert.deepEqual(filterAndSortCountryRelations(relations, { search: "STRAINED" }).map((row) => row.counterpart), ["BFA", "CHN"]);
  assert.equal(filterAndSortCountryRelations(relations, { search: "absent" }).length, 0);
});

test("roster never manufactures rows or sorts missing scores as neutrality", () => {
  assert.deepEqual(filterAndSortCountryRelations(null), []);
  const missing = [...relations, { counterpart: "UNK", counterpartName: "Unknown partner" }];
  assert.equal(filterAndSortCountryRelations(missing)[4].counterpart, "UNK");
  assert.equal(filterAndSortCountryRelations(missing, { sort: "weakest" })[4].counterpart, "UNK");
  assert.equal(filterAndSortCountryRelations(missing, { sort: "alphabetical" }).length, 5);
});

test("Country drawer uses the compact interactive roster without bypassing diplomatic visibility", async () => {
  const fs = await import("node:fs");
  const stats = fs.readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
  assert.match(stats, /import \{ filterAndSortCountryRelations \} from "\.\/countryDiplomacyView\.js"/);
  assert.match(stats, /<DiplomacySection[^>]+onPick=\{setTargetCountry\}/);
  assert.match(stats, /<PeaceControls war=\{war\}/);
  assert.match(stats, /livePuppetsFor\(world, viewer\)/);
  assert.match(stats, /aria-expanded=\{expanded\}/);
  assert.match(stats, /Inspect country/);
});

test("Country diplomacy keeps stable rows and navigates only through the existing selected polity", async () => {
  const fs = await import("node:fs");
  const stats = fs.readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
  assert.match(stats, /rosterKey: relation\?\.id \? `id:\$\{relation\.id\}` : `entry:\$\{relationIndex\}`/);
  assert.match(stats, /key=\{targetCountry\} world=\{worldSnapshot\} identity=\{polityIndex\}/);
  assert.match(stats, /onClick=\{\(\) => onPick\(row\.puppetKey\)\}/);
  assert.match(stats, /Search bilateral relations/);
  assert.match(stats, /Sort bilateral relations/);
  assert.match(stats, /No relationships match the search/);
  assert.match(stats, /<span title=\{relation\.counterpartName\}/, "country names remain eligible for localization");
  assert.match(stats, /\{`−100 to \+100 · \$\{diplomacy\.relations\.length\} recorded`\}/, "the count is one translatable pattern, not fragmented words");
});
