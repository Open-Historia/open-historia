/*! Open Historia — the war room's aircraft: Deploy Aircraft © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so in the war room you can Deploy Aircraft Add. a tool that allows
// players to deploy air units directly to attack/bomb somewhere" (the owner,
// 2026-11-01).
//
// The rail's Aircraft key puts out a plate beside it (beside the map its
// target is clicked on): the player's air units, one to pick out, what it is
// to strike (troops, a structure or a city), and the key that takes up the
// tool for clicking it. A strike waits until time next passes, when the game
// flies it (runtime/fronts/airStrike.js): the defenders' air units within
// reach may intercept it, and its fighters fight theirs. Under it, what the
// last strike of the one picked came to.
//
// In the drawer, the strikes waiting and what the last turn's came to. Like
// the rail, these only show and ask: the panel (warRoom.jsx) sends every order
// through runtime/warRoomWrites.js.

import React, { useEffect } from "react";
import { useWarRoom } from "../Map/warRoomStore.js";
import { placeName } from "./warRoomData.js";
import { besideRailStyle } from "./warRoomFortify.jsx";
import { AMBER, BONE, BONE_SOFT, keyStyle, linkStyle, stencilStyle, trayStyle } from "./warRoomTheme.js";

const softText = { color: BONE_SOFT, fontSize: "0.72rem", lineHeight: 1.4 };
const smallKey = (on, disabled) => ({ ...keyStyle(on, disabled), fontSize: "0.7rem", padding: "0.34rem 0.45rem" });

export const STRIKE_KINDS = Object.freeze(["troops", "structure", "city"]);
const KindKey = ({ kind }) => {
  if (kind === "structure") return <>Structure</>;
  if (kind === "city") return <>City</>;
  return <>Troops</>;
};

// What a strike came to, in words.
export const OutcomeLine = ({ strike }) => {
  if (strike.outcome === "unopposed") return <>Nobody rose against it: its bombs fell on target.</>;
  if (strike.outcome === "through") return <>Intercepted, and its bombers got through.</>;
  if (strike.outcome === "partly") return <>Intercepted: only part of its bombers got through.</>;
  if (strike.outcome === "turned back") return <>Intercepted: its bombers turned back without bombing.</>;
  if (strike.outcome === "out of reach") return <>Its target was out of reach: it did not fly.</>;
  return <>It was gone before it could fly.</>;
};

// What its bombs did there.
const DoneLine = ({ strike }) => {
  if (strike.outcome === "turned back" || strike.outcome === "out of reach" || strike.outcome === "gone") return null;
  const enemy = strike.hits.filter((hit) => !hit.own).reduce((sum, hit) => sum + hit.n, 0);
  const own = strike.hits.filter((hit) => hit.own).reduce((sum, hit) => sum + hit.n, 0);
  return (
    <>
      {strike.kind === "troops" && (enemy > 0 ? <>Hit {enemy} enemy formations.</> : <>No enemy troops were under its bombs.</>)}
      {own > 0 && <span style={{ color: AMBER }}> {own} of your own side's formations were caught under them.</span>}
      {strike.status === "destroyed" && <> Destroyed.</>}
      {strike.status === "damaged" && <> Damaged.</>}
      {strike.kind === "structure" && strike.status && strike.status !== "damaged" && strike.status !== "destroyed" && <> Still standing.</>}
      {strike.dead > 0 && <> About {strike.dead.toLocaleString()} killed.</>}
    </>
  );
};

// What it lost, and what those who rose against it lost.
const LossLine = ({ strike }) => (
  <>
    Lost {strike.lost}% of its strength.
    {strike.intercepted.map((entry) => (
      <span key={entry.name}> <span data-no-translate>{entry.name}</span> lost {entry.lost}%.</span>
    ))}
  </>
);

// What is struck, by its name.
const TargetName = ({ order }) => <span data-no-translate>{placeName(order.target) || order.battlefield || order.country}</span>;

// A heading stencilled on the plate, ruled off to the right (as the drawer's own are).
const Heading = ({ children, style = null }) => (
  <div style={{ alignItems: "center", display: "flex", gap: "0.55rem", ...style }}>
    <div style={stencilStyle}>{children}</div>
    <div aria-hidden="true" style={{ background: "rgba(201,165,76,0.3)", flex: 1, height: "1px" }} />
  </div>
);

//   wings      the player's air units (runtime/fronts/airStrikeOps.js airUnitsOf); picked, the id of the one picked out
//   kind       what a click on the map is to strike: "troops", "structure" or "city"
//   reach      how far an air unit reaches, in km
//   flown      the player's strikes of the last turn (runtime/fronts/airStrike.js normalizeAirStrikes)
//   locked     nothing can be ordered now
//   tool       the tool in hand
//   onPick(id), onKind(kind), onAim(), onCallOff(id), onClose()
export const AircraftPlate = ({ isMobile, wings, picked, kind, reach, flown, locked, tool, onPick, onKind, onAim, onCallOff, onClose }) => {
  const rail = useWarRoom((state) => state.rail);
  const wing = wings.find((entry) => entry.id === picked) ?? null;
  // The first is picked out while none is (and when the one picked is gone).
  useEffect(() => {
    if (!wing && wings.length > 0) onPick(wings[0].id);
  }, [wing, wings, onPick]);
  const off = locked || !wing || wing.pending;
  const aiming = tool === "aircraft";
  const last = wing ? [...flown].reverse().find((strike) => strike.unitId === wing.id) ?? null : null;
  return (
    <div role="dialog" aria-label="Deploy Aircraft" data-oh-war-room-aircraft="" style={besideRailStyle(rail, isMobile)}>
      <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
        <div style={{ ...stencilStyle, flex: 1, fontSize: "0.72rem" }}>Deploy Aircraft</div>
        <button type="button" onClick={onClose} style={linkStyle}>Close</button>
      </div>
      {wings.length === 0 && <div style={softText}>You have no air units.</div>}
      <div role="listbox" aria-label="Your air units" style={{ display: "flex", flexDirection: "column", gap: "0.2rem", maxHeight: "9rem", overflowY: "auto" }}>
        {wings.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="option"
            aria-selected={entry.id === picked}
            className="oh-tap"
            data-oh-war-room-wing={entry.id}
            onClick={() => onPick(entry.id)}
            style={{ ...trayStyle(entry.id === picked), alignItems: "baseline", color: BONE, cursor: "pointer", display: "flex", gap: "0.45rem", padding: "0.3rem 0.45rem", textAlign: "left" }}
          >
            <span data-no-translate style={{ flex: 1, fontSize: "0.78rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
            <span style={{ ...softText, flex: "0 0 auto" }}>{entry.order ? "→ " : ""}{entry.strength}%</span>
          </button>
        ))}
      </div>
      {wing && (
        <>
          {wing.pending && <div style={softText}>It joins your order of battle when time next passes; it takes orders then.</div>}
          <div style={softText}>It reaches {reach.toLocaleString()} km from its base.</div>
          <Heading>Strike</Heading>
          <div role="radiogroup" aria-label="What to strike" style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {STRIKE_KINDS.map((entry) => (
              <button
                key={entry}
                type="button"
                role="radio"
                className="oh-tap"
                aria-checked={kind === entry}
                data-oh-war-room-strike-kind={entry}
                disabled={off}
                onClick={() => onKind(entry)}
                style={smallKey(kind === entry, off)}
              ><KindKey kind={entry} /></button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            <button type="button" className="oh-tap" aria-pressed={aiming} disabled={off} data-oh-war-room-aim-key="" onClick={onAim} style={smallKey(aiming, off)}>{aiming ? <>Cancel</> : <>Choose target</>}</button>
            {wing.order && <button type="button" className="oh-tap" disabled={locked} onClick={() => onCallOff(wing.id)} style={smallKey(false, locked)}>Call off</button>}
          </div>
          {wing.order && <div style={softText}>Ordered to strike <TargetName order={wing.order} /> when time next passes.</div>}
          {last && (
            <>
              <Heading style={{ marginTop: "0.2rem" }}>Last strike</Heading>
              <div style={softText}>
                <TargetName order={last} />: <OutcomeLine strike={last} /> <DoneLine strike={last} /> <LossLine strike={last} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

// The strikes waiting and the last turn's, for the drawer: nothing when there are none.
//   orders     the player's strikes waiting; flown, the player's strikes of the last turn
//   names      (unitId) => the air unit's name
//   onPick(id) the air unit is picked out on the plate beside the rail
export const AircraftList = ({ orders, flown, names, onPick }) => {
  if (orders.length === 0 && flown.length === 0) return null;
  return (
    <>
      <Heading style={{ marginTop: "0.8rem" }}>Air strikes</Heading>
      {orders.map((order) => (
        <div key={order.id} data-oh-war-room-strike={order.id} style={{ ...trayStyle(false), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}><span data-no-translate>{names(order.unit)}</span> → <TargetName order={order} /></div>
            <div style={softText}>Flies when time next passes.</div>
          </div>
          <button type="button" className="oh-tap" onClick={() => onPick(order.unit)} style={{ ...linkStyle, alignSelf: "center", flex: "0 0 auto" }}>Pick</button>
        </div>
      ))}
      {flown.map((strike) => (
        <div key={strike.id} data-oh-war-room-struck={strike.id} style={{ ...trayStyle(false), marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700 }}><span data-no-translate>{strike.unit || names(strike.unitId)}</span> → <TargetName order={strike} /></div>
          <div style={softText}><OutcomeLine strike={strike} /> <DoneLine strike={strike} /> <LossLine strike={strike} /></div>
        </div>
      ))}
    </>
  );
};
