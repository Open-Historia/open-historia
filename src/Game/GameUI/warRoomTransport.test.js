/*! Open Historia — the war room's transporters: where they are wired: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/warRoomTransport.test.js
//
// What a transporter is and does is tested where it lives
// (runtime/fronts/transports, wayfinder, warRoomOps; AI/frontTransport;
// Map/transportFeatures). This is the war room's hold on it: the key on the
// rail, the click on the map, the op that is sent, and the list in the drawer.
// The components cannot be loaded under plain node, so they are read as text.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WAR_ROOM_TOOLS, getWarRoom, openWarRoom, closeWarRoom, setWarRoom, takeTool } from "../Map/warRoomStore.js";
import { WAR_ROOM_OPS } from "../../runtime/fronts/warRoomOps.js";
import { TRANSPORT_LOAD_MOST } from "../../runtime/fronts/transports.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const rail = read("warRoomRail.jsx");
const panel = read("warRoom.jsx");
const tools = read("../Map/WarRoomTools.jsx");

test("the rail has a key that carries troops, and with a carrier chosen the map asks where", () => {
  // The key opens the choice; with the tool in hand it puts it down.
  assert.match(rail, /<RailKey label="Transport" [^>]*on=\{tool === "transport" \|\| choice\} disabled=\{locked \|\| none\}/);
  assert.match(rail, /onClick=\{\(\) => \(tool === "transport" \? onTool\("pan"\) : setChoosing\(\(value\) => !value\)\)\}/);
  // The choice is of what exists that year, each with what it carries and how fast it goes.
  assert.match(rail, /\{carriers\.map\(\(carrier\) => \{/);
  assert.match(rail, /<span data-no-translate>\{carrier\.kind\}<\/span> · \{carrier\.capacity\} formations each · \{carrier\.speed\} km a day/);
  assert.match(rail, /onCarrier\(carrier\.medium\);/);
  assert.match(panel, /carriers=\{carriers\}\s*onCarrier=\{\(medium\) => takeTool\("transport", \{ medium \}\)\}/);
  // (Nothing by sea without navies, nor by air without air units: the Wars feature.)
  assert.match(panel, /TRANSPORT_MEDIA\.map\(\(medium\) => \(\{ medium, \.\.\.carrierFor\(medium, year\) \}\)\)\s*\.filter\(\(carrier\) => carrier\.kind && \(carrier\.medium !== "sea" \|\| navies\) && \(carrier\.medium !== "air" \|\| aircraft\)\)/);
  // The rail says its limit in the number the engine has.
  assert.match(rail, /const LOAD_MOST = (\d+);/);
  assert.equal(Number(/const LOAD_MOST = (\d+);/.exec(rail)[1]), TRANSPORT_LOAD_MOST);

  // The tool: in the store with what it is to go by, taken up and put down like any other.
  assert.ok(WAR_ROOM_TOOLS.includes("transport"));
  openWarRoom("The front", 0);
  try {
    takeTool("transport", { medium: "sea" });
    assert.deepEqual([getWarRoom().tool, getWarRoom().medium], ["transport", "sea"]);
    takeTool("transport", { medium: "air" });
    assert.deepEqual([getWarRoom().tool, getWarRoom().medium], ["transport", "air"], "another carrier is another tool in hand, not the same one put down");
    takeTool("transport", { medium: "air" });
    assert.deepEqual([getWarRoom().tool, getWarRoom().medium], ["pan", ""]);
    takeTool("route");
    assert.equal(getWarRoom().medium, "");
    setWarRoom({ transportWays: { t1: { way: [[1, 2], [3, 4]] } } });
    assert.deepEqual(getWarRoom().transportWays, { t1: { way: [[1, 2], [3, 4]] } });
  } finally {
    closeWarRoom();
  }
  assert.equal(getWarRoom().transportWays, null);

  // On the map: a click names the place, a drag moves the map and names nothing.
  assert.match(tools, /if \(tool === "transport"\) \{\s*if \(\(done\.moved \?\? 0\) >= CLICK_PX\) return;\s*const place = map\.unproject\(point\);\s*takeTool\("pan"\);\s*reportWarRoomWay\("transport", \[\[place\.lng, place\.lat\]\], \{ medium \}\);/);
  assert.match(tools, /map\.panBy\(\[last\[0\] - point\[0\], last\[1\] - point\[1\]\], \{ duration: 0 \}\);/);
});

test("the drawer sends the op, lists the transporters, and shows the way found for one that has not set out", () => {
  for (const op of ["transport", "untransport", "hunt"]) assert.ok(WAR_ROOM_OPS.includes(op), `${op} is an op of the war room`);
  // The place clicked, with the troops picked out and what was chosen to carry them.
  assert.match(panel, /await act\(\{ op: "transport", battlefield: name, troops: selectedRef\.current, medium: extra\.medium, to: \[lng, lat\], name: placeNearRef\.current\(lng, lat\) \}\)/);
  assert.match(panel, /onClick=\{\(\) => act\(\{ op: "untransport", battlefield: name, id: entry\.id \}\)\}/);
  assert.match(panel, /onClick=\{\(\) => act\(\{ op: "hunt", battlefield: name, id: entry\.id, off: hunted \}\)\}/);
  // The player's own, and the other side's that are on their way: nobody else's, and not what the other side has only ordered.
  assert.match(panel, /const ownTransports = transports\.filter\(\(entry\) => sameName\(entry\.owner, game\.country\)\);/);
  assert.match(panel, /const theirTransports = record \? transports\.filter\(\(entry\) => entry\.status === "moving" && \(record\.sides\[1 - side\] \?\? \[\]\)\.some\(\(member\) => sameName\(member, entry\.owner\)\)\) : \[\];/);
  // The way is found by the engine's own search, with no request, and handed to the map.
  assert.match(panel, /warRoomTransportWays\(\{ world, game \}\)/);
  assert.match(panel, /if \(open\) setWarRoom\(\{ transportWays \}\);/);
  assert.match(read("../AI/gameplay.js").replace(/\r\n/g, "\n"), /export const warRoomTransportWays = \(\{ world, game \} = \{\}\) =>\n {2}transportWaysFor\(\{ world, game, campaignId: activeCampaignId\(\), loadRegions: createRenderedRegionsReader\(\) \}\);/);
  assert.match(read("../AI/gameplayLazy.js"), /export const warRoomTransportWays = async \(\.\.\.args\) => \(await gameplay\(\)\)\.warRoomTransportWays\(\.\.\.args\);/);
  // Every write still goes through the war room's one seam, and a transporter's op changes the world's transporters.
  assert.doesNotMatch(panel, /mutateWorldState|writeWorldState/);
  const writes = read("../../runtime/warRoomWrites.js");
  assert.match(writes, /transports: world\?\.transports, era: eraSettingOf\(world\), media: activeTransportMedia\(\), military: transportFiguresOf\(world, game\?\.country\) \}\);/);
  // (The host holds a shared game's player to the same: the game's transports, and that country's navy and air force.)
  assert.match(read("../../multiplayer/host/gameHost.js"), /era: eraSettingOf\(world\), media: activeTransportMedia\(\), military: transportFiguresOf\(world, seat\.country\) \}\);/);
  assert.match(writes, /\.\.\.\(result\.transports \? \{ transports: result\.transports \} : null\) \};/);
  assert.match(read("../../multiplayer/host/gameHost.js"), /\.\.\.\(result\.transports \? \{ transports: result\.transports \} : null\) \} \};/);
});
