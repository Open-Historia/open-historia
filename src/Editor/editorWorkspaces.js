/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A presentation-only directory over the existing native Map Editor panels.
// Every panel ID maps back to its original stateful editor implementation.
export const EDITOR_WORKSPACES = Object.freeze([
  { id: "overview", section: "Your world", icon: "map", label: "Overview", description: "Scenario and editing status", panel: null, items: [] },
  {
    id: "countries", section: "Edit the scenario", icon: "flag", label: "Polities", description: "Sovereign actors, territory and identity", panel: "polities",
    items: [
      { id: "polities", icon: "flag", label: "Polity details" },
    ],
  },
  {
    id: "territory", section: "Edit the scenario", icon: "list", label: "Territory & borders", description: "Regions, types and clipboard", panel: "regions",
    items: [
      { id: "regions", icon: "list", label: "Regions" },
      { id: "types", icon: "types", label: "Region types" },
      { id: "clipboard", icon: "copy", label: "Copy or paste regions" },
    ],
  },
  {
    id: "places", section: "Edit the scenario", icon: "pin", label: "Places & units", description: "Cities, landmarks and armies", panel: "features",
    items: [
      { id: "features", icon: "pin", label: "Cities and map features" },
      { id: "units", icon: "unit", label: "Starting units" },
    ],
  },
  {
    id: "groups", section: "Edit the scenario", icon: "users", label: "Groups", description: "Non-sovereign actors and territory", panel: "groups",
    items: [{ id: "groups", icon: "users", label: "Group details" }],
  },
  {
    id: "war", section: "Edit the scenario", icon: "mountain", label: "Terrain & war", description: "Climate and defensive lines", panel: "war",
    items: [{ id: "war", icon: "mountain", label: "War geography" }],
  },
  {
    id: "appearance", section: "Edit the scenario", icon: "layers", label: "Maps & appearance", description: "Layers, flags and projection", panel: "layers",
    items: [
      { id: "basemap", icon: "map", label: "Base and detailed maps", action: "basemap" },
      { id: "layers", icon: "layers", label: "Map layers" },
      { id: "reference", icon: "image", label: "Reference picture" },
      { id: "projection", icon: "globe", label: "Projection and scale" },
    ],
  },
  {
    id: "import", section: "Finish & play", icon: "upload", label: "Import or generate", description: "Maps, suggestions and recovery", panel: "province-import",
    items: [
      { id: "province-import", icon: "upload", label: "Import map" },
      { id: "generator", icon: "map", label: "Generate world", action: "generator" },
      { id: "suggestions", icon: "review", label: "Suggested changes" },
      { id: "clipboard", icon: "copy", label: "Clipboard" },
    ],
  },
  { id: "review", section: "Finish & play", icon: "review", label: "Review & save", description: "Document and scenario state", panel: null, items: [] },
]);

export const EDITOR_PANEL_IDS = Object.freeze([
  "regions", "polities", "groups", "types", "features", "units", "war",
  "layers", "reference", "projection", "province-import", "clipboard", "suggestions",
]);

export function workspaceOfPanel(panelId, preferredWorkspaceId = null) {
  const matches = EDITOR_WORKSPACES.filter((workspace) =>
    workspace.items.some((item) => item.id === panelId)
  );
  return matches.find((workspace) => workspace.id === preferredWorkspaceId) || matches[0] || null;
}
