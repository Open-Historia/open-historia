/*! Open Historia — the colour a group's area is drawn in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A group's area (GroupAreaLayers.jsx) is drawn in the group's own colour, or,
// on the diplomatic map's Relations view, in its standing with the focus
// (runtime/diplomaticViews.js `groups`). Pure, for the tests.

// The colour expression for every feature: its own `color`, or, given `colorOf`
// ({ [group]: colour }), that colour by its group's name (the features carry `group`).
export const groupAreaColorExpression = (colorOf) => {
  const entries = Object.entries(colorOf && typeof colorOf === "object" ? colorOf : {}).filter(([name, color]) => name && color);
  if (!entries.length) return ["get", "color"];
  return ["match", ["get", "group"], ...entries.flatMap(([name, color]) => [name, color]), ["get", "color"]];
};
