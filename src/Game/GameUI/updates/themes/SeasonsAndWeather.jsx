/*! Open Historia — Seasons and Weather: its banner behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "have the weather update have its own custom major update post rather than
// being on the main wars and fronts post" (the owner, 2026-10-16).
//
// An almanac's look: a night-blue page, frost-white lines, a book face, and
// across the top a landscape that lives through the year. Mountains, a lake
// and a wood under a sky that turns from winter to spring, summer and autumn,
// a season every few seconds: winter snows, the peaks whiten and the lake
// freezes, its cracks drawn across the ice; spring rains under heavy clouds
// and the trees blossom; summer's sun stands high and the heat shimmers off
// the ground; autumn's leaves fall through a drifting fog. The four seasons
// are keys: touched, the year stops on that one. With Reduce motion nothing
// moves or turns by itself, and a key still picks the season, drawn as it
// stands.
//
// Flat shapes only: nothing is a gradient, nothing purple.

import React, { useEffect, useState } from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { SEASONS_FROST, SEASONS_FROST_SOFT, SEASONS_INK, SEASONS_SERIF, SEASONS_SUN } from "./seasonsChrome.js";

// How long the year stays on a season before it turns, and how long the turn takes.
const SEASON_MS = 5200;
const TURN_MS = 1400;

// Each season's colours, and where its sun stands (in the 800 by 220 picture).
const SEASONS = [
  { key: "winter", label: "Winter", icon: "snow", sky: "#1f2c38", far: "#45525e", peaks: 1, near: "#34404a", ground: "#c9d8e1", lake: "#9fc3d6", crown: "#56636b", crowned: 0, sun: { x: 640, y: 96, r: 20, fill: "#e6edf1" } },
  { key: "spring", label: "Spring", icon: "rain", sky: "#29404f", far: "#41545f", peaks: 0.45, near: "#33503c", ground: "#4f7a45", lake: "#2c5c76", crown: "#86b86b", crowned: 1, sun: { x: 600, y: 64, r: 22, fill: "#f3d27a" } },
  { key: "summer", label: "Summer", icon: "sun", sky: "#2c5874", far: "#4a5e66", peaks: 0.12, near: "#36552f", ground: "#62843b", lake: "#286d8e", crown: "#3f7a3a", crowned: 1, sun: { x: 560, y: 40, r: 28, fill: SEASONS_SUN } },
  { key: "autumn", label: "Autumn", icon: "leaf", sky: "#37352f", far: "#4c4a43", peaks: 0.35, near: "#57452f", ground: "#7b5b33", lake: "#34576a", crown: "#c8663a", crowned: 1, sun: { x: 660, y: 82, r: 24, fill: "#e59a4a" } },
];

// Colours that turn with the year, and shapes that move to their season's place.
const turning = (still) => (still ? {} : { transition: `fill ${TURN_MS}ms ease, opacity ${TURN_MS}ms ease, transform ${TURN_MS}ms cubic-bezier(0.45, 0, 0.2, 1)` });
// A layer seen only in its season.
const only = (on, still) => ({ opacity: on ? 1 : 0, ...turning(still) });
// Something that falls through the picture, or stands where it is caught when still.
const falling = (still, at, span, duration, rest) => (still
  ? { transform: `translateY(${rest}px)` }
  : { "--oh-upd-fall": `${span}px`, ...forever(still, "ohUpdFall", duration, (at * 211) % duration) });

const TREES = [
  { x: 470, s: 1, pine: false }, { x: 505, s: 0.8, pine: true }, { x: 540, s: 1.15, pine: false }, { x: 580, s: 0.9, pine: true },
  { x: 615, s: 1.05, pine: false }, { x: 655, s: 0.85, pine: false }, { x: 690, s: 1.1, pine: true }, { x: 730, s: 0.95, pine: false },
  { x: 768, s: 1.2, pine: false },
];

const Landscape = ({ season, still }) => {
  const look = SEASONS[season];
  const is = (key) => look.key === key;
  return (
    <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
      <rect fill={look.sky} height="220" style={turning(still)} width="800" />
      {/* The sun, where its season holds it. */}
      <g style={{ transform: `translate(${look.sun.x}px, ${look.sun.y}px)`, ...turning(still) }}>
        <circle cx="0" cy="0" fill={look.sun.fill} r={look.sun.r} style={{ ...turning(still), ...(is("summer") ? forever(still, "ohUpdPulse", 2600, 0, "cubic-bezier(0.4, 0, 0.6, 1)") : null) }} />
      </g>
      {/* Clouds, heavier in the wet seasons. */}
      {[[0, 26, 150, 22000], [1, 54, 110, 30000], [2, 14, 190, 26000]].map(([at, y, width, pace]) => (
        <g key={at} style={{ "--oh-upd-from": "-260px", "--oh-upd-to": "860px", ...forever(still, "ohUpdDrift", pace, -pace * (0.2 + at * 0.3)) }}>
          <g style={{ opacity: is("summer") ? 0.35 : is("spring") ? 0.95 : 0.75, ...turning(still) }}>
            <rect fill={is("spring") ? "#5d6d78" : "#6d7a84"} height="20" rx="10" style={turning(still)} width={width} x="0" y={y} />
            <rect fill={is("spring") ? "#5d6d78" : "#6d7a84"} height="16" rx="8" style={turning(still)} width={width * 0.55} x={width * 0.2} y={y - 10} />
          </g>
        </g>
      ))}
      {/* The mountains, and the snow on them. */}
      <path d="M0 150 L70 84 L118 118 L182 52 L248 128 L310 92 L372 150 Z" fill={look.far} style={turning(still)} />
      <path d="M182 52 L204 78 L190 74 L178 84 L166 74 Z M70 84 L84 100 L66 96 Z M310 92 L324 106 L306 104 Z" fill={SEASONS_FROST} style={{ opacity: look.peaks, ...turning(still) }} />
      <path d="M300 160 L380 106 L440 140 L520 98 L600 150 L700 112 L800 150 L800 220 L300 220 Z" fill={look.near} style={turning(still)} />
      <rect fill={look.ground} height="56" style={turning(still)} width="800" y="164" />
      {/* The lake: water, or ice with its cracks. */}
      <ellipse cx="190" cy="188" fill={look.lake} rx="150" ry="20" style={turning(still)} />
      <g style={only(!is("winter"), still)}>
        {[0, 1, 2].map((at) => <path d={`M${110 + at * 55} ${184 + (at % 2) * 8} q12 -4 24 0`} fill="none" key={at} stroke="#9cc6da" strokeWidth="1.2" style={forever(still, "ohUpdPulse", 2200, at * 500, "cubic-bezier(0.4, 0, 0.6, 1)")} />)}
      </g>
      <g key={is("winter") ? "ice" : "water"} style={only(is("winter"), still)}>
        {["M80 186 l34 -5 22 8 30 -9 24 6", "M170 196 l26 -6 34 7 28 -8", "M120 194 l18 -3 14 6", "M250 184 l22 4 18 -6"].map((d, at) => (
          <path d={d} fill="none" key={at} stroke="#f2f8fb" strokeLinecap="round" strokeWidth="1.3" style={is("winter") && !still ? { strokeDasharray: 160, "--oh-upd-length": 160, ...motion(still, "ohUpdDraw", 1500, 500 + at * 260, "cubic-bezier(0.45, 0, 0.2, 1)") } : null} />
        ))}
      </g>
      {/* The wood: pines always green, the others leafed by the season, bare in winter, in blossom in spring. */}
      {TREES.map((tree) => (
        <g key={tree.x} style={{ transform: `translate(${tree.x}px, 170px) scale(${tree.s})`, transformBox: "view-box", transformOrigin: "0 0" }}>
          <rect fill="#4a3a2a" height="22" width="5" x="-2.5" y="-22" />
          {tree.pine ? (
            <path d="M0 -62 L16 -22 L-16 -22 Z" fill={is("winter") ? "#3f5a4c" : "#2f5a3e"} style={turning(still)} />
          ) : (
            <>
              <path d="M0 -20 L-10 -36 M0 -26 L9 -40 M0 -30 L0 -46" fill="none" stroke="#4a3a2a" strokeWidth="2" />
              <circle cx="0" cy="-38" fill={look.crown} r="16" style={{ opacity: look.crowned, ...turning(still) }} />
              <g style={only(is("spring"), still)}>
                {[[-7, -42], [6, -46], [8, -33], [-5, -31], [0, -50]].map(([x, y]) => <circle cx={x} cy={y} fill="#f4cfd8" key={`${x}${y}`} r="2.4" />)}
              </g>
            </>
          )}
          <path d="M-16 -22 L16 -22" fill="none" stroke={SEASONS_FROST} strokeWidth="2.5" style={{ ...only(is("winter") && tree.pine, still) }} />
        </g>
      ))}
      {/* Winter: snow. */}
      <g style={only(is("winter"), still)}>
        {Array.from({ length: 46 }, (_, at) => (
          <circle cx={6 + ((at * 53) % 790)} cy={-6} fill={SEASONS_FROST} key={at} r={at % 4 === 0 ? 2.2 : 1.4} style={falling(still, at, 236, 3600 + (at % 6) * 420, 14 + ((at * 37) % 190))} />
        ))}
      </g>
      {/* Spring: rain. */}
      <g style={only(is("spring"), still)}>
        {Array.from({ length: 52 }, (_, at) => (
          <line key={at} stroke="#9fc0d2" strokeLinecap="round" strokeWidth="1.3" style={falling(still, at, 240, 820 + (at % 5) * 110, 10 + ((at * 41) % 190))} x1={4 + ((at * 31) % 796)} x2={-2 + ((at * 31) % 796)} y1={-14} y2={2} />
        ))}
      </g>
      {/* Summer: the heat off the ground. */}
      <g style={only(is("summer"), still)}>
        {Array.from({ length: 7 }, (_, at) => (
          <path d={`M${60 + at * 110} 176 q8 -8 0 -16 q-8 -8 0 -16`} fill="none" key={at} stroke={SEASONS_SUN} strokeLinecap="round" strokeWidth="1.6" opacity="0.65" style={forever(still, "ohUpdSway", 1700, at * 240, "cubic-bezier(0.4, 0, 0.6, 1)")} />
        ))}
      </g>
      {/* Autumn: falling leaves and a fog drifting low. */}
      <g style={only(is("autumn"), still)}>
        {[0, 1].map((at) => (
          <rect fill="#d9d2c4" height="10" key={at} opacity="0.22" rx="5" style={{ "--oh-upd-from": "-320px", "--oh-upd-to": "320px", ...forever(still, "ohUpdDrift", 16000 + at * 5000, -at * 7000) }} width="760" x="20" y={150 + at * 16} />
        ))}
        {Array.from({ length: 24 }, (_, at) => (
          <g key={at} style={falling(still, at, 220, 4200 + (at % 5) * 600, 20 + ((at * 43) % 170))}>
            <path d={`M${20 + ((at * 67) % 770)} 0 l5 -4 5 4 -5 4 z`} fill={at % 3 === 0 ? "#e0a050" : at % 3 === 1 ? "#c8663a" : "#a8482c"} style={forever(still, "ohUpdSway", 1400 + (at % 4) * 300, at * 120, "cubic-bezier(0.4, 0, 0.6, 1)")} />
          </g>
        ))}
      </g>
    </svg>
  );
};

// The four seasons as keys: the one shown is lit; touched, the year stops there.
const SeasonKeys = ({ season, onPick, narrow }) => (
  <div aria-label="Choose a season" role="group" style={{ bottom: "0.6rem", display: "flex", flexWrap: "wrap", gap: narrow ? "0.25rem" : "0.35rem", left: narrow ? "0.5rem" : "0.7rem", position: "absolute", right: "0.7rem" }}>
    {SEASONS.map((entry, at) => {
      const on = at === season;
      return (
        <button
          aria-pressed={on}
          className="oh-tap"
          key={entry.key}
          onClick={() => onPick(at)}
          style={{
            alignItems: "center",
            background: on ? SEASONS_SUN : "rgba(14,23,32,0.72)",
            border: `1px solid ${on ? SEASONS_SUN : "rgba(220,236,243,0.45)"}`,
            borderRadius: "999px",
            color: on ? SEASONS_INK : SEASONS_FROST,
            cursor: "pointer",
            display: "inline-flex",
            fontFamily: SEASONS_SERIF,
            fontSize: narrow ? "0.7rem" : "0.82rem",
            fontWeight: 700,
            gap: narrow ? "0.2rem" : "0.3rem",
            minHeight: "2rem",
            padding: narrow ? "0 0.45rem" : "0 0.8rem",
            touchAction: "manipulation",
          }}
          type="button"
        >
          <span aria-hidden="true" style={{ display: "inline-flex" }}>{ICONS[entry.icon](narrow ? 12 : 16)}</span>
          {entry.label}
        </button>
      );
    })}
  </div>
);

const SeasonsAndWeather = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const [season, setSeason] = useState(0);
  const [chosen, setChosen] = useState(false);
  // The year turns by itself until a season is picked, or never where nothing is to move.
  useEffect(() => {
    if (still || chosen) return undefined;
    const timer = setInterval(() => setSeason((at) => (at + 1) % SEASONS.length), SEASON_MS);
    return () => clearInterval(timer);
  }, [still, chosen]);
  const pick = (at) => {
    setChosen(true);
    setSeason(at);
  };
  return (
    <Plate surface={{ background: SEASONS_INK, border: "1px solid rgba(220,236,243,0.28)", borderRadius: "14px" }}>
      <Brackets colour={SEASONS_FROST} inset="0.7rem" length="1.6rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: "1px solid rgba(220,236,243,0.2)", height: narrow ? "12rem" : "clamp(13rem, 27vw, 17rem)", overflow: "hidden", position: "relative" }}>
        <Landscape season={season} still={still} />
        <SeasonKeys narrow={narrow} onPick={pick} season={season} />
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: SEASONS_SUN, fontFamily: SEASONS_SERIF, fontSize: "0.8rem", fontVariant: "small-caps", letterSpacing: "0.16em" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: SEASONS_FROST, fontFamily: SEASONS_SERIF, fontSize: narrow ? "2.1rem" : "clamp(2.3rem, 6vw, 3.2rem)", fontWeight: 700, lineHeight: 1.05, marginTop: "0.2rem" }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: SEASONS_SUN, fontFamily: SEASONS_SERIF, fontSize: "1.05rem", fontStyle: "italic", marginTop: "0.2rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: SEASONS_FROST_SOFT, fontFamily: SEASONS_SERIF, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={SEASONS_FROST}>
          <span style={{ color: SEASONS_SUN, display: "inline-flex" }}>{ICONS.snow(18)}</span>
        </Rule>
        <FeatureCards
          accent={SEASONS_SUN}
          caps={false}
          card={{ background: "rgba(220,236,243,0.04)", border: "1px solid rgba(220,236,243,0.18)", borderRadius: "10px" }}
          delay={520}
          font={SEASONS_SERIF}
          sections={banner.sections ?? []}
          soft={SEASONS_FROST_SOFT}
        />
      </div>
    </Plate>
  );
};

export default SeasonsAndWeather;
