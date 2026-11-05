/*! Open Historia — region type paint © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The paint halves of a scenario's region types (runtime/regionTypes.js). A
// region of a type that draws differently from Land carries feature-state
// beside its owner's fillColor (Nations.jsx writes it):
//   typeFill         the type's override colour, over the owner's
//   typeOpacity      a factor on the game's fill opacity (0 outside its zoom range)
//   typeStroke       the type's border colour, over the game's hairline
//   typeStrokeScale  a factor on the hairline's width (0 outside its zoom range)
// Every read falls back to the game's own value, so a region with no such
// state, which is every region of a map without such types, paints as before.

export const TYPE_FILL_STATE = ["feature-state", "typeFill"];
export const TYPE_STROKE_STATE = ["feature-state", "typeStroke"];

const typeFactor = (key) => ["number", ["feature-state", key], 1];

// A fill opacity (one stop output of a zoom ramp) with the type's factor on
// it, never above 1. The zoom ramp stays the top-level expression around it.
export const withTypeFillOpacity = (opacity) => ["min", 1, ["*", opacity, typeFactor("typeOpacity")]];

// A line width (one stop output) with the type's border factor on it.
export const withTypeStrokeWidth = (width) => ["*", width, typeFactor("typeStrokeScale")];
