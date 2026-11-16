/*! Open Historia — the Diplomatic Atlas: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "the diplomatic map is shit, redesign it and make it have full integration
// with the political world" (the owner, 2026-11-15).
//
// A chart room's atlas: a dark sea, a graticule, eleven made-up countries, and
// on them the diplomatic map's own colours (runtime/diplomaticPalette.js), one
// view a banner (notes.js `scene`):
//   relations   the focus country in ivory, its capital's lines drawing out to
//               its allies, dashed to its enemies; a ceasefire hatched
//   wars        two wars, each side its colour, the fronts lit and pulsing
//   blocs       an institution's members tinted, its outline drawing itself
//               round them, a candidate hatched
//   government  governments by kind, a puppet in its overlord's shade, hatched
// A small legend card counts what is shown. With Reduce motion the lines stand
// drawn and nothing pulses.
//
// Flat shapes only: nothing is a gradient, nothing purple.

import React from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import {
  ATLAS_BRASS,
  ATLAS_FACE,
  ATLAS_INK,
  ATLAS_IVORY,
  ATLAS_IVORY_SOFT,
  ATLAS_RULE,
  ATLAS_SEA,
} from "./diplomaticAtlasChrome.js";
import {
  BLOC_COLORS,
  DIPLO_UNKNOWN,
  LINE_COLORS,
  REGIME_COLORS,
  RELATION_COLORS,
  WAR_SIDE_COLORS,
  puppetShade,
} from "../../../../runtime/diplomaticPalette.js";

// The countries, as a rough tessellation of the chart.
const LAND = {
  a: "60,46 190,32 230,90 170,140 82,122",
  b: "190,32 330,40 350,100 230,90",
  c: "230,90 350,100 360,170 250,190 170,140",
  d: "82,122 170,140 250,190 205,228 70,214",
  e: "330,40 470,30 500,110 350,100",
  f: "350,100 500,110 520,180 360,170",
  g: "250,190 360,170 520,180 548,226 205,228",
  h: "470,30 620,40 640,120 500,110",
  i: "500,110 640,120 662,200 520,180",
  j: "620,40 752,52 760,150 640,120",
  k: "640,120 760,150 742,214 662,200",
};
const MIDDLE = { a: [146, 86], b: [272, 66], c: [276, 140], d: [158, 186], e: [412, 72], f: [432, 140], g: [380, 204], h: [560, 74], i: [584, 154], j: [700, 96], k: [708, 176] };

const SCENES = {
  relations: {
    fill: { a: RELATION_COLORS.trade, b: RELATION_COLORS.alliance, c: RELATION_COLORS.self, d: RELATION_COLORS.guarantee, e: RELATION_COLORS.hostile, f: RELATION_COLORS.alliance, g: RELATION_COLORS.unknown, h: RELATION_COLORS.war, i: RELATION_COLORS.war, j: RELATION_COLORS.ceasefire, k: RELATION_COLORS.unknown },
    hatch: ["j"],
    lines: [["b", "ally"], ["f", "ally"], ["d", "ally"], ["h", "war"], ["i", "war"], ["j", "ceasefire"]],
    from: "c",
    legend: [[RELATION_COLORS.self, "1"], [RELATION_COLORS.alliance, "2"], [RELATION_COLORS.war, "2"], [RELATION_COLORS.ceasefire, "1", true], [RELATION_COLORS.unknown, "2"]],
  },
  wars: {
    fill: { a: WAR_SIDE_COLORS[0][0], b: WAR_SIDE_COLORS[0][0], c: WAR_SIDE_COLORS[0][1], d: DIPLO_UNKNOWN, e: DIPLO_UNKNOWN, f: WAR_SIDE_COLORS[0][1], g: DIPLO_UNKNOWN, h: WAR_SIDE_COLORS[1][0], i: WAR_SIDE_COLORS[1][1], j: WAR_SIDE_COLORS[1][1], k: DIPLO_UNKNOWN },
    hatch: ["h", "i", "j"],
    fronts: ["230,90 350,100", "230,90 170,140", "330,40 350,100", "500,110 640,120", "620,40 640,120"],
    legend: [[WAR_SIDE_COLORS[0][0], "2"], [WAR_SIDE_COLORS[0][1], "2"], [WAR_SIDE_COLORS[1][0], "1", true], [WAR_SIDE_COLORS[1][1], "2", true], [DIPLO_UNKNOWN, "4"]],
  },
  blocs: {
    fill: { a: BLOC_COLORS.member, b: BLOC_COLORS.member, c: BLOC_COLORS.member, d: BLOC_COLORS.member, e: BLOC_COLORS.associate, f: BLOC_COLORS.candidate, g: BLOC_COLORS.observer, h: DIPLO_UNKNOWN, i: DIPLO_UNKNOWN, j: BLOC_COLORS.suspended, k: DIPLO_UNKNOWN },
    hatch: ["f", "j"],
    outline: "60,46 190,32 330,40 470,30 500,110 350,100 360,170 250,190 205,228 70,214 82,122 Z",
    legend: [[BLOC_COLORS.member, "4"], [BLOC_COLORS.associate, "1"], [BLOC_COLORS.candidate, "1", true], [BLOC_COLORS.observer, "1"], [DIPLO_UNKNOWN, "3"]],
  },
  government: {
    fill: { a: REGIME_COLORS.democratic, b: REGIME_COLORS.democratic, c: REGIME_COLORS.hybrid, d: puppetShade(REGIME_COLORS.democratic), e: REGIME_COLORS.authoritarian, f: REGIME_COLORS.authoritarian, g: REGIME_COLORS.military, h: REGIME_COLORS.totalitarian, i: puppetShade(REGIME_COLORS.totalitarian), j: REGIME_COLORS.theocratic, k: REGIME_COLORS.democratic },
    hatch: ["d", "i"],
    legend: [[REGIME_COLORS.democratic, "4"], [REGIME_COLORS.hybrid, "1"], [REGIME_COLORS.authoritarian, "2"], [REGIME_COLORS.totalitarian, "2"], [REGIME_COLORS.military, "1"]],
  },
};

// A curve from one capital to another, bowed like a great circle on a flat chart.
const arc = ([x1, y1], [x2, y2]) => {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.22;
  return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`;
};

const Chart = ({ scene, still }) => {
  const shown = SCENES[scene] ?? SCENES.relations;
  return (
    <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 240">
      <defs>
        <pattern height="8" id={`oh-atlas-hatch-${scene}`} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="8">
          <rect fill={ATLAS_IVORY} height="8" opacity="0.8" width="2" />
        </pattern>
      </defs>
      <rect fill={ATLAS_SEA} height="240" width="800" />
      {/* The graticule. */}
      {Array.from({ length: 9 }, (_, at) => <line key={`m${at}`} stroke={ATLAS_RULE} strokeWidth="0.6" x1={at * 100} x2={at * 100} y1="0" y2="240" />)}
      {Array.from({ length: 4 }, (_, at) => <line key={`p${at}`} stroke={ATLAS_RULE} strokeWidth="0.6" x1="0" x2="800" y1={at * 60 + 30} y2={at * 60 + 30} />)}
      {/* The countries, in the view's colours, each settling in turn. */}
      {Object.entries(LAND).map(([id, points], at) => (
        <g key={id} style={motion(still, "ohUpdFade", 700, 200 + at * 70)}>
          <polygon fill={shown.fill[id]} opacity="0.92" points={points} stroke={ATLAS_INK} strokeLinejoin="round" strokeWidth="2.2" />
          {shown.hatch?.includes(id) && <polygon fill={`url(#oh-atlas-hatch-${scene})`} opacity="0.65" points={points} />}
        </g>
      ))}
      {/* Relations: the focus's border, and its lines drawing out from its capital. */}
      {shown.from && (
        <>
          <polygon fill="none" points={LAND[shown.from]} stroke={ATLAS_IVORY} strokeWidth="2.4" style={forever(still, "ohUpdPulse", 2400, 0, "cubic-bezier(0.4, 0, 0.6, 1)")} />
          {shown.lines.map(([to, kind], at) => (
            <path
              d={arc(MIDDLE[shown.from], MIDDLE[to])}
              fill="none"
              key={to}
              stroke={LINE_COLORS[kind]}
              strokeDasharray={kind === "ally" ? "400" : kind === "war" ? "9 6" : "2 6"}
              strokeLinecap="round"
              strokeWidth="2.2"
              style={kind === "ally" ? { "--oh-upd-length": 400, strokeDashoffset: still ? 0 : undefined, ...motion(still, "ohUpdDraw", 1400, 700 + at * 220) } : motion(still, "ohUpdFade", 900, 700 + at * 220)}
            />
          ))}
          <g transform={`translate(${MIDDLE[shown.from][0]} ${MIDDLE[shown.from][1]})`}>
            <circle fill={ATLAS_IVORY} r="6" stroke={ATLAS_INK} strokeWidth="2" />
            <circle fill="none" r="9" stroke={ATLAS_IVORY} strokeWidth="1.6" style={forever(still, "ohUpdRing", 2200, 400, "cubic-bezier(0.2, 0.7, 0.2, 1)")} />
          </g>
        </>
      )}
      {/* Wars: the fronts, lit. */}
      {shown.fronts?.map((points, at) => (
        <polyline fill="none" key={points} points={points} stroke={LINE_COLORS.war} strokeLinecap="round" strokeWidth="4" style={forever(still, "ohUpdPulse", 1600, at * 260, "cubic-bezier(0.4, 0, 0.6, 1)")} />
      ))}
      {/* Blocs: the outline round the members, drawing itself. */}
      {shown.outline && (
        <path
          d={`M${shown.outline.replace(/ Z$/, "").split(" ").join(" L")} Z`}
          fill="none"
          stroke={ATLAS_IVORY}
          strokeDasharray="1600"
          strokeLinejoin="round"
          strokeWidth="3"
          style={{ "--oh-upd-length": 1600, ...motion(still, "ohUpdDraw", 2600, 600, "cubic-bezier(0.45, 0, 0.3, 1)") }}
        />
      )}
      {/* The legend card, counting what the view shows (placed by the attribute: the rise animates the style's transform). */}
      <g transform="translate(18 128)">
      <g style={motion(still, "ohUpdFade", 700, 900)}>
        <rect fill={ATLAS_INK} height={shown.legend.length * 15 + 12} opacity="0.92" rx="5" stroke={ATLAS_BRASS} strokeOpacity="0.6" width="58" y={-shown.legend.length * 15 + 66} />
        {shown.legend.map(([color, count, hatched], at) => (
          <g key={`${color}${at}`} transform={`translate(8 ${72 - (shown.legend.length - at) * 15})`}>
            <rect fill={color} height="10" rx="2" width="10" />
            {hatched && <rect fill={`url(#oh-atlas-hatch-${scene})`} height="10" rx="2" width="10" />}
            <text fill={ATLAS_IVORY_SOFT} fontFamily={ATLAS_FACE} fontSize="9" x="18" y="9">{count}</text>
            <rect fill={ATLAS_IVORY_SOFT} height="2" opacity="0.5" width="16" x="28" y="5" />
          </g>
        ))}
      </g>
      </g>
    </svg>
  );
};

const DiplomaticAtlas = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  return (
    <Plate surface={{ background: ATLAS_INK, border: `1px solid ${ATLAS_RULE}`, borderRadius: "4px" }}>
      <Brackets colour={ATLAS_BRASS} inset="0.7rem" length="1.7rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `2px solid ${ATLAS_BRASS}`, height: narrow ? "10.5rem" : "clamp(12rem, 25vw, 16rem)", overflow: "hidden", position: "relative" }}>
        <Chart scene={banner.scene} still={still} />
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: ATLAS_BRASS, fontFamily: ATLAS_FACE, fontSize: "0.8rem", letterSpacing: "0.22em", textTransform: "uppercase" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: ATLAS_IVORY, fontFamily: ATLAS_FACE, fontSize: narrow ? "2rem" : "clamp(2.2rem, 5.5vw, 3.2rem)", fontWeight: 700, letterSpacing: "0.01em", lineHeight: 1.05, marginTop: "0.2rem", ...motion(still, "ohUpdFade", 500, 380) }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: ATLAS_BRASS, fontFamily: ATLAS_FACE, fontSize: "1.1rem", fontStyle: "italic", marginTop: "0.3rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: ATLAS_IVORY_SOFT, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={ATLAS_BRASS}>
          <span style={{ color: ATLAS_BRASS, display: "inline-flex" }}>{ICONS.map(18)}</span>
        </Rule>
        <FeatureCards
          accent={ATLAS_BRASS}
          card={{ background: "rgba(246,241,227,0.04)", border: `1px solid ${ATLAS_RULE}`, borderRadius: "3px" }}
          delay={520}
          font={ATLAS_FACE}
          sections={banner.sections ?? []}
          soft={ATLAS_IVORY_SOFT}
        />
      </div>
    </Plate>
  );
};

export default DiplomaticAtlas;
