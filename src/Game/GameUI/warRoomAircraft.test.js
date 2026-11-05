/*! Open Historia — the war room's Deploy Aircraft: where it is wired: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/warRoomAircraft.test.js
//
// What an air strike is and does is tested where it lives (runtime/fronts/
// airStrike.test.js; Game/AI/airStrikeTurn.test.js). This is the war room's
// hold on it: the key on the rail, the plate beside it, the click on the map
// and the ring that follows the pointer, and the op sent through the war room's
// seam. The components cannot be loaded under plain node, so where they are wired is
// read as text.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAP_LAYER_ORDER } from "../Map/mapLayerOrder.js";
import { WAR_ROOM_TOOLS, closeWarRoom, getWarRoom, openWarRoom, setWarRoom, takeTool } from "../Map/warRoomStore.js";
import { airFeatures } from "../Map/warRoomMarks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const rail = read("warRoomRail.jsx");
const panel = read("warRoom.jsx");
const plate = read("warRoomAircraft.jsx");
const tools = read("../Map/WarRoomTools.jsx");
const marks = read("../Map/WarRoomMarks.jsx");
const writes = read("../../runtime/warRoomWrites.js");

test("the rail has an Aircraft key beside Deploy, only where the scenario has air units", () => {
  assert.match(rail, /onClick=\{\(\) => onTool\("deploy"\)\}><DeployIcon \/><\/RailKey>\s*\{\/\*[^*]*\*\/\}\s*\{aircraft && <RailKey label="Aircraft" title="Deploy Aircraft: [^"]*" on=\{aircraftOut \|\| tool === "aircraft"\} disabled=\{wings === 0\} onClick=\{onAircraft\}>/);
  assert.match(rail, /tool === "aircraft" && <>Click what the air unit is to strike\. Its bombs fall inside the ring, on your own troops there too\./);
  // The panel: the key's plate, which shuts the fleets' (and theirs shuts it).
  assert.match(panel, /aircraft=\{aircraft\}\s*wings=\{wings\.length\}\s*aircraftOut=\{aircraftOut\}\s*onAircraft=\{\(\) => setWarRoom\(\{ aircraft: !getWarRoom\(\)\.aircraft, fleets: false \}\)\}/);
  assert.match(panel, /const aircraft = airOn\(\);/);
  // The whole world, so that a front's air arm is counted (airArmsOf reads the battlefields).
  assert.match(panel, /const wings = useMemo\(\(\) => \(aircraft \? airUnitsOf\(world, game\.country\) : \[\]\), \[aircraft, world, game\.country\]\);/);
  assert.match(panel, /\{railShown && !draft && !fleetsOut && aircraftOut && \(\s*<AircraftPlate/);
  assert.match(panel, /<AircraftList orders=\{strikesWaiting\} flown=\{strikesFlown\} names=\{wingName\} onPick=\{pickWing\} \/>/);
});

test("the plate: an air unit picked out, what it strikes, and the key that takes up the tool; a strike called off", () => {
  assert.match(plate, /export const STRIKE_KINDS = Object\.freeze\(\["troops", "structure", "city"\]\);/);
  assert.match(plate, /onClick=\{\(\) => onKind\(entry\)\}/);
  assert.match(plate, /onClick=\{onAim\}/);
  assert.match(plate, /onClick=\{\(\) => onCallOff\(wing\.id\)\}/);
  assert.match(panel, /onAim=\{\(\) => takeTool\("aircraft"\)\}/);
  assert.match(panel, /onCallOff=\{\(unit\) => orderWith\(sendAirStrikeOp, \{ op: "unairstrike", unit \}\)\}/);
  // Every outcome is said.
  for (const outcome of ["unopposed", "through", "partly", "turned back", "out of reach"]) assert.ok(plate.includes(`strike.outcome === "${outcome}"`), outcome);
  // Names are the game's own text: not translated.
  assert.match(plate, /<span data-no-translate style=\{\{ flex: 1, [^}]*\}\}>\{entry\.name\}<\/span>/);
  assert.match(plate, /const TargetName = \(\{ order \}\) => <span data-no-translate>/);
});

test("the tool: a click names what is struck, a drag moves the map, and a ring the size of the blast follows the pointer", () => {
  assert.ok(WAR_ROOM_TOOLS.includes("aircraft"));
  try {
    openWarRoom("The Front", 0);
    takeTool("aircraft");
    assert.equal(getWarRoom().tool, "aircraft");
    takeTool("aircraft");
    assert.equal(getWarRoom().tool, "pan", "taken up again, it is put down");
    setWarRoom({ aircraft: true, wing: "u1", strikeKind: "city", blast: 20 });
    assert.deepEqual([getWarRoom().aircraft, getWarRoom().wing, getWarRoom().strikeKind, getWarRoom().blast], [true, "u1", "city", 20]);
  } finally {
    closeWarRoom();
  }
  assert.deepEqual([getWarRoom().aircraft, getWarRoom().wing, getWarRoom().strikeKind], [false, "", "troops"], "shut, it forgets");
  assert.match(tools, /if \(tool === "aircraft"\) \{\s*if \(\(done\.moved \?\? 0\) >= CLICK_PX\) return;[\s\S]*?reportWarRoomWay\("aircraft", \[\[unwrapLng\(place\.lng, 0\), place\.lat\]\], \{ wing, kind: strikeKind \}\);/);
  assert.match(tools, /if \(tool === "aircraft"\) setAim\(ringAt\(at\(event\)\)\);/);
  assert.match(tools, /const km = Number\(getWarRoom\(\)\.blast\);/);
  assert.match(tools, /<circle cx=\{aim\.x\} cy=\{aim\.y\} r=\{aim\.r\} fill="rgba\(43, 193, 243, 0\.14\)" stroke=\{ACCENT\}/);
  // The panel sends what was clicked: troops there, the structure or the city nearest it.
  assert.match(panel, /\} else if \(drawn === "aircraft" && extra\?\.wing && way\[0\]\) \{[\s\S]*?await orderWith\(sendAirStrikeOp, await strikeAtRef\.current\(extra\.wing, extra\.kind, way\[0\]\)\);/);
  assert.match(panel, /return \{ op: "airstrike", unit, kind: "troops", to: \[lng, lat\], battlefield: name, target: placeNear\(lng, lat\) \};/);
  assert.match(panel, /const found = near\(strikableStructures\(world, game\.country\)\);/);
  assert.match(panel, /const country = enemies\.find\(\(name\) => chart\?\.holds\?\.\(name, Number\(city\.lng\), Number\(city\.lat\)\) === true\)/);
  assert.match(panel, /setWarRoom\(\{ blast: airBlast \}\)/);
});

test("on the map: the reach of the air unit picked out, and rings where the bombs of each strike fall, under the units' counters", () => {
  const ids = ["warroom-air-reach", "warroom-air-blast", "warroom-air-edge", "warroom-air-target"];
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  for (const id of ids) {
    assert.match(marks, new RegExp(`id="${id}"`));
    assert.ok(index(id) > index("warroom-fleets-ring") && index(id) < index("units-fill"), id);
  }
  const data = airFeatures({
    wing: { lng: 20, lat: 50 },
    reach: 900,
    blast: 20,
    orders: [{ lng: 22, lat: 50 }],
    flown: [{ lng: 23, lat: 50, outcome: "through" }, { lng: 24, lat: 50, outcome: "turned back" }, { lng: 25, lat: 50, outcome: "gone" }],
  });
  const whats = data.features.map((feature) => feature.properties.what);
  assert.deepEqual(whats, ["reach", "aim", "aim-at", "struck", "struck-at", "struck", "struck-at"]);
  // Waiting in the accent; what got through in red, what turned back in grey. No purple.
  const colours = data.features.map((feature) => feature.properties.colour);
  assert.deepEqual([...new Set(colours)], ["#2bc1f3", "#e0454d", "#9aa3ad"]);
  assert.equal(airFeatures({ blast: 20 }).features.length, 0);
});

test("the seam: the write queue, never while a turn runs; the map read for a city", () => {
  assert.match(writes, /export const sendAirStrikeOp = async \(op, \{ turnRunning = \(\) => false, readChart = async \(\) => null \} = \{\}\) => \{/);
  assert.match(writes, /const apply = \(world, given, context\) => applyAirStrikeOp\(world, given, \{ \.\.\.context, air: activeWars\(\)\.air \}\);/);
  assert.match(writes, /await sendHeldToMap\(sent, \{ apply, needsChart: sent\.op === "airstrike" && sent\.kind === "city" \}, \{ turnRunning, readChart \}\);/);
  assert.equal(writes.split("if (turnRunning()) throw new Error(TURN_RUNNING_REFUSAL);").length - 1, 3, "the strike goes the fleets' way: no seam of its own");
});
