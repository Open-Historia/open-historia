/*!
 * Native editor layer catalog and safe visibility presets.
 * Only OpenLayers canvas visibility is changed, never scenario source data.
 */
export const EDITOR_LAYER_DEFS = Object.freeze([
  { key: "regions", label: "Political regions", description: "The territory itself. Keep this visible while editing borders.", group: "Geography" },
  { key: "labels", label: "Region labels", description: "Place and administrative names drawn by the editor.", group: "Geography" },
  { key: "groups", label: "Group control", description: "Outlines for non-sovereign groups controlling regions.", group: "Geography" },
  { key: "features", label: "Cities and landmarks", description: "Capital cities, settlements, ports, bases and other point features.", group: "Scenario objects" },
  { key: "units", label: "Starting formations", description: "Placed military units, not a summary of national military strength.", group: "Scenario objects" },
  { key: "fortifications", label: "Fortified lines", description: "Scenario-authored lines of defensive structures.", group: "War geography" },
  { key: "freezing", label: "Freezing water", description: "Water regions that can freeze during the scenario.", group: "War geography" },
]);
export const overlayVisibilityPatch = (mode) => {
  if (mode !== "show-all" && mode !== "regions-only") return null;
  return Object.fromEntries(EDITOR_LAYER_DEFS.map(({ key }) => [key, mode === "show-all" || key === "regions"]));
};
