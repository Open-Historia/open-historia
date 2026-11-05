/*! Open Historia — Swarms: its banner behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "since war fronts havent always existed and there are other types of
// warfare, make it so you can also deploy "armies" which are just groups of
// troops not arranged in a front", "using the deploy tool should give the
// option to do a front or swarm" (the owner, 2026-10-16).
//
// A general's map table: green felt, and laid on it a parchment campaign map
// with a winding border, a compass and the hills drawn in ink. One side's
// counters stand along the border as a front; the other's change between the
// two ways of being deployed, every few seconds: strung along their side of
// the border, a front, then grouped together as two swarms. Every counter
// makes its own way there and sets off when it is ready, as troops do. The two
// ways are keys: touched, the map stays on that one. With Reduce motion
// nothing moves or changes by itself, and a key still shows that way, drawn as
// it stands.
//
// Flat shapes only: nothing is a gradient, nothing purple.

import React, { useEffect, useState } from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { SWARMS_BRASS, SWARMS_PAPER, SWARMS_PAPER_SOFT, SWARMS_SERIF, SWARMS_TABLE } from "./swarmsChrome.js";

// How long the map stays on one way of deploying before it changes.
const FORM_MS = 4600;

// The two sides' colours, and the map's.
const BLUE = "#33557e";
const RED = "#963a2c";
const INK = "#5b4a32";
const LAND_BLUE = "#e2dcc6";
const LAND_RED = "#ead9c1";
const GRID = "#d5c6a2";

// Where the two swarms stand: on a phone higher and nearer the border, clear of the keys in the picture's corner.
const SWARMS_WIDE = [{ x: 286, y: 72 }, { x: 300, y: 156 }];
const SWARMS_NARROW = [{ x: 304, y: 60 }, { x: 318, y: 134 }];
// Where each counter of the side that changes stands, along the front (x, y) and in its swarm: the six of the north
// gather in the northern swarm, the six of the south in the southern one, each on its own place of the block.
const countersFor = (swarms) => Array.from({ length: 12 }, (_, at) => {
  const swarm = swarms[at < 6 ? 0 : 1];
  const place = at % 6;
  return {
    front: { x: 356 + (((at * 37) % 13) - 6), y: 24 + at * 15.6 },
    swarm: { x: swarm.x + ((place % 3) - 1) * 21, y: swarm.y + (place < 3 ? -8 : 8) },
    // Each sets off when it is ready, and goes at its own pace.
    wait: (at * 173) % 640,
    pace: 1050 + ((at * 89) % 520),
  };
});
const COUNTERS_WIDE = countersFor(SWARMS_WIDE);
const COUNTERS_NARROW = countersFor(SWARMS_NARROW);
// The other side, standing along the border as a front.
const THEIRS = Array.from({ length: 11 }, (_, at) => ({ x: 446 + (((at * 29) % 11) - 5), y: 28 + at * 16.4 }));

// A counter: a box with the cross of foot soldiers on it.
const Counter = ({ colour }) => (
  <>
    <rect fill={colour} height="12" rx="1.5" stroke={SWARMS_PAPER} strokeWidth="1.2" width="17" x="-8.5" y="-6" />
    <path d="M-6 -4 L6 4 M-6 4 L6 -4" fill="none" stroke={SWARMS_PAPER} strokeLinecap="round" strokeWidth="1.1" />
  </>
);

const CampaignMap = ({ form, still, narrow }) => {
  const swarmed = form === "swarm";
  const COUNTERS = narrow ? COUNTERS_NARROW : COUNTERS_WIDE;
  return (
    <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
      {/* The two countries, and the border winding between them. */}
      <rect fill={LAND_BLUE} height="220" width="800" />
      <path d="M402 0 C382 40 424 72 398 112 S380 172 406 220 L800 220 L800 0 Z" fill={LAND_RED} />
      {Array.from({ length: 21 }, (_, at) => <line key={`v${at}`} stroke={GRID} strokeWidth="0.6" x1={at * 40} x2={at * 40} y1="0" y2="220" />)}
      {Array.from({ length: 6 }, (_, at) => <line key={`h${at}`} stroke={GRID} strokeWidth="0.6" x1="0" x2="800" y1={at * 40} y2={at * 40} />)}
      <path d="M402 0 C382 40 424 72 398 112 S380 172 406 220" fill="none" stroke={INK} strokeDasharray="7 4 2 4" strokeWidth="1.6" />
      {/* Hills, a river and a compass, in ink. */}
      {[[120, 150], [150, 162], [560, 70], [590, 84], [660, 160], [180, 44]].map(([x, y]) => (
        <path d={`M${x - 12} ${y} l12 -12 l12 12`} fill="none" key={`${x}${y}`} stroke={INK} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
      ))}
      <path d="M0 196 C80 186 130 206 210 192 S330 170 388 182" fill="none" stroke="#7d9bb3" strokeLinecap="round" strokeWidth="3" />
      <g style={{ transform: "translate(724px, 52px)" }}>
        <circle cx="0" cy="0" fill="none" r="22" stroke={INK} strokeWidth="1.2" />
        <path d="M0 -20 L5 0 L0 20 L-5 0 Z" fill={INK} />
        <path d="M-20 0 L0 -4 L20 0 L0 4 Z" fill="none" stroke={INK} strokeWidth="1" />
      </g>

      {/* The other side: a front along the border. */}
      {THEIRS.map((counter) => (
        <g key={`r${counter.y}`} style={{ transform: `translate(${counter.x}px, ${counter.y}px)` }}>
          <Counter colour={RED} />
        </g>
      ))}

      {/* The side that changes: each counter goes its own way, setting off when it is ready. */}
      {COUNTERS.map((counter, at) => {
        const spot = swarmed ? counter.swarm : counter.front;
        return (
          <g
            key={`b${at}`}
            style={{
              transform: `translate(${spot.x}px, ${spot.y}px)`,
              ...(still ? {} : { transition: `transform ${counter.pace}ms cubic-bezier(0.45, 0, 0.25, 1) ${counter.wait}ms` }),
            }}
          >
            <Counter colour={BLUE} />
          </g>
        );
      })}
    </svg>
  );
};

// The two ways as keys: the one shown is lit; touched, the map stays on it.
const FormKeys = ({ form, onPick, narrow }) => (
  <div aria-label="Deploy as" role="group" style={{ bottom: "0.6rem", display: "flex", gap: "0.35rem", left: narrow ? "0.5rem" : "0.7rem", position: "absolute" }}>
    {["front", "swarm"].map((key) => {
      const on = key === form;
      return (
        <button
          aria-pressed={on}
          className="oh-tap"
          key={key}
          onClick={() => onPick(key)}
          style={{
            alignItems: "center",
            background: on ? SWARMS_BRASS : "rgba(22,33,26,0.78)",
            border: `1px solid ${on ? SWARMS_BRASS : "rgba(234,223,196,0.5)"}`,
            borderRadius: "4px",
            color: on ? SWARMS_TABLE : SWARMS_PAPER,
            cursor: "pointer",
            display: "inline-flex",
            fontFamily: SWARMS_SERIF,
            fontSize: narrow ? "0.74rem" : "0.84rem",
            fontWeight: 700,
            gap: "0.3rem",
            minHeight: "2rem",
            padding: narrow ? "0 0.6rem" : "0 0.9rem",
            touchAction: "manipulation",
          }}
          type="button"
        >
          <span aria-hidden="true" style={{ display: "inline-flex" }}>{key === "swarm" ? ICONS.flag(narrow ? 12 : 15) : ICONS.map(narrow ? 12 : 15)}</span>
          {key === "swarm" ? <>Swarm</> : <>Front</>}
        </button>
      );
    })}
  </div>
);

const Swarms = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const [form, setForm] = useState("front");
  const [chosen, setChosen] = useState(false);
  // The map changes by itself until a way is picked, or never where nothing is to move.
  useEffect(() => {
    if (still || chosen) return undefined;
    const timer = setInterval(() => setForm((now) => (now === "front" ? "swarm" : "front")), FORM_MS);
    return () => clearInterval(timer);
  }, [still, chosen]);
  const pick = (key) => {
    setChosen(true);
    setForm(key);
  };
  return (
    <Plate surface={{ background: SWARMS_TABLE, border: "1px solid rgba(234,223,196,0.26)", borderRadius: "8px" }}>
      <Brackets colour={SWARMS_BRASS} inset="0.7rem" length="1.6rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `3px solid ${SWARMS_BRASS}`, height: narrow ? "12rem" : "clamp(13rem, 27vw, 17rem)", overflow: "hidden", position: "relative" }}>
        <CampaignMap form={form} narrow={narrow} still={still} />
        <FormKeys form={form} narrow={narrow} onPick={pick} />
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: SWARMS_BRASS, fontFamily: SWARMS_SERIF, fontSize: "0.8rem", fontVariant: "small-caps", letterSpacing: "0.16em" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: SWARMS_PAPER, fontFamily: SWARMS_SERIF, fontSize: narrow ? "2.1rem" : "clamp(2.3rem, 6vw, 3.2rem)", fontWeight: 700, lineHeight: 1.05, marginTop: "0.2rem" }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: SWARMS_BRASS, fontFamily: SWARMS_SERIF, fontSize: "1.05rem", fontStyle: "italic", marginTop: "0.2rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: SWARMS_PAPER_SOFT, fontFamily: SWARMS_SERIF, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={SWARMS_PAPER}>
          <span style={{ color: SWARMS_BRASS, display: "inline-flex" }}>{ICONS.flag(18)}</span>
        </Rule>
        <FeatureCards
          accent={SWARMS_BRASS}
          caps={false}
          card={{ background: "rgba(234,223,196,0.05)", border: "1px solid rgba(234,223,196,0.2)", borderRadius: "6px" }}
          delay={520}
          font={SWARMS_SERIF}
          sections={banner.sections ?? []}
          soft={SWARMS_PAPER_SOFT}
        />
      </div>
    </Plate>
  );
};

export default Swarms;
