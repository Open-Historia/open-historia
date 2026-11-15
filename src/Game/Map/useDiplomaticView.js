/*! Open Historia — the diplomatic map's view, worked out once for the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One view of the diplomatic map (runtime/diplomaticViews.js) for everything
// that draws it: the regions' fills (Nations.jsx), a battlefield's ground
// (FrontLayers.jsx), the legend and the tooltip (GameUI/DiplomaticLegend.jsx).
// Each asks this hook; the view is built once for the inputs they share and
// handed to all of them, so a change of view or focus costs one computation.
// Null on the political map.

import { useSyncExternalStore } from "react";
import { useWorldState } from "./useWorldState.js";
import { useActiveGameCountry } from "../../runtime/library.js";
import { MAP_SETTING_KEYS, useMapSettingValue } from "../../runtime/mapSettings.js";
import { getDiplomaticMapState, subscribeDiplomaticMapState } from "../../runtime/diplomaticMapSettings.js";
import { buildDiplomaticView, defaultInstitutionId } from "../../runtime/diplomaticViews.js";

// The owners of the map's land, as the regions' fills know them (Nations.jsx
// publishes them): what the legend counts.
const NO_OWNERS = Object.freeze([]);
let landedOwners = NO_OWNERS;
const landedListeners = new Set();
export const getLandedOwners = () => landedOwners;
export const subscribeLandedOwners = (listener) => {
  landedListeners.add(listener);
  return () => landedListeners.delete(listener);
};
export const publishLandedOwners = (owners) => {
  const next = [...new Set((owners ?? []).map((owner) => String(owner ?? "").trim()).filter(Boolean))].sort();
  if (next.length === landedOwners.length && next.every((owner, index) => owner === landedOwners[index])) return;
  landedOwners = next.length ? next : NO_OWNERS;
  for (const listener of landedListeners) listener();
};

const INPUT_KEYS = [
  "view", "focus", "player", "institutionId", "axis", "focusWar", "landed",
  "wars", "agreements", "relations", "puppets", "institutions", "politicalActors", "powerStatus",
  "regionSovereigntyOverrides", "regionOwnershipOverrides",
];
let cached = { inputs: null, view: null };

// Exported for the tests: the one view for these inputs, built only when one changed.
export const diplomaticViewFor = (inputs) => {
  if (cached.inputs && INPUT_KEYS.every((key) => cached.inputs[key] === inputs[key])) return cached.view;
  const view = buildDiplomaticView({
    view: inputs.view,
    focusCountry: inputs.focus,
    playerCountry: inputs.player,
    institutionId: inputs.institutionId,
    governmentAxis: inputs.axis,
    focusWarId: inputs.focusWar,
    landedOwners: inputs.landed,
    world: {
      wars: inputs.wars,
      agreements: inputs.agreements,
      relations: inputs.relations,
      puppets: inputs.puppets,
      institutions: inputs.institutions,
      politicalActors: inputs.politicalActors,
      powerStatus: inputs.powerStatus,
      regionSovereigntyOverrides: inputs.regionSovereigntyOverrides,
      regionOwnershipOverrides: inputs.regionOwnershipOverrides,
    },
  });
  cached = { inputs, view };
  return view;
};

export const useDiplomaticMapState = () => useSyncExternalStore(subscribeDiplomaticMapState, getDiplomaticMapState, getDiplomaticMapState);

export function useDiplomaticView() {
  const mapMode = useMapSettingValue(MAP_SETTING_KEYS.mapMode, "political");
  const settings = useDiplomaticMapState();
  const world = useWorldState();
  const player = useActiveGameCountry();
  const landed = useSyncExternalStore(subscribeLandedOwners, getLandedOwners, getLandedOwners);
  if (mapMode !== "diplomatic") return null;
  return diplomaticViewFor({
    view: settings.view,
    focus: settings.focus,
    player,
    institutionId: settings.institution || defaultInstitutionId(world.institutions, player),
    axis: settings.axis,
    focusWar: settings.focusWar,
    landed,
    wars: world.wars,
    agreements: world.agreements,
    relations: world.relations,
    puppets: world.puppets,
    institutions: world.institutions,
    politicalActors: world.politicalActors,
    powerStatus: world.powerStatus,
    regionSovereigntyOverrides: world.regionSovereigntyOverrides,
    regionOwnershipOverrides: world.regionOwnershipOverrides,
  });
}
