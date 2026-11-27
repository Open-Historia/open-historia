/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Native OlMap tool IDs. The single-key shortcuts are only active while the
// editor (not an input, modal, or unfinished sketch) owns keyboard focus.
export const TOOL_GROUPS = [
  {
    label: "Select & navigate",
    tools: [
      { id: "select", icon: "select", label: "Select region (click; Shift-click adds, double-click selects polity)", hotkey: "V" },
      { id: "region-box", icon: "boxSelect", label: "Rectangle select regions (drag to select touched regions; Shift adds)", hotkey: "M" },
      { id: "lasso", icon: "lasso", label: "Lasso select regions (draw a freehand area)", hotkey: "L" },
      { id: "pan", icon: "pan", label: "Pan the map", hotkey: "H" },
    ],
  },
  {
    label: "Draw & edit borders",
    tools: [
      { id: "draw", icon: "split", label: "Draw region (click a border to trace along it)", hotkey: "D" },
      { id: "scissors", icon: "scissors", label: "Scissors: select ONE region, then draw a line across it to split (double-click finishes; one Undo)", hotkey: "S" },
      { id: "modify", icon: "modify", label: "Edit vertices (select regions first; snap + undo enabled)", hotkey: "A" },
      { id: "border", icon: "merge", label: "Shared border precision (select exactly 2 neighbouring regions)", hotkey: "J" },
      { id: "dissolve", icon: "eraser", label: "Delete border (merge two regions)", hotkey: "E" },
      { id: "delete", icon: "trash", label: "Delete region (click a region)", hotkey: "X" },
    ],
  },
  {
    label: "Move & paint",
    tools: [
      { id: "move", icon: "move", label: "Move selected regions together (drag any selected region; one undo)", hotkey: "B" },
      { id: "paint", icon: "paint", label: "Paint polity (click or drag across regions; one stroke = one undo)", hotkey: "P" },
    ],
  },
  {
    label: "Places & units",
    tools: [
      { id: "feature", icon: "feature", label: "City tool (click map to add a city, click a city to edit it)", hotkey: "C" },
      { id: "marker", icon: "pin", label: "Map feature tool (click the map to place a base, port, landmark or other feature; click one to edit it)", hotkey: "K" },
      { id: "unit", icon: "unit", label: "Unit tool (click the map to place a starting unit, click one to edit it)", hotkey: "U" },
      { id: "feature-box", icon: "boxSelect", label: "Rectangle select cities & features (drag to select; Shift adds)", hotkey: "F" },
    ],
  },
  {
    // War geography has its own canonical scenario state; never reshape the
    // regions below these layers.
    label: "War geography",
    tools: [
      { id: "terrain", icon: "mountain", label: "Terrain (draw an area troops cross more slowly; click an outline to pick one)", hotkey: "T" },
      { id: "fortification", icon: "wall", label: "Fortified line (draw a wall troops have to break through; click a line to pick one)", hotkey: "G" },
      { id: "climate", icon: "climate", label: "Climate zone (draw an area with its own seasons and weather; click an outline to pick one)", hotkey: "W" },
    ],
  },
];

export const TOOLS = TOOL_GROUPS.flatMap((group) => group.tools);
