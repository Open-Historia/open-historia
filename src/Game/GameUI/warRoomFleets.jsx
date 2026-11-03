/*! Open Historia — the war room's fleets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "The war room should also be able to command fleets."
//
// The rail's Fleets key puts out a plate beside it (beside the map its orders
// are given on): the player's fleets, one to pick out, and for the one picked
// what it can be told (runtime/naval/fleetOps.js):
//
//   a posture    Patrol, Blockade, Seek battle, Hold, Withdraw, Escort: what it
//                does where it is, as the war at sea reads it (naval/engine.js)
//   a place      Sail to, or Patrol at, a place clicked on the map, at sea
//   a blockade   of a country the player is at war with, from the water off its
//                coast nearest the fleet
//   an escort    of one of the player's convoys at sea, from the middle of what
//                is left of its way
//   Call off     its standing order
//
// In the drawer, the fleets as they stand: strength, posture, and where each
// is going. Like the rail, these only show and ask: the panel (warRoom.jsx)
// sends every order through runtime/warRoomWrites.js.

import React, { useEffect, useState } from "react";
import { kmOnMap } from "../../runtime/unitMotion.js";
import { useWarRoom } from "../Map/warRoomStore.js";
import { besideRailStyle } from "./warRoomFortify.jsx";
import { BONE, BONE_SOFT, STEEL, keyStyle, linkStyle, stencilStyle, trayStyle } from "./warRoomTheme.js";

const softText = { color: BONE_SOFT, fontSize: "0.72rem", lineHeight: 1.4 };
const smallKey = (on, disabled) => ({ ...keyStyle(on, disabled), fontSize: "0.7rem", padding: "0.34rem 0.45rem" });
const selectStyle = { backgroundColor: "rgba(0,0,0,0.5)", border: `1px solid ${STEEL.sunkLine}`, borderRadius: "3px", color: BONE, flex: 1, fontFamily: "inherit", fontSize: "0.78rem", minWidth: 0, padding: "0.3rem 0.4rem" };

// The postures the war room gives, each with its key.
const POSTURE_KEYS = Object.freeze(["patrol", "blockade", "assaulting", "holding", "withdrawing", "transit"]);
const PostureKey = ({ posture }) => {
  if (posture === "patrol") return <>Patrol</>;
  if (posture === "blockade") return <>Blockade</>;
  if (posture === "assaulting") return <>Seek battle</>;
  if (posture === "holding") return <>Hold</>;
  if (posture === "withdrawing") return <>Withdraw</>;
  return <>Escort</>;
};

// What a fleet is doing, as it stands.
const PostureWord = ({ posture }) => {
  if (posture === "patrol") return <>patrolling</>;
  if (posture === "blockade") return <>blockading</>;
  if (posture === "assaulting") return <>seeking battle</>;
  if (posture === "holding") return <>holding</>;
  if (posture === "withdrawing") return <>withdrawing</>;
  if (posture === "transit") return <>under way</>;
  if (posture === "massing") return <>massing</>;
  if (posture === "exercise") return <>on exercise</>;
  return <>at sea</>;
};

// Its standing order, in words.
const OrderLine = ({ fleet }) => {
  const order = fleet.order;
  if (!order) return <>No standing order.</>;
  const radius = Math.round(order.radiusKm);
  if (order.kind === "patrol") return <>Patrolling within {radius} km of its station.</>;
  const km = Math.round(kmOnMap(fleet.lat, fleet.lng, order.toLat, order.toLng));
  return <>Under way, about {km} km to go.</>;
};

// A heading stencilled on the plate, ruled off to the right (as the drawer's own are).
const Heading = ({ children, style = null }) => (
  <div style={{ alignItems: "center", display: "flex", gap: "0.55rem", ...style }}>
    <div style={stencilStyle}>{children}</div>
    <div aria-hidden="true" style={{ background: "rgba(201,165,76,0.3)", flex: 1, height: "1px" }} />
  </div>
);

//   fleets     the player's fleets (fleetOps.js fleetsOf); picked, the id of the one picked out
//   enemies    the countries the player is at war with; convoys, its convoys at sea
//   locked     nothing can be ordered now
//   tool, station   the tool in hand, and what a click orders for the fleet
//   onPick(id), onOrder(op), onPlace("move" | "patrol"), onClose()
export const FleetsPlate = ({ isMobile, fleets, picked, enemies, convoys, locked, tool, station, onPick, onOrder, onPlace, onClose }) => {
  const rail = useWarRoom((state) => state.rail);
  const fleet = fleets.find((entry) => entry.id === picked) ?? null;
  // The first is picked out while none is (and when the one picked is gone).
  useEffect(() => {
    if (!fleet && fleets.length > 0) onPick(fleets[0].id);
  }, [fleet, fleets, onPick]);
  const [enemy, setEnemy] = useState("");
  const [convoy, setConvoy] = useState("");
  const target = enemies.includes(enemy) ? enemy : enemies[0] ?? "";
  const covered = convoys.some((entry) => entry.id === convoy) ? convoy : convoys[0]?.id ?? "";
  const held = !fleet || fleet.pending || fleet.committed;
  const off = locked || held;
  const placing = (kind) => tool === "fleet" && (station || "move") === kind;
  return (
    <div role="dialog" aria-label="Fleets" data-oh-war-room-fleets="" style={besideRailStyle(rail, isMobile)}>
      <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
        <div style={{ ...stencilStyle, flex: 1, fontSize: "0.72rem" }}>Fleets</div>
        <button type="button" onClick={onClose} style={linkStyle}>Close</button>
      </div>
      {fleets.length === 0 && <div style={softText}>You have no fleets.</div>}
      <div role="listbox" aria-label="Your fleets" style={{ display: "flex", flexDirection: "column", gap: "0.2rem", maxHeight: "9rem", overflowY: "auto" }}>
        {fleets.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="option"
            aria-selected={entry.id === picked}
            className="oh-tap"
            data-oh-war-room-fleet-key={entry.id}
            onClick={() => onPick(entry.id)}
            style={{ ...trayStyle(entry.id === picked), alignItems: "baseline", color: BONE, cursor: "pointer", display: "flex", gap: "0.45rem", padding: "0.3rem 0.45rem", textAlign: "left" }}
          >
            <span data-no-translate style={{ flex: 1, fontSize: "0.78rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
            <span style={{ ...softText, flex: "0 0 auto" }}>{entry.strength}% · <PostureWord posture={entry.posture} /></span>
          </button>
        ))}
      </div>
      {fleet && (
        <>
          <div style={softText}><OrderLine fleet={fleet} /></div>
          {fleet.pending && <div style={softText}>It joins your order of battle when time next passes; it takes orders then.</div>}
          {fleet.committed && <div style={softText}>It is fighting on a battlefield, where its orders are the battle's.</div>}
          <Heading>Posture</Heading>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {POSTURE_KEYS.map((posture) => (
              <button
                key={posture}
                type="button"
                className="oh-tap"
                aria-pressed={fleet.posture === posture}
                data-oh-war-room-posture={posture}
                disabled={off}
                onClick={() => onOrder({ op: "posture", unit: fleet.id, posture })}
                style={smallKey(fleet.posture === posture, off)}
              ><PostureKey posture={posture} /></button>
            ))}
          </div>
          <Heading style={{ marginTop: "0.2rem" }}>Orders</Heading>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            <button type="button" className="oh-tap" aria-pressed={placing("move")} disabled={off} onClick={() => onPlace("move")} title="Sail to a place at sea: click it on the map" style={smallKey(placing("move"), off)}>Sail to</button>
            <button type="button" className="oh-tap" aria-pressed={placing("patrol")} disabled={off} onClick={() => onPlace("patrol")} title="Patrol a place at sea: click it on the map" style={smallKey(placing("patrol"), off)}>Patrol at</button>
            <button type="button" className="oh-tap" disabled={off || !fleet.order} onClick={() => onOrder({ op: "stand", unit: fleet.id })} style={smallKey(false, off || !fleet.order)}>Call off</button>
          </div>
          {enemies.length > 0 && (
            <>
              <Heading style={{ marginTop: "0.2rem" }}>Blockade a country</Heading>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <select data-no-translate value={target} disabled={off} onChange={(event) => setEnemy(event.target.value)} aria-label="The country to blockade" style={selectStyle}>
                  {enemies.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <button type="button" className="oh-tap" disabled={off || !target} onClick={() => onOrder({ op: "blockade", unit: fleet.id, country: target })} style={smallKey(false, off || !target)}>Blockade</button>
              </div>
              <div style={softText}>It sails to the water off their coast nearest it, and closes what of their trade comes by sea there.</div>
            </>
          )}
          {convoys.length > 0 && (
            <>
              <Heading style={{ marginTop: "0.2rem" }}>Escort a convoy</Heading>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <select data-no-translate value={covered} disabled={off} onChange={(event) => setConvoy(event.target.value)} aria-label="The convoy to escort" style={selectStyle}>
                  {convoys.map((entry) => <option key={entry.id} value={entry.id}>{[entry.kind, entry.to?.name].filter(Boolean).join(" · ")}</option>)}
                </select>
                <button type="button" className="oh-tap" disabled={off || !covered} onClick={() => onOrder({ op: "escort", unit: fleet.id, transport: covered })} style={smallKey(false, off || !covered)}>Escort</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

// The player's fleets, for the drawer: nothing when there are none.
//   onPick(id)   the fleet is picked out on the plate beside the rail
export const FleetsList = ({ fleets, picked, onPick }) => {
  if (fleets.length === 0) return null;
  return (
    <>
      <Heading style={{ marginTop: "0.8rem" }}>Fleets</Heading>
      <div style={{ ...softText, marginTop: "0.3rem" }}>Pick one to command it from the plate beside the map.</div>
      {fleets.map((fleet) => (
        <div key={fleet.id} data-oh-war-room-fleet={fleet.id} style={{ ...trayStyle(fleet.id === picked), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div data-no-translate style={{ fontSize: "0.8rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fleet.name}</div>
            <div style={softText}>{fleet.strength}% strength · <PostureWord posture={fleet.posture} /></div>
            <div style={softText}><OrderLine fleet={fleet} /></div>
          </div>
          <button type="button" className="oh-tap" onClick={() => onPick(fleet.id)} title="Pick out this fleet" style={{ ...linkStyle, alignSelf: "center", flex: "0 0 auto" }}>Pick</button>
        </div>
      ))}
    </>
  );
};
