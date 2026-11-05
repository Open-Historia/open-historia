/*! Open Historia — strikes played on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// When an event tells of a missile launched or a city bombed, the map shows
// it (runtime/strikes.js): the missile flies its arc from where it is launched
// and a blast spreads where it comes down; the aircraft fly there and bomb it;
// what is shot down on the way bursts in the air. On the globe the arcs are
// arcs in space and the aircraft fly above the ground (strikeCustomLayer.js);
// on the flat map an arc is bowed across it instead (strikeScene.js).
//
// A strike is played when the turn that told of it lands, and again whenever
// its event comes into view in the Events panel or its card asks
// (strikeStore.js). Nothing here changes the world: it is a spectacle of what
// an event already did.

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import { reduceMotionEnabled } from "../../runtime/mapSettings.js";
import { buildLocalPlaceEntries, getWorldPlaceIndex } from "../../runtime/placeSearch.js";
import { normalizeStrikes } from "../../runtime/strikes.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { STRIKE_LAYER_ID, createStrikeLayer } from "./strikeCustomLayer.js";
import { strikeEnds } from "./strikePlaces.js";
import { planStrike, ringOf, strikeItemsAt } from "./strikeScene.js";
import { getStrikeRequest, subscribeStrikeRequests } from "./strikeStore.js";
import { getUnits } from "./unitsController.js";

// Strikes played together set off this far apart, in seconds.
const BETWEEN = 0.7;
// An event coming into view plays its strikes again unless they were played this lately (ms).
const LATELY_MS = 12000;
const NONE = Object.freeze([]);
const selectStrikes = (world) => (Array.isArray(world?.strikes) ? world.strikes : NONE);
// How many kilometres a pixel of the map is, where it is being looked at.
const kmPerPixelOf = (map) => {
  try {
    const zoom = Number(map.getZoom());
    const lat = Number(map.getCenter()?.lat) || 0;
    const scale = (40075.017 * Math.cos((Math.max(-80, Math.min(80, lat)) * Math.PI) / 180)) / (512 * 2 ** zoom);
    return Number.isFinite(scale) && scale > 0 ? scale : 0;
  } catch {
    return 0;
  }
};
// Whether the map has no up: anything but a globe.
const isFlat = (map) => {
  try {
    return map.getProjection?.()?.type !== "globe";
  } catch {
    return true;
  }
};

const isProbeEnabled = () => {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("mapFillProbe") === "1") return true;
    return window.localStorage?.getItem("oh:mapFillProbe") === "1";
  } catch {
    return false;
  }
};

const StrikeLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const raw = useRuntimeState("world", selectStrikes);
  const world = useRuntimeState("world");
  const strikes = useMemo(() => normalizeStrikes(raw), [raw]);

  // What is being played: [{ plan, begins (ms) }], and when each strike was last played.
  const playingRef = useRef([]);
  const playedRef = useRef(new Map());
  const frameRef = useRef(0);
  // (A moment the clock is stopped at, for looking at one by hand: the probe's.)
  const heldRef = useRef(null);
  const worldRef = useRef(world);
  const strikesRef = useRef(strikes);
  const layerRef = useRef(null);
  useEffect(() => {
    worldRef.current = world;
    strikesRef.current = strikes;
  });

  // The layer: one for the map's life, put back after a change of style.
  useEffect(() => {
    if (!map) return undefined;
    const frame = () => {
      const now = heldRef.current ?? performance.now();
      const live = playingRef.current.filter((entry) => (now - entry.begins) / 1000 <= entry.plan.lasts);
      playingRef.current = live;
      if (live.length === 0) return null;
      const items = { ribbons: [], points: [], discs: [] };
      const kmPerPixel = kmPerPixelOf(map);
      for (const entry of live) {
        const seen = strikeItemsAt(entry.plan, (now - entry.begins) / 1000, { kmPerPixel });
        items.ribbons.push(...seen.ribbons);
        items.points.push(...seen.points);
        for (const disc of seen.discs) items.discs.push({ ...disc, rim: ringOf(disc.centre, disc.km, 1) });
      }
      return items;
    };
    const layer = createStrikeLayer({ frame, onError: (error) => console.warn("[strikes] the strike layer could not draw:", error) });
    layerRef.current = layer;
    const put = () => {
      try {
        if (!map.style || map.getLayer(STRIKE_LAYER_ID)) return;
        map.addLayer(layer);
        enforceMapLayerOrder(map);
      } catch { /* the map is between styles: asked again when the next has loaded */ }
    };
    put();
    map.on("styledata", put);
    return () => {
      map.off("styledata", put);
      cancelAnimationFrame(frameRef.current);
      try {
        if (map.style && map.getLayer(STRIKE_LAYER_ID)) map.removeLayer(STRIKE_LAYER_ID);
      } catch { /* the map is gone */ }
      layerRef.current = null;
    };
  }, [map]);

  // Plays strikes: each is laid out between its two places and set going.
  const play = (list, { always = false } = {}) => {
    if (!map || list.length === 0) return [];
    if (!always && (reduceMotionEnabled() || (typeof document !== "undefined" && document.hidden))) {
      for (const strike of list) playedRef.current.set(strike.id, performance.now());
      return [];
    }
    // The places the map knows by name, for an end the turn could not place.
    let entries = null;
    const known = () => {
      if (!entries) {
        const index = getWorldPlaceIndex();
        const state = worldRef.current ?? {};
        entries = buildLocalPlaceEntries({ cities: index.cities, polities: index.polities, markers: state.markers, cityRenames: state.cityRenames, polityOverrides: state.polityOverrides, groups: index.groups, groupRecords: state.groups, units: getUnits() });
      }
      return entries;
    };
    heldRef.current = null;
    const now = performance.now();
    const flat = isFlat(map);
    const kmPerPixel = kmPerPixelOf(map);
    const started = [];
    list.forEach((strike) => {
      const placed = strike.to && Number.isFinite(strike.to.lng) && strike.from && Number.isFinite(strike.from.lng);
      const ends = placed ? { from: [strike.from.lng, strike.from.lat], to: [strike.to.lng, strike.to.lat] } : strikeEnds(strike, known());
      const plan = ends.from && ends.to ? planStrike(strike, { ...ends, flat, kmPerPixel }) : null;
      playedRef.current.set(strike.id, now);
      if (!plan) return;
      // (One already being played starts afresh.)
      playingRef.current = playingRef.current.filter((entry) => entry.plan.id !== plan.id);
      playingRef.current.push({ plan, begins: now + started.length * BETWEEN * 1000 });
      started.push({ id: plan.id, weapon: plan.weapon, km: Math.round(plan.km), shown: plan.shown, down: plan.down, lasts: Math.round(plan.lasts * 10) / 10, from: plan.from, to: plan.to });
    });
    if (started.length === 0) return started;
    cancelAnimationFrame(frameRef.current);
    const tick = () => {
      try {
        map.triggerRepaint();
      } catch { /* the map is gone */ }
      if (playingRef.current.length > 0) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return started;
  };
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  });

  // A turn that has landed: what it told of is played. (Not what a game already
  // held when the map first saw it.)
  const seenRef = useRef(null);
  useEffect(() => {
    const before = seenRef.current;
    seenRef.current = new Set(strikes.map((strike) => strike.id));
    if (!before) {
      for (const strike of strikes) playedRef.current.set(strike.id, -Infinity);
      return;
    }
    const fresh = strikes.filter((strike) => !before.has(strike.id));
    if (fresh.length > 0) playRef.current(fresh);
  }, [strikes]);

  // An event has come into view, or a card asks to see its strike again.
  useEffect(() => subscribeStrikeRequests(() => {
    const request = getStrikeRequest();
    if (!request) return;
    const all = strikesRef.current;
    const wanted = request.ids ? all.filter((strike) => request.ids.includes(strike.id)) : all.filter((strike) => strike.eventId && strike.eventId === request.eventId);
    const now = performance.now();
    const due = request.again ? wanted : wanted.filter((strike) => now - (playedRef.current.get(strike.id) ?? -Infinity) > LATELY_MS);
    if (due.length > 0) playRef.current(due, { always: request.again });
  }), []);

  // For looking at it by hand (?mapFillProbe=1, as the fronts have).
  useEffect(() => {
    if (!isProbeEnabled()) return undefined;
    const probe = {
      // Plays strikes given as records ({ id, weapon, count, down, from: { lng, lat }, to: { lng, lat } }), or the world's own.
      play: (list) => playRef.current(normalizeStrikes(Array.isArray(list) && list.length > 0 ? list.map((strike, index) => ({ id: `probe-${index}`, owner: "probe", ...strike })) : strikesRef.current), { always: true }),
      state: () => ({ playing: playingRef.current.map((entry) => ({ id: entry.plan.id, at: Math.round(performance.now() - entry.begins) / 1000, lasts: entry.plan.lasts })), strikes: strikesRef.current.length, drawn: layerRef.current?.drawn ?? 0, layer: Boolean(map?.getLayer?.(STRIKE_LAYER_ID)) }),
      // Stops the clock with every strike being played at a moment of its own
      // time, in seconds, for a still picture: whenever the map next draws, that
      // moment is what it draws. Playing anything starts the clock again.
      hold: (seconds) => {
        const now = performance.now();
        heldRef.current = now;
        for (const entry of playingRef.current) entry.begins = now - seconds * 1000;
        cancelAnimationFrame(frameRef.current);
        try {
          map.triggerRepaint();
        } catch { /* the map is gone */ }
        return playingRef.current.length;
      },
    };
    window.__OH_STRIKES__ = probe;
    return () => {
      if (window.__OH_STRIKES__ === probe) delete window.__OH_STRIKES__;
    };
  }, [map]);

  return null;
};

export default StrikeLayers;
