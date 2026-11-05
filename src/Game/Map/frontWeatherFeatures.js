/*! Open Historia — the weather as the map shows it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// How each weather is drawn, so it can be told at a glance: each as a still
// speckle the way frost is (mapPatterns.js), over at most a faint wash of its
// colour. Clear weather draws nothing. No word of it is written on the map:
// "remove all the things that say (winter frost) and other weather and
// seasonal stuff make that just be seen by the visuals or by asking the
// advisor" (the owner, 2026-10-14); the advisor is told it
// (Game/AI/advisorWeather.js).
//
// The weather is drawn in the shapes of the climate zones a scenario's
// designer painted, one patch a zone (weatherPatches.js): "the weather patches
// should be drawn by scenario designers who can choose the climate regions"
// (the owner, 2026-10-14). A battlefield in no zone has no patch.
//
// Pure: features out of records. The layers are FrontWeatherLayers.jsx; the
// pictures mapPatterns.js.

import { WEATHER_STATES } from "../../runtime/fronts/weather.js";
import { normalizeFrame } from "../../runtime/fronts/frame.js";
import { weatherImageId } from "./mapPatterns.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// What each weather is drawn with: whether it has a picture (mapPatterns.js),
// and the flat wash of colour laid under it.
export const WEATHER_OVERLAYS = Object.freeze({
  clear: Object.freeze({ pattern: false, wash: null }),
  rain: Object.freeze({ pattern: true, wash: null }),
  storm: Object.freeze({ pattern: true, wash: Object.freeze({ color: "#1b2532", opacity: 0.1 }) }),
  mud: Object.freeze({ pattern: true, wash: Object.freeze({ color: "#6b4a2a", opacity: 0.06 }) }),
  snow: Object.freeze({ pattern: true, wash: Object.freeze({ color: "#eef4fb", opacity: 0.06 }) }),
  blizzard: Object.freeze({ pattern: true, wash: Object.freeze({ color: "#f1f5fa", opacity: 0.12 }) }),
  frost: Object.freeze({ pattern: true, wash: Object.freeze({ color: "#d4e6f7", opacity: 0.1 }) }),
  heat: Object.freeze({ pattern: true, wash: Object.freeze({ color: "#ffc070", opacity: 0.06 }) }),
  fog: Object.freeze({ pattern: true, wash: Object.freeze({ color: "#bfc5cc", opacity: 0.1 }) }),
});

// How a weather is drawn: { pattern (the id of the first of its three tiles,
// or null), wash ({ color, opacity }, or null) }, or null for what is not weather.
export const weatherOverlayOf = (state) => {
  if (!WEATHER_STATES.includes(state) || !Object.hasOwn(WEATHER_OVERLAYS, state)) return null;
  const overlay = WEATHER_OVERLAYS[state];
  return { pattern: overlay.pattern ? weatherImageId(state) : null, wash: overlay.wash };
};

// The battlefields to draw weather over, as the world keeps them: those being
// fought over whose brief says the day's weather.
//   [{ name, frame, season, now }]
export const weatherFrontsOf = (battlefields) => list(battlefields).map((record) => {
  if (!record || (record.status !== "active" && record.status !== "frozen")) return null;
  const weather = record.brief?.weather;
  const now = clean(weather?.now);
  const frame = normalizeFrame(record.frame);
  if (!frame || !WEATHER_STATES.includes(now)) return null;
  return { name: clean(record.name), frame, season: clean(weather?.season), now };
}).filter(Boolean);

