/*! Open Historia — the war room's Deploy Aircraft: where it is wired: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/warRoomAircraft.test.js
//
// What an air strike is and does is tested where it lives (runtime/fronts/
// airStrike.test.js; Game/AI/airStrikeTurn.test.js). This is the war room's
// hold on it: the key on the rail, the plate beside it, the click on the map
// and the ring that follows the pointer, the op sent through the war room's
// seam, the request a shared game carries, and what each player is shown.
// The components cannot be loaded under plain node, so where they are wired is
// read as text.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAP_LAYER_ORDER } from "../Map/mapLayerOrder.js";
import { WAR_ROOM_TOOLS, closeWarRoom, getWarRoom, openWarRoom, setWarRoom, takeTool } from "../Map/warRoomStore.js";
import { airFeatures } from "../Map/warRoomMarks.js";
import { PLAYER_REQUESTS } from "../../multiplayer/game/messages.js";
import { validate } from "../../multiplayer/protocol/validate.js";
import { PUBLIC_WORLD_KEYS, projectWorld } from "../../multiplayer/host/projection.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const rail = read("warRoomRail.jsx");
const panel = read("warRoom.jsx");
const plate = read("warRoomAircraft.jsx");
const tools = read("../Map/WarRoomTools.jsx");
const marks = read("../Map/WarRoomMarks.jsx");
const writes = read("../../runtime/warRoomWrites.js");
const host = read("../../multiplayer/host/gameHost.js");

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
  assert.match(tools, /if \(tool === "aircraft"\) \{\s*if \(\(done\.moved \?\? 0\) >= CLICK_PX\) return;[\s\S]*?reportWarRoomWay\("aircraft", \[\[unwrapLng\(place\.lng, 0\), place\.lat\]\], \{ wing, kind: strikeKind, radius: strikeRadius \}\);/);
  assert.match(tools, /if \(tool === "aircraft"\) setAim\(ringAt\(at\(event\)\)\);/);
  assert.match(tools, /const km = Number\(getWarRoom\(\)\.blast\);/);
  assert.match(tools, /<circle cx=\{aim\.x\} cy=\{aim\.y\} r=\{aim\.r\} fill="rgba\(43, 193, 243, 0\.14\)" stroke=\{ACCENT\}/);
  // The panel sends what was clicked: troops there, the structure or the city nearest it.
  assert.match(panel, /\} else if \(drawn === "aircraft" && extra\?\.wing && way\[0\]\) \{[\s\S]*?await orderWith\(sendAirStrikeOp, \{ \.\.\.\(await strikeAtRef\.current\(extra\.wing, extra\.kind, way\[0\]\)\), radius: strikeRadiusOf\(extra\.radius\) \}\);/);
  assert.match(panel, /return \{ op: "airstrike", unit, kind: "troops", to: \[lng, lat\], battlefield: name, target: placeNear\(lng, lat\) \};/);
  assert.match(panel, /const found = near\(strikableStructures\(world, game\.country\)\);/);
  assert.match(panel, /const country = enemies\.find\(\(name\) => chart\?\.holds\?\.\(name, Number\(city\.lng\), Number\(city\.lat\)\) === true\)/);
  // The ring is as wide as the strike radius set.
  assert.match(panel, /setWarRoom\(\{ blast: airBlast \* strikeRadiusOf\(strikeRadius\) \}\)/);
});

test("the strike radius: set on the plate, carried by the click, a waiting strike ordered again with it; shut, it forgets", () => {
  try {
    openWarRoom("The Front", 0);
    assert.equal(getWarRoom().strikeRadius, 1, "the default: the strike as it always was");
    setWarRoom({ strikeRadius: 0.5 });
    assert.equal(getWarRoom().strikeRadius, 0.5);
  } finally {
    closeWarRoom();
  }
  assert.equal(getWarRoom().strikeRadius, 1);
  // A step a radius, each the blast's kilometres; the hint is the control's own.
  assert.match(plate, /<div role="radiogroup" aria-label="Strike radius"[^>]*>\s*\{AIR_STRIKE_RADII\.map\(\(step\) => \{/);
  assert.match(plate, /onClick=\{\(\) => onRadius\(step\)\}/);
  assert.match(plate, /\{blast > 0 && \(/, "none in an era whose bombs fall nowhere");
  assert.match(panel, /onRadius=\{setStrikeRadius\}/);
  assert.match(panel, /radius=\{strikeRadiusOf\(strikeRadius\)\}\s*blast=\{airBlast\}/);
  // A strike waiting is ordered again at the same target with the radius set, and its own radius is shown when picked.
  assert.match(panel, /const setStrikeRadius = async \(radius\) => \{[\s\S]*?const done = await orderWith\(sendAirStrikeOp, \{\s*op: "airstrike",\s*unit: order\.unit,\s*kind: order\.kind,\s*to: \[order\.lng, order\.lat\],[\s\S]*?radius: strikeRadiusOf\(radius\),\s*\}\);\s*if \(!done\) setWarRoom\(\{ strikeRadius: strikeRadiusOf\(order\.radius\) \}\);/);
  assert.match(panel, /if \(pickedOrderRadius > 0\) setWarRoom\(\{ strikeRadius: pickedOrderRadius \}\);/);
  // On the map each ring is as wide as its own strike's radius.
  const ring = (radius) => {
    const [feature] = airFeatures({ blast: 20, orders: [{ lng: 22, lat: 0, ...(radius ? { radius } : {}) }] }).features;
    return Math.max(...feature.geometry.coordinates[0].map(([lng]) => lng)) - 22;
  };
  assert.ok(Math.abs(ring(2) / ring() - 2) < 0.01 && Math.abs(ring(0.5) / ring() - 0.5) < 0.01, `${ring(0.5)} ${ring()} ${ring(2)}`);
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

test("the seam: the host in a shared game, the write queue otherwise, never while a turn runs; the map read for a city", () => {
  assert.match(writes, /export const sendAirStrikeOp = async \(op, \{ turnRunning = \(\) => false, readChart = async \(\) => null \} = \{\}\) => \{/);
  assert.match(writes, /const apply = \(world, given, context\) => applyAirStrikeOp\(world, given, \{ \.\.\.context, air: activeWars\(\)\.air \}\);/);
  assert.match(writes, /await sendHeldToMap\(sent, \{ request: "airstrike", apply, needsChart: sent\.op === "airstrike" && sent\.kind === "city" \}, \{ turnRunning, readChart \}\);/);
  assert.equal(writes.split("if (turnRunning()) throw new Error(TURN_RUNNING_REFUSAL);").length - 1, 3, "the strike goes the fleets' way: no seam of its own");
  // The host: the seat's own country, its own map, not while a round is resolved, and not in a scenario without air units.
  assert.match(host, /airstrike: async \(connection, \{ op \}, seat\) => \{\s*if \(round\.status\(\)\.phase === "resolving"\)/);
  assert.match(host, /applyAirStrikeOp\(world, sent, \{ player: seat\.country, date: clean\(game\?\.gameDate\), round: game\?\.round, chart, air: activeWars\(\)\.air \}\)/);
});

test("a shared game carries a strike as a request of its own, held to its size; a strike waiting is its owner's to see", () => {
  const ask = (op) => validate(PLAYER_REQUESTS.airstrike, { t: "airstrike", id: "00000000000000a1", op });
  assert.equal(ask({ op: "airstrike", unit: "u1", kind: "city", to: [21, 57.5], target: "Riga", country: "Latvia", people: 600000 }).ok, true);
  assert.equal(ask({ op: "unairstrike", unit: "u1" }).ok, true);
  assert.equal(ask({ op: "airstrike", unit: "u1", to: [[[21]]] }).ok, false, "nothing nested past what an order has");
  assert.equal(validate(PLAYER_REQUESTS.airstrike, { t: "airstrike", id: "00000000000000a1", op: { op: "unairstrike", unit: "u1" }, extra: 1 }).ok, false, "and nothing beside it");
  assert.ok(PUBLIC_WORLD_KEYS.includes("airStrikes"), "what was struck is known to all");
  const world = {
    units: [],
    airStrikeOrders: [
      { id: "a", unit: "u1", owner: "Russia", kind: "city", lng: 24, lat: 56.9, target: "Riga", country: "Latvia" },
      { id: "b", unit: "u2", owner: "Latvia", kind: "city", lng: 30.3, lat: 59.9, target: "Saint Petersburg", country: "Russia" },
    ],
  };
  assert.deepEqual(projectWorld(world, "Latvia").airStrikeOrders.map((order) => order.id), ["b"], "where Russia's bombers are sent is Russia's to know");
});
