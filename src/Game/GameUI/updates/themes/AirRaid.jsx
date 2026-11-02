/*! Open Historia — Deploy Aircraft: its banner behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so in the war room you can Deploy Aircraft ... make it so they can
// be intercepted and if they are, the "fighters" in the air unit have a
// simulated battle to see what happens" (the owner, 2026-11-01).
//
// A raid by night: a city's roofs along the foot of the picture, its
// searchlights sweeping a sky with a pale moon in it. A formation of bombers
// crosses from the left, over and over, and fighters climb from the city to
// meet it; flak bursts round them, and bombs fall away under the bombers. With
// Reduce motion nothing moves: the raid is drawn as it stands over the city.
//
// Flat shapes only: nothing is a gradient, nothing purple.

import React from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { AIR_RAID_FACE, AIR_RAID_FLAK, AIR_RAID_MOON, AIR_RAID_MOON_SOFT, AIR_RAID_NIGHT } from "./airRaidChrome.js";

const ROOFS = "#05090f";
const WINDOWS = "#e9c46a";
const BEAM = "rgba(233,227,207,0.09)";
const BOMBER = "#1f2a38";
const FIGHTER = "#3c4f66";
// How long the bombers take to cross, and the fighters to climb.
const CROSS_MS = 9000;
const CLIMB_MS = 4200;

// A bomber from above, and a fighter, in flat shapes.
const Bomber = () => <path d="M0 -3 L16 -3 L20 0 L16 3 L0 3 Z M6 -14 L10 -14 L12 -3 L8 -3 Z M6 14 L10 14 L12 3 L8 3 Z M0 -6 L3 -6 L3 6 L0 6 Z" fill={BOMBER} stroke={AIR_RAID_MOON} strokeOpacity="0.4" strokeWidth="0.6" />;
const Fighter = () => <path d="M0 -1.6 L10 -1.6 L12 0 L10 1.6 L0 1.6 Z M4 -7 L6.5 -7 L7.5 -1.6 L5 -1.6 Z M4 7 L6.5 7 L7.5 1.6 L5 1.6 Z" fill={FIGHTER} stroke={AIR_RAID_MOON} strokeOpacity="0.5" strokeWidth="0.5" />;

// The roofs of the city along the foot: a row of blocks of every height, some windows lit.
const BLOCKS = Array.from({ length: 26 }, (_, at) => ({ x: at * 31, w: 24 + ((at * 7) % 9), h: 20 + ((at * 37) % 46) }));

const Sky = ({ still }) => (
  <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
    <rect fill={AIR_RAID_NIGHT} height="220" width="800" />
    {/* Stars, and the moon. */}
    {Array.from({ length: 28 }, (_, at) => (
      <circle cx={(at * 97) % 800} cy={6 + ((at * 41) % 110)} fill={AIR_RAID_MOON} key={`s${at}`} r={at % 4 === 0 ? 1.3 : 0.8} style={forever(still, "ohUpdTwinkle", 2600 + (at % 5) * 280, at * 150, "cubic-bezier(0.4, 0, 0.6, 1)")} />
    ))}
    <circle cx="664" cy="46" fill={AIR_RAID_MOON} r="22" />
    <circle cx="656" cy="40" fill={AIR_RAID_NIGHT} opacity="0.12" r="6" />
    {/* The searchlights, sweeping. */}
    {[[150, -14], [430, 10], [610, -6]].map(([x, tilt], at) => (
      <g key={`b${x}`} style={{ transform: `translate(${x}px, 214px) rotate(${tilt}deg)`, transformOrigin: "0 0" }}>
        <path d="M-4 0 L-46 -230 L46 -230 L4 0 Z" fill={BEAM} style={{ transformOrigin: "0 0", ...forever(still, "ohUpdSway", 5200 + at * 900, at * 600, "cubic-bezier(0.45, 0, 0.55, 1)") }} />
      </g>
    ))}
    {/* The bombers, crossing in formation. */}
    <g style={{ "--oh-upd-from": "-160px", "--oh-upd-to": "880px", ...(still ? { transform: "translateX(300px)" } : forever(still, "ohUpdDrift", CROSS_MS, 0)) }}>
      {[[0, 70], [-30, 52], [-30, 88], [-60, 36], [-60, 104]].map(([x, y]) => (
        <g key={`p${x}${y}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
          <Bomber />
          {/* What falls away under it. */}
          <circle cx="8" cy="10" fill={AIR_RAID_MOON} r="1.3" style={{ "--oh-upd-fall": "120px", ...forever(still, "ohUpdFall", 1800, ((x + y) * 13) % 900, "cubic-bezier(0.5, 0, 1, 1)") }} />
        </g>
      ))}
    </g>
    {/* The fighters that rise against them, and the flak round them. */}
    {[[260, 1], [360, 0], [520, 2]].map(([x, at]) => (
      <g key={`f${x}`} style={{ transform: `translate(${x}px, 150px) rotate(-38deg)`, transformOrigin: "0 0" }}>
        <g style={{ "--oh-upd-from": "0px", "--oh-upd-to": "140px", ...(still ? { transform: "translateX(70px)" } : forever(still, "ohUpdDrift", CLIMB_MS, at * 700, "cubic-bezier(0.3, 0, 0.6, 1)")) }}>
          <Fighter />
        </g>
      </g>
    ))}
    {[[300, 64], [470, 40], [380, 98], [560, 76], [220, 44]].map(([x, y], at) => (
      <g key={`k${x}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
        <circle fill="none" r="9" stroke={AIR_RAID_FLAK} strokeWidth="2" style={{ transformOrigin: "0 0", ...forever(still, "ohUpdRing", 1700, at * 340, "cubic-bezier(0.2, 0.7, 0.2, 1)") }} />
        <circle fill={AIR_RAID_FLAK} r="2.4" style={forever(still, "ohUpdPulse", 1700, at * 340, "cubic-bezier(0.4, 0, 0.6, 1)")} />
      </g>
    ))}
    {/* The city. */}
    {BLOCKS.map((block) => (
      <g key={`r${block.x}`}>
        <rect fill={ROOFS} height={block.h} width={block.w} x={block.x} y={220 - block.h} />
        {block.h > 40 && <rect fill={WINDOWS} height="3" opacity="0.7" width="3" x={block.x + 6} y={226 - block.h} />}
        {block.h > 52 && <rect fill={WINDOWS} height="3" opacity="0.5" width="3" x={block.x + 14} y={236 - block.h} />}
      </g>
    ))}
  </svg>
);

const AirRaid = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  return (
    <Plate surface={{ background: AIR_RAID_NIGHT, border: "1px solid rgba(233,227,207,0.22)", borderRadius: "6px" }}>
      <Brackets colour={AIR_RAID_FLAK} inset="0.7rem" length="1.6rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `3px solid ${AIR_RAID_FLAK}`, height: narrow ? "11rem" : "clamp(12rem, 25vw, 16rem)", overflow: "hidden", position: "relative" }}>
        <Sky still={still} />
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: AIR_RAID_FLAK, fontFamily: AIR_RAID_FACE, fontSize: "0.8rem", letterSpacing: "0.22em", textTransform: "uppercase" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: AIR_RAID_MOON, fontFamily: AIR_RAID_FACE, fontSize: narrow ? "2.2rem" : "clamp(2.4rem, 6vw, 3.4rem)", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.02, marginTop: "0.2rem", textTransform: "uppercase", ...motion(still, "ohUpdFade", 500, 380) }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: AIR_RAID_FLAK, fontFamily: AIR_RAID_FACE, fontSize: "1.1rem", letterSpacing: "0.06em", marginTop: "0.25rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: AIR_RAID_MOON_SOFT, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={AIR_RAID_MOON}>
          <span style={{ color: AIR_RAID_FLAK, display: "inline-flex" }}>{ICONS.plane(18)}</span>
        </Rule>
        <FeatureCards
          accent={AIR_RAID_FLAK}
          card={{ background: "rgba(233,227,207,0.05)", border: "1px solid rgba(233,227,207,0.18)", borderRadius: "4px" }}
          delay={520}
          font={AIR_RAID_FACE}
          sections={banner.sections ?? []}
          soft={AIR_RAID_MOON_SOFT}
        />
      </div>
    </Plate>
  );
};

export default AirRaid;
