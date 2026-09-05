/*! Open Historia — legacy map world-state selectors © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// useWorldCities and useWorldMarkers as the legacy map components expect them.
//
// Both were their own subscriptions to the world store on Seventh-Dread-Beta.
// The store has since been reworked so that useWorldState() already derives
// markers, customCities, cityRenames and cityPopulations and only re-publishes
// when they actually change (deriveMapState / the equality check beside it), so
// these are selectors over that rather than a second copy of the store. Keeping
// one store is the point: two subscriptions to the same underlying state would
// be two things to keep in step, and the legacy map is meant to be a rendering
// choice, not a second source of truth.
import { useWorldState } from "../useWorldState.js";

export function useWorldMarkers() {
  return useWorldState().markers;
}

export function useWorldCities() {
  const { customCities, cityRenames, cityPopulations } = useWorldState();
  return { customCities, cityRenames, cityPopulations };
}
