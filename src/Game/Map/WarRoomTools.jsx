/*! Open Historia — the war room's hand on the map: picking troops out and drawing their way © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// While the war room is open (GameUI/warRoom.jsx) the map beside it is the
// battlefield's own map, and this is what is done on it:
//
//   - the battlefield shown is fitted into what the drawer leaves of the map;
//   - with the Select tool, a box dragged over the player's troops picks them
//     out (Shift adds to what is picked; a click picks the troop under it);
//   - with a drawing tool, the pointer draws a way: for the troops picked out
//     (Route), to be stolen (Diversion), for a Board operation (Replan), or a
//     fortified line to be built (Fortify);
//   - with a placing tool, a click names a place: where the troops picked out
//     are to be carried (Transport), where the fleet picked out is to sail or
//     patrol (Fleet), where the player's new troops gather as a swarm
//     (Deploy, as a swarm), or what the air unit picked out is to strike
//     (Deploy Aircraft: a ring the size of where its bombs fall follows the
//     pointer). A drag moves the map and names nothing.
//
// While a tool is in hand a sheet lies over the map and takes the pointer, so
// the map does not pan under a drag and a region is not opened by the click
// that ends one; the wheel and a right-button drag still work the map, as off
// the sheet. With no tool in hand (Pan) there is no sheet and the map is the map.
//
// Nothing is written here. A way that has been drawn is reported
// (warRoomStore.js reportWarRoomWay) and the panel does the rest.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { ownTroopsOf } from "../../runtime/fronts/command.js";
import { frameBounds, projectorOf, unwrapLng } from "../../runtime/fronts/frame.js";
import { foldBattlefieldName, normalizeBattlefield } from "../../runtime/fronts/record.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { lineColour } from "./warRoomMarks.js";
import { passToMap } from "./mapGestures.js";
import { getWarRoom, reportWarRoomWay, setWarRoom, takeTool, useWarRoom } from "./warRoomStore.js";

const NONE = Object.freeze([]);
const selectCountry = (game) => String(game?.country ?? "");
const ACCENT = "#2bc1f3";
// A drag shorter than this is a click; a way shorter than this is no way.
const CLICK_PX = 5;
const WAY_LEAST_PX = 28;
// A click picks the troop this near it, and a point of a way is kept when the
// pointer has gone this far from the last.
const PICK_PX = 16;
const WAY_STEP_PX = 6;
const DRAW_COLOURS = Object.freeze({ route: ACCENT, replan: ACCENT, diversion: "#ffd24a", deploy: "#3ddc84" });

// The record of the battlefield shown, read from the world as it stands.
const useShownRecord = (name) => {
  const rows = useRuntimeState("world", (world) => (Array.isArray(world?.battlefields) ? world.battlefields : NONE));
  return useMemo(() => {
    const wanted = foldBattlefieldName(name);
    const row = wanted ? rows.find((entry) => foldBattlefieldName(entry?.name) === wanted) : null;
    return row ? normalizeBattlefield(row) : null;
  }, [rows, name]);
};

// Where the troops of a record stand on the map, a list a side: [lng, lat],
// or null for one that is gone.
const standingOf = (record) => {
  if (!record?.frame) return [[], []];
  const { toLngLat } = projectorOf(record.frame);
  return [0, 1].map((side) => decodeTroops(record.troops?.[side]).map((troop) => (troop.strength > 0 ? toLngLat(troop.x, troop.y) : null)));
};

// The box that holds a battlefield's troops with a little room round them, as
// [[west, south], [east, north]]; the frame's own when it has none.
const boundsOf = (record, standing) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const list of standing) {
    for (const point of list) {
      if (!point) continue;
      west = Math.min(west, point[0]);
      east = Math.max(east, point[0]);
      south = Math.min(south, point[1]);
      north = Math.max(north, point[1]);
    }
  }
  if (!(east >= west) || !(north >= south)) {
    const frame = frameBounds(record.frame);
    return [[frame.west, frame.south], [frame.east, frame.north]];
  }
  const padLng = Math.max(0.6, (east - west) * 0.18);
  const padLat = Math.max(0.4, (north - south) * 0.18);
  return [[west - padLng, Math.max(-84, south - padLat)], [east + padLng, Math.min(84, north + padLat)]];
};

const WarRoomTools = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const open = useWarRoom((state) => state.open);
  const name = useWarRoom((state) => state.battlefield);
  const side = useWarRoom((state) => state.side);
  const tool = useWarRoom((state) => state.tool);
  const replan = useWarRoom((state) => state.replan);
  const medium = useWarRoom((state) => state.medium);
  const deployForm = useWarRoom((state) => state.deployForm);
  // (A fortified line is drawn in the colour of the level it is to be built to.)
  const level = useWarRoom((state) => state.level);
  const cover = useWarRoom((state) => state.cover);
  const rail = useWarRoom((state) => state.rail);
  const fit = useWarRoom((state) => state.fit);
  const record = useShownRecord(open ? name : "");
  const standing = useMemo(() => standingOf(record), [record]);
  // (For the pointer's handlers, which are attached once a tool and must see
  // the troops where they stand now.)
  const standingRef = useRef(standing);
  // The longitude of the middle of the battlefield, as ITS frame tells it. A
  // frame may be told a whole turn off the map's own longitudes (North America
  // as 215 to 300 east): a troop is then looked for on the screen at the copy
  // of its place nearest the map's middle, and a route drawn on the screen is
  // told in the frame's turn. Without either, no troop was ever inside a box
  // drawn round it there, and a route fell a world away from its battlefield.
  const frameLng = useMemo(() => {
    if (!record?.frame) return 0;
    return projectorOf(record.frame).toLngLat(record.frame.cols / 2, record.frame.rows / 2)[0];
  }, [record]);
  const frameLngRef = useRef(frameLng);
  frameLngRef.current = frameLng;
  // The troops the player may pick: its own. On a side of several countries each commands its own.
  const country = useRuntimeState("game", selectCountry);
  const own = useMemo(() => new Set(record && (side === 0 || side === 1) ? ownTroopsOf(record, side, country) : []), [record, side, country]);
  const ownRef = useRef(own);
  useEffect(() => {
    standingRef.current = standing;
    ownRef.current = own;
  }, [standing, own]);
  // What is being drawn: a box ({ x0, y0, x1, y1 }) or a way ([[x, y]...]), in px of the map.
  const [draft, setDraft] = useState(null);
  // Where an air strike would fall if the pointer were clicked: { x, y, r } in px of the map, or null.
  const [aim, setAim] = useState(null);
  const sheetRef = useRef(null);

  // The battlefield fitted into what the drawer leaves of the map: when the war
  // room opens, when another battlefield is shown, and when the panel asks.
  const fittedRef = useRef("");
  useEffect(() => {
    if (!open || !map || !record?.frame) return;
    const key = `${foldBattlefieldName(name)}|${fit}`;
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    try {
      const size = map.getContainer?.()?.getBoundingClientRect?.();
      const right = Math.max(0, Math.min(cover, (size?.width ?? 0) - 240));
      // The tool rail stands on the left of the map: the battlefield is fitted beside it.
      const left = Math.max(0, Math.min(rail, 120));
      map.fitBounds(boundsOf(record, standing), {
        padding: { top: 96, bottom: 96, left: left + 48, right: right + 48 },
        duration: 900,
        maxZoom: 8.5,
      });
    } catch (error) {
      console.warn("the war room could not fit its battlefield on the map:", error);
    }
    // (The rail slides out as the room opens: the fit reads where it stands when it is asked for.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, map, record, standing, name, fit, cover]);
  useEffect(() => {
    if (!open) fittedRef.current = "";
  }, [open]);

  // Esc puts the tool down.
  const drawing = open && tool !== "pan";
  useEffect(() => {
    if (!drawing) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      setDraft(null);
      takeTool("pan");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing]);

  // The pointer on the sheet. Its handlers are attached by hand, so that the
  // wheel can be taken without being passive.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!drawing || !sheet || !map) return undefined;
    // The tools that name a place with a click, and move the map with a drag.
    const placing = tool === "transport" || tool === "fleet" || tool === "aircraft" || (tool === "deploy" && deployForm === "swarm");
    let held = null;
    const at = (event) => {
      const box = sheet.getBoundingClientRect();
      return [event.clientX - box.left, event.clientY - box.top];
    };
    const mine = () => (standingRef.current[side] ?? []).map((point, index) => (ownRef.current.has(index) ? point : null));
    const onScreen = (place) => map.project([unwrapLng(place[0], map.getCenter().lng), place[1]]);
    const inFrame = (place) => [unwrapLng(place.lng, frameLngRef.current), place.lat];
    const pickAt = ([x, y]) => {
      let best = -1;
      let bestPx = PICK_PX * PICK_PX;
      mine().forEach((point, index) => {
        if (!point) return;
        const shown = onScreen(point);
        const off = (shown.x - x) * (shown.x - x) + (shown.y - y) * (shown.y - y);
        if (off <= bestPx) {
          bestPx = off;
          best = index;
        }
      });
      return best;
    };
    // The ring where the bombs of a strike there would fall: as far as they fall (the store's `blast`, km), in px.
    const ringAt = ([x, y]) => {
      const km = Number(getWarRoom().blast);
      if (!(km > 0)) return null;
      try {
        const place = map.unproject([x, y]);
        const east = map.project([place.lng + km / (111.32 * Math.max(0.05, Math.cos((place.lat * Math.PI) / 180))), place.lat]);
        return { x, y, r: Math.max(4, Math.sqrt((east.x - x) * (east.x - x) + (east.y - y) * (east.y - y))) };
      } catch {
        return null;
      }
    };
    const down = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      try { sheet.setPointerCapture(event.pointerId); } catch { /* optional */ }
      const point = at(event);
      held = { id: event.pointerId, from: point, way: [point], add: event.shiftKey };
      setDraft(tool === "select" ? { x0: point[0], y0: point[1], x1: point[0], y1: point[1] } : placing ? null : [point]);
    };
    const move = (event) => {
      // (With Deploy Aircraft in hand, the ring follows the pointer.)
      if (tool === "aircraft") setAim(ringAt(at(event)));
      if (!held || event.pointerId !== held.id) return;
      const point = at(event);
      if (placing) {
        // The place may be far off: dragging moves the map under the pointer, and only a click names it.
        const last = held.way[held.way.length - 1];
        held.moved = (held.moved ?? 0) + Math.abs(point[0] - last[0]) + Math.abs(point[1] - last[1]);
        held.way.push(point);
        try {
          map.panBy([last[0] - point[0], last[1] - point[1]], { duration: 0 });
        } catch { /* the map is between styles */ }
        return;
      }
      if (tool === "select") {
        setDraft({ x0: held.from[0], y0: held.from[1], x1: point[0], y1: point[1] });
        return;
      }
      const last = held.way[held.way.length - 1];
      if ((point[0] - last[0]) * (point[0] - last[0]) + (point[1] - last[1]) * (point[1] - last[1]) < WAY_STEP_PX * WAY_STEP_PX) return;
      held.way.push(point);
      setDraft(held.way.slice());
    };
    const up = (event) => {
      if (!held || event.pointerId !== held.id) return;
      const done = held;
      held = null;
      setDraft(null);
      const point = at(event);
      if (tool === "select") {
        // (Read from the store now: the handlers are attached once a tool.)
        const before = new Set(done.add ? getWarRoom().selected : []);
        const moved = Math.abs(point[0] - done.from[0]) + Math.abs(point[1] - done.from[1]);
        if (moved < CLICK_PX) {
          const picked = pickAt(point);
          if (picked >= 0) {
            if (before.has(picked)) before.delete(picked);
            else before.add(picked);
          }
        } else {
          const [left, right] = [Math.min(done.from[0], point[0]), Math.max(done.from[0], point[0])];
          const [top, bottom] = [Math.min(done.from[1], point[1]), Math.max(done.from[1], point[1])];
          mine().forEach((place, index) => {
            if (!place) return;
            const shown = onScreen(place);
            if (shown.x >= left && shown.x <= right && shown.y >= top && shown.y <= bottom) before.add(index);
          });
        }
        setWarRoom({ selected: [...before].sort((a, b) => a - b) });
        return;
      }
      if (tool === "transport") {
        if ((done.moved ?? 0) >= CLICK_PX) return;
        const place = map.unproject(point);
        takeTool("pan");
        reportWarRoomWay("transport", [[place.lng, place.lat]], { medium });
        return;
      }
      if (tool === "deploy" && deployForm === "swarm") {
        if ((done.moved ?? 0) >= CLICK_PX) return;
        // The place the player's new troops are to gather at as a swarm, told in the battlefield's own longitudes.
        const place = inFrame(map.unproject(point));
        takeTool("pan");
        reportWarRoomWay("deploy", [place], { form: "swarm" });
        return;
      }
      if (tool === "aircraft") {
        if ((done.moved ?? 0) >= CLICK_PX) return;
        const place = map.unproject(point);
        // (Read from the store now: which air unit, and what it is to strike.)
        const { wing, strikeKind } = getWarRoom();
        takeTool("pan");
        reportWarRoomWay("aircraft", [[unwrapLng(place.lng, 0), place.lat]], { wing, kind: strikeKind });
        return;
      }
      if (tool === "fleet") {
        if ((done.moved ?? 0) >= CLICK_PX) return;
        const place = map.unproject(point);
        // (Read from the store now: which fleet, and to sail there or patrol it.)
        const { fleet, station } = getWarRoom();
        takeTool("pan");
        reportWarRoomWay("fleet", [[unwrapLng(place.lng, 0), place.lat]], { fleet, station });
        return;
      }
      let length = 0;
      for (let index = 1; index < done.way.length; index += 1) {
        const dx = done.way[index][0] - done.way[index - 1][0];
        const dy = done.way[index][1] - done.way[index - 1][1];
        length += Math.sqrt(dx * dx + dy * dy);
      }
      if (length < WAY_LEAST_PX) return;
      const way = done.way.map(([x, y]) => {
        return inFrame(map.unproject([x, y]));
      });
      const drawn = tool;
      takeTool("pan");
      reportWarRoomWay(drawn, way, { replan });
    };
    const cancel = (event) => {
      if (!held || event.pointerId !== held.id) return;
      held = null;
      setDraft(null);
    };
    const leave = () => setAim(null);
    // The wheel, and a right-button press, are handed to the map under the
    // sheet (mapGestures.js passToMap): a mouse wheel or a pinch zooms about
    // the pointer, two fingers on a trackpad zoom (with Shift held, turn and
    // tilt the map), and a
    // right-button drag turns and tilts it, as anywhere else on the map.
    const wheel = (event) => {
      event.preventDefault();
      passToMap(map, event);
    };
    const button = (event) => {
      if (event.button === 2) passToMap(map, event);
    };
    // The browser's menu is kept off the sheet, as MapLibre keeps it off the map.
    const menu = (event) => event.preventDefault();
    sheet.addEventListener("pointerdown", down);
    sheet.addEventListener("pointermove", move);
    sheet.addEventListener("pointerup", up);
    sheet.addEventListener("pointercancel", cancel);
    sheet.addEventListener("pointerleave", leave);
    sheet.addEventListener("wheel", wheel, { passive: false });
    sheet.addEventListener("mousedown", button);
    sheet.addEventListener("mouseup", button);
    sheet.addEventListener("contextmenu", menu);
    return () => {
      sheet.removeEventListener("pointerdown", down);
      sheet.removeEventListener("pointermove", move);
      sheet.removeEventListener("pointerup", up);
      sheet.removeEventListener("pointercancel", cancel);
      sheet.removeEventListener("pointerleave", leave);
      sheet.removeEventListener("wheel", wheel);
      sheet.removeEventListener("mousedown", button);
      sheet.removeEventListener("mouseup", button);
      sheet.removeEventListener("contextmenu", menu);
      // A tool put down in the middle of a drag leaves nothing half drawn.
      setDraft(null);
      setAim(null);
    };
  }, [drawing, map, tool, side, replan, medium, deployForm]);

  const container = map?.getContainer?.() ?? null;
  if (!drawing || !container) return null;
  const colour = tool === "fortify" ? lineColour(level) : DRAW_COLOURS[tool] ?? ACCENT;
  return createPortal(
    <div
      ref={sheetRef}
      data-oh-no-motion=""
      data-oh-war-room-sheet={tool}
      style={{ position: "absolute", inset: 0, zIndex: 4, cursor: "crosshair", touchAction: "none", userSelect: "none" }}
    >
      <svg width="100%" height="100%" style={{ display: "block", pointerEvents: "none" }} aria-hidden="true">
        {draft && !Array.isArray(draft) && (
          <rect
            x={Math.min(draft.x0, draft.x1)}
            y={Math.min(draft.y0, draft.y1)}
            width={Math.abs(draft.x1 - draft.x0)}
            height={Math.abs(draft.y1 - draft.y0)}
            fill="rgba(43, 193, 243, 0.14)"
            stroke={ACCENT}
            strokeWidth="1.5"
            strokeDasharray="6 4"
          />
        )}
        {tool === "aircraft" && aim && (
          <g data-oh-war-room-aim="">
            <circle cx={aim.x} cy={aim.y} r={aim.r} fill="rgba(43, 193, 243, 0.14)" stroke={ACCENT} strokeWidth="1.6" strokeDasharray="5 4" />
            <path d={`M${aim.x - 7} ${aim.y}H${aim.x + 7}M${aim.x} ${aim.y - 7}V${aim.y + 7}`} stroke={ACCENT} strokeWidth="1.6" />
          </g>
        )}
        {Array.isArray(draft) && draft.length > 1 && (
          <>
            <polyline points={draft.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="rgba(5, 8, 13, 0.85)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={draft.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={colour} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={tool === "diversion" ? "3 9" : undefined} />
          </>
        )}
      </svg>
    </div>,
    container,
  );
};

export default WarRoomTools;
