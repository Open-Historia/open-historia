/*! Open Historia — a time skip names regions, never their ids: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/promptNamesNotIds.test.js
//
// The owner's rule: what the AI reads names a region by its name, and writes
// "region: X" only where the name alone could be another region or a country
// (nameRefs.js regionNamer). Two places still printed the map's keys: the
// event history's impact lines ("Control: 2102 -> Russian Federation", from an
// operation saved without its name) and the group areas ("Donetsk (2103)").
// The Native World Director's pressures did too ("Active territorial
// pressure: GEO.11_1").
//
// The skip is built by the game itself, from a fixture save, by the same rig
// that measures it (scripts/prompt-size.mjs): nothing is sent anywhere.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// A small map: numeric keys like a hand-drawn scenario's, and a stock-style key.
// "Georgia" is a US state beside the country of that name; two regions share
// "Lincoln".
const square = (x, y) => ({ type: "Polygon", coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
const REGIONS = [
  { id: "2101", name: "Kyiv", country: "Ukraine", at: [30, 50] },
  { id: "2102", name: "Donetsk", country: "Ukraine", at: [37, 48] },
  { id: "2103", name: "Luhansk", country: "Ukraine", at: [39, 48] },
  { id: "2104", name: "Zaporizhzhia", country: "Ukraine", at: [35, 47] },
  { id: "313", name: "Belgorod", country: "Russian Federation", at: [36, 50] },
  { id: "GEO.11_1", name: "Shida Kartli", country: "Georgia", at: [44, 42] },
  { id: "USA.11_1", name: "Georgia", country: "United States", at: [-83, 32] },
  { id: "4441", name: "Lincoln", country: "United States", at: [-96, 40] },
  { id: "4442", name: "Lincoln", country: "United Kingdom", at: [0, 53] },
];
const IDS = REGIONS.map((region) => region.id);

const regionsGeojson = {
  type: "FeatureCollection",
  features: REGIONS.map((region) => ({
    type: "Feature",
    properties: { id: region.id, name: region.name, country: region.country },
    geometry: square(...region.at),
  })),
};

const event = (id, date, title, impacts) => ({
  id, date, title, description: `${title}.`, impacts: {
    regionTransfers: [], regionControlOps: [], regionClaims: [], groupOps: [], polityChanges: [], ...impacts,
  },
});

const save = {
  game: { country: "Ukraine", gameDate: "2026-03-01", startDate: "2026-01-01", round: 3, language: "English", difficulty: "standard" },
  world: {
    // Saved without their names, as an old turn wrote them.
    regionOwnershipOverrides: { 2102: "Russian Federation", 2104: "Russian Federation", "USA.11_1": "Georgia" },
    regionSovereigntyOverrides: { 2102: "Ukraine", 2104: "Ukraine" },
    regionClaimants: { 2104: ["Ukraine"], "GEO.11_1": ["Georgia"] },
    groups: { "Wagner Group": { description: "A private army fighting for Moscow.", color: "#444444" } },
    groupAreas: { 2103: "Wagner Group", 4441: "Wagner Group", 4442: "Wagner Group" },
    polityOverrides: {},
    units: [],
  },
  events: [
    event("e1", "2026-01-20", "Donetsk falls", {
      regionControlOps: [
        { op: "control", regionId: "2102", toCode: "Russian Federation", fromCode: "Ukraine" },
        { op: "control", regionId: "313", toCode: "Ukraine", fromCode: "Russian Federation" },
        { op: "contest", regionId: "4441", actorCode: "Wagner Group", fromCode: "United States" },
      ],
    }),
    event("e2", "2026-02-10", "Georgia secedes", {
      regionTransfers: [{ regionId: "USA.11_1", toCode: "Georgia" }],
      regionControlOps: [{ op: "control", regionId: "2104", toCode: "Russian Federation", fromCode: "Ukraine" }],
    }),
  ],
  actions: [],
  chat: [],
};

const writeSave = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-names-not-ids-"));
  for (const [name, value] of Object.entries(save)) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value));
  fs.writeFileSync(path.join(dir, "regions.geojson"), JSON.stringify(regionsGeojson));
  return dir;
};

const buildSkip = () => {
  const dir = writeSave();
  const dump = path.join(dir, "prompt.txt");
  try {
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "prompt-size.mjs"), dir, "--dump", dump], {
      cwd: root, encoding: "utf8", timeout: 240000,
    });
    assert.equal(run.status, 0, `the rig failed:\n${run.stdout}\n${run.stderr}`);
    return fs.readFileSync(dump, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// A region's key standing as a word of its own: "2102", "GEO.11_1".
const idPattern = new RegExp(`(?<![\\w.])(${IDS.map((id) => id.replace(/[.]/g, "\\.")).join("|")})(?![\\w.])`);

test("a skip's prompt names every region of its impact lines and group areas, never an id", { timeout: 300000 }, () => {
  const prompt = buildSkip();
  const lines = prompt.split("\n");
  const impactLines = lines.filter((line) => /^\s*(Control|Territorial shifts): /.test(line) || /\|\s*(Control|Territorial shifts): /.test(line));
  assert.ok(impactLines.length >= 2, `the events' impact lines are in the prompt:\n${impactLines.join("\n")}`);
  for (const line of impactLines) assert.doesNotMatch(line, idPattern, `an id in an impact line: ${line}`);
  const control = impactLines.find((line) => line.includes("Donetsk"));
  assert.ok(control, "the control op saved as 2102 reads as Donetsk");
  assert.match(control, /Control: Donetsk -> Russian Federation \(from Ukraine\)/);
  assert.match(control, /Belgorod -> Ukraine \(from Russian Federation\)/);
  // A name two regions share is said with its kind.
  assert.match(control, /region: Lincoln contested by Wagner Group/);
  // A region named like a country is said with its kind.
  assert.ok(impactLines.some((line) => /Territorial shifts: region: Georgia -> Georgia/.test(line)), impactLines.join("\n"));

  const group = lines.find((line) => line.startsWith("- Wagner Group"));
  assert.ok(group, "the group is in the prompt");
  assert.doesNotMatch(group, idPattern, `an id in the group areas: ${group}`);
  assert.match(group, /controls 3 regions: Luhansk, region: Lincoln, region: Lincoln/);

  // The director's pressures name the region they are about.
  const pressures = lines.filter((line) => /Active territorial pressure: /.test(line));
  for (const line of pressures) assert.doesNotMatch(line, idPattern, `an id in a pressure: ${line}`);

  // And nowhere in a line that places a region (an ownership row, a list).
  const placing = lines.filter((line) => /(->|controls \d+ region|pressure:|regions?: )/.test(line));
  for (const line of placing) assert.doesNotMatch(line, idPattern, `an id where a region is named: ${line}`);
});
