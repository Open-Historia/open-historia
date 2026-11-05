/*! Open Historia — the war room: where it is wired into the game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/warRoomWiring.test.js
//
// The war room's parts are tested where they live (runtime/fronts/command,
// plans, warRoomOps; AI/warRoomContext, frontPlans; Map/warRoomStore,
// warRoomGeometry). This is what holds them together: when the button is
// there and where, what is out of sight while the room is open, what the map
// shows of troops inside the room and outside it, and that the room's own
// surfaces are pictures worked out a pixel at a time. The components cannot be
// loaded under plain node, so where they are wired is read as text.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAP_LAYER_ORDER } from "../Map/mapLayerOrder.js";
import { BESIDE_DOCK_LEFT, BESIDE_WAR_ROOM_LEFT, DOCK_HEIGHT_REM, WAR_ROOM_BUTTON_REM, dockGeometry } from "./hudDock.js";
import { rivetPixels, roughMetalPixels } from "./roughMetal.js";
import { placeName, playerFronts, playerFrontsKey } from "./warRoomData.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const main = read("main.jsx");
const panel = read("warRoom.jsx");
const layers = read("../Map/FrontLayers.jsx");

test("the war room is the player's when his troops are on a battlefield with a war on it", () => {
  const battlefields = [
    { name: "The Alba Front", status: "active", sides: [["Aland", "Syldavia"], ["Borduria"]] },
    { name: "The Truce Line", status: "frozen", sides: [["Borduria"], ["Aland"]] },
    { name: "Aland / Borduria border", status: "standing", sides: [["Aland"], ["Borduria"]] },
    { name: "The Old Front", status: "closed", sides: [["Aland"], ["Borduria"]] },
    { name: "Somebody Else's War", status: "active", sides: [["Syldavia"], ["Borduria"]] },
    null,
  ];
  assert.deepEqual(playerFronts(battlefields, " aland "), [
    { name: "The Alba Front", side: 0, status: "active" },
    { name: "The Truce Line", side: 1, status: "frozen" },
  ], "a border that is only fortified is no conflict, and a front that has closed is over");
  assert.equal(playerFrontsKey(battlefields, "Aland"), "0:active:The Alba Front\n1:frozen:The Truce Line");
  assert.equal(playerFrontsKey(battlefields, "Neutralia"), "");
  assert.equal(playerFrontsKey(null, "Aland"), "");
  assert.equal(playerFrontsKey(battlefields, ""), "");
  assert.equal(playerFronts(battlefields, "Neutralia"), playerFronts([], "Aland"), "nothing is the same nothing, so a selector does not stir");
  assert.equal(placeName("city: Kharkiv"), "Kharkiv");
  assert.equal(placeName("Region:  Donbas "), "Donbas");
  assert.equal(placeName("Kharkiv"), "Kharkiv");
});

test("the button is there only while there is a war, beside the dock where Search otherwise is", () => {
  assert.match(main, /const warFronts = useRuntimeState\("world", \(world\) => playerFrontsKey\(world\?\.battlefields, playerCountry, world\?\.wars\), playerCountry\);/);
  assert.match(main, /const hasFronts = Boolean\(warFronts\) && activeWars\(\)\.battlefields;/);
  assert.match(main, /const atWar = hasFronts && fightingIn\(warFronts\);/);
  assert.match(main, /\{\(hasFronts \|\| isWarRoomOpen\) && \(\s*<WarRoomButton open=\{warRoomShown\} isMobile=\{isMobile\} onToggle=\{toggleWarRoom\} \/>\s*\)\}/);
  // It takes Search's place, and Search begins beyond it.
  assert.match(main, /<Search mapRef=\{mapRef\} besideWarRoom=\{hasFronts\} \/>/);
  // Both from the dock the game shows (hudDock.js useDockGeometry: Rostra can be switched off).
  assert.match(read("search.jsx"), /besideWarRoom && !isMobile \? dock\.besideWarRoomLeft : dock\.besideDockLeft/);
  assert.match(main, /isMobile \? `\$\{DOCK_LEFT_REM\}rem` : dock\.besideDockLeft\}/);
  assert.equal(WAR_ROOM_BUTTON_REM, DOCK_HEIGHT_REM, "as tall as the dock it stands beside");
  assert.ok(parseFloat(BESIDE_WAR_ROOM_LEFT) >= parseFloat(BESIDE_DOCK_LEFT) + WAR_ROOM_BUTTON_REM, "Search clears the button");
  for (const buttons of [2, 3]) {
    const dock = dockGeometry(buttons);
    assert.ok(parseFloat(dock.besideWarRoomLeft) >= parseFloat(dock.besideDockLeft) + WAR_ROOM_BUTTON_REM, `Search clears the button beside a dock of ${buttons}`);
  }
  // Brushed metal, and the panel is not loaded until it is asked for.
  assert.match(main, /backgroundImage: `url\(\$\{brushedMetalUrl\(160\)\}\)`/);
  assert.match(main, /const LazyWarRoomPanel = lazy\(\(\) =>\s*import\("\.\/warRoom\.jsx"\)/);
  assert.match(main, /const toggleWarRoom = \(\) => \{\s*setShouldLoadWarRoom\(true\);/);
});

test("while the war room is open every other control is out of sight, and none of them is unmounted", () => {
  assert.match(main, /const warRoomShown = isWarRoomOpen && !mainMenuOpen && !hasNoGames;/);
  assert.match(main, /const hudStyle = warRoomShown \? HUD_OUT_OF_SIGHT : HUD_IN_SIGHT;/);
  assert.match(main, /const HUD_OUT_OF_SIGHT = Object\.freeze\(\{ display: "none" \}\);/);
  const from = main.indexOf('<div data-oh-hud="" style={hudStyle}>');
  assert.notEqual(from, -1);
  const hud = main.slice(from, main.indexOf("\n      </div>", from));
  // The bar with the game's name and the way out, the date, the launchers,
  // the country badge, Search, the forces and the advisor are all inside it.
  for (const control of ["<LibraryTopBar", "<DateWidget", "<Toolbar", "<Other", "<Search", "<ForcesPanel", "<AdvisorButton"]) {
    assert.ok(hud.includes(control), `${control} is not put out of sight with the rest`);
  }
  assert.ok(!hud.includes("<WarRoomButton") && !hud.includes("LazyWarRoomPanel"), "the war room itself is not");
  assert.match(main, /<SettingsButton\s+topOffset=\{TOP_BAR_OFFSET\}\s+hidden=\{isSettingsOpen \|\| warRoomShown\}/);
  // In the room the button goes to the corner of the screen.
  assert.match(main, /left: `calc\(\$\{open \? `\$\{WAR_ROOM_OPEN_INSET_REM\}rem` : isMobile/);
  // Opening it shuts the other drawers, and they shut it.
  assert.match(main, /const toggleWarRoom = \(\) => \{\s*setShouldLoadWarRoom\(true\);\s*setIsAdvisorOpen\(false\);\s*setIsCountryOpen\(false\);\s*setIsWarRoomOpen\(\(open\) => !open\);/);
  assert.match(main, /const toggleCountry = \(\) => \{\s*setIsWarRoomOpen\(false\);/);
  assert.match(main, /useBackToClose\(isWarRoomOpen, \(\) => setIsWarRoomOpen\(false\)\);/);
});

test("on the map at large a troop has its counter only from close in; in the war room from far off", () => {
  const number = (name) => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(layers)?.[1]);
  assert.ok(number("TROOP_MIN_ZOOM") >= 7, "really close");
  assert.ok(number("SIDE_MARKER_MAX_ZOOM") >= number("TROOP_MIN_ZOOM"), "a general's marker gives way only once his troops are there");
  assert.ok(number("WAR_ROOM_TROOP_MIN_ZOOM") <= 3, "the whole battlefield with every troop on it");
  // Every troop from far off in the war room, and while the Events panel is
  // open (Map/troopDetail.js): what happened is read there and looked for on the map.
  assert.match(layers, /const everyTroopWanted = useEveryTroopShown\(\);/);
  assert.match(layers, /const everyTroop = warRoomOpen \|\| everyTroopWanted;/);
  assert.match(layers, /const troopMinZoom = everyTroop \? WAR_ROOM_TROOP_MIN_ZOOM : TROOP_MIN_ZOOM;/);
  assert.match(layers, /const troopKindMinZoom = everyTroop \? WAR_ROOM_TROOP_KIND_MIN_ZOOM : TROOP_KIND_MIN_ZOOM;/);
  assert.match(layers, /const troopNameMinZoom = everyTroop \? WAR_ROOM_TROOP_NAME_MIN_ZOOM : TROOP_NAME_MIN_ZOOM;/);
  assert.match(layers, /const sideMarkerMaxZoom = everyTroop \? WAR_ROOM_SIDE_MARKER_MAX_ZOOM : SIDE_MARKER_MAX_ZOOM;/);
  assert.match(main, /const eventsOpen = activeBottomPanel === "history";\s*useEffect\(\(\) => \{\s*showEveryTroop\("events", eventsOpen\);\s*return \(\) => showEveryTroop\("events", false\);\s*\}, \[eventsOpen\]\);/);
  assert.match(main, /onOpenEvents=\{\(\) => setActiveBottomPanel\("history"\)\}/, "the Events panel is the bottom panel called history");
  for (const id of ["fronts-troops", "fronts-troops-dug"]) {
    assert.match(layers, new RegExp(`id="${id}"\\s+type="circle"\\s+beforeId=\\{troopBefore\\}\\s+minzoom=\\{troopMinZoom\\}`), `${id} follows the room`);
  }
  // A turn that lands while the game is open is another run of a battlefield
  // the map already has a picture for: it is played on THAT picture's canvas,
  // which is the one the map was given. (A canvas made anew was never shown:
  // the ground the troops took stayed unpainted until the page was loaded again.)
  assert.match(layers, /const makePicture = \(view, onto = null\) => \{/);
  assert.match(layers, /const canvas = onto\?\.canvas \?\? document\.createElement\("canvas"\);/);
  assert.match(layers, /const fits = Boolean\(was\) && pictureFits\(was\.picture, target\.view\.frame\);\s*const same = fits && was\.stage\.view\.replay === stage\.view\.replay;\s*const picture = same \? was\.picture : makePicture\(target\.view, fits \? was\.picture : null\);/);
  // The room's marks on the troops: the general pointed at, and those picked out.
  assert.match(layers, /const litFilter = warRoomOpen && warRoomLit >= 0 \?/);
  assert.match(layers, /\["in", \["get", "index"\], \["literal", \[\.\.\.warRoomPicked\]\]\]/);
  const scene = read("../Map/MapScene.jsx");
  assert.ok(scene.indexOf("<WarRoomLayers />") < scene.indexOf("<FrontLayers />"), "the planned movements are declared under the troops");
  assert.match(scene, /<FrontLayers \/>\s*<WarRoomTools \/>/);
});

test("the war room's layers have their place on the map: plans under the troops, marks among them", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const plans = ["warroom-plans-casing", "warroom-plans", "warroom-plans-decoy", "warroom-plans-deploy", "warroom-plans-spot", "warroom-plans-head", "warroom-plans-label"];
  for (const id of [...plans, "fronts-sides-lit", "fronts-troops-lit", "fronts-troops-picked"]) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...plans].sort((a, b) => index(a) - index(b)), plans);
  for (const id of plans) {
    assert.ok(index(id) > index("cities-labels"), "over the map's own names");
    assert.ok(index(id) < index("fronts-troops"), "under the troops that are to make them");
  }
  assert.ok(index("fronts-sides-lit") < index("fronts-sides"), "a general's marker stands in its pool of light");
  assert.ok(index("fronts-troops-lit") < index("fronts-troops"));
  assert.ok(index("fronts-troops-picked") > index("fronts-troops"), "the ring round a troop picked out is over its counter");
  assert.ok(index("fronts-troops-picked") < index("units-fill"));
  // What the room shades of the ground (supply, a rehearsal's gains and losses): over the battlefield's paint, under the borders.
  assert.ok(index("warroom-shade-fill") > index("fronts-paint-11") && index("warroom-shade-fill") < index("polity-boundaries"));
  const drawn = [...read("../Map/WarRoomLayers.jsx").matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(drawn.sort(), [...plans, "warroom-shade-fill"].sort(), "every layer the room declares is in the order, and no other");
});

test("the war room writes through its own seam and asks one request a message", () => {
  assert.match(panel, /await sendWarRoomOp\(op, \{ turnRunning: isSimulationBusy \}\);/);
  assert.doesNotMatch(panel, /mutateWorldState|writeWorldState|readWorldState\(/, "the panel never writes the world itself");
  assert.equal(panel.split("generateWarRoomReply(").length - 1, 1, "one place asks the generals");
  assert.match(panel, /if \(controller\.signal\.aborted \|\| \(answer\.campaignId && gameIdRef\.current && answer\.campaignId !== gameIdRef\.current\)\) return;/, "an answer for another game is not written into this one");
  const writes = read("../../runtime/warRoomWrites.js");
  assert.match(writes, /if \(turnRunning\(\)\) throw new Error\(TURN_RUNNING_REFUSAL\);/);
  // What the model wrote is shown as it came; the interface's own words are translated.
  assert.match(panel, /<div\s+data-no-translate\s+style=\{\{\s+background: own \? RED_DARK : OLIVE/);
});

test("a scenario's fronts are authored in the Workshop and built when its game is first entered", () => {
  const library = read("libraryBar.jsx");
  // Under the Wars feature in the Features tab, which was the War tab (2026-11-01).
  assert.match(library, /\? \["overview", "world", "history", "politics"/);
  assert.match(library, /extras=\{kind === "scenario" \? \{\s*fronts: \([\s\S]*?<ScenarioFrontsPanel/);
  assert.match(read("ScenarioFrontsPanel.jsx"), /await saveScenario\(scenarioId, \{ worldPatch: \{ scenarioFronts: fronts \} \}\);\s*onDetailsChange\?\.\(nextDetails\);/);
  const time = read("time.jsx");
  assert.match(time, /maybeOpenScenarioFronts\(\)\s*\.then\(\(outcome\) => \{\s*if \(outcome === "later"\) scenarioFrontsAttemptedRef\.current = false;/);
  assert.match(time, /if \(\(fresh && prehistoryHasContent\(worldState\.prehistory\)\) \|\| isMainMenuOpen\(\)\) \{\s*return;/, "after the scenario's own pre-history, which writes the wars");
  const gameplay = read("../AI/gameplay.js");
  const start = gameplay.indexOf("export const maybeOpenScenarioFronts = ");
  const body = gameplay.slice(start, gameplay.indexOf("\n};", start));
  assert.doesNotMatch(body, /runJsonTask|callAI/, "no request is made");
  assert.match(body, /scenarioFronts: \[\],/, "the list is cleared once it has been built");
  assert.match(body, /beginSimulation\(\);[\s\S]*finally \{\s*endSimulation\(\);/);
  for (const file of ["../../../server/libraryStore.js", "../../runtime/web/storeConstants.js"]) {
    assert.match(read(file), /"prehistory",\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*"scenarioFronts",/, `${file} carries a scenario's fronts into its games`);
  }
});

test("the war room's steel is a picture worked out a pixel at a time, the same every time", () => {
  const plate = roughMetalPixels(64);
  assert.equal(plate.length, 64 * 64 * 4);
  assert.deepEqual([...plate], [...roughMetalPixels(64)], "the same plate twice");
  let least = 255;
  let most = 0;
  for (let index = 0; index < plate.length; index += 4) {
    assert.equal(plate[index + 3], 255, "solid all over: it is a tile");
    least = Math.min(least, plate[index]);
    most = Math.max(most, plate[index]);
  }
  assert.ok(most - least > 20, "rough, not flat");
  assert.ok(most < 140, "and dark");
  assert.notDeepEqual([...roughMetalPixels(64, { seed: 9 })], [...plate]);
  const clean = roughMetalPixels(64, { wear: 0 });
  assert.ok(new Set(clean.filter((_, index) => index % 4 === 0)).size === 1, "with no wear it is one flat colour");

  const rivet = rivetPixels(28);
  const alphaAt = (x, y) => rivet[(y * 28 + x) * 4 + 3];
  assert.equal(alphaAt(0, 0), 0, "clear outside its ring");
  assert.equal(alphaAt(14, 14), 255);
  const lightAt = (x, y) => rivet[(y * 28 + x) * 4];
  assert.ok(lightAt(10, 9) > lightAt(18, 19), "lit from the upper left");
  // Neither spells a fade for the browser to draw.
  for (const file of ["roughMetal.js", "brushedMetal.js", "warRoomTheme.js", "warRoom.jsx"]) {
    assert.doesNotMatch(read(file), /(?:linear|radial|conic)-gradient\s*\(|create(?:Linear|Radial|Conic)Gradient/);
  }
});

test("the troop tools are on a rail at the left of the map, and the drawer keeps what is read", () => {
  const rail = read("warRoomRail.jsx");
  // Every tool and order a body of troops can be given has its key on the rail, and none is left in the drawer.
  for (const [label, action] of [
    ["Select", "onTool(\"select\")"],
    ["Route", "onTool(\"route\")"],
    ["Advance", "onOrder(\"advance\")"],
    ["Dig in", "onOrder(\"dig in\")"],
    ["Hold", "onOrder(\"hold\")"],
    ["Fall back", "onOrder(\"fall back\")"],
    ["Diversion", "onTool(\"diversion\")"],
  ]) {
    const key = rail.split("\n").find((line) => line.includes(`<RailKey label="${label}" `)) ?? "";
    assert.ok(key.includes(`onClick={() => ${action}}>`), `${label} is a key on the rail`);
  }
  assert.match(rail, /<RailKey label="Release" [^>]*onClick=\{onRelease\}>/);
  assert.doesNotMatch(panel, />Select troops<|>Draw route<|>Dig in<\/button>|>Fall back<\/button>|>Draw a diversion</, "the keys are not in the drawer as well");
  // The panel hands the rail what the keys do: the rail writes nothing itself.
  assert.match(panel, /<WarRoomRail\s+shown=\{railShown\}\s+top=\{railTop\}/);
  for (const prop of ["onTool={takeTool}", "onOrder={orderPicked}", "onRelease={releasePicked}", "locked={locked}", "turnRunning={turnRunning}", "notice={notice}"]) assert.ok(panel.includes(prop), `the rail is given ${prop}`);
  assert.doesNotMatch(rail, /sendWarRoomOp|mutateWorldState|writeWorldState/);
  // It is out while the map is in sight: beside the drawer, and on a phone once the drawer is folded down.
  assert.match(panel, /const railShown = open && Boolean\(record\) && \(!isMobile \|\| foldedNow\);/);
  // It comes out of the left edge, and can be tucked back against it.
  assert.match(rail, /left: 0,/);
  assert.match(rail, /transform: out \? "translateX\(0\)" : "translateX\(-100%\)",/);
  assert.match(rail, /aria-expanded=\{!tucked\}/);
  // What a key cannot do it says why: nothing is ordered while a turn is being resolved, or with nobody picked out.
  assert.match(rail, /disabled=\{locked \|\| none\} onClick=\{\(\) => onOrder\("advance"\)\}/);
  assert.match(rail, /\{turnRunning && <>A turn is being resolved\. Orders are taken once it has landed\.<\/>\}/);
  // The map fits a battlefield beside the rail as it does beside the drawer.
  assert.match(rail, /setWarRoom\(\{ rail: Math\.round\(railRef\.current\?\.getBoundingClientRect\(\)\.right \?\? 0\) \}\)/);
  assert.match(read("../Map/WarRoomTools.jsx"), /padding: \{ top: 96, bottom: 96, left: left \+ 48, right: right \+ 48 \},/);
  assert.match(read("../Map/warRoomStore.js"), /\n {2}rail: 0,\n/);
  // No gradient and no glass on it: the plate is the war room's own.
  assert.doesNotMatch(rail, /gradient|backdrop-filter|backdropFilter/i);
});
