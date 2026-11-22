/*! Open Historia — Themes: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make a major update popup for the themes update and make the main menu also
// be themed by the themes and all the popups" and "a first time setup where you
// pick your language and it says the words Hello Welcome cycling through
// different languages" (the owner, 2026-11-05).
//
// Two pages, told apart by the banner's `scene`:
//   palettes  a painter's fan deck of the six palettes opening from its pivot,
//             and beside it the game's window wearing each in turn, a brush
//             stroke drawing itself under it in the accent. The chips beside it
//             answer a touch: the window takes that palette and stays.
//   welcome   a globe with "Hello" rising round it in many languages, the
//             setup's two cards (a language ticked, then a palette), and the
//             Advisor's box, its microphone stepping aside as words are typed.
// With Reduce motion nothing moves: each page is drawn as it stands.
//
// The accent is the player's own theme's (themesChrome.js). Flat shapes only:
// nothing is a gradient, nothing purple.

import React, { useEffect, useState } from "react";

import { GREETINGS } from "../../../../runtime/greetings.js";
import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { THEMES_ACCENT, THEMES_CARD, THEMES_FACE, THEMES_FAINT, THEMES_GROUND, THEMES_INK, THEMES_SOFT } from "./themesChrome.js";

// The palettes as Settings has them (runtime/uiTheme.js), the original first.
const PALETTES = Object.freeze([
  { name: "Default (Original)", background: "#131315", surface: "#232327", accent: "#D4D4D8" },
  { name: "Midnight Navy", background: "#111D2A", surface: "#20364A", accent: "#85CBE6" },
  { name: "Graphite", background: "#15171B", surface: "#30343B", accent: "#BAC6D2" },
  { name: "Forest", background: "#121E19", surface: "#283C32", accent: "#78C8A1" },
  { name: "Oxblood", background: "#21171B", surface: "#3D2830", accent: "#DA929E" },
  { name: "Sepia", background: "#241F19", surface: "#403528", accent: "#D6B77D" },
]);
const TURN_MS = 2400;
const LINE = "rgba(243,241,236,0.14)";
const BAR = "rgba(243,241,236,0.22)";

// The theme's own motions, beside the kit's: a fan blade opening to its angle,
// and a word rising and fading.
const STYLE_ID = "oh-update-themes-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  @keyframes ohThemesFan { from { transform: rotate(0deg); } to { transform: rotate(var(--oh-themes-angle, 0deg)); } }
  @keyframes ohThemesWord { 0% { opacity: 0; transform: translateY(10px); } 15% { opacity: 1; transform: none; } 70% { opacity: 1; transform: translateY(-6px); } 100% { opacity: 0; transform: translateY(-16px); } }
  @keyframes ohThemesType { 0%, 20% { transform: scaleX(0); } 60%, 100% { transform: scaleX(1); } }
  @keyframes ohThemesStep { 0%, 20% { opacity: 1; } 35%, 100% { opacity: 0; } }
  .oh-themes-fill { transition: fill 600ms cubic-bezier(0.4, 0, 0.2, 1), stroke 600ms cubic-bezier(0.4, 0, 0.2, 1); }
  `;
  document.head.appendChild(style);
}

// One blade of the fan deck: the palette's three colours, top to bottom.
const Blade = ({ palette, angle, index, still }) => (
  <g style={{ transformBox: "fill-box", transformOrigin: "50% 106.67%", transform: still ? `rotate(${angle}deg)` : undefined, "--oh-themes-angle": `${angle}deg`, ...motion(still, "ohThemesFan", 1100, 250 + index * 90, "cubic-bezier(0.2, 0.8, 0.2, 1)") }}>
    <rect fill={palette.background} height="150" rx="9" stroke="rgba(243,241,236,0.22)" width="40" x="-20" y="-160" />
    <rect fill={palette.surface} height="44" rx="4" width="30" x="-15" y="-152" />
    <rect fill={palette.accent} height="28" rx="4" width="30" x="-15" y="-102" />
    <rect fill="rgba(243,241,236,0.3)" height="3" rx="1.5" width="22" x="-11" y="-64" />
    <rect fill="rgba(243,241,236,0.18)" height="3" rx="1.5" width="14" x="-11" y="-56" />
  </g>
);

// The game's window, in a palette: its rail, its bar, two cards and a button.
const Window = ({ palette }) => (
  <g>
    <rect className="oh-themes-fill" height="168" rx="12" stroke={LINE} style={{ fill: palette.background }} width="300" />
    <rect className="oh-themes-fill" height="152" rx="8" style={{ fill: palette.surface }} width="48" x="8" y="8" />
    {[0, 1, 2, 3].map((at) => (
      <rect className="oh-themes-fill" height="22" key={`r${at}`} rx="6" style={{ fill: at === 0 ? palette.accent : "rgba(243,241,236,0.14)" }} width="32" x="16" y={20 + at * 32} />
    ))}
    <rect className="oh-themes-fill" height="22" rx="6" style={{ fill: palette.surface }} width="228" x="64" y="8" />
    <rect fill="rgba(243,241,236,0.75)" height="6" rx="3" width="70" x="74" y="16" />
    {[0, 1].map((at) => (
      <g key={`c${at}`} style={{ transform: `translate(${64 + at * 118}px, 38px)` }}>
        <rect className="oh-themes-fill" height="88" rx="8" style={{ fill: palette.surface }} width="110" />
        <rect className="oh-themes-fill" height="34" rx="5" style={{ fill: palette.background }} width="98" x="6" y="6" />
        <rect fill="rgba(243,241,236,0.7)" height="5" rx="2.5" width="60" x="8" y="50" />
        <rect fill={BAR} height="4" rx="2" width="84" x="8" y="62" />
        <rect fill={BAR} height="4" rx="2" width="50" x="8" y="72" />
      </g>
    ))}
    <rect className="oh-themes-fill" height="22" rx="11" style={{ fill: palette.accent }} width="96" x="196" y="136" />
    <rect className="oh-themes-fill" height="5" rx="2.5" style={{ fill: palette.background }} width="52" x="218" y="144.5" />
  </g>
);

// The palettes page's picture, and its chips.
const PalettesScene = ({ still, narrow }) => {
  const [at, setAt] = useState(1);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (still || held) return undefined;
    const timer = setInterval(() => setAt((value) => (value + 1) % PALETTES.length), TURN_MS);
    return () => clearInterval(timer);
  }, [still, held]);
  const palette = PALETTES[at];
  return (
    <div style={{ height: "100%", position: "relative" }}>
      <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
        <rect fill={THEMES_GROUND} height="220" width="800" />
        {/* Paint spots on the studio floor. */}
        {[[60, 40, 5], [740, 30, 4], [700, 190, 6], [300, 200, 3], [520, 26, 3]].map(([x, y, r], index) => (
          <circle cx={x} cy={y} fill={PALETTES[(index % 5) + 1].accent} key={`s${x}`} opacity="0.5" r={r} style={forever(still, "ohUpdTwinkle", 3200, index * 500, "cubic-bezier(0.4, 0, 0.6, 1)")} />
        ))}
        {/* The fan deck, opening from its pivot. */}
        <g style={{ transform: narrow ? "translate(250px, 196px) scale(0.8)" : "translate(180px, 196px)" }}>
          <g style={forever(still, "ohUpdSway", 7000, 1600, "cubic-bezier(0.4, 0, 0.6, 1)")}>
            {PALETTES.map((item, index) => (
              <Blade angle={-62 + index * 24} index={index} key={item.name} palette={item} still={still} />
            ))}
          </g>
          <circle fill={THEMES_CARD} r="9" stroke="rgba(243,241,236,0.5)" strokeWidth="1.5" />
          <circle fill="rgba(243,241,236,0.6)" r="3" />
        </g>
        {/* The game's window, wearing the palette shown. */}
        <g style={{ transform: narrow ? "translate(345px, 40px) scale(0.8)" : "translate(355px, 20px) scale(0.95)" }}>
          <Window palette={palette} />
          {/* A brush stroke drawing itself under it, in the palette's accent. */}
          <path className="oh-themes-fill" d="M6 186 C 60 176, 120 194, 180 184 S 260 176, 296 186" fill="none" strokeDasharray="320" strokeLinecap="round" strokeWidth="7" style={{ stroke: palette.accent, "--oh-upd-length": 320, ...motion(still, "ohUpdDraw", 1300, 700, "cubic-bezier(0.3, 0, 0.2, 1)") }} />
        </g>
      </svg>
      {/* The chips: each puts its palette on the window. A phone has no room
          for them beside it, and watches the palettes go round instead. */}
      {!narrow && <div style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: "repeat(2, 1.6rem)", position: "absolute", right: "1.4rem", top: "50%", transform: "translateY(-50%)" }}>
        {PALETTES.map((item, index) => (
          <button
            aria-label={item.name}
            aria-pressed={index === at}
            className="oh-tap"
            key={item.name}
            onClick={() => { setAt(index); setHeld(true); }}
            style={{ background: item.background, border: `2px solid ${index === at ? item.accent : "rgba(243,241,236,0.25)"}`, borderRadius: "999px", cursor: "pointer", display: "flex", height: "1.6rem", overflow: "hidden", padding: 0, width: "1.6rem" }}
            title={item.name}
            type="button"
          >
            <span style={{ background: item.surface, flex: 1 }} />
            <span style={{ background: item.accent, flex: 1 }} />
          </button>
        ))}
      </div>}
    </div>
  );
};

// Where round the globe each greeting rises (runtime/greetings.js, in its order).
const HELLO_SPOTS = Object.freeze([[150, 44], [250, 84], [52, 92], [232, 166], [80, 168], [150, 196], [262, 126], [40, 132], [150, 120]]);
const HELLOS = HELLO_SPOTS.map(([x, y], index) => ({ word: GREETINGS[index].hello, lang: GREETINGS[index].code, x, y }));

// The welcome page's picture.
const WelcomeScene = ({ still, narrow }) => (
  <svg aria-hidden="true" className="oh-upd-svg" data-no-translate preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
    <rect fill={THEMES_GROUND} height="220" width="800" />
    {/* The world, its meridians drawing themselves, greeted in its languages. */}
    <g style={{ transform: `translate(${narrow ? 120 : 40}px, 0px)` }}>
      <g style={{ transform: "translate(150px, 118px)" }}>
        <circle fill="none" r="84" stroke="rgba(243,241,236,0.3)" strokeWidth="1.4" />
        {[-60, -25, 0, 25, 60].map((tilt, index) => (
          <ellipse fill="none" key={`m${tilt}`} rx={Math.abs(Math.cos((tilt * Math.PI) / 180)) * 84 || 1} ry="84" stroke="rgba(243,241,236,0.16)" strokeDasharray="560" style={{ "--oh-upd-length": 560, ...motion(still, "ohUpdDraw", 1700, 200 + index * 150, "cubic-bezier(0.3, 0, 0.2, 1)") }} />
        ))}
      </g>
      {HELLOS.map((hello, index) => (
        <text
          fill={THEMES_INK}
          fontFamily={THEMES_FACE}
          fontSize={index === 0 ? 26 : 16}
          fontWeight="800"
          key={hello.word}
          lang={hello.lang}
          opacity={still ? (index < 5 ? 0.9 : 0) : undefined}
          style={still ? undefined : { animation: `ohThemesWord 4500ms cubic-bezier(0.4, 0, 0.2, 1) ${index * 500}ms infinite both` }}
          textAnchor="middle"
          x={hello.x}
          y={hello.y}
        >
          {hello.word}
        </text>
      ))}
    </g>
    {/* The setup's two cards: a language ticked, then a palette chosen. */}
    {!narrow && (
      <g style={{ transform: "translate(380px, 20px) scale(0.8)" }}>
        <rect fill={THEMES_CARD} height="150" rx="12" stroke={LINE} width="170" />
        {[0, 1, 2, 3].map((row) => (
          <g key={`l${row}`} style={{ transform: `translate(12px, ${14 + row * 32}px)` }}>
            <rect height="26" rx="6" strokeWidth={row === 1 ? 1.6 : 1} style={{ fill: row === 1 ? "rgba(243,241,236,0.08)" : "rgba(243,241,236,0.03)", stroke: row === 1 ? THEMES_ACCENT : LINE }} width="146" />
            <rect fill="rgba(243,241,236,0.7)" height="5" rx="2.5" width={50 + (row % 2) * 22} x="10" y="8" />
            <rect fill={BAR} height="3.5" rx="1.7" width="34" x="10" y="17" />
            {row === 1 && <path d="M124 13 l5 5 l9 -10" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" style={{ stroke: THEMES_ACCENT, "--oh-upd-length": 30, strokeDasharray: 30, ...motion(still, "ohUpdDraw", 500, 1200) }} />}
          </g>
        ))}
        <g style={{ transform: "translate(186px, 0px)" }}>
          <rect fill={THEMES_CARD} height="150" rx="12" stroke={LINE} width="150" />
          {PALETTES.slice(0, 6).map((item, index) => (
            <g key={item.name} style={{ transform: `translate(${12 + (index % 2) * 66}px, ${12 + Math.floor(index / 2) * 44}px)` }}>
              <rect fill={item.background} height="38" rx="6" stroke={index === 3 ? item.accent : LINE} strokeWidth={index === 3 ? 2 : 1} width="60" />
              <rect fill={item.surface} height="16" rx="3" width="20" x="5" y="5" />
              <rect fill={item.accent} height="7" rx="3" width="24" x="31" y="26" />
            </g>
          ))}
        </g>
      </g>
    )}
    {/* The Advisor's box: words typed in, the microphone stepping aside. */}
    <g style={{ transform: narrow ? "translate(390px, 150px) scale(0.85)" : "translate(410px, 152px) scale(0.85)" }}>
      <rect fill={THEMES_CARD} height="40" rx="10" stroke={LINE} width="170" />
      <rect fill="rgba(243,241,236,0.7)" height="5" rx="2.5" style={{ transformOrigin: "14px 20px", ...(still ? {} : { animation: "ohThemesType 5000ms cubic-bezier(0.4, 0, 0.2, 1) 600ms infinite both" }) }} width="100" x="14" y="17.5" />
      <g style={still ? undefined : { animation: "ohThemesStep 5000ms cubic-bezier(0.4, 0, 0.2, 1) 600ms infinite both" }}>
        <rect fill="none" height="12" rx="4" stroke={THEMES_SOFT} strokeWidth="1.6" width="8" x="141" y="11" />
        <path d="M137 21 a8 8 0 0 0 16 0 M145 29 v4" fill="none" stroke={THEMES_SOFT} strokeLinecap="round" strokeWidth="1.6" />
      </g>
      <rect height="40" rx="10" style={{ fill: THEMES_ACCENT }} width="40" x="178" />
      <path d="M198 28 V12 m-7 7 7 -7 7 7" fill="none" stroke="#14110b" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </g>
  </svg>
);

const Themes = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const welcome = banner.scene === "welcome";
  return (
    <Plate surface={{ background: THEMES_GROUND, border: "1px solid rgba(243,241,236,0.16)", borderRadius: "14px" }}>
      <Brackets colour={THEMES_ACCENT} inset="0.7rem" length="1.4rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `2px solid ${THEMES_ACCENT}`, height: narrow ? "10.5rem" : "clamp(11.5rem, 24vw, 15rem)", overflow: "hidden", position: "relative" }}>
        {welcome ? <WelcomeScene narrow={narrow} still={still} /> : <PalettesScene narrow={narrow} still={still} />}
      </Reveal>
      <div style={{ fontFamily: THEMES_FACE, padding: narrow ? "1.1rem 1.1rem 1.3rem" : "1.4rem 2rem 1.7rem" }}>
        <Reveal delay={300} style={{ alignItems: "center", display: "flex", gap: narrow ? "0.75rem" : "1rem" }}>
          <span style={{ color: THEMES_ACCENT, display: "inline-flex", flex: "0 0 auto", ...motion(still, "ohUpdTurn", 800, 260) }}>{(welcome ? ICONS.people : ICONS.palette)(narrow ? 36 : 46)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: THEMES_ACCENT, fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
              Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
            </div>
            <div style={{ color: THEMES_INK, fontSize: narrow ? "2rem" : "clamp(2.2rem, 5.5vw, 3.1rem)", fontWeight: 900, letterSpacing: "-0.01em", lineHeight: 1.04, marginTop: "0.15rem", ...motion(still, "ohUpdFade", 500, 380) }}>{banner.title}</div>
            {banner.subtitle && <div style={{ color: THEMES_SOFT, fontSize: "1.02rem", marginTop: "0.25rem" }}>{banner.subtitle}</div>}
          </div>
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: THEMES_SOFT, fontSize: "0.98rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={THEMES_FAINT}>
          <span style={{ color: THEMES_ACCENT, display: "inline-flex" }}>{ICONS.palette(18)}</span>
        </Rule>
        <FeatureCards
          accent={THEMES_ACCENT}
          caps={false}
          columns={narrow ? "1fr" : "repeat(auto-fit, minmax(14rem, 1fr))"}
          card={{ background: "rgba(243,241,236,0.035)", border: "1px solid rgba(243,241,236,0.14)", borderRadius: "12px" }}
          delay={520}
          font={THEMES_FACE}
          sections={banner.sections ?? []}
          soft={THEMES_SOFT}
        />
      </div>
    </Plate>
  );
};

export default Themes;
