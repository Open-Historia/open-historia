/*! Open Historia — the war room: the weather of the days ahead © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Weather forecast in the War Room. The weather is already decided by the
// campaign's seed, so the next week's weather can be shown. Players could time
// offensives around mud and snow" (the owner's list, 2026-10-16). The record
// keeps the weather of the two weeks after its run (runtime/fronts/battle.js,
// weather.js skiesAhead), worked out as the engine will work it out then: this
// is what will come, not a guess. A tile a day, then the spells, each with
// what it does to an army (weather.js WEATHER).

import React from "react";
import { formatGameDateReadable, parseGameDate } from "../../runtime/gameDates.js";
import { WEATHER, WEATHER_STATES } from "../../runtime/fronts/weather.js";
import { AMBER, BONE, BONE_FAINT, BONE_SOFT, STEEL, STENCIL, trayStyle } from "./warRoomTheme.js";

const Glyph = ({ children }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
// A picture a weather: what is plain to see of it, drawn in lines.
const GLYPHS = {
  clear: <Glyph><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></Glyph>,
  rain: <Glyph><path d="M7 14.5a4.5 4.5 0 1 1 1.1-8.9A5.5 5.5 0 0 1 18.5 8a3.3 3.3 0 0 1 .2 6.5H7z" /><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3" /></Glyph>,
  storm: <Glyph><path d="M7 14a4.5 4.5 0 1 1 1.1-8.9A5.5 5.5 0 0 1 18.5 7.5a3.3 3.3 0 0 1 .2 6.5" /><path d="M12.8 11.5L9.8 16.5h4l-2.6 5" /></Glyph>,
  mud: <Glyph><path d="M3 15.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1 2-1" /><path d="M4 19.5c1.7 0 1.7-1.2 3.4-1.2s1.7 1.2 3.4 1.2 1.7-1.2 3.4-1.2 1.7 1.2 3.4 1.2" /><path d="M8 10.5c0-2 2-4.5 4-6.5 2 2 4 4.5 4 6.5" /></Glyph>,
  snow: <Glyph><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /><path d="M9.6 4.6L12 6.6l2.4-2M9.6 19.4L12 17.4l2.4 2" /></Glyph>,
  blizzard: <Glyph><path d="M9 3.5v11M4.2 6.2l9.6 5.6M4.2 11.8l9.6-5.6" /><path d="M3 17.5h11.5a2.5 2.5 0 1 0-2.4-3.2M3 21h15.5a2.5 2.5 0 1 0-2.4-3.2" /></Glyph>,
  frost: <Glyph><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6" /><circle cx="12" cy="12" r="2.4" /></Glyph>,
  heat: <Glyph><circle cx="12" cy="8.5" r="3.8" /><path d="M12 1.8v1.6M5.3 8.5H3.7M20.3 8.5h-1.6M7.3 3.8l1 1M16.7 3.8l-1 1" /><path d="M4 16c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0M4 20.5c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0" /></Glyph>,
  fog: <Glyph><path d="M4 8h14M6 12h14M3 16h13M7 20h11" /></Glyph>,
};

// What a weather is called.
export const WeatherWord = ({ state }) => {
  if (state === "clear") return <>Clear skies</>;
  if (state === "rain") return <>Rain</>;
  if (state === "storm") return <>Storm</>;
  if (state === "mud") return <>Mud</>;
  if (state === "snow") return <>Snow</>;
  if (state === "blizzard") return <>Blizzard</>;
  if (state === "frost") return <>Frost</>;
  if (state === "heat") return <>Heat</>;
  if (state === "fog") return <>Fog</>;
  return null;
};

// What a weather does to an army, from its figures (weather.js WEATHER): the advance, attacks, aircraft, the cold.
const WeatherDoes = ({ state }) => {
  const effects = WEATHER[state];
  if (!effects) return null;
  const said = [];
  if (effects.pace <= 0.5) said.push(<React.Fragment key="pace">nearly halts an advance</React.Fragment>);
  else if (effects.pace < 0.85) said.push(<React.Fragment key="pace">slows an advance</React.Fragment>);
  if (effects.attack < 0.9) said.push(<React.Fragment key="attack">blunts attacks</React.Fragment>);
  if (effects.air === 0) said.push(<React.Fragment key="air">grounds aircraft</React.Fragment>);
  else if (effects.air < 0.75) said.push(<React.Fragment key="air">hampers aircraft</React.Fragment>);
  if (effects.cold >= 0.5) said.push(<React.Fragment key="cold">bitter cold wears troops down</React.Fragment>);
  if (effects.heat > 0) said.push(<React.Fragment key="heat">the heat wears troops down</React.Fragment>);
  if (said.length === 0) return <>good weather for an offensive</>;
  return said.map((part, index) => <React.Fragment key={index}>{index > 0 && (index === said.length - 1 ? <> and </> : <>, </>)}{part}</React.Fragment>);
};

// The days ahead in spells: [{ state, from, to, days }] (a day the calendar cannot read ends what is shown).
export const spellsOf = (forecast) => {
  const spells = [];
  for (const day of Array.isArray(forecast) ? forecast : []) {
    if (!WEATHER_STATES.includes(day?.w) || !parseGameDate(day?.d)) break;
    const last = spells[spells.length - 1];
    if (last && last.state === day.w) {
      last.to = day.d;
      last.days += 1;
    } else spells.push({ state: day.w, from: day.d, to: day.d, days: 1 });
  }
  return spells;
};

// The day of the month a date is, for its tile.
const dayOf = (date) => parseGameDate(date)?.day ?? "";

//   forecast   the record's brief.forecast: [{ d, w }], the days after the record's own
//   gameDate   the date the game stands at: days before it are passed over
export const WeatherAhead = ({ forecast, gameDate }) => {
  const days = (Array.isArray(forecast) ? forecast : []).filter((day) => !gameDate || String(day?.d) > String(gameDate));
  const spells = spellsOf(days);
  if (spells.length === 0) return null;
  const shown = spells.reduce((sum, spell) => sum + spell.days, 0);
  return (
    <div data-oh-war-room-weather="" style={{ ...trayStyle(false), marginTop: "0.4rem", padding: "0.45rem 0.5rem" }}>
      <div role="list" aria-label="The weather of the days ahead" style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
        {days.slice(0, shown).map((day) => (
          <div
            key={day.d}
            role="listitem"
            title={formatGameDateReadable(day.d) || day.d}
            style={{ alignItems: "center", background: "rgba(0,0,0,0.3)", border: `1px solid ${STEEL.seam}`, borderRadius: "2px", color: day.w === "clear" ? BONE_SOFT : AMBER, display: "flex", flexDirection: "column", gap: "0.08rem", minWidth: "1.45rem", padding: "0.16rem 0.1rem" }}
          >
            {GLYPHS[day.w]}
            <span style={{ color: BONE_FAINT, fontFamily: STENCIL, fontSize: "0.6rem" }}>{dayOf(day.d)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.18rem", marginTop: "0.35rem" }}>
        {spells.map((spell) => (
          <div key={spell.from} style={{ color: BONE_SOFT, fontSize: "0.72rem", lineHeight: 1.35 }}>
            <span style={{ color: spell.state === "clear" ? BONE : AMBER, fontWeight: 700 }}><WeatherWord state={spell.state} /></span>
            {" · "}
            {spell.days === 1
              ? <>{formatGameDateReadable(spell.from, "D MMMM") || spell.from}</>
              : <>{formatGameDateReadable(spell.from, "D MMMM") || spell.from}{" – "}{formatGameDateReadable(spell.to, "D MMMM") || spell.to}</>}
            {": "}
            <WeatherDoes state={spell.state} />
          </div>
        ))}
      </div>
    </div>
  );
};
