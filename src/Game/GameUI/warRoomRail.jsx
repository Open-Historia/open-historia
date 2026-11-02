/*! Open Historia — the war room's tool rail © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The troop tools: a thin plate that comes out of the left edge of the screen
// while the war room is open, with a key a tool. What is done ON the map is
// beside the map, and not in the drawer across the screen from it: the drawer
// keeps what is read (the generals, the plans, the talk). At its foot, two that
// are not for troops: Fortify, a line drawn to be built (warRoomFortify.jsx),
// and Fleets, the plate that commands the player's fleets (warRoomFleets.jsx).
//
// Beside the rail, a small plate says what the tool in hand wants done, how
// many troops are picked out, and why nothing can be ordered when it cannot.
//
// The rail only shows and asks: what a key does is the panel's (warRoom.jsx),
// which sends every change through runtime/warRoomWrites.js.

import React, { useEffect, useRef, useState } from "react";
import { setWarRoom } from "../Map/warRoomStore.js";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_TOP } from "../../runtime/mobileUi.js";
import { REINFORCE_MOST } from "../../runtime/fronts/constants.js";
import { ADVISOR_SLIDE } from "./advisorSlide.js";
import { BONE, BONE_FAINT, BONE_SOFT, BRASS, RED, RED_BRIGHT, STEEL, STENCIL, linkStyle, plateStyle, rivetStyle, stencilStyle } from "./warRoomTheme.js";

// The most formations one dispatch of a transporter carries (runtime/fronts/transports.js TRANSPORT_LOAD_MOST).
const LOAD_MOST = 40;
// The rail is as wide as one key and its lip.
export const RAIL_WIDTH = "3.75rem";
const KEY_SIZE = "3.05rem";

const Icon = ({ children, dashed = false }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? "3.2 3.4" : undefined} aria-hidden="true">{children}</svg>
);
// A box drawn round troops.
const SelectIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="13" height="13" rx="1" strokeDasharray="3 3.2" />
    <path d="M13 13l7.5 3-3.2 1.3L16 20.5z" fill="currentColor" strokeWidth="1.4" />
  </svg>
);
// A way with bends in it.
const RouteIcon = () => <Icon><path d="M4 19c1-6 4-7 7-7s5-2 5-5" /><path d="M12.5 6.5L16 3.5l3.5 3" /><circle cx="4" cy="19" r="1.2" fill="currentColor" /></Icon>;
// Straight out.
const AdvanceIcon = () => <Icon><path d="M5 6l6 6-6 6" /><path d="M12.5 6l6 6-6 6" /></Icon>;
// A trench.
const DigInIcon = () => <Icon><path d="M2.5 9h5l2 7h5l2-7h5" /><path d="M12 3.5v6M9.6 7.4L12 9.8l2.4-2.4" /></Icon>;
// A shield.
const HoldIcon = () => <Icon><path d="M12 3l7 2.6v5.6c0 4.4-2.9 7.6-7 9.3-4.1-1.7-7-4.9-7-9.3V5.6z" /></Icon>;
// Back the way they came.
const FallBackIcon = () => <Icon><path d="M19 7v4a4 4 0 0 1-4 4H5" /><path d="M9.5 10.5L5 15l4.5 4.5" /></Icon>;
// Off the battlefield, for home; and back onto it.
const WithdrawIcon = () => <Icon><path d="M20.5 4.5v15" /><path d="M16 12H4M8.5 7.5L4 12l4.5 4.5" /></Icon>;
const ReturnIcon = () => <Icon><path d="M3.5 4.5v15" /><path d="M8 12h12M15.5 7.5L20 12l-4.5 4.5" /></Icon>;
// Back into the line.
const ReleaseIcon = () => <Icon><path d="M3.5 19.5h17" /><path d="M12 4v10.5M7.8 10.6L12 14.8l4.2-4.2" /></Icon>;
// What carries troops: a hull, two carriages, an aircraft, each seen from above.
const ShipIcon = () => <Icon><path d="M12 2.5l4.5 6v10L14 21.5h-4l-2.5-3v-10z" /><path d="M12 7v10" /></Icon>;
const TrainIcon = () => <Icon><rect x="8" y="2.5" width="8" height="8" rx="1.6" /><rect x="8" y="13" width="8" height="8.5" rx="1" /><path d="M12 10.5V13" /></Icon>;
const PlaneIcon = () => <Icon><path d="M12 2l1.4 7 8.1 5v2l-8.1-2.2-.5 5 2.6 2v1.2L12 21l-3.5 1v-1.2l2.6-2-.5-5L2.5 16v-2l8.1-5z" /></Icon>;
const CARRIER_ICONS = { sea: ShipIcon, land: TrainIcon, air: PlaneIcon };
// How each is asked for.
const CarrierWord = ({ medium }) => {
  if (medium === "sea") return <>By sea</>;
  if (medium === "land") return <>By rail</>;
  return <>By air</>;
};
// A movement that is not meant.
const DiversionIcon = () => <Icon dashed><path d="M4 18c2-7 6-9 14-10" /><path d="M14.5 4.6L18.4 8l-3.2 3.9" strokeDasharray="0" /></Icon>;
// A line with three counters standing on it.
const DeployIcon = () => <Icon><path d="M3 19h18" /><path d="M4.5 11h4v4h-4z" /><path d="M10 11h4v4h-4z" /><path d="M15.5 11h4v4h-4z" /></Icon>;
// A wall and its battlements.
const FortifyIcon = () => <Icon><path d="M3.5 20.5v-11h3v-3h3v3h5v-3h3v3h3v11z" /><path d="M10 20.5v-4.5h4v4.5" /></Icon>;
// A hull and its sail, from the side.
const FleetIcon = () => <Icon><path d="M3 15.5h18l-2.8 4.5H5.8z" /><path d="M12 3.5v12" /><path d="M12 5.5l6.5 8H12" /></Icon>;
// A crate, corded.
const SupplyIcon = () => <Icon><path d="M4 8l8-4.5L20 8v8.5L12 21l-8-4.5z" /><path d="M4 8l8 4.5L20 8M12 12.5V21" /></Icon>;

const keyLook = (on, disabled) => ({
  alignItems: "center",
  background: on ? RED : STEEL.raised,
  borderTop: `1px solid ${on ? RED_BRIGHT : STEEL.raisedTop}`,
  borderLeft: `1px solid ${on ? RED_BRIGHT : STEEL.raisedSide}`,
  borderRight: `1px solid ${STEEL.seam}`,
  borderBottom: `1px solid ${STEEL.seam}`,
  borderRadius: "3px",
  boxShadow: "0 1px 2px rgba(0,0,0,0.5)",
  boxSizing: "border-box",
  color: disabled ? BONE_FAINT : BONE,
  cursor: disabled ? "default" : "pointer",
  display: "flex",
  flex: "0 0 auto",
  flexDirection: "column",
  fontFamily: STENCIL,
  fontSize: "0.56rem",
  fontWeight: 700,
  gap: "0.16rem",
  height: KEY_SIZE,
  justifyContent: "center",
  letterSpacing: "0.05em",
  lineHeight: 1,
  opacity: disabled ? 0.5 : 1,
  padding: "0.2rem 0.05rem",
  textTransform: "uppercase",
  width: KEY_SIZE,
});

// `on` is given for a tool, which is in hand or not; an order is a key that is only pressed.
const RailKey = ({ label, title, on, disabled = false, onClick, children }) => (
  <button type="button" className="oh-tap" aria-pressed={on === undefined ? undefined : on} disabled={disabled} onClick={onClick} title={title} aria-label={title} data-oh-war-room-key="" style={keyLook(on === true, disabled)}>
    {children}
    <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "clip", whiteSpace: "nowrap" }}>{label}</span>
  </button>
);

const Rule = () => <div aria-hidden="true" style={{ background: STEEL.seam, boxShadow: `0 1px 0 ${STEEL.lip}`, flex: "0 0 auto", height: "1px", margin: "0.12rem 0.2rem" }} />;

//   shown        the rail is out: the war room is open and the map is in sight
//   top          where its top is, as a CSS length (under the frame's bar)
//   tool         the tool in hand ("pan" for none)
//   selected     the troops picked out
//   locked       nothing can be ordered now (a turn is running, or a write is on its way)
//   turnRunning  it is a turn that is running
//   notice       what the last order was refused for
//   carriers     what carries troops this year: [{ medium, kind, speed, capacity }]
//   onCarrier    (medium) => the troops picked out are to go by it: the map then asks where
//   own          how many troops the player has on this battlefield
//   away         the player's troops have all withdrawn from it
//   onWithdraw   the troops picked out leave the battlefield (all of the player's, with none picked)
//   onReturn     a side that withdrew is sent back
//   canFortify   fortified lines are part of this scenario's wars, so one may be drawn
//   drafted      a line has been drawn and waits for its level (warRoomFortify.jsx)
//   navies       the scenario's wars have navies (the Wars feature): without them there is no Fleets key
//   fleets       how many fleets the player has; fleetsOut, the fleets' plate is out (warRoomFleets.jsx)
//   onFleets     the fleets' plate is put out, or away
//   station      what a click orders for the fleet picked out, while the fleet tool is in hand
//   deployCount  how many fresh formations it calls up as typed, "" for a usual draft (runtime/fronts/deploy.js);
//                onDeployCount, typed
//   deployForm   what the Deploy tool deploys, "front" or "swarm" (runtime/fronts/swarms.js); onDeployForm, chosen
//   supply       the map shades how well supplied the ground is (Map/warRoomCells.js); onSupply, shown or not;
//                supplyAreas, how much of it is stretched and cut off, in km²
//   foot         how much of the screen's foot the drawer covers, in px (a phone's folded drawer): the rail ends above it
const WarRoomRail = ({ shown, top, isMobile, tool, selected, locked, turnRunning, notice, carriers = [], own = 0, away = false, onTool, onOrder, onRelease, onClear, onCarrier, onWithdraw, onReturn, canFortify = false, drafted = false, navies = true, fleets = 0, fleetsOut = false, onFleets = () => {}, station = "", deployForm = "front", onDeployForm = () => {}, deployCount = "", onDeployCount = () => {}, supply = false, onSupply = () => {}, supplyAreas = null, foot = 0 }) => {
  const none = selected.length === 0;
  const drawing = tool !== "pan";
  // The choice of carrier, open beside the rail.
  const [choosing, setChoosing] = useState(false);
  const choice = choosing && shown && !none && !locked;
  // Tucked away against the edge, should the player want the map under it.
  // It comes out again each time the room is opened.
  const [tucked, setTucked] = useState(false);
  const [wasShown, setWasShown] = useState(shown);
  if (wasShown !== shown) {
    setWasShown(shown);
    if (!shown) setTucked(false);
  }
  const out = shown && !tucked;

  // How far the rail covers the map from the left, so that a battlefield is
  // fitted into what is left of it (Map/WarRoomTools.jsx).
  const railRef = useRef(null);
  useEffect(() => {
    if (!out || !railRef.current) {
      setWarRoom({ rail: 0 });
      return undefined;
    }
    const measure = () => setWarRoom({ rail: Math.round(railRef.current?.getBoundingClientRect().right ?? 0) });
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(railRef.current);
    return () => {
      observer.disconnect();
      setWarRoom({ rail: 0 });
    };
  }, [out]);

  const plate = plateStyle();
  const says = shown && (turnRunning || drawing || !none || Boolean(notice) || supply);
  return (
    <>
      <div
        ref={railRef}
        data-oh-war-room-rail=""
        data-oh-no-motion=""
        role="toolbar"
        aria-label="Troop tools"
        aria-orientation="vertical"
        aria-hidden={!shown}
        style={{
          ...plate,
          position: "fixed",
          left: 0,
          top,
          maxHeight: foot > 0 ? `calc(100vh - ${top} - ${foot}px - 0.5rem)` : `calc(100vh - ${top} - 5.6rem - ${SAFE_BOTTOM})`,
          boxSizing: "border-box",
          paddingLeft: `calc(0.3rem + ${SAFE_LEFT})`,
          paddingRight: "0.3rem",
          paddingTop: "0.5rem",
          paddingBottom: "0.4rem",
          borderTop: `2px solid ${STEEL.seam}`,
          borderRight: `2px solid ${STEEL.seam}`,
          borderBottom: `2px solid ${STEEL.seam}`,
          borderRadius: "0 5px 5px 0",
          boxShadow: out ? `inset -1px 0 0 ${STEEL.lip}, 5px 0 18px rgba(0,0,0,0.5)` : "none",
          color: BONE,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.28rem",
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarWidth: "none",
          transform: out ? "translateX(0)" : "translateX(-100%)",
          transition: `transform ${ADVISOR_SLIDE}, box-shadow ${ADVISOR_SLIDE}`,
          visibility: shown ? "visible" : "hidden",
          zIndex: isMobile ? 10030 : 9997,
        }}
      >
        <div style={{ ...stencilStyle, flex: "0 0 auto", fontSize: "0.58rem", letterSpacing: "0.14em" }}>Troops</div>
        {/* How many are picked out: the number the keys below would order. */}
        <div
          role="status"
          title="Troops picked out"
          style={{
            alignItems: "center", background: none ? "rgba(0,0,0,0.45)" : BRASS, border: `1px solid ${BRASS}`, borderRadius: "2px", boxSizing: "border-box", color: none ? BRASS : "#1c1608",
            display: "flex", flex: "0 0 auto", fontFamily: STENCIL, fontSize: "0.86rem", fontWeight: 700, height: "1.45rem", justifyContent: "center", width: KEY_SIZE,
          }}
        >{selected.length}</div>
        <RailKey label="Select" title="Select troops: drag a box round them on the map" on={tool === "select"} disabled={locked} onClick={() => onTool("select")}><SelectIcon /></RailKey>
        <RailKey label="Route" title="Draw route: draw the way the troops picked out are to go" on={tool === "route"} disabled={locked || none} onClick={() => onTool("route")}><RouteIcon /></RailKey>
        <Rule />
        {/* An advance with no route: each goes straight out from where it stands, as a line told to advance does. */}
        <RailKey label="Advance" title="Send these troops forward from where they stand, with no route drawn for them" disabled={locked || none} onClick={() => onOrder("advance")}><AdvanceIcon /></RailKey>
        <RailKey label="Dig in" title="Dig in: these troops entrench where they stand" disabled={locked || none} onClick={() => onOrder("dig in")}><DigInIcon /></RailKey>
        <RailKey label="Hold" title="Hold: these troops keep their ground and attack nothing" disabled={locked || none} onClick={() => onOrder("hold")}><HoldIcon /></RailKey>
        <RailKey label="Fall back" title="Fall back: these troops give ground toward their own rear" disabled={locked || none} onClick={() => onOrder("fall back")}><FallBackIcon /></RailKey>
        <RailKey label="Release" title="Give these troops back to their stretch of the line" disabled={locked || none} onClick={onRelease}><ReleaseIcon /></RailKey>
        {/* Off the battlefield altogether: the ground stays as it is. With none picked out, every troop of the player's goes. */}
        {away
          ? <RailKey label="Send back" title="Send your troops back onto this battlefield" disabled={locked} onClick={onReturn}><ReturnIcon /></RailKey>
          : <RailKey label="Withdraw" title="Withdraw: these troops leave the battlefield and go home. With none picked out, all of yours do" disabled={locked || (none && own === 0)} onClick={onWithdraw}><WithdrawIcon /></RailKey>}
        <Rule />
        {/* Carried to where their side holds no land: by ship, rail or air, then a click on the map for where. */}
        <RailKey label="Transport" title="Transport: carry these troops by ship, rail or air to a place your side has no border with" on={tool === "transport" || choice} disabled={locked || none} onClick={() => (tool === "transport" ? onTool("pan") : setChoosing((value) => !value))}><ShipIcon /></RailKey>
        <RailKey label="Diversion" title="Draw a diversion: a movement you want the other side to believe" on={tool === "diversion"} disabled={locked} onClick={() => onTool("diversion")}><DiversionIcon /></RailKey>
        <RailKey label="Deploy" title="Deploy: choose where your new troops on this battlefield come in, along a front or as a swarm" on={tool === "deploy"} disabled={locked} onClick={() => onTool("deploy")}><DeployIcon /></RailKey>
        <Rule />
        {/* What is built and what sails: a fortified line drawn on the map (its level is chosen once it is drawn), and the fleets. */}
        <RailKey label="Fortify" title="Fortify: draw a line to be built, then choose how strong it is to be" on={tool === "fortify" || drafted} disabled={locked || !canFortify} onClick={() => onTool("fortify")}><FortifyIcon /></RailKey>
        {navies && <RailKey label="Fleets" title="Fleets: command your fleets at sea" on={fleetsOut || tool === "fleet"} disabled={fleets === 0} onClick={onFleets}><FleetIcon /></RailKey>}
        {/* How well supplied the ground is, shaded on the map. */}
        <RailKey label="Supply" title="Supply: shade how well supplied the ground is" on={supply} onClick={onSupply}><SupplyIcon /></RailKey>
        <span aria-hidden="true" style={rivetStyle({ left: `calc(0.16rem + ${SAFE_LEFT})`, top: "0.16rem" }, "0.34rem")} />
        <span aria-hidden="true" style={rivetStyle({ right: "0.16rem", top: "0.16rem" }, "0.34rem")} />
      </div>

      {/* The tab that tucks the rail against the edge and brings it out again. */}
      <button
        type="button"
        className="oh-tap"
        onClick={() => setTucked((value) => !value)}
        title={tucked ? "Show the troop tools" : "Hide the troop tools"}
        aria-label={tucked ? "Show the troop tools" : "Hide the troop tools"}
        aria-expanded={!tucked}
        data-oh-war-room-rail-tab=""
        style={{
          ...plate,
          alignItems: "center",
          borderTop: `2px solid ${STEEL.seam}`,
          borderRight: `2px solid ${STEEL.seam}`,
          borderBottom: `2px solid ${STEEL.seam}`,
          borderLeft: "none",
          borderRadius: "0 4px 4px 0",
          color: BRASS,
          cursor: "pointer",
          display: shown ? "flex" : "none",
          height: "2.5rem",
          justifyContent: "center",
          left: out ? `calc(${RAIL_WIDTH} + ${SAFE_LEFT})` : 0,
          padding: 0,
          position: "fixed",
          top: `calc(${top} + 0.5rem)`,
          transition: `left ${ADVISOR_SLIDE}`,
          width: "1rem",
          zIndex: isMobile ? 10030 : 9997,
        }}
      >
        <svg width="9" height="13" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {tucked ? <path d="M2.5 2l5 5-5 5" /> : <path d="M7.5 2l-5 5 5 5" />}
        </svg>
      </button>

      {/* What is to carry them: a key a carrier there is this year. */}
      {choice && (
        <div
          role="menu"
          aria-label="Carry them"
          data-oh-war-room-carriers=""
          style={{
            ...plate,
            border: `2px solid ${STEEL.seam}`,
            borderRadius: "4px",
            boxShadow: `inset 0 1px 0 ${STEEL.lip}, 0 3px 12px rgba(0,0,0,0.5)`,
            boxSizing: "border-box",
            color: BONE,
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",
            left: `calc(${RAIL_WIDTH} + ${SAFE_LEFT} + 1.5rem)`,
            maxWidth: "min(19rem, calc(100vw - 7.5rem))",
            padding: "0.5rem 0.55rem",
            position: "fixed",
            top: `calc(${top} + 9rem)`,
            zIndex: isMobile ? 10031 : 9998,
          }}
        >
          <div style={{ ...stencilStyle, fontSize: "0.66rem" }}>Carry the {selected.length} picked out</div>
          {carriers.length === 0 && <div style={{ color: BONE_SOFT, fontSize: "0.74rem" }}>Nothing carries troops yet.</div>}
          {selected.length > LOAD_MOST && <div style={{ color: BONE_SOFT, fontSize: "0.7rem", lineHeight: 1.35 }}>One dispatch carries {LOAD_MOST} formations at most: the rest stay where they are.</div>}
          {carriers.map((carrier) => {
            const Picture = CARRIER_ICONS[carrier.medium] ?? ShipIcon;
            return (
              <button
                key={carrier.medium}
                type="button"
                role="menuitem"
                className="oh-tap"
                data-oh-war-room-carrier={carrier.medium}
                onClick={() => {
                  setChoosing(false);
                  onCarrier(carrier.medium);
                }}
                style={{ ...keyLook(false, false), alignItems: "center", flexDirection: "row", fontSize: "0.76rem", gap: "0.55rem", height: "auto", justifyContent: "flex-start", padding: "0.4rem 0.55rem", textAlign: "left", width: "100%" }}
              >
                <Picture />
                <span style={{ display: "flex", flexDirection: "column", gap: "0.14rem", minWidth: 0 }}>
                  <span><CarrierWord medium={carrier.medium} /></span>
                  <span style={{ color: BONE_SOFT, fontFamily: "sans-serif", fontSize: "0.68rem", fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>
                    <span data-no-translate>{carrier.kind}</span> · {carrier.capacity} formations each · {carrier.speed} km a day
                  </span>
                </span>
              </button>
            );
          })}
          <button type="button" onClick={() => setChoosing(false)} style={{ ...linkStyle, alignSelf: "flex-start" }}>Cancel</button>
        </div>
      )}

      {/* What the tool in hand wants done, beside the rail. */}
      {says && (
        <div
          role="status"
          data-oh-war-room-hint=""
          style={{
            ...plate,
            border: `2px solid ${STEEL.seam}`,
            borderRadius: "4px",
            boxShadow: `inset 0 1px 0 ${STEEL.lip}, 0 3px 12px rgba(0,0,0,0.5)`,
            boxSizing: "border-box",
            color: BONE_SOFT,
            fontFamily: "sans-serif",
            fontSize: "0.74rem",
            left: out ? `calc(${RAIL_WIDTH} + ${SAFE_LEFT} + 1.5rem)` : `calc(${SAFE_LEFT} + 1.5rem)`,
            lineHeight: 1.4,
            maxWidth: "min(21rem, calc(100vw - 7.5rem))",
            padding: "0.4rem 0.6rem",
            position: "fixed",
            top: isMobile ? `calc(${top} + 3.4rem)` : top,
            transition: `left ${ADVISOR_SLIDE}`,
            zIndex: isMobile ? 10030 : 9997,
          }}
        >
          {turnRunning && <>A turn is being resolved. Orders are taken once it has landed.</>}
          {!turnRunning && tool === "select" && <>Drag a box round your troops on the map. Hold Shift to add to those picked.{selected.length > 0 && <> {selected.length} picked out.</>}</>}
          {!turnRunning && tool === "route" && <>Draw the way for the {selected.length} picked out. They follow it as the ground and the enemy allow.</>}
          {!turnRunning && tool === "diversion" && <>Draw the movement you want the other side to believe.</>}
          {!turnRunning && tool === "deploy" && (
            <>
              {/* Deployed along a front, or as a swarm: a group under a general of its own (runtime/fronts/swarms.js). */}
              <div role="radiogroup" aria-label="Deploy as" style={{ display: "flex", gap: "0.3rem", marginBottom: "0.35rem" }}>
                {[["front", "Front"], ["swarm", "Swarm"]].map(([form, word]) => (
                  <button
                    key={form}
                    type="button"
                    role="radio"
                    className="oh-tap"
                    aria-checked={(deployForm === "swarm") === (form === "swarm")}
                    data-oh-war-room-deploy-form={form}
                    onClick={() => onDeployForm(form)}
                    style={{ ...keyLook((deployForm === "swarm") === (form === "swarm"), false), flexDirection: "row", fontSize: "0.72rem", height: "auto", padding: "0.28rem 0.7rem", width: "auto" }}
                  >{form === "swarm" ? <>Swarm</> : <>Front</>}</button>
                ))}
              </div>
              {/* The fresh formations it calls up when time next passes (runtime/fronts/deploy.js): "it does draw the
                  line, but the troops are never actually deployed" (the owner, 2026-10-24). */}
              <label style={{ alignItems: "center", display: "flex", gap: "0.45rem", marginBottom: "0.2rem" }}>
                <span>Formations to call up</span>
                <input
                  type="number"
                  min={0}
                  max={REINFORCE_MOST}
                  step={1}
                  inputMode="numeric"
                  value={deployCount}
                  placeholder="Usual"
                  data-oh-war-room-deploy-count=""
                  onChange={(event) => onDeployCount(event.target.value)}
                  style={{ backgroundColor: "rgba(0,0,0,0.5)", border: `1px solid ${STEEL.sunkLine}`, borderRadius: "3px", boxSizing: "border-box", color: BONE, fontFamily: "inherit", fontSize: "0.78rem", outline: "none", padding: "0.2rem 0.4rem", width: "4.5rem" }}
                />
              </label>
              <div style={{ color: BONE_FAINT, marginBottom: "0.35rem" }}>Empty calls up as many as a usual draft; 0 calls up none.</div>
              {deployForm === "swarm"
                ? <>Click the place your new troops here are to gather at. Those called up come in there as a swarm when time next passes, under one general of their own, and so do later levies, drafts and reinforcements. Each moves and fights as troops on a front do. Drag to move the map.</>
                : <>Draw the line your new troops here are to come in on. Those called up come in on it when time next passes, and so do later levies, drafts and reinforcements. They stand on ground your side holds along it.</>}
            </>
          )}
          {!turnRunning && tool === "replan" && <>Draw the operation’s way anew.</>}
          {!turnRunning && tool === "transport" && <>Click the place the {selected.length} picked out are to be carried to. Drag to move the map. They board when time next passes.</>}
          {!turnRunning && tool === "fortify" && <>Draw the fortified line on the map. You choose how strong it is to be once it is drawn.</>}
          {!turnRunning && tool === "fleet" && station === "patrol" && <>Click the place at sea the fleet is to patrol. Drag to move the map.</>}
          {!turnRunning && tool === "fleet" && station !== "patrol" && <>Click the place at sea the fleet is to sail to. Drag to move the map.</>}
          {!turnRunning && !drawing && supply && (
            <div data-oh-war-room-supply="">
              Supply: your ground in amber is stretched past where supplies come in full, in red it is cut off; pale ground is theirs, cut off.
              {!supplyAreas
                ? <> How well supplied it is shows once time next passes here.</>
                : supplyAreas.stretched > 0 || supplyAreas.cut > 0 || supplyAreas.theirsCut > 0
                  ? <> Stretched {supplyAreas.stretched.toLocaleString()} km², cut off {supplyAreas.cut.toLocaleString()} km²; theirs cut off {supplyAreas.theirsCut.toLocaleString()} km².</>
                  : <> All your ground here is well supplied.</>}
              {" "}<button type="button" onClick={onSupply} style={linkStyle}>Hide</button>
            </div>
          )}
          {!turnRunning && !drawing && selected.length > 0 && (
            <>{selected.length} picked out. <button type="button" onClick={onClear} style={linkStyle}>Clear</button></>
          )}
          {drawing && !turnRunning && <> <button type="button" onClick={() => onTool("pan")} style={linkStyle}>Cancel</button></>}
          {notice && <div role="alert" data-no-translate style={{ color: "#ffb4a8", marginTop: turnRunning || drawing || !none ? "0.25rem" : 0 }}>{notice}</div>}
        </div>
      )}
    </>
  );
};

export { WarRoomRail };
