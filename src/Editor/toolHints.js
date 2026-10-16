/*! Open Historia Map Editor — Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE). */

// What the status line under the toolbar says for each tool: its name and one
// sentence on how to use it. Plain data so it can be tested; Toolbar.jsx's ids and
// this table are checked against each other in toolHints.test.js.

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const HINTS = {
  select: ["Select", "Click a region to select it. Esc clears the selection."],
  lasso: ["Lasso select", "Drag a loop around regions to select them all."],
  pan: ["Pan", "Drag to move the map. Nothing is edited in this mode."],
  draw: ["Draw region", "Click to place corners; click the first corner or double-click to finish. Click a border to trace along it. Esc cancels the outline."],
  move: ["Move", "Drag a region to move it."],
  delete: ["Delete", "Click a region to delete it. Ctrl/Cmd+Z brings it back."],
  dissolve: ["Delete border", "Click a region next to the border you want gone to merge it with its neighbour."],
  paint: ["Paint polity", "Click or drag across regions to give them the chosen polity; one stroke is one undo."],
  feature: ["City", "Click the map to add a city, click a city to edit it."],
  unit: ["Unit", "Click the map to place a starting unit, click a unit to edit it."],
  "feature-box": ["Box-select features", "Drag a rectangle over cities and features to select them all."],
};

// `selectionCount` matters to the two tools that act on the selection.
export function toolHint(id, selectionCount = 0) {
  if (id === "modify") {
    const scope = selectionCount ? plural(selectionCount, "selected region") : "no selection — editing all regions";
    return {
      name: "Edit vertices",
      warn: false,
      text: `${scope} · drag a vertex · drag an edge to insert · Alt-click a vertex to remove · snap magnet enabled · Ctrl/Cmd+Z undo`,
    };
  }
  if (id === "border") {
    const ready = selectionCount === 2;
    return {
      name: "Shared border precision",
      warn: !ready,
      text: ready
        ? "drag a border vertex or edge on either selected region; the released point is welded into BOTH regions · cyan halo = shared-border magnet · Alt-click removes the corresponding shared vertex · a 100 m topology check runs after each edit · Ctrl/Cmd+Z undo"
        : `select exactly 2 neighbouring regions first (${selectionCount} selected)`,
    };
  }
  const row = HINTS[id];
  return row ? { name: row[0], text: row[1], warn: false } : null;
}
