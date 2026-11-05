/*! Open Historia — the music update: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the music banner is dressed (Music.jsx): gold on the dark of a concert
// hall, round keys like a player's, a serif hand.

export const MUSIC_INK = "#101319";
export const MUSIC_GOLD = "#e2b04a";
export const MUSIC_CREAM = "#f3e9d2";
export const MUSIC_SERIF = "Georgia, \"Times New Roman\", serif";

export const MUSIC_CHROME = Object.freeze({
  button: {
    background: MUSIC_GOLD,
    border: `1px solid ${MUSIC_GOLD}`,
    borderRadius: "999px",
    color: MUSIC_INK,
    fontFamily: MUSIC_SERIF,
    fontStyle: "italic",
    letterSpacing: "0.02em",
  },
  arrow: {
    background: "rgba(226,176,74,0.08)",
    border: `1px solid ${MUSIC_GOLD}`,
    color: MUSIC_GOLD,
  },
  dot: { on: MUSIC_GOLD, off: "rgba(226,176,74,0.3)" },
  skip: { color: MUSIC_CREAM, fontFamily: MUSIC_SERIF, fontStyle: "italic" },
});
