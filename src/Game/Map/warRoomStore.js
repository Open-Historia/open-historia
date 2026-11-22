/*! Open Historia — the war room: what its panel and the map share © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room is two things on the screen at once: a drawer with the generals
// in it (GameUI/warRoom.jsx) and the map beside it, on which troops are picked
// out and ways are drawn (WarRoomTools.jsx, WarRoomLayers.jsx). They are in
// different parts of the tree, so what they share is kept here, outside React:
// which battlefield is open, which tool is in hand, which troops are picked,
// which general's troops are lit, the plans to draw, a fortified line drawn
// and waiting to be ordered built, the fleet picked out, and the air unit.
//
// Nothing here is saved, and nothing here writes the game: a way that has been
// drawn is handed to whoever is listening (onWay), which is the panel.

import { useSyncExternalStore } from "react";

// The tools of the war room's map. "pan" is the map as it always is.
//   select     drag a box round troops to pick them out
//   route      draw the way the troops picked out are to take
//   diversion  draw a movement to be stolen and never made
//   replan     draw a Board operation's arrow anew (`replan` holds which)
//   transport  click where the troops picked out are to be carried (`medium` holds by what)
//   fortify    draw a fortified line to be built (it waits as `draft` for its level)
//   fleet      click where the fleet picked out (`fleet`) is to sail, or to patrol (`station`)
//   deploy     draw the line the player's new troops on the battlefield are to come in on (runtime/fronts/deploy.js),
//              or, with `deployForm` "swarm", click the place they are to gather at as a swarm (runtime/fronts/swarms.js)
//   aircraft   click what the air unit picked out (`wing`) is to strike: troops, a structure or a city (`strikeKind`)
export const WAR_ROOM_TOOLS = Object.freeze(["pan", "select", "route", "diversion", "replan", "transport", "fortify", "fleet", "deploy", "aircraft"]);

const CLOSED = Object.freeze({
  open: false,
  // The battlefield shown, by name, and which side of it is the player's.
  battlefield: "",
  side: -1,
  tool: "pan",
  // The player's troops picked out, by their places in the record's list.
  selected: Object.freeze([]),
  // The general whose troops are lit (his command), or -1.
  highlight: -1,
  // The Board operation whose arrow is being redrawn, by its id.
  replan: "",
  // What the troops picked out are to be carried by ("sea", "land" or "air"), while that tool is in hand.
  medium: "",
  // What the Deploy tool deploys: "front", a line the new troops come in along, or "swarm", a place they gather at
  // as a swarm (runtime/fronts/swarms.js). The panel sets it as the room opens: as the player deployed there last,
  // else as the scenario's wars are fought.
  deployForm: "front",
  // How many fresh formations a deployment drawn calls up when time next passes (runtime/fronts/deploy.js), as the
  // player typed it: "" for as many as a draft usually brings, 0 for none.
  // A fortified line drawn and not yet ordered built, as [lng, lat] points, or
  // null; and the level it is to be built to (GameUI/warRoomFortify.jsx).
  draft: null,
  level: 5,
  // Whether the fleets' plate is out beside the rail, the fleet picked out on
  // it (its id), and what a click on the map orders for that fleet while the
  // fleet tool is in hand ("move" or "patrol"): GameUI/warRoomFleets.jsx.
  fleets: false,
  fleet: "",
  station: "",
  // Whether the aircraft's plate is out beside the rail (Deploy Aircraft), the
  // air unit picked out on it (its id), what a click on the map is to strike
  // with it ("troops", "structure" or "city"), the strike radius set for it (a
  // share of the era's blast: runtime/fronts/airStrike.js strikeRadiusOf, set
  // on the plate's slider), whether that slider is being set (pointed at or
  // held: the map then shows a circle of that radius, the only way its size is
  // told), and how far the bombs of one strike fall at that radius, in km, for
  // the ring drawn where the pointer is (GameUI/warRoomAircraft.jsx;
  // runtime/fronts/airStrike.js).
  aircraft: false,
  wing: "",
  strikeKind: "troops",
  strikeRadius: 1,
  sizing: false,
  blast: 0,
  // The ways found for the player's transporters that have not set out, by
  // their ids: { way, km, days, from } or { error, from } (AI/frontApply.js transportWaysFor).
  transportWays: null,
  // The plan the panel points at, by its id, so the map can show which it is.
  pointed: "",
  // What the map draws: the player's own planned movements and what is known
  // of the other side's (runtime/fronts/plans.js plansOf / knownPlans).
  plans: Object.freeze([]),
  known: Object.freeze([]),
  // How far the drawer covers the map from the right, in px, so that a
  // battlefield is fitted into what is left of it.
  cover: 0,
  // And how far the tool rail covers it from the left (GameUI/warRoomRail.jsx).
  rail: 0,
  // Raised whenever the panel wants the battlefield fitted on the map again.
  fit: 0,
  // The ground shaded on the map (warRoomCells.js): whether its supply is shown (the rail's Supply key) and what of
  // it is shaded, and what a rehearsal of the days ahead would gain and lose (GameUI/warRoomRehearsal.jsx).
  // GeoJSON, or null.
  supply: false,
  supplyShade: null,
  rehearsalShade: null,
});

let state = CLOSED;
const listeners = new Set();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

export const getWarRoom = () => state;
export const subscribeWarRoom = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const sameList = (a, b) => a === b || (a.length === b.length && a.every((value, index) => value === b[index]));

// Changes what is shared. A value equal to the one there changes nothing, so a
// caller may set what it has on every render.
export const setWarRoom = (patch) => {
  let next = state;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in CLOSED)) continue;
    const before = next[key];
    if (before === value || (Array.isArray(before) && Array.isArray(value) && sameList(before, value))) continue;
    if (next === state) next = { ...state };
    next[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  if (next === state) return;
  state = Object.freeze(next);
  emit();
};

export const openWarRoom = (battlefield, side) => setWarRoom({ open: true, battlefield, side, tool: "pan", selected: [], highlight: -1, replan: "", pointed: "", fit: state.fit + 1 });
export const closeWarRoom = () => {
  if (state === CLOSED) return;
  state = CLOSED;
  emit();
};

// Which battlefield is shown: what was picked out on the last one is put down.
export const showBattlefield = (battlefield, side) => {
  if (state.battlefield === battlefield && state.side === side) return;
  setWarRoom({ battlefield, side, tool: "pan", selected: [], highlight: -1, replan: "", pointed: "", plans: [], known: [], rehearsalShade: null, fit: state.fit + 1 });
};

// The tool in hand. Taking up the one already in hand puts it down.
export const takeTool = (tool, { replan = "", medium = "", station = "" } = {}) => {
  if (!WAR_ROOM_TOOLS.includes(tool)) return;
  const same = state.tool === tool && (tool !== "replan" || state.replan === replan) && (tool !== "transport" || state.medium === medium) && (tool !== "fleet" || state.station === station);
  setWarRoom({
    tool: same ? "pan" : tool,
    replan: !same && tool === "replan" ? replan : "",
    medium: !same && tool === "transport" ? medium : "",
    station: !same && tool === "fleet" ? station : "",
  });
};

export const useWarRoom = (select = (value) => value) => useSyncExternalStore(subscribeWarRoom, () => select(state), () => select(CLOSED));

// ---- a way that was drawn -------------------------------------------------------------

// Who is told when a way has been drawn on the map: (tool, way, { replan }),
// `way` as [lng, lat] points. One listener: the war room's panel.
let wayListener = null;
export const onWarRoomWay = (listener) => {
  wayListener = listener;
  return () => {
    if (wayListener === listener) wayListener = null;
  };
};
export const reportWarRoomWay = (tool, way, extra = {}) => {
  try {
    wayListener?.(tool, way, extra);
  } catch (error) {
    console.error("the war room could not take the way that was drawn:", error);
  }
};
