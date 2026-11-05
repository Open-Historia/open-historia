/*! Open Historia — Rostra: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "replace the listen in feature with a new button where the projects button
// was where it opens a social media application ... you should also be able to
// quote other peoples posts" and "on beta add the projects menu as a tab in the
// actions menu" (the owner, 2026-11-02).
//
// Two pages, told apart by the banner's `scene`:
//   feed   the world talking: a globe whose meridians draw themselves, a phone
//          rising from the foot of the picture as Rostra rises from the dock,
//          its column of posts scrolling up for ever (one of them quoting
//          another, embedded as the app shows it), a box where a post is being
//          typed, and hearts and quote marks rising off the feed. The heart
//          under the first post answers a touch: it fills, jumps and counts.
//   desk   the Actions panel with its two tabs, the marker sliding from one to
//          the other and the board's progress bars filling; beside it the phone
//          Listen in was, Rostra's mark lighting up on its screen.
// With Reduce motion nothing moves: each page is drawn as it stands.
//
// Flat shapes only: nothing is a gradient, nothing purple.

import React, { useState } from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { ROSTRA_ACCENT, ROSTRA_CARD, ROSTRA_FACE, ROSTRA_FAINT, ROSTRA_GROUND, ROSTRA_INK, ROSTRA_SOFT } from "./rostraChrome.js";

const LINE = "rgba(238,243,245,0.12)";
const BAR = "rgba(238,243,245,0.2)";
const BAR_SOFT = "rgba(238,243,245,0.11)";
const SLATE = "#1d272d";
// The phone Rostra is drawn as (GameUI/social.jsx): its frame, edge and screen.
const PHONE = "#17171a";
const PHONE_EDGE = "#3a3a40";
const PHONE_SCREEN = "#0b0b0d";

// The theme's own motions, beside the kit's: the feed scrolling up, a caret
// blinking, a heart rising off the feed, and the tab marker sliding.
const STYLE_ID = "oh-update-rostra-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  @keyframes ohRostraScroll { from { transform: translateY(0); } to { transform: translateY(var(--oh-rostra-scroll, -150px)); } }
  @keyframes ohRostraCaret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
  @keyframes ohRostraRise { 0% { opacity: 0; transform: translateY(0) scale(0.6); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(-70px) scale(1.1); } }
  @keyframes ohRostraSlide { 0%, 42% { transform: translateX(0); } 50%, 92% { transform: translateX(var(--oh-rostra-slide, 96px)); } 100% { transform: translateX(0); } }
  @keyframes ohRostraType { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  `;
  document.head.appendChild(style);
}

// Rostra's mark: the lectern in a speech bubble (as GameUI/social.jsx draws it).
const Mark = ({ size = 44 }) => (
  <svg aria-hidden="true" height={size} viewBox="0 0 32 32" width={size}>
    <path d="M6 3h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13l-6 5v-5H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z" fill={ROSTRA_ACCENT} />
    <path d="M12 21h8l-1.2-7.5h-5.6z" fill="#0b1a20" />
    <path d="M9.5 13.5h13" stroke="#0b1a20" strokeLinecap="round" strokeWidth="1.8" />
    <circle cx="16" cy="9" fill="#0b1a20" r="2" />
  </svg>
);

const HEART = "M0 -3.2a3.2 3.2 0 0 1 5.6 -2 3.2 3.2 0 0 1 5.6 2c0 3.4 -5.6 7 -5.6 7s-5.6 -3.6 -5.6 -7z";

// One post as the feed draws it: an avatar, a name, a line of role, the words.
const Post = ({ x, y, width = 250, lines = 3, accent = false, quote = false }) => (
  <g style={{ transform: `translate(${x}px, ${y}px)` }}>
    <rect fill={ROSTRA_CARD} height={quote ? 112 : 70} rx="10" stroke={LINE} width={width} />
    <circle cx="20" cy="20" fill={accent ? "rgba(43,193,243,0.2)" : SLATE} r="10" stroke={accent ? ROSTRA_ACCENT : LINE} />
    <rect fill={ROSTRA_INK} height="6" opacity="0.85" rx="3" width="70" x="38" y="12" />
    <rect fill={BAR_SOFT} height="4" rx="2" width="46" x="114" y="13" />
    <rect fill={BAR} height="4" rx="2" width="54" x="38" y="23" />
    {Array.from({ length: lines }, (_, at) => (
      <rect fill={BAR} height="4.5" key={at} rx="2.2" width={at === lines - 1 ? width * 0.45 : width - 50} x="38" y={36 + at * 9} />
    ))}
    {quote && (
      <g>
        <rect fill="none" height="38" rx="7" stroke="rgba(238,243,245,0.22)" width={width - 50} x="38" y="64" />
        <circle cx="49" cy="74" fill={SLATE} r="5" stroke={ROSTRA_ACCENT} />
        <rect fill={ROSTRA_INK} height="4" opacity="0.7" rx="2" width="44" x="59" y="72" />
        <rect fill={BAR_SOFT} height="3.5" rx="1.7" width={width - 80} x="46" y="85" />
        <rect fill={BAR_SOFT} height="3.5" rx="1.7" width={(width - 80) * 0.6} x="46" y="92" />
      </g>
    )}
  </g>
);

// The feed page's picture.
const FeedScene = ({ still, narrow }) => {
  const [likes, setLikes] = useState(1204);
  const [liked, setLiked] = useState(false);
  const [beat, setBeat] = useState(0);
  const like = () => {
    setLiked(true);
    setLikes((count) => count + 1);
    setBeat((count) => count + 1);
  };
  return (
    <div style={{ height: "100%", position: "relative" }}>
      <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
        <rect fill={ROSTRA_GROUND} height="220" width="800" />
        {/* The world, its meridians drawing themselves. */}
        <g style={{ transform: "translate(150px, 112px)" }}>
          <circle fill="none" r="92" stroke="rgba(43,193,243,0.35)" strokeWidth="1.4" />
          {[-60, -30, 0, 30, 60].map((tilt, at) => (
            <ellipse
              cx="0"
              cy="0"
              fill="none"
              key={`m${tilt}`}
              rx={Math.abs(Math.cos((tilt * Math.PI) / 180)) * 92 || 1}
              ry="92"
              stroke="rgba(43,193,243,0.2)"
              strokeDasharray="600"
              strokeWidth="1"
              style={{ "--oh-upd-length": 600, ...motion(still, "ohUpdDraw", 1800, 200 + at * 160, "cubic-bezier(0.3, 0, 0.2, 1)") }}
            />
          ))}
          {[-50, -20, 20, 50].map((lat, at) => (
            <line key={`l${lat}`} stroke="rgba(43,193,243,0.16)" strokeDasharray="400" style={{ "--oh-upd-length": 400, ...motion(still, "ohUpdDraw", 1600, 500 + at * 120, "cubic-bezier(0.3, 0, 0.2, 1)") }} x1={-Math.cos((lat * Math.PI) / 180) * 92} x2={Math.cos((lat * Math.PI) / 180) * 92} y1={Math.sin((lat * Math.PI) / 180) * 92} y2={Math.sin((lat * Math.PI) / 180) * 92} />
          ))}
          {/* Voices on it, each a point that pulses. */}
          {[[-40, -30], [30, -52], [55, 20], [-62, 34], [8, 60], [-10, -4]].map(([x, y], at) => (
            <g key={`v${x}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
              <circle fill="none" r="5" stroke={ROSTRA_ACCENT} strokeWidth="1.4" style={{ transformOrigin: "0 0", ...forever(still, "ohUpdRing", 2400, at * 400, "cubic-bezier(0.2, 0.7, 0.2, 1)") }} />
              <circle fill={ROSTRA_ACCENT} r="2.6" />
            </g>
          ))}
        </g>
        {/* The phone, rising from the foot of the picture, its feed scrolling
            up for ever: the same posts twice over, so the turn is seamless. */}
        <g style={{ transform: `translate(${narrow ? 300 : 320}px, 0px)` }}>
          <clipPath id="oh-rostra-screen">
            <rect height="200" rx="20" width="262" x="-6" y="40" />
          </clipPath>
          <rect fill={PHONE} height="250" rx="32" stroke={PHONE_EDGE} strokeWidth="1.5" width="282" x="-16" y="6" />
          <rect fill={PHONE_SCREEN} height="236" rx="25" width="266" x="-8" y="13" />
          <rect fill="#000" height="12" rx="6" width="56" x="97" y="20" />
          <g clipPath="url(#oh-rostra-screen)">
            <g style={{ "--oh-rostra-scroll": "-282px", ...forever(still, "ohRostraScroll", 16000, 900) }}>
              {[0, 282].map((offset) => (
                <g key={`f${offset}`}>
                  <Post accent x={0} y={offset + 44} />
                  <Post lines={2} quote x={0} y={offset + 122} />
                  <Post lines={3} x={0} y={offset + 242} />
                </g>
              ))}
            </g>
          </g>
        </g>
        {/* Hearts and quote marks rising off the feed. */}
        {[[600, 150, 0], [640, 170, 1], [700, 140, 2], [740, 175, 3], [660, 120, 4]].map(([x, y, at]) => (
          <g key={`h${x}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
            <g style={still ? { opacity: at % 2 ? 0.5 : 0.85 } : forever(still, "ohRostraRise", 3200 + at * 300, at * 650, "cubic-bezier(0.2, 0.6, 0.4, 1)")}>
              {at % 2 === 0
                ? <path d={HEART} fill={ROSTRA_ACCENT} />
                : <path d="M0 0h4v4c0 2.4-1.2 3.8-4 4.6M7 0h4v4c0 2.4-1.2 3.8-4 4.6" fill="none" stroke={ROSTRA_INK} strokeLinecap="round" strokeWidth="1.8" />}
            </g>
          </g>
        ))}
        {/* The compose bar: a post being written, its caret, and Post pulsing. */}
        <g style={{ transform: "translate(600px, 38px)" }}>
          <rect fill={ROSTRA_CARD} height="40" rx="20" stroke="rgba(43,193,243,0.45)" width="176" />
          <rect fill={BAR} height="5" rx="2.5" style={{ transformOrigin: "16px 20px", ...forever(still, "ohRostraType", 2600, 600, "cubic-bezier(0.4, 0, 0.6, 1)") }} width="86" x="16" y="17.5" />
          <rect fill={ROSTRA_ACCENT} height="14" style={forever(still, "ohRostraCaret", 1000, 0)} width="1.6" x="106" y="13" />
          <rect fill={ROSTRA_ACCENT} height="24" rx="12" style={forever(still, "ohUpdPulse", 1800, 0, "cubic-bezier(0.4, 0, 0.6, 1)")} width="44" x="124" y="8" />
        </g>
      </svg>
      {/* The heart under the first post, which answers a touch. */}
      <button
        aria-label="Like"
        className="oh-tap"
        onClick={like}
        style={{
          alignItems: "center",
          background: "rgba(14,20,24,0.82)",
          border: `1px solid ${liked ? ROSTRA_ACCENT : "rgba(238,243,245,0.22)"}`,
          borderRadius: "999px",
          bottom: "0.7rem",
          color: liked ? ROSTRA_ACCENT : ROSTRA_SOFT,
          cursor: "pointer",
          display: "flex",
          fontFamily: ROSTRA_FACE,
          fontSize: "0.78rem",
          fontWeight: 700,
          gap: "0.35rem",
          padding: "0.3rem 0.7rem",
          position: "absolute",
          right: "0.8rem",
        }}
        type="button"
      >
        <svg aria-hidden="true" height="16" key={beat} style={beat ? motion(still, "ohUpdStrike", 420, 0, "cubic-bezier(0.3, 0, 0.3, 1)") : undefined} viewBox="-1 -7 13.2 15" width="16">
          <path d={HEART} fill={liked ? ROSTRA_ACCENT : "none"} stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span data-no-translate>{likes.toLocaleString()}</span>
      </button>
    </div>
  );
};

// The desk page's picture: the Actions panel with its two tabs.
const DeskScene = ({ still }) => (
  <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
    <rect fill={ROSTRA_GROUND} height="220" width="800" />
    {/* The panel. */}
    <g style={{ transform: "translate(250px, 18px)" }}>
      <rect fill={ROSTRA_CARD} height="190" rx="14" stroke={LINE} width="300" />
      {/* Its two tabs, an order's spark and the board's sheet, the marker sliding between them. */}
      <g style={{ "--oh-rostra-slide": "96px", ...(still ? { transform: "translateX(96px)" } : forever(still, "ohRostraSlide", 6000, 800, "cubic-bezier(0.6, 0, 0.3, 1)")) }}>
        <rect fill="#0b0f12" height="28" rx="8" stroke="rgba(238,243,245,0.3)" width="88" x="14" y="12" />
      </g>
      <g style={{ transform: "translate(34px, 18px)" }}>
        <path d="M8 1l1.4 3.6L13 6l-3.6 1.1L8 11 6.6 7.1 3 6l3.6-1.4z" fill="none" stroke={ROSTRA_INK} strokeLinejoin="round" strokeWidth="1.4" />
        <rect fill={ROSTRA_INK} height="4.5" opacity="0.7" rx="2" width="34" x="20" y="4" />
      </g>
      <g style={{ transform: "translate(128px, 17px)" }}>
        <rect fill="none" height="15" rx="2" stroke={ROSTRA_INK} strokeWidth="1.4" width="12" x="1" y="0" />
        <path d="M4 5h6M4 8.5h6M4 12h3.5" stroke={ROSTRA_INK} strokeLinecap="round" strokeWidth="1.2" />
        <rect fill={ROSTRA_INK} height="4.5" opacity="0.7" rx="2" width="38" x="20" y="5" />
      </g>
      <line stroke={LINE} x1="0" x2="300" y1="52" y2="52" />
      {/* The board: entries, each with its progress filling. */}
      {[0.72, 0.4, 0.88, 0.55].map((share, at) => (
        <g key={`p${share}`} style={{ transform: `translate(16px, ${64 + at * 31}px)` }}>
          <rect fill={SLATE} height="25" rx="6" width="268" />
          <rect fill={ROSTRA_INK} height="4.5" opacity="0.7" rx="2" width={90 + at * 14} x="10" y="6" />
          <rect fill={BAR_SOFT} height="4" rx="2" width="180" x="10" y="15" />
          <rect fill={ROSTRA_ACCENT} height="4" rx="2" style={{ transformOrigin: "10px 17px", ...motion(still, "ohUpdGrow", 1400, 600 + at * 220, "cubic-bezier(0.3, 0, 0.2, 1)") }} width={180 * share} x="10" y="15" />
          <circle cx="250" cy="12.5" fill="none" r="5" stroke={at === 2 ? ROSTRA_ACCENT : "rgba(238,243,245,0.3)"} strokeWidth="1.4" />
        </g>
      ))}
    </g>
    {/* The phone Listen in was, Rostra's mark lighting up on its screen. */}
    <g style={{ transform: "translate(620px, 46px)" }}>
      <rect fill={PHONE} height="120" rx="14" stroke={PHONE_EDGE} strokeWidth="1.2" width="68" />
      <rect fill={PHONE_SCREEN} height="112" rx="10" width="60" x="4" y="4" />
      <rect fill="#000" height="5" rx="2.5" width="18" x="25" y="8" />
      <rect fill="rgba(238,243,245,0.6)" height="2.5" rx="1.25" width="22" x="23" y="111" />
      <g style={{ transform: "translate(6px, 30px)" }}>
        <g style={motion(still, "ohUpdStamp", 900, 1600, "cubic-bezier(0.2, 0.7, 0.2, 1)")}>
          <path d="M10 2h36a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H24l-11 9v-9h-3a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z" fill={ROSTRA_ACCENT} />
          <path d="M21 34h14l-2-12h-10z" fill="#0b1a20" />
          <path d="M17 22h22" stroke="#0b1a20" strokeLinecap="round" strokeWidth="2.6" />
          <circle cx="28" cy="14" fill="#0b1a20" r="3" />
        </g>
      </g>
    </g>
    {/* The dock's three launchers, the third lit. */}
    <g style={{ transform: "translate(70px, 150px)" }}>
      <rect fill={ROSTRA_CARD} height="44" rx="12" stroke={LINE} width="138" />
      {[0, 1, 2].map((at) => (
        <rect fill={at === 2 ? "rgba(43,193,243,0.2)" : SLATE} height="32" key={`d${at}`} rx="8" stroke={at === 2 ? ROSTRA_ACCENT : LINE} style={at === 2 ? forever(still, "ohUpdPulse", 2000, 0, "cubic-bezier(0.4, 0, 0.6, 1)") : undefined} width="36" x={8 + at * 44} y="6" />
      ))}
    </g>
  </svg>
);

const Rostra = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const desk = banner.scene === "desk";
  return (
    <Plate surface={{ background: ROSTRA_GROUND, border: "1px solid rgba(43,193,243,0.28)", borderRadius: "14px" }}>
      <Brackets colour={ROSTRA_ACCENT} inset="0.7rem" length="1.4rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `2px solid ${ROSTRA_ACCENT}`, height: narrow ? "10.5rem" : "clamp(11.5rem, 24vw, 15rem)", overflow: "hidden", position: "relative" }}>
        {desk ? <DeskScene still={still} /> : <FeedScene narrow={narrow} still={still} />}
      </Reveal>
      <div style={{ fontFamily: ROSTRA_FACE, padding: narrow ? "1.1rem 1.1rem 1.3rem" : "1.4rem 2rem 1.7rem" }}>
        <Reveal delay={300} style={{ alignItems: "center", display: "flex", gap: narrow ? "0.75rem" : "1rem" }}>
          <span style={{ flex: "0 0 auto", ...motion(still, "ohUpdTurn", 800, 260) }}><Mark size={narrow ? 38 : 48} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: ROSTRA_ACCENT, fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
              Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
            </div>
            <div style={{ color: ROSTRA_INK, fontSize: narrow ? "2rem" : "clamp(2.2rem, 5.5vw, 3.1rem)", fontWeight: 900, letterSpacing: "-0.01em", lineHeight: 1.04, marginTop: "0.15rem", ...motion(still, "ohUpdFade", 500, 380) }}>{banner.title}</div>
            {banner.subtitle && <div style={{ color: ROSTRA_SOFT, fontSize: "1.02rem", marginTop: "0.25rem" }}>{banner.subtitle}</div>}
          </div>
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: ROSTRA_SOFT, fontSize: "0.98rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={ROSTRA_FAINT}>
          <span style={{ color: ROSTRA_ACCENT, display: "inline-flex" }}>{desk ? ICONS.book(18) : ICONS.people(18)}</span>
        </Rule>
        <FeatureCards
          accent={ROSTRA_ACCENT}
          caps={false}
          columns={narrow ? "1fr" : "repeat(2, minmax(0, 1fr))"}
          card={{ background: "rgba(43,193,243,0.04)", border: "1px solid rgba(43,193,243,0.18)", borderRadius: "12px" }}
          delay={520}
          font={ROSTRA_FACE}
          sections={banner.sections ?? []}
          soft={ROSTRA_SOFT}
        />
      </div>
    </Plate>
  );
};

export default Rostra;
