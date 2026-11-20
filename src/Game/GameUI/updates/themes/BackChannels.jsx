/*! Open Historia — Back Channels: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so you can have diplomacy with them like cartels and shit" (the
// owner, 2026-11-19).
//
// A back room at night: concrete, one lamp swinging over a table, a dossier.
// One picture a banner (notes.js `scene`):
//   talk    the lamp, the table under it, and two lines of talk crossing it:
//           a government's seal on one side, a group's banner on the other,
//           each answering in turn while the other is seen typing
//   deals   a dossier on the table, and the deals stamped onto it one by one
//   map     a chart of the land with the groups' areas on it, each outlined
//           and tinted in its standing with the focus country, the
//           diplomatic map's own colours (runtime/diplomaticPalette.js)
// With Reduce motion the lamp hangs still and everything stands drawn.
//
// Flat shapes only: nothing is a gradient, nothing purple.

import React from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import {
  BACK_FACE,
  BACK_INK,
  BACK_LAMP,
  BACK_PAPER,
  BACK_PAPER_SOFT,
  BACK_ROOM,
  BACK_RULE,
  BACK_STAMP,
  BACK_WALL,
} from "./backChannelsChrome.js";
import { DIPLO_UNKNOWN, RELATION_COLORS } from "../../../../runtime/diplomaticPalette.js";

// The lamp over the table, swinging from its cord.
const Lamp = ({ still, x = 400 }) => (
  <g transform={`translate(${x} 0)`}>
    <g style={{ transformOrigin: "0px 0px", ...forever(still, "ohUpdSway", 5200, 0, "cubic-bezier(0.45, 0, 0.55, 1)") }}>
      <line stroke={BACK_INK} strokeWidth="2" x1="0" x2="0" y1="0" y2="54" />
      <polygon fill={BACK_INK} points="-26,78 26,78 12,54 -12,54" />
      <circle cx="0" cy="80" fill={BACK_LAMP} r="7" style={forever(still, "ohUpdPulse", 3100, 300, "cubic-bezier(0.4, 0, 0.6, 1)")} />
    </g>
  </g>
);

// A speech bubble with the lines of what is said, drawn as bars.
const Bubble = ({ x, y, width, flip = false, colour, delay, still, lines = 3 }) => (
  <g style={motion(still, "ohUpdFade", 600, delay)}>
    <rect fill={BACK_PAPER} height={lines * 12 + 16} rx="6" width={width} x={x} y={y} />
    <polygon fill={BACK_PAPER} points={flip ? `${x + width - 22},${y + lines * 12 + 16} ${x + width - 6},${y + lines * 12 + 30} ${x + width - 38},${y + lines * 12 + 16}` : `${x + 22},${y + lines * 12 + 16} ${x + 6},${y + lines * 12 + 30} ${x + 38},${y + lines * 12 + 16}`} />
    {Array.from({ length: lines }, (_, at) => (
      <rect fill={colour} height="5" key={at} opacity="0.75" rx="2" width={width - 28 - (at === lines - 1 ? 34 : (at * 13) % 26)} x={x + 14} y={y + 12 + at * 12} />
    ))}
  </g>
);

// Someone typing: three dots, one after another.
const Typing = ({ x, y, still, delay = 0 }) => (
  <g style={motion(still, "ohUpdFade", 400, delay)}>
    <rect fill={BACK_WALL} height="20" rx="10" stroke={BACK_RULE} width="46" x={x} y={y} />
    {[0, 1, 2].map((at) => <circle cx={x + 12 + at * 11} cy={y + 10} fill={BACK_PAPER_SOFT} key={at} r="3" style={forever(still, "ohUpdTwinkle", 1200, at * 200)} />)}
  </g>
);

// A government's seal, and a group's banner (its colour, a dark band across it).
const Seal = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`}>
    <circle fill={BACK_INK} r="21" stroke={BACK_LAMP} strokeWidth="2" />
    <path d="M0 -11 L3.2 -3.5 L11 -3.3 L4.8 1.6 L7 9.3 L0 4.8 L-7 9.3 L-4.8 1.6 L-11 -3.3 L-3.2 -3.5 Z" fill={BACK_LAMP} />
  </g>
);
const Banner = ({ x, y, colour }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect fill={colour} height="28" width="42" x="-21" y="-14" />
    <polygon fill={BACK_INK} opacity="0.55" points="-21,7 21,-7 21,0 -21,14" />
    <rect fill="none" height="28" stroke={BACK_INK} strokeWidth="1.5" width="42" x="-21" y="-14" />
  </g>
);

const TalkScene = ({ still }) => (
  <>
    <rect fill={BACK_WALL} height="240" width="800" />
    {/* The wall's courses of concrete. */}
    {Array.from({ length: 6 }, (_, at) => <line key={at} stroke={BACK_RULE} strokeWidth="1" x1="0" x2="800" y1={at * 34 + 20} y2={at * 34 + 20} />)}
    {/* The pool of the lamp's light on the table. */}
    {/* (The pulse animates the ellipse's own opacity, so the faintness is the group's.) */}
    <g opacity="0.16">
      <ellipse cx="400" cy="206" fill={BACK_LAMP} rx="250" ry="34" style={forever(still, "ohUpdPulse", 3100, 300, "cubic-bezier(0.4, 0, 0.6, 1)")} />
    </g>
    <polygon fill={BACK_INK} points="130,240 670,240 610,196 190,196" />
    <rect fill={BACK_PAPER} height="22" opacity="0.85" transform="rotate(-4 400 206)" width="90" x="355" y="198" />
    <line stroke={BACK_STAMP} strokeDasharray="5 4" strokeWidth="2" x1="368" x2="430" y1="206" y2="212" />
    <Lamp still={still} />
    <Seal x={96} y={70} />
    <Bubble colour={BACK_INK} delay={500} still={still} width={190} x={128} y={40} />
    <Banner colour="#e11d48" x={704} y={112} />
    <Bubble colour={BACK_STAMP} delay={1500} flip still={still} width={210} x={462} y={84} lines={2} />
    <Typing delay={2300} still={still} x={150} y={128} />
  </>
);

// The deals stamped onto the dossier, each a stamp of its own colour and mark.
const STAMPS = [
  { x: 470, y: 46, tilt: -8, colour: RELATION_COLORS.nonAggression, mark: "M-10 0 L10 0 M0 -10 L0 10" },
  { x: 600, y: 70, tilt: 6, colour: BACK_LAMP, mark: "M-9 -7 A9 9 0 1 0 -9 7 M-12 -2 L4 -2 M-12 3 L4 3" },
  { x: 520, y: 150, tilt: -4, colour: RELATION_COLORS.friendly, mark: "M-10 6 L0 -9 L10 6 Z" },
  { x: 660, y: 168, tilt: 9, colour: BACK_STAMP, mark: "M-10 -10 L10 10 M10 -10 L-10 10" },
];

const DealsScene = ({ still }) => (
  <>
    <rect fill={BACK_ROOM} height="240" width="800" />
    <ellipse cx="560" cy="120" fill={BACK_LAMP} opacity="0.09" rx="300" ry="120" />
    {/* The dossier, a sheet of typed lines. */}
    <g style={motion(still, "ohUpdFade", 700, 200)}>
      <rect fill={BACK_PAPER} height="214" transform="rotate(-2 560 120)" width="320" x="400" y="13" />
      {Array.from({ length: 11 }, (_, at) => (
        <rect fill={BACK_INK} height="4" key={at} opacity="0.28" transform="rotate(-2 560 120)" width={at % 3 === 2 ? 170 : 260} x="428" y={34 + at * 17} />
      ))}
      <rect fill={BACK_INK} height="12" opacity="0.8" transform="rotate(-2 560 120)" width="120" x="560" y="20" />
    </g>
    {STAMPS.map((stamp, at) => (
      <g key={at} transform={`translate(${stamp.x} ${stamp.y})`}>
        <g style={{ transformOrigin: "0px 0px", ...motion(still, "ohUpdStamp", 520, 800 + at * 520) }}>
          <rect fill="none" height="44" rx="4" stroke={stamp.colour} strokeWidth="3" transform={`rotate(${stamp.tilt})`} width="70" x="-35" y="-22" />
          <rect fill={stamp.colour} height="44" opacity="0.14" rx="4" transform={`rotate(${stamp.tilt})`} width="70" x="-35" y="-22" />
          <path d={stamp.mark} fill="none" stroke={stamp.colour} strokeLinecap="round" strokeWidth="3" transform={`rotate(${stamp.tilt})`} />
        </g>
      </g>
    ))}
    {/* The pen that signed them, rolling to a stop. */}
    <g style={motion(still, "ohUpdFade", 600, 2900)}>
      <rect fill={BACK_INK} height="8" rx="4" transform="rotate(24 300 170)" width="150" x="225" y="166" />
      <rect fill={BACK_LAMP} height="8" transform="rotate(24 300 170)" width="18" x="345" y="166" />
    </g>
    <Lamp still={still} x={160} />
  </>
);

// The chart: countries, and on them the groups' areas by their standing with the focus.
const LAND = {
  a: "40,40 230,28 260,110 180,150 60,130",
  b: "230,28 430,36 450,120 260,110",
  c: "260,110 450,120 470,200 280,220 180,150",
  d: "60,130 180,150 280,220 230,236 40,226",
  e: "430,36 640,30 660,130 450,120",
  f: "450,120 660,130 690,214 470,200",
  g: "640,30 770,46 776,170 660,130",
  h: "660,130 776,170 760,230 690,214",
};
const LAND_FILL = { a: RELATION_COLORS.trade, b: RELATION_COLORS.cordial, c: RELATION_COLORS.self, d: RELATION_COLORS.neutral, e: RELATION_COLORS.strained, f: DIPLO_UNKNOWN, g: RELATION_COLORS.alliance, h: DIPLO_UNKNOWN };
const AREAS = [
  { points: "300,150 380,138 420,178 350,206 292,190", colour: RELATION_COLORS.crackdown, delay: 900 },
  { points: "150,60 214,54 228,98 170,112 138,90", colour: RELATION_COLORS.nonAggression, delay: 1300 },
  { points: "520,60 600,58 618,104 540,112", colour: RELATION_COLORS.friendly, delay: 1700 },
];

const MapScene = ({ still }) => (
  <>
    <rect fill="#16222c" height="240" width="800" />
    {Object.entries(LAND).map(([id, points], at) => (
      <polygon fill={LAND_FILL[id]} key={id} opacity="0.9" points={points} stroke={BACK_INK} strokeLinejoin="round" strokeWidth="2.2" style={motion(still, "ohUpdFade", 700, 150 + at * 70)} />
    ))}
    {AREAS.map((area) => (
      <g key={area.points}>
        <polygon fill={area.colour} fillOpacity="0.55" points={area.points} style={motion(still, "ohUpdFade", 700, area.delay)} />
        <polygon fill="none" points={area.points} stroke={area.colour} strokeDasharray="420" strokeLinejoin="round" strokeWidth="3.2" style={{ "--oh-upd-length": 420, ...motion(still, "ohUpdDraw", 1500, area.delay) }} />
        <polygon fill="none" points={area.points} stroke={BACK_PAPER} strokeLinejoin="round" strokeOpacity="0.5" strokeWidth="1" style={forever(still, "ohUpdPulse", 2600, area.delay)} />
      </g>
    ))}
    {/* The legend's groups, apart from the countries. */}
    <g transform="translate(18 150)">
      <g style={motion(still, "ohUpdFade", 700, 2100)}>
        <rect fill={BACK_INK} height="72" opacity="0.92" rx="3" stroke={BACK_LAMP} strokeOpacity="0.6" width="74" />
        <rect fill={BACK_LAMP} height="3" opacity="0.8" width="34" x="8" y="9" />
        {AREAS.map((area, at) => (
          <g key={area.colour} transform={`translate(8 ${20 + at * 16})`}>
            <rect fill={area.colour} fillOpacity="0.5" height="10" stroke={area.colour} strokeWidth="2" width="10" />
            <rect fill={BACK_PAPER_SOFT} height="2" opacity="0.5" width="40" x="16" y="4" />
          </g>
        ))}
      </g>
    </g>
  </>
);

const SCENES = { talk: TalkScene, deals: DealsScene, map: MapScene };

const BackChannels = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const Scene = SCENES[banner.scene] ?? TalkScene;
  return (
    <Plate surface={{ background: BACK_ROOM, border: `1px solid ${BACK_RULE}`, borderRadius: "2px" }}>
      <Brackets colour={BACK_LAMP} inset="0.7rem" length="1.6rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `2px solid ${BACK_LAMP}`, height: narrow ? "10.5rem" : "clamp(12rem, 25vw, 16rem)", overflow: "hidden", position: "relative" }}>
        <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 240">
          <Scene still={still} />
        </svg>
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: BACK_LAMP, fontFamily: BACK_FACE, fontSize: "0.8rem", letterSpacing: "0.22em", textTransform: "uppercase" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: BACK_PAPER, fontFamily: BACK_FACE, fontSize: narrow ? "1.9rem" : "clamp(2.1rem, 5.2vw, 3rem)", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.05, marginTop: "0.25rem", ...motion(still, "ohUpdFade", 500, 380) }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: BACK_LAMP, fontFamily: BACK_FACE, fontSize: "1rem", marginTop: "0.35rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: BACK_PAPER_SOFT, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={BACK_LAMP}>
          <span style={{ color: BACK_LAMP, display: "inline-flex" }}>{ICONS.people(18)}</span>
        </Rule>
        <FeatureCards
          accent={BACK_LAMP}
          card={{ background: "rgba(235,229,214,0.04)", border: `1px solid ${BACK_RULE}`, borderRadius: "2px" }}
          delay={520}
          font={BACK_FACE}
          sections={banner.sections ?? []}
          soft={BACK_PAPER_SOFT}
        />
      </div>
    </Plate>
  );
};

export default BackChannels;
