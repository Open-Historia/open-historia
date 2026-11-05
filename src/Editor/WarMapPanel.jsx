/*!
 * Open Historia Map Editor — terrain, fortified lines and climate zones
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// What a scenario draws on its map for war (runtime/warGeography.js), a tab
// each: ground troops cross more slowly, walls they have to break through, and
// climate zones with their own seasons, weather and dated events. The shapes
// are drawn with the Terrain, Fortified line and Climate zone tools (OlMap.jsx);
// this panel lists them and edits everything about them but their shape. The
// water regions that can freeze are marked in the region inspector
// (SelectionInspector.jsx, Can freeze).
//
// Edits here change the document as they are made, like the Groups panel's; a
// shape drawn, reshaped or deleted is a step on the map's undo stack.

import { useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { Row, Toggle } from "./fields.jsx";
import { ACCENT, inputStyle, labelDim, pillButton } from "./editorStyles.js";
import { WEATHER_STATES } from "../runtime/fronts/weather.js";
import { TERRAIN_LEVEL_MOST, WALL_LEVEL_LEAST, WALL_LEVEL_MOST } from "../runtime/warGeography.js";
import { isGameDate, normalizeGameDate } from "../runtime/gameDates.js";
import { CLIMATE_PRESETS, DAYS_IN_MONTH, monthDayOf, monthDayParts, newClimateEvent, newSeason, seasonsOfClimate } from "./warGeographyDoc.js";
import { WORLD_CLIMATE_ZONES, WORLD_TERRAIN_AREAS } from "../runtime/worldGeographyDefaults.js";

const TABS = [
  { id: "terrain", label: "Terrain" },
  { id: "fortification", label: "Fortified lines" },
  { id: "climate", label: "Climate" },
];

const TAB_INTROS = {
  terrain: "Ground troops cross more slowly: mountains, marshes, a river, a crevice. Level 0 is flat ground and 10 cannot be crossed at all.",
  fortification: "Walls and lines of forts that troops have to break through. Level 3 is the weakest, and 10 can never be broken.",
  climate: "Zones with their own seasons, weather and dated events. Each zone's colour blends into its neighbours' across its blend width.",
};

const DRAW_LABELS = {
  terrain: "Draw terrain on the map",
  fortification: "Draw a fortified line on the map",
  climate: "Draw a climate zone on the map",
};
const DRAWING_LABELS = {
  terrain: "Drawing terrain (click to stop)",
  fortification: "Drawing fortified lines (click to stop)",
  climate: "Drawing climate zones (click to stop)",
};
const EMPTY_LABELS = {
  terrain: "No terrain drawn yet.",
  fortification: "No fortified lines drawn yet.",
  climate: "No climate zones drawn yet.",
};
const BACK_LABELS = {
  terrain: "← All terrain",
  fortification: "← All fortified lines",
  climate: "← All climate zones",
};

// Level 0 to 10: how hard the ground is to cross.
const TERRAIN_LEVEL_LABELS = ["Flat", "Easy", "Uneven", "Rough", "Hard going", "Difficult", "Very difficult", "Severe", "Extreme", "Nearly impassable", "Impassable"];
// Level 3 to 10: how hard the wall is to break.
const WALL_LEVEL_LABELS = { 3: "Weak", 4: "Light", 5: "Solid", 6: "Strong", 7: "Very strong", 8: "Formidable", 9: "Nearly unbreakable", 10: "Unbreakable" };

const WEATHER_LABELS = { clear: "Clear skies", rain: "Rain", storm: "Storm", mud: "Mud", snow: "Snow", blizzard: "Blizzard", frost: "Frost", heat: "Heat", fog: "Fog" };
const CLIMATE_LABELS = { polar: "Polar", continental: "Continental", arid: "Arid", tropical: "Tropical" };
// The months by name, January first, in the page's own language: the browser knows them all.
const monthNames = () => {
  const language = (typeof document !== "undefined" && document.documentElement?.lang) || "en";
  const named = (code) => {
    const format = new Intl.DateTimeFormat(code, { month: "long", timeZone: "UTC" });
    return Array.from({ length: 12 }, (_, index) => format.format(new Date(Date.UTC(2001, index, 1))));
  };
  try {
    return named(language);
  } catch {
    return named("en");
  }
};

// What a season or an event does besides its weather (warGeography.js
// EFFECT_RANGES): `usual` is what the slider shows while the effect is unset.
const EFFECTS = [
  { key: "pace", label: "Pace", min: 0, max: 2, step: 0.05, usual: 1, sign: "×", hint: "How far troops get in a day. 1 is the usual." },
  { key: "attack", label: "Attack", min: 0, max: 2, step: 0.05, usual: 1, sign: "×", hint: "How hard an attack hits. 1 is the usual." },
  { key: "wear", label: "Wear", min: 0, max: 0.2, step: 0.005, usual: 0, sign: "+", hint: "Fatigue a day adds to every troop." },
  { key: "cold", label: "Cold", min: 0, max: 2, step: 0.05, usual: 0, sign: "", hint: "Strength troops short of supply lose to the cold." },
  { key: "heat", label: "Heat", min: 0, max: 2, step: 0.05, usual: 0, sign: "", hint: "Strength troops short of supply lose to the heat." },
  { key: "air", label: "Air", min: 0, max: 1, step: 0.05, usual: 1, sign: "×", hint: "How often aircraft fly. 1 always, 0 never." },
];

const tabButton = (active) => ({
  background: active ? "rgba(0,0,0,0.49)" : "rgba(255,255,255,0.06)",
  border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.1)",
  borderRadius: 999,
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  padding: "5px 12px",
});
const hint = { fontSize: 11.5, lineHeight: 1.45, color: "rgba(255,255,255,0.55)" };
const dim = { fontSize: 10.5, color: "rgba(255,255,255,0.5)" };
// (Never shrunk by the panel's column to fit it: the panel scrolls instead.
// A card clips its corners, and a clipped box would otherwise be squashed.)
const card = { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, overflow: "hidden", flexShrink: 0 };
const cardHead = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 9px", cursor: "pointer",
  background: "rgba(255,255,255,0.04)", border: "none", color: "white", textAlign: "left", fontSize: 12.5, fontWeight: 600,
};
const cardBody = { padding: "9px 10px", display: "flex", flexDirection: "column", gap: 7 };
const sliderRow = { display: "flex", alignItems: "center", gap: 8, fontSize: 12 };
const sliderLabel = { flex: "0 0 74px", color: "rgba(255,255,255,0.72)" };
const slider = { flex: 1, minWidth: 0, accentColor: ACCENT, cursor: "pointer" };
const sliderValue = { flex: "0 0 56px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.85)" };
const iconButton = { background: "transparent", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", padding: 2, display: "flex" };
const smallInput = { ...inputStyle, padding: "5px 7px" };

// A copy of `record` with `fields` over it; a field set to undefined is taken out.
const withFields = (record, fields) => {
  const next = { ...(record || {}), ...fields };
  for (const [key, value] of Object.entries(fields)) if (value === undefined) delete next[key];
  return next;
};

const Swatch = ({ color, size = 14 }) => (
  <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 3, flexShrink: 0, background: color, boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }} />
);

const Slider = ({ value, min, max, step, onChange, label }) => (
  <input
    type="range"
    min={min}
    max={max}
    step={step}
    value={value}
    aria-label={label}
    onChange={(e) => onChange(Number(e.target.value))}
    style={slider}
  />
);

// A day of the year as two pickers: the month, then its day.
const DayPicker = ({ label, value, onChange }) => {
  const { month, day } = monthDayParts(value);
  return (
    <div style={sliderRow}>
      <span style={sliderLabel}>{label}</span>
      <select value={month} onChange={(e) => onChange(monthDayOf(Number(e.target.value), day))} style={{ ...smallInput, flex: 1, minWidth: 0, cursor: "pointer" }}>
        {monthNames().map((name, index) => (
          <option key={index} value={index + 1} style={{ color: "#000" }}>{name}</option>
        ))}
      </select>
      <select value={day} onChange={(e) => onChange(monthDayOf(month, Number(e.target.value)))} style={{ ...smallInput, width: 62, cursor: "pointer" }}>
        {Array.from({ length: DAYS_IN_MONTH[month - 1] }, (_, index) => index + 1).map((number) => (
          <option key={number} value={number} style={{ color: "#000" }}>{number}</option>
        ))}
      </select>
    </div>
  );
};

// The shares of each weather in a season: a weight each, shown as its share.
const WeatherMix = ({ value, onChange }) => {
  const weights = value || {};
  const total = WEATHER_STATES.reduce((sum, state) => sum + (Number(weights[state]) || 0), 0);
  return (
    <>
      {WEATHER_STATES.map((state) => {
        const weight = Number(weights[state]) || 0;
        return (
          <div key={state} style={sliderRow}>
            <span style={sliderLabel}>{WEATHER_LABELS[state]}</span>
            <Slider value={weight} min={0} max={100} step={1} label={WEATHER_LABELS[state]} onChange={(next) => onChange(withFields(weights, { [state]: next > 0 ? next : undefined }))} />
            <span style={sliderValue}>{`${total > 0 ? Math.round((weight / total) * 100) : 0}%`}</span>
          </div>
        );
      })}
    </>
  );
};

const effectText = (effect, value) => `${effect.sign}${value.toFixed(effect.key === "wear" ? 3 : 2)}`;

// What a season or an event does: a slider each, unset until it is moved.
const EffectsEditor = ({ value, onChange }) => {
  const effects = value || {};
  return (
    <>
      {EFFECTS.map((effect) => {
        const set = effects[effect.key] !== undefined;
        const shown = set ? Number(effects[effect.key]) : effect.usual;
        return (
          <div key={effect.key} style={sliderRow} title={effect.hint}>
            <span style={sliderLabel}>{effect.label}</span>
            <Slider value={shown} min={effect.min} max={effect.max} step={effect.step} label={effect.label} onChange={(next) => onChange(withFields(effects, { [effect.key]: next }))} />
            <span style={{ ...sliderValue, opacity: set ? 1 : 0.4 }}>{effectText(effect, shown)}</span>
            <button
              type="button"
              disabled={!set}
              onClick={() => onChange(withFields(effects, { [effect.key]: undefined }))}
              title="Back to the weather's own"
              style={{ ...iconButton, opacity: set ? 1 : 0.25, cursor: set ? "pointer" : "default" }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
      <label style={{ ...sliderRow, cursor: "pointer" }}>
        <input type="checkbox" checked={effects.freezes === true} onChange={(e) => onChange(withFields(effects, { freezes: e.target.checked ? true : undefined }))} style={{ accentColor: ACCENT }} />
        <span>Water freezes</span>
      </label>
    </>
  );
};

const SeasonCard = ({ season, zoneColor, open, onToggle, onChange, onRemove }) => (
  <div style={card}>
    <button type="button" onClick={onToggle} style={cardHead}>
      {season.color ? <Swatch color={season.color} size={12} /> : null}
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{season.name || "Unnamed"}</span>
      <span style={dim}>{`${season.start} → ${season.end}`}</span>
      <Icon name={open ? "close" : "plus"} size={12} />
    </button>
    {open && (
      <div style={cardBody}>
        <div style={labelDim}>Name</div>
        <input value={season.name || ""} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} style={smallInput} />
        <DayPicker label="Season starts" value={season.start} onChange={(start) => onChange({ start })} />
        <DayPicker label="Season ends" value={season.end} onChange={(end) => onChange({ end })} />
        <Row label="Own colour" title="The zone's colour on the game's map in this season">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Toggle value={Boolean(season.color)} onChange={(on) => onChange({ color: on ? zoneColor : undefined })} />
            {season.color && (
              <input type="color" value={season.color} onChange={(e) => onChange({ color: e.target.value })} style={{ width: 34, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
            )}
          </span>
        </Row>
        <div style={labelDim}>Weather</div>
        <div style={hint}>How often each weather comes in this season.</div>
        <WeatherMix value={season.weather} onChange={(weather) => onChange({ weather })} />
        <div style={labelDim}>Effects</div>
        <div style={hint}>What the season does besides its weather. An effect left unset is the weather's own.</div>
        <EffectsEditor value={season.effects} onChange={(effects) => onChange({ effects })} />
        <button type="button" onClick={onRemove} style={{ ...pillButton(false), color: "#f87171", alignSelf: "flex-start" }}>
          Remove season
        </button>
      </div>
    )}
  </div>
);

// A dated event's date: written as the game writes dates, BC years included.
const DateInput = ({ value, onChange, label }) => (
  <input
    value={value || ""}
    aria-label={label}
    placeholder="YYYY-MM-DD"
    onChange={(e) => onChange(e.target.value)}
    onBlur={(e) => {
      if (isGameDate(e.target.value)) onChange(normalizeGameDate(e.target.value));
    }}
    style={{ ...smallInput, flex: 1, minWidth: 0 }}
  />
);

const EventCard = ({ event, open, onToggle, onChange, onRemove }) => {
  const datesRead = isGameDate(event.from) && isGameDate(event.to);
  return (
    <div style={card}>
      <button type="button" onClick={onToggle} style={cardHead}>
        <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{event.name || "Unnamed"}</span>
        <span style={dim}>{`${event.from || "…"} → ${event.to || "…"}`}</span>
        <Icon name={open ? "close" : "plus"} size={12} />
      </button>
      {open && (
        <div style={cardBody}>
          <div style={labelDim}>Name</div>
          <input value={event.name || ""} maxLength={80} onChange={(e) => onChange({ name: e.target.value })} style={smallInput} />
          <div style={sliderRow}>
            <span style={sliderLabel}>First day</span>
            <DateInput label="First day" value={event.from} onChange={(from) => onChange({ from })} />
          </div>
          <div style={sliderRow}>
            <span style={sliderLabel}>Last day</span>
            <DateInput label="Last day" value={event.to} onChange={(to) => onChange({ to })} />
          </div>
          {!datesRead && (
            <div style={{ ...hint, color: "#fbbf24" }}>Write each date as YYYY-MM-DD, with a minus before a year BC. An event without both dates is not saved.</div>
          )}
          <div style={sliderRow}>
            <span style={sliderLabel}>Weather</span>
            <select value={event.weather || ""} onChange={(e) => onChange({ weather: e.target.value || undefined })} style={{ ...smallInput, flex: 1, minWidth: 0, cursor: "pointer" }}>
              <option value="" style={{ color: "#000" }}>Weather as usual</option>
              {WEATHER_STATES.map((state) => (
                <option key={state} value={state} style={{ color: "#000" }}>{WEATHER_LABELS[state]}</option>
              ))}
            </select>
          </div>
          <div style={labelDim}>Effects</div>
          <EffectsEditor value={event.effects} onChange={(effects) => onChange({ effects })} />
          <button type="button" onClick={onRemove} style={{ ...pillButton(false), color: "#f87171", alignSelf: "flex-start" }}>
            Remove event
          </button>
        </div>
      )}
    </div>
  );
};

const ShapeActions = ({ onZoom, onRemove }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
    <button type="button" onClick={onZoom} style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4 }}>
      <Icon name="fit" size={13} /> Zoom to it
    </button>
    <button type="button" onClick={onRemove} style={{ ...pillButton(false), color: "#f87171", display: "flex", alignItems: "center", gap: 4 }}>
      <Icon name="trash" size={13} /> Delete
    </button>
  </div>
);

const TerrainEditor = ({ area, patch }) => (
  <>
    <div style={labelDim}>Name</div>
    <input value={area.name || ""} maxLength={80} onChange={(e) => patch({ name: e.target.value })} style={smallInput} />
    <div style={labelDim}>Level</div>
    <div style={sliderRow}>
      <Slider value={area.level} min={0} max={TERRAIN_LEVEL_MOST} step={1} label="Level" onChange={(level) => patch({ level })} />
      <span style={{ ...sliderValue, flex: "0 0 28px" }}>{area.level}</span>
    </div>
    <div style={{ fontSize: 13, fontWeight: 600 }}>{TERRAIN_LEVEL_LABELS[area.level] || ""}</div>
    <div style={hint}>The higher the level, the slower troops cross it. At 10 nobody can cross.</div>
  </>
);

const WallEditor = ({ wall, patch, owners, groupNames }) => {
  const known = owners.some((row) => row.key === wall.owner) || groupNames.includes(wall.owner);
  return (
    <>
      <div style={labelDim}>Name</div>
      <input value={wall.name || ""} maxLength={80} onChange={(e) => patch({ name: e.target.value })} style={smallInput} />
      <div style={labelDim}>Level</div>
      <div style={sliderRow}>
        <Slider value={wall.level} min={WALL_LEVEL_LEAST} max={WALL_LEVEL_MOST} step={1} label="Level" onChange={(level) => patch({ level })} />
        <span style={{ ...sliderValue, flex: "0 0 28px" }}>{wall.level}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{WALL_LEVEL_LABELS[wall.level] || ""}</div>
      <div style={hint}>The higher the level, the longer troops take to break through. At 10 it never breaks.</div>
      <div style={labelDim}>Held by</div>
      <select value={wall.owner || ""} onChange={(e) => patch({ owner: e.target.value })} style={{ ...smallInput, cursor: "pointer" }}>
        <option value="" style={{ color: "#000" }}>No one</option>
        {wall.owner && !known && <option value={wall.owner} style={{ color: "#000" }}>{wall.owner}</option>}
        {owners.length > 0 && (
          <optgroup label="Countries" style={{ color: "#000" }}>
            {owners.map((row) => (
              <option key={row.key} value={row.key} style={{ color: "#000" }}>{row.name}</option>
            ))}
          </optgroup>
        )}
        {groupNames.length > 0 && (
          <optgroup label="Groups" style={{ color: "#000" }}>
            {groupNames.map((name) => (
              <option key={name} value={name} style={{ color: "#000" }}>{name}</option>
            ))}
          </optgroup>
        )}
      </select>
      <div style={hint}>The country or group that built it or holds it.</div>
    </>
  );
};

const ClimateEditor = ({ zone, patch }) => {
  const [openSeason, setOpenSeason] = useState(-1);
  const [openEvent, setOpenEvent] = useState(-1);
  const seasons = Array.isArray(zone.seasons) ? zone.seasons : [];
  const events = Array.isArray(zone.events) ? zone.events : [];
  const patchSeason = (index, fields) => patch({ seasons: seasons.map((season, at) => (at === index ? withFields(season, fields) : season)) });
  const patchEvent = (index, fields) => patch({ events: events.map((event, at) => (at === index ? withFields(event, fields) : event)) });
  return (
    <>
      <div style={labelDim}>Name</div>
      <input value={zone.name || ""} maxLength={80} onChange={(e) => patch({ name: e.target.value })} style={smallInput} />
      <Row label="Colour" title="The zone's colour on the map">
        <input type="color" value={zone.color || "#7f8c99"} onChange={(e) => patch({ color: e.target.value })} style={{ width: 40, height: 26, padding: 0, border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, background: "transparent", cursor: "pointer" }} />
      </Row>
      <div style={labelDim}>Blend width</div>
      <div style={sliderRow}>
        <Slider value={zone.blendKm ?? 100} min={0} max={2000} step={10} label="Blend width" onChange={(blendKm) => patch({ blendKm })} />
        <span style={sliderValue}>{`${zone.blendKm ?? 100} km`}</span>
      </div>
      <div style={hint}>How far the zone's edge fades into the zones beside it.</div>
      <div style={labelDim}>Transition</div>
      <div style={sliderRow}>
        <Slider value={zone.transitionDays ?? 14} min={0} max={120} step={1} label="Transition" onChange={(transitionDays) => patch({ transitionDays })} />
        <span style={sliderValue}>{(zone.transitionDays ?? 14) === 1 ? "1 day" : `${zone.transitionDays ?? 14} days`}</span>
      </div>
      <div style={hint}>How many days one season takes to turn into the next.</div>

      <div style={labelDim}>Seasons</div>
      {seasons.length === 0 && <div style={hint}>No seasons: the zone has the game's own weather.</div>}
      {seasons.map((season, index) => (
        <SeasonCard
          key={index}
          season={season}
          zoneColor={zone.color || "#7f8c99"}
          open={openSeason === index}
          onToggle={() => setOpenSeason((current) => (current === index ? -1 : index))}
          onChange={(fields) => patchSeason(index, fields)}
          onRemove={() => {
            patch({ seasons: seasons.filter((_, at) => at !== index) });
            setOpenSeason(-1);
          }}
        />
      ))}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => {
            patch({ seasons: [...seasons, newSeason()] });
            setOpenSeason(seasons.length);
          }}
          disabled={seasons.length >= 12}
          style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4 }}
        >
          <Icon name="plus" size={13} /> Add season
        </button>
        <select
          value=""
          onChange={(e) => {
            const climate = e.target.value;
            if (!climate) return;
            if (seasons.length && !window.confirm("Replace this zone's seasons with that climate's?")) return;
            patch({ seasons: seasonsOfClimate(climate) });
            setOpenSeason(-1);
          }}
          style={{ ...smallInput, width: "auto", flex: 1, minWidth: 0, cursor: "pointer" }}
        >
          <option value="" style={{ color: "#000" }}>Seasons of a climate…</option>
          {CLIMATE_PRESETS.map((climate) => (
            <option key={climate} value={climate} style={{ color: "#000" }}>{CLIMATE_LABELS[climate]}</option>
          ))}
        </select>
      </div>

      <div style={labelDim}>Dated events</div>
      {events.length === 0 && <div style={hint}>A drought, a long winter, a monsoon that fails: weather and effects between two dates.</div>}
      {events.map((event, index) => (
        <EventCard
          key={index}
          event={event}
          open={openEvent === index}
          onToggle={() => setOpenEvent((current) => (current === index ? -1 : index))}
          onChange={(fields) => patchEvent(index, fields)}
          onRemove={() => {
            patch({ events: events.filter((_, at) => at !== index) });
            setOpenEvent(-1);
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          patch({ events: [...events, newClimateEvent()] });
          setOpenEvent(events.length);
        }}
        disabled={events.length >= 40}
        style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
      >
        <Icon name="plus" size={13} /> Add event
      </button>
    </>
  );
};

const ShapeDetail = ({ kind, row, patch, owners, groupNames }) => {
  if (kind === "terrain") return <TerrainEditor area={row} patch={patch} />;
  if (kind === "fortification") return <WallEditor wall={row} patch={patch} owners={owners} groupNames={groupNames} />;
  // Keyed by the zone, so another zone opens with its seasons and events closed.
  return <ClimateEditor key={row.id} zone={row} patch={patch} />;
};

const ShapeSummary = ({ kind, row, ownerName }) => {
  if (kind === "climate") {
    const count = Array.isArray(row.seasons) ? row.seasons.length : 0;
    return <div style={dim}>{count === 1 ? "1 season" : `${count} seasons`}</div>;
  }
  const word = kind === "terrain" ? TERRAIN_LEVEL_LABELS[row.level] : WALL_LEVEL_LABELS[row.level];
  return (
    <div style={{ ...dim, display: "flex", flexWrap: "wrap", gap: 5 }}>
      <span>{`Level ${row.level}`}</span>
      {word && <span>{word}</span>}
      {kind === "fortification" && row.owner && <span>{ownerName(row.owner)}</span>}
    </div>
  );
};

// A start from the real world's own (runtime/worldGeographyDefaults.js): the
// climates and the hard ground a scenario on the built-in basemaps is fought
// on where its author painted none, put into this scenario to be changed.
const WorldStart = ({ tab, count, onStart }) => {
  const climate = tab === "climate";
  return (
    <div style={{ ...card, padding: "9px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={hint}>
        {climate
          ? "With no zones of its own, a scenario on the built-in basemaps has the real world's: Siberia's long winter, the monsoon, the Sahara's heat. Painting a zone of its own replaces them all."
          : "With no hard ground of its own, a scenario on the built-in basemaps has the real world's: the great mountain ranges, the marshes, the jungles and the sand seas. The game's map never shows it: it slows troops. Painting an area of its own replaces it all."}
      </div>
      <button
        type="button"
        onClick={() => {
          if (count > 0 && !window.confirm(climate ? "Replace this scenario's climate zones with the real world's?" : "Replace this scenario's terrain with the real world's?")) return;
          onStart();
        }}
        style={{ ...pillButton(false), alignSelf: "flex-start" }}
      >
        {climate ? "Start from the real world's climates" : "Start from the real world's hard ground"}
      </button>
    </div>
  );
};

const WarMapPanel = ({
  tab,
  onTab,
  terrainAreas = [],
  fortifications = [],
  climateZones = [],
  setTerrainAreas,
  setFortifications,
  setClimateZones,
  selection = null,
  onPick,
  onUnpick,
  onZoom,
  onRemove,
  activeTool,
  setActiveTool,
  owners = [],
  groupNames = [],
  freezingCount = 0,
  onClose,
}) => {
  const lists = { terrain: terrainAreas, fortification: fortifications, climate: climateZones };
  const setters = { terrain: setTerrainAreas, fortification: setFortifications, climate: setClimateZones };
  const list = lists[tab] || [];
  const picked = selection?.kind === tab ? list.find((row) => row.id === selection.id) : null;
  const drawing = activeTool === tab;
  const ownerName = (key) => owners.find((row) => row.key === key)?.name || key;
  const patch = (id, fields) => setters[tab]?.((rows) => (rows || []).map((row) => (row.id === id ? withFields(row, fields) : row)));

  return (
    <Panel title="War map" icon="mountain" onClose={onClose} width={420}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.map((entry) => (
          <button key={entry.id} type="button" onClick={() => onTab(entry.id)} style={tabButton(tab === entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {picked ? (
        <>
          <button type="button" onClick={onUnpick} style={{ ...pillButton(false), alignSelf: "flex-start" }}>
            {BACK_LABELS[tab]}
          </button>
          <ShapeDetail kind={tab} row={picked} patch={(fields) => patch(picked.id, fields)} owners={owners} groupNames={groupNames} />
          <ShapeActions onZoom={() => onZoom(tab, picked.id)} onRemove={() => onRemove(tab, picked.id)} />
        </>
      ) : (
        <>
          <div style={hint}>{TAB_INTROS[tab]}</div>
          <button
            type="button"
            onClick={() => setActiveTool(drawing ? "select" : tab)}
            style={{ ...pillButton(drawing), display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Icon name={tab === "terrain" ? "mountain" : tab === "fortification" ? "wall" : "climate"} size={14} />
            {drawing ? DRAWING_LABELS[tab] : DRAW_LABELS[tab]}
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {list.length === 0 && <div style={{ ...hint, padding: "4px 2px" }}>{EMPTY_LABELS[tab]}</div>}
            {list.map((row) => (
              <div key={row.id} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
                <button type="button" onClick={() => onPick(tab, row.id)} style={{ background: "transparent", border: "none", color: "white", cursor: "pointer", flex: 1, minWidth: 0, textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  {tab === "climate" && <Swatch color={row.color || "#7f8c99"} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{row.name || "Unnamed"}</span>
                    <ShapeSummary kind={tab} row={row} ownerName={ownerName} />
                  </span>
                </button>
                <button type="button" onClick={() => onZoom(tab, row.id)} title="Zoom to it" style={iconButton}>
                  <Icon name="fit" size={14} />
                </button>
                <button type="button" onClick={() => onRemove(tab, row.id)} title="Delete" style={{ ...iconButton, color: "#f87171" }}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
          {(tab === "climate" || tab === "terrain") && (
            <WorldStart
              tab={tab}
              count={list.length}
              onStart={() => setters[tab]?.(() => JSON.parse(JSON.stringify(tab === "climate" ? WORLD_CLIMATE_ZONES : WORLD_TERRAIN_AREAS)))}
            />
          )}
          {tab === "climate" && (
            <>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                {freezingCount === 0 ? "No water region can freeze yet." : freezingCount === 1 ? "1 water region can freeze." : `${freezingCount} water regions can freeze.`}
              </div>
              <div style={hint}>Mark lakes and seas in the region panel (Can freeze). They freeze in a season whose effects say Water freezes.</div>
            </>
          )}
        </>
      )}
    </Panel>
  );
};

export default WarMapPanel;
