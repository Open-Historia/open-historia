/*! Open Historia — Wars and Fronts Part Two: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The update's own look: the war room's, plate steel held by rivets, brass and
// stencilled capitals, a red stamp; and on each page a small battlefield that
// moves, drawn in flat shapes (nothing is a gradient, nothing purple). Two
// scenes, one a banner (notes.js `scene`):
//
//   front       the line: a front drawn in red, an arrow of advance, counters
//               moving up, aircraft crossing, a ship at sea, guns firing, a
//               fortified line, frost in a corner
//   commander   the staff that looks ahead: from its headquarters a dozen plans
//               drawn faint one after another, then the one it chose in brass
//
// With Reduce motion everything is drawn where it ends, and nothing moves.

import React from "react";

import { AMBER, BONE, BONE_SOFT, BRASS, RED, RED_BRIGHT, STEEL, STENCIL, plateStyle, rivetStyle, trayStyle } from "../../warRoomTheme.js";
import { Brackets, Emblem, FeatureCards, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";

const BLUE = "#3c6e9e";
const RED_UNIT = "#9a3a34";
const LAND = "#2b3024";
const SEA = "#142230";
const GRID = "rgba(236,231,218,0.07)";

// A line drawn along itself: `length` at least as long as the line.
const drawn = (still, length, duration, delay) => (still
  ? {}
  : { strokeDasharray: length, "--oh-upd-length": length, ...motion(still, "ohUpdDraw", duration, delay, "cubic-bezier(0.45, 0, 0.2, 1)") });
// Something carried across from `from` to `to` (in px), once or for ever.
const carried = (still, from, to, duration, delay, again = false) => (still
  ? {}
  : { "--oh-upd-from": `${from}px`, "--oh-upd-to": `${to}px`, ...(again ? forever(still, "ohUpdDrift", duration, delay) : motion(still, "ohUpdDrift", duration, delay)) });

// A counter on the map: a box with the cross of infantry.
const Counter = ({ x, y, fill, style = null }) => (
  <g style={style}>
    <rect fill={fill} height="16" stroke={BONE} strokeWidth="1.2" width="26" x={x} y={y} />
    <path d={`M${x} ${y} L${x + 26} ${y + 16} M${x + 26} ${y} L${x} ${y + 16}`} stroke={BONE} strokeWidth="1" />
  </g>
);

// An aircraft seen from above, nose to the right (it is drawn nose to the left, and turned round about its middle:
// "the planes are facing the wrong way", the owner, 2026-10-15), for they cross from left to right.
const Plane = ({ y, style = null }) => (
  <g style={style}>
    <path d={`M0 ${y} l14 -2 6 -9 h3 l-3 9 10 -1.5 3 -3 h2.5 l-1.5 5 1.5 5 h-2.5 l-3 -3 -10 -1.5 3 9 h-3 l-6 -9 z`} fill={BONE} opacity="0.85" style={{ transform: "scaleX(-1)" }} />
  </g>
);

const Front = ({ still }) => (
  <svg className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 180">
    <rect fill={LAND} height="180" width="800" />
    <path d="M0 150 C120 140 220 160 330 152 S560 140 800 150 V180 H0 Z" fill={SEA} />
    {Array.from({ length: 21 }, (_, at) => <line key={`v${at}`} stroke={GRID} x1={at * 40} x2={at * 40} y1="0" y2="180" />)}
    {Array.from({ length: 5 }, (_, at) => <line key={`h${at}`} stroke={GRID} x1="0" x2="800" y1={at * 40} y2={at * 40} />)}
    {[[140, 60, 70, 26], [620, 50, 90, 30], [560, 120, 60, 18]].map(([cx, cy, rx, ry]) => (
      <g key={`${cx}`}>
        <ellipse cx={cx} cy={cy} fill="none" rx={rx} ry={ry} stroke="rgba(236,231,218,0.09)" />
        <ellipse cx={cx} cy={cy} fill="none" rx={rx * 0.6} ry={ry * 0.6} stroke="rgba(236,231,218,0.09)" />
      </g>
    ))}
    {/* A fortified line, behind the blue side. */}
    <path d="M190 8 C196 50 180 90 192 140" fill="none" stroke={BRASS} strokeWidth="2.5" opacity="0.8" />
    {[16, 34, 52, 70, 88, 106, 124].map((y) => <rect fill={BRASS} height="5" key={y} opacity="0.8" width="7" x={186 + Math.sin(y / 20) * 5} y={y} />)}
    {/* Frost in the corner. */}
    {Array.from({ length: 18 }, (_, at) => (
      <circle cx={12 + ((at * 37) % 110)} cy={8 + ((at * 23) % 46)} fill={BONE} key={at} r={at % 3 === 0 ? 1.6 : 1} style={forever(still, "ohUpdTwinkle", 2400 + (at % 5) * 300, at * 170, "cubic-bezier(0.4, 0, 0.6, 1)")} />
    ))}
    {/* The front, and the arrow of the advance across it. */}
    <path d="M430 0 C405 35 455 55 432 88 S385 125 415 156" fill="none" stroke={RED} strokeLinecap="round" strokeWidth="4" style={drawn(still, 220, 1500, 450)} />
    <path d="M250 92 C330 92 420 78 512 64" fill="none" stroke={BRASS} strokeLinecap="round" strokeWidth="7" style={drawn(still, 280, 1100, 1700)} />
    <path d="M512 52 L536 62 L514 78 Z" fill={BRASS} style={motion(still, "ohUpdFade", 300, 2700)} />
    {/* The blue counters move up; the red hold. */}
    {[[300, 28], [330, 62], [312, 98], [290, 126]].map(([x, y], at) => (
      <Counter fill={BLUE} key={`b${at}`} style={carried(still, 0, 26, 2200, 1900 + at * 120)} x={x} y={y} />
    ))}
    {[[468, 22], [486, 70], [455, 110]].map(([x, y], at) => <Counter fill={RED_UNIT} key={`r${at}`} x={x} y={y} />)}
    {/* Guns along the line. */}
    {[[440, 40], [420, 100], [452, 132]].map(([cx, cy], at) => (
      <circle cx={cx} cy={cy} fill={AMBER} key={`g${at}`} r="4" style={forever(still, "ohUpdPulse", 1200, at * 400, "cubic-bezier(0.4, 0, 0.6, 1)")} />
    ))}
    {/* Aircraft crossing, and a ship at sea. */}
    {[0, 3000, 6000].map((delay, at) => <Plane key={delay} style={carried(still, -60, 860, 9000, delay, true)} y={20 + at * 9} />)}
    <g style={carried(still, 860, -80, 26000, 0, true)}>
      <path d="M0 164 h40 l-6 8 h-28 z M18 164 v-12 l12 10 h-12" fill={BONE} opacity="0.75" />
    </g>
  </svg>
);

// From the headquarters: the plans it weighs, faint, one after another; then the one it chose.
const PLANS = [[420, 26], [470, 70], [455, 118], [380, 160], [300, 20], [520, 150], [360, 96]];
const Commander = ({ still }) => (
  <svg className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 180">
    <rect fill="#1c2026" height="180" width="800" />
    {Array.from({ length: 10 }, (_, col) => Array.from({ length: 5 }, (__, row) => (
      (col + row) % 2 === 0 ? <rect fill="rgba(236,231,218,0.035)" height="36" key={`${col}-${row}`} width="80" x={col * 80} y={row * 36} /> : null
    )))}
    {/* A knight, as on a board. */}
    <path d="M660 160 h70 v-12 h-8 c0 -26 -6 -46 -18 -62 l6 -16 -14 4 c-14 -6 -30 2 -36 18 l-14 22 10 8 14 -10 c4 10 -6 22 -12 34 h-8 z" fill="none" stroke={BRASS} strokeWidth="2" opacity="0.35" />
    {/* The headquarters, thinking. */}
    <circle cx="150" cy="90" fill="none" r="22" stroke={BRASS} strokeWidth="1.5" style={forever(still, "ohUpdPulse", 1600, 0, "cubic-bezier(0.4, 0, 0.6, 1)")} />
    <circle cx="150" cy="90" fill="none" r="34" stroke={BRASS} strokeWidth="1" opacity="0.5" style={forever(still, "ohUpdPulse", 1600, 400, "cubic-bezier(0.4, 0, 0.6, 1)")} />
    <path d="M150 74 L155 86 L168 90 L155 94 L150 106 L145 94 L132 90 L145 86 Z" fill={BRASS} />
    {PLANS.map(([x, y], at) => (
      <path d={`M150 90 Q${(150 + x) / 2} ${y < 90 ? y - 10 : y + 10} ${x} ${y}`} fill="none" key={at} stroke={BONE} strokeDasharray={still ? "4 5" : undefined} strokeWidth="1.4" opacity="0.32" style={drawn(still, 420, 700, 300 + at * 260)} />
    ))}
    {PLANS.map(([x, y], at) => <circle cx={x} cy={y} fill={BONE} key={`end${at}`} opacity="0.4" r="3" style={motion(still, "ohUpdFade", 300, 900 + at * 260)} />)}
    {/* The plan it chose. */}
    <path d="M150 90 C260 60 400 50 560 70" fill="none" stroke={BRASS} strokeLinecap="round" strokeWidth="6" style={drawn(still, 440, 900, 300 + PLANS.length * 260)} />
    <path d="M556 56 L586 72 L556 86 Z" fill={BRASS} style={motion(still, "ohUpdFade", 300, 1200 + PLANS.length * 260)} />
    <circle cx="590" cy="72" fill="none" r="14" stroke={RED_BRIGHT} strokeWidth="2" style={forever(still, "ohUpdPulse", 1400, 1400 + PLANS.length * 260, "cubic-bezier(0.4, 0, 0.6, 1)")} />
  </svg>
);

// (The seasons and the weather have an update and a look of their own: SeasonsAndWeather.jsx.)
const SCENES = { front: Front, commander: Commander };

const WarsAndFronts2 = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const Scene = SCENES[banner.scene] ?? Front;
  const stamped = banner.scene === "front";
  const steel = plateStyle();
  return (
    <Plate surface={{ ...steel, border: `2px solid ${STEEL.seam}`, borderRadius: "6px" }}>
      <span aria-hidden="true" style={rivetStyle({ left: "0.45rem", top: "0.45rem" })} />
      <span aria-hidden="true" style={rivetStyle({ right: "0.45rem", top: "0.45rem" })} />
      <span aria-hidden="true" style={rivetStyle({ left: "0.45rem", bottom: "0.45rem" })} />
      <span aria-hidden="true" style={rivetStyle({ right: "0.45rem", bottom: "0.45rem" })} />
      <Brackets colour={BRASS} />
      <div style={{ padding: narrow ? "1.6rem 1.1rem 1.2rem" : "1.9rem 1.9rem 1.6rem" }}>
        <Reveal delay={120} style={{ alignItems: "center", display: "flex", gap: narrow ? "0.7rem" : "1rem", paddingRight: stamped && !narrow ? "6.5rem" : 0, paddingTop: stamped && narrow ? "1.3rem" : 0, position: "relative" }}>
          <Emblem colour={BRASS} delay={180} ink={STEEL.seam} size={narrow ? 48 : 70} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: BRASS, fontFamily: STENCIL, fontSize: narrow ? "0.68rem" : "0.8rem", fontWeight: 700, letterSpacing: narrow ? "0.12em" : "0.22em", textTransform: "uppercase" }}>
              Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
            </div>
            <div style={{ color: BONE, fontFamily: STENCIL, fontSize: "clamp(1.7rem, 5.4vw, 2.8rem)", fontWeight: 800, letterSpacing: "0.05em", lineHeight: 1.02, textTransform: "uppercase" }}>{banner.title}</div>
            {banner.subtitle && <div style={{ color: BRASS, fontFamily: STENCIL, fontSize: narrow ? "0.88rem" : "1.05rem", letterSpacing: narrow ? "0.18em" : "0.32em", textTransform: "uppercase" }}>{banner.subtitle}</div>}
          </div>
          {stamped && (
            <div
              aria-hidden="true"
              style={{
                border: `3px solid ${RED_BRIGHT}`,
                color: RED_BRIGHT,
                fontFamily: STENCIL,
                fontSize: narrow ? "0.66rem" : "0.9rem",
                fontWeight: 800,
                letterSpacing: "0.18em",
                padding: narrow ? "0.15rem 0.4rem" : "0.25rem 0.55rem",
                position: "absolute",
                right: 0,
                textTransform: "uppercase",
                top: narrow ? "-0.5rem" : "0.2rem",
                transform: "rotate(-8deg)",
                ...motion(still, "ohUpdStamp", 700, 900),
              }}
            >
              Major update
            </div>
          )}
        </Reveal>
        <Reveal delay={260} style={{ ...trayStyle(false), height: "clamp(7rem, 22vw, 11rem)", marginTop: "1.1rem", overflow: "hidden", position: "relative" }}>
          <Scene still={still} />
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: BONE_SOFT, fontFamily: "Georgia, \"Times New Roman\", serif", fontSize: "0.98rem", fontStyle: "italic", lineHeight: 1.55, margin: "1rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={BRASS}>
          <span style={{ background: RED, display: "inline-block", height: "0.6rem", transform: "rotate(45deg)", width: "0.6rem" }} />
        </Rule>
        <FeatureCards accent={BRASS} card={{ ...trayStyle(false), borderRadius: "3px" }} delay={520} font={STENCIL} sections={banner.sections ?? []} soft={BONE_SOFT} />
      </div>
    </Plate>
  );
};

export default WarsAndFronts2;
