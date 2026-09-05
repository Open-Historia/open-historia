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
they are unmodified. The edits made on the way in were mechanical:

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
`regionSeedCore.js`. The shared copies that used to sit under `src/runtime/`
were referenced by nothing on this branch (vNext gets its geometry from
`polityBoundariesWorker`), so they were removed rather than kept as a second,
dead set; these are the only copies now.

## What the switch touches

Three places, and nothing else:

1. `MapScene.jsx` lazy-loads `index.jsx` and mounts these components instead of
   the vNext ones.
2. `World.jsx` keys the map instance on the renderer (`buildBasemapRenderKey`),
   so a switch replaces the MapLibre instance rather than diffing one
   renderer's sources and layers into the other's under a mid-swap component
   tree. Settings announces the redraw first (`announceMapRerender`), so the
   game loading screen covers it exactly as it covers the globe switch.
3. The basemap style is shared. The black rectangles that used to appear while
   tiles streamed in were a missing low-zoom raster underlay — `satellite-lowres`,
   z0–2, levels that always have real data — which vNext had dropped for a
   near-black background. That underlay is now in the one style both renderers
   use, so every player gets it and the legacy renderer needs no style of its own
   (it also means the beta's relief and dark basemap presets look the same under
   both renderers).

With the setting off, every vNext file behaves exactly as it does without this
feature present. That is deliberate: it must not constrain work on the new
renderer.

`Units` is **not** swapped. The beta unit system postdates the fork and both
branches descend from it, so there is no older version to return to, and it is
not part of what the renderer draws.

## Deliberate deviations

Six edits are not mechanical, each marked in place with "a deliberate
deviation from the verbatim copy":

- `Nations.jsx` calls `markPolitiesReady` (`runtime/mapReadiness.js`) once the
  world is known and, on a custom map, the region seed is in — the game loading
  screen waits for that mark, and the copy predates it. Before marking on a
  custom map it primes the compact region catalog (`loadScenarioRegionCatalog`),
  which the current renderer fills from its worker; without it the first Stats
  open or AI turn parsed the whole `regions.geojson` on the main thread.
- `Nations.jsx` honours the Settings → Map country label font override, as the
  current renderer does.
- `Cities.jsx` normalises an imported `cities.geojson` (`name`, boolean
  `capital`, missing `tier`) the way the current renderer does before reading
  it in this copy's `city` / `tier` / `capital === "primary"` vocabulary.
- `index.jsx` is new: the single module MapScene lazy-loads, so none of this
  is fetched or evaluated while the setting is off.
- `Nations.jsx` carries the two label fixes the current renderer got in
  PR #696, which this copy predates: `buildRegionAdjacency` decides "touching"
  by bounding boxes (overlap or within 0.2°) rather than a shared vertex, which
  the independently simplified z0 tile almost never has, so a country is one
  territory and one label instead of one per piece; and
  `buildOwnerLabelCollection` folds owner tokens through
  `buildOwnerAliasMap` / `canonicalOwnerName` (`runtime/ownerNames.js`), so a
  polity the AI renamed ("United States" → "United States of America") is one
  label, not two. Without the first, one Russia carried five "RUSSIAN
  FEDERATION" labels.
- `Nations.jsx` blanks the baked-in modern `owner` of a stock z0 tile region
  the scenario does not list (`labelRegionData`). The fill paints such a
  region neutral unless a live override names an owner
  (`stockRegionsFillPaint`); the label geometry kept the tile copy as it was,
  so a hand-drawn world got "UNITED STATES" and six "RUSSIA"s from land that
  is not on its map. The builder now names it only when an override does.

## Keeping it working

Nothing here is exercised by the test suite, and nothing updates it when shared
modules change. If a module it imports changes shape, this breaks and only a
manual check will show it. The imports it depends on today are
`loadCountryLabelCollections`, `loadRegionLabelGeometry`, `loadRegionSeed`,
`emptyRegionSeed`, `getNationColors`, `resolveRegionName`, `translateLabel`,
`toCountryName`, `buildOwnerAliasMap`, `canonicalOwnerName`, `ownerIdentityKey`,
`useWorldState`, `unitsController`, and —
from `runtime/assets.js` — `resolveCountryDisplayName`, `JSON_URLS`,
`PMTILES_PROTOCOL_URLS`, `ensurePmtilesProtocol`, `readJson`,
`loadScenarioRegionCatalog`; `MAP_SETTING_KEYS` / `useMapSetting` /
`useMapSettingValue` (`runtime/mapSettings.js`); `markPolitiesReady`
(`runtime/mapReadiness.js`); `normalizeCustomCityFeatureCollection`
(`runtime/cityFeatures.js`); and the three `Selection/` modules
(`onRegionSelected` / `dismissRegionPopup`, `onUnitSelected` /
`dismissUnitPopup`, `onFeatureSelected` / `dismissFeaturePopup`).
