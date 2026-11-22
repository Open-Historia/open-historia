/*! Open Historia — the parts an update notice is built from © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a notice behind the vault door (UpdateNotice.jsx) is made of, so that a
// new major update's own theme (themes/) is a page of putting these together
// and not a page of plumbing (notes.js says how one is added). Nothing here
// belongs to one look: every colour is a prop, and a theme brings its own
// surfaces (the war theme its steel, another its paper or its night sky).
//
//   Plate           the page a banner is drawn on: a surface, a border, a shadow
//   Reveal          a part that rises in after `delay` ms (still with Reduce motion)
//   Brackets        four corner brackets
//   Rule            a double hairline, with a mark (or anything) in the middle
//   Emblem          a compass star in a ring, turning in as it is shown
//   FeatureCards    a banner's sections as cards, each with its icon and items,
//                   one after another
//   NoticeButton    a button, in a theme's colours
//   ICONS           the icons a section may name (notes.js `icon`)
//   useNarrow       whether the screen is a phone's (narrower than `below` px)
//   useStill        whether motion is to be left out (Reduce motion, or the
//                   system's own setting); `motion(still, name, ms, delay)` is
//                   an animation for a style, none when still
//   keyframes       ohUpdRise, ohUpdFade, ohUpdTurn, ohUpdDraw (a line drawn
//                   along itself: set --oh-upd-length and a dasharray),
//                   ohUpdPulse, ohUpdDrift (across: --oh-upd-from, --oh-upd-to),
//                   ohUpdTwinkle, ohUpdStamp, ohUpdFall (down: --oh-upd-fall),
//                   ohUpdSway, ohUpdBob (floating, tilted --oh-upd-tilt), ohUpdRing
//                   (a ring spreading out), ohUpdStrike (a jump when touched),
//                   ohUpdSpin (turning for ever), ohUpdGrow and ohUpdShrink (a bar
//                   filling or emptying: set its transformOrigin)
//
// Nothing here is a gradient (noGradients.test.js) and nothing is purple:
// surfaces are flat colours or made pictures, lines are lines.

import React, { useEffect, useMemo, useState } from "react";

import { getStoredLanguage } from "../../../runtime/i18n.js";
import { reduceMotionEnabled } from "../../../runtime/mapSettings.js";

// Over the main menu and everything it opens, and under the vault door (VaultDoor.jsx, 2147482000).
export const NOTICE_Z = 2147481000;
export const ACCENT = "#2bc1f3";

const STYLE_ID = "oh-update-notice-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  @keyframes ohUpdRise { from { opacity: 0; transform: translateY(16px) scale(0.985); } to { opacity: 1; transform: none; } }
  @keyframes ohUpdFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ohUpdTurn { from { opacity: 0; transform: rotate(-120deg) scale(0.6); } to { opacity: 1; transform: none; } }
  @keyframes ohUpdDraw { from { stroke-dashoffset: var(--oh-upd-length, 1000); } to { stroke-dashoffset: 0; } }
  @keyframes ohUpdPulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  @keyframes ohUpdDrift { from { transform: translateX(var(--oh-upd-from, -10%)); } to { transform: translateX(var(--oh-upd-to, 110%)); } }
  @keyframes ohUpdTwinkle { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.85; } }
  @keyframes ohUpdStamp { 0% { opacity: 0; transform: rotate(-8deg) scale(1.8); } 70% { opacity: 1; transform: rotate(-8deg) scale(0.94); } 100% { opacity: 1; transform: rotate(-8deg) scale(1); } }
  @keyframes ohUpdFall { from { transform: translateY(-12px); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } to { transform: translateY(var(--oh-upd-fall, 160px)); opacity: 0; } }
  @keyframes ohUpdSway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
  @keyframes ohUpdSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes ohUpdGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes ohUpdShrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  @keyframes ohUpdBob { 0%, 100% { transform: translateY(0) rotate(var(--oh-upd-tilt, -6deg)); } 50% { transform: translateY(-14px) rotate(calc(var(--oh-upd-tilt, -6deg) * -1)); } }
  @keyframes ohUpdRing { from { opacity: 0.9; transform: scale(0.4); } to { opacity: 0; transform: scale(2.2); } }
  @keyframes ohUpdStrike { 0% { transform: scale(1); } 35% { transform: scale(1.3) translateY(-8px); } 100% { transform: scale(1); } }
  .oh-upd-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.3) transparent; }
  .oh-upd-svg * { transform-box: fill-box; transform-origin: center; }
  @media (prefers-reduced-motion: reduce) { .oh-upd-anim, .oh-upd-anim * { animation: none !important; } }
  `;
  document.head.appendChild(style);
}

// Whether motion is to be left out: the game's Reduce motion, or the system's.
export const useStill = () => useMemo(() => {
  let system = false;
  try {
    system = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    system = false;
  }
  return reduceMotionEnabled() || system;
}, []);

const MS = "ms";
// Whether the screen is narrower than `below` px (a phone), kept up as it turns.
export const useNarrow = (below = 560) => {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < below);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < below);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [below]);
  return narrow;
};

// An animation for a style: none when still. `timing` carries its cubic-bezier (or "linear").
export const motion = (still, name, duration, delay = 0, timing = "cubic-bezier(0.2, 0.7, 0.2, 1)", rest = "both") => (still
  ? {}
  : { animation: [name, duration + MS, timing, delay + MS, rest].join(" ") });
// An animation that goes on for as long as it is shown.
export const forever = (still, name, duration, delay = 0, timing = "linear") => (still
  ? {}
  : { animation: [name, duration + MS, timing, delay + MS, "infinite", "both"].join(" ") });

// The page a banner is drawn on.
//   surface   its own style: a background (a flat colour, or a picture), a border
export const Plate = ({ surface = null, children }) => {
  const still = useStill();
  return (
    <div
      style={{
        background: "#15181d",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "10px",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
        width: "100%",
        ...surface,
        ...motion(still, "ohUpdRise", 650, 80),
      }}
    >
      {children}
    </div>
  );
};

// A part that rises in after `delay` ms.
export const Reveal = ({ delay = 0, name = "ohUpdRise", duration = 600, style = null, children }) => {
  const still = useStill();
  return <div style={{ ...style, ...motion(still, name, duration, delay) }}>{children}</div>;
};

// Four corner brackets, `length` long.
export const Brackets = ({ colour = ACCENT, inset = "0.9rem", length = "2.2rem", thickness = 2 }) => {
  const arm = { position: "absolute", width: length, height: length, pointerEvents: "none", borderColor: colour, borderStyle: "solid", borderWidth: 0 };
  return (
    <>
      <span aria-hidden="true" style={{ ...arm, left: inset, top: inset, borderLeftWidth: thickness, borderTopWidth: thickness }} />
      <span aria-hidden="true" style={{ ...arm, right: inset, top: inset, borderRightWidth: thickness, borderTopWidth: thickness }} />
      <span aria-hidden="true" style={{ ...arm, left: inset, bottom: inset, borderLeftWidth: thickness, borderBottomWidth: thickness }} />
      <span aria-hidden="true" style={{ ...arm, right: inset, bottom: inset, borderRightWidth: thickness, borderBottomWidth: thickness }} />
    </>
  );
};

// A compass star in a ring, as the logo has it, turning in as it is shown.
export const Emblem = ({ size = 64, colour = ACCENT, ink = "#0b0d10", delay = 0 }) => {
  const still = useStill();
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 100 100" width={size} style={{ flex: "0 0 auto", ...motion(still, "ohUpdTurn", 900, delay) }}>
      <circle cx="50" cy="50" r="46" fill={ink} stroke={colour} strokeWidth="3" />
      <circle cx="50" cy="50" r="38" fill="none" stroke={colour} strokeDasharray="2 4" strokeWidth="2" />
      {Array.from({ length: 16 }, (_, at) => {
        const turn = (at * Math.PI) / 8;
        const long = at % 4 === 0;
        return <line key={at} stroke={colour} strokeWidth={long ? 2.4 : 1.2} x1={50 + Math.sin(turn) * 40} x2={50 + Math.sin(turn) * (long ? 46 : 43)} y1={50 - Math.cos(turn) * 40} y2={50 - Math.cos(turn) * (long ? 46 : 43)} />;
      })}
      <path d="M50 14 L57 43 L86 50 L57 57 L50 86 L43 57 L14 50 L43 43 Z" fill={colour} />
      <path d="M50 14 L57 43 L50 50 Z M86 50 L57 57 L50 50 Z M50 86 L43 57 L50 50 Z M14 50 L43 43 L50 50 Z" fill={ink} opacity="0.35" />
      <circle cx="50" cy="50" r="4" fill={ink} stroke={colour} strokeWidth="2" />
    </svg>
  );
};

// A double hairline across, with something in its middle (a diamond unless given).
export const Rule = ({ colour = ACCENT, children = null, margin = "0.9rem 0" }) => (
  <div aria-hidden="true" style={{ alignItems: "center", display: "flex", gap: "0.8rem", margin }}>
    <div style={{ borderBottom: `1px solid ${colour}`, borderTop: `1px solid ${colour}`, flex: 1, height: "3px", opacity: 0.7 }} />
    {children ?? <span style={{ background: colour, display: "inline-block", height: "0.55rem", transform: "rotate(45deg)", width: "0.55rem" }} />}
    <div style={{ borderBottom: `1px solid ${colour}`, borderTop: `1px solid ${colour}`, flex: 1, height: "3px", opacity: 0.7 }} />
  </div>
);

const iconFrame = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, viewBox: "0 0 24 24", "aria-hidden": true };
// The icons a section may name (notes.js `icon`).
export const ICONS = Object.freeze({
  chess: (size) => <svg {...iconFrame} height={size} width={size}><path d="M9 20h6M8 17h8l-1-4h-6zM10 13l-1-4 3-2 3 2-1 4M12 4v3M10.5 5.5h3" /></svg>,
  swords: (size) => <svg {...iconFrame} height={size} width={size}><path d="M4 4l9.5 9.5M20 4l-9.5 9.5M5.5 15.5l3 3M15.5 18.5l3-3M3 21l3.5-3.5M21 21l-3.5-3.5M4 4h3M4 4v3M20 4h-3M20 4v3" /></svg>,
  snow: (size) => <svg {...iconFrame} height={size} width={size}><path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5" /></svg>,
  sun: (size) => <svg {...iconFrame} height={size} width={size}><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></svg>,
  rain: (size) => <svg {...iconFrame} height={size} width={size}><path d="M7 15.5a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.2 2.2A3.6 3.6 0 0 1 18 15.5zM8 18.5l-1 2.5M12.5 18.5l-1 2.5M17 18.5l-1 2.5" /></svg>,
  leaf: (size) => <svg {...iconFrame} height={size} width={size}><path d="M4.5 19.5C4 11 9 4.5 20 4.5c0 10-6 15.5-15.5 15M4.5 19.5L13 11" /></svg>,
  wall: (size) => <svg {...iconFrame} height={size} width={size}><path d="M3.5 20.5v-11h3v-3h3v3h5v-3h3v3h3v11zM10 20.5v-4.5h4v4.5" /></svg>,
  plane: (size) => <svg {...iconFrame} height={size} width={size}><path d="M2.5 13.5l8-1.5L14 4.5h2l-1.5 7.5 5.5-1 1.5-2h1.5l-1 3.5 1 3.5H21.5l-1.5-2-5.5-1L16 20.5h-2l-3.5-7.5-8 1.5z" /></svg>,
  ship: (size) => <svg {...iconFrame} height={size} width={size}><path d="M3 15.5h18l-2.8 4.5H5.8zM12 3.5v12M12 5.5l6.5 8H12" /></svg>,
  flag: (size) => <svg {...iconFrame} height={size} width={size}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>,
  eye: (size) => <svg {...iconFrame} height={size} width={size}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.6" /></svg>,
  map: (size) => <svg {...iconFrame} height={size} width={size}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" /></svg>,
  gear: (size) => <svg {...iconFrame} height={size} width={size}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>,
  star: (size) => <svg {...iconFrame} height={size} width={size}><path d="M12 3l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.1 6.1-.7z" /></svg>,
  book: (size) => <svg {...iconFrame} height={size} width={size}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></svg>,
  note: (size) => <svg {...iconFrame} height={size} width={size}><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>,
  phone: (size) => <svg {...iconFrame} height={size} width={size}><rect height="19" rx="2.5" width="11" x="6.5" y="2.5" /><path d="M10.5 18h3" /></svg>,
  people: (size) => <svg {...iconFrame} height={size} width={size}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5M14.5 15c2.8-.4 6 1.4 6 5" /></svg>,
  palette: (size) => <svg {...iconFrame} height={size} width={size}><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1.1" /><circle cx="10" cy="7" r="1.1" /><circle cx="14.5" cy="7" r="1.1" /><circle cx="17" cy="10.5" r="1.1" /></svg>,
});

// A banner's sections as cards, one after another from `delay` on, `step` ms apart.
//   card   each card's own surface (a theme's tray, its paper)
//   font   the headings' face, and `caps` whether they are in capitals
export const FeatureCards = ({ sections = [], accent = ACCENT, soft = "rgba(244,244,245,0.72)", card = null, font = "inherit", caps = true, delay = 0, step = 110, columns = "repeat(auto-fit, minmax(15.5rem, 1fr))" }) => (
  <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: columns }}>
    {sections.map((section, index) => (
      <Reveal delay={delay + index * step} key={section.heading}>
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", boxSizing: "border-box", height: "100%", padding: "0.75rem 0.85rem 0.8rem", ...card }}>
          <div style={{ alignItems: "center", color: accent, display: "flex", gap: "0.5rem" }}>
            {(ICONS[section.icon] ?? ICONS.star)(20)}
            <span style={{ fontFamily: font, fontSize: "0.86rem", fontWeight: 700, letterSpacing: caps ? "0.12em" : "0.01em", textTransform: caps ? "uppercase" : "none" }}>{section.heading}</span>
          </div>
          <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: 0 }}>
            {(section.items ?? []).map((item) => (
              <li key={item} style={{ color: soft, display: "flex", fontSize: "0.8rem", gap: "0.5rem", lineHeight: 1.45, marginTop: "0.32rem" }}>
                <span aria-hidden="true" style={{ background: accent, flex: "0 0 auto", height: "0.36rem", marginTop: "0.42rem", transform: "rotate(45deg)", width: "0.36rem" }} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    ))}
  </div>
);

// A button, in a theme's colours.
export const NoticeButton = ({ onClick, children, colour = ACCENT, edge = null, ink = "#06121a", font = "inherit", caps = false, disabled = false, label = undefined, style = null }) => (
  <button
    aria-label={label}
    className="oh-tap"
    disabled={disabled}
    onClick={onClick}
    style={{
      background: colour,
      border: `1px solid ${edge ?? colour}`,
      borderRadius: "6px",
      boxShadow: "0 2px 0 rgba(0,0,0,0.45)",
      color: ink,
      cursor: disabled ? "default" : "pointer",
      fontFamily: font,
      fontSize: "0.9rem",
      fontWeight: 800,
      letterSpacing: caps ? "0.14em" : "0.02em",
      minHeight: "2.5rem",
      opacity: disabled ? 0.4 : 1,
      padding: "0.5rem 1.3rem",
      textTransform: caps ? "uppercase" : "none",
      ...style,
    }}
    type="button"
  >
    {children}
  </button>
);

// A "YYYY-MM-DD" in the player's language, as `parts` say (Intl.DateTimeFormat options): the language's own
// month names, so none are kept here to be translated. "" for a date that cannot be read.
export const formatUpdateDate = (date, parts = { day: "numeric", month: "long", year: "numeric" }) => {
  const [year, month, day] = String(date || "").split("-").map(Number);
  if (!year || !month) return "";
  try {
    return new Intl.DateTimeFormat(getStoredLanguage() || undefined, { ...parts, timeZone: "UTC" }).format(Date.UTC(year, month - 1, day || 1));
  } catch {
    return String(date);
  }
};
// The date of an update as its notice says it: "15 October 2026" (in English).
export const noticeDate = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? formatUpdateDate(date) : "");
