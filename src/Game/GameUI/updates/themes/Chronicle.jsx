/*! Open Historia — the chronicle: the past updates' banners, each its own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "look through every commit to the repo in the past 2 months to fill the time
// line and make the update banners for every update" (the owner, 2026-10-15).
// One theme that dresses each banner as its own: in the banner's palette and
// lettering (chronicleChrome.js), and with a moving picture of what that update
// did, named by its `scene`:
//
//   fleet       ships trading fire on a dark sea, a treaty sealed above them
//   lens        a magnifier passing over a map that sharpens under it
//   vault       a round steel door, its wheel turning
//   press       newspapers coming off the press, their ink running onto a map
//   projection  a globe, and the same world laid out flat beside it
//   chunks      the pieces of an update flying into place in a window, sealed
//   network     players' tables linked to the host's, messages running between
//   phone       a phone over a city, posts rising up its screen
//   scroll      a manuscript marked up in red, and the change stamped
//   chamber     a parliament filling seat by seat
//   gears       clockwork turning until a sealed letter drops out
//   scripts     the letters of many alphabets circling a globe
//   desk        a planning board: cards pinned, bars filling, counters moving
//   workbench   a stylus redrawing a border across a map
//   timeline    the events of a turn passing by, one of them lit
//   dossier     a dossier under a lamp, its redactions lifting
//   devices     a computer, a phone and a screen lighting up with one world
//
// Flat shapes only (no gradient, nothing purple); still with Reduce motion.

import React from "react";

import { Brackets, FeatureCards, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { chroniclePalette } from "./chronicleChrome.js";

const W = 800;
const H = 180;
const ease = "cubic-bezier(0.45, 0, 0.2, 1)";
const wave = "cubic-bezier(0.4, 0, 0.6, 1)";
// A line drawn along itself.
const drawn = (still, length, duration, delay) => (still ? {} : { strokeDasharray: length, "--oh-upd-length": length, ...motion(still, "ohUpdDraw", duration, delay, ease) });
// Carried across, from `from` to `to` px, once or for ever.
const carried = (still, from, to, duration, delay, again = false) => (still ? {} : { "--oh-upd-from": `${from}px`, "--oh-upd-to": `${to}px`, ...(again ? forever(still, "ohUpdDrift", duration, delay) : motion(still, "ohUpdDrift", duration, delay, ease)) });
// Risen (negative) or fallen (positive) by `by` px, again and again.
const falling = (still, by, duration, delay) => (still ? {} : { "--oh-upd-fall": `${by}px`, ...forever(still, "ohUpdFall", duration, delay) });
const spinning = (still, duration, reverse = false) => (still ? {} : { ...forever(still, "ohUpdSpin", duration, 0), animationDirection: reverse ? "reverse" : "normal" });
const pulsing = (still, duration, delay = 0) => forever(still, "ohUpdPulse", duration, delay, wave);
const appearing = (still, delay, duration = 400) => motion(still, "ohUpdFade", duration, delay);

const Frame = ({ children, ground }) => (
  <svg className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ display: "block", height: "100%", width: "100%" }} viewBox={`0 0 ${W} ${H}`}>
    <rect fill={ground} height={H} width={W} />
    {children}
  </svg>
);
const grid = (ink, step = 40) => (
  <>
    {Array.from({ length: W / step + 1 }, (_, at) => <line key={`v${at}`} stroke={ink} strokeOpacity="0.06" x1={at * step} x2={at * step} y1="0" y2={H} />)}
    {Array.from({ length: H / step + 1 }, (_, at) => <line key={`h${at}`} stroke={ink} strokeOpacity="0.06" x1="0" x2={W} y1={at * step} y2={at * step} />)}
  </>
);
// A few countries of a map, as flat shapes.
const LANDS = ["M60 40 L180 30 L230 80 L170 130 L80 120 Z", "M230 80 L330 50 L380 110 L300 150 L170 130 Z", "M330 50 L470 40 L500 100 L380 110 Z", "M380 110 L500 100 L540 160 L420 170 L300 150 Z", "M470 40 L600 30 L640 90 L500 100 Z", "M500 100 L640 90 L700 150 L540 160 Z"];

const SCENES = {
  fleet: ({ p, still }) => (
    <Frame ground={p.ground}>
      <rect fill={p.ink} fillOpacity="0.05" height="60" width={W} y="120" />
      {[[140, 128, 1], [600, 132, -1]].map(([x, y, facing], at) => (
        <g key={at} style={still ? null : { "--oh-upd-tilt": "-2deg", ...forever(still, "ohUpdBob", 3600 + at * 500, at * 700, wave) }}>
          <path d={`M${x - 60} ${y} h120 l-14 16 h-92 z M${x - 30} ${y} v-34 h4 v34 M${x + 10} ${y} v-46 h4 v46 M${x - 26} ${y - 30} l${facing * 28} 14 l${-facing * 28} 6 z M${x + 14} ${y - 42} l${facing * 34} 18 l${-facing * 34} 8 z`} fill={p.ink} opacity="0.85" />
          {[0, 1, 2].map((gun) => <circle cx={x + facing * (66 + gun * 6)} cy={y + 6 + gun * 2} fill={p.accent} key={gun} r="4" style={pulsing(still, 900, at * 450 + gun * 150)} />)}
        </g>
      ))}
      {Array.from({ length: 10 }, (_, at) => <circle cx={260 + at * 30} cy={110} fill={p.ink} fillOpacity="0.12" key={at} r={10 + (at % 3) * 5} style={falling(still, -70, 4200 + at * 200, at * 380)} />)}
      <g style={appearing(still, 600, 900)}>
        <rect fill={p.ink} fillOpacity="0.9" height="44" rx="4" width="150" x="325" y="14" />
        {[0, 1, 2].map((line) => <line key={line} stroke={p.ground} strokeWidth="2" x1="340" x2={440 - line * 18} y1={26 + line * 9} y2={26 + line * 9} />)}
        <circle cx="458" cy="48" fill={p.accent} r="11" style={motion(still, "ohUpdStamp", 700, 1500)} />
      </g>
    </Frame>
  ),
  lens: ({ p, still }) => (
    <Frame ground={p.ground}>
      {grid(p.ink)}
      {LANDS.map((d, at) => <path d={d} fill={p.accent} fillOpacity={0.06 + (at % 3) * 0.04} key={at} stroke={p.ink} strokeOpacity="0.2" />)}
      {[30, 55, 80].map((r, at) => <ellipse cx={420} cy={95} fill="none" key={r} rx={r * 2.2} ry={r} stroke={p.accent} strokeWidth="1.2" style={drawn(still, 900, 2400, 300 + at * 400)} />)}
      <g style={carried(still, -120, 640, 9000, 0, true)}>
        <circle cx="100" cy="90" fill={p.ink} fillOpacity="0.08" r="52" stroke={p.ink} strokeWidth="5" />
        <line stroke={p.ink} strokeLinecap="round" strokeWidth="10" x1="138" x2="176" y1="128" y2="166" />
      </g>
    </Frame>
  ),
  vault: ({ p, still }) => (
    <Frame ground={p.ground}>
      {grid(p.ink, 30)}
      <circle cx="400" cy="90" fill={p.ink} fillOpacity="0.1" r="84" stroke={p.ink} strokeOpacity="0.5" strokeWidth="6" />
      {Array.from({ length: 16 }, (_, at) => <circle cx={400 + Math.cos((at * Math.PI) / 8) * 74} cy={90 + Math.sin((at * Math.PI) / 8) * 74} fill={p.ink} fillOpacity="0.6" key={at} r="3.5" />)}
      <g style={spinning(still, 9000)}>
        <circle cx="400" cy="90" fill="none" r="40" stroke={p.accent} strokeWidth="5" />
        {[0, 1, 2, 3, 4, 5].map((at) => <line key={at} stroke={p.accent} strokeLinecap="round" strokeWidth="6" x1={400 + Math.cos((at * Math.PI) / 3) * 14} x2={400 + Math.cos((at * Math.PI) / 3) * 54} y1={90 + Math.sin((at * Math.PI) / 3) * 14} y2={90 + Math.sin((at * Math.PI) / 3) * 54} />)}
        <circle cx="400" cy="90" fill={p.accent} r="10" />
      </g>
      <path d="M316 90 H230 M484 90 H570" stroke={p.ink} strokeOpacity="0.3" strokeWidth="2" />
    </Frame>
  ),
  press: ({ p, still }) => (
    <Frame ground={p.ground}>
      {LANDS.map((d, at) => <path d={d} fill={p.accent} fillOpacity="0.5" key={at} stroke={p.ground} strokeWidth="2" style={pulsing(still, 2600, at * 430)} transform="translate(80 10) scale(0.92)" />)}
      {[0, 1, 2, 3].map((at) => (
        <g key={at} style={appearing(still, 200 + at * 450, 500)}>
          <rect fill={p.ink} height="58" rx="2" transform={`rotate(${-8 + at * 5} ${70 + at * 34} 40)`} width="70" x={36 + at * 34} y="12" />
          {[0, 1, 2, 3].map((line) => <line key={line} stroke={p.ground} strokeOpacity={line === 0 ? 0.9 : 0.45} strokeWidth={line === 0 ? 4 : 2} transform={`rotate(${-8 + at * 5} ${70 + at * 34} 40)`} x1={44 + at * 34} x2={96 + at * 34} y1={24 + line * 10} y2={24 + line * 10} />)}
        </g>
      ))}
      {Array.from({ length: 8 }, (_, at) => <circle cx={240 + at * 55} cy="10" fill={p.ink} key={at} r="3" style={falling(still, 120, 2200 + (at % 3) * 300, at * 260)} />)}
    </Frame>
  ),
  projection: ({ p, still }) => (
    <Frame ground={p.ground}>
      <circle cx="190" cy="90" fill={p.accent} fillOpacity="0.12" r="70" stroke={p.accent} strokeWidth="2" />
      {[20, 42, 62].map((rx) => <ellipse cx="190" cy="90" fill="none" key={rx} rx={rx} ry="70" stroke={p.ink} strokeOpacity="0.3" style={still ? null : { ...forever(still, "ohUpdSway", 3000 + rx * 20, 0, wave) }} />)}
      {[-40, 0, 40].map((dy) => <ellipse cx="190" cy={90 + dy} fill="none" key={dy} rx={dy === 0 ? 70 : 57} ry="8" stroke={p.ink} strokeOpacity="0.3" />)}
      <path d="M280 90 H360" stroke={p.accent} strokeDasharray="6 6" strokeWidth="2" style={drawn(still, 90, 700, 400)} />
      <path d="M352 82 L364 90 L352 98" fill="none" stroke={p.accent} strokeWidth="2" style={appearing(still, 1000)} />
      <rect fill={p.accent} fillOpacity="0.1" height="120" stroke={p.accent} strokeWidth="2" width="300" x="390" y="30" style={appearing(still, 900, 600)} />
      {[0, 1, 2, 3, 4, 5].map((at) => <line key={`m${at}`} stroke={p.ink} strokeOpacity="0.3" x1={390 + at * 60} x2={390 + at * 60} y1="30" y2="150" style={drawn(still, 130, 600, 1100 + at * 90)} />)}
      {[0, 1, 2].map((at) => <line key={`p${at}`} stroke={p.ink} strokeOpacity="0.3" x1="390" x2="690" y1={60 + at * 30} y2={60 + at * 30} style={drawn(still, 310, 600, 1400 + at * 90)} />)}
      <path d="M430 60 L500 50 L540 90 L470 120 Z M560 70 L640 64 L660 110 L590 130 Z" fill={p.ink} fillOpacity="0.5" style={appearing(still, 1800, 700)} />
    </Frame>
  ),
  chunks: ({ p, still }) => (
    <Frame ground={p.ground}>
      <rect fill="none" height="130" rx="8" stroke={p.ink} strokeOpacity="0.5" strokeWidth="3" width="300" x="250" y="25" />
      <line stroke={p.ink} strokeOpacity="0.5" strokeWidth="3" x1="250" x2="550" y1="47" y2="47" />
      {Array.from({ length: 12 }, (_, at) => {
        const x = 270 + (at % 6) * 45;
        const y = 62 + Math.floor(at / 6) * 42;
        return <rect fill={p.accent} height="34" key={at} rx="4" width="38" x={x} y={y} style={still ? null : { "--oh-upd-from": `${(at % 2 ? 1 : -1) * (180 + at * 12)}px`, "--oh-upd-to": "0px", ...motion(still, "ohUpdDrift", 900, 150 + at * 140, ease) }} />;
      })}
      <circle cx="600" cy="60" fill="none" r="22" stroke={p.accent} strokeWidth="3" style={motion(still, "ohUpdStamp", 700, 2000)} />
      <path d="M589 60 l8 8 l15 -16" fill="none" stroke={p.accent} strokeWidth="4" style={motion(still, "ohUpdStamp", 700, 2000)} />
    </Frame>
  ),
  network: ({ p, still }) => {
    const seats = Array.from({ length: 6 }, (_, at) => [400 + Math.cos((at * Math.PI) / 3 + 0.5) * 230, 90 + Math.sin((at * Math.PI) / 3 + 0.5) * 62]);
    return (
      <Frame ground={p.ground}>
        {grid(p.ink, 50)}
        {seats.map(([x, y], at) => <line key={`l${at}`} stroke={p.accent} strokeOpacity="0.6" strokeWidth="2" x1="400" x2={x} y1="90" y2={y} style={drawn(still, 260, 700, 200 + at * 150)} />)}
        {seats.map(([x, y], at) => <circle cx={x + (400 - x) * 0.5} cy={y + (90 - y) * 0.5} fill={p.ink} key={`m${at}`} r="4" style={pulsing(still, 1200, at * 200)} />)}
        {seats.map(([x, y], at) => (
          <g key={`s${at}`} style={appearing(still, 300 + at * 150)}>
            <rect fill={p.ground} height="28" rx="6" stroke={p.accent} strokeWidth="2" width="40" x={x - 20} y={y - 14} />
            <circle cx={x} cy={y} fill={p.accent} r="6" />
          </g>
        ))}
        <circle cx="400" cy="90" fill={p.accent} r="26" style={pulsing(still, 1800)} />
        <circle cx="400" cy="90" fill="none" r="38" stroke={p.accent} strokeOpacity="0.5" strokeWidth="2" />
      </Frame>
    );
  },
  phone: ({ p, still }) => (
    <Frame ground={p.ground}>
      {[[0, 120, 70], [70, 100, 50], [130, 130, 60], [500, 110, 50], [560, 90, 70], [640, 125, 60], [710, 105, 90]].map(([x, y, w]) => <rect fill={p.ink} fillOpacity="0.1" height={H - y} key={x} width={w} x={x} y={y} />)}
      <rect fill={p.ground} height="160" rx="16" stroke={p.ink} strokeWidth="4" width="96" x="352" y="10" />
      <clipPath id="oh-upd-phone"><rect height="140" rx="6" width="80" x="360" y="22" /></clipPath>
      <g clipPath="url(#oh-upd-phone)">
        {Array.from({ length: 7 }, (_, at) => <rect fill={at % 2 ? p.accent : p.ink} fillOpacity={at % 2 ? 0.85 : 0.6} height="16" key={at} rx="8" width={44 + (at % 3) * 10} x={at % 2 ? 392 - (at % 3) * 10 : 364} y="170" style={falling(still, -170, 4200, at * 600)} />)}
      </g>
    </Frame>
  ),
  scroll: ({ p, still }) => (
    <Frame ground={p.ground}>
      <rect fill={p.ink} fillOpacity="0.92" height="150" rx="4" width="360" x="220" y="15" />
      {Array.from({ length: 8 }, (_, at) => <line key={at} stroke={p.ground} strokeOpacity="0.4" strokeWidth="3" x1="244" x2={540 - (at % 3) * 40} y1={34 + at * 16} y2={34 + at * 16} />)}
      {[[260, 50, 120], [300, 98, 90], [250, 130, 140]].map(([x, y, w], at) => <line key={at} stroke={p.accent} strokeWidth="3" x1={x} x2={x + w} y1={y} y2={y} style={drawn(still, w + 10, 500, 400 + at * 450)} />)}
      {[[392, 46], [404, 94], [404, 126]].map(([x, y], at) => <path d={`M${x} ${y} l6 -8 l6 8`} fill="none" key={at} stroke={p.accent} strokeWidth="2.5" style={appearing(still, 800 + at * 450)} />)}
      <g style={motion(still, "ohUpdStamp", 700, 2000)}>
        <circle cx="620" cy="110" fill="none" r="30" stroke={p.accent} strokeWidth="4" />
        <path d="M604 110 l11 11 l21 -23" fill="none" stroke={p.accent} strokeWidth="5" />
      </g>
    </Frame>
  ),
  chamber: ({ p, still }) => {
    const seats = [];
    [60, 90, 120, 150].forEach((radius, row) => {
      const count = 9 + row * 4;
      for (let at = 0; at < count; at += 1) {
        const turn = Math.PI + (at / (count - 1)) * Math.PI;
        seats.push({ x: 400 + Math.cos(turn) * radius * 1.6, y: 170 + Math.sin(turn) * radius, row, at });
      }
    });
    return (
      <Frame ground={p.ground}>
        {seats.map((seat, index) => <circle cx={seat.x} cy={seat.y} fill={(seat.at + seat.row) % 3 === 0 ? p.ink : p.accent} fillOpacity={(seat.at + seat.row) % 3 === 0 ? 0.55 : 0.9} key={index} r="6" style={appearing(still, 200 + index * 28, 300)} />)}
        <rect fill={p.accent} height="18" rx="2" width="70" x="365" y="152" />
      </Frame>
    );
  },
  gears: ({ p, still }) => {
    const gear = (cx, cy, r, teeth) => (
      <>
        <circle cx={cx} cy={cy} fill="none" r={r} stroke={p.accent} strokeWidth="6" />
        {Array.from({ length: teeth }, (_, at) => <rect fill={p.accent} height="12" key={at} transform={`rotate(${(at * 360) / teeth} ${cx} ${cy})`} width="9" x={cx - 4.5} y={cy - r - 10} />)}
        <circle cx={cx} cy={cy} fill={p.accent} r={r * 0.25} />
      </>
    );
    return (
      <Frame ground={p.ground}>
        <g style={spinning(still, 8000)}>{gear(300, 80, 46, 12)}</g>
        <g style={spinning(still, 5500, true)}>{gear(392, 108, 30, 8)}</g>
        <g style={spinning(still, 8000)}>{gear(470, 70, 40, 10)}</g>
        <g style={still ? null : { "--oh-upd-fall": "90px", ...motion(still, "ohUpdFall", 1600, 1600, ease) }}>
          <rect fill={p.ink} height="40" rx="3" width="64" x="568" y="30" />
          <path d="M568 30 l32 22 l32 -22" fill="none" stroke={p.ground} strokeWidth="3" />
          <circle cx="600" cy="54" fill={p.accent} r="7" />
        </g>
      </Frame>
    );
  },
  scripts: ({ p, still }) => {
    const letters = ["A", "Я", "語", "ع", "Ω", "ह", "ก", "한", "ß", "ñ", "Ж", "字", "λ", "ç", "ש", "ü"];
    return (
      <Frame ground={p.ground}>
        <circle cx="400" cy="90" fill={p.accent} fillOpacity="0.12" r="64" stroke={p.accent} strokeWidth="2" />
        {[22, 44].map((rx) => <ellipse cx="400" cy="90" fill="none" key={rx} rx={rx} ry="64" stroke={p.ink} strokeOpacity="0.3" />)}
        <ellipse cx="400" cy="90" fill="none" rx="64" ry="10" stroke={p.ink} strokeOpacity="0.3" />
        {letters.map((letter, at) => (
          <text fill={at % 2 ? p.accent : p.ink} fontFamily="serif" fontSize={20 + (at % 4) * 6} key={at} opacity="0.85" textAnchor="middle" x={60 + ((at * 47) % 680)} y="200" style={falling(still, -220, 5200 + (at % 5) * 500, at * 330)}>{letter}</text>
        ))}
      </Frame>
    );
  },
  desk: ({ p, still }) => (
    <Frame ground={p.ground}>
      <rect fill={p.ink} fillOpacity="0.06" height="150" rx="6" width="440" x="40" y="15" />
      {[0, 1, 2].map((col) => [0, 1, 2].map((row) => (
        <g key={`${col}-${row}`} style={appearing(still, 200 + (col * 3 + row) * 120)}>
          <rect fill={p.ink} fillOpacity="0.85" height="36" rx="3" width="120" x={60 + col * 140} y={28 + row * 44} />
          <rect fill={p.ground} fillOpacity="0.25" height="6" rx="3" width="96" x={72 + col * 140} y={50 + row * 44} />
          <rect fill={p.accent} height="6" rx="3" width={30 + ((col + row) % 3) * 30} x={72 + col * 140} y={50 + row * 44} style={still ? { transformOrigin: "left" } : { transformOrigin: "left", ...motion(still, "ohUpdGrow", 1400, 600 + (col * 3 + row) * 150, ease) }} />
        </g>
      )))}
      {grid(p.ink, 40)}
      {[[560, 60], [610, 110], [680, 70]].map(([x, y], at) => (
        <g key={at} style={carried(still, 0, 30, 2600, 800 + at * 300)}>
          <rect fill={p.accent} height="18" stroke={p.ground} strokeWidth="1.5" width="28" x={x} y={y} />
          <path d={`M${x} ${y} L${x + 28} ${y + 18} M${x + 28} ${y} L${x} ${y + 18}`} stroke={p.ground} strokeWidth="1.5" />
        </g>
      ))}
    </Frame>
  ),
  workbench: ({ p, still }) => (
    <Frame ground={p.ground}>
      {grid(p.ink)}
      {LANDS.map((d, at) => <path d={d} fill={at % 2 ? p.accent : p.ink} fillOpacity={at % 2 ? 0.35 : 0.12} key={at} stroke={p.ink} strokeOpacity="0.35" transform="translate(40 0)" />)}
      <path d="M270 80 C320 70 360 120 420 110 S500 60 540 100" fill="none" stroke={p.accent} strokeDasharray="8 6" strokeWidth="4" style={drawn(still, 320, 2600, 400)} />
      <g style={carried(still, 0, 270, 2600, 400)}>
        <line stroke={p.ink} strokeLinecap="round" strokeWidth="6" x1="270" x2="300" y1="80" y2="30" />
        <circle cx="270" cy="80" fill={p.accent} r="5" />
      </g>
    </Frame>
  ),
  timeline: ({ p, still }) => (
    <Frame ground={p.ground}>
      <line stroke={p.ink} strokeOpacity="0.4" strokeWidth="3" x1="0" x2={W} y1="120" y2="120" />
      <g style={carried(still, 0, -400, 16000, 0, true)}>
        {Array.from({ length: 14 }, (_, at) => (
          <g key={at}>
            <circle cx={60 + at * 100} cy="120" fill={p.ink} r="6" />
            <rect fill={p.ink} fillOpacity="0.85" height="50" rx="4" width="74" x={23 + at * 100} y="50" />
            {[0, 1, 2].map((line) => <line key={line} stroke={p.ground} strokeOpacity="0.5" strokeWidth="2" x1={31 + at * 100} x2={89 + at * 100 - line * 12} y1={62 + line * 10} y2={62 + line * 10} />)}
          </g>
        ))}
      </g>
      <rect fill="none" height="64" rx="6" stroke={p.accent} strokeWidth="4" width="90" x="355" y="43" style={pulsing(still, 1400)} />
    </Frame>
  ),
  dossier: ({ p, still }) => (
    <Frame ground={p.ground}>
      <path d="M330 0 L470 0 L560 180 L240 180 Z" fill={p.accent} fillOpacity="0.1" style={pulsing(still, 3000)} />
      <rect fill={p.ink} fillOpacity="0.9" height="120" rx="3" width="220" x="290" y="45" />
      <rect fill={p.accent} height="12" width="70" x="300" y="33" />
      {Array.from({ length: 6 }, (_, at) => (
        <g key={at}>
          <line stroke={p.ground} strokeOpacity="0.55" strokeWidth="3" x1="306" x2={490 - (at % 3) * 30} y1={64 + at * 16} y2={64 + at * 16} />
          {at % 2 === 0 && <rect fill={p.ground} height="10" width={110 + (at % 3) * 20} x="320" y={59 + at * 16} style={still ? { transformOrigin: "right" } : { transformOrigin: "right", ...motion(still, "ohUpdShrink", 1200, 700 + at * 300, ease) }} />}
        </g>
      ))}
      <g style={carried(still, 0, 120, 3800, 600)}>
        <circle cx="560" cy="120" fill="none" r="26" stroke={p.ink} strokeWidth="5" />
        <line stroke={p.ink} strokeLinecap="round" strokeWidth="8" x1="580" x2="606" y1="140" y2="166" />
      </g>
    </Frame>
  ),
  devices: ({ p, still }) => {
    const screen = (x, y, w, h, delay) => (
      <g style={appearing(still, delay, 700)}>
        <rect fill={p.accent} fillOpacity="0.25" height={h} width={w} x={x} y={y} />
        <path d={`M${x + w * 0.15} ${y + h * 0.3} L${x + w * 0.45} ${y + h * 0.2} L${x + w * 0.55} ${y + h * 0.6} L${x + w * 0.25} ${y + h * 0.75} Z`} fill={p.accent} />
      </g>
    );
    return (
      <Frame ground={p.ground}>
        <rect fill="none" height="90" rx="6" stroke={p.ink} strokeWidth="4" width="150" x="110" y="30" />
        <path d="M90 128 H280 L266 140 H104 Z" fill={p.ink} />
        {screen(118, 38, 134, 74, 300)}
        <rect fill="none" height="120" rx="12" stroke={p.ink} strokeWidth="4" width="66" x="367" y="30" />
        {screen(375, 44, 50, 92, 700)}
        <rect fill="none" height="100" rx="4" stroke={p.ink} strokeWidth="4" width="170" x="530" y="22" />
        <path d="M604 122 h22 v18 h20 v6 h-62 v-6 h20 z" fill={p.ink} />
        {screen(538, 30, 154, 84, 1100)}
        {[[262, 75, 365], [435, 85, 528]].map(([x1, y, x2], at) => <line key={at} stroke={p.accent} strokeDasharray="4 6" strokeWidth="2" x1={x1} x2={x2} y1={y} y2={y} style={drawn(still, 120, 600, 500 + at * 400)} />)}
      </Frame>
    );
  },
};

const Chronicle = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const p = chroniclePalette(banner);
  const Scene = SCENES[banner.scene] ?? SCENES.timeline;
  return (
    <Plate surface={{ background: p.ground, border: `1px solid ${p.accent}55`, borderRadius: "10px" }}>
      <Brackets colour={p.accent} inset="0.6rem" length="1.5rem" thickness={1.5} />
      <Reveal delay={120} style={{ borderBottom: `1px solid ${p.accent}44`, height: narrow ? "9rem" : "clamp(10rem, 22vw, 13rem)", overflow: "hidden" }}>
        <Scene p={p} still={still} />
      </Reveal>
      <div style={{ padding: narrow ? "1.1rem 1.1rem 1.3rem" : "1.4rem 2rem 1.7rem" }}>
        <Reveal delay={260}>
          <div style={{ color: p.accent, fontFamily: p.font, fontSize: "0.76rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: p.ink, fontFamily: p.font, fontSize: narrow ? "1.9rem" : "clamp(2rem, 5vw, 2.9rem)", fontWeight: 800, letterSpacing: p.caps ? "0.04em" : "0", lineHeight: 1.06, marginTop: "0.15rem", textTransform: p.caps ? "uppercase" : "none" }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: p.accent, fontFamily: p.font, fontSize: "1.02rem", fontWeight: 600, marginTop: "0.2rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={380}>
            <p style={{ color: p.soft, fontFamily: p.font, fontSize: "0.96rem", lineHeight: 1.55, margin: "0.8rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={p.accent} />
        <FeatureCards accent={p.accent} caps={p.caps} card={{ background: `${p.accent}0d`, border: `1px solid ${p.accent}33` }} delay={480} font={p.font} sections={banner.sections ?? []} soft={p.soft} />
      </div>
    </Plate>
  );
};

export default Chronicle;
