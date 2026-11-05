/*! Open Historia — Espionage, Part 2: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

import React, { useEffect, useState } from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { SPY_BLOCK, SPY_LAMP, SPY_NIGHT, SPY_PAPER, SPY_PAPER_SOFT, SPY_RED, SPY_STREET, SPY_TYPE } from "./espionage2Chrome.js";

const CHANGE_MS = 3800;

const SAFEHOUSE = { x: 92, y: 164 };
const ORDERS = [
  { key: "collect", x: 640, y: 58, path: "M92 164 L92 120 L250 120 L250 70 L470 70 L470 58 L640 58" },
  { key: "sabotage", x: 690, y: 168, path: "M92 164 L330 164 L330 196 L560 196 L560 168 L690 168" },
  { key: "recruit", x: 420, y: 36, path: "M92 164 L170 164 L170 92 L340 92 L340 36 L420 36" },
  { key: "assassinate", x: 520, y: 124, path: "M92 164 L250 164 L250 124 L520 124" },
];
const BLOCKS = [
  [20, 18, 130, 78], [180, 18, 140, 54], [360, 52, 90, 50], [500, 18, 120, 34], [660, 82, 120, 64],
  [20, 186, 200, 30], [270, 136, 210, 44], [600, 196, 180, 24], [116, 96, 40, 52], [520, 140, 30, 40],
];

const TargetMark = ({ kind }) => {
  if (kind === "collect") return <><rect fill={SPY_PAPER} height="18" width="14" x="-7" y="-9" /><path d="M-4 -4h8M-4 0h8M-4 4h5" stroke={SPY_NIGHT} strokeWidth="1.2" /></>;
  if (kind === "sabotage") return <><rect fill={SPY_PAPER} height="12" width="22" x="-11" y="-2" /><rect fill={SPY_PAPER} height="14" width="5" x="4" y="-14" /><path d="M-8 -2l4-6 4 6" fill={SPY_PAPER} /></>;
  if (kind === "recruit") return <><circle cx="0" cy="-5" fill={SPY_PAPER} r="5" /><path d="M-9 9c0-6 4-9 9-9s9 3 9 9z" fill={SPY_PAPER} /></>;
  return <><circle cx="0" cy="0" fill="none" r="9" stroke={SPY_PAPER} strokeWidth="1.6" /><path d="M0 -13v8M0 5v8M-13 0h8M5 0h8" stroke={SPY_PAPER} strokeWidth="1.6" /></>;
};

const NightMap = ({ order, still }) => {
  const active = ORDERS.find((entry) => entry.key === order) ?? ORDERS[0];
  return (
    <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
      <rect fill={SPY_NIGHT} height="220" width="800" />
      {Array.from({ length: 9 }, (_, at) => <line key={`v${at}`} stroke={SPY_STREET} strokeWidth="5" x1={at * 100 - 8} x2={at * 100 - 8} y1="0" y2="220" />)}
      {[10, 70, 124, 168, 208].map((y) => <line key={`h${y}`} stroke={SPY_STREET} strokeWidth="5" x1="0" x2="800" y1={y} y2={y} />)}
      {BLOCKS.map(([x, y, w, h]) => <rect fill={SPY_BLOCK} height={h} key={`${x}-${y}`} width={w} x={x} y={y} />)}
      {Array.from({ length: 22 }, (_, at) => (
        <rect fill={SPY_LAMP} height="3" key={`w${at}`} opacity="0.5" style={forever(still, "ohUpdTwinkle", 2400 + (at % 5) * 500, (at * 370) % 2000)} width="4" x={30 + ((at * 137) % 730)} y={24 + ((at * 59) % 170)} />
      ))}
      {ORDERS.map((entry) => (
        <g key={entry.key} opacity={entry.key === active.key ? 1 : 0.35} style={{ transform: `translate(${entry.x}px, ${entry.y}px)` }}>
          <TargetMark kind={entry.key} />
        </g>
      ))}
      <path
        d={active.path}
        fill="none"
        key={active.key}
        stroke={SPY_RED}
        strokeDasharray="6 5"
        strokeLinejoin="round"
        strokeWidth="2.4"
        style={{ "--oh-upd-length": 990, strokeDashoffset: 0, ...forever(still, "ohUpdDraw", 14000, 0, "linear") }}
      />
      <g key={`ring-${active.key}`} style={{ transform: `translate(${active.x}px, ${active.y}px)` }}>
        <circle fill="none" r="16" stroke={SPY_RED} strokeWidth="2" style={forever(still, "ohUpdRing", 1700, 1500)} />
      </g>
      <g style={{ transform: `translate(${SAFEHOUSE.x}px, ${SAFEHOUSE.y}px)` }}>
        <rect fill={SPY_LAMP} height="14" width="14" x="-7" y="-7" />
        <rect fill={SPY_NIGHT} height="5" width="5" x="-2.5" y="-2.5" />
      </g>
    </svg>
  );
};

const ORDER_WORDS = { collect: "Collect", sabotage: "Sabotage", recruit: "Recruit", assassinate: "Assassinate" };

const Keys = ({ options, value, onPick, narrow, words }) => (
  <div role="group" style={{ bottom: "0.6rem", display: "flex", flexWrap: "wrap", gap: "0.3rem", left: narrow ? "0.5rem" : "0.7rem", position: "absolute", right: narrow ? "0.5rem" : "auto" }}>
    {options.map((key) => {
      const on = key === value;
      return (
        <button
          aria-label={words[key]}
          aria-pressed={on}
          className="oh-tap"
          key={key}
          onClick={() => onPick(key)}
          style={{
            background: on ? SPY_RED : "rgba(12,17,21,0.82)",
            border: `1px solid ${on ? SPY_RED : "rgba(232,226,208,0.45)"}`,
            borderRadius: "2px",
            color: SPY_PAPER,
            cursor: "pointer",
            fontFamily: SPY_TYPE,
            fontSize: narrow ? "0.66rem" : "0.76rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            minHeight: "2rem",
            padding: narrow ? "0 0.5rem" : "0 0.8rem",
            textTransform: "uppercase",
            touchAction: "manipulation",
          }}
          type="button"
        >
          {words[key]}
        </button>
      );
    })}
  </div>
);

const Dossier = ({ still }) => {
  return (
    <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox="0 0 800 220">
      <rect fill={SPY_NIGHT} height="220" width="800" />
      <g style={{ transformOrigin: "400px 0px", ...forever(still, "ohUpdSway", 5200, 0, "cubic-bezier(0.45, 0, 0.55, 1)") }}>
        <line stroke={SPY_PAPER_SOFT} strokeWidth="1.5" x1="400" x2="400" y1="0" y2="26" />
        <path d="M384 26h32l-6 12h-20z" fill={SPY_LAMP} />
        <path d="M390 38 L300 220 L500 220 L410 38 Z" fill={SPY_LAMP} opacity="0.08" />
      </g>
      <g style={{ transform: "translate(250px, 46px) rotate(-3deg)" }}>
        <rect fill={SPY_PAPER} height="160" width="300" />
        <rect fill="none" height="64" stroke={SPY_NIGHT} strokeWidth="1.2" width="52" x="18" y="18" />
        <circle cx="44" cy="40" fill={SPY_NIGHT} opacity="0.75" r="11" />
        <path d="M24 82c0-14 9-20 20-20s20 6 20 20z" fill={SPY_NIGHT} opacity="0.75" />
        {[22, 38, 54, 70].map((y, at) => (
          <rect fill={SPY_NIGHT} height="8" key={y} style={{ transformBox: "fill-box", transformOrigin: "left center", ...motion(still, "ohUpdGrow", 420, 300 + at * 260) }} width={150 - at * 22} x="88" y={y} />
        ))}
        {[100, 114, 128, 142].map((y) => <line key={y} stroke={SPY_NIGHT} strokeOpacity="0.35" strokeWidth="1" x1="18" x2="282" y1={y} y2={y} />)}
      </g>
    </svg>
  );
};

const Stamp = ({ verdict, still, narrow }) => (
  <div aria-hidden="true" style={{ left: "52%", pointerEvents: "none", position: "absolute", top: narrow ? "68%" : "60%", transform: "translate(-50%, -50%)" }}>
    <div
      key={verdict}
      style={{
        border: `2.5px solid ${SPY_RED}`,
        borderRadius: "3px",
        color: SPY_RED,
        fontFamily: SPY_TYPE,
        fontSize: narrow ? "0.78rem" : "0.95rem",
        fontWeight: 700,
        letterSpacing: "0.12em",
        padding: "0.25rem 0.7rem",
        textTransform: "uppercase",
        transform: "rotate(-8deg)",
        whiteSpace: "nowrap",
        ...motion(still, "ohUpdStamp", 520, 260),
      }}
    >
      {verdict === "silent" ? "Identity unknown" : "Identified"}
    </div>
  </div>
);

const VERDICT_WORDS = { silent: "Said nothing", talked: "Talked" };

const usePicked = (options, still) => {
  const [value, setValue] = useState(options[0]);
  const [chosen, setChosen] = useState(false);
  useEffect(() => {
    if (still || chosen) return undefined;
    const timer = setInterval(() => setValue((now) => options[(options.indexOf(now) + 1) % options.length]), CHANGE_MS);
    return () => clearInterval(timer);
  }, [still, chosen, options]);
  return [value, (key) => { setChosen(true); setValue(key); }];
};

const ORDER_KEYS = ORDERS.map((entry) => entry.key);
const VERDICT_KEYS = ["silent", "talked"];

const Espionage2 = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const custody = banner.scene === "custody";
  const [order, pickOrder] = usePicked(ORDER_KEYS, still);
  const [verdict, pickVerdict] = usePicked(VERDICT_KEYS, still);
  return (
    <Plate surface={{ background: SPY_NIGHT, border: "1px solid rgba(232,226,208,0.22)", borderRadius: "3px" }}>
      <Brackets colour={SPY_RED} inset="0.7rem" length="1.5rem" thickness={1.5} />
      <Reveal delay={150} style={{ borderBottom: `3px solid ${SPY_RED}`, height: narrow ? "12rem" : "clamp(13rem, 27vw, 17rem)", overflow: "hidden", position: "relative" }}>
        {custody ? <Dossier still={still} /> : <NightMap order={order} still={still} />}
        {custody && <Stamp narrow={narrow} still={still} verdict={verdict} />}
        {custody
          ? <Keys narrow={narrow} onPick={pickVerdict} options={VERDICT_KEYS} value={verdict} words={VERDICT_WORDS} />
          : <Keys narrow={narrow} onPick={pickOrder} options={ORDER_KEYS} value={order} words={ORDER_WORDS} />}
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: SPY_RED, fontFamily: SPY_TYPE, fontSize: "0.76rem", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: SPY_PAPER, fontFamily: SPY_TYPE, fontSize: narrow ? "1.9rem" : "clamp(2.1rem, 5.5vw, 3rem)", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.05, marginTop: "0.25rem" }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: SPY_LAMP, fontFamily: SPY_TYPE, fontSize: "0.98rem", marginTop: "0.3rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: SPY_PAPER_SOFT, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={SPY_PAPER}>
          <span style={{ color: SPY_RED, display: "inline-flex" }}>{ICONS.eye(18)}</span>
        </Rule>
        <FeatureCards
          accent={SPY_RED}
          card={{ background: "rgba(232,226,208,0.04)", border: "1px solid rgba(232,226,208,0.18)", borderRadius: "2px" }}
          delay={520}
          font={SPY_TYPE}
          sections={banner.sections ?? []}
          soft={SPY_PAPER_SOFT}
        />
      </div>
    </Plate>
  );
};

export default Espionage2;
