/*! Open Historia — Seasons and Weather: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the seasons' banner is dressed (SeasonsAndWeather.jsx): an almanac's
// night-blue page, frost-white lines, the sun's amber for what is pressed, a
// book face.

export const SEASONS_INK = "#0e1720";
export const SEASONS_FROST = "#dcecf3";
export const SEASONS_FROST_SOFT = "rgba(220,236,243,0.72)";
export const SEASONS_SUN = "#f0b44c";
export const SEASONS_SERIF = "\"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, serif";

export const SEASONS_CHROME = Object.freeze({
  button: {
    background: SEASONS_SUN,
    border: `1px solid ${SEASONS_SUN}`,
    borderRadius: "10px",
    color: SEASONS_INK,
    fontFamily: SEASONS_SERIF,
    fontWeight: 700,
    letterSpacing: "0.03em",
  },
  arrow: {
    background: "rgba(220,236,243,0.06)",
    border: `1px solid ${SEASONS_FROST}`,
    color: SEASONS_FROST,
  },
  dot: { on: SEASONS_SUN, off: "rgba(220,236,243,0.3)" },
  skip: { color: SEASONS_FROST, fontFamily: SEASONS_SERIF, fontStyle: "italic" },
});
