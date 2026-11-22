/*! Open Historia — a release's announcement: a page that scrolls © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A version jump told in full (notesReleases.js): a panorama that the page scrolls through, then each chapter's
// picture held in place while its words pass over it and the picture plays out with the scroll (the front advances,
// the bombers cross, the seasons turn), then every line of every update in it, then the way out. The pictures are
// the page's, from top to bottom; nothing is a header with the rest below it.
//
// How the scroll drives them: every part marked data-ohr-track gets --p, how far through it the page has scrolled
// (0 to 1), and data-step, which of its passages is in view. The pictures read --p in their CSS (releaseNotice.css),
// so a frame of scrolling costs no React render. With Reduce motion each picture stands finished and nothing loops.
//
// Flat shapes only (noGradients.test.js): depth is layers of flat colour, light is flat shapes at low opacity.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GREETINGS } from "../../../runtime/greetings.js";
import { releaseChapterEntries } from "./updateNotices.js";
import { NOTICE_Z, noticeDate, useNarrow, useStill } from "./updateKit.jsx";
import "./releaseNotice.css";

export const RELEASE_SCENES = Object.freeze(["front", "skies", "table", "world", "map", "yours", "engine"]);

const NUMERALS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// A grain over everything, made once: a few thousand specks on a small canvas, tiled.
const grainUrl = (() => {
  let made = null;
  return () => {
    if (made !== null || typeof document === "undefined") return made;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 160;
      const context = canvas.getContext("2d");
      for (let at = 0; at < 2600; at += 1) {
        const shade = Math.random() > 0.5 ? 255 : 0;
        context.fillStyle = `rgba(${shade},${shade},${shade},${(Math.random() * 0.5).toFixed(2)})`;
        context.fillRect(Math.floor(Math.random() * 160), Math.floor(Math.random() * 160), 1, 1);
      }
      made = canvas.toDataURL("image/png");
    } catch {
      made = "";
    }
    return made;
  };
})();

// A soldier, standing, for the panorama's ridge.
const SOLDIER = "M0 0 l3 -14 l-2 -10 a4 4 0 1 1 6 0 l-1 10 l3 14 z M3 -22 l-9 -16 l2 -1 l9 15 z";
// Aircraft seen from below, nose to the right: a four-engined bomber, and a swept-wing fighter.
const BOMBER = "M64 0 C62 -5 56 -7 48 -7 L16 -7 L10 -74 L-4 -74 L-8 -7 L-44 -7 L-48 -26 L-58 -26 L-58 -6 L-62 -4 L-62 4 L-58 6 L-58 26 L-48 26 L-44 7 L-8 7 L-4 74 L10 74 L16 7 L48 7 C56 7 62 5 64 0 Z";
const FIGHTER = "M40 0 C38 -3 32 -4 26 -4 L6 -4 L-12 -32 L-20 -32 L-12 -4 L-28 -4 L-36 -16 L-41 -16 L-38 -3 L-42 -3 L-42 3 L-38 3 L-41 16 L-36 16 L-28 4 L-12 4 L-20 32 L-12 32 L6 4 L26 4 C32 4 38 3 40 0 Z";
const Bomber = ({ fill, transform }) => (
  <g transform={transform}>
    <path d={BOMBER} fill={fill} />
    {[-48, -24, 24, 48].map((y) => <ellipse cx="18" cy={y} fill={fill} key={`n${y}`} rx="13" ry="4.5" />)}
  </g>
);
// A warship, side on.
const SHIP = "M0 0 L140 0 L128 16 L10 16 Z M40 0 L44 -14 L74 -14 L78 0 Z M54 -14 L56 -30 L60 -30 L62 -14 Z M84 0 L88 -9 L104 -9 L106 0 Z";

// The panorama the page opens on: sky, a moon, three ranges, a fortress, a ridge of soldiers and banners, aircraft
// and searchlights, embers. Each layer climbs at its own pace as the page scrolls.
const HeroArt = () => (
  <svg aria-hidden="true" className="ohr-art ohr-hero-art" preserveAspectRatio="xMidYMax slice" viewBox="0 0 1600 900">
    <rect className="ohr-sky" height="900" width="1600" />
    <g className="ohr-layer ohr-l-stars">
      {Array.from({ length: 70 }, (_, at) => (
        <circle className="ohr-star" cx={(at * 233) % 1600} cy={(at * 97) % 420} key={`s${at}`} r={at % 7 === 0 ? 1.8 : 1} style={{ animationDelay: `${(at % 9) * 400}ms` }} />
      ))}
    </g>
    <g className="ohr-layer ohr-l-moon">
      <circle cx="1210" cy="230" fill="#e9dcc0" r="96" />
      <circle cx="1240" cy="205" fill="#d8c9a8" r="22" opacity="0.6" />
      <circle cx="1176" cy="262" fill="#d8c9a8" r="14" opacity="0.5" />
      <circle cx="1215" cy="285" fill="#d8c9a8" r="9" opacity="0.5" />
    </g>
    <g className="ohr-layer ohr-l-beams">
      <polygon className="ohr-beam ohr-beam-a" points="420,900 470,900 760,0 620,0" />
      <polygon className="ohr-beam ohr-beam-b" points="1120,900 1160,900 980,0 860,0" />
    </g>
    <g className="ohr-layer ohr-l-planes">
      <g className="ohr-flyby">
        {[[0, 0], [-120, 70], [-120, -70], [-240, 140], [-240, -140]].map(([x, y]) => (
          <Bomber fill="#0b0f15" key={`p${x}${y}`} transform={`translate(${x} ${y}) scale(0.7)`} />
        ))}
      </g>
    </g>
    <path className="ohr-layer ohr-l-far" d="M0 560 L120 470 L210 520 L330 410 L450 500 L560 430 L690 520 L800 450 L930 530 L1050 420 L1180 500 L1300 440 L1420 520 L1600 460 L1600 1500 L0 1500 Z" />
    <g className="ohr-layer ohr-l-mid">
      <path d="M0 640 L160 560 L300 610 L420 540 L560 600 L700 560 L840 620 L1000 550 L1150 610 L1300 570 L1460 630 L1600 590 L1600 1500 L0 1500 Z" />
      <g transform="translate(980 498)">
        <rect height="74" width="210" x="0" y="0" />
        <rect height="120" width="44" x="-14" y="-46" />
        <rect height="150" width="50" x="80" y="-76" />
        <rect height="112" width="44" x="180" y="-38" />
        {[-14, -2, 10, 22].map((x) => <rect height="12" key={`c${x}`} width="8" x={x} y="-58" />)}
        {[80, 94, 108, 122].map((x) => <rect height="12" key={`d${x}`} width="8" x={x} y="-88" />)}
        <rect className="ohr-window" height="12" width="7" x="100" y="-40" />
        <rect className="ohr-window" height="12" width="7" x="196" y="-10" />
        <path className="ohr-banner-cloth" d="M104 -76 L104 -128 L140 -118 L104 -108" />
      </g>
    </g>
    <g className="ohr-layer ohr-l-near">
      <path d="M0 760 L200 690 L380 730 L560 680 L760 740 L960 700 L1160 750 L1380 700 L1600 740 L1600 1500 L0 1500 Z" />
      {[230, 262, 296, 330, 520, 556, 590, 1250, 1290, 1330, 1370].map((x, at) => (
        <path d={SOLDIER} key={`m${x}`} transform={`translate(${x} ${712 + (at % 3) * 5}) scale(1.6)`} />
      ))}
      {[[300, 700], [1310, 712]].map(([x, y]) => (
        <g key={`f${x}`} transform={`translate(${x} ${y})`}>
          <rect height="120" width="4" x="0" y="-120" />
          <path className="ohr-banner-cloth ohr-wave" d="M4 -118 L70 -108 L4 -88 Z" />
        </g>
      ))}
    </g>
    <g className="ohr-layer ohr-l-embers">
      {Array.from({ length: 26 }, (_, at) => (
        <circle className="ohr-ember" cx={(at * 61) % 1600} cy={760 + (at % 5) * 22} key={`e${at}`} r={at % 4 === 0 ? 3 : 2} style={{ animationDelay: `${(at * 370) % 6000}ms`, animationDuration: `${5200 + (at % 6) * 700}ms` }} />
      ))}
    </g>
    <path className="ohr-layer ohr-l-front" d="M0 840 L240 800 L520 830 L820 790 L1100 835 L1380 800 L1600 820 L1600 1500 L0 1500 Z" />
  </svg>
);

// A unit counter, as staff maps draw them: a box with the infantry cross.
const Counter = ({ x, y, side }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect className={`ohr-counter ohr-counter-${side}`} height="34" rx="3" width="54" x="-27" y="-17" />
    <path className="ohr-counter-mark" d="M-21 -11 L21 11 M-21 11 L21 -11" />
  </g>
);

// I. The front: a staff map. The enemy's ground gives way as the page scrolls, the arrows draw themselves, the
// counters advance, the fortified line breaks.
const FrontScene = () => (
  <svg aria-hidden="true" className="ohr-art" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
    <rect fill="#18252d" height="800" width="1200" />
    <g className="ohr-contours">
      {[0, 1, 2, 3, 4, 5].map((at) => (
        <path d={`M${-40 + at * 30} ${120 + at * 95} C ${260 + at * 20} ${40 + at * 90}, ${520 - at * 10} ${260 + at * 70}, ${780 + at * 15} ${150 + at * 95} S ${1150 - at * 20} ${220 + at * 80}, ${1260} ${120 + at * 100}`} key={`c${at}`} />
      ))}
    </g>
    <g className="ohr-front-enemy">
      <path d="M560 -20 L600 90 L540 200 L610 320 L560 440 L630 560 L580 680 L640 820 L1300 820 L1300 -20 Z" fill="#33201a" />
      <path className="ohr-front-line" d="M560 -20 L600 90 L540 200 L610 320 L560 440 L630 560 L580 680 L640 820" />
      <path className="ohr-fortline" d="M700 40 l20 30 l-20 30 l20 30 l-20 30 l20 30 l-20 30 l20 30 l-20 30 l20 30 l-20 30 l20 30 l-20 30 l20 30 l-20 30 l20 30 l-20 30 l20 30 l-20 30 l20 30" />
      {[[760, 170], [740, 360], [770, 560], [900, 260], [920, 470], [1040, 360]].map(([x, y]) => <Counter key={`e${x}${y}`} side="enemy" x={x} y={y} />)}
    </g>
    <g className="ohr-front-own">
      {[[430, 140], [470, 300], [440, 460], [480, 620], [300, 240], [310, 520]].map(([x, y]) => <Counter key={`o${x}${y}`} side="own" x={x} y={y} />)}
    </g>
    <g className="ohr-arrows">
      <path className="ohr-arrow" d="M420 300 C 560 280, 680 300, 860 250" />
      <path className="ohr-arrow" d="M440 470 C 600 480, 720 520, 900 470" />
      <path className="ohr-arrow ohr-arrow-late" d="M300 380 C 520 380, 760 400, 1060 360" />
    </g>
    <g className="ohr-swarm">
      {Array.from({ length: 22 }, (_, at) => (
        <circle cx={140 + (at % 6) * 16} cy={640 + Math.floor(at / 6) * 16} key={`w${at}`} r="5" />
      ))}
    </g>
    {[[690, 230], [720, 500], [660, 640], [820, 380]].map(([x, y], at) => (
      <g key={`b${x}`} transform={`translate(${x} ${y})`}>
        <circle className="ohr-flash" r="16" style={{ animationDelay: `${at * 650}ms` }} />
        <circle className="ohr-smoke" r="12" style={{ animationDelay: `${at * 650 + 300}ms` }} />
      </g>
    ))}
  </svg>
);

// II. Air, sea and shadow: a formation crosses the sky as the page scrolls, interceptors climb at it, flak bursts,
// a fleet sails below, and a searchlight sweeps for whoever is moving in the dark.
const SkiesScene = () => (
  <svg aria-hidden="true" className="ohr-art" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
    <rect fill="#0c1520" height="800" width="1200" />
    <g className="ohr-clouds">
      {[[80, 140, 380], [520, 90, 300], [860, 200, 420], [260, 300, 260], [980, 360, 300]].map(([x, y, w]) => (
        <rect fill="#16212d" height="34" key={`c${x}`} rx="17" width={w} x={x} y={y} />
      ))}
    </g>
    <polygon className="ohr-searchlight" points="1040,800 1080,800 760,40 640,60" />
    <g className="ohr-bombers">
      {[[0, 0], [-150, 90], [-150, -90], [-300, 180], [-300, -180], [-300, 0]].map(([x, y]) => (
        <g key={`b${x}${y}`} transform={`translate(${x} ${y})`}>
          <path className="ohr-contrail" d="M-60 -38 L-320 -38 M-60 -19 L-320 -19 M-60 19 L-320 19 M-60 38 L-320 38" />
          <Bomber fill="#d7e3ee" transform="scale(0.9)" />
        </g>
      ))}
    </g>
    <g className="ohr-interceptors">
      {[[0, 0], [70, 56], [140, -20]].map(([x, y]) => (
        <path d={FIGHTER} fill="#e2683c" key={`i${x}`} transform={`translate(${x} ${y}) rotate(197) scale(1.2)`} />
      ))}
    </g>
    {[[520, 250], [700, 300], [610, 180], [820, 230]].map(([x, y], at) => (
      <g key={`f${x}`} transform={`translate(${x} ${y})`}>
        <polygon className="ohr-flak" points="0,-18 5,-5 18,0 5,5 0,18 -5,5 -18,0 -5,-5" style={{ animationDelay: `${at * 520}ms` }} />
      </g>
    ))}
    <rect fill="#0a1824" height="300" width="1200" y="520" />
    <g className="ohr-waves">
      {[0, 1, 2, 3, 4].map((at) => (
        <path d={`M-200 ${560 + at * 50} q 40 -10 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0`} key={`w${at}`} />
      ))}
    </g>
    <g className="ohr-fleet">
      {[[60, 610, 1], [300, 660, 1.3], [-180, 690, 0.9]].map(([x, y, s]) => (
        <g key={`s${x}`} transform={`translate(${x} ${y}) scale(${s})`}>
          <path className="ohr-wake" d="M-10 16 L-120 22 M-10 12 L-90 8" />
          <path d={SHIP} fill="#1f3140" />
        </g>
      ))}
    </g>
  </svg>
);

// III. War and peace: a conference table seen from above. Two treaties slide to its middle as the page scrolls,
// the seal comes down on them, and the doves leave.
const SEATS = Array.from({ length: 10 }, (_, at) => {
  const turn = (at / 10) * Math.PI * 2;
  return { x: 600 + Math.cos(turn) * 380, y: 400 + Math.sin(turn) * 230, turn: (turn * 180) / Math.PI };
});
const FLAGS = ["#c8473a", "#2f6db5", "#e0b34a", "#3a8f5c", "#d9d9d9", "#1f4e8c", "#b5462f", "#2c7a7b", "#c97a2b", "#8a3b2f"];
const TableScene = () => (
  <svg aria-hidden="true" className="ohr-art" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
    <rect fill="#140f0a" height="800" width="1200" />
    {Array.from({ length: 12 }, (_, at) => <rect fill="#1a140d" height="800" key={`p${at}`} width="48" x={at * 100} />)}
    {SEATS.map((seat, at) => (
      <g key={`c${at}`} transform={`translate(${seat.x} ${seat.y}) rotate(${seat.turn + 90})`}>
        <rect fill="#2a1d12" height="44" rx="10" stroke="#5a4127" width="70" x="-35" y="-22" />
        <rect fill={FLAGS[at]} height="16" width="24" x="-12" y="-62" />
        <rect fill="#5a4127" height="20" width="2" x="-13" y="-62" />
      </g>
    ))}
    <ellipse cx="600" cy="400" fill="#3b2817" rx="330" ry="190" stroke="#d9a441" strokeWidth="2" />
    <ellipse cx="600" cy="400" fill="#1d2a22" rx="300" ry="164" />
    <ellipse cx="600" cy="400" fill="none" rx="250" ry="130" stroke="#2b3b30" strokeWidth="2" />
    <g className="ohr-treaty ohr-treaty-left">
      <rect fill="#e8dfcc" height="130" width="100" x="-50" y="-65" />
      {[0, 1, 2, 3, 4, 5].map((at) => <rect fill="#b9ad94" height="4" key={`l${at}`} width={at === 5 ? 40 : 76} x="-38" y={-48 + at * 14} />)}
    </g>
    <g className="ohr-treaty ohr-treaty-right">
      <rect fill="#efe7d6" height="130" width="100" x="-50" y="-65" />
      {[0, 1, 2, 3, 4, 5].map((at) => <rect fill="#b9ad94" height="4" key={`r${at}`} width={at === 5 ? 46 : 76} x="-38" y={-48 + at * 14} />)}
    </g>
    <g className="ohr-seal">
      <circle fill="#a3342b" r="44" />
      <circle fill="none" r="34" stroke="#d26a5c" strokeDasharray="3 5" strokeWidth="2" />
      <polygon fill="#d26a5c" points="0,-22 6,-6 22,0 6,6 0,22 -6,6 -22,0 -6,-6" />
    </g>
    <g className="ohr-doves">
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy]) => (
        <path className={`ohr-dove ohr-dove-${dx > 0 ? "r" : "l"}${dy > 0 ? "d" : "u"}`} d="M0 0 q -14 -14 -28 -6 q 14 2 20 10 q -20 2 -26 14 q 18 -6 34 -4 q 6 -10 0 -14 z" fill="#f2efe8" key={`d${dx}${dy}`} />
      ))}
    </g>
  </svg>
);

// IV. A living world: a valley that goes from summer to the depth of winter as the page scrolls, under a sun that
// crosses the sky; rain comes, then snow, and the lake freezes. Beside it, Rostra's feed scrolls.
const WorldScene = () => (
  <svg aria-hidden="true" className="ohr-art" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
    <rect className="ohr-season-sky" height="800" width="1200" />
    <g className="ohr-sun"><circle cx="600" cy="120" fill="#f0c85a" r="46" /></g>
    <path className="ohr-season-far" d="M0 470 L140 380 L280 430 L420 340 L560 420 L700 360 L860 440 L1000 370 L1200 430 L1200 800 L0 800 Z" />
    <path className="ohr-season-mid" d="M0 560 L180 500 L360 540 L540 490 L720 550 L900 510 L1200 560 L1200 800 L0 800 Z" />
    <ellipse className="ohr-season-lake" cx="420" cy="640" rx="230" ry="46" />
    <path className="ohr-season-near" d="M0 690 L200 650 L420 700 L640 660 L860 710 L1200 670 L1200 800 L0 800 Z" />
    {[[90, 640], [150, 660], [700, 650], [760, 670], [980, 640], [1040, 660], [1100, 645]].map(([x, y]) => (
      <polygon className="ohr-season-tree" key={`t${x}`} points={`${x},${y - 80} ${x + 30},${y} ${x - 30},${y}`} />
    ))}
    <g className="ohr-rain">
      {Array.from({ length: 40 }, (_, at) => (
        <path d={`M${(at * 31) % 1200} ${(at * 53) % 500} l -10 26`} key={`r${at}`} style={{ animationDelay: `${(at * 90) % 900}ms` }} />
      ))}
    </g>
    <g className="ohr-snow">
      {Array.from({ length: 46 }, (_, at) => (
        <circle cx={(at * 29) % 1200} cy={-20} key={`f${at}`} r={at % 3 === 0 ? 4 : 2.5} style={{ animationDelay: `${(at * 260) % 5000}ms`, animationDuration: `${5000 + (at % 5) * 900}ms` }} />
      ))}
    </g>
    <g transform="translate(520 170)">
      <rect fill="#0d0f12" height="420" rx="26" stroke="#3a3d44" strokeWidth="3" width="220" />
      <rect fill="#05070a" height="392" rx="18" width="196" x="12" y="14" />
      <clipPath id="ohr-feed-clip"><rect height="370" rx="14" width="184" x="18" y="24" /></clipPath>
      <g clipPath="url(#ohr-feed-clip)">
        <g className="ohr-feed">
          {Array.from({ length: 9 }, (_, at) => (
            <g key={`p${at}`} transform={`translate(26 ${34 + at * 92})`}>
              <rect fill="#141a20" height="80" rx="10" width="168" />
              <circle cx="20" cy="20" fill={at % 3 === 0 ? "#2bc1f3" : "#2a333c"} r="10" />
              <rect fill="#dfe6ec" height="6" rx="3" width="70" x="38" y="12" />
              <rect fill="#4a5560" height="5" rx="2.5" width="140" x="14" y="40" />
              <rect fill="#4a5560" height="5" rx="2.5" width="100" x="14" y="54" />
            </g>
          ))}
        </g>
      </g>
    </g>
  </svg>
);

// V. The map: a staff map laid flat that tilts and turns as the page scrolls, its relief rising; a globe beside it.
const MapScene = () => (
  <div aria-hidden="true" className="ohr-art ohr-map-scene">
    <div className="ohr-map-plane">
      <svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 1000 700">
        <rect fill="#0f2230" height="700" width="1000" />
        {Array.from({ length: 11 }, (_, at) => <path className="ohr-grid" d={`M${at * 100} 0 V700`} key={`v${at}`} />)}
        {Array.from({ length: 8 }, (_, at) => <path className="ohr-grid" d={`M0 ${at * 100} H1000`} key={`h${at}`} />)}
        <path d="M120 160 C 220 90, 380 110, 470 180 S 600 300, 560 380 S 420 520, 300 500 S 90 400, 120 160 Z" fill="#2c4a3a" />
        <path d="M600 120 C 720 80, 880 140, 900 260 S 840 460, 720 470 S 560 380, 600 120 Z" fill="#4a3d2c" />
        <path d="M560 500 C 650 470, 780 520, 800 600 S 660 690, 580 650 S 500 540, 560 500 Z" fill="#34495a" />
        {[0, 1, 2, 3].map((at) => (
          <ellipse className="ohr-relief" cx={300 + at * 6} cy={290 - at * 10} key={`r${at}`} rx={150 - at * 34} ry={90 - at * 20} />
        ))}
        {[0, 1, 2].map((at) => (
          <ellipse className="ohr-relief" cx={760} cy={270 - at * 8} key={`q${at}`} rx={110 - at * 32} ry={70 - at * 18} />
        ))}
        <path className="ohr-map-front" d="M560 140 L590 230 L560 320 L600 400 L570 470" />
        {[[260, 220], [380, 380], [700, 230], [780, 380], [650, 590]].map(([x, y]) => (
          <g key={`t${x}`} transform={`translate(${x} ${y})`}>
            <circle fill="#f2e6c8" r="6" />
            <circle fill="none" r="12" stroke="#f2e6c8" strokeOpacity="0.4" />
          </g>
        ))}
      </svg>
    </div>
    <svg className="ohr-globe" viewBox="0 0 200 200">
      <circle cx="100" cy="100" fill="#0c1a24" r="90" stroke="#5cc3c9" strokeWidth="2" />
      {[0, 1, 2].map((at) => <ellipse className={`ohr-meridian ohr-meridian-${at}`} cx="100" cy="100" key={`m${at}`} rx="90" ry="90" />)}
      <ellipse cx="100" cy="100" fill="none" rx="90" ry="30" stroke="#5cc3c9" strokeOpacity="0.4" />
    </svg>
  </div>
);

// VI. Yours to shape: the game's window changing its colours passage by passage, the vault door's wheel turning,
// and greetings in many languages drifting by.
const YoursScene = () => (
  <svg aria-hidden="true" className="ohr-art" data-no-translate preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
    <rect className="ohr-yours-bg" height="800" width="1200" />
    <g className="ohr-wheel" transform="translate(250 420)">
      <circle fill="#1b1f25" r="190" stroke="#4a515c" strokeWidth="6" />
      <circle fill="none" r="160" stroke="#2c323a" strokeDasharray="4 10" strokeWidth="4" />
      <g className="ohr-wheel-spokes">
        {[0, 1, 2].map((at) => (
          <g key={`k${at}`} transform={`rotate(${at * 120})`}>
            <rect fill="#5d6672" height="150" rx="10" width="22" x="-11" y="-150" />
            <circle cx="0" cy="-152" fill="#8a94a1" r="18" />
          </g>
        ))}
        <circle fill="#2a2f37" r="62" stroke="#8a94a1" strokeWidth="4" />
        <polygon className="ohr-yours-accent-fill" points="0,-44 10,-10 44,0 10,10 0,44 -10,10 -44,0 -10,-10" />
      </g>
    </g>
    <g transform="translate(560 170)">
      <rect className="ohr-yw ohr-yw-bg" height="460" rx="18" width="560" />
      <rect className="ohr-yw ohr-yw-surface" height="428" rx="12" width="96" x="16" y="16" />
      {[0, 1, 2, 3, 4].map((at) => <rect className={`ohr-yw ${at === 0 ? "ohr-yw-accent" : "ohr-yw-chip"}`} height="44" key={`r${at}`} rx="10" width="64" x="32" y={36 + at * 62} />)}
      <rect className="ohr-yw ohr-yw-surface" height="48" rx="10" width="424" x="128" y="16" />
      {[0, 1].map((at) => (
        <g key={`c${at}`} transform={`translate(${128 + at * 216} 80)`}>
          <rect className="ohr-yw ohr-yw-surface" height="280" rx="12" width="208" />
          <rect className="ohr-yw ohr-yw-bg" height="110" rx="8" width="184" x="12" y="12" />
          <rect fill="#e9eef2" height="10" opacity="0.75" rx="5" width="120" x="14" y="140" />
          <rect fill="#e9eef2" height="8" opacity="0.3" rx="4" width="170" x="14" y="162" />
          <rect fill="#e9eef2" height="8" opacity="0.3" rx="4" width="140" x="14" y="180" />
        </g>
      ))}
      <rect className="ohr-yw ohr-yw-accent" height="44" rx="22" width="190" x="354" y="390" />
    </g>
    {GREETINGS.slice(0, 12).map((greeting, at) => (
      <text className="ohr-greeting" key={greeting.code} lang={greeting.code} style={{ animationDelay: `${at * 900}ms` }} x={60 + (at % 6) * 190} y={at < 6 ? 110 : 730}>
        {greeting.hello}
      </text>
    ))}
  </svg>
);

const gearPath = (teeth, outer, inner) => {
  const points = [];
  for (let at = 0; at < teeth * 2; at += 1) {
    const radius = at % 2 === 0 ? outer : inner;
    const from = (at / (teeth * 2)) * Math.PI * 2;
    const to = ((at + 1) / (teeth * 2)) * Math.PI * 2;
    points.push(`${(Math.cos(from) * radius).toFixed(1)},${(Math.sin(from) * radius).toFixed(1)}`, `${(Math.cos(to) * radius).toFixed(1)},${(Math.sin(to) * radius).toFixed(1)}`);
  }
  return `M${points.join(" L")} Z`;
};
const GEAR_BIG = gearPath(18, 200, 172);
const GEAR_SMALL = gearPath(10, 112, 90);
const GEAR_TINY = gearPath(8, 70, 54);

// VII. Faster, lighter, steadier: the works turning with the scroll, a gauge climbing, a download shrinking.
const EngineScene = () => (
  <svg aria-hidden="true" className="ohr-art" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
    <rect fill="#0d1014" height="800" width="1200" />
    {Array.from({ length: 14 }, (_, at) => (
      <path className="ohr-speed" d={`M-200 ${60 + at * 52} H ${180 + (at % 4) * 90}`} key={`l${at}`} style={{ animationDelay: `${(at * 230) % 1400}ms` }} />
    ))}
    <g transform="translate(420 420)">
      <path className="ohr-gear ohr-gear-big" d={GEAR_BIG} />
      <circle fill="#0d1014" r="60" stroke="#55606c" strokeWidth="6" />
    </g>
    <g transform="translate(694 228)">
      <path className="ohr-gear ohr-gear-small" d={GEAR_SMALL} />
      <circle fill="#0d1014" r="34" stroke="#55606c" strokeWidth="5" />
    </g>
    <g transform="translate(700 560)">
      <path className="ohr-gear ohr-gear-tiny" d={GEAR_TINY} />
      <circle fill="#0d1014" r="22" stroke="#55606c" strokeWidth="4" />
    </g>
    <g transform="translate(960 300)">
      <path d="M-150 0 A150 150 0 0 1 150 0" fill="none" stroke="#2a313a" strokeWidth="22" />
      <path className="ohr-gauge-fill" d="M-150 0 A150 150 0 0 1 150 0" fill="none" strokeWidth="22" />
      {Array.from({ length: 11 }, (_, at) => {
        const turn = Math.PI + (at / 10) * Math.PI;
        return <path d={`M${Math.cos(turn) * 120} ${Math.sin(turn) * 120} L${Math.cos(turn) * 104} ${Math.sin(turn) * 104}`} key={`k${at}`} stroke="#6b7682" strokeWidth="4" />;
      })}
      <g className="ohr-needle"><path d="M-6 0 L0 -132 L6 0 Z" fill="#e8edf2" /></g>
      <circle fill="#e8edf2" r="14" />
    </g>
    <g transform="translate(820 560)">
      <rect fill="#1c232b" height="36" rx="18" width="300" />
      <rect className="ohr-download" height="36" rx="18" width="300" />
    </g>
  </svg>
);

const SCENES = { front: FrontScene, skies: SkiesScene, table: TableScene, world: WorldScene, map: MapScene, yours: YoursScene, engine: EngineScene };

// The finale's emblem: the compass of the mark, its rings turning as the page comes to an end.
const FinaleArt = () => (
  <svg aria-hidden="true" className="ohr-art" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
    <rect fill="#07090c" height="800" width="1200" />
    <g transform="translate(600 400)">
      {Array.from({ length: 24 }, (_, at) => (
        <path className="ohr-ray" d={`M0 -230 L0 -${560 + (at % 3) * 60}`} key={`y${at}`} transform={`rotate(${at * 15})`} />
      ))}
      <g className="ohr-ring-outer">
        <circle fill="none" r="220" stroke="#d9a441" strokeOpacity="0.5" strokeWidth="2" />
        {Array.from({ length: 64 }, (_, at) => (
          <path d={`M0 -220 L0 ${at % 8 === 0 ? -196 : -208}`} key={`t${at}`} stroke="#d9a441" strokeOpacity="0.7" strokeWidth={at % 8 === 0 ? 3 : 1.5} transform={`rotate(${at * 5.625})`} />
        ))}
      </g>
      <g className="ohr-ring-inner">
        <circle fill="#0d1117" r="170" stroke="#d9a441" strokeWidth="3" />
        <circle fill="none" r="150" stroke="#d9a441" strokeDasharray="3 7" strokeOpacity="0.6" strokeWidth="2" />
      </g>
      <path d="M0 -140 L22 -22 L140 0 L22 22 L0 140 L-22 22 L-140 0 L-22 -22 Z" fill="#d9a441" />
      <path d="M0 -140 L22 -22 L0 0 Z M140 0 L22 22 L0 0 Z M0 140 L-22 22 L0 0 Z M-140 0 L-22 -22 L0 0 Z" fill="#0d1117" opacity="0.35" />
      <circle fill="#0d1117" r="14" stroke="#d9a441" strokeWidth="4" />
    </g>
  </svg>
);

const Steps = ({ count, at }) => (
  <span className="ohr-step-count" data-no-translate>{NUMERALS[at] ?? at + 1} / {NUMERALS[count - 1] ?? count}</span>
);

const Chapter = ({ chapter, index, release }) => {
  const Scene = SCENES[chapter.scene] ?? EngineScene;
  const entries = useMemo(() => releaseChapterEntries(release, chapter), [release, chapter]);
  const highlights = chapter.highlights ?? [];
  const passages = highlights.length + 1;
  return (
    <>
      <section className="ohr-chapter" data-ohr-chapter={index} data-ohr-steps={passages} data-ohr-track data-scene={chapter.scene} id={`ohr-chapter-${chapter.key}`} style={{ "--ohr-passages": passages }}>
        <div className="ohr-stage">
          <Scene />
          <div className="ohr-stage-shade" />
          <div className="ohr-numeral" data-no-translate>{NUMERALS[index]}</div>
        </div>
        <div className="ohr-passages">
          <div className="ohr-passage ohr-passage-title">
            <div className="ohr-title-block" data-ohr-reveal>
              <div className="ohr-kicker"><span>Chapter</span> <span data-no-translate>{NUMERALS[index]}</span></div>
              <h2 className="ohr-chapter-title">{chapter.title}</h2>
              {chapter.subtitle && <div className="ohr-chapter-subtitle">{chapter.subtitle}</div>}
              <p className="ohr-chapter-lead">{chapter.lead}</p>
            </div>
          </div>
          {highlights.map((highlight, at) => (
            <div className="ohr-passage" key={highlight.heading}>
              <div className="ohr-card" data-ohr-reveal>
                <Steps at={at} count={highlights.length} />
                <h3 className="ohr-card-heading">{highlight.heading}</h3>
                <p className="ohr-card-text">{highlight.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="ohr-ledger" data-scene={chapter.scene}>
        <div className="ohr-ledger-head" data-ohr-reveal>
          <span className="ohr-ledger-label">Every change in this chapter</span>
          <span className="ohr-ledger-title">{chapter.title}</span>
          <span className="ohr-ledger-rule" />
        </div>
        <div className="ohr-ledger-columns">
          {entries.map((entry) => (
            <article className="ohr-entry" key={entry.key}>
              <div className="ohr-entry-date">{noticeDate(entry.date)}</div>
              <h4 className="ohr-entry-title">{entry.title}</h4>
              <ul>
                {entry.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </>
  );
};

export const ReleaseNotice = ({ update, onClose }) => {
  const still = useStill();
  const narrow = useNarrow(760);
  const rootRef = useRef(null);
  const scrollerRef = useRef(null);
  const [active, setActive] = useState(-1);
  const chapters = update.chapters ?? [];
  const grain = useMemo(() => grainUrl(), []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    scrollerRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --p and data-step for every tracked part, the reading bar, and the chapter in view.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const root = rootRef.current;
    if (!scroller || !root) return undefined;
    let frame = 0;
    let shown = -1;
    const measure = () => {
      frame = 0;
      const view = scroller.clientHeight || 1;
      const top = scroller.scrollTop;
      for (const part of scroller.querySelectorAll("[data-ohr-track]")) {
        const span = Math.max(1, part.offsetHeight - view);
        const raw = clamp((top - part.offsetTop) / span, 0, 1);
        const progress = still ? (part.dataset.ohrHero !== undefined ? 0 : 1) : raw;
        part.style.setProperty("--p", progress.toFixed(4));
        const steps = Number(part.dataset.ohrSteps || 0);
        if (steps) part.dataset.step = String(Math.min(steps - 1, Math.floor(raw * steps)));
      }
      root.style.setProperty("--ohr-read", clamp(top / Math.max(1, scroller.scrollHeight - view), 0, 1).toFixed(4));
      let current = -1;
      for (const part of scroller.querySelectorAll("[data-ohr-chapter]")) {
        if (part.offsetTop <= top + view * 0.5) current = Number(part.dataset.ohrChapter);
      }
      if (current !== shown) {
        shown = current;
        setActive(current);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [still]);

  // Passages rise in as they come into view.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const parts = scroller.querySelectorAll("[data-ohr-reveal]");
    if (still || typeof IntersectionObserver === "undefined") {
      parts.forEach((part) => part.setAttribute("data-in", ""));
      return undefined;
    }
    const observer = new IntersectionObserver((seen) => {
      for (const entry of seen) if (entry.isIntersecting) entry.target.setAttribute("data-in", "");
    }, { root: scroller, threshold: 0.18 });
    parts.forEach((part) => observer.observe(part));
    return () => observer.disconnect();
  }, [still]);

  const goTo = useCallback((key) => {
    const target = scrollerRef.current?.querySelector(`#ohr-chapter-${key}`);
    if (target) scrollerRef.current.scrollTo({ top: target.offsetTop, behavior: still ? "auto" : "smooth" });
  }, [still]);

  return (
    <div
      aria-label={update.title}
      aria-modal="true"
      className="ohr-root"
      data-narrow={narrow || undefined}
      data-still={still || undefined}
      ref={rootRef}
      role="dialog"
      style={{ zIndex: NOTICE_Z }}
    >
      <div className="ohr-scroller" ref={scrollerRef} tabIndex={-1}>
        <section className="ohr-hero" data-ohr-hero data-ohr-track>
          <div className="ohr-stage">
            <HeroArt />
            <div className="ohr-hero-copy">
              <div className="ohr-hero-version"><span>Version</span> <span data-no-translate>{update.version}</span></div>
              <h1 className="ohr-hero-title">{update.title}</h1>
              <div className="ohr-hero-rule"><span /><i /><span /></div>
              <div className="ohr-hero-subtitle">{update.subtitle}</div>
              <div className="ohr-hero-date">{noticeDate(update.date)}</div>
            </div>
            <div className="ohr-scroll-cue"><span>Scroll</span><i /></div>
          </div>
        </section>

        <section className="ohr-intro">
          <p className="ohr-intro-lead" data-ohr-reveal>{update.lead}</p>
          <div className="ohr-contents" data-ohr-reveal>
            <div className="ohr-contents-label">Contents</div>
            <ol>
              {chapters.map((chapter, index) => (
                <li key={chapter.key}>
                  <button className="ohr-contents-item" data-scene={chapter.scene} onClick={() => goTo(chapter.key)} type="button">
                    <span className="ohr-contents-number" data-no-translate>{NUMERALS[index]}</span>
                    <span className="ohr-contents-title">{chapter.title}</span>
                    <span className="ohr-contents-subtitle">{chapter.subtitle}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {chapters.map((chapter, index) => <Chapter chapter={chapter} index={index} key={chapter.key} release={update} />)}

        <section className="ohr-finale" data-ohr-track>
          <div className="ohr-stage">
            <FinaleArt />
            <div className="ohr-finale-copy">
              <div className="ohr-hero-version"><span>Version</span> <span data-no-translate>{update.version}</span></div>
              <h2 className="ohr-finale-title">The world is waiting</h2>
              <button className="ohr-finale-button" onClick={onClose} type="button">{update.button || "Continue"}</button>
            </div>
          </div>
        </section>
      </div>

      <div className="ohr-hud">
        <div className="ohr-hud-mark">
          <img alt="" src="/logo.png" />
          <span data-no-translate>{update.version}</span>
        </div>
        <div className="ohr-hud-bar"><span /></div>
        <button className="ohr-skip" onClick={onClose} type="button">Skip</button>
      </div>
      {!narrow && (
        <nav aria-label="Contents" className="ohr-rail">
          {chapters.map((chapter, index) => (
            <button aria-current={active === index ? "true" : undefined} className="ohr-rail-item" data-scene={chapter.scene} key={chapter.key} onClick={() => goTo(chapter.key)} title={chapter.title} type="button">
              <span className="ohr-rail-number" data-no-translate>{NUMERALS[index]}</span>
              <span className="ohr-rail-title">{chapter.title}</span>
            </button>
          ))}
        </nav>
      )}
      {grain && <div aria-hidden="true" className="ohr-grain" style={{ backgroundImage: `url(${grain})` }} />}
    </div>
  );
};

export default ReleaseNotice;
