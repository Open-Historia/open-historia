/*! Open Historia — what the advisor knows of the seasons and the weather © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The map shows the seasons and the weather only by their patterns and tints,
// with no word of them: "remove all the things that say (winter frost) and
// other weather and seasonal stuff make that just be seen by the visuals or by
// asking the advisor" (the owner, 2026-10-14). So the advisor is told them, to
// answer when asked:
//   - each climate zone's season and weather today, the same the map draws
//     (world.zoneWeather as the last turn wrote it, else worked out as the turn
//     would: runtime/zoneWeather.js, from the campaign's own id);
//   - the weather of each battlefield the player fights on, as its record keeps
//     it (fronts/brief.js: the season, today's weather and the days of each).
// Names only, never ids. Nothing when the scenario's wars have no weather. It
// rides in the advisor's own system prompt (main.jsx buildAdvisorSystemPrompt):
// no request of its own.

import { getLibraryState } from "../../runtime/library.js";
import { attritionOf } from "../../runtime/attrition.js";
import { normalizeZoneWeather } from "../../runtime/warGeography.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { climateZonesOf } from "../../runtime/worldGeographyDefaults.js";
import { zoneWeatherFor } from "../../runtime/zoneWeather.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const sameName = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

// The campaign's own id, which the weather is drawn from (as the map's is).
const campaignSeed = () => {
  try {
    return String(getLibraryState()?.activeGameId ?? "");
  } catch {
    return "";
  }
};

// Each climate zone's weather today: [{ name, state, season }], in the zones' order.
export const zoneSkiesOf = (world, { date = "", seed = "" } = {}) => {
  const zones = climateZonesOf(world);
  if (!zones.length) return [];
  const kept = normalizeZoneWeather(world?.zoneWeather);
  const today = kept && kept.date === clean(date) ? kept : zoneWeatherFor(world, { seed, date });
  const names = new Map(zones.map((zone) => [String(zone?.id ?? ""), clean(zone?.name)]));
  return list(today?.zones)
    .map((entry) => ({ name: names.get(String(entry.id)) ?? "", state: clean(entry.state), season: clean(entry.season) }))
    .filter((entry) => entry.name && entry.state);
};

// The battlefields the player fights on, with the weather their records keep:
// [{ name, season, now, days: [[state, count], ...] }].
export const frontSkiesOf = (world, player = "") => list(world?.battlefields)
  .filter((record) => record && (record.status === "active" || record.status === "frozen")
    && list(record.sides).some((members) => list(members).some((member) => sameName(member, player))))
  .map((record) => {
    const weather = record.brief?.weather;
    const now = clean(weather?.now);
    if (!now) return null;
    const days = Object.entries(weather?.days ?? {}).filter(([, count]) => Number(count) > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return { name: clean(record.name), season: clean(weather?.season), now, days };
  })
  .filter((entry) => entry && entry.name);

// The weathers in the order they are told: the harsh first, clear skies last.
const TOLD = ["blizzard", "storm", "snow", "frost", "mud", "rain", "fog", "heat", "clear"];
const toldAt = (state) => (TOLD.includes(state) ? TOLD.indexOf(state) : TOLD.length - 1);

// The advisor's paragraph, or "".
//   world    the world as the player has seen it
//   player   the player's country
//   date     the game's date
//   seed     the campaign's id (the library's active game, as the map's)
export const describeWeatherForAdvisor = ({ world = {}, player = "", date = "", seed = campaignSeed() } = {}) => {
  if (!warSettingsOf(world).mechanics.weather) return "";
  const zones = zoneSkiesOf(world, { date, seed });
  const fronts = frontSkiesOf(world, player);
  if (!zones.length && !fronts.length) return "";
  const lines = [
    `[Seasons and weather] The map shows the seasons and the weather only by their patterns, with no words. When the player asks what the season or the weather is somewhere, or what it will do to a campaign, answer from this${clean(date) ? ` (as of ${clean(date)})` : ""}. A season's cold, heat and slowness are felt on its clear days too.`,
  ];
  if (zones.length) {
    const byState = new Map();
    for (const zone of zones) {
      if (!byState.has(zone.state)) byState.set(zone.state, []);
      byState.get(zone.state).push(zone.season ? `${zone.name} (${zone.season})` : zone.name);
    }
    const told = [...byState.entries()].sort((a, b) => toldAt(a[0]) - toldAt(b[0]))
      .map(([state, names]) => `${state === "clear" ? "clear skies" : state}: ${names.join(", ")}`);
    lines.push(`Climate zones, by today's weather (each with its season): ${told.join("; ")}.`);
  }
  // What the weather and being cut off have cost the player's armies (runtime/attrition.js).
  const worn = warSettingsOf(world).mechanics.attrition ? attritionOf(world?.attrition, player) : null;
  if (worn && (worn.lastMen > 0 || worn.warMen > 0)) {
    lines.push(`Attrition (the weather and being cut off, besides the fighting): ${worn.lastMen.toLocaleString("en-US")} men lost last turn, ${worn.warMen.toLocaleString("en-US")} in this war.`);
  }
  for (const front of fronts) {
    const total = front.days.reduce((sum, [, count]) => sum + Number(count), 0);
    const spells = front.days.map(([state, count]) => `${state} ${count}`).join(", ");
    lines.push(`Battlefield ${front.name}: ${front.now} now${front.season ? `, ${front.season}` : ""}${total > 0 ? `; over its last ${total} days of fighting: ${spells}` : ""}.`);
  }
  return lines.join("\n");
};
