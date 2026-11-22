/*! Open Historia — Rostra's looks: a phone, a newspaper, a scroll and a stone tablet © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so rostra can be themed as a phone, newspaper, scroll, and a stone
// tablet selected by the scenario designer in features" (the owner, 2026-11-10).
// The scenario's author picks one in the Social media feature (server/
// gameFeatures.js, setting "look"); only how Rostra is drawn changes.
//
// Rostra's parts (social.jsx, rostraSearch.jsx, rostraRefresh.jsx) take every
// colour and face from the custom properties below, set on the panel, each
// with the phone's value as its fallback. A look is those values and the frame
// drawn round them on a wide screen; on a phone the frame goes and the look's
// paper fills the panel.
//
// Flat colours only, as everywhere in the game's UI: a scroll's rolls and a
// tablet's carving are drawn with edges and shadows, never a gradient.

const SANS = "sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

export const ROSTRA_LOOK_VARS = Object.freeze({
  phone: Object.freeze({
    "--rs-accent": "#2bc1f3",
    "--rs-accent-soft": "rgba(43,193,243,0.14)",
    "--rs-accent-edge": "rgba(43,193,243,0.45)",
    "--rs-accent-bar": "rgba(43,193,243,0.28)",
    "--rs-on-accent": "#06171d",
    "--rs-ink": "#f4f4f5",
    "--rs-ink-soft": "rgba(244,244,245,0.62)",
    "--rs-ink-faint": "rgba(244,244,245,0.38)",
    "--rs-line": "rgba(255,255,255,0.08)",
    "--rs-edge": "rgba(255,255,255,0.12)",
    "--rs-wash": "rgba(255,255,255,0.06)",
    "--rs-wash-faint": "rgba(255,255,255,0.03)",
    "--rs-avatar": "#2a2a2f",
    "--rs-screen": "#0b0b0d",
    "--rs-warn": "rgba(253,186,116,0.95)",
    "--rs-font": SANS,
    "--rs-title-font": SANS,
    "--rs-name-font": SANS,
    "--rs-carve": "none",
  }),
  // A broadsheet: black ink on newsprint, an ink-red for what can be pressed.
  newspaper: Object.freeze({
    "--rs-accent": "#8c1d18",
    "--rs-accent-soft": "rgba(140,29,24,0.1)",
    "--rs-accent-edge": "rgba(140,29,24,0.45)",
    "--rs-accent-bar": "rgba(140,29,24,0.22)",
    "--rs-on-accent": "#f3eee1",
    "--rs-ink": "#1b1a17",
    "--rs-ink-soft": "rgba(27,26,23,0.74)",
    "--rs-ink-faint": "rgba(27,26,23,0.5)",
    "--rs-line": "rgba(27,26,23,0.22)",
    "--rs-edge": "rgba(27,26,23,0.3)",
    "--rs-wash": "rgba(27,26,23,0.07)",
    "--rs-wash-faint": "rgba(27,26,23,0.035)",
    "--rs-avatar": "#d9d2bf",
    "--rs-screen": "#f1ebdb",
    "--rs-warn": "#8c1d18",
    "--rs-font": SERIF,
    "--rs-title-font": "'Old English Text MT', 'UnifrakturMaguntia', 'Engravers MT', Georgia, serif",
    "--rs-name-font": "Georgia, 'Times New Roman', serif",
    "--rs-carve": "none",
  }),
  // Parchment, in sepia ink, a wax-seal red.
  scroll: Object.freeze({
    "--rs-accent": "#9a3412",
    "--rs-accent-soft": "rgba(154,52,18,0.12)",
    "--rs-accent-edge": "rgba(154,52,18,0.45)",
    "--rs-accent-bar": "rgba(154,52,18,0.24)",
    "--rs-on-accent": "#f6e7c1",
    "--rs-ink": "#3a2814",
    "--rs-ink-soft": "rgba(58,40,20,0.78)",
    "--rs-ink-faint": "rgba(58,40,20,0.55)",
    "--rs-line": "rgba(58,40,20,0.2)",
    "--rs-edge": "rgba(58,40,20,0.3)",
    "--rs-wash": "rgba(58,40,20,0.08)",
    "--rs-wash-faint": "rgba(58,40,20,0.04)",
    "--rs-avatar": "#dcc48e",
    "--rs-screen": "#eedcae",
    "--rs-warn": "#9a3412",
    "--rs-font": "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
    "--rs-title-font": "'Lucida Calligraphy', 'Apple Chancery', 'Monotype Corsiva', Gabriola, 'URW Chancery L', cursive",
    "--rs-name-font": "'Lucida Calligraphy', 'Apple Chancery', 'Monotype Corsiva', Gabriola, 'URW Chancery L', cursive",
    "--rs-carve": "none",
  }),
  // Grey stone, the letters cut into it, bronze for what can be pressed.
  tablet: Object.freeze({
    "--rs-accent": "#6b4a16",
    "--rs-accent-soft": "rgba(107,74,22,0.16)",
    "--rs-accent-edge": "rgba(107,74,22,0.5)",
    "--rs-accent-bar": "rgba(107,74,22,0.3)",
    "--rs-on-accent": "#ece6d8",
    "--rs-ink": "#25231f",
    "--rs-ink-soft": "rgba(37,35,31,0.84)",
    "--rs-ink-faint": "rgba(37,35,31,0.66)",
    "--rs-line": "rgba(37,35,31,0.2)",
    "--rs-edge": "rgba(37,35,31,0.3)",
    "--rs-wash": "rgba(37,35,31,0.08)",
    "--rs-wash-faint": "rgba(37,35,31,0.04)",
    "--rs-avatar": "#a8a398",
    "--rs-screen": "#b9b4a8",
    "--rs-warn": "#7f1d1d",
    "--rs-font": "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
    "--rs-title-font": "'Perpetua Titling MT', 'Trajan Pro', Copperplate, Cinzel, 'Times New Roman', serif",
    "--rs-name-font": "'Perpetua Titling MT', 'Trajan Pro', Copperplate, Cinzel, 'Times New Roman', serif",
    "--rs-carve": "0 1px 0 rgba(255,255,255,0.35)",
  }),
});

export const rostraLookVars = (look) => ROSTRA_LOOK_VARS[look] ?? ROSTRA_LOOK_VARS.phone;

// Each part's own value: the custom property, with the phone's as the fallback.
const v = (name) => `var(${name}, ${ROSTRA_LOOK_VARS.phone[name]})`;
export const RS = Object.freeze({
  ACCENT: v("--rs-accent"),
  ACCENT_SOFT: v("--rs-accent-soft"),
  ACCENT_EDGE: v("--rs-accent-edge"),
  ACCENT_BAR: v("--rs-accent-bar"),
  ON_ACCENT: v("--rs-on-accent"),
  INK: v("--rs-ink"),
  INK_SOFT: v("--rs-ink-soft"),
  INK_FAINT: v("--rs-ink-faint"),
  LINE: v("--rs-line"),
  EDGE: v("--rs-edge"),
  WASH: v("--rs-wash"),
  WASH_FAINT: v("--rs-wash-faint"),
  AVATAR: v("--rs-avatar"),
  SCREEN: v("--rs-screen"),
  WARN: v("--rs-warn"),
  FONT: v("--rs-font"),
  TITLE_FONT: v("--rs-title-font"),
  CARVE: v("--rs-carve"),
  NAME_FONT: v("--rs-name-font"),
});

// --- The material each look is made of -------------------------------------------
//
// No gradient anywhere (src/noGradients.test.js): a surface's grain is SVG noise
// tinted to one colour, laid over one flat colour, and its edges are drawn with
// a clip path and plain shadows.

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
// One tile of noise in one colour [r, g, b] (0 to 1), as opaque as the noise is
// bright: alpha = k * noise + c, so a negative c leaves only the brightest of it.
const noise = ({ size, freq, octaves = 2, seed = 1, colour, k, c, type = "fractalNoise" }) => svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='n' x='0' y='0' width='100%' height='100%'>`
  + `<feTurbulence type='${type}' baseFrequency='${freq}' numOctaves='${octaves}' seed='${seed}' stitchTiles='stitch'/>`
  + `<feColorMatrix type='matrix' values='0 0 0 0 ${colour[0]} 0 0 0 0 ${colour[1]} 0 0 0 0 ${colour[2]} ${k} 0 0 0 ${c}'/>`
  + `</filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
);

export const ROSTRA_TEXTURES = Object.freeze({
  // Newsprint: a fine, even grain and the faint fibres of cheap paper.
  newspaper: [
    noise({ size: 180, freq: 0.85, octaves: 2, seed: 3, colour: [0.22, 0.18, 0.1], k: 0.42, c: -0.16 }),
    noise({ size: 360, freq: "0.004 0.09", octaves: 2, seed: 8, colour: [0.35, 0.28, 0.15], k: 0.3, c: -0.17 }),
  ].join(", "),
  // Parchment: broad stains under a coarser grain.
  scroll: [
    noise({ size: 160, freq: 0.7, octaves: 2, seed: 5, colour: [0.3, 0.18, 0.05], k: 0.5, c: -0.19 }),
    noise({ size: 420, freq: 0.009, octaves: 4, seed: 11, colour: [0.5, 0.3, 0.08], k: 1.05, c: -0.45 }),
  ].join(", "),
  // Stone: mottling, grain, and pale and dark specks.
  tablet: [
    noise({ size: 140, freq: 1.7, octaves: 1, seed: 2, colour: [1, 1, 0.96], k: 2.6, c: -1.75 }),
    noise({ size: 150, freq: 1.5, octaves: 1, seed: 9, colour: [0.12, 0.11, 0.1], k: 2.4, c: -1.6 }),
    noise({ size: 200, freq: 0.9, octaves: 3, seed: 4, colour: [0.16, 0.15, 0.13], k: 0.62, c: -0.24 }),
    noise({ size: 460, freq: 0.011, octaves: 4, seed: 6, colour: [0.2, 0.19, 0.16], k: 0.95, c: -0.38 }),
  ].join(", "),
});
export const rostraTexture = (look) => ROSTRA_TEXTURES[look] ?? "none";

// A ragged edge as a clip path: points round the box, pushed inwards by up to
// `amp` pixels on the sides named, the same every time for the same seed.
export const roughEdge = ({ amp, steps, seed, sides }) => {
  let state = seed;
  const rand = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const jag = (side) => (sides.includes(side) ? +(rand() * amp).toFixed(1) : 0);
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push(`calc(${(i / steps) * 100}%) calc(0% + ${jag("top")}px)`);
  for (let i = 1; i <= steps; i += 1) points.push(`calc(100% - ${jag("right")}px) calc(${(i / steps) * 100}%)`);
  for (let i = steps - 1; i >= 0; i -= 1) points.push(`calc(${(i / steps) * 100}%) calc(100% - ${jag("bottom")}px)`);
  for (let i = steps - 1; i >= 1; i -= 1) points.push(`calc(0% + ${jag("left")}px) calc(${(i / steps) * 100}%)`);
  return `polygon(${points.join(", ")})`;
};

const SCROLL_EDGE = roughEdge({ amp: 4, steps: 52, seed: 41, sides: ["left", "right"] });
const TABLET_EDGE = roughEdge({ amp: 2.6, steps: 34, seed: 97, sides: ["left", "right", "bottom"] });

// The frame round the panel on a wide screen, for every look but the phone
// (social.jsx draws the phone's own):
//   body      the panel's own box: its size and the shadow it casts;
//   material  the surface under the app (rostraDress.jsx LookMaterial draws it);
//   inner     the part the app is drawn on;
//   rolls     the scroll's two rolls.
// The shadow is a drop shadow of the whole panel, so it follows a ragged edge.
export const rostraFrame = (look) => {
  if (look === "newspaper") {
    return {
      body: { filter: "drop-shadow(0 16px 26px rgba(0,0,0,0.5)) drop-shadow(0 2px 3px rgba(0,0,0,0.3))", padding: "0.7rem 0.75rem 0.65rem" },
      material: { backgroundColor: "#f0e9d6", border: "1px solid #cbbf9f", borderRadius: "2px", boxShadow: "inset 0 0 34px rgba(150,118,58,0.22)" },
      inner: { borderBottom: "1px solid rgba(27,26,23,0.55)", borderRadius: 0, borderTop: "none" },
      rolls: false,
    };
  }
  if (look === "scroll") {
    return {
      body: { filter: "drop-shadow(0 16px 24px rgba(0,0,0,0.5))", margin: "1.35rem 0", padding: "0.55rem 0.9rem 0.6rem" },
      material: { backgroundColor: "#eddaa9", boxShadow: "inset 0 0 46px rgba(120,72,18,0.42), inset 0 0 10px rgba(120,72,18,0.3)", clipPath: SCROLL_EDGE },
      inner: { borderRadius: 0 },
      rolls: true,
    };
  }
  if (look === "tablet") {
    return {
      body: { filter: "drop-shadow(0 18px 26px rgba(0,0,0,0.55)) drop-shadow(0 2px 2px rgba(0,0,0,0.35))", padding: "1.9rem 0.95rem 0.95rem" },
      material: { backgroundColor: "#a29d91", borderRadius: "11rem 11rem 0.9rem 0.9rem / 5.2rem 5.2rem 0.9rem 0.9rem", boxShadow: "inset 0 3px 0 rgba(255,255,255,0.28), inset 0 -4px 0 rgba(0,0,0,0.28), inset 0 0 28px rgba(0,0,0,0.22)", clipPath: TABLET_EDGE },
      inner: { background: "rgba(40,36,30,0.07)", borderRadius: "8.5rem 8.5rem 0.5rem 0.5rem / 3.4rem 3.4rem 0.5rem 0.5rem", boxShadow: "inset 0 3px 6px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.35), 0 1px 0 rgba(255,255,255,0.3)", paddingTop: "1.6rem" },
      rolls: false,
    };
  }
  return null;
};
