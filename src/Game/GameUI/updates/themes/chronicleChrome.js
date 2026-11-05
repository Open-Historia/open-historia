/*! Open Historia — the chronicle's banners: the way between them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The chronicle (Chronicle.jsx) dresses each banner in the banner's own palette
// and lettering, so the way between its pages is worked out from the banner
// shown (a theme's chrome may be a function of the banner: UpdateNotice.jsx
// chromeOf): its accent for the button and the markers, its ground for the
// button's words, its lettering throughout.

export const CHRONICLE_FONTS = Object.freeze({
  serif: "Georgia, \"Times New Roman\", serif",
  mono: "\"Courier New\", Courier, monospace",
  stencil: "\"Bahnschrift Condensed\", \"Bahnschrift\", \"DIN Condensed\", \"Oswald\", \"Arial Narrow\", sans-serif",
  rounded: "\"Trebuchet MS\", \"Segoe UI\", sans-serif",
  sans: "\"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
});

// A banner's palette, filled in: { accent, ground, ink, soft, font }.
export const chroniclePalette = (banner) => {
  const palette = banner?.palette ?? {};
  return {
    accent: palette.accent || "#c9a54c",
    ground: palette.ground || "#121417",
    ink: palette.ink || "#f3efe6",
    soft: palette.soft || "rgba(243,239,230,0.72)",
    font: CHRONICLE_FONTS[palette.font] || CHRONICLE_FONTS.sans,
    caps: palette.font === "stencil" || palette.font === "mono",
  };
};

// Two hex digits of opacity on a "#rrggbb" colour.
const faded = (colour, alpha) => (/^#[0-9a-f]{6}$/i.test(colour) ? `${colour}${alpha}` : colour);

export const CHRONICLE_CHROME = (banner) => {
  const { accent, ground, font, caps } = chroniclePalette(banner);
  return {
    button: { background: accent, border: `1px solid ${accent}`, borderRadius: "6px", color: ground, fontFamily: font, letterSpacing: caps ? "0.1em" : "0.02em", textTransform: caps ? "uppercase" : "none" },
    arrow: { background: faded(accent, "14"), border: `1px solid ${faded(accent, "aa")}`, color: accent },
    dot: { on: accent, off: faded(accent, "4d") },
    skip: { color: accent, fontFamily: font },
  };
};
