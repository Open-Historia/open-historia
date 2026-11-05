/*! Open Historia — transporters on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The world's transporters (runtime/fronts/transports.js) drawn on the game's
// map: the way each is on, its carrier where it has got to, turned the way it
// is going, with the number of formations aboard; a mark where one was lost;
// and, while the war room is open, the player's own that have not set out
// (transportFeatures.js).
//
// A turn that lands while the map is open is PLAYED: each carrier goes from
// where it was drawn to where it now is, at the pace the fronts are played at
// (FrontLayers.jsx), so a convoy is seen crossing the sea and coming ashore
// while the line it lands behind moves.
//
// The ways are React's to give the map. The carriers are moved by hand, a
// frame at a time, on a source declared empty (as the troops are).

import React, { useEffect, useMemo, useRef } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { reduceMotionEnabled } from "../../runtime/mapSettings.js";
import { normalizeTransports } from "../../runtime/fronts/transports.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { EMPTY_TRANSPORT_FEATURES, transportFeatures, transportMoves } from "./transportFeatures.js";
import { TRANSPORT_TONES, ensureTransportIcons } from "./transportIcons.js";
import { useWarRoom } from "./warRoomStore.js";

const WAYS = "transports-ways-source";
const POINTS = "transports-points-source";
// The same pace a battlefield's days are played at.
const PLAY_MS_PER_DAY = 320;
const PLAY_MS_LEAST = 1400;
const PLAY_MS_MOST = 10000;

const isProbeEnabled = () => {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("mapFillProbe") === "1") return true;
    return window.localStorage?.getItem("oh:mapFillProbe") === "1";
  } catch {
    return false;
  }
};

const NONE = Object.freeze([]);
const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const selectTransports = (world) => (Array.isArray(world?.transports) ? world.transports : NONE);
const selectWars = (world) => (Array.isArray(world?.wars) ? world.wars : NONE);
const selectFlat = (world) => world?.projection?.type === "freeform";
const selectCountry = (game) => String(game?.country ?? "");

const TONE_COLOUR = ["match", ["get", "tone"], "own", TRANSPORT_TONES.own, "enemy", TRANSPORT_TONES.enemy, TRANSPORT_TONES.other];
const IS_PLAN = ["==", ["get", "what"], "plan"];
const IS_LOST = ["==", ["get", "what"], "lost"];
const IS_WAKE = ["==", ["get", "what"], "wake"];

const TransportLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const raw = useRuntimeState("world", selectTransports);
  const wars = useRuntimeState("world", selectWars);
  const flat = useRuntimeState("world", selectFlat);
  const country = useRuntimeState("game", selectCountry);
  const warRoomOpen = useWarRoom((state) => state.open);
  const previews = useWarRoom((state) => state.transportWays);

  const transports = useMemo(() => normalizeTransports(raw), [raw]);
  // Whoever is at war with the player: the other side of every war it is in.
  const enemies = useMemo(() => {
    const names = [];
    for (const war of wars) {
      if (war?.status === "ended") continue;
      const sides = [Array.isArray(war?.sideA) ? war.sideA : [], Array.isArray(war?.sideB) ? war.sideB : []];
      const mine = sides.findIndex((members) => members.some((member) => fold(member) === fold(country)));
      if (mine >= 0) names.push(...sides[1 - mine]);
    }
    return names;
  }, [wars, country]);

  // Where each carrier is DRAWN while a turn is being played, by its id.
  const shownRef = useRef(new Map());
  const beforeRef = useRef(null);
  const frameRef = useRef(0);
  const drawRef = useRef(() => {});
  const ways = useMemo(
    () => transportFeatures({ transports, viewer: country, enemies, planned: warRoomOpen, previews, flat }).ways,
    [transports, country, enemies, warRoomOpen, previews, flat],
  );

  // The carriers, put on their source by hand.
  useEffect(() => {
    if (!map) return undefined;
    let tries = 0;
    let retry = 0;
    const draw = () => {
      const data = transportFeatures({ transports, viewer: country, enemies, shown: shownRef.current, planned: warRoomOpen, previews, flat }).points;
      let source = null;
      try {
        source = map.style ? map.getSource(POINTS) : null;
      } catch { /* the map is between styles */ }
      if (source?.setData) {
        ensureTransportIcons(map);
        source.setData(data);
        return;
      }
      // react-map-gl has not made the source yet: looked for again for a second or so.
      if (tries < 90) {
        tries += 1;
        retry = requestAnimationFrame(draw);
      }
    };
    drawRef.current = draw;
    draw();
    const again = () => {
      tries = 0;
      draw();
    };
    map.on("styledata", again);
    return () => {
      cancelAnimationFrame(retry);
      map.off("styledata", again);
    };
  }, [map, transports, country, enemies, warRoomOpen, previews, flat]);

  // Plays moves ([{ id, from, to, days }]): each carrier goes from where it was
  // drawn to where it is, every one at its own pace over the same days.
  const play = (moves, { always = false } = {}) => {
    cancelAnimationFrame(frameRef.current);
    shownRef.current = new Map();
    if (moves.length === 0 || (!always && (reduceMotionEnabled() || (typeof document !== "undefined" && document.hidden)))) {
      drawRef.current();
      return 0;
    }
    const longest = moves.reduce((most, move) => Math.max(most, move.days), 1);
    const duration = Math.max(PLAY_MS_LEAST, Math.min(PLAY_MS_MOST, longest * PLAY_MS_PER_DAY));
    const started = performance.now();
    for (const move of moves) shownRef.current.set(move.id, move.from);
    const tick = (now) => {
      const days = Math.min(1, (now - started) / duration) * longest;
      for (const move of moves) shownRef.current.set(move.id, move.from + (move.to - move.from) * Math.min(1, days / move.days));
      drawRef.current();
      if (now - started < duration) frameRef.current = requestAnimationFrame(tick);
      else {
        shownRef.current = new Map();
        drawRef.current();
      }
    };
    drawRef.current();
    frameRef.current = requestAnimationFrame(tick);
    return duration;
  };
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  });

  // A turn that has landed: every carrier that went further is played there.
  const movedRef = useRef([]);
  useEffect(() => {
    const before = beforeRef.current;
    beforeRef.current = transports;
    // (The first the map sees of a game is drawn as it stands, not played.)
    const moves = before ? transportMoves(before, transports) : [];
    if (moves.length > 0) movedRef.current = moves;
    playRef.current(moves);
    return () => cancelAnimationFrame(frameRef.current);
  }, [transports]);

  // For looking at it by hand (?mapFillProbe=1, as the fronts have): the last
  // turn's voyages played again, or failing that every carrier from where it set out.
  useEffect(() => {
    if (!isProbeEnabled()) return undefined;
    const probe = {
      replay: () => {
        const moves = movedRef.current.length > 0 ? movedRef.current : transportMoves(null, beforeRef.current ?? []);
        return { moves, ms: playRef.current(moves, { always: true }) };
      },
      state: () => ({ playing: [...shownRef.current], transports: (beforeRef.current ?? []).map(({ id, status, gone, km, medium, owner }) => ({ id, status, gone, km, medium, owner })) }),
    };
    window.__OH_TRANSPORTS__ = probe;
    return () => {
      if (window.__OH_TRANSPORTS__ === probe) delete window.__OH_TRANSPORTS__;
    };
  }, []);

  const any = transports.length > 0;
  useEffect(() => {
    if (!any || !map) return;
    try {
      ensureTransportIcons(map);
      enforceMapLayerOrder(map);
    } catch { /* the map is between styles */ }
  }, [any, map, ways]);

  if (!any) return null;
  return (
    <>
      <Source id={WAYS} type="geojson" data={ways}>
        <Layer
          id="transports-way-casing"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": "rgba(5, 8, 13, 0.7)", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2.6, 7, 4.6], "line-opacity": ["case", IS_WAKE, 0.35, 1] }}
        />
        <Layer
          id="transports-way"
          type="line"
          layout={{ "line-cap": "butt", "line-join": "round" }}
          paint={{
            "line-color": TONE_COLOUR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.3, 7, 2.6],
            "line-dasharray": ["case", IS_PLAN, ["literal", [0.6, 1.8]], ["literal", [3, 1.6]]],
            "line-opacity": ["case", IS_PLAN, 0.8, IS_WAKE, 0.4, 0.95],
          }}
        />
      </Source>
      <Source id={POINTS} type="geojson" data={EMPTY_TRANSPORT_FEATURES.points}>
        <Layer
          id="transports-icons"
          type="symbol"
          filter={["!", IS_LOST]}
          layout={{
            "icon-image": ["get", "icon"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.7, 6, 1.05, 9, 1.35],
            "icon-rotate": ["get", "bearing"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["get", "count"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 11,
            "text-offset": [0, 1.5],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-optional": true,
          }}
          paint={{ "icon-opacity": ["case", IS_PLAN, 0.72, 1], "text-color": TONE_COLOUR, "text-halo-color": "rgba(5, 8, 13, 0.92)", "text-halo-width": 1.5 }}
        />
        <Layer
          id="transports-lost"
          type="symbol"
          filter={IS_LOST}
          layout={{
            "text-field": "×",
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 2, 20, 7, 30],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{ "text-color": TONE_COLOUR, "text-halo-color": "rgba(5, 8, 13, 0.92)", "text-halo-width": 2 }}
        />
      </Source>
    </>
  );
};

export default TransportLayers;
