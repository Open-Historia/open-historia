/*! Open Historia — Shared Worlds: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the shared games' banners are dressed (SharedWorlds.jsx): the game's own
// greys, and the colours of the players round one table. Each banner is held
// by one of them (its `scene` says which), so its button and its page marker
// are in that player's colour, its arrows grey keys with that colour on them.
// The accent stays in the pictures, where it is the world: nothing of the way
// between the pages is the game's own blue.

export const WORLDS_GROUND = "#141416";
export const WORLDS_STAGE = "#18191c";
export const WORLDS_RAISED = "#232327";
export const WORLDS_INK = "#e7e7ea";
export const WORLDS_SOFT = "rgba(231,231,234,0.72)";
export const WORLDS_FAINT = "rgba(231,231,234,0.34)";
export const WORLDS_LINE = "rgba(231,231,234,0.12)";
export const WORLDS_ACCENT = "#2bc1f3";
export const WORLDS_FACE = "\"Segoe UI\", \"Helvetica Neue\", Arial, system-ui, sans-serif";

// The players, each in their own colour, the same on every page.
export const WORLDS_PLAYERS = Object.freeze({
  amber: "#f2b33d",
  coral: "#e8664f",
  green: "#5cc27a",
  ivory: "#e9e2cf",
});

// Whose page each banner is.
const HELD_BY = { table: "amber", ledger: "coral", secrets: "green", envoys: "ivory", fronts: "amber" };
export const worldsSeat = (banner) => WORLDS_PLAYERS[HELD_BY[banner?.scene]] ?? WORLDS_PLAYERS.amber;

export const SHARED_WORLDS_CHROME = (banner) => {
  const seat = worldsSeat(banner);
  return {
    button: {
      background: seat,
      border: `1px solid ${seat}`,
      borderRadius: "8px",
      boxShadow: "0 2px 0 rgba(0,0,0,0.5)",
      color: WORLDS_GROUND,
      fontFamily: WORLDS_FACE,
      fontWeight: 800,
      letterSpacing: "0.02em",
    },
    arrow: {
      background: WORLDS_RAISED,
      border: "1px solid rgba(231,231,234,0.22)",
      borderRadius: "8px",
      color: seat,
    },
    dot: { on: seat, off: "rgba(231,231,234,0.24)", radius: "999px" },
    skip: { color: WORLDS_SOFT, fontFamily: WORLDS_FACE, letterSpacing: "0.02em" },
  };
};
