/*! Open Historia — The AI overhaul: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make a major update annoucement for the whole ai optimization" (the owner, 2026-11-07): the time skips that send
// less and keep their history, the related past events and older conversations found on the device, and the AI's
// setup, its one switch for keys without a request limit, and the limit on edited prompts.
//
// Three pages, told apart by the banner's `scene`, on a signal desk at night (aiOverhaulChrome.js):
//   skips   a time skip's request as a stack of bars: its unchanging opening locked in the cache, the live part below
//           it trimmed to what the turn is about, packets running to the AI along a circuit, and beside it the
//           history in tiers, the years folding into eras over a canon line that never fades.
//   memory  a timeline of past events; from the present a beam reaches back and lights the few that bear on the
//           turn, and an archive drawer holds the old conversations, their promises pinned on top.
//   setup   the three choices as cards, the recommended one lit, and the switch for a key without a request limit
//           turning on, with a prompt's length meter filling to its line.
// With Reduce motion nothing moves: each page is drawn as it ends. Flat shapes only: no gradient, nothing purple.

import React from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { AI_FACE, AI_FAINT, AI_GROUND, AI_INK, AI_LINE, AI_MONO, AI_PANEL, AI_SIGNAL, AI_SOFT, AI_WARM } from "./aiOverhaulChrome.js";

// The theme's own motions, beside the kit's: a packet running along a wire, a bar trimmed to its new length, a beam
// reaching back and fading, and a switch's knob crossing over.
const STYLE_ID = "oh-update-ai-overhaul-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  @keyframes ohAiPacket { 0% { opacity: 0; transform: translateX(0); } 12% { opacity: 1; } 88% { opacity: 1; } 100% { opacity: 0; transform: translateX(var(--oh-ai-run, 200px)); } }
  @keyframes ohAiTrim { 0%, 25% { transform: scaleX(1); } 60%, 100% { transform: scaleX(var(--oh-ai-to, 0.5)); } }
  @keyframes ohAiBeam { 0% { stroke-dashoffset: var(--oh-upd-length, 400); opacity: 1; } 45% { stroke-dashoffset: 0; opacity: 1; } 80% { stroke-dashoffset: 0; opacity: 0.9; } 100% { stroke-dashoffset: 0; opacity: 0; } }
  @keyframes ohAiLight { 0%, 40% { opacity: 0.25; } 55%, 85% { opacity: 1; } 100% { opacity: 0.25; } }
  @keyframes ohAiKnob { 0%, 30% { transform: translateX(0); } 45%, 100% { transform: translateX(var(--oh-ai-run, 22px)); } }
  @keyframes ohAiTrack { 0%, 30% { opacity: 0; } 45%, 100% { opacity: 1; } }
  @keyframes ohAiFill { 0%, 10% { transform: scaleX(0.1); } 70%, 100% { transform: scaleX(var(--oh-ai-to, 1)); } }
  `;
  document.head.appendChild(style);
}

const WIRE = "rgba(43,193,243,0.18)";
const DIM = "rgba(238,244,247,0.1)";
const BAR = "rgba(238,244,247,0.28)";

// A repeating motion of the theme's own, its timing given in full.
const loop = (still, name, ms, delay = 0, timing = "cubic-bezier(0.4, 0, 0.2, 1)") => (still ? {} : { animation: [name, `${ms}ms`, timing, `${delay}ms`, "infinite", "both"].join(" ") });

// The circuit behind every page: hairline traces with their pads, and a few diodes blinking.
const Circuit = ({ still }) => (
  <g>
    {[
      "M0 30 H120 L140 50 H260", "M0 196 H90 L110 176 H210", "M800 40 H690 L670 60 H560", "M800 186 H700 L680 206 H600",
      "M330 0 V24 L350 44", "M470 220 V196 L450 176",
    ].map((d, index) => (
      <path d={d} fill="none" key={d} stroke={WIRE} strokeDasharray="420" strokeWidth="1.2" style={{ "--oh-upd-length": 420, ...motion(still, "ohUpdDraw", 1600, 100 + index * 120, "cubic-bezier(0.3, 0, 0.2, 1)") }} />
    ))}
    {[[260, 50], [210, 176], [560, 60], [600, 206], [350, 44], [450, 176]].map(([x, y], index) => (
      <g key={`p${x}`}>
        <circle cx={x} cy={y} fill={AI_GROUND} r="3.5" stroke={AI_LINE} strokeWidth="1.2" />
        <circle cx={x} cy={y} fill={AI_SIGNAL} r="1.6" style={forever(still, "ohUpdTwinkle", 2600, index * 430, "cubic-bezier(0.4, 0, 0.6, 1)")} />
      </g>
    ))}
  </g>
);

// A small padlock: the opening the AI service keeps.
const Lock = ({ x, y, colour }) => (
  <g style={{ transform: `translate(${x}px, ${y}px)` }}>
    <path d="M3 7 V4.5 a4 4 0 0 1 8 0 V7" fill="none" stroke={colour} strokeWidth="1.6" />
    <rect fill={colour} height="8" rx="1.5" width="12" x="1" y="7" />
  </g>
);

// The skips page: the request trimmed, packets to the AI, and the history in tiers over its canon.
const SkipsScene = ({ still, narrow }) => {
  const live = [0.92, 0.7, 0.84, 0.6, 0.76];
  const trimmed = [0.5, 0.42, 0.62, 0.3, 0.44];
  return (
    <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
      <rect fill={AI_GROUND} height="220" width="800" />
      <Circuit still={still} />
      {/* The request: its opening locked in the cache, its live part trimmed to the turn. */}
      <g style={{ transform: narrow ? "translate(250px, 26px) scale(0.86)" : "translate(150px, 26px)" }}>
        <rect fill={AI_PANEL} height="172" rx="6" stroke={AI_LINE} width="230" />
        <rect fill="rgba(43,193,243,0.1)" height="58" rx="4" stroke={AI_SIGNAL} strokeWidth="1.2" width="206" x="12" y="12" />
        {[0, 1, 2, 3].map((row) => (
          <rect fill="rgba(43,193,243,0.45)" height="5" key={`c${row}`} rx="2.5" width={150 - (row % 2) * 34} x="24" y={22 + row * 11} />
        ))}
        <Lock colour={AI_SIGNAL} x={196} y={20} />
        {live.map((full, row) => (
          <rect
            fill={BAR}
            height="9"
            key={`l${row}`}
            rx="2"
            style={{ transformOrigin: "0% 50%", transform: still ? `scaleX(${trimmed[row] / full})` : undefined, "--oh-ai-to": trimmed[row] / full, ...loop(still, "ohAiTrim", 5200, 400 + row * 120) }}
            width={206 * full}
            x="12"
            y={82 + row * 17}
          />
        ))}
      </g>
      {/* Packets running from the request to the AI along a wire. */}
      <g style={{ transform: narrow ? "translate(450px, 104px)" : "translate(390px, 104px)" }}>
        <path d={narrow ? "M0 8 H120" : "M0 8 H150"} stroke={AI_LINE} strokeWidth="1.5" />
        {[0, 1, 2].map((index) => (
          <rect fill={AI_SIGNAL} height="6" key={`k${index}`} rx="1.5" style={{ "--oh-ai-run": narrow ? "110px" : "140px", opacity: still ? 0 : undefined, ...loop(still, "ohAiPacket", 2400, index * 800, "linear") }} width="12" y="5" />
        ))}
        {/* The AI: a chip, its pins and a ring that breathes. */}
        <g style={{ transform: narrow ? "translate(128px, -22px)" : "translate(158px, -22px)" }}>
          {[8, 20, 32, 44].map((at) => (
            <g key={`n${at}`}>
              <path d={`M${at} -6 V0 M${at} 60 V66 M-6 ${at} H0 M60 ${at} H66`} stroke={AI_LINE} strokeWidth="1.5" />
            </g>
          ))}
          <rect fill={AI_PANEL} height="60" rx="6" stroke={AI_SIGNAL} strokeWidth="1.4" width="60" />
          <circle cx="30" cy="30" fill="none" r="13" stroke={AI_SIGNAL} strokeWidth="2" style={forever(still, "ohUpdPulse", 2400, 0, "cubic-bezier(0.4, 0, 0.6, 1)")} />
          <circle cx="30" cy="30" fill={AI_SIGNAL} r="4" />
        </g>
      </g>
      {/* The history in tiers: years in detail, folding into eras, over the canon line that never fades. */}
      {!narrow && (
        <g style={{ transform: "translate(640px, 30px)" }}>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <rect fill={row < 3 ? BAR : DIM} height={row < 3 ? 7 : 5} key={`h${row}`} rx="2" style={motion(still, "ohUpdFade", 500, 900 + row * 140)} width={row < 3 ? 118 - row * 10 : 70 - (row - 3) * 16} y={row * 16} />
          ))}
          <rect fill="none" height="132" rx="4" stroke={AI_FAINT} width="132" x="-8" y="-8" />
          <path d="M0 116 H116" stroke={AI_WARM} strokeDasharray="120" strokeLinecap="round" strokeWidth="4" style={{ "--oh-upd-length": 120, ...motion(still, "ohUpdDraw", 1200, 1700, "cubic-bezier(0.3, 0, 0.2, 1)") }} />
          {[16, 52, 88].map((x, index) => (
            <circle cx={x} cy="116" fill={AI_GROUND} key={`f${x}`} r="4.5" stroke={AI_WARM} strokeWidth="2" style={motion(still, "ohUpdStamp", 500, 2200 + index * 180)} />
          ))}
        </g>
      )}
    </svg>
  );
};

// The memory page: the timeline, a beam from the present lighting the related events, and the archive drawer.
const EVENTS = Object.freeze([40, 72, 96, 130, 158, 190, 214, 250, 282, 308, 340, 372, 398, 430, 462]);
const RELATED = Object.freeze([1, 5, 9, 12]);
const MemoryScene = ({ still, narrow }) => {
  const now = narrow ? 470 : 520;
  return (
    <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
      <rect fill={AI_GROUND} height="220" width="800" />
      <Circuit still={still} />
      <g style={{ transform: narrow ? "translate(170px, 0px) scale(0.9)" : "translate(40px, 0px)" }}>
        {/* The timeline, drawn from the oldest event to the present. */}
        <path d={`M20 150 H${now}`} stroke={AI_FAINT} strokeDasharray="560" strokeWidth="2" style={{ "--oh-upd-length": 560, ...motion(still, "ohUpdDraw", 1400, 150, "cubic-bezier(0.3, 0, 0.2, 1)") }} />
        {EVENTS.map((x, index) => (
          <circle cx={x} cy="150" fill={RELATED.includes(index) ? AI_SIGNAL : AI_PANEL} key={`e${x}`} r={RELATED.includes(index) ? 6 : 4.5} stroke={RELATED.includes(index) ? AI_SIGNAL : BAR} strokeWidth="1.4" style={RELATED.includes(index) ? loop(still, "ohAiLight", 4800, 0) : motion(still, "ohUpdFade", 400, 200 + index * 50)} />
        ))}
        {/* The present, and the beams reaching back to what bears on the turn. */}
        <g>
          <circle cx={now} cy="150" fill={AI_SIGNAL} r="8" />
          <circle cx={now} cy="150" fill="none" r="8" stroke={AI_SIGNAL} strokeWidth="1.5" style={forever(still, "ohUpdRing", 2400, 0, "cubic-bezier(0.2, 0.7, 0.2, 1)")} />
        </g>
        {RELATED.map((index, at) => {
          const x = EVENTS[index];
          const lift = 40 + at * 16;
          const d = `M${now} 142 C ${now - 40} ${150 - lift * 2}, ${x + 40} ${150 - lift * 2}, ${x} 144`;
          return <path d={d} fill="none" key={`b${x}`} stroke={AI_SIGNAL} strokeDasharray="600" strokeLinecap="round" strokeWidth="1.6" style={{ "--oh-upd-length": 600, ...loop(still, "ohAiBeam", 4800, at * 120) }} />;
        })}
      </g>
      {/* The archive drawer: the old conversations kept on the device, their promises pinned on top. */}
      {!narrow && (
        <g style={{ transform: "translate(616px, 44px)" }}>
          <rect fill={AI_PANEL} height="132" rx="6" stroke={AI_LINE} width="140" />
          {[0, 1, 2].map((row) => (
            <g key={`d${row}`} style={{ transform: `translate(10px, ${38 + row * 30}px)` }}>
              <rect fill="none" height="24" rx="3" stroke={AI_FAINT} width="120" />
              <rect fill={BAR} height="4" rx="2" width="12" x="54" y="10" />
              {/* Speech marks: each drawer a conversation. */}
              <path d="M10 7 h18 v8 h-10 l-4 4 v-4 h-4 z" fill="none" stroke={AI_SOFT} strokeLinejoin="round" strokeWidth="1.2" />
            </g>
          ))}
          {/* The promise slip: what was agreed, always in view. */}
          <g style={motion(still, "ohUpdStamp", 600, 1400)}>
            <rect fill={AI_WARM} height="22" rx="3" width="96" x="22" y="8" />
            <rect fill={AI_GROUND} height="4" rx="2" width="52" x="32" y="14" />
            <rect fill={AI_GROUND} height="4" rx="2" width="34" x="32" y="21" />
            <circle cx="106" cy="19" fill={AI_GROUND} r="4" />
          </g>
        </g>
      )}
    </svg>
  );
};

// The setup page: the three choices, the recommended one lit; the switch turning on; a prompt's length meter.
const SetupScene = ({ still, narrow }) => (
  <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
    <rect fill={AI_GROUND} height="220" width="800" />
    <Circuit still={still} />
    <g style={{ transform: narrow ? "translate(262px, 30px) scale(0.78)" : "translate(110px, 34px)" }}>
      {[0, 1, 2].map((card) => {
        const lit = card === 1;
        return (
          <g key={`s${card}`} style={{ transform: `translate(${card * 122}px, ${lit ? -10 : 0}px)` }}>
            <g style={motion(still, "ohUpdRise", 600, 300 + card * 150)}>
              <rect fill={lit ? "rgba(43,193,243,0.1)" : AI_PANEL} height={lit ? 160 : 140} rx="8" stroke={lit ? AI_SIGNAL : AI_FAINT} strokeWidth={lit ? 2 : 1.2} width="108" />
              {/* Its mark: a spark for the free choice, a star for the recommended one, a slider for Custom. */}
              {card === 0 && <path d="M54 22 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6 l14 -6 z" fill="none" stroke={AI_SOFT} strokeLinejoin="round" strokeWidth="1.6" />}
              {card === 1 && <path d="M54 18 l7 15 16 2 -12 11 3 16 -14 -8 -14 8 3 -16 -12 -11 16 -2 z" fill={AI_SIGNAL} style={forever(still, "ohUpdPulse", 2600, 0, "cubic-bezier(0.4, 0, 0.6, 1)")} />}
              {card === 2 && (
                <g>
                  {[26, 40, 54].map((y, index) => <path d={`M32 ${y} H76`} key={`t${y}`} stroke={AI_FAINT} strokeLinecap="round" strokeWidth="3" />)}
                  {[[44, 26], [64, 40], [38, 54]].map(([x, y]) => <circle cx={x} cy={y} fill={AI_PANEL} key={`o${x}${y}`} r="4.5" stroke={AI_SOFT} strokeWidth="1.6" />)}
                </g>
              )}
              <rect fill={lit ? AI_INK : BAR} height="6" rx="3" width="64" x="22" y="84" />
              <rect fill={DIM} height="4" rx="2" width="76" x="16" y="98" />
              <rect fill={DIM} height="4" rx="2" width="52" x="28" y="108" />
              {lit && (
                <g>
                  <rect fill={AI_SIGNAL} height="18" rx="3" width="80" x="14" y="128" />
                  <path d="M44 137 l5 5 l10 -10" fill="none" stroke={AI_GROUND} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" style={{ "--oh-upd-length": 30, strokeDasharray: 30, ...motion(still, "ohUpdDraw", 500, 1300) }} />
                </g>
              )}
            </g>
          </g>
        );
      })}
    </g>
    {/* The switch for a key without a request limit, and a prompt's length meter filling to its line. */}
    {!narrow && (
      <g style={{ transform: "translate(520px, 50px)" }}>
        <rect fill={AI_PANEL} height="54" rx="6" stroke={AI_LINE} width="200" />
        <rect fill={BAR} height="6" rx="3" width="96" x="16" y="18" />
        <rect fill={DIM} height="4" rx="2" width="70" x="16" y="30" />
        <g style={{ transform: "translate(140px, 15px)" }}>
          <rect fill={DIM} height="24" rx="12" stroke={AI_FAINT} width="46" />
          <rect fill={AI_SIGNAL} height="24" rx="12" style={still ? undefined : loop(still, "ohAiTrack", 6000, 400)} width="46" />
          <circle cx="12" cy="12" fill={AI_INK} r="9" style={{ "--oh-ai-run": "22px", transform: still ? "translateX(22px)" : undefined, ...loop(still, "ohAiKnob", 6000, 400) }} />
        </g>
        <g style={{ transform: "translate(0px, 74px)" }}>
          <rect fill={AI_PANEL} height="54" rx="6" stroke={AI_LINE} width="200" />
          <rect fill={DIM} height="8" rx="4" width="168" x="16" y="30" />
          <rect fill={AI_SIGNAL} height="8" rx="4" style={{ transformOrigin: "0% 50%", transform: still ? "scaleX(0.82)" : undefined, "--oh-ai-to": 0.82, ...loop(still, "ohAiFill", 6000, 600) }} width="168" x="16" y="30" />
          {/* The line a passage may not cross: 20% past the built-in one. */}
          <path d="M156 22 V44" stroke={AI_WARM} strokeLinecap="round" strokeWidth="2.4" />
          <rect fill={BAR} height="5" rx="2.5" width="80" x="16" y="14" />
        </g>
      </g>
    )}
  </svg>
);

const SCENES = Object.freeze({ skips: SkipsScene, memory: MemoryScene, setup: SetupScene });
const SCENE_ICON = Object.freeze({ skips: "gear", memory: "book", setup: "star" });

const AiOverhaul = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const Scene = SCENES[banner.scene] ?? SkipsScene;
  const icon = ICONS[SCENE_ICON[banner.scene] ?? "gear"];
  return (
    <Plate surface={{ background: AI_GROUND, border: `1px solid ${AI_LINE}`, borderRadius: "8px" }}>
      <Brackets colour={AI_SIGNAL} inset="0.6rem" length="1.2rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `1px solid ${AI_SIGNAL}`, height: narrow ? "10rem" : "clamp(11rem, 23vw, 14.5rem)", overflow: "hidden", position: "relative" }}>
        <Scene narrow={narrow} still={still} />
      </Reveal>
      <div style={{ fontFamily: AI_FACE, padding: narrow ? "1.1rem 1.1rem 1.3rem" : "1.4rem 2rem 1.7rem" }}>
        <Reveal delay={300} style={{ alignItems: "center", display: "flex", gap: narrow ? "0.75rem" : "1rem" }}>
          <span style={{ border: `1px solid ${AI_LINE}`, borderRadius: "6px", color: AI_SIGNAL, display: "inline-flex", flex: "0 0 auto", padding: "0.35rem", ...motion(still, "ohUpdTurn", 800, 260) }}>{icon(narrow ? 30 : 38)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: AI_SIGNAL, fontFamily: AI_MONO, fontSize: "0.76rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
              Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
            </div>
            <div style={{ color: AI_INK, fontSize: narrow ? "1.9rem" : "clamp(2.1rem, 5.2vw, 3rem)", fontWeight: 900, letterSpacing: "-0.01em", lineHeight: 1.04, marginTop: "0.15rem", ...motion(still, "ohUpdFade", 500, 380) }}>{banner.title}</div>
            {banner.subtitle && <div style={{ color: AI_SOFT, fontSize: "1.02rem", marginTop: "0.25rem" }}>{banner.subtitle}</div>}
          </div>
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: AI_SOFT, fontSize: "0.98rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={AI_FAINT}>
          <span style={{ background: AI_SIGNAL, borderRadius: "2px", display: "inline-block", height: "0.5rem", width: "0.5rem", ...forever(still, "ohUpdPulse", 2400, 0, "cubic-bezier(0.4, 0, 0.6, 1)") }} />
        </Rule>
        <FeatureCards
          accent={AI_SIGNAL}
          caps={false}
          columns={narrow ? "1fr" : (banner.sections ?? []).length === 4 ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(13.5rem, 1fr))"}
          card={{ background: "rgba(43,193,243,0.04)", border: `1px solid ${AI_LINE}`, borderRadius: "6px" }}
          delay={520}
          font={AI_FACE}
          sections={banner.sections ?? []}
          soft={AI_SOFT}
        />
      </div>
    </Plate>
  );
};

export default AiOverhaul;
