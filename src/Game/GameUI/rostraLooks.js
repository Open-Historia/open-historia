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
    "--rs-title-font": "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
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
    "--rs-font": "'Trajan Pro', Cinzel, 'Times New Roman', serif",
    "--rs-title-font": "'Trajan Pro', Cinzel, 'Times New Roman', serif",
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
});

// The frame round the panel on a wide screen, for every look but the phone
// (social.jsx draws the phone's own). `body` is the panel's box; `ends` the
// scroll's two rolls; `inner` the surface the app is drawn on.
export const rostraFrame = (look) => {
  if (look === "newspaper") {
    return {
      body: { background: "#f1ebdb", border: "1px solid #c8bea4", borderRadius: "3px", boxShadow: "0 18px 50px rgba(0,0,0,0.5), 6px 6px 0 rgba(0,0,0,0.18)", padding: "0.55rem" },
      inner: { border: "3px double rgba(27,26,23,0.55)", borderRadius: 0 },
      ends: false,
    };
  }
  if (look === "scroll") {
    return {
      body: { background: "#eedcae", borderLeft: "1px solid #c9a96a", borderRight: "1px solid #c9a96a", borderRadius: 0, boxShadow: "0 18px 50px rgba(0,0,0,0.5), inset 10px 0 14px -10px rgba(90,60,20,0.45), inset -10px 0 14px -10px rgba(90,60,20,0.45)", margin: "1.05rem 0", padding: "0.35rem 0.6rem" },
      inner: { borderRadius: 0 },
      ends: true,
    };
  }
  if (look === "tablet") {
    return {
      body: { background: "#9d988c", border: "1px solid #6f6b62", borderRadius: "10rem 10rem 1rem 1rem / 5rem 5rem 1rem 1rem", boxShadow: "0 18px 50px rgba(0,0,0,0.55), inset 0 2px 0 rgba(255,255,255,0.25), inset 0 -3px 0 rgba(0,0,0,0.25)", padding: "1.6rem 0.75rem 0.75rem" },
      inner: { borderRadius: "8rem 8rem 0.55rem 0.55rem / 3rem 3rem 0.55rem 0.55rem", boxShadow: "inset 0 2px 5px rgba(0,0,0,0.35), inset 0 -1px 0 rgba(255,255,255,0.3)", paddingTop: "1.5rem" },
      ends: false,
    };
  }
  return null;
};
