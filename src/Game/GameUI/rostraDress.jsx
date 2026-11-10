/*! Open Historia — Rostra's looks, drawn: newsprint, parchment and stone © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make them more detailed and look good" (the owner, 2026-11-10, of the
// newspaper, scroll and stone tablet looks in rostraLooks.js).
//
// What each look adds to the panel social.jsx draws:
//   newspaper  newsprint with a fold across it; a masthead in blackletter over
//              a dateline between rules; the first post a lead story with a
//              drop cap; flags printed in black ink; square-cornered buttons.
//   scroll     parchment, stained and torn at the sides, between two turned
//              wooden rolls; a red wax seal; names in a calligraphic hand; a
//              fleuron between posts; flags faded to sepia.
//   tablet     grey stone, chipped and cracked, with a rounded top and a
//              recessed face; a bronze laurel; names cut in capitals; grooves
//              for rules; flags weathered into the stone.
// Everything is flat colour, noise and shadow: no gradient (noGradients.test.js).

import React from "react";

import { RS, rostraTexture } from "./rostraLooks.js";

const { ACCENT, INK, INK_SOFT, LINE, TITLE_FONT } = RS;

const STYLE_ID = "rostra-look-styles";
export const ensureLookStyles = () => {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = ROSTRA_LOOK_CSS;
  document.head.appendChild(style);
};

// Rules by look, on the class names social.jsx gives its parts. They outrank
// the parts' inline styles where they must (!important), and touch the phone
// not at all.
export const ROSTRA_LOOK_CSS = `
[data-rostra-look="newspaper"] .rostra-author,
[data-rostra-look="scroll"] .rostra-author,
[data-rostra-look="tablet"] .rostra-author { font-family: var(--rs-name-font); }
[data-rostra-look="newspaper"] .rostra-author { font-size: 0.95rem !important; font-weight: 700 !important; letter-spacing: -0.005em; }
[data-rostra-look="newspaper"] .rostra-byline { font-style: italic; }
[data-rostra-look="newspaper"] .rostra-text { text-align: justify; hyphens: auto; font-size: 0.86rem !important; line-height: 1.42 !important; }
[data-rostra-look="newspaper"] .rostra-post:first-of-type .rostra-author { font-size: 1.22rem !important; line-height: 1.15; white-space: normal !important; }
[data-rostra-look="newspaper"] .rostra-post:first-of-type .rostra-text::first-letter { float: left; font-family: var(--rs-name-font); font-size: 3.05em; font-weight: 700; line-height: 0.82; margin: 0.06em 0.09em 0 0; }
[data-rostra-look="newspaper"] .rostra-post { border-bottom: 1px solid var(--rs-edge) !important; }
[data-rostra-look="newspaper"] .rostra-post:first-of-type { border-bottom: 3px double var(--rs-ink-soft) !important; }
[data-rostra-look="newspaper"] .rostra-avatar-face { border-radius: 2px !important; border-color: var(--rs-edge) !important; }
[data-rostra-look="newspaper"] .rostra-flag { filter: grayscale(1) contrast(1.35) brightness(0.92); mix-blend-mode: multiply; border-color: var(--rs-ink) !important; border-radius: 0 !important; }
[data-rostra-look="newspaper"] .rostra-btn { border-radius: 2px !important; background: transparent !important; border: 1px solid var(--rs-edge) !important; }
[data-rostra-look="newspaper"] .rostra-tab-label { font-variant: small-caps; letter-spacing: 0.04em; font-size: 0.7rem !important; }

[data-rostra-look="scroll"] .rostra-author { font-size: 1.02rem !important; font-weight: 400 !important; }
[data-rostra-look="scroll"] .rostra-post { position: relative; border-bottom: none !important; padding-bottom: 1.55rem !important; }
[data-rostra-look="scroll"] .rostra-post::after { content: "❦"; position: absolute; left: 50%; bottom: 0.15rem; transform: translateX(-50%); color: var(--rs-ink-faint); font-size: 1.15rem; line-height: 1; }
[data-rostra-look="scroll"] .rostra-avatar-face { border: 1.5px double var(--rs-edge) !important; }
[data-rostra-look="scroll"] .rostra-flag { filter: sepia(0.75) saturate(0.7) contrast(0.95); mix-blend-mode: multiply; border-color: var(--rs-ink-soft) !important; }
[data-rostra-look="scroll"] .rostra-btn { background: transparent !important; border: 1px solid var(--rs-edge) !important; }
[data-rostra-look="scroll"] .rostra-tab-label { font-style: italic; font-size: 0.68rem !important; }

[data-rostra-look="tablet"] .rostra-author { font-size: 0.8rem !important; letter-spacing: 0.1em; text-transform: uppercase; }
[data-rostra-look="tablet"] .rostra-byline { color: var(--rs-ink-soft) !important; letter-spacing: 0.06em; text-transform: uppercase; font-size: 0.6rem !important; }
[data-rostra-look="tablet"] .rostra-text { letter-spacing: 0.015em; }
[data-rostra-look="tablet"] .rostra-post { border-bottom: 1px solid rgba(0,0,0,0.22) !important; box-shadow: 0 1px 0 rgba(255,255,255,0.32); }
[data-rostra-look="tablet"] .rostra-avatar-face { box-shadow: inset 0 2px 3px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.35); border-color: transparent !important; }
[data-rostra-look="tablet"] .rostra-flag { filter: grayscale(0.85) sepia(0.25) contrast(0.85) brightness(1.05); mix-blend-mode: multiply; opacity: 0.85; border-color: rgba(0,0,0,0.3) !important; }
[data-rostra-look="tablet"] .rostra-btn { background: transparent !important; border: none !important; box-shadow: inset 0 2px 3px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.35); }
[data-rostra-look="tablet"] .rostra-tab-label { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.56rem !important; }
`;

// --- The surface -------------------------------------------------------------------

// Two hairline cracks in the stone, each a dark cut with a pale lip.
const Cracks = () => (
  <svg aria-hidden="true" viewBox="0 0 100 200" preserveAspectRatio="none" style={{ height: "100%", inset: 0, pointerEvents: "none", position: "absolute", width: "100%" }}>
    {[
      "M100 46 L98.4 48 L99.2 50.5 L97.4 53 L98 55",
      "M0 150 L1.6 151.5 L1 154 L2.8 156.5 L2.2 159",
      "M62 200 L61.4 198.6 L62.6 197.6 L62 196.4",
      "M100 128 L98.8 129.4 L99.4 131",
    ].map((d) => (
      <g key={d} fill="none" vectorEffect="non-scaling-stroke">
        <path d={d} stroke="rgba(255,255,255,0.32)" strokeWidth="1" vectorEffect="non-scaling-stroke" transform="translate(0 0.45)" />
        <path d={d} stroke="rgba(30,27,22,0.55)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </g>
    ))}
  </svg>
);

// What the panel is made of, under the app. On a wide screen the look's frame
// (rostraLooks.js rostraFrame) shapes it; on a phone it fills the panel.
export const LookMaterial = ({ look, frame }) => (
  <span
    aria-hidden="true"
    style={{
      inset: 0,
      pointerEvents: "none",
      position: "absolute",
      ...(frame ? frame.material : { backgroundColor: "var(--rs-screen)", borderRadius: "16px" }),
      backgroundImage: rostraTexture(look),
    }}
  >
    {/* The newspaper's fold, across the middle. */}
    {look === "newspaper" && (
      <>
        <span style={{ background: "rgba(60,48,26,0.12)", height: "1px", left: 0, position: "absolute", right: 0, top: "50%" }} />
        <span style={{ background: "rgba(255,255,255,0.45)", height: "1px", left: 0, position: "absolute", right: 0, top: "calc(50% + 1px)" }} />
      </>
    )}
    {look === "tablet" && frame && <Cracks />}
  </span>
);

// One of the scroll's rolls: the parchment wound on a turned wooden rod, a knob
// at each end.
export const ScrollRoll = ({ end }) => {
  const knob = (side) => (
    <span style={{ [side]: 0, alignItems: "center", display: "flex", height: "100%", position: "absolute", top: 0, flexDirection: side === "left" ? "row" : "row-reverse" }}>
      <span style={{ background: "#4a2c12", border: "1px solid #2e1a09", borderRadius: "45%", boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.35), inset 0 2px 0 rgba(255,255,255,0.22)", height: "1.55rem", width: "0.95rem" }} />
      <span style={{ background: "#6b4220", border: "1px solid #3b2410", borderRadius: "3px", boxShadow: "inset 0 2px 0 rgba(255,255,255,0.2)", height: "0.85rem", width: "0.5rem" }} />
    </span>
  );
  return (
    <span aria-hidden="true" style={{ height: "1.7rem", left: "-1.45rem", position: "absolute", right: "-1.45rem", [end]: "-1.45rem", zIndex: 2 }}>
      {knob("left")}
      {knob("right")}
      {/* The wound parchment, with the edge of each turn. */}
      <span style={{ backgroundColor: "#dfc285", backgroundImage: rostraTexture("scroll"), border: "1px solid #a67c3d", borderRadius: "0.55rem", bottom: "0.05rem", boxShadow: "inset 0 -5px 0 rgba(120,76,24,0.32), inset 0 3px 0 rgba(255,250,230,0.45), 0 3px 6px rgba(0,0,0,0.35)", left: "1.35rem", position: "absolute", right: "1.35rem", top: "0.05rem" }}>
        <span style={{ background: "rgba(120,76,24,0.3)", height: "1px", left: "0.4rem", position: "absolute", right: "0.4rem", top: "34%" }} />
        <span style={{ background: "rgba(120,76,24,0.22)", height: "1px", left: "0.4rem", position: "absolute", right: "0.4rem", top: "62%" }} />
      </span>
    </span>
  );
};

// --- Marks ---------------------------------------------------------------------------

// A seal of red wax, pressed with an R.
const WaxSeal = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M20 1.5c2.6 0 3.4 2.2 5.8 2.6 2.5.4 4.3-1.3 6.2.4 1.9 1.7.6 3.9 1.6 6.1 1 2.3 3.6 2.9 3.8 5.4.2 2.6-2 3.5-2.2 6-.2 2.4 1.9 4.1.8 6.4-1.1 2.3-3.6 1.8-5.4 3.4-1.8 1.7-1.7 4.3-4.1 5.1-2.4.8-4-1.3-6.5-1.3s-4.1 2.1-6.5 1.3c-2.4-.8-2.3-3.4-4.1-5.1-1.8-1.6-4.3-1.1-5.4-3.4-1.1-2.3 1-4 .8-6.4-.2-2.5-2.4-3.4-2.2-6 .2-2.5 2.8-3.1 3.8-5.4 1-2.2-.3-4.4 1.6-6.1 1.9-1.7 3.7 0 6.2-.4C16.6 3.7 17.4 1.5 20 1.5z" fill="#8f1d14" />
    <circle cx="20" cy="20" r="12.2" fill="#a3241a" />
    <circle cx="20" cy="20" r="12.2" fill="none" stroke="#6e140d" strokeWidth="1.2" />
    <circle cx="20" cy="20" r="10.4" fill="none" stroke="#c2402f" strokeWidth="0.7" strokeDasharray="1.2 1.4" />
    <text x="20" y="25.6" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="15" fontWeight="700" fill="#6e140d">R</text>
    <text x="20" y="25" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="15" fontWeight="700" fill="#d6604d" opacity="0.55">R</text>
    <path d="M10 11.5c2-2.4 5-3.8 8.4-4" fill="none" stroke="#d6604d" strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />
  </svg>
);

// A laurel wreath in bronze, cut into the stone.
const LAUREL_LEAVES = (() => {
  const leaves = [];
  for (let i = 0; i < 7; i += 1) {
    const theta = 112 + i * 21;
    for (const side of [1, -1]) {
      const angle = side > 0 ? theta : 180 - theta;
      const rad = (angle * Math.PI) / 180;
      const x = 20 + 13.5 * Math.cos(rad);
      const y = 20.5 + 13.5 * Math.sin(rad);
      // Along the wreath, leaning out from it.
      const tilt = angle + (side > 0 ? -28 : 28);
      leaves.push({ key: `${side}-${i}`, x: x.toFixed(2), y: y.toFixed(2), tilt: tilt.toFixed(1), size: 1 - i * 0.045 });
    }
  }
  return leaves;
})();
const Laurel = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flexShrink: 0, filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.4))" }}>
    <path d="M12.5 32.5A13.5 13.5 0 0 1 7.6 12.8M27.5 32.5a13.5 13.5 0 0 0 4.9-19.7" fill="none" stroke="#4a3410" strokeWidth="0.9" strokeLinecap="round" />
    <g fill="#7a561c" stroke="#3f2b0c" strokeWidth="0.45">
      {LAUREL_LEAVES.map((leaf) => (
        <ellipse key={leaf.key} cx={leaf.x} cy={leaf.y} rx={(1.5 * leaf.size).toFixed(2)} ry={(3.6 * leaf.size).toFixed(2)} transform={`rotate(${leaf.tilt} ${leaf.x} ${leaf.y})`} />
      ))}
    </g>
    <path d="M16.5 34.5l3.5-1.6 3.5 1.6M20 32.9v3" fill="none" stroke="#3f2b0c" strokeWidth="0.9" strokeLinecap="round" />
    <text x="20" y="25.2" textAnchor="middle" fontFamily="'Perpetua Titling MT', 'Times New Roman', serif" fontSize="13" fontWeight="700" fill="#3a2a10">R</text>
  </svg>
);

export const LookMark = ({ look }) => (look === "scroll" ? <WaxSeal /> : look === "tablet" ? <Laurel /> : null);

// --- Rules -----------------------------------------------------------------------------

// The line under a look's header and over its tabs: a fleuron between two
// strokes on parchment, a groove in stone, a double rule in a newspaper.
export const LookRule = ({ look, flip = false }) => {
  if (look === "scroll") {
    return (
      <div aria-hidden="true" style={{ alignItems: "center", color: ACCENT, display: "flex", flexShrink: 0, gap: "0.45rem", padding: "0 1rem" }}>
        <span style={{ background: LINE, flex: 1, height: "1px" }} />
        <span style={{ fontSize: "1.25rem", lineHeight: 1, transform: flip ? "scaleY(-1)" : undefined }}>❧</span>
        <span style={{ background: LINE, flex: 1, height: "1px" }} />
      </div>
    );
  }
  if (look === "tablet") return <div aria-hidden="true" style={{ borderTop: "1px solid rgba(0,0,0,0.28)", boxShadow: "0 1px 0 rgba(255,255,255,0.35)", flexShrink: 0, margin: "0 0.7rem" }} />;
  if (look === "newspaper") return <div aria-hidden="true" style={{ borderTop: `3px double ${INK_SOFT}`, flexShrink: 0 }} />;
  return null;
};

// --- The newspaper's masthead -------------------------------------------------------

// The name in blackletter across the top, and under it, between rules, the
// issue's number (the turn), the day, and what the paper is.
export const NewspaperMasthead = ({ date, round, actions }) => (
  <div className="rostra-masthead" style={{ flexShrink: 0, padding: "0.35rem 0.85rem 0", position: "relative" }}>
    <div style={{ alignItems: "center", display: "flex", gap: "0.3rem", position: "absolute", right: "0.6rem", top: "0.45rem" }}>{actions}</div>
    <div data-no-translate style={{ color: INK, fontFamily: TITLE_FONT, fontSize: "2.45rem", fontWeight: 400, lineHeight: 1.08, padding: "0.15rem 4.4rem 0.2rem", textAlign: "center" }}>Rostra</div>
    <div style={{ alignItems: "center", borderBottom: `3px double ${INK_SOFT}`, borderTop: `1px solid ${INK_SOFT}`, color: INK_SOFT, display: "grid", fontSize: "0.6rem", gap: "0.4rem", gridTemplateColumns: "1fr auto 1fr", letterSpacing: "0.06em", padding: "0.22rem 0.1rem", textTransform: "uppercase" }}>
      <span data-no-translate>{round > 0 ? `№ ${round}` : ""}</span>
      <span style={{ fontStyle: "italic", letterSpacing: "0.02em", textTransform: "none", whiteSpace: "nowrap" }}>What the world is saying</span>
      <span data-no-translate style={{ textAlign: "right", whiteSpace: "nowrap" }}>{date}</span>
    </div>
    <div style={{ height: "0.35rem" }} />
  </div>
);
