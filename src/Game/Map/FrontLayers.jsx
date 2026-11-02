/*! Open Historia — battlefields on the map: taken ground, troops and the ways they came © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield (runtime/fronts/record.js) is drawn as three things, and no
// front line is one of them. The ground a side has taken is painted in the
// colour of whose troops took it; the troops are counters, each where it
// stands; and behind each is an arrow in its side's colour, raised off the
// map, along the way it has come in the last few days, with a faint line
// along what it walked before. Troops going one way together share one
// broader arrow, and the further off the map is seen from, the more of them
// share it: a handful of broad arrows from far off, each column's own from
// close in. The front
// is where the colours meet and where the counters face each other. The
// regions keep their shapes and their owners' colours underneath: the paint is
// laid over them, not made of them.
//
// What is drawn is PLAYED. The engine works a whole turn out before any of it
// is shown and keeps a replay of it (runtime/fronts/replay.js); the map plays
// that back, so each troop is seen going the way it went and the colour is
// seen spreading round it as it goes. Once that is played out the front
// stands still until the next skip: "get rid of the idle troop animation that
// makes it look like they are at war or battling" (the owner, 2026-10-25). As
// with the unit counters (Units.jsx) the playing runs outside React: one render to declare the layers, then
// pixels and setData straight on the sources.
//
// Stacking is MAP_LAYER_ORDER's (mapLayerOrder.js): the paint above every
// region fill and below the borders; the arrows above the borders and below
// every label; the troops above the cities and structures and just below the
// unit counters.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { MAP_SETTING_KEYS, useMapSettingValue } from "../../runtime/mapSettings.js";
import { buildDiplomaticStanceMap, getDiplomaticOwnerColor } from "../../runtime/diplomaticStance.js";
import { useActiveGameCountry } from "../../runtime/library.js";
import { isTouchPrimary } from "../../runtime/mobileUi.js";
import { TROOP_STATES } from "../../runtime/fronts/constants.js";
import { latToY, projectorOf, yToLat } from "../../runtime/fronts/frame.js";
import { useWorldState } from "./useWorldState.js";
import { createOwnerRgbResolver, ownerDisplayCss, parseColorToRgb } from "./ownerColors.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { POLITICAL_FILL_OPACITY_STOPS, politicalFillOpacityAtZoom } from "./vnext/presentationPolicy.js";
import { getFrontTargets, settleFront, startFrontsSync, subscribeFronts } from "./frontsController.js";
import { arrowDetailAt, frontArrowFeatures, frontArrowRgb, frontAt, frontShownOn, frontTroopFeatures, stageOf } from "./frontGeometry.js";
import { PAINT_WALL } from "../../runtime/fronts/codec.js";
import { createPaintPlayer, paintPixels, paintScaleFor, pictureCorners, pictureFits } from "./frontPaint.js";
import { FRONT_BASEMAP_PUT_LAYER_ID, FRONT_BASEMAP_TAKE_LAYER_ID, createFrontBasemapLayers, markPicturePainted } from "./frontBasemapLayer.js";
import { contestedOwnersOf, setFrontShownOwners } from "./frontOwnership.js";
import { shownOwnersAt } from "../../runtime/fronts/replay.js";
import { shortUnitLabel } from "./unitLabels.js";
import { useEveryTroopShown } from "./troopDetail.js";
import { useWarRoom } from "./warRoomStore.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

export const FRONT_ARROW_SOURCE = "fronts-arrows-source";
export const FRONT_TROOP_SOURCE = "fronts-troops-source";
// One picture a battlefield, in the order the world lists them
// (runtime/fronts/constants.js MAX_BATTLEFIELDS).
export const FRONT_PAINT_SLOTS = 12;
export const frontPaintLayerId = (slot) => `fronts-paint-${slot}`;
export const frontPaintUnderLayerId = (slot) => `fronts-paint-under-${slot}`;
const frontPaintSourceId = (slot) => `fronts-paint-source-${slot}`;

// How long a day of a run takes to play, and the least and most a playing
// lasts however few or many days it covers.
const PLAY_MS_PER_DAY = 320;
const PLAY_MS_LEAST = 1400;
const PLAY_MS_MOST = 10000;
// This many redraws a second read as movement; a phone is asked for half.
const PLAY_FRAMES_PER_SECOND = 24;
const PLAY_FRAMES_PER_SECOND_TOUCH = 12;
// The sources of the map whose regions give the land its shape.
const MASK_SOURCES = ["custom-regions-source", "custom-regions-repair-source"];

const UNOWNED_COLOR = "rgb(120, 120, 120)";
const UNOWNED_RGB = [120, 120, 120];
const CASING_COLOR = "rgba(5, 8, 13, 0.92)";
// Taken ground is to look like the taker's own land. A country's land is its
// colour laid over the basemap at a strength that grows with the zoom; laid
// over ground that is still the colour of the region's own country, the two
// would mix into mud. So the territory's colour behind the paint is made to
// be seen through: the bare map is put back under the painted ground
// (frontBasemapLayer.js), and the paint is laid over it in its own colours at
// the very strength the map gives a country's land. It then matches that land
// at every zoom and on every basemap, dark ones included.
// Where the map cannot be copied the picture is drawn twice instead, as it
// used to be: first nearly solid and drained to the pale grey of the game's
// own relief, which is right on that basemap and too light on a dark one.
const PAINT_CLEAR_OPACITY = 0.94;
const PAINT_CLEAR_TONE = [0.92, 0.96];
const PAINT_OPACITY = ["interpolate", ["linear"], ["zoom"], ...POLITICAL_FILL_OPACITY_STOPS.flat()];
// An arrow is a shape on the ground, so its width is in the map's own
// measure and has to be worked out for the zoom the map is at
// (frontGeometry.js arrowDetailAt gives it in px). It is raised by drawing it
// three times: its shadow, the edge that gives it depth, and its face, each a
// little up and to the left of the one before. How much of one shows is its
// own `alpha`: less than all of it while the troops that share arrows are
// being sorted anew.
const ARROW_SHADOW_SHIFT = [3, 4];
const ARROW_EDGE_SHIFT = [1.4, 2];
// The edge is the face's colour brought this far toward black.
const ARROW_EDGE_DARKEN = 0.5;
const SHOWN = ["coalesce", ["get", "alpha"], 1];
// How many px wide the map draws the whole world at zoom 0.
const WORLD_PX = 512;

// A troop's counter, in px: a formation with a name of its own draws larger.
const TROOP_RADIUS = [
  "interpolate", ["linear"], ["zoom"],
  4.75, ["case", ["get", "named"], 4.2, 3.1],
  7, ["case", ["get", "named"], 7.2, 5.6],
  10, ["case", ["get", "named"], 11, 9],
];
// The rampart round one that is dug in, this much wider than its counter.
const TROOP_RAMPART_RADIUS = [
  "interpolate", ["linear"], ["zoom"],
  4.75, ["case", ["get", "named"], 6.4, 5.2],
  7, ["case", ["get", "named"], 10.4, 8.6],
  10, ["case", ["get", "named"], 15, 12.8],
];
// The pool of light a troop stands in while the war room points at its
// general: wide enough to be seen with the whole battlefield on the screen.
const TROOP_LIT_RADIUS = [
  "interpolate", ["linear"], ["zoom"],
  3, 7,
  7, 13,
  10, 19,
];
// The state of a troop that is dug in, as the record names it (a word of the
// data, not of the interface).
const DUG_IN = TROOP_STATES[4];
const IS_TROOP = ["==", ["get", "what"], "troop"];
const IS_SIDE = ["==", ["get", "what"], "side"];
// On the map at large the troops of a side are a marker a general, with their
// number on it, and a counter each only from really close in: hundreds of
// counters seen from further off are a swarm that hides the map under them.
// Both show in the narrow band between the two zooms.
const SIDE_MARKER_MAX_ZOOM = 7.75;
const TROOP_MIN_ZOOM = 7.5;
const TROOP_KIND_MIN_ZOOM = 8;
const TROOP_NAME_MIN_ZOOM = 7.5;
const ARROW_MIN_ZOOM = 4.25;
// While the war room is open (GameUI/warRoom.jsx) troops are picked out by
// hand, so there each has its counter from far off, and the generals' markers
// give way to them sooner. The same while the Events panel is open: what
// happened is read there, and the map is looked at to see where.
const WAR_ROOM_SIDE_MARKER_MAX_ZOOM = 5.25;
const WAR_ROOM_TROOP_MIN_ZOOM = 2.5;
const WAR_ROOM_TROOP_KIND_MIN_ZOOM = 6.5;
const WAR_ROOM_TROOP_NAME_MIN_ZOOM = 6;
const WAR_ROOM_ACCENT = "#2bc1f3";
const NOTHING = ["==", ["get", "what"], "nothing"];

// Opt-in only, with the map's other probe (?mapFillProbe=1, or localStorage
// oh:mapFillProbe = "1"): lets a test hold the playing at a day of its choice.
const isFrontProbeEnabled = () => {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("mapFillProbe") === "1") return true;
    return window.localStorage?.getItem("oh:mapFillProbe") === "1";
  } catch {
    return false;
  }
};

// A battlefield's picture: a canvas a few pixels to a cell, and where on the
// map its four corners lie. The map lays a picture out evenly between its
// corners as IT measures the world, which is how a battlefield's cells are
// laid out too, except on a flat sheet: there each row of pixels is told
// which row of cells it shows.
// The picture a battlefield's painted ground is played on. `onto` is the
// picture the map already has for the same frame (the same size, laid on the
// same ground), when there is one: its canvas is the one the map was given and
// goes on reading, so a new run is played on THAT canvas. A canvas made anew
// for every run was never shown: the map kept the last turn's picture, and the
// ground the troops took in a turn that landed while the game was open stayed
// unpainted until the page was loaded again.
const makePicture = (view, onto = null) => {
  const { frame } = view;
  const { toLngLat, toCell } = projectorOf(frame);
  const scale = paintScaleFor(frame.cols, frame.rows);
  const canvas = onto?.canvas ?? document.createElement("canvas");
  if (!onto) {
    canvas.width = frame.cols * scale;
    canvas.height = frame.rows * scale;
  }
  const context = onto?.context ?? canvas.getContext("2d");
  if (onto) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    markPicturePainted(canvas);
  }
  const [west, north] = toLngLat(0, frame.rows);
  const [east, south] = toLngLat(frame.cols, 0);
  let rowOf = null;
  if (frame.flat === true) {
    rowOf = new Float32Array(canvas.height);
    const top = latToY(north);
    const bottom = latToY(south);
    for (let y = 0; y < canvas.height; y += 1) {
      rowOf[y] = toCell(west, yToLat(top + ((bottom - top) * (y + 0.5)) / canvas.height))[1];
    }
  }
  return {
    canvas,
    context,
    // The land's own edge is the frame's, not the run's: a mask made for the
    // picture before is kept until the map makes it again (remask).
    target: {
      data: null,
      pixels: context.createImageData(canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height,
      scale,
      rowOf,
      ...(onto?.target.mask ? { mask: onto.target.mask } : {}),
    },
    // (As the map's own copy of the world has them: a frame told in longitudes a
    // whole turn off, as one that crosses the date line may be, is a picture the
    // map cannot place at all, and it says so by throwing.)
    coordinates: onto?.coordinates ?? pictureCorners(west, north, east, south),
    player: createPaintPlayer(view),
    palette: new Uint8Array(32 * 4),
    blank: true,
    ...(onto?.maskCanvas ? { maskCanvas: onto.maskCanvas } : {}),
  };
};

const FrontLayers = () => {
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  // The pictures to declare, one a battlefield: [{ key, slot, canvas, coordinates }].
  // Most games have no battlefield, and then no source or layer is declared.
  const [pictures, setPictures] = useState([]);
  // Whether the bare map is being put back under the paint (frontBasemapLayer.js).
  const [seenThrough, setSeenThrough] = useState(false);
  const picturesRef = useRef(pictures);
  picturesRef.current = pictures;
  const { polityOverrides, groups, regionOwnershipOverrides, wars, relations, agreements, puppets } = useWorldState();
  // On the diplomatic map the ground a side has taken is painted as the regions are (Nations.jsx): in the colour of
  // where that side stands with the player, not in its own. "the drawn territory remains the same color on the
  // diplomatic map making it not be the same color as your country" (the owner, 2026-10-15).
  const playerCountry = useActiveGameCountry();
  const mapMode = useMapSettingValue(MAP_SETTING_KEYS.mapMode, "political");
  const stances = useMemo(
    () => (mapMode === "diplomatic" ? buildDiplomaticStanceMap({ playerCountry, wars, agreements, relations, puppets }) : null),
    [mapMode, playerCountry, wars, agreements, relations, puppets],
  );
  // The war room's marks on the troops: the general whose troops are lit, and
  // the troops picked out (warRoomStore.js).
  const warRoomOpen = useWarRoom((state) => state.open);
  const everyTroopWanted = useEveryTroopShown();
  const warRoomField = useWarRoom((state) => state.battlefield);
  const warRoomSide = useWarRoom((state) => state.side);
  const warRoomLit = useWarRoom((state) => state.highlight);
  const warRoomPicked = useWarRoom((state) => state.selected);

  const colors = useMemo(() => {
    const resolveOwnerRgb = createOwnerRgbResolver(colorMap, polityOverrides);
    // A side is a country or a group; a group has a colour of its own.
    const colorOf = (name) => groups?.[name]?.color || ownerDisplayCss(resolveOwnerRgb, name, UNOWNED_COLOR);
    const rgbOf = (name) => parseColorToRgb(colorOf(name)) ?? UNOWNED_RGB;
    // The colour its ground is painted in: its own, or on the diplomatic map its stance's.
    const groundRgbOf = (name) => (stances ? parseColorToRgb(getDiplomaticOwnerColor(name, stances)) ?? UNOWNED_RGB : rgbOf(name));
    const arrows = new Map();
    const arrowColorsOf = (name) => {
      let made = arrows.get(name);
      if (!made) {
        const face = frontArrowRgb(rgbOf(name));
        made = {
          top: `rgb(${face.join(", ")})`,
          side: `rgb(${face.map((part) => Math.round(part * (1 - ARROW_EDGE_DARKEN))).join(", ")})`,
        };
        arrows.set(name, made);
      }
      return made;
    };
    return { colorOf, rgbOf, groundRgbOf, arrowColorsOf };
  }, [colorMap, polityOverrides, groups, stances]);

  // Everything the playing needs, kept out of React state so a frame costs
  // pixels and two setData calls and nothing else.
  const colorRef = useRef(colors);
  // Whose each region is, by the world: which regions are a battlefield's land
  // (those of its two sides) is read from it when the land's edge is drawn.
  const ownersRef = useRef(regionOwnershipOverrides);
  ownersRef.current = regionOwnershipOverrides;
  // What is on the map: battlefield -> { target, run, stage, picture, slot, start, until, day }.
  const playRef = useRef(new Map());
  const rafRef = useRef(0);
  const startedRef = useRef(0);
  const durationRef = useRef(0);
  const repaintRef = useRef(() => {});

  // The two layers that put the bare map back under the paint, while there is a battlefield to paint.
  const painted = pictures.length > 0;
  useEffect(() => {
    const mapInstance = map?.getMap?.() ?? map;
    if (!mapInstance || !painted) return undefined;
    const { take, put } = createFrontBasemapLayers({
      // (The layer draws the painted ground whole, the bare map and the colour over it, from the
      // picture itself: it does not wait on the map's own copy of the picture, nor need it.)
      pictures: () => picturesRef.current,
      strength: politicalFillOpacityAtZoom,
      onState: (working) => setSeenThrough(working === true),
      onError: (error) => console.warn("[fronts] the bare map could not be put back under the painted ground; it is cleared to grey instead.", error),
    });
    const add = () => {
      try {
        if (!mapInstance.style) return;
        // The layers are put in their places ONLY when one of these two has just been added. This is
        // asked on every change of the map's style, and to sort the map's layers each time was to
        // sort them whenever anything else added one: every layer moved, and the newcomer (a border
        // being redrawn, a troop layer, a highlight) sent under the territory. While a turn was read,
        // borders and troops kept vanishing and the map stuttered.
        let added = false;
        if (!mapInstance.getLayer(FRONT_BASEMAP_TAKE_LAYER_ID)) {
          mapInstance.addLayer(take);
          added = true;
        }
        if (!mapInstance.getLayer(FRONT_BASEMAP_PUT_LAYER_ID)) {
          mapInstance.addLayer(put);
          added = true;
        }
        if (added) enforceMapLayerOrder(mapInstance);
      } catch { /* the map is between styles: asked again when the next has loaded */ }
    };
    add();
    mapInstance.on("styledata", add);
    return () => {
      mapInstance.off("styledata", add);
      try {
        if (mapInstance.style && mapInstance.getLayer(FRONT_BASEMAP_PUT_LAYER_ID)) mapInstance.removeLayer(FRONT_BASEMAP_PUT_LAYER_ID);
        if (mapInstance.style && mapInstance.getLayer(FRONT_BASEMAP_TAKE_LAYER_ID)) mapInstance.removeLayer(FRONT_BASEMAP_TAKE_LAYER_ID);
      } catch { /* the map is gone */ }
      setSeenThrough(false);
    };
  }, [map, painted]);

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const refreshColors = () => {
      const mine = ++generation;
      getNationColors()
        .then((next) => {
          if (!cancelled && mine === generation) setColorMap(next);
        })
        .catch((error) => console.error("Failed to load colors for fronts:", error));
    };
    refreshColors();
    window.addEventListener("oh:colors-updated", refreshColors);
    window.addEventListener("oh:active-game-changed", refreshColors);
    return () => {
      cancelled = true;
      window.removeEventListener("oh:colors-updated", refreshColors);
      window.removeEventListener("oh:active-game-changed", refreshColors);
    };
  }, []);

  // A new palette repaints a settled map; a playing reads the ref every frame.
  useEffect(() => {
    colorRef.current = colors;
    for (const entry of playRef.current.values()) entry.picture.stale = true;
    if (!rafRef.current) repaintRef.current();
  }, [colors]);

  useEffect(() => {
    const mapInstance = map?.getMap?.() ?? map;
    // After the map is torn down (leaving a game) MapLibre's style is gone and
    // getSource throws; a frame the retry loop queued must not crash on it.
    const source = (id) => {
      if (!mapInstance?.style) return null;
      try {
        return mapInstance.getSource?.(id) ?? null;
      } catch {
        return null;
      }
    };

    // A picture's colours: four bytes for each state it can be painted in.
    const dress = (entry) => {
      const { palette, player } = entry.picture;
      player.names.forEach((name, index) => {
        const [red, green, blue] = colorRef.current.groundRgbOf(name);
        palette.set([red, green, blue, 255], (index + 1) * 4);
      });
      entry.picture.stale = false;
    };

    // The map reads a picture again only while it is told the picture is
    // playing. After a redraw it is told so, and told to stop once it has had
    // two frames to take the picture up, unless a playing is still going.
    const handOver = (entry, playing) => {
      const picture = source(frontPaintSourceId(entry.slot));
      if (!picture?.play) return false;
      picture.play();
      if (!playing) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!rafRef.current) source(frontPaintSourceId(entry.slot))?.pause?.();
        }));
      }
      mapInstance?.triggerRepaint?.();
      return true;
    };

    let retryHandle = 0;
    // The sources last filled. They are declared empty, so when MapLibre
    // rebuilds the style they come back as new, empty objects; styledata below
    // refills them.
    let painted = [null, null];
    // The zoom the arrows were last drawn for: their width, and which troops
    // share one, are worked out for it.
    let arrowsAtZoom = -1;
    // Draws every battlefield at the day it stands on. `atRest` is false for a
    // frame of a playing.
    const paint = (atRest, attempt = 0) => {
      const drawn = [];
      const days = [];
      // Whose each region being fought over is drawn as on the day shown: the
      // political map holds its colour, border and labels to that
      // (frontOwnership.js) until the region is held in full.
      const shownOwners = [];
      let waiting = false;
      for (const entry of playRef.current.values()) {
        drawn.push(frontAt(entry.stage, entry.day));
        days.push(entry.day);
        shownOwners.push(shownOwnersAt(entry.target.record?.replay, entry.day) ?? contestedOwnersOf(entry.target.record));
        const { picture } = entry;
        if (picture.stale) dress(entry);
        const { context, target, player } = picture;
        if (frontShownOn(entry.stage, entry.day) && player.bounds) {
          player.seek(entry.day);
          target.data = target.pixels.data;
          const area = paintPixels(player, picture.palette, target);
          if (area && area.width > 0 && area.height > 0) {
            context.putImageData(target.pixels, 0, 0, area.x, area.y, area.width, area.height);
            markPicturePainted(picture.canvas);
          }
          picture.blank = false;
        } else if (!picture.blank) {
          context.clearRect(0, 0, target.width, target.height);
          markPicturePainted(picture.canvas);
          picture.blank = true;
        }
        if (!handOver(entry, !atRest)) waiting = true;
      }
      setFrontShownOwners(shownOwners);
      const arrows = source(FRONT_ARROW_SOURCE);
      const troops = source(FRONT_TROOP_SOURCE);
      if (arrows?.setData && troops?.setData) {
        const { colorOf, arrowColorsOf } = colorRef.current;
        // How the arrows are drawn at the zoom the map is at: so many px, as
        // cells of each battlefield's frame. A cell is so many degrees of
        // longitude wide, and the map lays the whole turn of them across its
        // world's width in px.
        const zoom = mapInstance?.getZoom?.() ?? 5;
        const detail = arrowDetailAt(zoom);
        const cellsOf = (px) => (drawing) => (px * 360) / (drawing.frame.cell * WORLD_PX * 2 ** zoom);
        arrows.setData(frontArrowFeatures(drawn, arrowColorsOf, {
          day: days,
          halfWidthOf: cellsOf(detail.halfWidth),
          reachOf: cellsOf(detail.reach),
          leastOf: cellsOf(detail.least),
          still: detail.still,
          share: detail.share,
          days: detail.days,
        }));
        troops.setData(frontTroopFeatures(drawn, colorOf, { labelOf: shortUnitLabel }));
        painted = [arrows, troops];
        arrowsAtZoom = zoom;
      } else {
        waiting = true;
      }
      // react-map-gl makes the sources in an effect of its own, which may not
      // have run yet, and nothing else would fill them: there is no poll. A
      // frame of a playing is not tried again, since the next one follows it.
      if (!waiting || !atRest || playRef.current.size === 0 || attempt >= 90) return;
      retryHandle = requestAnimationFrame(() => paint(true, attempt + 1));
    };
    repaintRef.current = () => paint(true);

    // What has been played to the end of its run has nothing left to play,
    // however often the map is made again (the globe, a lost context).
    const settle = () => {
      for (const entry of playRef.current.values()) {
        if (entry.target.from === null && entry.day >= entry.stage.end) settleFront(entry.target);
      }
    };

    const frameMs = 1000 / (isTouchPrimary() ? PLAY_FRAMES_PER_SECOND_TOUCH : PLAY_FRAMES_PER_SECOND);
    let paintedAt = 0;
    const tick = () => {
      const now = performance.now();
      const part = Math.min(1, (now - startedRef.current) / durationRef.current);
      if (part >= 1) {
        rafRef.current = 0;
        for (const entry of playRef.current.values()) entry.day = entry.until;
        paint(true);
        settle();
        return;
      }
      if (now - paintedAt >= frameMs) {
        paintedAt = now;
        // The days go by at one pace: a troop's own pace is in its path.
        for (const entry of playRef.current.values()) entry.day = entry.start + (entry.until - entry.start) * part;
        paint(false);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (retryHandle) cancelAnimationFrame(retryHandle);
      rafRef.current = 0;
      retryHandle = 0;
    };

    const play = (longest) => {
      durationRef.current = Math.max(PLAY_MS_LEAST, Math.min(PLAY_MS_MOST, longest * PLAY_MS_PER_DAY));
      startedRef.current = performance.now();
      paintedAt = 0;
      paint(false);
      rafRef.current = requestAnimationFrame(tick);
    };

    // ---- the land's own edge ---------------------------------------------------
    //
    // The cells know sea from land only by the square, and the colour would
    // end on squares along every coast. The map has the land's own shape: the
    // regions it has drawn. So once the map has come to rest each picture is
    // given a mask made from them, of where the land of its battlefield's two
    // sides really is, and is drawn again cut to that (frontPaint.js). Only
    // for the part of the map on the screen, which is all the map has loaded:
    // the rest goes by the cells until it is looked at.
    let maskedFor = "";
    const fold = (name) => String(name ?? "").trim().toLowerCase();
    const maskOf = (entry, bounds) => {
      const { picture } = entry;
      const { target, player } = picture;
      // A flat sheet's rows are not evenly spaced: it goes by the cells.
      if (target.rowOf || typeof document === "undefined") return null;
      const { frame, sides } = entry.target.view;
      const members = new Set([...(sides?.[0] ?? []), ...(sides?.[1] ?? [])].map(fold));
      const owners = ownersRef.current ?? {};
      const { width, height, scale } = target;
      if (!picture.maskCanvas) {
        picture.maskCanvas = document.createElement("canvas");
        picture.maskCanvas.width = width;
        picture.maskCanvas.height = height;
      }
      const context = picture.maskCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      const { toCell } = projectorOf(frame);
      let drawn = 0;
      for (const sourceId of MASK_SOURCES) {
        if (!source(sourceId)) continue;
        let features = [];
        try {
          features = mapInstance.querySourceFeatures(sourceId) ?? [];
        } catch {
          features = [];
        }
        for (const feature of features) {
          const properties = feature.properties ?? {};
          const id = String(properties.GID_1 ?? properties.id ?? "");
          if (!members.has(fold(owners[id] ?? properties.owner))) continue;
          const { type, coordinates } = feature.geometry ?? {};
          const polygons = type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : [];
          for (const polygon of polygons) {
            context.beginPath();
            for (const ring of polygon) {
              for (let index = 0; index < ring.length; index += 1) {
                const [x, y] = toCell(ring[index][0], ring[index][1]);
                if (index === 0) context.moveTo(x * scale, height - y * scale);
                else context.lineTo(x * scale, height - y * scale);
              }
              context.closePath();
            }
            context.fill("evenodd");
            drawn += 1;
          }
        }
      }
      if (drawn === 0) return null;
      const shape = context.getImageData(0, 0, width, height).data;
      const mask = target.mask?.length === width * height ? target.mask : new Uint8Array(width * height);
      // The part of the picture the map has on the screen.
      const [west, south] = toCell(bounds.getWest(), bounds.getSouth());
      const [east, north] = toCell(bounds.getEast(), bounds.getNorth());
      const x0 = Math.max(0, Math.floor(west * scale));
      const x1 = Math.min(width, Math.ceil(east * scale));
      const y0 = Math.max(0, Math.floor(height - north * scale));
      const y1 = Math.min(height, Math.ceil(height - south * scale));
      const { cols, rows, state } = player;
      for (let y = 0; y < height; y += 1) {
        const row = Math.min(rows - 1, Math.max(0, Math.floor(rows - (y + 0.5) / scale)));
        const seen = y >= y0 && y < y1;
        for (let x = 0; x < width; x += 1) {
          const at = y * width + x;
          if (seen && x >= x0 && x < x1) mask[at] = shape[at * 4 + 3];
          else mask[at] = state[row * cols + Math.min(cols - 1, Math.floor(x / scale))] === PAINT_WALL ? 0 : 255;
        }
      }
      return mask;
    };
    const remask = () => {
      if (rafRef.current || playRef.current.size === 0) return;
      const bounds = mapInstance?.getBounds?.();
      if (!bounds) return;
      const key = [
        (mapInstance.getZoom?.() ?? 0).toFixed(1), bounds.getWest().toFixed(2), bounds.getSouth().toFixed(2),
        bounds.getEast().toFixed(2), bounds.getNorth().toFixed(2),
        ...[...playRef.current.values()].map((entry) => `${entry.target.name}:${entry.picture.canvas.width}`),
      ].join("|");
      if (key === maskedFor && ownersRef.current === maskedOwners) return;
      maskedFor = key;
      maskedOwners = ownersRef.current;
      let any = false;
      for (const entry of playRef.current.values()) {
        const mask = maskOf(entry, bounds);
        if (!mask && !entry.picture.target.mask) continue;
        entry.picture.target.mask = mask ?? undefined;
        any = true;
      }
      if (any) paint(true);
    };
    let maskedOwners = null;
    mapInstance?.on?.("idle", remask);

    let declared = "";
    const sync = () => {
      const targets = getFrontTargets().slice(0, FRONT_PAINT_SLOTS);
      const next = new Map();
      let longest = 0;
      targets.forEach((target, slot) => {
        const stage = stageOf(target.view);
        const was = playRef.current.get(target.name);
        let start;
        if (was && was.run === target.run) {
          // The same run: it plays on from the day it is showing, unless it is
          // told to show days that day is not among.
          start = target.from !== null && (was.day < target.from || was.day > target.until) ? target.from : was.day;
        } else if (target.from !== null) {
          start = target.from;
        } else {
          // A run the map has not shown is played from its beginning; one it
          // has nothing left to play of is shown as it ended.
          start = target.fresh ? stage.start : target.until;
        }
        // Never backwards: a day already past is simply shown.
        if (start > target.until) start = target.until;
        // The picture is the run's and the frame's: the same run shown for
        // another of its days (a turn being revealed) keeps the one it has.
        // Another run on the same frame is played on the canvas the map
        // already has (makePicture): the map is told of a canvas once, by its
        // size and place, and would go on showing the old one.
        const fits = Boolean(was) && pictureFits(was.picture, target.view.frame);
        const same = fits && was.stage.view.replay === stage.view.replay;
        const picture = same ? was.picture : makePicture(target.view, fits ? was.picture : null);
        picture.stale = true;
        next.set(target.name, { target, run: target.run, stage, picture, slot, start, until: target.until, day: start });
        longest = Math.max(longest, target.until - start);
      });
      playRef.current = next;

      const signature = [...next.values()].map((entry) => `${entry.slot}:${entry.target.name}:${entry.picture.canvas.width}x${entry.picture.canvas.height}:${entry.picture.coordinates.join(",")}`).join("|");
      if (signature !== declared) {
        declared = signature;
        setPictures([...next.values()].map((entry) => ({
          // (With its slot: a picture that is given another slot is another source to the map, which will not have one renamed.)
          key: `${entry.slot}:${entry.target.name}:${entry.picture.coordinates.join(",")}:${entry.picture.canvas.width}`,
          slot: entry.slot,
          canvas: entry.picture.canvas,
          coordinates: entry.picture.coordinates,
        })));
      }

      stop();
      // Nothing to play, or nobody watching: draw where it ends.
      if (!(longest > 0) || typeof document === "undefined" || document.visibilityState !== "visible") {
        for (const entry of next.values()) entry.day = entry.until;
        paint(true);
        settle();
        return;
      }
      play(longest);
    };

    const onStyleData = () => {
      if (rafRef.current || playRef.current.size === 0) return;
      const now = [source(FRONT_ARROW_SOURCE), source(FRONT_TROOP_SOURCE)];
      if (now.some((current, index) => current && current !== painted[index])) paint(true);
    };
    // A picture off the screen is not taken up by the map when it is redrawn;
    // it is handed over again when the map has moved.
    // An arrow drawn for another zoom is the wrong width at this one, and
    // stands for the wrong troops.
    const onMoveEnd = () => {
      if (rafRef.current) return;
      if (playRef.current.size > 0 && Math.abs((mapInstance?.getZoom?.() ?? arrowsAtZoom) - arrowsAtZoom) > 0.12) {
        paint(true);
        return;
      }
      for (const entry of playRef.current.values()) handOver(entry, false);
    };
    mapInstance?.on?.("styledata", onStyleData);
    mapInstance?.on?.("moveend", onMoveEnd);

    let probe = null;
    if (isFrontProbeEnabled()) {
      probe = {
        // Holds every battlefield at a day of its run (the last day when none
        // is given) and draws it.
        seek: (day) => {
          stop();
          for (const entry of playRef.current.values()) {
            entry.day = Number.isFinite(day) ? Math.max(entry.stage.start, Math.min(entry.stage.end, day)) : entry.stage.end;
          }
          paint(true);
          return [...playRef.current.values()].map((entry) => ({ name: entry.target.view.name, day: entry.day, of: entry.stage.end }));
        },
        // Plays every battlefield's run from its beginning.
        replay: () => {
          stop();
          let longest = 0;
          for (const entry of playRef.current.values()) {
            entry.start = entry.stage.start;
            entry.until = entry.stage.end;
            entry.day = entry.start;
            longest = Math.max(longest, entry.until - entry.start);
          }
          play(longest);
          return durationRef.current;
        },
        state: () => [...playRef.current.values()].map((entry) => ({
          name: entry.target.view.name,
          day: entry.day,
          start: entry.start,
          until: entry.until,
          of: entry.stage.end,
          playing: Boolean(rafRef.current),
          picture: [entry.picture.canvas.width, entry.picture.canvas.height],
          painted: entry.picture.player.bounds,
        })),
      };
      window.__OH_FRONTS__ = probe;
    }

    const stopSync = startFrontsSync();
    const unsubscribe = subscribeFronts(sync);
    sync();
    return () => {
      mapInstance?.off?.("styledata", onStyleData);
      mapInstance?.off?.("moveend", onMoveEnd);
      mapInstance?.off?.("idle", remask);
      repaintRef.current = () => {};
      stop();
      setFrontShownOwners([]);
      unsubscribe();
      stopSync();
      if (probe && window.__OH_FRONTS__ === probe) delete window.__OH_FRONTS__;
    };
  }, [map]);

  const active = pictures.length > 0;

  // The layers mount with a best-guess beforeId; the canonical stack settles
  // them once they exist, as it does the groups' (Nations.jsx). A picture's
  // source has just been made too: it is drawn into again now that it is there.
  useEffect(() => {
    if (!active) return undefined;
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.style) return undefined;
    const frame = requestAnimationFrame(() => {
      try {
        if (mapInstance.style && mapInstance.getLayer("fronts-troops")) enforceMapLayerOrder(mapInstance);
      } catch {
        // The style is being rebuilt; the next change settles the stack.
      }
      if (!rafRef.current) repaintRef.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, pictures, map]);

  if (!active) return null;

  const hasMapLayer = (id) => {
    try {
      return Boolean(map?.getMap?.()?.style && map.getLayer(id));
    } catch {
      return false;
    }
  };
  const firstPresent = (ids) => ids.find((id) => hasMapLayer(id));
  const paintBefore = firstPresent(["polity-boundaries-shadow", "polity-boundaries"]);
  const arrowBefore = firstPresent([
    "units-heading", "units-station", "country-curved-labels", "country-line-labels-live-world",
    "country-labels-live-managed", "country-labels", "polity-text-renderer", "cities-shapes",
  ]);
  const troopBefore = firstPresent(["units-fill", "units-icons", "units-name"]);
  // Every troop from far off: in the war room, and while the Events panel is
  // open (troopDetail.js).
  const everyTroop = warRoomOpen || everyTroopWanted;
  const troopMinZoom = everyTroop ? WAR_ROOM_TROOP_MIN_ZOOM : TROOP_MIN_ZOOM;
  const troopKindMinZoom = everyTroop ? WAR_ROOM_TROOP_KIND_MIN_ZOOM : TROOP_KIND_MIN_ZOOM;
  const troopNameMinZoom = everyTroop ? WAR_ROOM_TROOP_NAME_MIN_ZOOM : TROOP_NAME_MIN_ZOOM;
  const sideMarkerMaxZoom = everyTroop ? WAR_ROOM_SIDE_MARKER_MAX_ZOOM : SIDE_MARKER_MAX_ZOOM;
  const ofWarRoom = [["==", ["get", "battlefield"], warRoomField], ["==", ["get", "side"], warRoomSide]];
  const litFilter = warRoomOpen && warRoomLit >= 0 ? ["all", ...ofWarRoom, ["==", ["get", "command"], warRoomLit]] : NOTHING;
  const pickedFilter = warRoomOpen && warRoomPicked.length > 0
    ? ["all", IS_TROOP, ...ofWarRoom, ["in", ["get", "index"], ["literal", [...warRoomPicked]]]]
    : NOTHING;

  return (
    <>
      {pictures.map((picture) => (
        <Source
          key={picture.key}
          id={frontPaintSourceId(picture.slot)}
          type="canvas"
          canvas={picture.canvas}
          coordinates={picture.coordinates}
          animate={false}
        >
          <Layer
            id={frontPaintUnderLayerId(picture.slot)}
            type="raster"
            beforeId={paintBefore}
            paint={{
              "raster-opacity": seenThrough ? 0 : PAINT_CLEAR_OPACITY,
              "raster-saturation": -1,
              "raster-brightness-min": PAINT_CLEAR_TONE[0],
              "raster-brightness-max": PAINT_CLEAR_TONE[1],
              "raster-resampling": "linear",
              "raster-fade-duration": 0,
            }}
          />
          <Layer
            id={frontPaintLayerId(picture.slot)}
            type="raster"
            beforeId={paintBefore}
            paint={{
              // (Drawn by the layer that puts the bare map back, with it, where that layer works.)
              "raster-opacity": seenThrough ? 0 : PAINT_OPACITY,
              "raster-resampling": "linear",
              "raster-fade-duration": 0,
            }}
          />
        </Source>
      ))}

      {/* The data props stay referentially stable on purpose: react-map-gl only
          pushes them when they CHANGE, and every update here is the playing's. */}
      <Source id={FRONT_ARROW_SOURCE} type="geojson" data={EMPTY_FEATURE_COLLECTION} tolerance={0.15}>
        <Layer
          id="fronts-arrows-past"
          type="line"
          beforeId={arrowBefore}
          minzoom={ARROW_MIN_ZOOM}
          filter={["get", "past"]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": ["get", "rgb"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4.5, 0.7, 7, 1.2, 10, 1.8],
            "line-opacity": ["*", 0.4, SHOWN],
          }}
        />
        <Layer
          id="fronts-arrows-shadow"
          type="fill"
          beforeId={arrowBefore}
          minzoom={ARROW_MIN_ZOOM}
          filter={["!", ["get", "past"]]}
          paint={{
            "fill-color": CASING_COLOR,
            "fill-opacity": ["*", 0.28, SHOWN],
            "fill-translate": ARROW_SHADOW_SHIFT,
            "fill-translate-anchor": "viewport",
          }}
        />
        <Layer
          id="fronts-arrows-edge"
          type="fill"
          beforeId={arrowBefore}
          minzoom={ARROW_MIN_ZOOM}
          filter={["!", ["get", "past"]]}
          paint={{
            "fill-color": ["get", "dark"],
            "fill-opacity": ["*", 0.95, SHOWN],
            "fill-translate": ARROW_EDGE_SHIFT,
            "fill-translate-anchor": "viewport",
          }}
        />
        <Layer
          id="fronts-arrows"
          type="fill"
          beforeId={arrowBefore}
          minzoom={ARROW_MIN_ZOOM}
          filter={["!", ["get", "past"]]}
          paint={{
            "fill-color": ["get", "rgb"],
            "fill-opacity": ["*", 0.94, SHOWN],
            "fill-outline-color": ["get", "dark"],
          }}
        />
      </Source>

      <Source id={FRONT_TROOP_SOURCE} type="geojson" data={EMPTY_FEATURE_COLLECTION}>
        <Layer
          id="fronts-sides"
          type="circle"
          beforeId={troopBefore}
          maxzoom={sideMarkerMaxZoom}
          filter={IS_SIDE}
          paint={{
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 6, 5, 10],
            "circle-color": ["get", "rgb"],
            "circle-opacity": 0.92,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
            "circle-pitch-alignment": "map",
          }}
        />
        <Layer
          id="fronts-sides-count"
          type="symbol"
          beforeId={troopBefore}
          maxzoom={sideMarkerMaxZoom}
          filter={IS_SIDE}
          layout={{
            "text-field": ["to-string", ["get", "count"]],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 2, 8, 5, 11],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.7)",
            "text-halo-width": 1,
          }}
        />
        {/* The troops of the general the war room points at stand in a pool of
            light, and so does his marker from far off. */}
        <Layer
          id="fronts-sides-lit"
          type="circle"
          beforeId={troopBefore}
          maxzoom={sideMarkerMaxZoom}
          filter={["all", IS_SIDE, litFilter]}
          paint={{
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 10, 5, 15],
            "circle-color": WAR_ROOM_ACCENT,
            "circle-opacity": 0.38,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": WAR_ROOM_ACCENT,
            "circle-stroke-opacity": 0.95,
            "circle-pitch-alignment": "map",
          }}
        />
        <Layer
          id="fronts-troops-lit"
          type="circle"
          beforeId={troopBefore}
          minzoom={troopMinZoom}
          filter={["all", IS_TROOP, litFilter]}
          paint={{
            "circle-radius": TROOP_LIT_RADIUS,
            "circle-color": WAR_ROOM_ACCENT,
            "circle-opacity": 0.5,
            "circle-stroke-width": 2,
            "circle-stroke-color": WAR_ROOM_ACCENT,
            "circle-stroke-opacity": 0.95,
            "circle-pitch-alignment": "map",
          }}
        />
        {/* A troop that is dug in stands inside its rampart: a dark ring with a
            pale rim round its counter. It does not move while it is so. */}
        <Layer
          id="fronts-troops-dug"
          type="circle"
          beforeId={troopBefore}
          minzoom={troopMinZoom}
          filter={["all", IS_TROOP, ["==", ["get", "state"], DUG_IN]]}
          paint={{
            "circle-radius": TROOP_RAMPART_RADIUS,
            "circle-color": "rgba(16, 20, 28, 0.82)",
            "circle-stroke-width": 1.2,
            "circle-stroke-color": "#e6ebf2",
            "circle-stroke-opacity": 0.9,
            "circle-pitch-alignment": "map",
          }}
        />
        <Layer
          id="fronts-troops"
          type="circle"
          beforeId={troopBefore}
          minzoom={troopMinZoom}
          filter={IS_TROOP}
          paint={{
            "circle-radius": TROOP_RADIUS,
            "circle-color": ["get", "rgb"],
            // A troop worn down fades; one that is spent is a ghost of itself.
            "circle-opacity": [
              "case",
              ["==", ["get", "state"], "spent"], 0.35,
              ["interpolate", ["linear"], ["get", "strength"], 0, 0.5, 60, 0.95],
            ],
            "circle-stroke-width": ["case", ["get", "named"], 1.8, 1],
            "circle-stroke-color": [
              "case",
              ["==", ["get", "state"], "encircled"], "#ff6b6b",
              ["==", ["get", "state"], "advancing"], "#ffd24a",
              "#ffffff",
            ],
            "circle-stroke-opacity": ["case", ["==", ["get", "state"], "spent"], 0.4, 0.9],
            "circle-pitch-alignment": "map",
          }}
        />
        {/* The troops picked out in the war room: a ring round each. */}
        <Layer
          id="fronts-troops-picked"
          type="circle"
          beforeId={troopBefore}
          minzoom={troopMinZoom}
          filter={pickedFilter}
          paint={{
            "circle-radius": TROOP_RAMPART_RADIUS,
            "circle-color": "rgba(0, 0, 0, 0)",
            "circle-stroke-width": 2.2,
            "circle-stroke-color": "#ffffff",
            "circle-pitch-alignment": "map",
          }}
        />
        <Layer
          id="fronts-troops-kind"
          type="symbol"
          beforeId={troopBefore}
          minzoom={troopKindMinZoom}
          filter={IS_TROOP}
          layout={{
            "text-field": ["get", "glyph"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6.5, 7, 10, 11],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.65)",
            "text-halo-width": 1,
          }}
        />
        <Layer
          id="fronts-troops-name"
          type="symbol"
          beforeId={troopBefore}
          minzoom={troopNameMinZoom}
          filter={["all", IS_TROOP, ["get", "named"], ["!=", ["get", "label"], ""]]}
          layout={{
            "symbol-sort-key": ["-", ["get", "strength"]],
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-padding": 2,
            "text-offset": [0, 1.2],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6, 9, 10, 12],
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.85)",
            "text-halo-width": 1.2,
          }}
        />
      </Source>
    </>
  );
};

export default FrontLayers;
