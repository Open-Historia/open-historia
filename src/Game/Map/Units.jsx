/*! Open Historia — troop/unit map layer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Units are the map's way of showing what the events say, so they have to read
// as forces in motion rather than counters that blink from place to place.
//
// Positions are TWEENED: the controller emits a new list (its 5s poll, or a
// commit), and the counters glide to their new positions over ~1.2s. The tween
// runs entirely outside React — one render per data change to declare the
// layers, then per-frame setData straight on the MapLibre source. Re-rendering
// React sixty times a second to move a dot would be an obvious way to make the
// whole map stutter.
//
// Alongside the counters: a dashed heading line to wherever a unit is under
// orders to go, and a ring around a patrol's station. Those are what let you
// SEE a fleet probing your waters rather than having to infer it.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { subscribeUnits, getUnits, getPendingUnitOrders, startUnitsSync } from "./unitsController.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

const TWEEN_MS = 1200;
// Past this, the change is a re-spawn, a snapshot swap or a staged-reveal jump —
// not a march. Snap instead of flying a counter across an ocean in a second.
const SNAP_DISTANCE_DEG = 40;
const STATION_RING_POINTS = 48;
const EARTH_RADIUS_KM = 6371;

// MapLibre can "drape" only these layer types onto 3D terrain — it renders a
// contiguous run of them into a per-tile texture and paints that onto the
// terrain mesh. Anything else (symbols, circles) is drawn live, in 3D, on top.
const DRAPED_LAYER_TYPES = new Set([
  "background",
  "fill",
  "line",
  "raster",
  "hillshade",
  "color-relief",
]);

// The heading lines and station rings are `line` layers, so terrain drapes them.
// They must sit at the END of the map's draped run, NOT after the label layers —
// see arrangeUnitLayers for why that single detail decides the frame rate.
const UNIT_DRAPED_LAYERS = ["units-heading", "units-station"];

// The counters themselves: a circle and two symbol layers, none of them drapeable,
// all of them drawn live above the terrain. Bottom to top.
const UNIT_COUNTER_LAYERS = ["units-fill", "units-icons", "units-strength"];

// On-map glyph per unit type (rendered via the same font stack as the city
// symbols, so they appear wherever those do).
const TYPE_GLYPH = {
  infantry: "I",
  armor: "A",
  air: "F",
  naval: "N",
  artillery: "G",
  garrison: "C",
};

const ownerColorString = (colorMap, code) => {
  const rgb = colorMap[code];
  if (Array.isArray(rgb)) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const normalized = String(code ?? "").toUpperCase();
  if (normalized.length < 2) return "rgb(120, 120, 120)";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = Math.max(0, alphabet.indexOf(normalized[0]));
  const b = Math.max(0, alphabet.indexOf(normalized[1]));
  const c = Math.max(0, alphabet.indexOf(normalized[normalized.length - 1]));
  return `rgb(${72 + a * 5}, ${72 + c * 5}, ${72 + b * 5})`;
};

// A geodesic circle for a patrol's station. Generated in JS rather than leaning
// on a circle layer's radius, which is measured in screen pixels and would grow
// and shrink with the zoom instead of marking a fixed patch of ocean.
const stationRing = (lng, lat, radiusKm) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const delta = radiusKm / EARTH_RADIUS_KM;
  const phi1 = toRad(lat);
  const lambda1 = toRad(lng);
  const points = [];
  for (let i = 0; i <= STATION_RING_POINTS; i += 1) {
    const bearing = (i / STATION_RING_POINTS) * Math.PI * 2;
    const phi2 = Math.asin(
      Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearing),
    );
    const lambda2 =
      lambda1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(delta) * Math.cos(phi1),
        Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
      );
    points.push([toDeg(lambda2), toDeg(phi2)]);
  }
  return points;
};

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

const Units = () => {
  const [colorMap, setColorMap] = useState({});
  const [orders, setOrders] = useState([]);
  const { current: map } = useMap();

  // Everything the tween needs, kept out of React state so a frame costs a
  // setData call and nothing else.
  const fromRef = useRef(new Map()); // unitId -> {lng, lat} at the start of the tween
  const toRef = useRef(new Map()); // unitId -> {lng, lat} target
  const unitsRef = useRef([]);
  const colorRef = useRef({});
  const rafRef = useRef(0);
  const startedRef = useRef(0);

  useEffect(() => {
    getNationColors()
      .then((next) => {
        colorRef.current = next;
        setColorMap(next);
      })
      .catch((error) => console.error("Failed to load colors for units:", error));
  }, []);

  // Puts the unit layers where they belong, and keeps them there. Nothing else on
  // this map sets a beforeId — <Nations>, <Cities>, <MarkersLayer> and this
  // component all call addLayer() with no anchor — so the stacking order is
  // decided purely by which of them reached MapLibre first, which is not stable:
  // a source whose data resolves late renders null until it does, and a style
  // reload re-adds everything from scratch. Two things have to be true, and
  // neither one holds by accident:
  //
  // 1. The counters must be on top. When the region fills land above them a unit
  //    reads as though it were painted UNDER the map — the glyph and the strength
  //    label carry dark halos and stay legible through a 0.72-opacity fill, but
  //    the disc is its owner's colour sitting under that same owner's colour, so
  //    it washes out to a translucent smudge.
  //
  // 2. The heading/station lines must close the draped run rather than following
  //    the labels. MapLibre batches consecutive drapeable layers into one
  //    render-to-texture stack and flushes it on the first layer it cannot drape.
  //    Two line layers sitting after the label symbols open a SECOND stack, and
  //    the cost of that is not the extra terrain redraw — it is the cache. The
  //    RenderPool calls freeAllObjects() at the end of every flush, so stack two
  //    takes stack one's textures and re-stamps them; next frame the stamps no
  //    longer match and the whole region-fill drape is rebuilt from scratch. That
  //    is every fill and hairline on the map, match-expression fill-colour and
  //    all, re-rendered per tile per frame. Folding the lines into the first run
  //    leaves one stack, and the drape cache survives between frames.
  //
  // Deliberately idempotent: it compares the arrangement it wants against the one
  // in place and returns without touching anything when they agree, so the
  // styledata that moveLayer itself fires settles instead of looping.
  // getLayersOrder() hands back a copy of the id list, which is what makes this
  // cheap enough to run on every style change — getStyle() would serialize every
  // layer, and the region fills carry a match stop per region.
  useEffect(() => {
    const mapInstance = map?.getMap?.() ?? map;
    if (!mapInstance?.getLayersOrder) return undefined;

    const arrangeUnitLayers = () => {
      const present = (ids) => ids.filter((id) => mapInstance.getLayer(id));
      const draped = present(UNIT_DRAPED_LAYERS);
      const counters = present(UNIT_COUNTER_LAYERS);
      if (!draped.length && !counters.length) return;

      const order = mapInstance.getLayersOrder();
      const others = order.filter((id) => !draped.includes(id) && !counters.includes(id));
      // The first layer terrain cannot drape — where the draped run ends, and so
      // where the heading lines have to go to stay inside it.
      const firstLive = others.find((id) => !DRAPED_LAYER_TYPES.has(mapInstance.getLayer(id)?.type));
      const cut = firstLive ? others.indexOf(firstLive) : others.length;
      const desired = [...others.slice(0, cut), ...draped, ...others.slice(cut), ...counters];
      if (desired.join() === order.join()) return;

      for (const id of draped) mapInstance.moveLayer(id, firstLive);
      for (const id of counters) mapInstance.moveLayer(id);
    };

    arrangeUnitLayers();
    mapInstance.on("styledata", arrangeUnitLayers);
    return () => mapInstance.off("styledata", arrangeUnitLayers);
  }, [map]);

  useEffect(() => {
    const source = () => map?.getMap?.()?.getSource?.("units-source") ?? map?.getSource?.("units-source");

    const featuresAt = (progress) => ({
      type: "FeatureCollection",
      features: unitsRef.current
        .filter((unit) => Number.isFinite(unit.lng) && Number.isFinite(unit.lat))
        .map((unit) => {
          const from = fromRef.current.get(unit.id);
          const to = toRef.current.get(unit.id) ?? { lng: unit.lng, lat: unit.lat };
          const lng = from ? from.lng + (to.lng - from.lng) * progress : to.lng;
          const lat = from ? from.lat + (to.lat - from.lat) * progress : to.lat;
          return {
            type: "Feature",
            id: unit.id,
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: {
              id: unit.id,
              name: unit.name,
              type: unit.type,
              ownerCode: unit.ownerCode,
              strength: unit.strength,
              status: unit.status,
              covert: unit.covert === true,
              glyph: TYPE_GLYPH[unit.type] ?? "I",
              rgb: ownerColorString(colorRef.current, unit.ownerCode),
            },
          };
        }),
    });

    // react-map-gl creates the source in its own effect, which may not have run
    // when the first sync lands, and the source also disappears for a beat after
    // a style or projection change. Retry on the next few frames rather than
    // leaving the map blank until the controller's 5s poll comes round again.
    let retryHandle = 0;
    const paint = (progress, attempt = 0) => {
      const target = source();
      if (target?.setData) {
        target.setData(featuresAt(progress));
        return;
      }
      if (attempt >= 60) return;
      retryHandle = requestAnimationFrame(() => paint(progress, attempt + 1));
    };

    const tick = () => {
      const elapsed = performance.now() - startedRef.current;
      const t = Math.min(1, elapsed / TWEEN_MS);
      paint(easeOutCubic(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = 0;
        fromRef.current = new Map(toRef.current);
      }
    };

    const sync = () => {
      const next = getUnits();
      unitsRef.current = next;
      setOrders(getPendingUnitOrders());

      const nextTo = new Map();
      const nextFrom = new Map();
      let moved = false;
      for (const unit of next) {
        if (!Number.isFinite(unit.lng) || !Number.isFinite(unit.lat)) continue;
        const target = { lng: unit.lng, lat: unit.lat };
        nextTo.set(unit.id, target);

        // A unit seen for the first time starts where it is — no flying in from
        // the last unit's position, or from the middle of the ocean.
        const previous = fromRef.current.get(unit.id) ?? toRef.current.get(unit.id);
        if (!previous) {
          nextFrom.set(unit.id, target);
          continue;
        }
        const jump = Math.max(Math.abs(previous.lng - target.lng), Math.abs(previous.lat - target.lat));
        if (jump > SNAP_DISTANCE_DEG) {
          nextFrom.set(unit.id, target);
          continue;
        }
        nextFrom.set(unit.id, previous);
        if (jump > 1e-9) moved = true;
      }
      toRef.current = nextTo;
      fromRef.current = nextFrom;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      // Nothing to animate to, or nobody watching: paint the final state once.
      if (!moved || typeof document === "undefined" || document.visibilityState !== "visible") {
        fromRef.current = new Map(nextTo);
        paint(1);
        return;
      }
      startedRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    };

    const stop = startUnitsSync();
    const unsubscribe = subscribeUnits(sync);
    sync();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (retryHandle) cancelAnimationFrame(retryHandle);
      rafRef.current = 0;
      unsubscribe();
      stop();
    };
  }, [map]);

  // Heading lines and station rings. Rebuilt only when the standing orders
  // change — they are static between turns, unlike the counters themselves.
  const orderData = useMemo(() => {
    const units = new Map(unitsRef.current.map((unit) => [unit.id, unit]));
    const features = [];
    for (const order of orders) {
      const unit = units.get(order.unitId);
      if (!unit || !Number.isFinite(unit.lng) || !Number.isFinite(unit.lat)) continue;
      const rgb = ownerColorString(colorMap, unit.ownerCode);

      if (order.kind === "patrol" && order.radiusKm > 0) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: stationRing(order.toLng, order.toLat, order.radiusKm) },
          properties: { kind: "station", rgb },
        });
        continue;
      }
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[unit.lng, unit.lat], [order.toLng, order.toLat]],
        },
        properties: { kind: "heading", rgb },
      });
    }
    return features.length ? { type: "FeatureCollection", features } : EMPTY_FEATURE_COLLECTION;
  }, [orders, colorMap]);

  return (
    <>
      {/* Declared first so a heading line never draws over its own unit. Where
          these two actually END UP is settled by arrangeUnitLayers above, which
          tucks them in at the end of the terrain-draped run — below the label
          symbols, not after them, because a second drape stack costs the whole
          render-to-texture cache. */}
      <Source id="units-orders-source" type="geojson" data={orderData}>
        <Layer
          id="units-heading"
          type="line"
          minzoom={3}
          filter={["==", ["get", "kind"], "heading"]}
          paint={{
            "line-color": ["get", "rgb"],
            "line-dasharray": [2, 2],
            "line-opacity": 0.6,
            "line-width": 1.5,
          }}
        />
        <Layer
          id="units-station"
          type="line"
          filter={["==", ["get", "kind"], "station"]}
          paint={{
            "line-color": ["get", "rgb"],
            "line-dasharray": [3, 3],
            "line-opacity": 0.35,
            "line-width": 1.2,
          }}
        />
      </Source>

      {/* The data prop stays referentially stable on purpose: react-map-gl only
          pushes it when it CHANGES, and every position update here is driven
          imperatively by the tween above. */}
      <Source id="units-source" type="geojson" data={EMPTY_FEATURE_COLLECTION}>
        <Layer
          id="units-fill"
          type="circle"
          paint={{
            // An unconfirmed contact draws smaller as well as fainter — it reads
            // as a report rather than an established presence. The zoom
            // interpolation has to stay the OUTERMOST expression (MapLibre
            // rejects a nested one outright, and drops the whole layer with it),
            // so the covert case goes inside each stop rather than around them.
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              2, ["case", ["get", "covert"], 5.25, 7],
              6, ["case", ["get", "covert"], 8.25, 11],
              12, ["case", ["get", "covert"], 12, 16],
            ],
            "circle-color": ["get", "rgb"],
            // Pending (player-requested, not yet AI-resolved) units are translucent;
            // so is a force detected with no known line of support.
            "circle-opacity": [
              "case",
              ["==", ["get", "status"], "pending"], 0.32,
              ["get", "covert"], 0.42,
              0.92,
            ],
            "circle-stroke-width": ["case", ["==", ["get", "status"], "pending"], 1.5, 2],
            "circle-stroke-color": [
              "case",
              ["==", ["get", "status"], "pending"], "#93c5fd",
              ["get", "covert"], "#c4b5fd",
              ["==", ["get", "status"], "moving"], "#ffd24a",
              ["==", ["get", "status"], "engaged"], "#ff6b6b",
              "#ffffff",
            ],
            "circle-stroke-opacity": [
              "case",
              ["==", ["get", "status"], "pending"], 0.55,
              ["get", "covert"], 0.7,
              1,
            ],
            "circle-pitch-alignment": "map",
          }}
        />
        <Layer
          id="units-icons"
          type="symbol"
          layout={{
            "symbol-sort-key": ["-", ["get", "strength"]],
            "text-field": ["get", "glyph"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 13, 12, 18],
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.65)",
            "text-halo-width": 1,
            "text-opacity": [
              "case",
              ["==", ["get", "status"], "pending"], 0.5,
              ["get", "covert"], 0.6,
              1,
            ],
          }}
        />
        <Layer
          id="units-strength"
          type="symbol"
          minzoom={3}
          layout={{
            "symbol-sort-key": ["-", ["get", "strength"]],
            // Strength is a percentage of established strength now, so say so —
            // a bare "78" beside a counter meant nothing in particular.
            "text-field": ["concat", ["to-string", ["get", "strength"]], "%"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-offset": [0, 1.35],
            "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 8, 11, 12, 13],
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

export default Units;
