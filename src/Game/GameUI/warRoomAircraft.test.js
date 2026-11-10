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

test("the strike radius: a slider with no figure, carried by the click, a waiting strike ordered again once it is let go; shut, it forgets", () => {
  try {
    openWarRoom("The Front", 0);
    assert.deepEqual([getWarRoom().strikeRadius, getWarRoom().sizing], [1, false], "the default: the strike as it always was");
    setWarRoom({ strikeRadius: 0.65, sizing: true });
    assert.deepEqual([getWarRoom().strikeRadius, getWarRoom().sizing], [0.65, true]);
  } finally {
    closeWarRoom();
  }
  assert.deepEqual([getWarRoom().strikeRadius, getWarRoom().sizing], [1, false]);
  // "make the bombing radius be a slider not buttons, and dont have it actually say how big it is, just the visual
  // circle" (the owner, 2026-11-09): a range from the least radius to the most in the engine's steps, and no
  // kilometres, no figure, no keys.
  assert.match(plate, /<RadiusSlider radius=\{radius\} disabled=\{radiusLocked \|\| wing\.pending\} onRadius=\{onRadius\} onRadiusSet=\{onRadiusSet\} onSizing=\{onSizing\} \/>/);
  // Held only while a turn runs: not while one of its own orders is sent, which would take the keyboard's focus off it.
  assert.match(panel, /locked=\{locked\}\s*radiusLocked=\{turnRunning\}/);
  assert.match(plate, /type="range"\s*aria-label="Strike radius"[\s\S]*?min=\{AIR_STRIKE_RADIUS_LEAST\}\s*max=\{AIR_STRIKE_RADIUS_MOST\}\s*step=\{AIR_STRIKE_RADIUS_STEP\}\s*value=\{radius\}/);
  assert.doesNotMatch(plate, /AIR_STRIKE_RADII|role="radiogroup" aria-label="Strike radius"|blast \* /, "no keys and no kilometres");
  assert.doesNotMatch(plate, /aria-valuetext/, "nor a size read out");
  assert.match(plate, /style=\{\{ accentColor: RED, cursor: disabled \? "default" : "pointer", margin: 0, width: "100%" \}\}/, "styled as the game's other sliders, in the war room's red");
  assert.match(plate, /\{blast > 0 && \(/, "none in an era whose bombs fall nowhere");
  // As it moves the store follows (and the circles with it); let go, the order; pointed at, held or focused, the circle.
  assert.match(plate, /onChange=\{\(event\) => onRadius\(Number\(event\.target\.value\)\)\}/);
  assert.match(plate, /window\.addEventListener\("pointerup", letGo\);/, "a drag let go off the slider still sets it");
  assert.match(plate, /onKeyUp=\{\(\) => onRadiusSet\(valueOf\(\)\)\}/);
  assert.match(plate, /onPointerEnter=\{\(\) => \{\s*pointing\.current = true;\s*onSizing\(true\);/);
  assert.match(plate, /useEffect\(\(\) => \(\) => latest\.current\.onSizing\(false\), \[\]\);/, "taken away, it leaves no circle behind");
  assert.match(panel, /onRadius=\{setStrikeRadius\}\s*onRadiusSet=\{orderStrikeRadius\}\s*onSizing=\{\(sizing\) => setWarRoom\(\{ sizing \}\)\}/);
  assert.match(panel, /radius=\{strikeRadiusOf\(strikeRadius\)\}\s*blast=\{airBlast\}/);
  assert.match(panel, /const setStrikeRadius = \(radius\) => setWarRoom\(\{ strikeRadius: strikeRadiusOf\(radius\) \}\);/);
  // A strike waiting is ordered again at the same target with the radius set, and its own radius is shown when picked.
  assert.match(panel, /const orderStrikeRadius = async \(radius\) => \{[\s\S]*?const done = await orderWith\(sendAirStrikeOp, \{\s*op: "airstrike",\s*unit: order\.unit,\s*kind: order\.kind,\s*to: \[order\.lng, order\.lat\],[\s\S]*?radius: strikeRadiusOf\(radius\),\s*\}\);\s*if \(!done\) setWarRoom\(\{ strikeRadius: strikeRadiusOf\(order\.radius\) \}\);/);
  assert.match(panel, /if \(pickedOrderRadius > 0\) setWarRoom\(\{ strikeRadius: pickedOrderRadius \}\);/);
  // On the map each ring is as wide as its own strike's radius, any radius between.
  const ring = (radius) => {
    const [feature] = airFeatures({ blast: 20, orders: [{ lng: 22, lat: 0, ...(radius ? { radius } : {}) }] }).features;
    return Math.max(...feature.geometry.coordinates[0].map(([lng]) => lng)) - 22;
  };
  assert.ok(Math.abs(ring(2) / ring() - 2) < 0.01 && Math.abs(ring(0.5) / ring() - 0.5) < 0.01, `${ring(0.5)} ${ring()} ${ring(2)}`);
  assert.ok(Math.abs(ring(1.35) / ring() - 1.35) < 0.01, `${ring(1.35)} ${ring()}`);
});

test("the circles follow the slider: the strike waiting, the pointer's ring, and one shown while it is set with none waiting", () => {
  // The strike waiting for the air unit picked out is drawn at the radius on the slider.
  assert.match(marks, /const orders = normalizeAirStrikeOrders\(strikeOrders\)\.filter\(mine\)\.map\(\(order\) => \(unit && order\.unit === wing \? \{ \.\.\.order, radius: strikeRadius \} : order\)\);/);
  // With none waiting, a circle stands in the open middle of the map while the slider is being set.
  assert.match(marks, /if \(unit && sizing && blast > 0 && !orders\.some\(\(order\) => order\.unit === wing\)\) \{/);
  assert.match(marks, /sizing: sizingAt,/);
  assert.equal(marks.split('filter={["any", IS("aim"), IS("struck"), IS("sizing")]}').length - 1, 2, "drawn as a strike's circle is, fill and edge");
  const data = airFeatures({ blast: 20, sizing: { lng: 10, lat: 0, radius: 2 } });
  assert.deepEqual(data.features.map((feature) => feature.properties.what), ["sizing"], "a circle and no target in it");
  assert.equal(data.features[0].properties.colour, "#2bc1f3");
  const east = Math.max(...data.features[0].geometry.coordinates[0].map(([lng]) => lng)) - 10;
  const usual = Math.max(...airFeatures({ blast: 20, sizing: { lng: 10, lat: 0 } }).features[0].geometry.coordinates[0].map(([lng]) => lng)) - 10;
  assert.ok(Math.abs(east / usual - 2) < 0.01, `${east} ${usual}`);
  assert.equal(airFeatures({ blast: 20, sizing: null }).features.length, 0);
  // The pointer's ring grows and shrinks where it stands when the radius changes (the store's blast).
  assert.match(tools, /const blast = useWarRoom\(\(state\) => state\.blast\);/);
  assert.match(tools, /useEffect\(\(\) => \{\s*setAim\(\(now\) => \(now && ringAtRef\.current \? ringAtRef\.current\(\[now\.x, now\.y\]\) : now\)\);\s*\}, \[blast\]\);/);
  assert.match(tools, /ringAtRef\.current = ringAt;/);
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
