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
import { getNationColors, getNationFlags } from "../../runtime/assets.js";
import { subscribeUnits, getUnits, getPendingUnitOrders, startUnitsSync } from "./unitsController.js";
import { resolveUnitFlagUrl, syncUnitFlagIcons } from "./unitFlagIcons.js";
import { useWorldState } from "./useWorldState.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

const TWEEN_MS = 1200;
// Past this, the change is a re-spawn, a snapshot swap or a staged-reveal jump —
// not a march. Snap instead of flying a counter across an ocean in a second.
const SNAP_DISTANCE_DEG = 40;
const STATION_RING_POINTS = 48;
const EARTH_RADIUS_KM = 6371;

// Counter radius in px, as [zoom, normal, covert]. The flag icon derives its
// size from these too, so a change here moves the disc and the flag together
// instead of letting one drift outside the other.
const COUNTER_RADIUS_STOPS = [
  [2, 7, 5.25],
  [6, 11, 8.25],
  [12, 16, 12],
];
// The flag is rasterised at this size by unitFlagIcons.js; icon-size scales it
// down. Sits just inside the disc so the coloured rim and the status ring — which
// are what carry owner and state — still read around it.
const FLAG_ICON_PX = 64;
const FLAG_DISC_RATIO = 0.82;

// MapLibre rejects an interpolate nested inside a case outright, and drops the
// whole layer with it, so the zoom interpolation stays OUTERMOST in both of these
// and the covert branch goes inside each stop.
const COUNTER_RADIUS = [
  "interpolate", ["linear"], ["zoom"],
  ...COUNTER_RADIUS_STOPS.flatMap(([zoom, normal, covert]) => [
    zoom,
    ["case", ["get", "covert"], covert, normal],
  ]),
];
const FLAG_ICON_SIZE = [
  "interpolate", ["linear"], ["zoom"],
  ...COUNTER_RADIUS_STOPS.flatMap(([zoom, normal, covert]) => [
    zoom,
    [
      "case", ["get", "covert"],
      (2 * covert * FLAG_DISC_RATIO) / FLAG_ICON_PX,
      (2 * normal * FLAG_DISC_RATIO) / FLAG_ICON_PX,
    ],
  ]),
];

// Words that end a formation's name without identifying it. Every counter on the
// map is a group of something, so the word is pure width on a label that has to
// sit under a 30px disc.
const FORMATION_SUFFIXES = new Set([
  "group", "squadron", "flotilla", "fleet", "command", "battalion", "regiment",
  "brigade", "division", "corps", "army", "detachment", "force", "battlegroup",
  "wing", "strike", "task", "element", "unit", "formation", "flight", "team",
]);

// Words that cannot END a label, because they read as dangling. "Gulf of Guinea
// Strike Group" has to shorten to "Gulf of Guinea", never "Gulf of".
const CONNECTIVES = new Set(["of", "the", "de", "du", "da", "di", "la", "le", "van", "von", "al", "st", "st.", "and", "&"]);

// Two words of a unit's name, which is all that fits under a counter. The full
// name is one click away in the unit popup.
export const shortUnitLabel = (name) => {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";

  // Shed trailing formation nouns, but never below two words — "USN Amphibious
  // Squadron" should reach "USN Amphibious", not bottom out at "USN".
  const trimmed = [...words];
  while (trimmed.length > 2 && FORMATION_SUFFIXES.has(trimmed[trimmed.length - 1].toLowerCase())) {
    trimmed.pop();
  }

  // Take two words, then keep going while the label would otherwise end on a
  // connective — so "Gulf of Guinea" survives whole and "HMS St Albans" does too.
  const taken = trimmed.slice(0, 2);
  while (taken.length < trimmed.length && CONNECTIVES.has(taken[taken.length - 1].toLowerCase())) {
    taken.push(trimmed[taken.length]);
  }
  return taken.join(" ");
};

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
  // Scenario polities carry their own flags, and a custom-era country usually
  // resolves to no ISO flag at all — so this is the only flag it will ever have.
  const { polityOverrides } = useWorldState();

  // Everything the tween needs, kept out of React state so a frame costs a
  // setData call and nothing else.
  const fromRef = useRef(new Map()); // unitId -> {lng, lat} at the start of the tween
  const toRef = useRef(new Map()); // unitId -> {lng, lat} target
  const unitsRef = useRef([]);
  const colorRef = useRef({});
  const rafRef = useRef(0);
  const startedRef = useRef(0);
  // ownerCode -> flag icon id, for owners whose flag is on the map right now.
  const flagIconsRef = useRef({});
  // Where flags come from. Held in a ref rather than effect deps so a flag
  // arriving cannot tear down and restart the tween mid-glide.
  const flagSourcesRef = useRef({ customFlags: {}, polities: {} });
  // Published by the effect below so the flag loaders can fold a late-arriving
  // flag in and repaint, without owning any of the tween state themselves.
  const flagRefreshRef = useRef(() => {});
  // Last set of polity flag URLs seen, so a world poll that changed something
  // else does not re-run the flag pass every 5 seconds.
  const polityFlagSignatureRef = useRef("");

  useEffect(() => {
    getNationColors()
      .then((next) => {
        colorRef.current = next;
        setColorMap(next);
      })
      .catch((error) => console.error("Failed to load colors for units:", error));
  }, []);

  // Author-set flags (the scenario's flags.json). Fetched once, then a resync so
  // counters already on screen pick them up rather than waiting out the 5s poll.
  useEffect(() => {
    let cancelled = false;
    getNationFlags()
      .then((flags) => {
        if (cancelled) return;
        flagSourcesRef.current = { ...flagSourcesRef.current, customFlags: flags || {} };
        flagRefreshRef.current();
      })
      .catch((error) => console.error("Failed to load flags for units:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    flagSourcesRef.current = { ...flagSourcesRef.current, polities: polityOverrides ?? {} };
    // world.json is re-read every 5s and comes back as fresh objects, so react to
    // the flags actually changing rather than to the poll.
    const signature = Object.entries(polityOverrides ?? {})
      .map(([code, polity]) => `${code}:${polity?.flag || ""}`)
      .sort()
      .join("|");
    if (signature === polityFlagSignatureRef.current) return;
    polityFlagSignatureRef.current = signature;
    flagRefreshRef.current();
  }, [polityOverrides]);

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
              // "" is how MapLibre spells "no icon" (ResolvedImage.fromString
              // returns null for it), so an owner whose flag has not loaded —
              // or has no flag at all — falls back to the type glyph.
              flagIcon: flagIconsRef.current[unit.ownerCode] ?? "",
              label: shortUnitLabel(unit.name),
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

    // Owner flags for the counters. Re-asked rather than done once, because
    // map.setStyle() empties MapLibre's image atlas — syncUnitFlagIcons re-adds a
    // dropped icon from cached pixels without a second network request.
    const refreshFlagIcons = () => {
      const mapInstance = map?.getMap?.() ?? map;
      const { customFlags, polities } = flagSourcesRef.current;
      const owners = [...new Set(unitsRef.current.map((unit) => unit.ownerCode).filter(Boolean))];
      flagIconsRef.current = syncUnitFlagIcons(
        mapInstance,
        owners.map((ownerCode) => ({
          ownerCode,
          url: resolveUnitFlagUrl(ownerCode, customFlags, polities),
        })),
        // A flag that arrives later has to be folded in and repainted, because
        // the icon id only reaches the bucket through setData. A tween already
        // re-reads flagIconsRef every frame, so only a settled map needs it —
        // repainting mid-glide would snap the counters to their end positions.
        () => {
          refreshFlagIcons();
          if (!rafRef.current) paint(1);
        },
      );
    };
    flagRefreshRef.current = () => {
      refreshFlagIcons();
      if (!rafRef.current) paint(1);
    };

    const sync = () => {
      const next = getUnits();
      unitsRef.current = next;
      setOrders(getPendingUnitOrders());
      refreshFlagIcons();

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

    // map.setStyle() empties the image atlas, so put the flags back as soon as
    // the new style lands rather than leaving counters on the glyph fallback
    // until the controller's 5s poll comes round. Cheap when nothing is missing:
    // a hasImage() check per owner and no refetch either way.
    const mapInstance = map?.getMap?.() ?? map;
    mapInstance?.on?.("styledata", refreshFlagIcons);

    const stop = startUnitsSync();
    const unsubscribe = subscribeUnits(sync);
    sync();
    return () => {
      mapInstance?.off?.("styledata", refreshFlagIcons);
      flagRefreshRef.current = () => {};
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
          these two actually END UP is settled by MAP_LAYER_ORDER (mapLayerOrder.js),
          which tucks them in at the end of the terrain-draped run — below the
          label symbols, not after them, because a second drape stack costs the
          whole render-to-texture cache. */}
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
            // as a report rather than an established presence. Built from
            // COUNTER_RADIUS_STOPS so the flag icon scales with the disc.
            "circle-radius": COUNTER_RADIUS,
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
            // The owner's flag, cropped round to sit inside the counter. Empty
            // until unitFlagIcons.js has it on the map, and empty forever for an
            // owner with no flag to resolve — hence the glyph fallback below,
            // which is also the only place the unit TYPE still shows on the map.
            "icon-image": ["get", "flagIcon"],
            "icon-size": FLAG_ICON_SIZE,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["case", ["==", ["get", "flagIcon"], ""], ["get", "glyph"], ""],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 13, 12, 18],
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.65)",
            "text-halo-width": 1,
            // A pending or covert counter fades as a whole, so the flag has to
            // fade with the glyph it replaced rather than staying solid over a
            // ghosted disc.
            "icon-opacity": [
              "case",
              ["==", ["get", "status"], "pending"], 0.5,
              ["get", "covert"], 0.6,
              1,
            ],
            "text-opacity": [
              "case",
              ["==", ["get", "status"], "pending"], 0.5,
              ["get", "covert"], 0.6,
              1,
            ],
          }}
        />
        <Layer
          id="units-name"
          type="symbol"
          minzoom={3}
          layout={{
            // Two words of the formation's name (see shortUnitLabel) instead of
            // the strength percentage that used to sit here. Strength is still on
            // the counter — it drives the sort key below, and the popup gives the
            // number — but a name is what tells you which force this actually is.
            "symbol-sort-key": ["-", ["get", "strength"]],
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            // A name is several times wider than "30%", so unlike every other
            // unit layer these are allowed to collide and drop out. The sort key
            // decides who survives: strongest formation keeps its label, and the
            // counters themselves stay visible either way.
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-padding": 2,
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
