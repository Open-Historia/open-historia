/*! Open Historia — Shared Worlds: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The shared games rebuilt (notes.js "2026-11-shared-game-replies"): one world,
// every player in it. The game's own greys, and the players round one table,
// each in their own colour, the same on every page (sharedWorldsChrome.js); the
// accent is the world they share. Five pages, told apart by the banner's
// `scene`:
//   table     a table seen from above, the world's map lying on it. The seats
//             light in turn round it, each player's line drawing out to their
//             own country; one player is away and the AI keeps their seat, its
//             ring turning; one seat is free, and answers a touch (Join): you
//             sit down in the accent and a free country is yours.
//   ledger    four devices on a desk, each with its key that never leaves it.
//             The round's token is passed from one to the next, and the device
//             holding it lights and sends the round up to the world. Beside
//             them the ledger of who paid, and the Game Master's changes told
//             to every player.
//   secrets   a map under fog. Your own land is clear, and the fog lifts only
//             over what stands on the map, one place after another; what the
//             others have only ordered stays under it, sealed. Your own letter
//             answers a touch (Open): its flap lifts and the letter rises.
//   envoys    two envoys walk up to a treaty whose lines write themselves; one
//             has signed, and the other signs at a touch (Sign), the seal of
//             both colours stamped. Ballots drop into a box, and an
//             institution's members vote in turn.
//   fronts    one front two players share, its teeth in both colours; each
//             side's aircraft cross to strike it, and every strike stands. The
//             scales under it sway and come back level. Strike sends one more
//             from each side.
// The sides of each picture (a lobby, a ledger, a stack of orders, a ballot
// box, the rankings) are left out on a phone, which shows the middle. With
// Reduce motion nothing moves: each page is drawn as it stands.
//
// Flat shapes only: nothing is a gradient, nothing purple.

import React, { useState } from "react";

import { soundEffectsEnabled } from "../../../../runtime/vaultSounds.js";
import { ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import {
  WORLDS_ACCENT as ACCENT,
  WORLDS_FACE as FACE,
  WORLDS_FAINT as FAINT,
  WORLDS_GROUND as GROUND,
  WORLDS_INK as INK,
  WORLDS_LINE as LINE,
  WORLDS_PLAYERS,
  WORLDS_RAISED as RAISED,
  WORLDS_SOFT as SOFT,
  WORLDS_STAGE as STAGE,
  worldsSeat,
} from "./sharedWorldsChrome.js";

const { amber: AMBER, coral: CORAL, green: GREEN, ivory: IVORY } = WORLDS_PLAYERS;
// The players in the order of their seats.
const ROUND = [AMBER, CORAL, GREEN, IVORY];

const TABLE = "#26272b";
const SEA = "#1d2125";
const LAND = "#32343a";
const CHAIR = "#2e2f34";
const FRAME = "#2b2c31";
const SCREEN = "#0f1012";
const FOG = "#393b41";
const FOG_NEAR = "#3e4046";
const LAND_CLEAR = "#44464c";
const PAPER = "#dcd8cc";
const PAPER_BACK = "#bdb8ab";
const PAPER_INK = "#2a2b30";
const GRASS = "#25272b";

// The picture is 800 by 220; a phone's banner shows its middle.
const H = 220;
const WIDE = { x: 0, w: 800 };
const NARROW = { x: 170, w: 460 };

// The theme's own motions, beside the kit's: the token passed from device to
// device, a device lit while it holds it, the fog's holes opening and the fog
// drifting, the letter's flap lifting and the letter rising, and a sortie
// crossing to its strike.
const STYLE_ID = "oh-update-shared-worlds-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  @keyframes ohWorldsRelay {
    0%, 19% { transform: translate(0px, 0px); }
    22.5% { transform: translate(56px, -16px); }
    25%, 44% { transform: translate(112px, 0px); }
    47.5% { transform: translate(168px, -16px); }
    50%, 69% { transform: translate(224px, 0px); }
    72.5% { transform: translate(280px, -16px); }
    75%, 94% { transform: translate(336px, 0px); }
    97% { transform: translate(168px, -36px); }
    100% { transform: translate(0px, 0px); }
  }
  @keyframes ohWorldsTurn { 0%, 21% { opacity: 1; } 25%, 96% { opacity: 0; } 100% { opacity: 1; } }
  @keyframes ohWorldsOpen { from { transform: scale(0); } to { transform: scale(1); } }
  @keyframes ohWorldsDrift { 0%, 100% { transform: translateX(0px); } 50% { transform: translateX(var(--oh-worlds-drift, 16px)); } }
  @keyframes ohWorldsFlip { from { transform: scaleY(-1); } to { transform: none; } }
  @keyframes ohWorldsSlide { from { transform: translateY(var(--oh-worlds-slide, 30px)); } to { transform: none; } }
  @keyframes ohWorldsSortie { 0% { opacity: 0; transform: translateX(0px); } 10% { opacity: 1; } 74% { opacity: 1; } 84%, 100% { opacity: 0; transform: translateX(var(--oh-worlds-run, 240px)); } }
  @keyframes ohWorldsHit { 0%, 76% { opacity: 0; transform: scale(0.3); } 79% { opacity: 1; transform: scale(0.5); } 97%, 100% { opacity: 0; transform: scale(2.2); } }
  `;
  document.head.appendChild(style);
}

// A line drawn along itself (`length` at least as long as the line), or drawn whole when still.
const drawn = (still, length, duration, delay) => (still
  ? {}
  : { strokeDasharray: length, "--oh-upd-length": length, ...motion(still, "ohUpdDraw", duration, delay, "cubic-bezier(0.45, 0, 0.2, 1)") });
// Something carried across from `from` to `to` (in px), once.
const carried = (still, from, to, duration, delay) => (still
  ? {}
  : { "--oh-upd-from": `${from}px`, "--oh-upd-to": `${to}px`, ...motion(still, "ohUpdDrift", duration, delay, "cubic-bezier(0.25, 0.6, 0.3, 1)") });

// A short chime when something is touched, with Sound effects on (Settings).
let audio = null;
const TONES = { join: [659.25, 987.77], leave: [987.77, 659.25], open: [587.33, 880], sign: [523.25, 783.99, 1046.5], strike: [146.83, 110] };
const chime = (tones) => {
  if (!soundEffectsEnabled()) return;
  try {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    audio = audio ?? new Context();
    if (audio.state === "suspended") audio.resume?.();
    tones.forEach((frequency, at) => {
      const start = audio.currentTime + at * 0.09;
      const level = audio.createGain();
      level.gain.setValueAtTime(0.0001, start);
      level.gain.linearRampToValueAtTime(0.12, start + 0.01);
      level.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
      level.connect(audio.destination);
      const tone = audio.createOscillator();
      tone.type = frequency < 200 ? "triangle" : "sine";
      tone.frequency.value = frequency;
      tone.connect(level);
      tone.start(start);
      tone.stop(start + 0.75);
    });
  } catch {
    // No sound to be had: the picture still answers.
  }
};

// The picture, its height kept to its width: all of it on a wide screen, its
// middle on a phone's. What answers a touch is laid over it where it is drawn.
const Stage = ({ narrow, over = null, children }) => {
  const view = narrow ? NARROW : WIDE;
  return (
    <div style={{ paddingTop: `${(H / view.w) * 100}%`, position: "relative", width: "100%" }}>
      <svg aria-hidden="true" className="oh-upd-svg" style={{ display: "block", height: "100%", left: 0, position: "absolute", top: 0, width: "100%" }} viewBox={`${view.x} 0 ${view.w} ${H}`}>
        <rect fill={STAGE} height={H} width="800" />
        {children}
      </svg>
      {over?.(view)}
    </div>
  );
};

// A round key laid over the picture at (x, y), in its colour: dashed until it is
// pressed (a key that is not pressed or unpressed, `pressed` left out, is whole);
// `clear` when what it stands on shows through it.
const Touch = ({ view, x, y, label, pressed, colour, onTouch, clear = false, children }) => (
  <button
    aria-label={label}
    aria-pressed={pressed}
    className="oh-tap"
    onClick={onTouch}
    style={{
      alignItems: "center",
      background: clear ? "transparent" : "rgba(20,20,22,0.78)",
      border: `1.5px ${pressed === false ? "dashed" : "solid"} ${colour}`,
      borderRadius: "999px",
      boxSizing: "border-box",
      color: colour,
      cursor: "pointer",
      display: "flex",
      height: "2.1rem",
      justifyContent: "center",
      left: `${((x - view.x) / view.w) * 100}%`,
      padding: 0,
      position: "absolute",
      top: `${(y / H) * 100}%`,
      touchAction: "manipulation",
      transform: "translate(-50%, -50%)",
      width: "2.1rem",
    }}
    type="button"
  >
    {children}
  </button>
);

// A side card of the picture, shown on a wide screen only.
const Card = ({ x, still, delay = 500, children }) => (
  <g style={motion(still, "ohUpdFade", 700, delay)}>
    <rect fill={RAISED} height="150" rx="8" stroke={LINE} width="140" x={x} y="35" />
    {children}
  </g>
);

const ticked = "M-4 0 L-1 3 L5 -4";

// ---------------------------------------------------------------------------
// table: the players round one world.

const LANDS = {
  a: "299,83 319,78 343,76 348,105 291,110 286,97",
  b: "343,76 369,71 396,80 393,112 348,105",
  c: "396,80 422,73 446,75 453,107 393,112",
  d: "446,75 475,76 503,85 516,98 512,112 453,107",
  e: "291,110 348,105 345,144 325,147 304,140 295,125",
  f: "348,105 393,112 400,139 372,145 345,144",
  g: "393,112 453,107 448,145 424,149 400,139",
  h: "453,107 512,112 509,127 498,137 474,144 448,145",
};
const CAPITALS = { a: [316, 93], c: [423, 92], d: [482, 94], e: [318, 127], h: [482, 127] };
const SEATS = [
  { x: 300, y: 26, colour: AMBER, land: "a" },
  { x: 400, y: 26, colour: CORAL, land: "c" },
  { x: 500, y: 26, colour: GREEN, land: "d" },
  { x: 340, y: 194, colour: IVORY, land: "e", away: true },
];
const FREE_SEAT = { x: 460, y: 194, land: "h" };

// A player seen from above at the table: their chair behind them, their shoulders and head.
const Player = ({ colour, up = false }) => (
  <>
    <rect fill={CHAIR} height="10" rx="4" stroke={LINE} width="40" x="-20" y={up ? 9 : -19} />
    <ellipse cx="0" cy="0" fill={colour} opacity="0.75" rx="15" ry="8" />
    <circle cx="0" cy={up ? -1 : 1} fill={colour} r="6.5" stroke={STAGE} strokeWidth="2" />
  </>
);

// From a seat to its country's capital, drawn out; the country takes the seat's colour.
const Claim = ({ seat, colour, still, delay }) => {
  const [cx, cy] = CAPITALS[seat.land];
  const up = seat.y > 110;
  return (
    <>
      <polygon fill={colour} opacity={seat.away ? 0.55 : 0.85} points={LANDS[seat.land]} stroke={SEA} strokeWidth="1.5" style={motion(still, "ohUpdFade", 600, delay + 400)} />
      <line stroke={colour} strokeLinecap="round" strokeOpacity={seat.away ? 0.45 : 0.8} strokeWidth="1.5" style={drawn(still, 90, 700, delay)} x1={seat.x} x2={cx} y1={seat.y + (up ? -12 : 12)} y2={cy} />
      <g transform={`translate(${cx} ${cy})`}>
        <circle fill={colour} r="2.8" stroke={SEA} strokeWidth="1" style={motion(still, "ohUpdFade", 400, delay + 600)} />
      </g>
    </>
  );
};

const TableScene = ({ narrow, still }) => {
  const [joined, setJoined] = useState(false);
  const join = () => {
    chime(joined ? TONES.leave : TONES.join);
    setJoined((now) => !now);
  };
  return (
    <Stage
      narrow={narrow}
      over={(view) => (
        <Touch colour={joined ? ACCENT : INK} clear={joined} label="Join" onTouch={join} pressed={joined} view={view} x={FREE_SEAT.x} y={FREE_SEAT.y}>
          {!joined && <svg aria-hidden="true" height="14" viewBox="0 0 14 14" width="14"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>}
        </Touch>
      )}
    >
      <defs>
        <pattern height="20" id="oh-worlds-dots-table" patternUnits="userSpaceOnUse" width="20">
          <circle cx="10" cy="10" fill="rgba(231,231,234,0.07)" r="0.9" />
        </pattern>
      </defs>
      <rect fill="url(#oh-worlds-dots-table)" height={H} width="800" />
      {/* The table, and the world's map lying on it. */}
      <rect fill={TABLE} height="132" rx="66" stroke="rgba(231,231,234,0.16)" strokeWidth="1.5" width="428" x="186" y="44" />
      <rect fill="none" height="118" rx="59" stroke="rgba(0,0,0,0.35)" strokeWidth="2" width="414" x="193" y="51" />
      <g style={motion(still, "ohUpdFade", 700, 200)}>
        <rect fill={SEA} height="96" rx="3" stroke={ACCENT} strokeOpacity="0.5" strokeWidth="1.2" width="276" x="262" y="62" />
        {[308, 354, 400, 446, 492].map((x) => <line key={`m${x}`} stroke="rgba(43,193,243,0.1)" x1={x} x2={x} y1="62" y2="158" />)}
        {[86, 110, 134].map((y) => <line key={`p${y}`} stroke="rgba(43,193,243,0.1)" x1="262" x2="538" y1={y} y2={y} />)}
        {Object.entries(LANDS).map(([id, points]) => <polygon fill={LAND} key={id} points={points} stroke={SEA} strokeLinejoin="round" strokeWidth="1.5" />)}
      </g>
      {/* Each player's claim, one after another round the table. */}
      {SEATS.map((seat, at) => <Claim colour={seat.colour} delay={700 + at * 280} key={seat.land} seat={seat} still={still} />)}
      {joined && <Claim colour={ACCENT} delay={0} seat={FREE_SEAT} still={still} />}
      {/* The seats: those present light in turn, the away player's held by the AI's turning ring. */}
      {SEATS.map((seat, at) => (
        <g key={`s${seat.land}`} transform={`translate(${seat.x} ${seat.y})`}>
          <g style={motion(still, "ohUpdFade", 500, 400 + at * 280)}>
            <g opacity={seat.away ? 0.45 : 1}><Player colour={seat.colour} up={seat.y > 110} /></g>
            {seat.away
              ? <circle fill="none" r="19" stroke={FAINT} strokeDasharray="3 5" strokeWidth="1.5" style={forever(still, "ohUpdSpin", 9000, 0)} />
              : <circle fill="none" opacity="0.45" r="13" stroke={seat.colour} strokeWidth="1.6" style={forever(still, "ohUpdRing", 3000, 1800 + at * 1000, "cubic-bezier(0.2, 0.7, 0.2, 1)")} />}
          </g>
        </g>
      ))}
      {/* The free seat: empty until you sit down in it. */}
      <g transform={`translate(${FREE_SEAT.x} ${FREE_SEAT.y})`}>
        {joined
          ? <g style={motion(still, "ohUpdFade", 400, 0)}><Player colour={ACCENT} up /></g>
          : (
            <g style={forever(still, "ohUpdPulse", 2200, 0, "cubic-bezier(0.4, 0, 0.6, 1)")}>
              <rect fill={CHAIR} height="10" rx="4" stroke={LINE} width="40" x="-20" y="9" />
              <ellipse cx="0" cy="0" fill="none" rx="15" ry="8" stroke={FAINT} strokeDasharray="3 3" strokeWidth="1.3" />
            </g>
          )}
      </g>
      {!narrow && (
        <>
          {/* The lobby: who sits where, who is away and for how long, a seat free. */}
          <Card still={still} x={22}>
            <rect fill={INK} height="5" opacity="0.7" rx="2.5" width="54" x="36" y="50" />
            <rect fill={FAINT} height="4" rx="2" width="30" x="118" y="50.5" />
            <line stroke={LINE} x1="22" x2="162" y1="64" y2="64" />
            {[AMBER, CORAL, GREEN, IVORY, null].map((colour, at) => {
              const y = 82 + at * 20;
              return (
                <g key={`l${at}`}>
                  <circle cx="40" cy={y} fill={colour ?? "none"} opacity={at === 3 ? 0.5 : 1} r="5" stroke={colour ? "none" : FAINT} strokeDasharray="2 2" />
                  {colour && <rect fill="rgba(231,231,234,0.3)" height="5" rx="2.5" width={[62, 48, 56, 52][at]} x="54" y={y - 2.5} />}
                  <g transform={`translate(146 ${y})`}>
                    {at === 3 && (
                      <>
                        <circle fill="none" r="5" stroke={FAINT} strokeWidth="1.2" />
                        <g style={forever(still, "ohUpdSpin", 4000, 0)}>
                          <circle fill="none" r="5" />
                          <line stroke={INK} strokeLinecap="round" strokeWidth="1.3" x1="0" x2="0" y1="0" y2="-3.4" />
                        </g>
                      </>
                    )}
                    {at < 3 && <circle fill={INK} opacity="0.5" r="2.4" />}
                    {at === 4 && <path d="M-3.5 0h7M0 -3.5v7" stroke={FAINT} strokeLinecap="round" strokeWidth="1.3" />}
                  </g>
                </g>
              );
            })}
          </Card>
          {/* The round: today's date, the day it lands, and its events one at a time. */}
          <Card still={still} x={638}>
            {[652, 726].map((x, at) => (
              <g key={`d${x}`}>
                <rect fill={STAGE} height="34" rx="3" stroke={LINE} width="40" x={x} y="50" />
                <rect fill={at ? INK : FAINT} height="8" opacity={at ? 0.7 : 1} rx="2" width="40" x={x} y="50" />
                <rect fill={INK} height="10" opacity="0.65" rx="2" width="7" x={x + 12} y="64" />
                <rect fill={INK} height="10" opacity="0.65" rx="2" width="7" x={x + 21} y="64" />
              </g>
            ))}
            <path d="M698 67 H718 M713 62 L719 67 L713 72" fill="none" stroke={FAINT} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
            <rect fill={LINE} height="6" rx="3" width="114" x="652" y="98" />
            <rect fill={INK} height="6" opacity="0.75" rx="3" style={{ transformOrigin: "left center", ...forever(still, "ohUpdGrow", 6000, 900, "linear") }} width="114" x="652" y="98" />
            {[122, 141, 160].map((y, at) => (
              <g key={`e${y}`} style={forever(still, "ohUpdTwinkle", 3600, at * 1200, "cubic-bezier(0.4, 0, 0.6, 1)")}>
                <path d={`M658 ${y - 4} l4 4 -4 4 -4 -4z`} fill={ROUND[at]} />
                <rect fill="rgba(231,231,234,0.32)" height="4" rx="2" width={88 - at * 14} x="670" y={y - 2} />
              </g>
            ))}
          </Card>
        </>
      )}
    </Stage>
  );
};

// ---------------------------------------------------------------------------
// ledger: who pays, in turn, and no key leaving its device.

const RELAY_MS = 8000;
const DEVICES = [
  { x: 232, colour: AMBER, kind: "monitor", frame: [-36, 120, 72, 50, 4], screen: [-32, 124, 64, 40, 2] },
  { x: 344, colour: CORAL, kind: "laptop", frame: [-32, 132, 64, 46, 4], screen: [-28, 136, 56, 38, 2] },
  { x: 456, colour: GREEN, kind: "tablet", frame: [-26, 122, 52, 68, 7], screen: [-22, 128, 44, 56, 3] },
  { x: 568, colour: IVORY, kind: "phone", frame: [-16, 132, 32, 58, 6], screen: [-13, 138, 26, 44, 3] },
];

// The key a device keeps, and under it its letters hidden.
const Key = ({ colour }) => (
  <>
    <circle cx="-5" cy="0" fill="none" r="4" stroke={colour} strokeWidth="2" />
    <path d="M-1 0 H9 M5 0 V3.5 M8 0 V3" fill="none" stroke={colour} strokeLinecap="round" strokeWidth="2" />
    {[-6, -2, 2, 6].map((x) => <circle cx={x} cy="10" fill={FAINT} key={x} r="1.3" />)}
  </>
);

const Device = ({ device, at, still }) => {
  const { x, colour, kind, frame, screen } = device;
  const [sx, sy, sw, sh, sr] = screen;
  // Lit while it holds the token: the turn begins a quarter of the relay later for each device.
  const lit = still ? { opacity: at === 0 ? 1 : 0 } : forever(still, "ohWorldsTurn", RELAY_MS, at === 0 ? 0 : at * (RELAY_MS / 4) - RELAY_MS);
  return (
    <g transform={`translate(${x} 0)`}>
      <path d={`M0 ${frame[1] - 4} Q0 60 ${400 - x} 53`} fill="none" stroke={LINE} strokeDasharray="3 4" strokeWidth="1.3" />
      <path d={`M0 ${frame[1] - 4} Q0 60 ${400 - x} 53`} fill="none" stroke={colour} strokeWidth="2" style={lit} />
      {kind === "monitor" && (
        <>
          <rect fill={FRAME} height="13" width="8" x="-4" y="170" />
          <rect fill={FRAME} height="6" rx="2" stroke={LINE} width="36" x="-18" y="183" />
        </>
      )}
      {kind === "laptop" && <path d="M-42 178 H42 L36 189 H-36 Z" fill={FRAME} stroke={colour} strokeLinejoin="round" strokeOpacity="0.6" strokeWidth="1.2" />}
      <rect fill={FRAME} height={frame[3]} rx={frame[4]} stroke={colour} strokeWidth="1.6" width={frame[2]} x={frame[0]} y={frame[1]} />
      <rect fill={SCREEN} height={sh} rx={sr} width={sw} x={sx} y={sy} />
      <g opacity="0.28"><rect fill={colour} height={sh} rx={sr} style={lit} width={sw} x={sx} y={sy} /></g>
      <g transform={`translate(0 ${sy + sh / 2 - 3})`}><Key colour={colour} /></g>
    </g>
  );
};

const LedgerScene = ({ narrow, still }) => (
  <Stage narrow={narrow}>
    {/* The desk the devices stand on. */}
    <rect fill={TABLE} height="31" width="800" y="189" />
    <line stroke="rgba(231,231,234,0.16)" strokeWidth="1.5" x1="0" x2="800" y1="189.5" y2="189.5" />
    {/* The world the round is sent to. */}
    <g transform="translate(400 37)">
      <circle fill="none" r="15" stroke={ACCENT} strokeWidth="1.4" style={forever(still, "ohUpdRing", 2600, 0, "cubic-bezier(0.2, 0.7, 0.2, 1)")} opacity="0.4" />
      <circle fill={SEA} r="15" stroke={ACCENT} strokeWidth="1.6" />
      <ellipse fill="none" rx="6" ry="15" stroke={ACCENT} strokeOpacity="0.55" strokeWidth="1.1" />
      <line stroke={ACCENT} strokeOpacity="0.45" x1="-15" x2="15" y1="0" y2="0" />
    </g>
    {DEVICES.map((device, at) => (
      <g key={device.kind} style={motion(still, "ohUpdRise", 600, 300 + at * 160)}>
        <Device at={at} device={device} still={still} />
      </g>
    ))}
    {/* The round's token, passed from one device to the next. */}
    <g transform="translate(232 101)">
      <g style={forever(still, "ohWorldsRelay", RELAY_MS, 0, "cubic-bezier(0.45, 0, 0.55, 1)")}>
        <circle fill={INK} r="8.5" stroke={STAGE} strokeWidth="2" />
        <circle fill="none" r="5.2" stroke={STAGE} strokeOpacity="0.5" strokeWidth="1.2" />
        <path d="M0 -3.6 L1 -1 L3.6 0 L1 1 L0 3.6 L-1 1 L-3.6 0 L-1 -1 Z" fill={STAGE} />
      </g>
    </g>
    {!narrow && (
      <>
        {/* The ledger: who paid each round, each in their colour. */}
        <g style={motion(still, "ohUpdFade", 700, 500)}>
          <rect fill={PAPER} height="150" rx="3" width="132" x="26" y="35" />
          <rect fill={PAPER_BACK} height="150" width="8" x="26" y="35" />
          <rect fill={PAPER_INK} height="6" opacity="0.75" rx="2" width="60" x="46" y="48" />
          {Array.from({ length: 6 }, (_, at) => {
            const y = 72 + at * 18;
            return (
              <g key={`r${at}`} style={motion(still, "ohUpdFade", 400, 700 + at * 160)}>
                <rect fill={ROUND[at % 4]} height="9" rx="2" style={at === 5 ? forever(still, "ohUpdPulse", 1800, 0, "cubic-bezier(0.4, 0, 0.6, 1)") : undefined} width="9" x="46" y={y - 4.5} />
                <rect fill={PAPER_INK} height="4" opacity="0.4" rx="2" width={56 - (at % 3) * 10} x="62" y={y - 2} />
                <path d={ticked} fill="none" stroke={PAPER_INK} strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.6" strokeWidth="1.6" transform={`translate(142 ${y})`} />
              </g>
            );
          })}
        </g>
        {/* The Game Master: on, and seen to be on; each change told to every player. */}
        <Card still={still} x={638}>
          <g transform="translate(708 66)">
            <circle fill="none" opacity="0.5" r="20" stroke={FAINT} strokeWidth="1.2" style={forever(still, "ohUpdRing", 2800, 400, "cubic-bezier(0.2, 0.7, 0.2, 1)")} />
            <path d="M-19 0 Q0 -14 19 0 Q0 14 -19 0 Z" fill="none" stroke={INK} strokeWidth="1.6" />
            <circle fill={INK} r="5" />
            <circle fill={RAISED} r="1.8" />
          </g>
          {[108, 132, 156].map((y, at) => (
            <g key={`c${y}`} style={forever(still, "ohUpdTwinkle", 3600, at * 1200, "cubic-bezier(0.4, 0, 0.6, 1)")}>
              <rect fill={STAGE} height="16" rx="4" width="112" x="652" y={y - 8} />
              <rect fill={FAINT} height="4" rx="2" width="42" x="660" y={y - 2} />
              {ROUND.map((colour, index) => <circle cx={720 + index * 9} cy={y} fill={colour} key={colour} r="2.6" />)}
            </g>
          ))}
        </Card>
      </>
    )}
  </Stage>
);

// ---------------------------------------------------------------------------
// secrets: what you plan stays yours.

const BOARD = { x: 192, y: 22, w: 416, h: 176 };
const YOUR_LAND = "206,38 296,30 330,58 322,112 284,140 238,186 208,184 200,120";
const THEIR_LANDS = [
  [CORAL, "296,30 596,28 602,112 528,124 440,100 322,112 330,58"],
  [GREEN, "322,112 440,100 528,124 602,112 598,184 520,190 470,174 400,184 330,178 300,190 238,186 284,140"],
];
// What stands on the map, which every player sees: the fog lifts over each in turn.
const STANDING = [
  { x: 476, y: 62, colour: CORAL, shape: "fort" },
  { x: 380, y: 80, colour: CORAL, shape: "army" },
  { x: 440, y: 150, colour: GREEN, shape: "works" },
  { x: 540, y: 156, colour: GREEN, shape: "army" },
];
const FOG_PUFFS = Array.from({ length: 12 * 6 }, (_, at) => {
  const col = at % 12;
  const row = Math.floor(at / 12);
  return { x: 176 + col * 42 + (row % 2) * 21, y: 14 + row * 38, r: 26 + ((col * 7 + row * 5) % 4) * 4 };
});

// A fort, a city, works and an army, as the map draws what stands on it.
const Standing = ({ shape, colour }) => {
  if (shape === "fort") return <path d="M-9 7 V-5 H-6 V-2 H-2 V-5 H2 V-2 H6 V-5 H9 V7 Z" fill={colour} stroke={STAGE} strokeWidth="1" />;
  if (shape === "city") return <path d="M-9 7 V-1 H-4 V-7 H2 V-3 H8 V7 Z" fill={colour} stroke={STAGE} strokeLinejoin="round" strokeWidth="1" />;
  if (shape === "works") return <path d="M-9 7 V-2 L-4 -6 V-2 L1 -6 V-2 L5 -5 V-9 H8 V7 Z" fill={colour} stroke={STAGE} strokeLinejoin="round" strokeWidth="1" />;
  return (
    <>
      <path d="M-11 1 H11 L8 7 H-8 Z" fill={colour} stroke={STAGE} strokeLinejoin="round" strokeWidth="1" />
      <rect fill={colour} height="5" rx="1.5" stroke={STAGE} strokeWidth="1" width="17" x="-9" y="-4" />
      <line stroke={colour} strokeLinecap="round" strokeWidth="2" x1="1" x2="12" y1="-6" y2="-8" />
      <circle cx="-1" cy="-5" fill={colour} r="3.5" stroke={STAGE} strokeWidth="1" />
    </>
  );
};

// A letter sealed in a player's colour, small, floating over the fog.
const Sealed = ({ colour }) => (
  <>
    <rect fill={PAPER} height="18" rx="1.5" width="26" x="-13" y="-9" />
    <path d="M-13 -9 L0 2 L13 -9" fill="none" stroke={PAPER_INK} strokeOpacity="0.5" strokeWidth="1" />
    <circle cy="1" fill={colour} r="4" stroke={PAPER_INK} strokeOpacity="0.4" />
  </>
);

const SecretsScene = ({ narrow, still }) => {
  const [open, setOpen] = useState(false);
  const read = () => {
    chime(TONES.open);
    setOpen((now) => !now);
  };
  return (
    <Stage
      narrow={narrow}
      over={(view) => <Touch clear colour={AMBER} label="Open" onTouch={read} pressed={open} view={view} x={258} y={158} />}
    >
      <defs>
        <clipPath id="oh-worlds-board">
          <rect height={BOARD.h} rx="6" width={BOARD.w} x={BOARD.x} y={BOARD.y} />
        </clipPath>
        <mask height={H} id="oh-worlds-fog" maskUnits="userSpaceOnUse" width="800" x="0" y="0">
          <rect fill="#fff" height={H} width="800" />
          <polygon fill="#000" points={YOUR_LAND} />
          {STANDING.map((thing, at) => (
            <g key={`h${thing.x}`} transform={`translate(${thing.x} ${thing.y})`}>
              <circle fill="#000" r="21" style={motion(still, "ohWorldsOpen", 900, 1100 + at * 650, "cubic-bezier(0.3, 0.7, 0.3, 1)")} />
            </g>
          ))}
        </mask>
      </defs>
      {/* The map: your land and theirs, and what stands on it. */}
      <rect fill={SEA} height={BOARD.h} rx="6" stroke={LINE} width={BOARD.w} x={BOARD.x} y={BOARD.y} />
      {THEIR_LANDS.map(([colour, points]) => (
        <g key={colour}>
          <polygon fill={LAND} points={points} stroke={SEA} strokeLinejoin="round" strokeWidth="2" />
          <polygon fill={colour} opacity="0.22" points={points} />
        </g>
      ))}
      <polygon fill={LAND_CLEAR} points={YOUR_LAND} stroke={SEA} strokeLinejoin="round" strokeWidth="2" />
      <polygon fill="none" points={YOUR_LAND} stroke={AMBER} strokeLinejoin="round" strokeOpacity="0.85" strokeWidth="2" />
      {STANDING.map((thing) => <g key={`t${thing.x}`} transform={`translate(${thing.x} ${thing.y})`}><Standing colour={thing.colour} shape={thing.shape} /></g>)}
      {/* Your own city, and your own order, which you see and no one else does. */}
      <g transform="translate(258 92)"><Standing colour={AMBER} shape="city" /></g>
      <g style={motion(still, "ohUpdFade", 600, 700)}>
        <path d="M268 88 Q292 76 314 80" fill="none" stroke={AMBER} strokeDasharray="4 4" strokeLinecap="round" strokeWidth="2" />
        <path d="M310 74 L319 80 L310 86 Z" fill={AMBER} />
      </g>
      {/* The fog over everything else, drifting, lifting only where something stands. */}
      <g clipPath="url(#oh-worlds-board)">
        <g mask="url(#oh-worlds-fog)">
          <g style={{ "--oh-worlds-drift": "18px", ...forever(still, "ohWorldsDrift", 11000, 0, "cubic-bezier(0.45, 0, 0.55, 1)") }}>
            {FOG_PUFFS.map((puff) => <circle cx={puff.x} cy={puff.y} fill={FOG} key={`${puff.x}-${puff.y}`} r={puff.r} />)}
          </g>
          <g style={{ "--oh-worlds-drift": "-22px", ...forever(still, "ohWorldsDrift", 8000, 0, "cubic-bezier(0.45, 0, 0.55, 1)") }}>
            {FOG_PUFFS.filter((_, at) => at % 3 === 1).map((puff) => <circle cx={puff.x + 12} cy={puff.y + 8} fill={FOG_NEAR} key={`n${puff.x}-${puff.y}`} r={puff.r * 0.7} />)}
          </g>
        </g>
      </g>
      {STANDING.map((thing, at) => (
        <g key={`o${thing.x}`} transform={`translate(${thing.x} ${thing.y})`}>
          <circle fill="none" r="21" stroke="rgba(231,231,234,0.35)" strokeDasharray="3 3" style={motion(still, "ohWorldsOpen", 900, 1100 + at * 650, "cubic-bezier(0.3, 0.7, 0.3, 1)")} />
        </g>
      ))}
      {/* What the others have only ordered: sealed, theirs until the round is played. */}
      {[[CORAL, 556, 92, -5], [GREEN, 360, 158, 4]].map(([colour, x, y, tilt], at) => (
        <g key={colour} transform={`translate(${x} ${y})`}>
          <g style={{ "--oh-upd-tilt": `${tilt}deg`, ...forever(still, "ohUpdBob", 4600 + at * 700, at * 900, "cubic-bezier(0.45, 0, 0.55, 1)") }}>
            <Sealed colour={colour} />
          </g>
        </g>
      ))}
      {/* Your letter: sealed in your colour until you open it. */}
      <g>
        <rect fill={PAPER_BACK} height="36" rx="2" width="56" x="230" y="138" />
        {open && (
          <>
            <path d="M230 138 L258 117 L286 138 Z" fill={PAPER_BACK} stroke={PAPER_INK} strokeOpacity="0.35" style={{ transformOrigin: "center bottom", ...motion(still, "ohWorldsFlip", 450, 0, "cubic-bezier(0.4, 0, 0.2, 1)") }} />
            <g style={{ "--oh-worlds-slide": "34px", ...motion(still, "ohWorldsSlide", 700, 300, "cubic-bezier(0.2, 0.7, 0.2, 1)") }}>
              <rect fill={INK} height="52" rx="1.5" width="44" x="236" y="104" />
              {[114, 122, 130, 138].map((y, at) => <rect fill={PAPER_INK} height="3" key={y} opacity="0.5" rx="1.5" width={at === 3 ? 18 : 30} x="242" y={y} />)}
              <path d="M270 108 V120 M270 108 H278 L276 111 L278 114 H270" fill={AMBER} stroke={AMBER} strokeLinejoin="round" strokeWidth="1.2" />
            </g>
          </>
        )}
        <path d="M230 146 L258 164 L286 146 V174 H230 Z" fill={PAPER} />
        {!open && (
          <>
            <path d="M230 138 L258 160 L286 138 Z" fill={PAPER} stroke={PAPER_INK} strokeOpacity="0.35" />
            <circle cx="258" cy="158" fill={AMBER} r="6" stroke="#9c7426" strokeWidth="1.5" />
          </>
        )}
      </g>
      {!narrow && (
        <>
          {/* Orders, each sealed in its player's colour until the round is played. */}
          {[[AMBER, 30, 46, -3], [CORAL, 38, 92, 2], [GREEN, 28, 138, -1.5]].map(([colour, x, y, tilt], at) => (
            <g key={colour} style={motion(still, "ohUpdRise", 600, 500 + at * 180)}>
              <g transform={`rotate(${tilt})`}>
                <rect fill={RAISED} height="36" rx="3" stroke={LINE} width="118" x={x} y={y} />
                <rect fill={FAINT} height="4" rx="2" width="64" x={x + 10} y={y + 11} />
                <rect fill="rgba(231,231,234,0.2)" height="4" rx="2" width="48" x={x + 10} y={y + 21} />
                <circle cx={x + 100} cy={y + 18} fill={colour} r="8" stroke={STAGE} strokeWidth="1.5" />
                <circle cx={x + 100} cy={y + 18} fill="none" r="4.5" stroke={STAGE} strokeOpacity="0.45" />
              </g>
            </g>
          ))}
          {/* Your advisor: your talks kept, three suggested orders a round, and your spies' reports yours alone. */}
          <Card still={still} x={642}>
            <circle cx="668" cy="60" fill={FOG} r="9" stroke={FAINT} />
            <path d="M652 86 Q668 70 684 86 Z" fill={FOG} />
            {[52, 60, 68].map((y, at) => <rect fill={FAINT} height="3.5" key={y} rx="1.75" width={[46, 38, 30][at]} x="694" y={y} />)}
            <g transform="translate(758 54)" style={forever(still, "ohUpdPulse", 2400, 0, "cubic-bezier(0.4, 0, 0.6, 1)")}>
              <path d="M-9 0 Q0 -7 9 0 Q0 7 -9 0 Z" fill="none" stroke={INK} strokeWidth="1.3" />
              <circle fill={INK} r="2.4" />
            </g>
            {[110, 134, 158].map((y, at) => (
              <g key={`a${y}`}>
                <rect fill="none" height="12" rx="2" stroke="rgba(231,231,234,0.45)" width="12" x="656" y={y - 6} />
                <path d={ticked} fill="none" stroke={GREEN} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" style={forever(still, "ohUpdTwinkle", 3600, at * 1200, "cubic-bezier(0.4, 0, 0.6, 1)")} transform={`translate(662 ${y})`} />
                <rect fill="rgba(231,231,234,0.3)" height="4" rx="2" width={82 - at * 12} x="676" y={y - 2} />
              </g>
            ))}
          </Card>
        </>
      )}
    </Stage>
  );
};

// ---------------------------------------------------------------------------
// envoys: peace, treaties and votes between players.

const SIGNED_FIRST = "M334 174 c4 -10 9 -12 10 -3 c1 6 5 6 8 -2 c3 -8 6 -8 7 0 c1 6 6 6 9 -4 c2 -5 6 -3 8 2 c2 4 6 4 10 -2";
const SIGNED_SECOND = "M412 174 c3 -12 10 -14 11 -4 c1 7 5 7 9 -1 c3 -7 6 -6 6 1 c0 6 6 5 9 -5 c3 -6 7 -2 8 3 c2 4 7 2 9 -3";

// An envoy standing at the table, a pennant at their back; `side` is -1 on the left, 1 on the right.
const Envoy = ({ colour, side, still }) => (
  <>
    <line stroke={INK} strokeOpacity="0.5" strokeWidth="2" x1={side * 26} x2={side * 26} y1="196" y2="50" />
    <path d={`M${side * 26} 52 L${side * 56} 60 L${side * 26} 68 Z`} fill={colour} style={{ transformOrigin: side < 0 ? "100% 50%" : "0% 50%", ...forever(still, "ohUpdSway", 3400 + side * 300, 0, "cubic-bezier(0.45, 0, 0.55, 1)") }} />
    <path d="M-17 196 L-12 106 Q0 98 12 106 L17 196 Z" fill={colour} />
    <path d={`M${side * 10} 110 L${side * -12} 150`} stroke={STAGE} strokeOpacity="0.35" strokeWidth="3" />
    <circle cx="0" cy="88" fill={colour} r="11" stroke={STAGE} strokeWidth="2" />
    <rect fill={PAPER} height="8" rx="4" width="26" x={side < 0 ? 8 : -34} y="126" />
  </>
);

const EnvoysScene = ({ narrow, still }) => {
  const [signs, setSigns] = useState(0);
  const sign = () => {
    chime(TONES.sign);
    setSigns((count) => count + 1);
  };
  return (
    <Stage
      narrow={narrow}
      over={(view) => (
        <Touch colour={CORAL} label="Sign" onTouch={sign} view={view} x={500} y={170}>
          <svg aria-hidden="true" height="15" viewBox="0 0 16 16" width="15"><path d="M3 13 L4 9.5 L11 2.5 L13.5 5 L6.5 12 Z M9.5 4 L12 6.5" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" /></svg>
        </Touch>
      )}
    >
      {/* The treaty, its lines writing themselves. */}
      <g style={motion(still, "ohUpdRise", 600, 200)}>
        <rect fill={PAPER} height="172" rx="3" width="168" x="316" y="24" />
        <circle cx="400" cy="42" fill="none" r="7" stroke={PAPER_INK} strokeOpacity="0.55" strokeWidth="1.4" />
        {[136, 120, 136, 104, 136, 112].map((width, at) => (
          <rect fill={PAPER_INK} height="4" key={`w${at}`} opacity="0.45" rx="2" style={{ transformOrigin: "left center", ...motion(still, "ohUpdGrow", 420, 500 + at * 150, "cubic-bezier(0.3, 0, 0.2, 1)") }} width={width} x="332" y={60 + at * 11} />
        ))}
        <line stroke={PAPER_INK} strokeOpacity="0.5" x1="330" x2="392" y1="178" y2="178" />
        <line stroke={PAPER_INK} strokeOpacity="0.5" x1="408" x2="470" y1="178" y2="178" />
      </g>
      {/* One envoy has signed; the other signs at a touch, and the seal of both is stamped. */}
      <path d={SIGNED_FIRST} fill="none" stroke={AMBER} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" style={drawn(still, 160, 900, 1500)} />
      {signs > 0 ? (
        <g key={signs}>
          <path d={SIGNED_SECOND} fill="none" stroke={CORAL} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" style={drawn(still, 160, 800, 0)} />
          <g transform="translate(400 142)">
            <g style={motion(still, "ohUpdStamp", 600, 750)}>
              <circle fill="none" r="17" stroke={PAPER_INK} strokeDasharray="2 3" strokeOpacity="0.5" />
              <path d="M0 -13 A13 13 0 0 0 0 13 Z" fill={AMBER} />
              <path d="M0 -13 A13 13 0 0 1 0 13 Z" fill={CORAL} />
              <path d="M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z" fill={PAPER} />
            </g>
          </g>
        </g>
      ) : (
        <>
          <g transform="translate(500 170)">
            <circle fill="none" opacity="0.6" r="16" stroke={CORAL} strokeWidth="1.5" style={forever(still, "ohUpdRing", 2400, 2200, "cubic-bezier(0.2, 0.7, 0.2, 1)")} />
          </g>
          <circle cx="400" cy="142" fill="none" r="13" stroke={PAPER_INK} strokeDasharray="3 3" strokeOpacity="0.3" />
        </>
      )}
      {/* The envoys, walking up from either side, the terms between them. */}
      {[[AMBER, 238, -1], [CORAL, 562, 1]].map(([colour, x, side], at) => (
        <g key={colour} transform={`translate(${x} 0)`}>
          <g style={carried(still, side * 50, 0, 1300, 150 + at * 200)}>
            <Envoy colour={colour} side={side} still={still} />
          </g>
          <line stroke={colour} strokeDasharray="4 4" strokeWidth="1.5" style={motion(still, "ohUpdFade", 600, 1300 + at * 200)} x1={side * -36} x2={side * -78} y1="130" y2="130" />
        </g>
      ))}
      {!narrow && (
        <>
          {/* The ballot box: each country votes once, for itself. */}
          <g style={motion(still, "ohUpdFade", 700, 500)}>
            {ROUND.map((colour, at) => (
              <g key={colour} transform={`translate(${80 + at * 8} ${52 + (still ? at * 10 : 0)})`}>
                <g style={{ "--oh-upd-fall": "66px", ...forever(still, "ohUpdFall", 3600, at * 900, "cubic-bezier(0.5, 0, 0.9, 0.6)") }}>
                  <rect fill={colour} height="14" rx="2" width="20" x="-10" y="-7" />
                  <path d={ticked} fill="none" stroke={STAGE} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
                </g>
              </g>
            ))}
            <rect fill={RAISED} height="62" rx="4" stroke={FAINT} width="92" x="46" y="126" />
            <rect fill={CHAIR} height="10" rx="2" stroke={FAINT} width="104" x="40" y="118" />
            <rect fill={STAGE} height="4" rx="2" width="44" x="70" y="121" />
            <path d="M80 156 L88 164 L104 146" fill="none" stroke={FAINT} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          </g>
          {/* An institution: every member votes for itself, in turn. */}
          <g style={motion(still, "ohUpdFade", 700, 600)}>
            <path d="M648 78 L708 48 L768 78 Z" fill={RAISED} stroke={FAINT} strokeLinejoin="round" />
            <rect fill={RAISED} height="7" stroke={FAINT} width="120" x="648" y="78" />
            {[663, 693, 723, 753].map((x) => <rect fill={CHAIR} height="46" key={x} stroke={FAINT} width="10" x={x - 5} y="85" />)}
            <rect fill={RAISED} height="6" stroke={FAINT} width="128" x="644" y="131" />
            <rect fill={RAISED} height="6" stroke={FAINT} width="140" x="638" y="137" />
            {ROUND.map((colour, at) => (
              <g key={colour} transform={`translate(${663 + at * 30} 0)`}>
                <circle cy="168" fill={colour} r="7" stroke={STAGE} strokeWidth="1.5" />
                <path d={ticked} fill="none" stroke={colour} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" style={forever(still, "ohUpdTwinkle", 2800, at * 700, "cubic-bezier(0.4, 0, 0.6, 1)")} transform="translate(0 153)" />
              </g>
            ))}
          </g>
        </>
      )}
    </Stage>
  );
};

// ---------------------------------------------------------------------------
// fronts: one war, fought by the same rules.

const FRONT = [[400, 0], [392, 30], [408, 58], [412, 88], [398, 116], [388, 146], [402, 176], [406, 220]];
// Where the front runs at a height.
const frontAt = (y) => {
  for (let at = 1; at < FRONT.length; at += 1) {
    const [x0, y0] = FRONT[at - 1];
    const [x1, y1] = FRONT[at];
    if (y <= y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return FRONT[FRONT.length - 1][0];
};
// The front's teeth, one on each stretch, in turn each side's, pointing at the other.
const TEETH = FRONT.slice(1).map(([x1, y1], at) => {
  const [x0, y0] = FRONT[at];
  const length = Math.hypot(x1 - x0, y1 - y0);
  const [dx, dy] = [(x1 - x0) / length, (y1 - y0) / length];
  const facing = at % 2 === 0 ? 1 : -1;
  const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
  return {
    colour: facing > 0 ? AMBER : CORAL,
    points: `${mx - dx * 6},${my - dy * 6} ${mx + dx * 6},${my + dy * 6} ${mx + dy * 8 * facing},${my - dx * 8 * facing}`,
  };
});
const SORTIE_MS = 5200;
// Each side's aircraft, crossing to strike the front: amber from the left, coral from the right.
const SORTIES = [
  { colour: AMBER, from: 176, y: 48, delay: 0 },
  { colour: CORAL, from: 628, y: 90, delay: 1300 },
  { colour: AMBER, from: 170, y: 122, delay: 2600 },
  { colour: CORAL, from: 630, y: 152, delay: 3900 },
].map((sortie) => ({ ...sortie, to: frontAt(sortie.y) + (sortie.colour === AMBER ? 24 : -24) }));
// Strikes already made, which stand beside each other's.
const CRATERS = [[AMBER, 436, 36], [AMBER, 446, 112], [AMBER, 428, 160], [CORAL, 372, 70], [CORAL, 366, 128], [CORAL, 378, 192]];

const Plane = ({ colour, left = false }) => (
  <path
    d="M-11 -1.8 L7 -1.8 L11 0 L7 1.8 L-11 1.8 Z M-2 -1.8 L2 -1.8 L-1 -11 L-4 -11 Z M-2 1.8 L2 1.8 L-1 11 L-4 11 Z M-11 -1.5 L-8 -1.5 L-10 -5.5 L-12 -5.5 Z M-11 1.5 L-8 1.5 L-10 5.5 L-12 5.5 Z"
    fill={colour}
    stroke={STAGE}
    strokeWidth="0.8"
    style={left ? { transform: "scaleX(-1)" } : undefined}
  />
);
const Crater = ({ colour }) => (
  <>
    <circle fill="none" opacity="0.35" r="5.5" stroke={colour} />
    <path d="M-3 -3 L3 3 M3 -3 L-3 3" stroke={colour} strokeLinecap="round" strokeWidth="1.6" />
  </>
);

// One crossing: once (a touch) or for ever; with Reduce motion, the aircraft drawn on its way.
const Sortie = ({ sortie, still, again }) => {
  const run = sortie.to - sortie.from;
  const flight = again
    ? forever(still, "ohWorldsSortie", SORTIE_MS, sortie.delay, "linear")
    : motion(still, "ohWorldsSortie", 1700, 0, "linear");
  const hit = again
    ? forever(still, "ohWorldsHit", SORTIE_MS, sortie.delay, "linear")
    : motion(still, "ohWorldsHit", 1700, 0, "linear");
  // (A touch's crossing, with Reduce motion, leaves only its strike.)
  if (still && !again) return null;
  return (
    <>
      <g transform={`translate(${sortie.from} ${sortie.y})`}>
        <g style={still ? { transform: `translateX(${run * 0.6}px)` } : { "--oh-worlds-run": `${run}px`, ...flight }}>
          <Plane colour={sortie.colour} left={sortie.colour !== AMBER} />
        </g>
      </g>
      {!still && (
        <g transform={`translate(${sortie.to} ${sortie.y})`}>
          <circle fill="none" r="9" stroke={sortie.colour} strokeWidth="2" style={hit} />
        </g>
      )}
    </>
  );
};

const FrontsScene = ({ narrow, still }) => {
  const [strikes, setStrikes] = useState(0);
  const strike = () => {
    chime(TONES.strike);
    setStrikes((count) => count + 1);
  };
  // The touches' strikes, the last six of each side, each standing beside the other's.
  const ordered = Array.from({ length: Math.min(strikes, 6) }, (_, at) => strikes - at).flatMap((k) => {
    const high = 34 + ((k * 29) % 120);
    const low = 46 + ((k * 41) % 110);
    return [
      { key: `a${k}`, colour: AMBER, from: 190, y: high, to: frontAt(high) + 14 + (k % 3) * 6, delay: 0 },
      { key: `c${k}`, colour: CORAL, from: 610, y: low, to: frontAt(low) - 14 - (k % 3) * 6, delay: 0 },
    ];
  });
  const amberLand = `0,0 ${FRONT.map((point) => point.join(",")).join(" ")} 0,${H}`;
  const coralLand = `${FRONT.map((point) => point.join(",")).join(" ")} 800,${H} 800,0`;
  return (
    <Stage
      narrow={narrow}
      over={(view) => (
        <Touch colour={INK} label="Strike" onTouch={strike} view={view} x={400} y={24}>
          <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16"><circle cx="8" cy="8" fill="none" r="4.5" stroke="currentColor" strokeWidth="1.5" /><path d="M8 0.5v4M8 11.5v4M0.5 8h4M11.5 8h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
        </Touch>
      )}
    >
      <rect fill={GRASS} height={H} width="800" />
      <polygon fill={AMBER} opacity="0.07" points={amberLand} />
      <polygon fill={CORAL} opacity="0.07" points={coralLand} />
      {Array.from({ length: 21 }, (_, at) => <line key={`v${at}`} stroke="rgba(231,231,234,0.05)" x1={at * 40} x2={at * 40} y1="0" y2={H} />)}
      {Array.from({ length: 6 }, (_, at) => <line key={`g${at}`} stroke="rgba(231,231,234,0.05)" x1="0" x2="800" y1={at * 40} y2={at * 40} />)}
      {[[300, 70, 60, 24], [520, 150, 70, 28], [250, 170, 44, 18]].map(([cx, cy, rx, ry]) => (
        <g key={`c${cx}`}>
          <ellipse cx={cx} cy={cy} fill="none" rx={rx} ry={ry} stroke="rgba(231,231,234,0.08)" />
          <ellipse cx={cx} cy={cy} fill="none" rx={rx * 0.6} ry={ry * 0.6} stroke="rgba(231,231,234,0.08)" />
        </g>
      ))}
      {/* The front both share, its teeth each side's in turn. */}
      <polyline fill="none" points={FRONT.map((point) => point.join(",")).join(" ")} stroke={INK} strokeLinejoin="round" strokeOpacity="0.85" strokeWidth="3" style={drawn(still, 260, 1400, 300)} />
      {TEETH.map((tooth, at) => <polygon fill={tooth.colour} key={tooth.points} points={tooth.points} style={motion(still, "ohUpdFade", 400, 900 + at * 120)} />)}
      {/* Strikes made, both sides', and the ones still flying. */}
      {CRATERS.map(([colour, x, y]) => <g key={`k${x}-${y}`} transform={`translate(${x} ${y})`}><g style={motion(still, "ohUpdFade", 500, 1600)}><Crater colour={colour} /></g></g>)}
      {SORTIES.map((sortie) => <Sortie again key={`f${sortie.y}`} sortie={sortie} still={still} />)}
      {ordered.map((sortie) => (
        <g key={sortie.key}>
          <Sortie sortie={sortie} still={still} />
          <g transform={`translate(${sortie.to} ${sortie.y})`}><g style={motion(still, "ohUpdFade", 300, 1350)}><Crater colour={sortie.colour} /></g></g>
        </g>
      ))}
      {/* The scales: they sway, and come back level. */}
      <line stroke={INK} strokeOpacity="0.6" strokeWidth="2.5" x1="400" x2="400" y1="182" y2="211" />
      <rect fill={INK} height="5" opacity="0.6" rx="2" width="36" x="382" y="209" />
      <g style={{ transformOrigin: "50% 0%", ...forever(still, "ohUpdSway", 4200, 0, "cubic-bezier(0.45, 0, 0.55, 1)") }}>
        <circle cx="400" cy="182" fill={INK} r="3" />
        <line stroke={INK} strokeLinecap="round" strokeWidth="2.5" x1="352" x2="448" y1="182" y2="182" />
        {[[352, AMBER], [448, CORAL]].map(([x, colour]) => (
          <g key={x}>
            <path d={`M${x} 182 L${x - 12} 198 M${x} 182 L${x + 12} 198`} stroke={INK} strokeOpacity="0.5" strokeWidth="1" />
            <rect fill={colour} height="7" rx="1.5" width="12" x={x - 6} y="191" />
            <path d={`M${x - 14} 198 Q${x} 207 ${x + 14} 198 Z`} fill={INK} opacity="0.75" />
          </g>
        ))}
      </g>
      {!narrow && (
        <>
          {/* Fifteen formations of your own; those you did not raise are not counted. */}
          <Card still={still} x={22}>
            {Array.from({ length: 15 }, (_, at) => {
              const [x, y] = [38 + (at % 5) * 24, 50 + Math.floor(at / 5) * 22];
              const raised = at < 11;
              return (
                <g key={`u${at}`} style={raised ? motion(still, "ohUpdFade", 300, 500 + at * 70) : undefined}>
                  <rect fill={raised ? AMBER : "none"} height="13" stroke={raised ? STAGE : FAINT} strokeDasharray={raised ? undefined : "2 2"} width="18" x={x} y={y} />
                  {raised && <path d={`M${x} ${y} L${x + 18} ${y + 13} M${x + 18} ${y} L${x} ${y + 13}`} stroke={STAGE} strokeWidth="1" />}
                </g>
              );
            })}
            <line stroke={FAINT} strokeDasharray="3 3" x1="34" x2="150" y1="130" y2="130" />
            {[0, 1, 2].map((at) => (
              <g key={`n${at}`}>
                <rect fill={GREEN} height="13" stroke={STAGE} width="18" x={38 + at * 24} y="148" />
                <path d={`M${38 + at * 24} 148 L${56 + at * 24} 161 M${56 + at * 24} 148 L${38 + at * 24} 161`} stroke={STAGE} strokeWidth="1" />
              </g>
            ))}
          </Card>
          {/* The military ranking, filled in for every player. */}
          <Card still={still} x={638}>
            {[[GREEN, 0.9], [AMBER, 0.74], [CORAL, 0.62], [IVORY, 0.46]].map(([colour, share], at) => {
              const y = 62 + at * 32;
              return (
                <g key={colour}>
                  <circle cx="656" cy={y} fill={colour} r="7" />
                  <circle cx="656" cy={y} fill={STAGE} r="2.6" />
                  <rect fill={LINE} height="6" rx="3" width="96" x="670" y={y - 3} />
                  <rect fill={colour} height="6" rx="3" style={{ transformOrigin: "left center", ...motion(still, "ohUpdGrow", 1100, 600 + at * 220, "cubic-bezier(0.3, 0, 0.2, 1)") }} width={96 * share} x="670" y={y - 3} />
                </g>
              );
            })}
          </Card>
        </>
      )}
    </Stage>
  );
};

const SCENES = { table: TableScene, ledger: LedgerScene, secrets: SecretsScene, envoys: EnvoysScene, fronts: FrontsScene };

// ---------------------------------------------------------------------------
// The page.

// The shared world's mark: a globe, and round it a seat for each player.
const Mark = ({ size }) => (
  <svg aria-hidden="true" height={size} viewBox="0 0 48 48" width={size}>
    <circle cx="24" cy="24" fill={SEA} r="14" stroke={ACCENT} strokeWidth="1.8" />
    <ellipse cx="24" cy="24" fill="none" rx="6" ry="14" stroke={ACCENT} strokeOpacity="0.6" strokeWidth="1.2" />
    <line stroke={ACCENT} strokeOpacity="0.45" strokeWidth="1.2" x1="10" x2="38" y1="24" y2="24" />
    {ROUND.map((colour, at) => {
      const turn = ((at * 90 + 45) * Math.PI) / 180;
      return <circle cx={24 + Math.sin(turn) * 20} cy={24 - Math.cos(turn) * 20} fill={colour} key={colour} r="3.6" stroke={GROUND} strokeWidth="1.5" />;
    })}
  </svg>
);

// Four corner brackets, one in each player's colour.
const Corners = ({ narrow }) => {
  const length = narrow ? "1.1rem" : "1.5rem";
  const inset = narrow ? "0.5rem" : "0.7rem";
  const arm = (colour) => ({ borderColor: colour, borderStyle: "solid", borderWidth: 0, height: length, pointerEvents: "none", position: "absolute", width: length, zIndex: 1 });
  return (
    <>
      <span aria-hidden="true" style={{ ...arm(AMBER), borderLeftWidth: 2, borderTopWidth: 2, left: inset, top: inset }} />
      <span aria-hidden="true" style={{ ...arm(CORAL), borderRightWidth: 2, borderTopWidth: 2, right: inset, top: inset }} />
      <span aria-hidden="true" style={{ ...arm(GREEN), borderBottomWidth: 2, borderRightWidth: 2, bottom: inset, right: inset }} />
      <span aria-hidden="true" style={{ ...arm(IVORY), borderBottomWidth: 2, borderLeftWidth: 2, bottom: inset, left: inset }} />
    </>
  );
};

// A banner's sections as cards, each in a player's colour in turn round the table.
const SeatCards = ({ sections, narrow, delay = 520, step = 110 }) => (
  <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: narrow ? "1fr" : sections.length === 4 ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(15.5rem, 1fr))" }}>
    {sections.map((section, index) => {
      const colour = ROUND[index % ROUND.length];
      return (
        <Reveal delay={delay + index * step} key={section.heading}>
          <div style={{ background: "rgba(231,231,234,0.035)", border: `1px solid ${LINE}`, borderRadius: "8px", borderTop: `3px solid ${colour}`, boxSizing: "border-box", height: "100%", padding: "0.75rem 0.85rem 0.8rem" }}>
            <div style={{ alignItems: "center", color: colour, display: "flex", gap: "0.5rem" }}>
              {(ICONS[section.icon] ?? ICONS.star)(20)}
              <span style={{ color: INK, fontFamily: FACE, fontSize: "0.9rem", fontWeight: 700, letterSpacing: "0.01em" }}>{section.heading}</span>
            </div>
            <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: 0 }}>
              {(section.items ?? []).map((item) => (
                <li key={item} style={{ color: SOFT, display: "flex", fontSize: "0.8rem", gap: "0.5rem", lineHeight: 1.45, marginTop: "0.32rem" }}>
                  <span aria-hidden="true" style={{ background: colour, borderRadius: "999px", flex: "0 0 auto", height: "0.4rem", marginTop: "0.42rem", width: "0.4rem" }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      );
    })}
  </div>
);

const SharedWorlds = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const Scene = SCENES[banner.scene] ?? TableScene;
  const seat = worldsSeat(banner);
  return (
    <Plate surface={{ background: GROUND, border: "1px solid rgba(231,231,234,0.14)", borderRadius: "12px" }}>
      <Corners narrow={narrow} />
      <Reveal delay={150} style={{ overflow: "hidden", position: "relative" }}>
        <Scene narrow={narrow} still={still} />
      </Reveal>
      <div aria-hidden="true" style={{ display: "flex", height: "3px" }}>
        {ROUND.map((colour) => <span key={colour} style={{ background: colour, flex: 1 }} />)}
      </div>
      <div style={{ fontFamily: FACE, padding: narrow ? "1.1rem 1.1rem 1.3rem" : "1.4rem 2rem 1.7rem" }}>
        <Reveal delay={300} style={{ alignItems: "center", display: "flex", gap: narrow ? "0.75rem" : "1rem" }}>
          <span style={{ display: "inline-flex", flex: "0 0 auto", ...motion(still, "ohUpdTurn", 800, 260) }}><Mark size={narrow ? 40 : 54} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: ACCENT, fontSize: narrow ? "0.7rem" : "0.78rem", fontWeight: 700, letterSpacing: narrow ? "0.1em" : "0.16em", textTransform: "uppercase" }}>
              Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
            </div>
            <div style={{ color: INK, fontSize: narrow ? "1.85rem" : "clamp(2.2rem, 5.5vw, 3.1rem)", fontWeight: 900, letterSpacing: "-0.01em", lineHeight: 1.04, marginTop: "0.15rem", ...motion(still, "ohUpdFade", 500, 380) }}>{banner.title}</div>
            {banner.subtitle && <div style={{ color: seat, fontSize: narrow ? "0.95rem" : "1.04rem", fontWeight: 600, marginTop: "0.25rem" }}>{banner.subtitle}</div>}
          </div>
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: SOFT, fontSize: narrow ? "0.92rem" : "0.98rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={FAINT}>
          <span style={{ display: "inline-flex", gap: "0.3rem" }}>
            {ROUND.map((colour) => <span key={colour} style={{ background: colour, borderRadius: "999px", display: "inline-block", height: "0.45rem", width: "0.45rem" }} />)}
          </span>
        </Rule>
        <SeatCards narrow={narrow} sections={banner.sections ?? []} />
      </div>
    </Plate>
  );
};

export default SharedWorlds;
