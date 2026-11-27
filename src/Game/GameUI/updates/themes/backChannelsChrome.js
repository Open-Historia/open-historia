/*! Open Historia — Back Channels: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the Back Channels banners are dressed (BackChannels.jsx): a back room at
// night, its concrete and ink, the amber of the one lamp over the table, the
// paper of a dossier, in a typewriter's hand.

export const BACK_ROOM = "#141311";
export const BACK_WALL = "#1d1b18";
export const BACK_INK = "#0b0a09";
export const BACK_LAMP = "#e2a63b";
export const BACK_PAPER = "#ebe5d6";
export const BACK_PAPER_SOFT = "rgba(235,229,214,0.74)";
export const BACK_RULE = "rgba(235,229,214,0.16)";
export const BACK_STAMP = "#b8312f";
export const BACK_FACE = "\"Courier New\", Courier, \"Lucida Console\", monospace";

export const BACK_CHANNELS_CHROME = Object.freeze({
  button: {
    background: BACK_LAMP,
    border: `1px solid ${BACK_LAMP}`,
    borderRadius: "2px",
    color: BACK_INK,
    fontFamily: BACK_FACE,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  arrow: {
    background: "rgba(226,166,59,0.08)",
    border: `1px solid ${BACK_LAMP}`,
    borderRadius: "2px",
    color: BACK_LAMP,
  },
  dot: { on: BACK_LAMP, off: "rgba(235,229,214,0.24)", radius: "0" },
  skip: { color: BACK_PAPER_SOFT, fontFamily: BACK_FACE, letterSpacing: "0.06em" },
});
