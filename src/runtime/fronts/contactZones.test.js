// Run: node --test src/runtime/fronts/contactZones.test.js
// "I have the south eastern borders and the west, however the game only allows me to attack from the west" (a
// player, Greece at war with Türkiye while holding Syria, 2026-11-05): every stretch where the two sides of a war
// touch is a battlefield of its own, however far apart the stretches lie.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BATTLEFIELDS } from "./constants.js";
import { runFronts } from "./engine.js";
import { pointInFrame } from "./frame.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn } from "./testKit.js";
import { deployLinesOf } from "./deploy.js";
import { applyWarRoomOp, deployBattlefieldOf } from "./warRoomOps.js";

// Aland holds its own land in the north-west and land it took in the south-east, both touching Borduria a
// thousand kilometres apart (Greece in Thrace and in Syria, Türkiye between). Cisland and Dravia fight a
// war of their own in the far south.
const legend = { A: "Aland", S: { owner: "Aland", sovereign: "Sudland" }, B: "Borduria", C: "Cisland", D: "Dravia", "~": null };
const layout = [
  "AAABBBBBBBBBBBBBBBBBBBB",
  "AAABBBBBBBBBBBBBBBBBBBB",
  "~~~BBBBBBBBBBBBBBBBBBBB",
  "~~~BBBBBBBBBBBBBBBBBBBB",
  "~~~~~~~~~~~~~~~~~~SSSSS",
  "~~~~~~~~~~~~~~~~~~SSSSS",
  "~~~~~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~~~~~~~~~~~",
  "CCCDDD~~~~~~~~~~~~~~~~~",
  "CCCDDD~~~~~~~~~~~~~~~~~",
];
const world = () => syntheticMap({ layout, legend, west: 20, north: 46, step: 1 });
// Where each stretch of the Aland-Borduria border is.
const WEST = [22.9, 45];
const SOUTH = [40.5, 41.9];
const covers = (records, [lng, lat]) => records.filter((record) => pointInFrame(record.frame, lng, lat));

test("a war whose sides touch in two places far apart opens a battlefield on each", () => {
  const sheet = world();
  const { battlefields } = runFronts(frontInput(sheet, { days: 0 }));
  assert.equal(battlefields.length, 2);
  assert.equal(covers(battlefields, WEST).length, 1);
  assert.equal(covers(battlefields, SOUTH).length, 1);
  assert.notEqual(covers(battlefields, WEST)[0].name, covers(battlefields, SOUTH)[0].name);
});

test("land the story hands a side during the run, touching the other side, opens a battlefield there that run", () => {
  // The south-east is Sudland's as the run begins; the war with Borduria begins, and on the same day a peace
  // with Sudland hands its land to Aland (wars are told before the map on a day, frontTurn.js planFrontMoments).
  const sheet = syntheticMap({ layout, legend: { ...legend, S: "Sudland" }, west: 20, north: 46, step: 1 });
  const southern = sheet.regions.filter((region) => sheet.controllerOf(region.id) === "Sudland").map((region) => region.id);
  const moments = [
    { day: 0, type: "war", warId: "war-1", op: "start", names: ["Aland"], opponents: ["Borduria"], title: "aland-war" },
    ...southern.map((regionId) => ({ day: 0, type: "control", regionId, to: "Aland", ref: "peace" })),
  ];
  const { battlefields } = runFronts(frontInput(sheet, { days: 0, wars: [], moments, arenas: new Map() }));
  const ours = battlefields.filter((record) => record.warId === "war-1" && record.status !== "closed");
  assert.equal(ours.length, 2);
  assert.equal(covers(ours, WEST).length, 1);
  assert.equal(covers(ours, SOUTH).length, 1);
});

test("a stretch left without a battlefield for want of room gets one once there is room", () => {
  const sheet = world();
  const arenas = new Map();
  // Cisland and Dravia's war fills the world's battlefields but one.
  const southern = sheet.frame({ bounds: { west: 20, south: 33, east: 26, north: 35 }, marginKm: 10 });
  const fillers = Array.from({ length: MAX_BATTLEFIELDS - 1 }, (_, index) => ({
    ...battlefieldOn(sheet, { name: `Cisland - Dravia front ${index + 1}`, sides: [["Cisland"], ["Dravia"]], frame: southern }),
    warId: "war-2",
  }));
  const wars = (other) => [
    { id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"] },
    { id: "war-2", title: "the southern war", status: other, sideA: ["Cisland"], sideB: ["Dravia"] },
  ];
  const first = runFronts(frontInput(sheet, { days: 0, arenas, battlefields: fillers, wars: wars("active") }));
  const ours = (records) => records.filter((record) => record.warId === "war-1" && record.status !== "closed");
  assert.equal(ours(first.battlefields).length, 1, "room for one");
  assert.equal(first.notes.filter((note) => note.kind === "too-many-battlefields").length, 1);
  // The southern war ends and its battlefields close: the stretch that had no room has it now.
  const second = runFronts(frontInput(sheet, { days: 0, arenas, battlefields: first.battlefields, wars: wars("ended"), fromDate: "2024-03-02" }));
  assert.equal(ours(second.battlefields).length, 2, "the other stretch is opened");
  assert.equal(covers(ours(second.battlefields), WEST).length, 1);
  assert.equal(covers(ours(second.battlefields), SOUTH).length, 1);
});

test("a deployment drawn over the war's other stretch of border goes to that stretch's battlefield", () => {
  const sheet = world();
  const { battlefields } = runFronts(frontInput(sheet, { days: 0 }));
  const [west] = covers(battlefields, WEST);
  const [south] = covers(battlefields, SOUTH);
  // Drawn with the western battlefield shown, behind the southern line.
  const line = [[38.6, 41.3], [42.4, 41.3]];
  const op = { op: "deploy", battlefield: west.name, way: line };
  assert.equal(deployBattlefieldOf(battlefields, op, "Aland"), south.name);
  const done = applyWarRoomOp(battlefields, op, { player: "Aland", date: "2024-03-01" });
  assert.equal(done.error, undefined);
  assert.equal(done.record.name, south.name);
  assert.equal(deployLinesOf(done.record, done.side).length, 1);
  assert.equal(deployLinesOf(done.battlefields.find((row) => row.name === west.name), 0).length, 0, "nothing drawn on the western one");
  // One drawn over the battlefield shown stays there; one over neither is refused as before.
  assert.equal(deployBattlefieldOf(battlefields, { ...op, way: [[21, 45.5], [21, 44.5]] }, "Aland"), west.name);
  assert.match(applyWarRoomOp(battlefields, { ...op, way: [[70, 10], [71, 10]] }, { player: "Aland" }).error, /does not cross the battlefield/);
  // Nor is a battlefield the asker is not on, or of another war, ever taken for it.
  assert.equal(deployBattlefieldOf(battlefields, op, "Syldavia"), west.name);
  assert.equal(deployBattlefieldOf(battlefields.map((row) => (row === south ? { ...row, warId: "war-9" } : row)), op, "Aland"), west.name);
});
