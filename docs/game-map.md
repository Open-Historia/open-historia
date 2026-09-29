# Game Map & Rendering

The in-game map is a single MapLibre GL instance (via `react-map-gl/maplibre`) mounted by `src/Game/Map/World.jsx`, with every gameplay layer added as a React child that declares its own `<Source>`/`<Layer>`. All political state flows in from `world.json` (polled every 5s by `useWorldState`) and `colors.json` (the owner→rgb palette); nothing on the map is server-rendered — owners are recoloured, labels rebuilt, and units/markers re-fed from that JSON every poll. The same code renders two ways: a flat Web-Mercator map and a decorative 3D globe (with a real-sun terminator and starfield), switched by the `projection` prop, which remounts the whole `<Map>`.

Everything below is in `src/Game/Map/` unless noted.

---

## 1. Component tree & data sources

`World.jsx` renders one `<Map>` and, inside it, these children (order = paint order, later = on top):

| Child | File | Renders | Primary data in |
|---|---|---|---|
| `<Nations>` | `Nations.jsx` | Country/region fills, borders, disputed stripes, country/owner labels | `world.json` + `colors.json` + PMTiles + `regionsGeojson` |
| `<Cities>` | `Cities.jsx` | City circles, capital stars (★) and labels | `cities.pmtiles` (stock) or `citiesGeojson` (custom) |
| `<MarkersLayer>` | `MarkersLayer.jsx` | Built structures (bases, silos, embassies…) | `world.markers` |
| `<Units>` | `Units.jsx` | Troop counters (circle + flag or type glyph + short name), heading lines, patrol rings | `unitsController` (from `world.units`) |
| `<GlobeEffects>` | `GlobeEffects.jsx` | Sun, stars, day/night lighting, auto-rotation (globe only) | wall-clock sun math |
| `<RegionPopup>` / `<CountryInfoPanel>` / `<UnitPopup>` / `<FeaturePopup>` | `../Selection/*` | Selection popups | click events from `Nations.jsx` |

### Shared state hooks

| Hook | File | What it provides |
|---|---|---|
| `useWorldState()` | `useWorldState.js` | Singleton store of `world.json`, shared by all consumers, fed by canonical write events |
| `useCustomBackground()` | `useCustomBackground.js` | Resolves a scenario's uploaded image/vector basemap from `world.background` |
| `useMapSetting(key)` | `../../runtime/mapSettings.js` | Reactive localStorage map toggles (`hideCountryLabels`, `disableIdleRotation`) |
| `unitsController` | `unitsController.js` | Separate store of `world.units` + player order mutations |

`useWorldState` is a module-level singleton: it bootstraps `JSON_URLS.world` once and thereafter updates from the `oh:world-updated` event that every canonical write dispatches, so there is no poll. It returns a **stable object identity** when nothing it exposes changed (each field is compared by content, not reference) so React children don't re-render on an unrelated world write. See [World state §9](world-state.md#9-state-distribution-three-stores-no-panel-polls).

Fields `useWorldState` derives from `world.json`:

| Field | Source key | Used by |
|---|---|---|
| `worldKnown` | `Object.keys(state).length > 0` | Gate: stock layers only paint once the world is known |
| `customRegions` (`customFlag`) | `state.customRegions` | Switches stock↔custom render path |
| `customCities` | `state.customCities` | `Cities.jsx` stock↔custom path |
| `basemap` | `state.basemap` | ESRI style variant |
| `background` | `state.background` | Uploaded image/vector basemap descriptor |
| `regionOwnershipOverrides` | `state.regionOwnershipOverrides` | region id → owner name (live conquests) |
| `regionClaimants` | `state.regionClaimants` | region id → claimant list (disputed stripes) |
| `polityOverrides` | `state.polityOverrides` | polity name → `{name, color, aliases}` registry |
| `markers` | `state.markers` | `MarkersLayer.jsx` |
| `labelFont` / `labelHaloColor` / `labelTextColor` | same | Label styling |

> **Note on the `customRegions` flag:** `normalizeRuntimeWorld` (`server/libraryStore.js`, and its twin in `src/runtime/web/models.js`) forces `customRegions:true` onto every world it serves, so the game is *always* on the custom render path (`customFlag` true once the world is known). The stock-country path — a `countries-source` fill keyed on GADM codes and the modern-country label atlas from `countryLabels.js` — never drew and has been removed; `countries.pmtiles` stays for the country index and bounds.

---

## 2. `<Map>` setup and key props

Defined in `World.jsx`. The `<Map>` has `key={mapInstanceKey}`, so **any change to the key unmounts and remounts the whole MapLibre instance** (and all its GL images — which is why disputed stripe tiles are rebuilt reactively, see [§6](#6-disputed--striped-regions)). The key is `buildBasemapRenderKey` (`runtime/assets.js`), `"<projection>:<basemapId>:<backgroundKind>"` (`backgroundKind` is `builtin`, `declared`, `image` or `vector`), with `:natgeo-dark-loading` / `:natgeo-dark-ready` appended for National Geographic - Dark. So the map remounts on a globe↔mercator toggle, a basemap change, a scenario background's payload arriving, and once more when the NatGeo Dark vector style is ready (a clean remount instead of a style swap under a live React `<Source>` tree).

| Prop | Value | Why |
|---|---|---|
| `key` | `mapInstanceKey` | Remount on projection, basemap or background change |
| `initialViewState` | `viewStateRef.current`, first `{longitude:0, latitude:0, zoom:3.5, bearing:0, pitch:0}` | Updated on every `onMove`, so a remount keeps the camera |
| `minZoom` | `2.25` | Deliberate floor (see [§11](#11-zoom-caps--why-theyre-deliberate)) |
| `maxZoom` | `16` | Deliberate ceiling; PMTiles overzoom past their z8 max |
| `maxBounds` | `[[-Inf,-80],[Inf,85]]` | Lock latitude to the usable band; longitude free (world copies wrap) |
| `doubleClickZoom` | `false` | Double-click is reserved for gameplay |
| `dragRotate` / `touchPitch` / `pitchWithRotate` | `false` | No bearing/pitch — top-down only |
| `dragPan` | on | Pan enabled |
| `cursor` | `"default"` | No grab cursor |
| `attributionControl` | `false` | Hidden |
| `fadeDuration` | `0` | No label cross-fade flicker |
| `collectResourceTiming` | `false` | Skip perf-entry overhead |
| `crossSourceCollisions` | `true` | MapLibre's default, kept for visual fidelity: cities, labels and markers do not overlap while the camera moves. The R5.0 performance win came from collapsing the country-label layer fan-out, not from this |
| `renderWorldCopies` | on | Wrap the map E/W infinitely. A click on a copy reports an unwrapped longitude (e.g. 210); the click handler wraps it before placing a unit (§9) |
| `maxTileCacheSize` | `256` | **Caps per-source retained-tile GPU textures** (below) |
| `pixelRatio` | `1` | **One fixed renderer density** (below) |
| `projection` | `useMemo(() => ({type: projection}))` | `"globe"` or `"mercator"` |
| `terrain` | memoized (below) | 3D terrain on built-in basemaps |
| `mapStyle` | `worldStyle` | `buildWorldStyle(...)` ([§3](#3-the-base-style-buildworldstyle)), or the NatGeo Dark style |

Handlers:

- `onLoad` — a trace entry, and the basemap transition bar moves to 84%.
- `onIdle` — every idle: `markMapIdle()` (the loading screen a game opens under waits for the idle after the polity layers, see [Readiness signals](#readiness-signals)), `oh:map-motion` off, the basemap transition advanced or finished (below), and the "Loading tiles…" toast hidden. The first idle also fires `onInitialIdle`.
- `onMoveStart` / `onMoveEnd` — dispatch `oh:map-motion` (`window.__OH_MAP_MOVING__`). With the debug switch on they also run the per-pan frame sampler (below).
- `onMove` — keeps `viewStateRef` current.

`onLoading` is not a react-map-gl event and is not used; the toast has its own listener (below).

### Fixed pixel ratio (`pixelRatio={1}`)

R5.1 uses one renderer density for the whole session. R5.0 switched between 1× and native DPR around z4.5/z5.0, and `setPixelRatio()` rebuilds the render targets — a hitch exactly as the player zoomed through that boundary. The 1× framebuffer performs well, and on a 2×–3× phone screen native density is 4–9 times the pixels (heat, RAM). It is a constructor option, so every instance starts at 1×: the ratio used to be set on the first instance's first idle, and a basemap or background remount brought the new map up at native density for the rest of the session.

### `maxTileCacheSize={256}` (the OOM cap)

Left unset, MapLibre sizes this cache dynamically to roughly `(ceil(w/256)+1)*(ceil(h/256)+1)*5` tiles **per source** — ~270 at 1080p but ~800 on a 4K viewport. With `renderWorldCopies`, panning E/W feeds successive wrapped world-copy tiles into that cache, so retained GPU textures climb until the tab OOMs. `256` caps the 4K case ~3× while being a no-op on phones. In-view tiles are a separate structure and are never evicted by this, so on-screen tiles are never re-fetched. This is orthogonal to the fixed 1× density (which bounds framebuffer pixels, not tiles).

### `terrain` memo

`terrain = { source: "terrain-source", exaggeration: 15 }` when `terrainEnabled && !customBg && !bgDeclared`: a custom image or vector background has no DEM to deform. **The globe is included on purpose.** An older guard (`!isGlobe`) kept terrain off the globe, on the grounds that MapLibre could not draw it there and that it could corrupt the shader cache across projection changes; `9b414f54` dropped it because MapLibre 5 does draw terrain on the globe, and every projection change remounts the map (the projection is part of the key), so no GL state survives one.

### Instrumentation (`mapInstrumentation.js`)

`attachMapInstrumentation` is attached to every map instance World mounts (the effect is keyed on `mapInstanceKey`) and detached from the old one:

- **Always:** the canvas's `webglcontextlost` / `webglcontextrestored` (a trace entry and a console warning; the context a removed map loses on purpose is recorded as released, not lost), and `sourcedataloading` filtered to the basemap's own style sources (`isBasemapTileLoading`) for the toast.
- **With `window.__OH_PERF_VERBOSE__ = true`** (`isMapPerfVerbose()` in `runtime/mapPerfTrace.js`; the same switch as `assets.js`'s performance console output, read when a map mounts): the per-event trace listeners (`sourcedata`, `data`, `styledata`, `styledataloading`, `render`, `idle`, `zoomstart`, `zoomend`), and on every pan a `requestAnimationFrame` sampler that detects frames ≥ 100 ms (`recordMapFreeze`) and logs an `[OH MAP PERF R5.3]` summary (`window.__OH_LAST_MAP_PERF__`). Off by default: it costs a callback on every frame of every pan.

`runtime/mapPerfTrace.js` keeps the last 500 trace entries in a ring buffer (`getMapTrace()`, `window.__OH_MAP_TRACE__`); `Nations.jsx` and `useWorldState.js` record into it too.

### "Loading tiles…" and "Changing basemap…"

- **Loading tiles…** — a small pill at the bottom. A basemap tile starting to load marks a loading spell (React state is touched once per spell); the pill shows only if tiles are still loading 700 ms later (`LOADING_TOAST_DELAY_MS`), so local tiles never flash it. The next idle hides it; an 8 s timer is the backstop. Hidden while the basemap transition is up.
- **Changing basemap…** — a blurred cover with a progress bar, from a basemap change after the first idle until the new map is idle. For NatGeo Dark it waits for the real vector style's remount, not the fallback's idle. If the polity text renderer (PTR) was drawing the names before the change (`ptrMountedBeforeBasemapCommit`), it also waits for `polity-text-renderer` on the new style, so the player never sees an unlabelled frame. A 20 s watchdog always lifts it.

---

## 3. The base style (`buildWorldStyle`)

`buildWorldStyle(basemapId, customBg, backgroundDeclared, isGlobe, terrainEnabled)` (`World.jsx`) returns a MapLibre style JSON. The basemap it is given is `resolveBasemapId`: the player's pick in Settings → Map (`map_basemap_style`, this browser only) when it is a built-in id, else the scenario's `world.basemap`, else `DEFAULT_BASEMAP_ID = "ocean"`. A player pick also replaces the scenario's own background.

| # | Condition | Sources | Layers |
|---|---|---|---|
| 1 | `customBg.kind === "image"` | `custom-bg` (image, corners per `WORLD_IMAGE_COORDS_*`) | `custom-bg-base` (solid `#0b1a2b`), `custom-bg-layer` (raster) |
| 2 | `customBg.kind === "vector"` | `custom-bg-vec` (geojson) | `custom-bg-sea` (bg), `custom-bg-fill` (per-feature `fill`), `custom-bg-line` |
| 3 | `backgroundDeclared` (payload not loaded yet) | none | `custom-bg-loading` (solid `#0b1a2b`) |
| 4 | relief basemaps: `atlas-relief`, `atlas-relief-dark`, `ocean-dark`, `midnight-terrain` | `pax-world-relief` (NOAA ETOPO1 relief, `maxzoom 3`) + `satellite-lowres` / `satellite` rendering ESRI World Terrain Base | `strategy-map-base` (background), `satellite-lowres-layer`, `satellite-layer`, `pax-world-relief-layer` |
| 5 | any other built-in raster id | `satellite-lowres` / `satellite` for that ESRI service | `strategy-map-base`, `satellite-lowres-layer`, `satellite-layer` |

**National Geographic - Dark** is not a `buildWorldStyle` branch. `World()` loads Esri's public NatGeo vector style (`natGeoDarkStyle.js`, `loadNatGeoDarkStyle`, cached for the session), darkens its cartography, drops its sovereign-country labels and lays World Physical Map (`oh-natgeo-dark-physical`) under it. While it loads, the map shows branch 4 as Atlas Relief Dark; when it arrives the map remounts. If it fails, the dark relief stays.

Branches 1–3 **drop ESRI entirely** so a custom-map game never flashes satellite Earth or fires basemap tile requests it won't use. Branch 3 is the pre-load placeholder: `useCustomBackground` flips `declared:true` from the world's background descriptor, which arrives with `world.json`, *before* the heavy background payload loads.

Every branch sets `sky: { "atmosphere-blend": 0 }` — MapLibre's uniform atmosphere is off because `GlobeEffects` supplies directional surface light instead, and transparent space lets the stars/sun show through the canvas.

### Built-in raster basemaps (branches 4–5)

| Source id | Type | Tiles / template | Notes |
|---|---|---|---|
| `satellite-lowres` | raster | `esriTileTemplate(id)` | z0–2 always have real data; `maxzoom:2`. Sits under the detailed layer so a region still loading looks coarse rather than black |
| `satellite` | raster | `basemapProtocolTemplate(id)` → `ohbase://…` | High-res via the **ohbase protocol** so ESRI "Map Data Not Yet Available" placeholders get replaced with upscaled ancestor tiles; `maxzoom` = the basemap's native max |
| `pax-world-relief` | raster | ETOPO1 shaded relief (branch 4 only) | `maxzoom 3`, overzoomed above; glazed over the terrain layer and faded out between z3 and z4.85 |
| `terrain-source` | raster-dem | `TERRAIN_TILE_TEMPLATE` (AWS terrarium) | Only with `terrainEnabled`: `encoding:"terrarium"`, `maxzoom:5`. One DEM for both the `terrain` prop and the `hills` hillshade layer (exaggeration 0.1) |

Branch 4 renders World Terrain Base (`"terrain"`) rather than the id it was given, with per-variant grades from `getPaxReliefPaints` (`PAX_*_PAINT`); branch 5 grades `imagery` with `SATELLITE_PAINT` and everything else with `ATLAS_PAINT`. `strategy-map-base` is `#0b1017`, darker for the dark variants (`#030a14` Ocean Dark, `#050609` Atlas Relief Dark, `#000205` Midnight Terrain). `ensureBasemapProtocol()` (called at module load) registers the `ohbase://` protocol handler; `configureMapRuntime()` runs first, since MapLibre's worker pool is made with the first map. Basemap helpers live in `src/runtime/assets.js` (`ESRI_BASEMAPS`, `esriTileTemplate`, `basemapProtocolTemplate`, `basemapMaxZoom`).

### World-image corner coordinates

Two constants in `World.jsx` give the image-source corners:

- `WORLD_IMAGE_COORDS_FLAT` — ±85.0511° (the Mercator projection limit).
- `WORLD_IMAGE_COORDS_GLOBE` — ±89.9° (the globe shows to the poles; **not** exactly ±90 because `mercatorYfromLat(±90)` is ±Infinity and `ImageSource.setCoordinates` throws — the `custom-bg-base` layer fills the negligible sliver).

`styleUsesGlobeCoords = customBg?.kind === "image" && isGlobe` selects between them.

---

## 4. Region & country layers (`Nations.jsx`)

`Nations.jsx` (the `WorldMap` component) declares four sources. The core idea is a **crossfade**: at low zoom, GADM region *fills* come from a coarse seed GeoJSON (`regionsGeojson`); past z6.5 they hand off to crisp stock vector tiles (`regions.pmtiles`). Author-drawn/edited geometry always comes from the GeoJSON, on top.

### 4.1 Sources & layers

| Source id | Type | Data | Gated on | Layers |
|---|---|---|---|---|
| `regions-source` | vector | `PMTILES_PROTOCOL_URLS.regions`, `maxzoom 8` | `shouldMountStockRegions` = `!customFlag \|\| regionTileHandoffSafe` (the scenario's region ids match the tiles exactly) | `regions-fill`, `regions-disputed`, `regions-outline` |
| `custom-regions-source` | geojson | the authored regions URL itself (`regionsGeojsonUrl`, `promoteId: id`, `tolerance 0.6`); live ownership reaches it through feature-state | mounted whenever `customFlag` | `custom-regions-fill-far`, `custom-regions-fill`, `custom-regions-local-outline` |
| `country-curved-label-source` | geojson | always empty | — | `country-curved-labels` (an anchor other layers are placed under) |
| `country-point-label-source` | geojson | always empty | — | `country-labels` (an anchor) |

The layer that paints the political map from the tiles is `regions-fill` via `stockRegionsFillPaint`, which matches `GID_1` (a region id) and needs no code→name bridge. The old `countries-source` (a fill keyed on the GADM country code) could never mount, since `customRegions` is forced true, and was removed.

**`regions-source` is mounted on custom maps too** (when their region ids match the tiles) — this is load-bearing. On a re-ownership scenario (Modern Day, Rome, WWII: stock GADM geometry, nothing hand-drawn) `regions-fill` is the *only* thing painting owners above z6.5, because `custom-regions-fill-far` stops at `maxzoom 7` and `FAR_FILL_FADE` has already faded it to 0 by z6.5. Unmounting it once left every such map blank past 6.5 and (via the `getLayer()` filter in the click handler) unclickable too.

### 4.2 The crossfade constants

| Constant | Value | Meaning |
|---|---|---|
| `FAR_FILL_FADE` | interpolate zoom 5.5→0.72, 6.5→0 | seed-GeoJSON fill opacity (fades **out** on zoom in) |
| `TILE_FILL_FADE` | interpolate zoom 5.5→0, 6.5→0.72 | stock-tile fill opacity (fades **in**) |
| `GADM_GEOMETRY_FILTER` | `index-of "." in id >= 0` | GADM region (dotted id like `USA.1_1`) |
| `CUSTOM_GEOMETRY_FILTER` | `index-of "." in id == -1` | author-drawn (`reg_…`, no dot) |
| `AUTHORED_GEOMETRY_FILTER` | `custom OR edited==true` | geometry that lives **only** in the GeoJSON |
| `STOCK_GEOMETRY_FILTER` | `GADM AND edited!=true` | unedited GADM → paints via tiles |

The crossfade band is z5.5–6.5 because the seed geometry was extracted at tile-zoom 5; hand-off happens just past that. The **`edited` split** matters: a GADM region the editor *reshaped* has a dotted id but its true shape is now in the GeoJSON, while the stock tile still carries the *original* shape. Painting both stacks two 0.72 fills and darkens the reshaped area, so edited GADM ids are pulled out of the tile layers (`editedStockIds`, computed in `Nations.jsx:949`) and rendered from the GeoJSON like author-drawn shapes.

### 4.3 Fill / outline paint objects

| Layer | Paint driver | Behaviour |
|---|---|---|
| `regions-fill` | `stockRegionsFillPaint` | `match GID_1 → ownerColorCss(owner)` for every non-drawn, non-edited region; opacity `TILE_FILL_FADE` (0 unless `customActive`) |
| `regions-outline` | `buildProvinceOutlinePaint` | Stock-world province hairlines only (`worldKnown && !customActive`); hidden through z6.5, then fade in; excludes `editedStockIds`. Shares the scenario-grid style below. |
| `custom-regions-fill-far` | `["get","_fillColor"]` | seed-GeoJSON fill for GADM regions, `maxzoom 7`, opacity `FAR_FILL_FADE` |
| `custom-regions-fill` | `["get","_fillColor"]` | author-drawn/edited geometry, opacity constant `0.72` at all zooms |
| `custom-regions-local-outline` | `buildProvinceOutlinePaint` | Scenario province grid (`customActive && worldKnown`): hidden through z6.5; opacity `6.5→0, 7.5→0.25, 10→0.38, 12→0.45`; width `6.5→0.25, 8→0.4, 12→0.5` CSS px, capped above z12. Country/frontier strokes stay visible, and fill-based province selection is unchanged. |

`_fillColor` is carried by the dissolved polity surfaces (`enrichedPolitySurfaceData`). The authored regions source is the URL itself — nothing on the UI thread parses or clones the regions file — and live ownership reaches it through `setFeatureState` (`fillColor`), so an ownership change is a tiny state diff rather than a GeoJSON replacement.

### 4.4 Ownership hand-over

When a region changes hands, `world.json` has the new owner at once, but the map keeps the region on its old colour until the sovereignty sweep (a flood from the frontier, or the directional strip sweep as fallback) has played and the worker's new borders and labels are ready, then hands over in one go. The bookkeeping is `vnext/ownershipPresentationHolds.js` (`createOwnershipPresentationState`), which `Nations.jsx` drives:

- **Holds** — region id → count. A held region is skipped by both fill-sync effects. Counts keep rapid changes of one region ordered; when the scheduler coalesces revisions (A → B → C), each region of the surviving revision keeps one hold, plus one while an earlier sweep is still playing over it.
- **Transitions** — one entry per ownership revision with sweep geometry, queued for the sweep effect and indexed by revision, since the worker's cartography can arrive before or after its sweep ends. `finishTransition` says whether to publish now or that the holds have gone and the cartography publishes on arrival.
- Every hold an entry took is released exactly once, on publish or at the sweep's end (failed, discarded, or not ready yet); `releaseAll` (a stalled worker, a stock map) marks every pending entry released so a sweep ending later cannot take a newer change's hold.

---

## 5. Owner colouring — the single resolver

There is **one** owner→rgb resolver, `createOwnerRgbResolver(colorMap, polityOverrides)` in `ownerColors.js`, used by every paint path: region fills, stripes and labels (`Nations.jsx`, as `resolveOwnerRgb` / `ownerColorCss`), unit counters with their heading lines and patrol rings (`Units.jsx`), and built structures (`MarkersLayer.jsx`). Units and structures take the territory's display colour (`ownerDisplayCss`, which applies `normalizePoliticalRgb`), so an army reads as the same polity as the land around it. Owners are **names now** (`"Russia"`, `"Roman Empire"`), not GADM codes. Resolution order:

0. `toCountryName(owner)` — a code (`"ESP"`, from an old save, a cheat edit or a transfer override) becomes the name the palette is keyed by.
1. `colorMap[owner]` — exact hit in `colors.json` (loaded by `getNationColors`).
2. `parseColorToRgb(polityOverrides[owner].color)` — the live polity registry from `world.json` (stores CSS strings; `colors.json` stores `[r,g,b]` triplets, so `parseColorToRgb` bridges the two namespaces).
3. Case/diacritic/punctuation-folded match (`ownerFoldKey`) against `colorMap` keys, then against `polityOverrides` keys **and their `aliases`**.
4. `fallbackRgbFromOwner(owner)` — a procedural hash of the first three A–Z letters.

The two-namespace merge is the whole point: a polity can be correctly *named* by the registry while `colors.json` has no key for it (shipped example: "British Empire" owns 426 regions in `world-war-ii-1939-copy` with its colour only in `polityOverrides`). Resolving the name but not the colour painted those regions a muddy procedural fallback — reading to players as "the map didn't annex it."

`ownerColorCss(owner)` wraps it into a `rgb(...)` string (or `NEUTRAL_LAND_COLOR`). `fallbackRgbFromOwner` strips to A–Z first so accented/two-word names hash usefully instead of collapsing to a dark corner.

### Palette live-reload

`colors.json` can be rewritten mid-game (every AI turn, or the faction creator writing the player's colour). `getNationColors` memoizes on the scenario token and won't see a runtime write, so the asset layer dispatches a `oh:colors-updated` window event on write; `Nations.jsx` (`colorsEpoch`), `Units.jsx` and `MarkersLayer.jsx` listen, and re-read on `oh:active-game-changed` too. `shallowEqualColors` guards against swapping in a fresh object with identical contents, which would needlessly rebuild every MapLibre match expression.

---

## 6. Disputed / striped regions

A region whose `claimants` list names contesting countries renders **diagonally striped** in their colours (current administrator's band first).

| Piece | Location | Role |
|---|---|---|
| `stripeImageId(rgbList)` | `Nations.jsx:158` | Encodes the rgb list into an image id: `oh-stripes-r_g_b-r_g_b…` |
| `parseStripeImageId(id)` | `Nations.jsx:160` | Decodes it back |
| `buildStripeImage(rgbList)` | `Nations.jsx:173` | Raw RGBA diagonal-stripe tile; band = `(x+y) mod period` (tiles seamlessly), `STRIPE_BAND_PX = 8` |
| `styleimagemissing` handler | `Nations.jsx:512` | On demand, builds and `addImage`s any stripe tile the style asks for |

Because the image id **encodes its own colours**, the `styleimagemissing` handler can rebuild *any* combination — including after a globe↔mercator remount wipes all GL images. This is why stripes are reactive rather than pre-registered.

Claimants come from `world.regionClaimants[id]` first (how the modern-world scenario declares disputes, since its geometry is an immutable seed), else the region feature's own `claimants` prop (editor maps). A region the world has a say on uses the world's list even when it is empty: `useWorldState.js` `withSettledClaims` puts every `world.settledRegionClaims` region into the map's view with no claimants, and the worker's `deriveDisputedData`, the stock-tile stripes and the region click test the key's presence, so a dispute the world ended does not come back from the feature. `enrichedCustomRegionData` bakes a `_stripes` property (the image id) onto disputed features; layers select on `["has","_stripes"]` and paint with `fill-pattern` instead of the solid fill:

- `custom-regions-disputed-vnext` — the worker's `disputedData` (every claimant-carrying region with its live owner and claimants), striped at `0.90` whenever `customActive && worldKnown`.
- `regions-disputed` — the tile twin for GADM disputed regions (uses `disputedTileStops`, opacity `TILE_FILL_FADE`), excluding `editedStockIds`.

### 6b. Group areas

A group (`world.groups`, `world.groupAreas`; `src/runtime/groups.js`) controls an area without owning it, and the map draws that over the owners' colours: a light tint in the group's colour (`group-areas-tint`, fill opacity `0.2`, above every fill and stripe), one outline around the whole area (`group-areas-outline` over `group-areas-outline-casing`, above the sovereign borders) and the group's name (`group-areas-labels`, below cities, structures and units). All four ids are in `MAP_LAYER_ORDER`.

The shapes come from the regions worker, asked outside the political pipeline — a group moves no owner and no border — with a `group-areas` message that `Nations.jsx` sends once this worker has published `catalog-ready` (and again when repaired shapes land, and whenever `useWorldState`'s `groups` / `groupAreas` change); only the newest answer is drawn. `vnext/groupAreas.js` cuts the outline from the frontier topology, never from a polygon union: an edge is on it when a region outside the group shares it or no region does (the coast), unless it is a seam whose two sides were simplified apart and recovered as a run between two members. On the built-in map that is one closed ring for Syria, 67 for Indonesia's islands and ≤17 ms for Russia. The tint is each member region's shape (the repaired one where there is one), one surface per group. The region card (`Selection/Regions.jsx`) says **Group control** with the group's colour, name and description.

---

## 7. Country / owner labels

Every served world is a custom one, so a map's country names are its polities' names, built from the live ownership and following conquests:

1. **Geometry and placement** — the political worker (`vnext/polityBoundariesWorker.js`) runs `buildPolityLabelCollections` (`vnext/polityLabels.js`) on each accepted cartography revision and posts `labelData`, `ptrLabelData`, `pointLabelData`, `lineLabelData` and `glyphLabelData`. No polygon fitting happens on the UI thread; `Nations.jsx` keeps the result in `polityLabelCollections`.
2. **Drawing** — the polity text renderer (PTR-1, `labels/PolityTextLayer.jsx`, layer `polity-text-renderer`) is the default. Turn it off with `?legacyPolityText=1` or the `localStorage` value `"0"`.
3. **Fallback** — the MapLibre symbol layers `country-line-labels-live-world` / `-detail` and `country-labels-live-managed` / `-overlap` draw a polity while PTR is off, still preparing, failed, or cannot prepare that one polity (`legacyPtrOwnerFilter` hides a legacy label once PTR draws its owner).

Names run through `translateLabel`, since they are baked into map features; a `labelEpoch` (bumped on `i18n:updated`) rebuilds them when translations land.

The `country-labels` and `country-curved-labels` layers are always empty. They fed the stock modern-country atlas (`loadCountryLabelCollections` in `countryLabels.js`), which no served world could draw and which is gone; the layers stay because cities, structures and units are placed under `country-curved-labels` and `MAP_LAYER_ORDER` names both.

### Label layers & styling

Both label sources feed `type:"symbol"` layers (`country-labels`, `country-curved-labels`). Shared config:

| Property | Value |
|---|---|
| `text-font` | `labelFontStack` = `[world.labelFont || "Georgia", "Georgia", "Times New Roman", "Palatino Linotype", "serif"]` (drawn locally as a CSS font-family — MapLibre v5 has no glyphs endpoint here) |
| `text-size` | `buildCountryTextSize(mult, isGlobe, prop)` — exponential-in-zoom with a stop at every integer zoom, each the uncapped size, so the two sizes MapLibre mixes per tile are exactly 2× apart and a label doubles with the map. MapLibre itself clamps glyphs at 255 px, so `buildCountryTextOpacity` keys each layer's `text-opacity` to the same size expression and fades a label out between 140 and 230 px, on top of the layer's zoom ramp (z5.8–z7.1) |
| `text-color` / `text-halo-color` | `world.labelTextColor || "#FFFFFF"` / `world.labelHaloColor || "rgba(0,0,0,0.5)"` |
| `text-opacity` | the layer's ramp (`STOCK_LABEL_RAMP`, `LIVE_LABEL_RAMP`…) fading to 0 at `LABEL_MAX_ZOOM` z7.5, times the pixel-size fade (labels fade out as you zoom in and cities take over) |
| `visibility` | `none` when `hideCountryLabels` map setting is on |
| `text-pitch/rotation-alignment` | `"map"`, `text-keep-upright:false` |

**Globe text-size fix (issue #6):** globe projection oversizes a label's own high-latitude text relative to its outline. `GLOBE_LAT_CORRECTION = cos(feature.lat * π/180)` undoes it, applied via `buildCountryTextSize(..., correctForGlobe=true)` **only** in globe mode (the factor is visibly wrong in Mercator at high latitude). Every label feature carries its own `lat` for this — the worker writes it on every label feature.

---

## 8. Cities & markers

### Cities — `Cities.jsx`

`<Cities>` picks a path from `world.customCities` (`resolveCityLayerSource`, `runtime/cityFeatures.js`). Custom scenarios never show the 70k modern database (anachronistic), and while their own set loads they render nothing rather than flash modern names; a custom set that cannot be read falls back to the stock cities. Both paths draw the same three layers into `cities-source`, all placed under `country-curved-labels`:

| Layer | Type | Draws |
|---|---|---|
| `cities-shapes` | circle | every city but capitals; radius, colour and opacity rise with the city's rank |
| `cities-capitals` | symbol | a gold `★` (`rgba(228, 185, 61, 0.99)`, dark halo) for capitals, always on top of placement (`text-allow-overlap`) |
| `cities-labels` | symbol | the name (`Open Sans Semibold`, white with a dark halo, variable anchor), capitals slightly larger |

**Stock** (`cities.pmtiles`, source-layer `cities`): a city ranks by population — the tile's figure, or the one in `world.cityPopulations` (below). Capitals (`capital: "primary"`) always show; the others must be larger than a threshold that steps down as you zoom in (filters in `cityLayerExpressions.js`):

| | Before the first step | Steps |
|---|---|---|
| `cities-shapes` (`minzoom 3.4`, `populationFilter`) | 3,000,000 | 1.5M at z5.25, 750k at z6.25, 350k at z7.25, 150k at z8.25 |
| `cities-labels` (`minzoom 3.7`, `populationLabelFilter`) | 4,000,000 | 2M at z5.5, 1M at z6.5, 500k at z7.5, 250k at z8.5 |

Circle size, colour and label opacity step at 2.5M and 1M; the sort keys put capitals, then larger cities, first.

**Custom** (`citiesGeojson`): a city ranks by its authored tier (`_ohTier` or `tier`: 4 capital-class, 3 major city, 2 city, 1 town; `_ohCapital` marks a capital), since historical populations sit far below modern thresholds (Paris in 1200 held ~50k):

| | Always | Tier ≥ 3 | Tier ≥ 2 | Everything |
|---|---|---|---|---|
| `cities-shapes` (`minzoom 2.65`, `customTierFilter`) | capitals, tier 4 | z4.7 | z5.8 | z7.0 |
| `cities-labels` (`minzoom 3.0`, `customLabelFilter`) | capitals, tier 4 | z5.0 | z6.5 | z8.0 |

`customSortKey` orders labels by capital, tier, then population.

A city in the scenario's `cities.geojson` may carry its **population by year** — a `populationByYear` object (`{"1950": 3400000}`, BC years negative), rows of `{year, population}`, or Natural Earth's flat `POP1950`-style fields (`src/runtime/cityPopulation.js`). `Cities.jsx` redraws those cities once a game year with the figure for the year (straight between the two years around it, the nearest year's outside them); the city card and the AI's city lookups read it for the exact date. A population the AI sets (`markerOps` `population` → `world.cityPopulations`), or the GM changes by hand in the Map Feature Editor, wins from then on, and the series is no longer read for that city. On stock cities it decides **whether** a city shows as well as how it looks: a town grown into a city appears where cities do, and a city emptied to 0 leaves the map. The tiles keep a city's original name, so a figure set after an AI rename (`world.cityRenames`) is matched back to it (`cityPopulationOverridesByTileName`).

### Markers (built structures) — `MarkersLayer.jsx`

Fed from `world.markers` (structures founded during play or placed in the Workshop — bases, silos, embassies…). Each marker with a finite position and a name becomes a Point feature in `markers-source`. `getMarkerPresentation` (`vnext/presentationPolicy.js`) reads its kind and name for a family and glyph, and a priority:

| Family | Glyph | Priority | Matches (kind or name) |
|---|---|---|---|
| settlement | `●` | 92 | capital, city, town… |
| military | `▲` | 84 | base, fort, silo, missile, airfield, headquarters… |
| resource | `◆` | 70 | mine, oilfield, deposit… |
| infrastructure | `■` | 68 | port, rail, airport, pipeline… |
| industry / science | `✦` | 64 | factory, laboratory, reactor… |
| diplomatic | `◇` | 58 | embassy, consulate… |
| landmark (default) | `•` | 46 | anything else |

Strategic wording (national, strategic, nuclear, capital…) adds 7; status moves it (damaged +4, planned −10, inactive −12, abandoned −18, destroyed −24). The priority picks a visibility tier, and each tier has its own pair of layers:

| Tier | Priority | Shapes (`markers-shapes-<tier>`) from | Labels (`markers-labels-<tier>`) from |
|---|---|---|---|
| `strategic` | ≥ 82 | z3.0 | z3.8 |
| `regional` | ≥ 62 | z4.2 | z5.0 |
| `local` | below | z5.8 | z6.6 |

A glyph takes its owner's colour as the territory shows it (`ownerColors.js`, §5), neutral parchment `rgb(226, 222, 205)` when unowned; its lifecycle status sets the opacity (1 active down to 0.62 destroyed). The palette is re-read on `oh:colors-updated` and `oh:active-game-changed`.

---

## 9. Units (troops)

### Render — `Units.jsx`

`units-source` (geojson) is declared empty and filled with `setData` from `unitsController.getUnits()`; positions tween over ~1.2 s outside React. Each unit is a Point feature with its owner's colour (§5), the owner's flag icon where one resolves (`unitFlagIcons.js`), a `TYPE_GLYPH` fallback (`infantry:I, armor:A, air:F, naval:N, artillery:G, garrison:C`) and a two-word label (`shortUnitLabel`). When MapLibre rebuilds the style (3D Terrain, a restored WebGL context) the source comes back new and empty; the layer's `styledata` handler refills it and re-adds the flag icons.

| Layer | Source | Type | Encodes |
|---|---|---|---|
| `units-heading` | `units-orders-source` | line | a dashed line to a march's destination (`minzoom 3`) |
| `units-station` | `units-orders-source` | line | a patrol's station ring |
| `units-fill` | `units-source` | circle | owner colour and status; smaller for a covert contact |
| `units-icons` | `units-source` | symbol | the flag, or the type glyph without one |
| `units-name` | `units-source` | symbol | the short name under the counter (`minzoom 3`); strongest keeps its label on collision |

Status drives styling — **pending** (player-requested, not yet AI-confirmed) units are translucent (`circle-opacity 0.32`) with a blue stroke; a **covert** contact is fainter and smaller; **moving** = amber stroke; **engaged** = red stroke; else white.

### Controller — `unitsController.js`

A module-level store, separate from `useWorldState` but with the same 5s cadence (`startUnitsSync`). It holds `units`, `playerCode`, `round`, `gameDate`, `allowedUnitTypes`, and an `interactionMode` (`idle | deploy | admin-place`), plus a `subscribeUnits` pub/sub the map/popups/Forces panel listen to.

| Function | Effect | Instant feedback | AI hand-off |
|---|---|---|---|
| `deployUnit` | Add a `pending` unit (translucent) | placed locally | queues a "Deploy request" order; revert = remove |

Player deploy is purely local **and** queues a machine-readable `action` (via `queueOrder`) so the AI confirms, repositions or rejects it on the next jump. The player never moves or fights a formation by hand: they state intent (`requestUnitOrders`, also an `action`), and the engine (`runtime/unitMotion.js`) and the AI carry it out.

### Interaction dispatch — `Nations.jsx` `handleRegionClick`

The map's single `click` handler (`Nations.jsx:564`) routes by `getInteractionMode()`:

- **deploy mode** intercepts the click as a *target* (`deployUnit`), then `clearInteractionMode()`; the admin placement tool (`placeUnitAdmin`) rides the same dispatcher.
- **normal click** priority: unit (`units-fill`) → feature (the `markers-shapes-*` tiers, then `cities-shapes` / `cities-capitals`; city text is not queried, so a big label cannot steal a province click) → region. Region query uses `["custom-regions-fill","custom-regions-fill-far"]` on drawn-geometry maps but `["custom-regions-fill","regions-fill"]` on re-ownership maps (so a click on fantasy ocean resolves to nothing, not the leftover real country underneath — `hasDrawnGeometry`). The resolved region is handed to `onRegionSelected` with the **owner name** resolved (via `ownerLookupRef`), the underlying GADM `gid0` kept as a flag fallback.

The staged-reveal system (`setUnitsOverride` / `setWorldStateOverride`) lets the map show units/world as of the last revealed event during a turn's event playback, snapping back to live state when cleared (see [World state](world-state.md) and the turn/time system).

---

## 10. The decorative globe (`GlobeEffects.jsx`)

Active only when `projection === "globe"` (`active` prop). It drives four things, all outside MapLibre's own render: the sun sprite (`#oh-globe-sun`), the starfield canvas (`#oh-globe-stars`), the day/night lighting canvas (`#oh-globe-lighting`), and idle auto-rotation. Those DOM elements are declared in `World.jsx` around the transparent `<Map>` canvas so the globe provides correct sun occlusion.

- **Real sun:** `sunWorldPosition = subsolarPoint()` — the actual subsolar point for the current wall clock (seasonal declination + Earth's rotation). Moving the camera changes perspective without sliding light across the countries; the terminator matches the planet outside your window. `LIVE_SUN_REFRESH_MS = 60_000` refreshes it even when the map is fully idle.
- **Auto-rotation:** `ROTATION_DEG_PER_MS = 360 / (10 min)`. Disabled by the `disableIdleRotation` map setting, and interrupted by any drag/zoom/pointerdown.
- **Aggressive idle throttling (the main perf lever):** while the player drags or zooms, the stars and sun redraw at 25 fps (`CELESTIAL_FRAME_MS_ACTIVE`) and the lighting every frame (`LIGHTING_FRAME_MS_ACTIVE = 0`), or at 30 fps on a phone (`LIGHTING_FRAME_MS_ACTIVE_CONSTRAINED`, `isConstrainedDevice()`), where each redraw is a 48,000-pixel shade on the main thread. While idle (including auto-rotate) both drop to 15 fps (`*_FRAME_MS_IDLE`), and the auto-rotate `jumpTo` itself steps at 15 fps (`IDLE_ROTATE_FRAME_MS`) using real elapsed time so rotation *speed* is unchanged. Idle auto-rotate previously forced a full MapLibre re-render + from-scratch lighting repaint 60×/s forever — this was cooking phones.
- **Projection morph:** the globe↔mercator morph fades stars/lighting via `projectionTransition` (1 on settled globe, 0 on flat, between only mid-fade). The morph fires no map "move" event, so `isMorphing` forces full-rate redraws during the fade; only the settled globe throttles.
- **WebGL context loss** is handled: on `webglcontextlost` it cancels the rAF loop and releases the canvases; on restore it resyncs and resets the rotation clock so the first tick doesn't jump the globe by the whole lost interval.

Sun/star/lighting math is in `globeSunMath.js`, `globeCanvasLighting.js` (with `globeLightingPixels.js`) and `globeCelestialCanvas.js`.

---

## 11. Zoom caps & why they're deliberate

| Cap | Where | Rationale |
|---|---|---|
| `minZoom 2.25` | `<Map>` | World-view floor |
| `maxZoom 16` | `<Map>` | Camera ceiling; past PMTiles' z8 the tiles overzoom |
| `maxBounds` lat `-80…85` | `<Map>` | Keep the camera in the usable latitude band |
| PMTiles `maxzoom 8` | `regions-source` | **Not the archive's z10.** `extract-regions.mjs` can't stitch a z10 seed (dies in `JSON.stringify` past V8's 512 MB max string); z9's 4.1 M vertices OOM'd the editor renderer; z8's 2.6 M is stable — and rendering finer than the editor can author only draws detail no map can be built against. MapLibre overzooms past z8. |
| `custom-regions-fill-far maxzoom 7` | seed-GeoJSON far layer | Stops just past the z5.5–6.5 crossfade; the stock tiles own the crisp zoom |
| Polity names end at z7.5 | `LABEL_MAX_ZOOM` (every label layer's `maxzoom` and ramp, `Nations.jsx`), `POLITY_TEXT_MAX_ZOOM` (`labels/polityTextLayout.js`) | Names fade over the last half zoom and stop at 7.5; past that the map is provinces and cities |
| Crossfade band z5.5–6.5 | `FAR_FILL_FADE`/`TILE_FILL_FADE` | Seed extracted at tile-zoom 5; hand off just past it |
| No pixel-ratio switch | `pixelRatio={1}` on `<Map>` | R5.0 switched density at z4.5/z5 and hitched at the boundary; one fixed 1× density since R5.1 (§2) |
| Cities from z3.4 (stock) / z2.65 (custom), thresholds step by zoom | `Cities.jsx`, `cityLayerExpressions.js` | Thin out symbols as you zoom out (§8) |
| Label `text-opacity` fades to 0 by z8 | `labelLayerPaint` | Country/owner labels hand the screen to city labels on zoom in |
| Structures from z3.0 / z4.2 / z5.8 by tier, labels 0.8 zoom later | `MarkersLayer.jsx` | Strategic sites read at continental zoom, local ones only close up (§8) |

---

## 12. Data-flow summary

```
world.json ──(useWorldState, 5s)──► customRegions, regionOwnershipOverrides,
   │                                 regionClaimants, polityOverrides, markers,
   │                                 labelFont/Color, basemap, background, units
   │
   ├─► Nations.jsx ──► polity boundary worker (dissolved surfaces, frontiers, disputed data)
   │                   live polity labels (buildPolityLabelCollections; follow conquests)
   │                   stockRegionsFillPaint (GID_1 → owner colour)
   │
   ├─► useCustomBackground ──► buildWorldStyle (image/vector/placeholder/ESRI)
   ├─► MarkersLayer ──► markers-source
   └─► unitsController (own store of world.units) ──► Units.jsx / popups

colors.json ──(getNationColors, oh:colors-updated event)──► colorMap
   └─► resolveOwnerRgb ──► every fill / stripe / label / marker / unit colour

regionsGeojson / citiesGeojson ──(readJson, force)──► custom region & city geometry
regions.pmtiles / cities.pmtiles ──► stock tile geometry
countries.pmtiles ──► country index + bounds (no layer draws it)
```

Every owner recolour, label rebuild, and unit/marker update is a consequence of a `world.json` (or `colors.json`) change surfacing through the store's write events. The map is a pure function of that state plus the static per-scenario geometry.

### Cross-references

- [World state](world-state.md) — the `world.json` schema, `regionOwnershipOverrides`, `polityOverrides`, `regionClaimants`, `markers`, `units`, staged-reveal overrides.
- Runtime asset layer (`src/runtime/assets.js`) — `JSON_URLS`, `PMTILES_PROTOCOL_URLS`, the `ohbase://` protocol, `getNationColors`, `resolveCountryDisplayName`, scenario-token cache sweeping.
- Selection popups (`src/Game/Selection/*`) — consumers of `onRegionSelected` / `onFeatureSelected` / `onUnitSelected`.

## Readiness signals

`src/runtime/mapReadiness.js` records two things on `window.__OH_MAP_READINESS__` and dispatches them as events: `oh:map-polities-ready` (Nations.jsx, with the regions asset URL the polity layers were built for — after the boundary worker answers or fails, or at once on a stock map) and `oh:map-idle` (World.jsx, every idle). The loading screen a game opens under (`GameUI/gameLoadingScreen.jsx`) waits for the first, then for the next idle.
