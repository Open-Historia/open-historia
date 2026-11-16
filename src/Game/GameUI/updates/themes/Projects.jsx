/*! Open Historia — Projects That Build: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Two pages (notes.js "2026-11-projects-that-build"), told apart by the
// banner's `scene`:
//   works   a drafting sheet where a bridge is drawn span by span while coins
//           drop into the treasury and the work bar fills, past its
//           checkpoints. The funding keys (Off, Low, Normal, High) set how fast
//           the coins fall and the bar fills: the update's own rule, to play.
//   plans   a plan card being written and stamped, beside a map whose other
//           countries' sites blink as their own works go up.
// Flat shapes only (noGradients.test.js), nothing purple, every motion through
// the kit (motion / forever), still when the player asks for still.

import React, { useEffect, useState } from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { PLAN_COIN, PLAN_FACE, PLAN_FAINT, PLAN_GRID, PLAN_GROUND, PLAN_LINE, PLAN_RED, PLAN_SOFT, PLAN_YELLOW } from "./projectsChrome.js";

const FUNDING_KEYS = ["none", "low", "normal", "high"];
const FUNDING_WORDS = { none: "Off", low: "Low", normal: "Normal", high: "High" };
// How long the bar takes to fill, and how often a coin falls, at each level.
const FILL_MS = { none: 0, low: 12000, normal: 8000, high: 5400 };
const COIN_MS = { none: 0, low: 3200, normal: 1600, high: 1050 };
// How long a level is held before the next: its whole fill and a beat to see
// it finished; Off is held long enough to see nothing move.
const HOLD_MS = { none: 3600, low: 13800, normal: 9800, high: 7200 };
const WALK = ["normal", "high", "none", "low"];

const SPANS = [
  "M120 150 L120 110 L250 110 L250 150",
  "M250 110 Q 325 60 400 110",
  "M400 110 Q 475 60 550 110",
  "M550 110 L680 110 L680 150",
];
const PIERS = [[250, 110, 150], [400, 110, 150], [550, 110, 150]];
const CHECKPOINTS = [0.3, 0.6, 0.9];
// Where the treasury and the work bar stand: a phone's banner shows only the
// middle of the sheet, so there they are drawn inside it.
const LAYOUT = {
  wide: { treasury: [48, 70], bar: [120, 560] },
  narrow: { treasury: [228, 22], bar: [210, 380] },
};

const Grid = () => (
  <>
    <rect fill={PLAN_GROUND} height="220" width="800" />
    {Array.from({ length: 41 }, (_, at) => <line key={`v${at}`} stroke={PLAN_GRID} strokeWidth="1" x1={at * 20} x2={at * 20} y1="0" y2="220" />)}
    {Array.from({ length: 12 }, (_, at) => <line key={`h${at}`} stroke={PLAN_GRID} strokeWidth="1" x1="0" x2="800" y1={at * 20} y2={at * 20} />)}
  </>
);

const Works = ({ funding, narrow, still }) => {
  const fill = FILL_MS[funding];
  const coin = COIN_MS[funding];
  const { treasury: [tx, ty], bar: [barX, barWidth] } = LAYOUT[narrow ? "narrow" : "wide"];
  return (
    <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
      <Grid />
      {/* The river, and the bridge drawn span by span. */}
      <path d="M100 168 C 260 160, 540 176, 700 166" fill="none" stroke={PLAN_FAINT} strokeDasharray="4 6" strokeWidth="1.5" />
      {SPANS.map((d, at) => (
        <path
          d={d}
          fill="none"
          key={`${funding}-${d}`}
          stroke={PLAN_LINE}
          strokeLinecap="round"
          strokeWidth="3"
          style={{ "--oh-upd-length": 320, strokeDasharray: 320, strokeDashoffset: fill ? 320 : 0, ...(fill ? motion(still, "ohUpdDraw", fill / 4, 400 + (at * fill) / 4, "linear") : {}) }}
        />
      ))}
      {PIERS.map(([x, top, bottom]) => <line key={x} stroke={PLAN_SOFT} strokeWidth="2" x1={x} x2={x} y1={top} y2={bottom} />)}
      {/* The treasury, and its coins. */}
      <g style={{ transform: `translate(${tx}px, ${ty}px)` }}>
        <rect fill="none" height="54" stroke={PLAN_COIN} strokeWidth="2" width="44" x="-22" y="0" />
        <path d="M-22 14h44" stroke={PLAN_COIN} strokeWidth="1.5" />
        {coin ? Array.from({ length: 3 }, (_, at) => (
          <circle
            cx="0"
            cy="-10"
            fill={PLAN_COIN}
            key={`${funding}-${at}`}
            r="5"
            style={{ "--oh-upd-fall": "46px", ...forever(still, "ohUpdFall", coin * 1.4, (coin * at) / 1.6, "cubic-bezier(0.5, 0, 0.9, 0.6)") }}
          />
        )) : null}
      </g>
      {/* The work bar, with its checkpoints. */}
      <g style={{ transform: `translate(${barX}px, 194px)` }}>
        <rect fill={PLAN_GRID} height="10" stroke={PLAN_FAINT} strokeWidth="1" width={barWidth} x="0" y="0" />
        <rect
          fill={PLAN_YELLOW}
          height="10"
          key={funding}
          style={{ transformBox: "fill-box", transformOrigin: "left center", ...(fill ? motion(still, "ohUpdGrow", fill, 300, "linear") : { transform: "scaleX(0.04)" }) }}
          width={barWidth}
          x="0"
          y="0"
        />
        {CHECKPOINTS.map((at, index) => (
          <g key={at} style={{ transform: `translate(${at * barWidth}px, 0px)` }}>
            <line stroke={PLAN_LINE} strokeWidth="1.5" x1="0" x2="0" y1="-12" y2="10" />
            <path d="M0 -12 L12 -8 L0 -4 Z" fill={PLAN_LINE} style={fill ? motion(still, "ohUpdFade", 400, 300 + at * fill) : { opacity: 0.35 }} />
            <circle cx="0" cy="-12" fill={PLAN_LINE} r="1.6" opacity={index === 2 ? 1 : 0.8} />
          </g>
        ))}
      </g>
    </svg>
  );
};

// Other countries' sites on a map of the world's coasts, each blinking as its works go up.
const SITES = [[512, 70], [600, 112], [690, 60], [560, 160], [720, 150]];
const Plans = ({ still }) => (
  <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
    <Grid />
    {/* The plan card, written line by line and stamped. */}
    <g style={{ transform: "translate(70px, 26px) rotate(-2deg)" }}>
      <rect fill={PLAN_LINE} height="168" width="300" />
      <rect fill={PLAN_GROUND} height="10" width="160" x="18" y="18" />
      {[44, 62, 80, 98].map((y, at) => (
        <rect fill={PLAN_GROUND} height="6" key={y} opacity="0.7" style={{ transformBox: "fill-box", transformOrigin: "left center", ...motion(still, "ohUpdGrow", 420, 300 + at * 240) }} width={220 - at * 30} x="18" y={y} />
      ))}
      <rect fill="none" height="14" stroke={PLAN_GROUND} strokeWidth="1.4" width="264" x="18" y="122" />
      <rect fill={PLAN_YELLOW} height="14" style={{ transformBox: "fill-box", transformOrigin: "left center", ...motion(still, "ohUpdGrow", 1800, 1400) }} width="120" x="18" y="122" />
      {[0.3, 0.6, 0.9].map((at) => <line key={at} stroke={PLAN_GROUND} strokeWidth="1.4" x1={18 + 264 * at} x2={18 + 264 * at} y1="118" y2="140" />)}
    </g>
    {/* The coast, and the sites. */}
    <path d="M470 30 C 520 60, 500 90, 560 96 S 640 70, 700 40 L 780 30 M470 200 C 520 170, 600 196, 660 180 S 740 150, 780 170" fill="none" stroke={PLAN_SOFT} strokeWidth="1.6" />
    {SITES.map(([x, y], at) => (
      <g key={`${x}-${y}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
        <circle fill="none" r="10" stroke={PLAN_YELLOW} strokeWidth="1.6" style={forever(still, "ohUpdRing", 2600, at * 520)} />
        <rect fill={at % 2 ? PLAN_RED : PLAN_YELLOW} height="7" width="7" x="-3.5" y="-3.5" />
      </g>
    ))}
  </svg>
);

const Stamp = ({ still, narrow }) => (
  <div aria-hidden="true" style={{ left: narrow ? "40%" : "34%", pointerEvents: "none", position: "absolute", top: "58%", transform: "translate(-50%, -50%)" }}>
    <div style={{
      border: `2.5px solid ${PLAN_RED}`,
      borderRadius: "2px",
      color: PLAN_RED,
      fontFamily: PLAN_FACE,
      fontSize: narrow ? "0.78rem" : "0.95rem",
      fontWeight: 800,
      letterSpacing: "0.14em",
      padding: "0.2rem 0.7rem",
      textTransform: "uppercase",
      transform: "rotate(-8deg)",
      whiteSpace: "nowrap",
      ...motion(still, "ohUpdStamp", 520, 2600),
    }}
    >
      Start
    </div>
  </div>
);

const FundingKeys = ({ value, onPick, narrow }) => (
  <div role="group" style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", justifyContent: "flex-end", position: "absolute", right: narrow ? "0.6rem" : "1.1rem", top: narrow ? "0.6rem" : "1.1rem" }}>
    {FUNDING_KEYS.map((key) => {
      const on = key === value;
      return (
        <button
          aria-label={FUNDING_WORDS[key]}
          aria-pressed={on}
          className="oh-tap"
          key={key}
          onClick={() => onPick(key)}
          style={{
            background: on ? PLAN_YELLOW : "rgba(17,24,28,0.86)",
            border: `1px solid ${on ? PLAN_YELLOW : PLAN_FAINT}`,
            borderRadius: "2px",
            color: on ? "#15130c" : PLAN_LINE,
            cursor: "pointer",
            fontFamily: PLAN_FACE,
            fontSize: narrow ? "0.66rem" : "0.74rem",
            fontWeight: 800,
            letterSpacing: "0.08em",
            minHeight: "2rem",
            padding: narrow ? "0 0.55rem" : "0 0.8rem",
            textTransform: "uppercase",
            touchAction: "manipulation",
          }}
          type="button"
        >
          {FUNDING_WORDS[key]}
        </button>
      );
    })}
  </div>
);

// The funding keys walk through the levels by themselves, each held until its
// bar is full, until one is pressed.
const useFunding = (still) => {
  const [value, setValue] = useState("normal");
  const [chosen, setChosen] = useState(false);
  useEffect(() => {
    if (still || chosen) return undefined;
    const timer = setTimeout(() => setValue(WALK[(WALK.indexOf(value) + 1) % WALK.length]), HOLD_MS[value]);
    return () => clearTimeout(timer);
  }, [still, chosen, value]);
  return [value, (key) => { setChosen(true); setValue(key); }];
};

const Projects = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const plans = banner.scene === "plans";
  const [funding, pickFunding] = useFunding(still);
  return (
    <Plate surface={{ background: PLAN_GROUND, border: `1px solid ${PLAN_FAINT}`, borderRadius: "2px" }}>
      <Brackets colour={PLAN_YELLOW} inset="0.7rem" length="1.5rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `3px solid ${PLAN_YELLOW}`, height: narrow ? "12rem" : "clamp(13rem, 27vw, 17rem)", overflow: "hidden", position: "relative" }}>
        {plans ? <Plans still={still} /> : <Works funding={funding} narrow={narrow} still={still} />}
        {plans ? <Stamp narrow={narrow} still={still} /> : <FundingKeys narrow={narrow} onPick={pickFunding} value={funding} />}
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: PLAN_YELLOW, fontFamily: PLAN_FACE, fontSize: "0.76rem", fontWeight: 800, letterSpacing: "0.22em", textTransform: "uppercase" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: PLAN_LINE, fontFamily: PLAN_FACE, fontSize: narrow ? "1.9rem" : "clamp(2.1rem, 5.5vw, 3rem)", fontWeight: 800, letterSpacing: "0.02em", lineHeight: 1.05, marginTop: "0.25rem" }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: PLAN_YELLOW, fontFamily: PLAN_FACE, fontSize: "0.98rem", marginTop: "0.3rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: PLAN_SOFT, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={PLAN_LINE}>
          <span style={{ color: PLAN_YELLOW, display: "inline-flex" }}>{ICONS.wall(18)}</span>
        </Rule>
        <FeatureCards
          accent={PLAN_YELLOW}
          card={{ background: "rgba(214,226,230,0.04)", border: `1px solid ${PLAN_FAINT}`, borderRadius: "2px" }}
          delay={520}
          font={PLAN_FACE}
          sections={banner.sections ?? []}
          soft={PLAN_SOFT}
        />
      </div>
    </Plate>
  );
};

export default Projects;
