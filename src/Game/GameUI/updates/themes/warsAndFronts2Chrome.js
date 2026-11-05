/*! Open Historia — Wars and Fronts Part Two: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "the buttons and markers should not be blue, everything to do with it should
// be themed" (the owner, 2026-10-15). The notice's arrows, page markers, Skip
// and its button, as this update's banners are dressed: steel keys with brass
// arrows, brass markers, a red key stencilled in capitals (the war room's).
// Kept apart from the banners themselves (WarsAndFronts2.jsx), which load
// later: the way between them is drawn at once.

import { BONE, BRASS, RED, RED_BRIGHT, STEEL, STENCIL } from "../../warRoomTheme.js";

export const WARS_AND_FRONTS_2_CHROME = Object.freeze({
  button: {
    background: RED,
    border: `1px solid ${RED_BRIGHT}`,
    borderRadius: "3px",
    boxShadow: "0 2px 0 rgba(0,0,0,0.55)",
    color: BONE,
    fontFamily: STENCIL,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  arrow: {
    background: STEEL.raised,
    borderBottom: `1px solid ${STEEL.seam}`,
    borderLeft: `1px solid ${STEEL.raisedSide}`,
    borderRadius: "3px",
    borderRight: `1px solid ${STEEL.seam}`,
    borderTop: `1px solid ${STEEL.raisedTop}`,
    color: BRASS,
  },
  dot: { on: BRASS, off: "rgba(201,165,76,0.3)", radius: "1px" },
  skip: { color: BRASS, fontFamily: STENCIL, letterSpacing: "0.12em", textTransform: "uppercase" },
});
