/*! Open Historia — the war room's fortified lines: the one drawn, and the player's own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Make it so you can also manually draw fortified lines you want to create in
// the war room, and it says how long it will take to build depending on the
// size, on your country resources, manpower, and the time should also depend
// on the strength of the fortifications you want build."
//
// A line is drawn on the map with the rail's Fortify key (Map/WarRoomTools.jsx)
// and waits, drawn on the map, on a plate beside the rail: here its level is
// picked (3, a palisade, to 9, a great wall: a line nobody passes is the
// scenario designer's alone, drawn in the Workshop), and the plate says how
// long it is, what it holds against, and how long the player's country takes
// to build it at that level, with its treasury and its men (runtime/
// fortifyCost.js), before the player confirms it. In the drawer, the player's
// own lines: standing, or being built and when they will stand.
//
// Like the rail, these only show and ask: the panel (warRoom.jsx) sends what
// is confirmed through runtime/warRoomWrites.js.

import React, { useState } from "react";
import { buildTimeParts, fortifyCostFor, lineKm } from "../../runtime/fortifyCost.js";
import { fortifyResourceCost, resourcesOf } from "../../runtime/warResources.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { WALL_DAYS } from "../../runtime/fronts/walls.js";
import { addGameDays, formatGameDateReadable } from "../../runtime/gameDates.js";
import { SAFE_BOTTOM, SAFE_LEFT } from "../../runtime/mobileUi.js";
import { normalizeFortifications } from "../../runtime/warGeography.js";
import { lineColour, stillBuilding } from "../Map/warRoomMarks.js";
import { useWarRoom } from "../Map/warRoomStore.js";
import { AMBER, BONE, BONE_SOFT, BRASS, STEEL, keyStyle, linkStyle, plateStyle, stencilStyle, trayStyle } from "./warRoomTheme.js";

// The levels a line may be built to: a line nobody passes (10) is the
// scenario's to draw, not a country's to build (runtime/fortifyCost.js FORTIFY_LEVEL_MOST).
const LEVELS = Object.freeze([3, 4, 5, 6, 7, 8, 9]);
const softText = { color: BONE_SOFT, fontSize: "0.72rem", lineHeight: 1.4 };
const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// What a line of a level is called.
export const LevelWord = ({ level }) => {
  if (level <= 3) return <>Palisade</>;
  if (level === 4) return <>Earthworks</>;
  if (level === 5) return <>Rampart</>;
  if (level === 6) return <>Redoubts</>;
  if (level === 7) return <>Bastions</>;
  if (level === 8) return <>Fortress line</>;
  if (level === 9) return <>Great wall</>;
  return <>Impassable</>;
};

// What a line of a level holds against (runtime/fronts/walls.js WALL_DAYS: the
// days of assault at two to one that wear a stretch of it through).
const Holds = ({ level }) => {
  const days = WALL_DAYS[level];
  if (!(days < Infinity)) return <>Nobody can break through it.</>;
  return <>An assault at two to one breaks through a stretch of it in about {days} days, and siege guns in a third of that.</>;
};

// How long it takes to build, in words.
export const BuildTime = ({ days }) => {
  const { count, unit } = buildTimeParts(days);
  if (unit === "day") return count === 1 ? <>About a day to build</> : <>About {count} days to build</>;
  if (unit === "week") return <>About {count} weeks to build</>;
  if (unit === "month") return <>About {count} months to build</>;
  return <>About {count} years to build</>;
};

// Where a plate beside the rail stands: at the foot of the map, clear of the
// rail (however far it is out) and, on a phone, of the drawer folded under it.
export const besideRailStyle = (rail, isMobile) => ({
  ...plateStyle(),
  border: `2px solid ${STEEL.seam}`,
  borderRadius: "4px",
  bottom: isMobile ? `calc(7.5rem + ${SAFE_BOTTOM})` : `calc(1.6rem + ${SAFE_BOTTOM})`,
  boxShadow: `inset 0 1px 0 ${STEEL.lip}, 0 3px 12px rgba(0,0,0,0.5)`,
  boxSizing: "border-box",
  color: BONE,
  display: "flex",
  flexDirection: "column",
  fontFamily: "sans-serif",
  gap: "0.4rem",
  left: rail > 0 ? `calc(${rail}px + 1.5rem)` : `calc(${SAFE_LEFT} + 1.5rem)`,
  maxHeight: isMobile ? "calc(100vh - 13rem)" : "calc(100vh - 11rem)",
  maxWidth: "min(21rem, calc(100vw - 7.5rem))",
  overflowY: "auto",
  padding: "0.55rem 0.65rem",
  position: "fixed",
  zIndex: isMobile ? 10031 : 9998,
});

//   draft      the line drawn, [[lng, lat]...]; level, the level picked for it
//   world, country, gameDate   the game: whose line, from when, and what it takes
//   locked     nothing can be ordered now
//   onLevel(level), onConfirm(name), onRedraw(), onCancel()
export const FortifyPlate = ({ isMobile, draft, level, world, country, gameDate, locked, onLevel, onConfirm, onRedraw, onCancel }) => {
  const rail = useWarRoom((state) => state.rail);
  const [name, setName] = useState("");
  const cost = fortifyCostFor(world, country, draft, level);
  const ready = formatGameDateReadable(addGameDays(gameDate, cost.days));
  const men = cost.men.toLocaleString();
  const treasury = Math.round(cost.funding * 100);
  // What it costs of the country's war resources while it is built (runtime/warResources.js).
  const supplied = warSettingsOf(world).mechanics.supply === true;
  const spend = fortifyResourceCost(cost.days);
  const left = Math.round(resourcesOf(world?.warResources, country));
  return (
    <div role="dialog" aria-label="Fortified line" data-oh-war-room-fortify="" style={besideRailStyle(rail, isMobile)}>
      <div style={{ alignItems: "baseline", display: "flex", gap: "0.6rem" }}>
        <div style={{ ...stencilStyle, fontSize: "0.72rem" }}>Fortified line</div>
        <div style={softText}>{cost.km} km long</div>
      </div>
      <div role="radiogroup" aria-label="How strong it is to be" style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
        {LEVELS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === cost.level}
            className="oh-tap"
            data-oh-war-room-level={value}
            disabled={locked}
            onClick={() => onLevel(value)}
            style={{ ...keyStyle(value === cost.level, locked), borderBottom: `3px solid ${lineColour(value)}`, justifyContent: "center", minWidth: "2.05rem", padding: "0.34rem 0.3rem" }}
          >{value}</button>
        ))}
      </div>
      <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>
        <span style={{ color: lineColour(cost.level) }}>Level {cost.level}</span> · <LevelWord level={cost.level} />
      </div>
      <div style={softText}><Holds level={cost.level} /></div>
      <div data-oh-war-room-build-time="" style={{ color: AMBER, fontFamily: "sans-serif", fontSize: "0.86rem", fontWeight: 700 }}>
        <BuildTime days={cost.days} />
      </div>
      {ready && <div style={softText}>It would stand from about {ready}.</div>}
      {supplied && (
        <div data-oh-war-room-build-cost="" style={softText}>
          {`While it is built it uses ${spend.aMonth}% of your war resources a month, ${spend.total}% in all. You have ${left}%.`}
        </div>
      )}
      <div style={softText}>
        {cost.men > 0
          ? <>Built with your treasury at {treasury}% and {men} men fit to serve: the longer and stronger the line, the longer it takes.</>
          : <>How many people your country has is not known, so it is reckoned a country of middling size.</>}
      </div>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        placeholder="Name the line (if you wish)"
        aria-label="Name the line"
        style={{ backgroundColor: "rgba(0,0,0,0.5)", border: `1px solid ${STEEL.sunkLine}`, borderRadius: "3px", boxSizing: "border-box", color: BONE, fontFamily: "inherit", fontSize: "0.8rem", outline: "none", padding: "0.35rem 0.5rem", width: "100%" }}
      />
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
        <button type="button" className="oh-tap" disabled={locked} onClick={() => onConfirm(name)} style={keyStyle(true, locked)}>Confirm</button>
        <button type="button" className="oh-tap" disabled={locked} onClick={onRedraw} style={keyStyle(false, locked)}>Draw again</button>
        <button type="button" onClick={onCancel} style={linkStyle}>Cancel</button>
      </div>
    </div>
  );
};

// A heading stencilled on the plate, ruled off to the right (as the drawer's own are).
const Heading = ({ children }) => (
  <div style={{ alignItems: "center", display: "flex", gap: "0.55rem", marginTop: "0.8rem" }}>
    <div style={stencilStyle}>{children}</div>
    <div aria-hidden="true" style={{ background: "rgba(201,165,76,0.3)", flex: 1, height: "1px" }} />
  </div>
);

// The player's own lines, for the drawer: nothing when there are none.
//   onStop(id)   one still being built is given up
export const LinesList = ({ world, country, gameDate, locked, onStop }) => {
  const mine = normalizeFortifications(world?.fortifications).filter((line) => fold(line.owner) && fold(line.owner) === fold(country));
  if (mine.length === 0) return null;
  return (
    <>
      <Heading>Fortified lines</Heading>
      {mine.map((line) => {
        const building = stillBuilding(line, gameDate);
        const ready = building ? formatGameDateReadable(addGameDays(line.building.since, line.building.days)) : "";
        const km = Math.round(lineKm(line.points));
        return (
          <div key={line.id} data-oh-war-room-line={line.id} style={{ ...trayStyle(false), borderLeft: `3px solid ${lineColour(line.level)}`, marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
              {line.name ? <span data-no-translate>{line.name}</span> : <LevelWord level={line.level} />}
            </div>
            <div style={softText}>
              Level {line.level} · {km} km
              {building && (ready ? <> · being built, standing from about {ready}</> : <> · being built</>)}
              {!building && <> · standing</>}
              {line.breaches.length > 0 && <> · broken through in {line.breaches.length} places</>}
            </div>
            {building && <button type="button" disabled={locked} onClick={() => onStop(line.id)} style={linkStyle}>Stop building it</button>}
          </div>
        );
      })}
      <div style={{ ...softText, color: BRASS, marginTop: "0.3rem" }}>A line being built holds nothing until it stands.</div>
    </>
  );
};
