/*! Open Historia — the war room's fortified lines and fleets: where they are wired: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/warRoomFortifyFleets.test.js
//
// What a line and a fleet order are and do is tested where they live
// (runtime/fortifyCost, warRoomChart, fronts/fortifyOps, naval/fleetOps;
// Map/warRoomMarks; multiplayer/host/gameHost). This is the war room's hold on
// them: the keys on the rail, the stroke and the click on the map, the plates
// beside the rail, the ops sent through the war room's seam, and the requests a
// shared game carries. The components cannot be loaded under plain node, so
// where they are wired is read as text.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAP_LAYER_ORDER } from "../Map/mapLayerOrder.js";
import { WAR_ROOM_TOOLS, closeWarRoom, getWarRoom, openWarRoom, setWarRoom, takeTool } from "../Map/warRoomStore.js";
import { PLAYER_REQUESTS } from "../../multiplayer/game/messages.js";
import { validate } from "../../multiplayer/protocol/validate.js";
import { FORTIFY_LEVEL_USUAL } from "../../runtime/fortifyCost.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const rail = read("warRoomRail.jsx");
const panel = read("warRoom.jsx");
const fortify = read("warRoomFortify.jsx");
const fleets = read("warRoomFleets.jsx");
const tools = read("../Map/WarRoomTools.jsx");
const writes = read("../../runtime/warRoomWrites.js");

test("the rail has a key that draws a fortified line, and one that puts out the fleets", () => {
  assert.match(rail, /<RailKey label="Fortify" [^>]*on=\{tool === "fortify" \|\| drafted\} disabled=\{locked \|\| !canFortify\} onClick=\{\(\) => onTool\("fortify"\)\}>/);
  assert.match(rail, /<RailKey label="Fleets" [^>]*disabled=\{fleets === 0\} onClick=\{onFleets\}>/);
  // (No Fleets key in a scenario without navies: the Wars feature.)
  assert.match(rail, /\{navies && <RailKey label="Fleets" /);
  assert.match(panel, /canFortify=\{canFortify\}\s*drafted=\{Boolean\(draft\)\}\s*navies=\{navies\}\s*fleets=\{fleets\.length\}\s*fleetsOut=\{fleetsOut\}\s*onFleets=\{\(\) => setWarRoom\(\{ fleets: !getWarRoom\(\)\.fleets \}\)\}/);
  // A line is drawn only where the scenario's wars have fortified lines.
  assert.match(panel, /const canFortify = useMemo\(\(\) => warSettingsOf\(\{ warSettings: world\?\.warSettings \}\)\.mechanics\.walls === true/);
  // What the tool in hand wants done is said beside the rail.
  assert.match(rail, /tool === "fortify" && <>Draw the fortified line on the map\./);
  assert.match(rail, /tool === "fleet" && station === "patrol" && <>Click the place at sea the fleet is to patrol\./);
});

test("the tools are in the store, with what a click orders for the fleet, and put down like any other", () => {
  for (const tool of ["fortify", "fleet"]) assert.ok(WAR_ROOM_TOOLS.includes(tool), tool);
  closeWarRoom();
  const shut = getWarRoom();
  assert.deepEqual([shut.draft, shut.level, shut.fleets, shut.fleet, shut.station], [null, FORTIFY_LEVEL_USUAL, false, "", ""]);
  openWarRoom("The front", 0);
  try {
    takeTool("fleet", { station: "patrol" });
    assert.deepEqual([getWarRoom().tool, getWarRoom().station], ["fleet", "patrol"]);
    takeTool("fleet", { station: "move" });
    assert.deepEqual([getWarRoom().tool, getWarRoom().station], ["fleet", "move"], "the other order is another tool in hand");
    takeTool("fleet", { station: "move" });
    assert.deepEqual([getWarRoom().tool, getWarRoom().station], ["pan", ""]);
    takeTool("fortify");
    assert.deepEqual([getWarRoom().tool, getWarRoom().station], ["fortify", ""]);
    setWarRoom({ draft: [[1, 2], [3, 4]], level: 8, fleets: true, fleet: "u1" });
    assert.deepEqual([getWarRoom().draft.length, getWarRoom().level, getWarRoom().fleets, getWarRoom().fleet], [2, 8, true, "u1"]);
    assert.throws(() => getWarRoom().draft.push([5, 6]), "what is shared cannot be changed behind the store's back");
  } finally {
    closeWarRoom();
  }
  assert.equal(getWarRoom().draft, null, "and the room shut puts it all down");
});

test("on the map: a line is a stroke in its level's colour, and a fleet's place a click that a drag does not make", () => {
  // (And a swarm's place: runtime/fronts/swarms.js.)
  assert.match(tools, /const placing = tool === "transport" \|\| tool === "fleet" \|\| \(tool === "deploy" && deployForm === "swarm"\);/);
  assert.match(tools, /if \(placing\) \{[\s\S]*?map\.panBy\(\[last\[0\] - point\[0\], last\[1\] - point\[1\]\], \{ duration: 0 \}\);/);
  assert.match(tools, /if \(tool === "fleet"\) \{\s*if \(\(done\.moved \?\? 0\) >= CLICK_PX\) return;\s*const place = map\.unproject\(point\);[\s\S]*?const \{ fleet, station \} = getWarRoom\(\);\s*takeTool\("pan"\);\s*reportWarRoomWay\("fleet", \[\[unwrapLng\(place\.lng, 0\), place\.lat\]\], \{ fleet, station \}\);/);
  assert.match(tools, /const colour = tool === "fortify" \? lineColour\(level\) : DRAW_COLOURS\[tool\] \?\? ACCENT;/);
  // The rest of a stroke goes the way every drawing goes: reported with the tool that drew it.
  assert.match(tools, /const drawn = tool;\s*takeTool\("pan"\);\s*reportWarRoomWay\(drawn, way, \{ replan \}\);/);
});

test("the drawer takes the line drawn and the place clicked, and sends them through the war room's seam", () => {
  assert.match(panel, /\} else if \(drawn === "fortify"\) \{[\s\S]*?setWarRoom\(\{ draft: way \}\);/);
  assert.match(panel, /\} else if \(drawn === "fleet" && extra\?\.fleet && way\[0\]\) \{[\s\S]*?await orderWith\(sendFleetOp, \{ op: "station", unit: extra\.fleet, to: way\[0\], order: extra\.station === "patrol" \? "patrol" : "move" \}\);/);
  assert.match(panel, /if \(await orderWith\(sendFortifyOp, \{ op: "fortify", points, level: height, name: title \}\)\) setWarRoom\(\{ draft: null \}\);/);
  assert.match(panel, /await send\(op, \{ turnRunning: isSimulationBusy, readChart: \(\) => warRoomChart\(\) \}\);/);
  assert.match(panel, /onOrder=\{\(op\) => orderWith\(sendFleetOp, op\)\}/);
  assert.match(panel, /onStop=\{\(id\) => orderWith\(sendFortifyOp, \{ op: "unfortify", id \}\)\}/);
  assert.doesNotMatch(panel, /mutateWorldState|writeWorldState|readWorldState\(/, "the panel never writes the world itself");
  // The plates come out beside the rail: the line drawn first, the fleets otherwise.
  assert.match(panel, /\{railShown && draft && \(\s*<FortifyPlate/);
  assert.match(panel, /\{railShown && !draft && fleetsOut && \(\s*<FleetsPlate/);
  // The seams: the host in a shared game, the write queue otherwise and never while a turn runs, the map read only here.
  assert.match(writes, /export const sendFortifyOp = async \(op, \{ turnRunning = \(\) => false, readChart = async \(\) => null \} = \{\}\) => \{/);
  assert.match(writes, /await sendHeldToMap\(sent, \{ request: "fortify", apply: applyFortifyOp, needsChart: sent\.op === "fortify" \}/);
  assert.match(writes, /await sendHeldToMap\(sent, \{ request: "fleet", apply: applyFleetOp, needsChart: \["station", "blockade", "escort"\]\.includes\(sent\.op\) \}/);
  assert.match(writes, /if \(inSharedGame\(\)\) \{\s*const answer = await requestFromHost\(request, \{ op: sent \}\);/);
  assert.equal(writes.split("if (turnRunning()) throw new Error(TURN_RUNNING_REFUSAL);").length - 1, 3, "the war room's own ops once, and the lines and fleets before the map is read and after");
  // The map is read by the game's own engine code, with no request made; the host reads its own.
  assert.match(read("../AI/gameplay.js").replace(/\r\n/g, "\n"), /export const warRoomChart = async \(\{ world = null, game = null \} = \{\}\) => \{/);
  assert.match(read("../AI/gameplayLazy.js"), /export const warRoomChart = async \(\.\.\.args\) => \(await gameplay\(\)\)\.warRoomChart\(\.\.\.args\);/);
  assert.match(read("../../multiplayer/host/engineMain.js"), /readChart: \(\) => warRoomChart\(\),/);
});

test("the line's plate says how long it is, what it holds, and how long it takes to build at the level picked", () => {
  // A line nobody passes (10) is the scenario designer's alone: the plate offers 3 to 9.
  assert.match(fortify, /const LEVELS = Object\.freeze\(\[3, 4, 5, 6, 7, 8, 9\]\);/);
  assert.match(fortify, /const cost = fortifyCostFor\(world, country, draft, level\);/);
  assert.match(fortify, /<BuildTime days=\{cost\.days\} \/>/);
  assert.match(fortify, /onClick=\{\(\) => onLevel\(value\)\}/);
  assert.match(fortify, /onClick=\{\(\) => onConfirm\(name\)\}[^>]*>Confirm<\/button>/);
  assert.match(fortify, /onClick=\{onCancel\}[^>]*>Cancel<\/button>/);
  for (const word of ["Palisade", "Impassable"]) assert.ok(fortify.includes(`<>${word}</>`), word);
  // The fleets' plate gives the six postures, a place, a blockade and an escort.
  assert.match(fleets, /const POSTURE_KEYS = Object\.freeze\(\["patrol", "blockade", "assaulting", "holding", "withdrawing", "transit"\]\);/);
  assert.match(fleets, /onClick=\{\(\) => onOrder\(\{ op: "posture", unit: fleet\.id, posture \}\)\}/);
  assert.match(fleets, /onClick=\{\(\) => onOrder\(\{ op: "blockade", unit: fleet\.id, country: target \}\)\}/);
  assert.match(fleets, /onClick=\{\(\) => onOrder\(\{ op: "escort", unit: fleet\.id, transport: covered \}\)\}/);
  assert.match(fleets, /onClick=\{\(\) => onPlace\("patrol"\)\}/);
  // Names are the game's own text: not translated.
  assert.match(fleets, /<span data-no-translate style=\{\{ flex: 1, [^}]*\}\}>\{entry\.name\}<\/span>/);
});

test("a shared game carries a line and a fleet's order as requests of their own, held to their size", () => {
  const ask = (t, op) => validate(PLAYER_REQUESTS[t], { t, id: "00000000000000a1", op });
  assert.equal(ask("fortify", { op: "fortify", points: [[20, 50], [20.6, 50.4]], level: 6, name: "A line" }).ok, true);
  assert.equal(ask("fortify", { op: "unfortify", id: "built-1" }).ok, true);
  assert.equal(ask("fleet", { op: "station", unit: "u1", to: [21, 57.5], order: "move" }).ok, true);
  assert.equal(ask("fleet", { op: "blockade", unit: "u1", country: "Latvia" }).ok, true);
  assert.equal(ask("fleet", { op: "station", unit: "u1", to: [[[21]]] }).ok, false, "nothing nested past what an order has");
  assert.equal(ask("fortify", { op: "fortify", points: [[[[20]]]] }).ok, false);
  assert.equal(validate(PLAYER_REQUESTS.fleet, { t: "fleet", id: "00000000000000a1", op: { op: "stand", unit: "u1" }, extra: 1 }).ok, false, "and nothing beside it");
});

test("on the map: the lines lie under the planned movements, and the marks on the fleets under their counters", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const marks = read("../Map/WarRoomMarks.jsx");
  const drawn = [...marks.matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]).filter((id) => !id.endsWith("-source"));
  assert.deepEqual(drawn, ["warroom-lines-casing", "warroom-lines-draft", "warroom-lines-label", "warroom-fleets-station", "warroom-fleets-course", "warroom-fleets-head", "warroom-fleets-ring"]);
  // The lines themselves are the map's own, in the war room as out of it, with their breaches (WarGeographyLayers.jsx).
  assert.match(marks, /id="warroom-lines-casing"\s*type="line"\s*filter=\{IS\("draft"\)\}/);
  for (const id of drawn) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...drawn].sort((a, b) => index(a) - index(b)), drawn, "in the order they are declared");
  for (const id of drawn.slice(0, 3)) {
    assert.ok(index(id) > index("cities-labels"), "over the map's own names");
    assert.ok(index(id) < index("warroom-plans-casing"), "under the planned movements");
  }
  for (const id of drawn.slice(3)) {
    assert.ok(index(id) > index("transports-icons"));
    assert.ok(index(id) < index("units-fill"), "under the fleets' own counters");
  }
  const scene = read("../Map/MapScene.jsx");
  assert.match(scene, /<WarRoomLayers \/>\s*<WarRoomMarks \/>\s*<FrontLayers \/>/);
  // Nothing is drawn while the war room is shut.
  assert.match(marks, /if \(!open\) return null;/);
});
