// Run: node --test src/runtime/fronts/brief.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { describeBattlefield } from "./brief.js";
import { BRIEF_TEXT_MAX } from "./constants.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn } from "./testKit.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.5, lat: 50.6 },
  { name: "Brod", lng: 22.1, lat: 50 },
  { name: "Northgate", lng: 21.2, lat: 50.9 },
  { name: "Southwick", lng: 21.2, lat: 49.1 },
  { name: "Midford", lng: 21.3, lat: 50.05 },
];
const world = () => syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, cities });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));
const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "The front", side, order: word, sector: "all", ...extra });

test("the brief says where the line runs, how strong each side is and what moved, in names", () => {
  const sheet = world();
  const record = battlefieldOn(sheet, { troops: [row(20.9, 49, 51, 12), row(21.1, 49, 51, 5, { strength: 45 })], pool: [400, 20] });
  const moments = [
    order(0, "Aland", "spearhead", { sector: "centre", objective: "city: Brod", effort: "total" }),
    order(0, "Borduria", "dig in"),
    order(3, "Aland", "advance", { sector: "north" }),
  ];
  const result = runFronts(frontInput(sheet, { battlefields: [record], days: 6, moments, steering: { even: true, wander: 0 } }));
  const [saved] = result.battlefields;
  const { brief } = saved;
  assert.ok(brief.km > 200 && Number.isInteger(brief.km));
  assert.equal(brief.axis, "north-south");
  // The way the line mostly runs comes first; a salient this deep has an east and a west as well.
  assert.deepEqual(brief.sectors.map((sector) => sector.name).slice(0, 3), ["north", "centre", "south"]);
  assert.equal(brief.since, "2024-03-01");
  const centre = brief.sectors[1];
  assert.ok(centre.moved > 20, `side A gained ${centre.moved} km in the centre`);
  assert.ok(brief.sectors[2].moved < centre.moved / 2, "and little in the south");
  assert.ok(centre.n[0] >= 1 && centre.n[0] + brief.sectors[0].n[0] + brief.sectors[2].n[0] === 12, "every troop is counted in one sector");
  assert.match(centre.from, /^(city|region): /);
  assert.deepEqual(brief.strength.map((side) => side.reserves), ["ample", "none"]);
  assert.equal(brief.strength[0].n, 12);
  assert.ok(brief.strength[1].pct < 60);
  assert.ok(brief.cities[0].includes("Brod") || brief.taken[0].length > 0);

  // Where the line runs, in the regions it crosses, and what each side holds of the other's land (lineGeography).
  assert.ok(brief.along.length > 0 && brief.along.every((name) => /^(Aland|Borduria) \d/.test(name)), "the regions it crosses, by name");
  assert.deepEqual(brief.holds[1], { cities: [], regions: [], more: 0 }, "Borduria holds none of Aland's land");
  assert.ok(brief.holds[0].cities.some((city) => city.name === "Midford"), "Aland's spearhead holds Midford, on Borduria's land");

  const text = describeBattlefield(saved, { max: 1400 });
  const lines = text.split("\n");
  assert.equal(lines[0], `- The front: Aland against Borduria, open since 2024-01-01, line ${brief.km} km`);
  assert.match(lines[1], /^ {2}Strength: Aland 12 formations \(\d+%\), reserves ample; Borduria \d formations \(\d+%\), reserves none$/);
  assert.match(lines[2], /^ {2}Line: north: (city|region): .+; centre: .+; south: .+$/);
  assert.match(lines[3], /^ {2}The line runs north to south through region: /);
  assert.match(lines[4], /^ {2}Occupied: Aland holds city: Midford, .*of Borduria's land\.$/);
  assert.match(lines[5], /^ {2}Since 2024-03-01: Aland advanced \d+ km in the (north|centre)/);
  assert.equal(lines[6], "  Standing orders: Aland: centre spearhead toward city: Brod (total); north advance; elsewhere hold. Borduria: all dig in (major).");
  assert.match(lines[7], /^ {2}Sectors: (north, centre, south(, [a-z]+)*|centre and all eight points of the compass), or a place on the line.$/);
  assert.equal(lines.length, 8);
  // In the room a skip gives each of many, where the line runs and who holds whose land are still told.
  const short = describeBattlefield(saved);
  assert.ok(short.length <= BRIEF_TEXT_MAX);
  assert.match(short, /\n {2}The line runs north to south through region: [^\n]+\n {2}Occupied: Aland holds city: Midford/);
  assert.doesNotMatch(short, /Line: (\n|$)/, "never a line with nothing after it");
  // A leader is told his own side's standing orders and not the other's.
  assert.equal(describeBattlefield(saved, { viewer: "borduria", max: 1400 }).split("\n")[6], "  Standing orders: Borduria: all dig in (major).");
  assert.equal(describeBattlefield(saved, { viewer: "Aland", max: 1400 }).split("\n")[6], "  Standing orders: Aland: centre spearhead toward city: Brod (total); north advance; elsewhere hold.");
  assert.equal(describeBattlefield(saved, { viewer: "Neutralia", max: 1400 }), text, "someone outside it sees what everyone sees");
  // Nothing in it is an id.
  for (const region of sheet.regions) assert.ok(!text.includes(region.id), `no id (${region.id})`);
  assert.doesNotMatch(text, /\br\d+-\d+\b/);
  assert.doesNotMatch(JSON.stringify({ ...brief, carry: undefined }), /\br\d+-\d+\b/, "nor in the brief itself");
  assert.equal(describeBattlefield(null), "");
});

test("however much has happened, the text of a battlefield stays within its length", () => {
  const sheet = world();
  const record = battlefieldOn(sheet, { troops: [row(20.9, 49, 51, 6), row(21.1, 49, 51, 6)] });
  const long = (count, word) => Array.from({ length: count }, (_, index) => `${word} of the Seven Rivers and the Upper Marches ${index + 1}`);
  const busy = {
    ...record,
    name: "The Great Northern and Eastern Front of the Second Continental War, Year Three",
    sides: [
      ["The United Provinces of Aland", "The Kingdom of Cisland", "The Free Cities", "The Western League", "The Duchy of Vance"],
      ["The Bordurian Commonwealth", "The Eastern Confederation", "The Mountain Clans", "The River Princes"],
    ],
    orders: [
      ...["north", "centre", "south", "city: Midford", "northeast", "all"].map((sector) => ({ s: 0, sector, order: "spearhead", objective: "city: The Old Capital on the Far Shore", since: "2024-03-01" })),
      ...["north", "centre", "south", "city: Northgate", "southwest", "all"].map((sector) => ({ s: 1, sector, order: "fall back", objective: "region: The Hinterland Beyond the Hills", since: "2024-03-01" })),
    ],
    brief: {
      km: 1480,
      axis: "north-south",
      sectors: ["north", "centre", "south", "east", "west", "northeast", "southwest", "southeast", "northwest"].map((name, index) => ({
        name,
        from: `city: ${long(1, "Fortress")[0]}`,
        to: `region: ${long(1, "Province")[0]}`,
        n: [20, 14],
        moved: (index % 2 === 0 ? 1 : -1) * (40 + index),
      })),
      strength: [{ n: 96, pct: 87, reserves: "ample" }, { n: 71, pct: 64, reserves: "thin" }],
      taken: [long(14, "Province"), long(9, "County")],
      cities: [long(6, "Fortress"), long(4, "Harbour")],
      pockets: [{ s: 1, at: `city: ${long(1, "Citadel")[0]}`, days: 7 }, { s: 0, at: "city: Midford", days: 2 }, { s: 1, at: "city: Brod", days: 1 }],
      since: "2024-03-01",
    },
  };
  for (const viewer of ["", "The Kingdom of Cisland", "The Mountain Clans"]) {
    const text = describeBattlefield(busy, { viewer });
    assert.ok(text.length <= BRIEF_TEXT_MAX, `${text.length} characters`);
    assert.ok(text.length > 400, "and it still says something");
    assert.ok(text.startsWith("- The Great Northern and Eastern Front"));
  }
  assert.equal(BRIEF_TEXT_MAX, 700);
});
