# The legacy map renderer

The map as it was before Map vNext, kept so it can be rendered again from
**Settings → Map → Renderer → "Legacy map renderer"**. Off by default.

## Provenance

Every `.jsx`/`.js` file beside this one except `useLegacyWorldSelectors.js` is a
**verbatim copy** from the `Seventh-Dread-Beta` branch:

| File | Source |
|---|---|
| `Nations.jsx` | `Seventh-Dread-Beta:src/Game/Map/Nations.jsx` |
| `Cities.jsx` | `Seventh-Dread-Beta:src/Game/Map/Cities.jsx` |
| `MarkersLayer.jsx` | `Seventh-Dread-Beta:src/Game/Map/MarkersLayer.jsx` |
| `LayerOrder.jsx` | `Seventh-Dread-Beta:src/Game/Map/LayerOrder.jsx` |
| `mapLayerOrder.js` | `Seventh-Dread-Beta:src/Game/Map/mapLayerOrder.js` |
| `regionSeed.js` | `Seventh-Dread-Beta:src/runtime/regionSeed.js` |
| `regionSeedCore.js` | `Seventh-Dread-Beta:src/runtime/regionSeedCore.js` |
| `regionSeedWorker.js` | `Seventh-Dread-Beta:src/runtime/regionSeedWorker.js` |

`beta` and `Seventh-Dread-Beta` diverge at `35f294c` ("Map engine: worker-parsed
region seed, tiles at every zoom, render-loop throttles"). Every vNext commit —
`4b776ec`, `7335fa4`, the label passes, and `91f71fe`, which retired these paths —
landed on `beta` only. So this branch's map is what the renderer looked like
before any of that, and copying it is the only way to get that look back
*exactly*: reverting `91f71fe` instead yields the legacy code as it stood after
vNext had already reworked the shared pieces around it, which is a configuration
that never shipped anywhere and does not render correctly.

**Do not "fix" these files to match current conventions.** Their value is that
they are unmodified. The only edits made on the way in were mechanical:

- import paths re-pointed one directory deeper (`../../runtime/` →
  `../../../runtime/`, `../Selection/` → `../../Selection/`);
- `unitsController.js` and `useWorldState.js` re-pointed at the copies one level
  up, which are shared rather than duplicated;
- `useWorldCities` / `useWorldMarkers`, which the world store no longer exports,
  come from `useLegacyWorldSelectors.js` — thin selectors over the current
  `useWorldState()`, not a second store.

They therefore carry their original lint warnings. That is expected.

## Why the region seed is vendored too

`src/runtime/regionSeedCore.js` no longer builds `coarseFC` — the coarsened far
tier, which vNext dropped along with the `custom-regions-*-far` layers in
`91f71fe`. The legacy renderer iterates it directly, so against the current
module it threw `Cannot read properties of undefined (reading 'features')` on
load. The far tier is also what it draws at low zoom, so guarding the loop would
have left it rendering a different map rather than the old one.

The trio is self-contained — only `regionSeed.js` and its worker use
`regionSeedCore.js` — and the shared copies under `src/runtime/` are now
referenced by nothing at all on this branch, since vNext gets its geometry from
`polityBoundariesWorker` instead. So these copies are the only live users, and
nothing was taken away from the current renderer to make them work.

## What the switch touches

Two places, and nothing else:

1. `MapScene.jsx` mounts either these components or the vNext ones.
2. `World.jsx` passes `legacy` into `buildWorldStyle`, which then paints the
   basemap with `SATELLITE_PAINT` and skips the relief presets — the basemap
   half of the old look.

With the setting off, every vNext file behaves exactly as it does without this
feature present. That is deliberate: it must not constrain work on the new
renderer.

`Units` is **not** swapped. The beta unit system postdates the fork and both
branches descend from it, so there is no older version to return to, and it is
not part of what the renderer draws.

## Keeping it working

Nothing here is exercised by the test suite, and nothing updates it when shared
modules change. If a module it imports changes shape, this breaks and only a
manual check will show it. The imports it depends on today are
`loadCountryLabelCollections`, `loadRegionLabelGeometry`, `loadRegionSeed`,
`emptyRegionSeed`, `getNationColors`, `resolveRegionName`, `translateLabel`,
`toCountryName`, `ownerIdentityKey`, `useWorldState` and `unitsController`.
