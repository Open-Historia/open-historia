/*! Open Historia — the war room's look: rough steel, brass and red © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room is fitted out like the inside of something armoured: plates of
// rough steel held by rivets (roughMetal.js), lettering as it is stencilled on
// a crate, brass for what is written and red for what is ordered. The owner
// asked for this look for the war room; the rest of the interface is flat grey
// (and nothing here fades from one colour to another either: a plate is a
// picture worked out a pixel at a time, a bevel is two flat lines).

import { rivetUrl, roughMetalUrl } from "./roughMetal.js";

export const STEEL = Object.freeze({
  // The colour a plate is where its picture could not be made.
  plate: "#2c2f34",
  // The dark of a seam between plates, and the lip of light along a plate's edge.
  seam: "#0a0b0d",
  lip: "rgba(255,255,255,0.1)",
  // A part let into the plate: a tray, a slot.
  sunk: "rgba(0,0,0,0.34)",
  sunkLine: "rgba(0,0,0,0.66)",
  // A raised part: a key, a tab.
  raised: "#3d4249",
  raisedTop: "#5f666f",
  raisedSide: "#4a5058",
});
export const BONE = "#ece7da";
export const BONE_SOFT = "rgba(236,231,218,0.64)";
export const BONE_FAINT = "rgba(236,231,218,0.42)";
export const BRASS = "#c9a54c";
export const AMBER = "#e9b949";
export const RED = "#b3212a";
export const RED_BRIGHT = "#d2353d";
export const RED_DARK = "#641318";
export const OLIVE = "#373e26";
export const OLIVE_LINE = "#606a3f";

// Lettering as it is stencilled: narrow, heavy, in capitals. The faces are the
// narrow ones a system already has; nothing is downloaded.
export const STENCIL = "\"Bahnschrift Condensed\", \"Bahnschrift\", \"DIN Condensed\", \"DIN Alternate\", \"Oswald\", \"Arial Narrow\", sans-serif";

// A surface of plate steel.
export const plateStyle = () => {
  const picture = roughMetalUrl(256);
  return {
    backgroundColor: STEEL.plate,
    ...(picture ? { backgroundImage: `url(${picture})`, backgroundRepeat: "repeat", backgroundSize: "256px 256px" } : null),
  };
};

// A rivet, to be put at a corner: `at` says which, as CSS offsets.
export const rivetStyle = (at, size = "0.62rem") => {
  const picture = rivetUrl(28);
  return {
    position: "absolute",
    ...at,
    width: size,
    height: size,
    borderRadius: "50%",
    backgroundColor: "#7b828b",
    ...(picture ? { backgroundImage: `url(${picture})`, backgroundSize: "cover" } : null),
    pointerEvents: "none",
  };
};

// Words stencilled on the plate: a heading.
export const stencilStyle = {
  color: BRASS,
  fontFamily: STENCIL,
  fontSize: "0.78rem",
  fontWeight: 700,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
};

// A key on the panel: raised, bevelled by two lighter edges and two darker,
// and red while it is the one in hand.
export const keyStyle = (on, disabled) => ({
  alignItems: "center",
  background: on ? RED : STEEL.raised,
  borderTop: `1px solid ${on ? RED_BRIGHT : STEEL.raisedTop}`,
  borderLeft: `1px solid ${on ? RED_BRIGHT : STEEL.raisedSide}`,
  borderRight: `1px solid ${STEEL.seam}`,
  borderBottom: `1px solid ${STEEL.seam}`,
  borderRadius: "3px",
  boxShadow: "0 1px 2px rgba(0,0,0,0.5)",
  color: disabled ? BONE_FAINT : BONE,
  cursor: disabled ? "default" : "pointer",
  display: "inline-flex",
  fontFamily: STENCIL,
  fontSize: "0.8rem",
  fontWeight: 700,
  gap: "0.3rem",
  letterSpacing: "0.07em",
  lineHeight: 1.1,
  opacity: disabled ? 0.55 : 1,
  padding: "0.42rem 0.62rem",
  textTransform: "uppercase",
});

// A tray let into the plate: where a general's card, a plan or the talk lies.
export const trayStyle = (lit = false) => ({
  background: STEEL.sunk,
  borderTop: `1px solid ${STEEL.sunkLine}`,
  borderLeft: `1px solid ${STEEL.sunkLine}`,
  borderRight: `1px solid ${lit ? BRASS : STEEL.lip}`,
  borderBottom: `1px solid ${lit ? BRASS : STEEL.lip}`,
  borderRadius: "3px",
});

// What can be pressed in a line of text.
export const linkStyle = {
  background: "none",
  border: "none",
  color: AMBER,
  cursor: "pointer",
  fontFamily: STENCIL,
  fontSize: "0.76rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  padding: "0.1rem 0",
  textTransform: "uppercase",
};
