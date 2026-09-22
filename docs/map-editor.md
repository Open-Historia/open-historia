# Map Editor

The Map Editor is a standalone OpenLayers map-authoring surface (reachable at `/?editor=1`, or embedded from a scenario's library bar) that lets a user re-own, reshape, recolour, and re-populate the world map and export it as a game-playable seed. It runs in its own React tree with its own map instance, deliberately isolated from the game's MapLibre map so the two can never disturb each other (`src/Editor/MapEditor.jsx:6`). Region *geometry* lives outside React in an OpenLayers vector source and is driven imperatively; everything else (types, cities, colours, flags, tags, metadata) lives in a document-state hook.

The editor writes a game seed in one of two tiers: **tier 1 (re-ownership)** keeps stock GADM region ids so the game renders from the shipped `regions.pmtiles`, and **tier 2 (custom geometry)** ships an exported `regions.geojson` the game renders directly. Understanding that split (`src/Editor/exportPreset.js`) is the key to the whole subsystem.

---

## 1. How the editor is reached (routes / entry points)

| Entry | Where | What it does |
|---|---|---|
| `/?editor=1` | `src/App.jsx:200` | Standalone mode. `App` reads the URL param once at render and mounts `<MapEditor />` (lazy-loaded) with no props — no `onClose`, no `onApplyToScenario`. Authoring-only; export happens via the Documents menu's download buttons. |
| Scenario "Edit map" button | `src/Game/GameUI/libraryBar.jsx:2511` (`onOpenMapEditor`) | Embedded mode. Sets `mapEditorScenario`, opens the editor, and streams the scenario's current map assets into `mapEditorSeed`. |
| Embedded `<MapEditor>` mount | `src/Game/GameUI/libraryBar.jsx:2133` | Passes `onClose`, `scenarioName`, `initialMap={mapEditorSeed}`, and `onApplyToScenario`. Presence of `onApplyToScenario` is what flips the editor into "scenario mode". |

`MapEditor`'s prop contract (`src/Editor/MapEditor.jsx:40`):

| Prop | Meaning |
|---|---|
| `onClose` | Present in embedded mode → renders the top-right **✕ Close** button. |
| `scenarioName` | Label shown in the Apply button tooltip. |
| `onApplyToScenario(seed)` | Callback that writes the built game seed into the scenario. Its presence sets `scenarioMode = true` (`:45`), which forces `seedKind="deferred"` so the default world is **not** auto-seeded underneath the scenario's own map. |
| `initialMap` | The scenario's current map (regions/owners/cities/palette/flags/tags/background/basemap), hydrated once it arrives (`:339`). |

---

## 2. File map (`src/Editor/`)

| File | Role |
|---|---|
| `MapEditor.jsx` | Root component. Composes the map + toolbar + panels + inspector + bottom bar; owns cross-cutting state (open panel, paint owner, doc id, save flow, custom background, FMG). |
| `OlMap.jsx` | The OpenLayers surface. Owns the region source/layers, all editing interactions, click-selection, undo/redo, and the imperative region API exposed via `onReady`. |
| `useMapDocument.js` | Document state hook: metadata, types, features (cities), colorOverrides, flags, tags + all setters + ephemeral UI state. Region geometry is **not** here. |
| `Toolbar.jsx` | Top tool strip (single-choice tool + undo/redo/fit). |
| `BottomBar.jsx` | Status bar: counts (open managers), Layers/Reference buttons, basemap picker, map name, save-status dot, search box. |
| `SelectionInspector.jsx` | Right panel for the current region selection: name/type/country/disputed-by/colour/flag/tags + merge/copy/zoom/delete. |
| `TypeManager.jsx` | Region "type" editor (render + gameplay settings). |
| `RegionsPanel.jsx` | Searchable region list → select + zoom. |
| `FeatureManager.jsx` | City/point-feature list; bulk import from the seed, or from the author's own file (`featureImport.js`). |
| `CityPopup.jsx` | Inline city editor anchored at the click. |
| `SearchBar.jsx` | Unified place search (this map's cities, regions, ~70k world places). |
| `LayersPanel.jsx` | Region / label layer visibility toggles. |
| `ReferencePanel.jsx` | Tracing-image upload/opacity/placement (session-only). |
| `BasemapPicker.jsx` | Overlay to choose a built-in ESRI basemap, a saved basemap, upload, or a community one. |
| `FlagPicker.jsx` | Overlay to choose a country flag (My flags / built-in / community). |
| `DocumentsMenu.jsx` | Top-left menu: new/open/save/export-JSON/export-for-game + author field. |
| `exportPreset.js` | `buildGameSeed` + tier detection + region normalization + verbatim-polity logic. |
| `regionImport.js` | Loads `regions-seed.geojson` into the OL source; resolves owner NAMEs from `gid0`. |
| `documentMigration.js` | Brings a legacy code-keyed document forward to name-keyed on open. |
| `documentIO.js` | REST client for `/api/mapeditor/documents` + local JSON download. |
| `customBackground.js` | Loads uploaded backgrounds (GeoJSON/KML/KMZ/SHP/GeoTIFF/PMTiles/image) into OL layers; persistence helpers. |
| `geometry.js` | Polygon boolean ops (union/difference/intersection), line split, translate. |
| `olStyle.js` | Region → OL `Style` mapping (owner colour, opacity, stroke, disputed striping). |
| `basemaps.js` | ESRI basemap presets + XYZ/preview URL builders. |
| `editorStyles.js` | Shared chrome styling constants (`panelSurface`, `inputStyle`, `ACCENT`, `pillButton`, `toolButton`). |
| `fields.jsx` | Form-field primitives (`Row`, `TextField`, `NumberField`, `ColorField`, `Toggle`, `SelectField`, `TagField`) + hex/rgb helpers. |
| `fmg/FmgPanel.jsx`, `fmg/fmgDriver.js`, `fmg/fmgImport.js` | Fantasy Map Generator drawer, headless Azgaar runner, result→editor-seed converter. |
| `flagImage.js`, `citiesImport.js` | Flag downscaling; seed-city import + search. |

---

## 3. Architecture & data flow

Two stores, split by weight (`src/Editor/useMapDocument.js:6`):

- **Document state** (React, in `useMapDocument`) — metadata, region `types`, point `features` (cities), `colorOverrides`, `flags`, `tags`. Cheap, serialisable, the source of truth for everything except geometry.
- **Region geometry** (OpenLayers `VectorSource`, in `OlMap`) — ~3,662 filled/stroked polygons, far too heavy for React state. Materialised into the document only on **save/export** via `api.serializeRegions()`.

`MapEditor` receives the imperative region API through `OlMap`'s `onReady={setApi}` callback (`src/Editor/MapEditor.jsx:453`). Panels never touch the map directly; they call `api.*` methods, which mutate OL features and call `layer.changed()` to restyle. Region mutations fire `onRegionsChanged` → `setSaveStatus("dirty")` → debounced autosave.

```
DocumentsMenu / BottomBar ─┐
SelectionInspector ────────┤   props (colors, types, selection…)
TypeManager / Features … ──┼──► MapEditor ──► OlMap  ──► OL VectorSource (geometry)
                           │        │  ▲            (api.* imperative calls)
                           └────────┘  └── onReady(api), onSelectionChange, onRegionsChanged
```

---

## 4. Document model (`useMapDocument.js`)

`createDocument()` (`:59`) shape:

| Field | Type | Notes |
|---|---|---|
| `id` | string \| null | Server document id; null until first save. |
| `version` | number | Document schema version (1). |
| `metadata.name` | string | Map name. |
| `metadata.kind` | `"import-world"` \| `"blank"` | Drives seeding + tier detection. |
| `metadata.author` | string | Shown as "Made by …" credit. |
| `metadata.basemap` | string | Built-in basemap id (default `"ocean"`). |
| `metadata.customBackground` | object \| null | Persisted uploaded background (image `dataUrl`+aspect, or vector `geojson`). |
| `metadata.simulationRules`, `startingTimelineText`, `startDate`, `gameDate` | string | Carried into the game seed. |
| `types` | Type[] | Region types (see §11). Seeded with `DEFAULT_TYPES` (Land, Coastal). |
| `features` | Feature[] | Point features / cities (see §12). |
| `units` | Unit[] | Starting military units (see §9b): `{ id, name, type, ownerCode, strength, composition, note, lng, lat, regionId }`, placed with the Unit tool. |
| `ownerSchema` | number | `OWNER_SCHEMA` marker — says "owners are NAMEs, not codes". Critical: a doc without it re-migrates every open. |
| `colorOverrides` | `{ [countryName]: [r,g,b] }` | The map-maker's own colour choices. |
| `flags` | `{ [countryName]: dataURL }` | Author-set flags (downscaled PNG data URLs). |
| `tags` | `{ [countryName]: string[] }` | Starting ideology/alignment tags. |

**Colours are keyed by country NAME, not GADM code** — this is true of `colorOverrides`, `flags`, `tags`, and region `owner` alike. See §10.

The hook exposes a derived `colors` = `{ ...fetchedPalette, ...colorOverrides }` (`:194`) so an edited colour paints immediately exactly as it will in-game; `basePalette` is the fetched palette alone (`/assets/colors.json`, `:110`) so the UI can offer a **Reset** when an override exists. `mergeColors(extra)` layers a scenario's own polity colours on top.

Setters (all set `saveStatus="dirty"`):

| Setter | Guard |
|---|---|
| `setColorOverride(country, rgb)` | `null` rgb deletes the key. |
| `setFlag(country, dataUrl)` | `null` deletes. Value is an already-downscaled PNG data URL. |
| `setTags(country, list)` | Uses `.length` (not truthiness) so an empty `[]` deletes rather than persisting `[]` for every touched country (`:160`). |
| `setTypes`, `setFeatures`, `setUnits` | Accept updater fn or value. |
| `patchMetadata` / `setBasemap` / `setName` / `setAuthor` | Metadata patches. |

`saveStatus` ∈ `saved | dirty | saving | error`; `counts` = `{ regions, features, units, types }`.

---

## 5. The OpenLayers surface (`OlMap.jsx`)

Created once in a `[]`-dep effect and driven through refs so it survives React re-renders (`:232`). Props flow in through refs (`typesByIdRef`, `colorsRef`, `selectedIdsRef`, `activeToolRef`, `paintOwnerRef`, …) so the map stays valid without recreating.

### Layers (z-index ladder)

| Layer | Type | zIndex | Source / notes |
|---|---|---|---|
| Base basemap | `TileLayer` (XYZ ESRI / OSM) | 0 | Swapped by `basemap` prop; **not created** while a custom image/vector background is active (`:1019`). |
| Custom background | vector/raster `VectorLayer`/`WebGLTileLayer`/`TileLayer`, or image `ImageLayer`(`ImageStatic`) | 5 | Uploaded map; image is stretched across the whole world extent (`WORLD_EXTENT_3857`). |
| Regions | `VectorImageLayer` | 10 | `regionSource`, `imageRatio:2`, `wrapX:false`; style = `makeRegionStyle(...)`. |
| Region labels | `VectorLayer` (declutter) | 20 | Same source; `minZoom:4`; label per named region unless `type.includedInLabels === false`. |
| Cities / points | `VectorLayer` (declutter) | 30 | `pointSource`; zoom+prominence gated so ~70k cities never all render. |
| Reference image | `ImageLayer` | 40 | Tracing aid (session only). |
| Reference frame | `VectorLayer` | 41 | Dashed outline + corner handles while the Reference panel is open. |

**Two performance-critical choices** (documented at `:232` and `:250`): `wrapX:false` on the source/layers (stops OL redrawing the world sideways *and* fixes ±180° editing), and `VectorImageLayer` for regions (rasterise-once/re-blit instead of re-rasterising thousands of paths per frame). Serialisation uses `writeFeaturesObject` (not `JSON.parse(writeFeatures(...))`) to avoid building an ~83MB string on every 2s autosave (`:785`).

### Click handling (`map.on("singleclick")`, `:372`)

Only these tools consume a click: `select`, `delete`, `paint`, `feature`, `dissolve`. `map.forEachFeatureAtPixel` hit-tests the region layer (tolerance 2). Ctrl/Cmd/Shift = additive selection. Double-click with Select selects the **whole country** (all regions sharing the owner) and returns `false` to suppress OL's DoubleClickZoom (`:480`).

### The imperative region API (returned by `onReady`, `:601`)

This is the surface every panel drives. Each mutating call pushes an undo/redo command onto an 80-entry stack (`pushCmd`, `:225`) and calls `notifyRegions()` (→ dirty).

| Method | Purpose |
|---|---|
| `map`, `regionSource`, `regionLayer`, `labelLayer` | Raw OL handles. |
| `fitToData()` | Fit view to all regions. |
| `zoomToRegion(id)` / `zoomToSelection(ids)` | Fit to one/many. |
| `setRegionAttrs(ids, patch)` | Patch `owner` / `typeId` / `name` / `claimants` on many regions at once, undoably. The workhorse behind the inspector. |
| `deleteRegions(ids)` | Remove regions. |
| `mergeRegions(ids)` | Union ≥2 regions into the first; others removed. Uses `unionGeoms` (`geometry.js`). |
| `copyRegions(ids)` | Duplicate with a view-scaled offset; new ids, `" copy"` name, carries typeId/owner/gid0/claimants. |
| `exportRegions(ids)` | The regions as a GeoJSON FC (EPSG:4326, 5 decimals, ids in the properties) for the region clipboard (§9c). |
| `pasteRegions(fc)` | Adds regions copied from another map, carving each one's land out of whatever already covers it (`overlaps` + `subtractFrom`, the Draw tool's rule: a bite, a hole, or the region beneath removed, survivors marked `edited`). A pasted region keeps its id when the target has none by that id, else gets a fresh `reg_` id, and is always marked `edited`. Selects the pasted regions; returns `{ added, trimmed, removed }`; one undo step. |
| `getRegionSummary(id)` | `{ id, name, owner, typeId, country, claimants }`. |
| `listOwners()` | Sorted unique owner names — backs the Country field's suggestions so re-owning offers existing names (avoids near-miss forks). |
| `queryRegions(text, limit=200)` | Search id/name/owner. |
| `countByType()` | Region count per typeId (Type Manager usage). |
| `setLayerVisibility(key, visible)` | `regions` \| `labels` \| `features`. |
| `locateFeature(coord)` | Fly to a lon/lat. |
| `serializeRegions()` | Region geometry → GeoJSON FC (EPSG:4326, 5 decimals). Used on save/export. |
| `loadRegions(fc)` | Replace the source from a FeatureCollection (ids pulled from `properties.id`). |
| `reseedWorld()` | Load the stock world seed fresh. |
| `reseedWorldWithOwners(overrides)` | Load stock world, then stamp `{regionId: ownerName}` overrides — how a tier-1 scenario opens. |
| `undo()` / `redo()` | Drive the command stack. |
| `restyle()` | Force `layer.changed()`. |

Keyboard: **Ctrl/⌘+Z** undo, **Ctrl/⌘+Shift+Z / Ctrl+Y** redo, **Delete/Backspace** removes the selection — all suppressed while typing in an input (`:545`).

---

## 6. Tools (`Toolbar.jsx` + `OlMap.jsx` interaction effect)

Single-choice; the active tool mounts/unmounts OL interactions in the `[activeTool]` effect (`src/Editor/OlMap.jsx:854`).

The strip sits in a band between the documents chip and the Save / Apply / Close group (on a phone, the whole window) and wraps into more rows when the band is narrower than the strip; it publishes its bottom edge as the CSS variable `--editor-toolbar-bottom`, which every side panel (`Panel.jsx`) uses as its top, so a wrapped strip never sits under a panel and no tool ever sits under a Save button.

| Tool | id | Interaction / behaviour |
|---|---|---|
| Select | `select` | Click = select region; Ctrl/Shift = additive; double-click = whole country. |
| Lasso select | `lasso` | Freehand `Draw` polygon; on `drawend` selects every region whose interior point falls inside (`selectWithinPolygon`, `:868`). |
| Pan | `pan` | No interaction added; default map drag. |
| Draw region | `draw` | `Draw` (Polygon, `trace:true`, `traceSource:source`) + `Snap`. Clicking a border traces along it. **On `drawend` the new polygon is carved OUT of every region it overlaps** (`subtractFrom`, R-tree extent query for candidates) so no ground is owned twice; carved neighbours get `edited:true` (`:889`). Inside → hole; across an edge → bite; fully over → deletes the underlying region. |
| Edit vertices | `modify` | `Modify` + `Snap`. On `modifyend` sets `edited:true` on dragged features (`:963`). |
| Move | `move` | `Translate` on the region layer. |
| Delete | `delete` | Click removes a region (a city hit under the cursor wins). |
| Delete border (dissolve) | `dissolve` | Click a region; probes neighbouring pixels for the region across the nearest border and unions the two into one (`:428`). |
| Paint owner | `paint` | Click stamps the current **Paint owner** value (a country NAME, trimmed, never case-folded) onto the clicked region (`:394`). A floating owner input + swatch appears at the top (`MapEditor.jsx:553`). |
| City tool | `feature` | Click empty map → `onFeatureCreate` (drops a city + opens `CityPopup`); click a city → `onFeatureEdit`. Carries the underlying region's owner/regionId (`:410`). |
| Unit tool | `unit` | Click empty map → `onUnitCreate` (drops a starting unit owned by the region's owner and opens `UnitPopup`); click a unit → `onUnitEdit`. The Delete tool removes a unit under the cursor. See §9b. |
| Box-select features | `feature-box` | Drag a rectangle (`DragBox`) over cities and features → `onFeatureSelectionChange(ids)`; Shift adds to the selection. Selected features draw a yellow ring, and the Features panel's selection bar tags or deletes them together (§9). |
| Undo / Redo / Fit | — | Toolbar buttons wired to `api.undo/redo/fitToData`. |

The **`edited` flag** is the linchpin of tier-2 correctness: a reshaped GADM region's true geometry now lives in the exported GeoJSON while the stock tiles still hold its original shape. The exporter carries `edited:true` into the game so `Nations.jsx` renders it from the GeoJSON and excludes it from the stock-tile fill (otherwise the original shape repaints on top, darker — the "edited-region shade" bug).

---

## 7. Editing a region's attributes (`SelectionInspector.jsx`)

Shown whenever ≥1 region is selected. Writes go straight through `api.setRegionAttrs(selection, patch)` (`:57`), which live-restyles. Fields:

| Field | Applies | Notes |
|---|---|---|
| **Name** (single only) | `{ name }` | The region label. |
| **Type** | `{ typeId }` | `— mixed —` shown when a multi-selection disagrees. |
| **Polity** (owner) | `{ owner: key \| null }` | Free text over the polity registry, backed by a `<datalist>` of existing polities (registry entries plus `listOwners()`), shown by display name. An existing polity is matched by its stable key or display name without regard to case and its key is stored unchanged, so "france" cannot fork a second France. **A name nobody has yet becomes a new polity** — `upsertPolity` writes the same record the Polities panel creates (`name`, `code`, `aliases`, `status`) and the selection is assigned to it — but only on **Enter** or the **Create “…”** button that appears under the field; leaving the field assigns only an existing match, and Escape reverts, so a half-typed name never mints a one-province country by accident. Blanking the field offers **Make unowned**. |
| **Disputed by** (claimants) | `{ claimants }` | `TagField` of country names. Any claimant makes the region render **striped** (owner colour + each claimant's), here and in-game. |
| **Colour** | `setColorOverride(owner, rgb)` | Only shown with an owner. **Reset** appears when an override exists (`colorOverrides[owner]`). |
| **Flag** | opens `FlagPicker` via `onOpenFlagPicker(owner)` | Renders current flag thumbnail. |
| **Tags** | `setTags(owner, next)` | `TagField` with `TAG_SUGGESTIONS`; free vocabulary. |

Footer buttons: **Clear country** (`owner:null`), **Merge** (≥2), **Duplicate** (`copyRegions`, a copy beside the original on this map), **Copy to clipboard** (§9c), **Zoom**, **Delete**.

Note the owner/colour/flag/tag edits are keyed to the *country name*, so editing one region's colour recolours the whole country everywhere.

---

## 8. Region types (`TypeManager.jsx`)

A "type" carries render + gameplay settings and is referenced by each region's `typeId`. Seeded with `DEFAULT_TYPES` = Land + Coastal (`useMapDocument.js:18`). Editing a type live-restyles (OlMap restyles on the `types` prop). Type schema:

| Field | Used by | Meaning |
|---|---|---|
| `id`, `name` | — | Identity. |
| `opacity` | `olStyle.js` | Fill alpha for **owned** regions. |
| `unownedOpacity` | `olStyle.js` | Fill alpha for unowned. |
| `zIndex` | `olStyle.js` | Draw order. |
| `strokeWidth`, `strokeColor`, `strokeOpacity` | `olStyle.js` | Border. |
| `overrideColor` | `olStyle.js` | Force a fixed fill instead of the owner colour (`null` = off). |
| `pathfindingSpeed`, `interactable`, `passable`, `showToDefaultPrompt` | game | Gameplay flags. |
| `includedInLabels` | `OlMap` label layer | `false` suppresses the region label. |
| `zoomSettings: [{minZoom,maxZoom}]` | `pickZoomBand` (`olStyle.js:88`) | Hides the type outside the zoom band. |

At least one type must always exist (delete is disabled at length 1).

---

## 9. Cities / point features

Point features (mostly cities) live in `doc.features`. Feature schema (`citiesImport.js:31`, `MapEditor.jsx` create paths):

| Field | Meaning |
|---|---|
| `id` | `newId("feat")`. |
| `name` | City name. |
| `type` | `"Coordinate"`. |
| `symbol` | `square` \| `circle` \| `triangle` \| `star`. |
| `coord` | `[lon, lat]`. |
| `country`, `owner`, `regionId` | Context of where it was dropped. |
| `population` | Drives the prominence tier. |
| `tags` | e.g. `["city"]`, `["city","capital"]`. |

**Editing paths:**
- **City tool + `CityPopup`** (`CityPopup.jsx`) — inline editor at the click. Name, **Size** select (Town 20k / City 250k / Major 1.5M — maps to population) and a **★ Capital** checkbox (toggles the `capital` tag). Enter/Esc closes.
- **Feature Manager** (`FeatureManager.jsx`) — searchable list; per-feature name/symbol/tags, locate, delete, **Delete All**, and **Import all cities** / **Major only** which pull from `public/assets/cities-seed.json` (~70k, deduped by `name|coord`). **Import from file…** adds the author's own point features — GeoJSON Point/MultiPoint features (other geometries are counted as skipped), a Workshop document or its `features` array, or a JSON list of rows with lon/lat (`featureImport.js`: names from name/title/city/label, tags from tags/kind/category, a country from country/owner); exact duplicates of features already listed are dropped, and the panel reports what was added. **Selection:** every row has a checkbox (Shift-click selects a range), the **Box-select features** tool selects by dragging a rectangle on the map, and the selection bar above the list adds a tag to every selected feature at once, removes one from all of them, deletes them all, or clears the selection. The selection (`featureSelection` in `MapEditor.jsx`) is shared by the map and the panel, so a box drawn on the map ticks the rows and a ticked row rings its marker.
- **Search bar** (`SearchBar.jsx`) — unified search over this map's cities, its regions, and the ~70k world place index; world results get a **＋ Add** button to drop them as a city.

Prominence tier (`exportPreset.js:100`, `cityTier`): `capital`→4, ≥1M→3, ≥100k→2, else 1. This gates when a city label appears in-game (`Cities.jsx`).

---

## 9b. Starting units (`UnitsPanel.jsx`, `UnitPopup.jsx`)

`doc.units` holds the formations that stand on the map at round one. Place one with the **Unit tool** (click the map: the unit belongs to the region's owner, and `UnitPopup` opens at the click for name, type — `UNIT_TYPES` from `src/runtime/gameState.js` — strength 1..100, owner, composition and note; click an existing unit to edit it; the Delete tool removes one). The **Units** chip opens `UnitsPanel`: a searchable list with locate / edit / delete per unit, **Remove all**, and a toggle for the tool. Units draw on their own layer (`unitLayer`, z 31: a diamond in the owner's colour with a type glyph).

Export (`buildUnitsForGame`, `exportPreset.js`) writes them as `world.units` with `source: "scenario"` and `status: "idle"`; the scenario's `world.json` gets them on Save (`applyMapToScenario`), the editor reads them back on open (`mapEditorSeed.units`), and every new game starts with them — `"units"` is in `TEMPLATE_WORLD_OVERRIDE_KEYS` (server and web stores), so a game made from a scenario that has been played still gets the authored formations rather than the played-out ones.

---

## 9c. Combining maps: the region clipboard (`regionClipboard.js`, `ClipboardPanel.jsx`)

Pieces of one map can be pasted into another. **Copy to clipboard** in the selection panel (or Ctrl/⌘+C with regions selected and no text selected) calls `api.exportRegions(ids)` and stores, through `buildClipboardPayload`, the regions as GeoJSON plus everything they need elsewhere: for every country they name as owner or claimant, the source document's registry record, effective colour, flag and tags, and the region types they use. The clipboard is one slot in IndexedDB (`oh-workshop` / `clipboard`), mirrored in a module store the editor reads with `useSyncExternalStore`, so it survives closing the Workshop and switching scenarios: open the built-in map, copy a country, open your own scenario's map, paste.

**Paste into this map** (the Clipboard chip's panel, or Ctrl/⌘+V) first gives the document what it lacks — `planClipboardMerge`: a country the target already knows keeps its record, colour, flag and tags, only the missing ones arrive; missing region types are added — then `api.pasteRegions(fc)` carves and adds: each pasted region takes its land out of whatever already covers it exactly as the Draw tool does (a region beneath keeps what is not covered, a hole or a bite, and is marked `edited`; one covered entirely is removed), then the copies are added, selected and zoomed to. A pasted region keeps its id when the target has no region by that id (a stock-world id keeps its tile linkage; a region the paste removed entirely frees its id for its replacement), otherwise it gets a fresh `reg_` id; it is always marked `edited`. The whole paste is one undo step, and the panel reports what happened ("12 regions · 3 underneath trimmed · 1 replaced entirely"). Cities and units are not copied. Tests: `regionClipboard.test.js`.

---

## 10. Owner-name handling (names, not codes)

This is the single most important invariant and the source of most historical bugs.

**A region's `owner` is the owning country's DISPLAY NAME** ("Russia", "Roman Empire"), not a GADM code. So are the keys of `colorOverrides`, `flags`, and `tags`. The region **id** stays a GADM identifier (`DEU.2_1`) or an editor id (`reg_…`) and is the thing tier detection tests — it does **not** move with owner renames (`isGid1`, `exportPreset.js:21`).

Where names come from and stay clean:

1. **Seed load** (`regionImport.js:68`) — each stock region's owner is resolved from its `gid0` through `COUNTRY_NAMES` (`gid0 → name`), **not** the seed's own `country` string (which disagrees: "México" vs "Mexico", truncated names). The seed's `country` is unset after resolution so a second copy can't drift.
2. **Paint / inspector** — owner text is trimmed but the STORED key is **never case-folded** (`OlMap.jsx`, `SelectionInspector.jsx`). The inspector's lookup of an existing polity is case-insensitive (it stores that polity's own key, not the typed spelling); a genuinely new name is stored exactly as typed.
3. **Legacy documents** — `migrateDocumentOwners` (§23) rekeys code→name on open.

**Export polity logic** (`exportPreset.js:184`): `STOCK_COUNTRY_NAMES = new Set(Object.values(COUNTRY_NAMES))`. For each owner:
- If the stock world already knows the name (`STOCK_COUNTRY_NAMES.has(owner)`) → no polity entry needed; the game names/colours/flags it itself.
- Otherwise → emit a `polityOverrides[owner]` entry so the game and the model learn the country exists at all.
- **Verbatim flag**: if the invented name *collides with a real GADM code* (`COUNTRY_NAMES[owner]` truthy — e.g. a map-maker literally names a country `"USA"`), the entry gets `verbatim: true` so the server's `resolveOwnerName` (`server/ownerMigration.js`) keeps it literal instead of canonicalising `"USA" → "United States"`. A plain invented name ("Freedonia") needs no flag — it already resolves to itself.

Colours priority in the seed (`:181`): `colorOverrides[owner]` (a human's chosen colour, wins) → `palette[owner]` → `codeToColor(owner)` (deterministic hash, mirrors the game's fallback).

---

## 11. Region colours & disputed striping (`olStyle.js`)

One style function for all regions, memoised per `typeId|owner|selected|zoomBand|claimants` (`makeRegionStyle`, `:102`). Fill = `type.overrideColor` → owner colour (`palette[owner] || codeToColor(owner)`) → neutral gray. Alpha switches on owned vs unowned; a selected region gets +0.22 alpha, an accent stroke, and zIndex 999. The palette-swap guard clears the cache when the palette identity changes (so a scenario's `colors.json` arriving late doesn't leave stale fills).

**Disputed regions** with claimants get a diagonally striped `CanvasPattern` (`makeStripePattern`, `:48`): administrator colour first, then each deduped claimant, `(x+y) mod period` bands. Requires ≥2 distinct colours.

---

## 12. Flags (`FlagPicker.jsx`)

A full-screen overlay (community-hub purple, not editor blue) mounted at `MapEditor`'s root — **not** inside the inspector, because the panel's `backdrop-filter` makes a containing block that would trap a `position:fixed` overlay (`FlagPicker.jsx:31`). Opened via `flagPickerFor` state, wired to `d.setFlag(flagPickerFor, value)`.

Tabs:
- **In the game** — *Already on this map* (flags already placed → reuse), *My flags* (saved to the library, reusable across maps), and *Built-in flags* (`listBuiltInFlags()`).
- **Community** — fetched via the hub proxy; a single flag installs as a data URL, a scenario **flag pack** (`fromScenario`) installs wholesale into My flags (dedup by content hash).

Upload (`fileToFlagDataUrl`, `FLAG_ACCEPT`) saves to the library first, then applies. **Remove** re-selects the standard code-derived flag (`pick(null)`). Values stored in `doc.flags` are downscaled PNG data URLs.

---

## 13. Basemaps & custom backgrounds

### Built-in basemaps (`basemaps.js`)
Ten token-free ESRI/ArcGIS presets (`EDITOR_BASEMAPS`): `ocean` (default), `imagery`, `streets`, `topo`, `terrain`, `shaded`, `natgeo`, `physical`, `light-gray`, `dark-gray`. XYZ template via `esriXyzUrl(service)`; picker previews use the z0 whole-world tile (`esriPreviewUrl`).

### Custom backgrounds (`customBackground.js`, `BasemapPicker.jsx`)
Uploaded via the **Basemap: …** button (bottom bar) → `BasemapPicker` overlay ("Built-in maps" / "Your basemaps" / Community). `loadBackgroundFile` dispatches by extension (`BACKGROUND_ACCEPT`):

| Format | Result kind | Persisted? |
|---|---|---|
| `.geojson`/`.json` | `vector` (outline, or biome fill if features carry `fill`) | yes (GeoJSON) |
| `.kml` / `.kmz` | `vector` | yes |
| `.shp` / `.zip` | `vector` (via `shpjs`, dynamic import) | yes |
| `.tif`/`.tiff` (GeoTIFF) | `raster` (WebGL) | **no** (session reference only) |
| `.pmtiles` | `raster` | **no** |
| `.png`/`.jpg`/`.svg` | `image` (data URL, stretched across the world) | yes |

Heavy parsers (`shpjs`, `jszip`) are dynamically imported so they only load on demand. Persistable backgrounds (`vector`/`image`) are saved into `doc.metadata.customBackground` and rebuilt on open via `rebuildPersistedBackground(saved, {persisted})` — the `persisted` flag stops a restored background from re-dirtying the doc on load. In the game, a custom background **replaces Earth** and forces `world.customRegions` on (so the stock political overlay is hidden).

---

## 14. Reference image / tracing aid (`ReferencePanel.jsx` + OlMap ref-image effects)

A semi-transparent image above the region fills (z40) that a map-maker aligns a source map to and traces over. Upload → placed at 60% of the view width; **Opacity**, **Visible**, **Center on view**, **Remove**. While the Reference panel is open, a dashed frame with corner handles appears (z41) — drag inside to move, drag a corner to resize (free aspect). **Session-only**: it lives entirely in component state (`refImage`) and a ref (`refImageExtentRef`), never saved to the document and never exported (`MapEditor.jsx:63`, `OlMap.jsx:1089`).

---

## 15. Fantasy Map Generator (`fmg/`)

A right-edge **🗺 GENERATE** drawer (`FmgPanel.jsx`) with inputs: seed, landmass template (`continents`/`archipelago`/`pangea`/…), detail (points), countries, cultures, cities, and "regions from provinces". **Generate** calls `generateFromFmg` (`MapEditor.jsx:123`), which runs Azgaar's Fantasy Map Generator headlessly (`fmgDriver.js`, vendored FMG at `/fmg`) and converts the result via `fmgToEditorSeed`. The import: `api.loadRegions(seed.regions)`, cities → `doc.features`, `mergeColors(seed.colors)`, and the biome basemap saved as a vector custom background (also added to "Your basemaps"). Marks the doc dirty and fits the view.

---

## 16. Geometry operations (`geometry.js`)

Boolean ops run directly on OL geometries in EPSG:3857 via `polygon-clipping` (no reprojection round-trip):

| Fn | Use |
|---|---|
| `unionGeoms(geoms)` | Merge / dissolve. |
| `subtractFrom(target, cutter)` | Draw-carve (returns survivor, `null` if swallowed whole, or unchanged if disjoint). Drawing inside leaves a hole (interior ring). |
| `overlaps(a, b)` | Cheap intersection guard so draw only rewrites genuinely-overlapping neighbours. |
| `splitByLine(olGeom, line)` | Buffer a drawn line into a thin cutter, subtract, group fragments onto the two sides, union each → `[{geom,area},…]` largest first. |
| `translatedClone(g, dx, dy)` | Copy/paste offset. |

---

## 17. Persistence (`documentIO.js`, save flow)

Server REST at `/api/mapeditor/documents` (web build routes through `runtime/web/editorStore.js`): `GET` list, `GET /:id`, `POST` create, `PUT /:id` update, `DELETE /:id`. `downloadJson` writes a local `.json`.

`buildDocumentFields()` (`MapEditor.jsx`) is a **strict whitelist** — `name, metadata, types, features, colorOverrides, flags, tags, polities, ownerSchema`. **Anything not named here is silently dropped on save**; a new document field appears to work until the first reload. `buildPayload(regions?)` adds the map to it, for an export or a full save.

**A save carries only the regions that moved.** The autosave runs every 2 seconds while the document is dirty, and it used to write the whole world each time — 5.5 MB of JSON on the shipped map, an ~83 MB string on the z9 seed, whether or not a polygon had moved. Now `api.serializeRegionChanges()` writes each region on its own, stamps it (`src/Editor/regionChanges.js`) and compares the stamp with what the last save wrote, so an autosave after a rename sends nothing at all and one after redrawing a border sends that border. Nothing asks a tool to declare what it touched: the comparison is against the geometry itself, so an edit cannot be missed however it was made.

- The payload is then `regionsDelta: { changed, removed, count }` instead of `regions`, applied by `server/regionDelta.js` — shared by the desktop store (`server/mapEditorStore.js`) and the website's IndexedDB one (`src/runtime/web/editorStore.js`).
- A difference that does not add up — `count` disagreeing with the merge, a region with no id, a document whose geometry the store does not have — is **refused whole**, the stored map is left exactly as it was, and the store answers `needsFullRegions`; `saveNow` then immediately writes the whole map. A half-applied difference would be a map the author silently loses; one extra full save is not.
- The whole map travels anyway on the first save after a document is opened, loaded or reseeded (the record of stamps is empty), on create, and when any region has no id to key it by.
- The stamps are committed only once the save has landed, so a failed save is retried with the same contents.

Save robustness:
- **Debounced autosave** every 2s while `dirty`, keyed on `d.doc` (a fresh object per change) rather than a hand-listed field set — the old field list went stale and silently lost colour/flag/tag edits (`:289`).
- **`beforeunload`** guard while `dirty`/`saving` (`:304`).
- **`visibilitychange`/`pagehide` flush** via refs (avoids stale-closure loss on mobile suspend) (`:320`).
- **Close** tries to save first and only prompts if the save fails (`:508`).

---

## 18. Exporting to a game seed (`exportPreset.js` → `buildGameSeed`)

`buildGameSeed(doc, regionsFC, palette, {playerCountry})` (`:156`) is called for **Export for game** (download) and **Apply & Play**. Steps:

1. Walk regions → build `regionOwnershipOverrides = {regionId: ownerName}`, collect owners, count custom-id regions.
2. `detectCustomGeometry(regionsFC, kind)` (`:87`) → **tier 2** if `kind==="blank"`, or any region has a non-GADM id (`reg_…`), `mergedFrom`, or `edited`. Otherwise **tier 1**.
3. `normalizeRegionsForGame` (`:43`) → rebuild an FC whose **properties** (MapLibre reads `["get","id"]`) carry `id, owner, gid0, name, typeId`, plus `claimants` and `edited` when present. Feature id is kept in properties only (a non-integer top-level id spams warnings).
4. Build `colors`, `polityOverrides` (§10), cities (`buildCitiesForGame`), and background descriptor + heavy payload (`buildBackgroundForGame`).

### Seed shape (return value)

| Key | Contents |
|---|---|
| `name`, `kind`, `author`, `credit` | Identity. |
| `hasCustomGeometry` | Tier flag. |
| `stats` | `{ ownedRegions, owners, customGeometry }`. |
| `world.regionOwnershipOverrides` | `{regionId: ownerName}`. |
| `world.polityOverrides` | `{name:{name,aliases:[],color:'#hex',note:'',verbatim?}}`. |
| `world.units` | Starting units (`buildUnitsForGame`, §9b), `[]` when none. |
| `world.customRegions` | `hasCustomGeometry \|\| Boolean(background)`. |
| `world.background` / `world.basemap` | Light background descriptor / chosen ESRI basemap id. |
| `world.customCities` | `true` if authored cities exist or geometry is custom. |
| `world.author`, `mapCredit`, `simulationRules`, `startingTimelineText` | Metadata. |
| `colors` | `{ ...palette, ...colors, ...overrides }` — full palette so tier-1 keeps every stock country's colour. |
| `game` | `{ country, startDate, gameDate }`. |
| `flags` / `tags` | The doc's, or **`null`** when empty (null means "don't touch the scenario's file"). |
| `regions` | Normalized game-ready FC (uploaded only when tier 2). |
| `cities` | Authored `cities.geojson`. |
| `backgroundData` | Heavy `{dataUrl}` / `{geojson}`, or `null`. |

**Tier 1 vs tier 2 recap:** tier 1 = re-ownership only → the game renders shapes from `regions.pmtiles` and needs just `world.json` (`regionOwnershipOverrides`+`polityOverrides`) + `colors.json` (like the bundled WWII/Medieval presets). Tier 2 = new/split/merged/reshaped geometry → the exported `regions.geojson` carries the shapes and `world.customRegions` tells the game to render from the GeoJSON layer (`src/Game/Map/Nations.jsx`).

---

## 19. How edits reach the game — Save / Save & Exit / Apply & Play (`libraryBar.jsx` `applyMapToScenario`)

In embedded mode, **▶ Apply & Play** calls `onApplyToScenario(seed)` (`MapEditor.jsx:198`), which runs `applyMapToScenario(scenario, seed)` (`libraryBar.jsx:1754`). It writes `world`/`game` via `saveScenario` (merging over the current world; sets `ownerCodes` for the start-country picker, `customRegions:true`) then uploads each seed piece as a scenario asset:

| Seed field | Scenario asset | Empty behaviour |
|---|---|---|
| `colors` | `colors` | always written |
| `flags` | `flags` | `clearScenarioAsset` when null |
| `tags` | `tags` | `clearScenarioAsset` when null |
| `regions` | `regionsGeojson` | always written |
| `cities` | `citiesGeojson` | always written |
| `backgroundData` | `backgroundData` | `clearScenarioAsset` when null |

The `null`-means-clear contract is why hydration (§20) must reload the scenario's existing flags/tags/background — otherwise a round-trip that "loaded none" would clear the author's work. Finally it creates + activates a fresh game so the running map reflects the edit.

---

## 20. Opening a scenario's current map (hydration)

When the editor opens from a scenario, `onOpenMapEditor` (`libraryBar.jsx:2511`) fetches the scenario's `regionsGeojson`, `citiesGeojson`, `colors`, `flags`, `tags`, and (if any) `backgroundData`, assembling `mapEditorSeed` = `{ name, author, ownershipOverrides, regions, cities, colors, flags, tags, background, basemap }`. `MapEditor`'s hydrate effect (`:339`, runs once) builds the base document, restores flags/tags/background/basemap, maps cities → features, then:
- `api.loadRegions(initialMap.regions)` if the scenario has custom geometry, **else** `api.reseedWorldWithOwners(initialMap.ownershipOverrides)` (stock world + overrides = its tier-1 map).

`scenarioMode` forces `seedKind="deferred"` so `OlMap` doesn't auto-seed the default world under the scenario's map.

---

## 21. Document migration (`documentMigration.js`)

`migrateDocumentOwners(doc)` runs on every **open** (`MapEditor.openDoc`, `:245`). A doc is legacy while `ownerSchema < OWNER_SCHEMA`. Migration rekeys `colorOverrides`/`flags`/`tags` and every region `owner` from GADM code → name via `COUNTRY_NAMES` (`rekeyOwnerMap`), strips region `country`, and stamps `ownerSchema = OWNER_SCHEMA`. It lives in the editor (not the store) because a document is the one path where legacy owners can enter a scenario already wearing a "migrated" badge (an applied doc inherits the target's `ownerSchema`, so the store's migration would never run). No-op once migrated — safe to call every open.

---

## 22. Standalone editor repo & mirroring note

The editor was split into a standalone repo (`Open-Historia/open-historia-map-editor`), but the game still **embeds its own copy** under `src/Editor/`. Edits to editor source generally need mirroring to both. Copying whole files wholesale between the two drifts app-only wiring (e.g. the game-embed props); prefer targeted edits. The FMG generator is vendored at `/fmg` (Azgaar v1.109).

---

## 23. Gotchas & invariants (quick reference)

- **Owner is the polity's NAME, everywhere, and a rename re-keys it.** Never re-introduce a code path or case-fold stored owner text (`OlMap.jsx`, `SelectionInspector.jsx`). Matching typed text to an EXISTING key case-insensitively is a lookup, not a fold — the key stored is the registry's. Changing a name goes through `renamePolity` (`MapEditor.jsx`), never through editing the record's `name` alone.
- **`buildPayload` is a whitelist** — a new doc field that isn't listed silently fails to persist (`MapEditor.jsx:180`).
- **`edited`/`mergedFrom`/non-GADM id ⇒ tier 2.** These are the only signals that ship geometry (`exportPreset.js:87`).
- **`flags`/`tags`/`background` null = "clear the scenario asset."** Always re-hydrate them on open so a round-trip is a no-op (`MapEditor.jsx:352`, `libraryBar.jsx:2525`).
- **`wrapX:false` + `VectorImageLayer`** are correctness+performance load-bearing; don't revert (`OlMap.jsx:232`,`:250`).
- **Reference image is session-only** — never let it into saves or exports (`MapEditor.jsx:63`).
- **Render-path changes must be verified by booting the app** — build+grep proves nothing (see the runtime-verification memory).
- Region geometry is verified in-app; a headless WebGL context can't pixel-check the game map.

Related: [World state](world-state.md) (`world.json` fields the seed writes — `regionOwnershipOverrides`, `polityOverrides`, `customRegions`, `countryTags`).

## 24. Scenario Workshop: polities, topology, province import

Ported from kernely's Continuum branch. The editor's document gained an explicit **polity registry** (`doc.polities`, keyed by the STABLE polity identity; `name` is presentation) and three panels reached from the bottom bar.

| Panel / tool | File | What it does |
|---|---|---|
| **Countries** (`Countries: N` chip) | `PolitiesPanel.jsx` | The map's countries (polities): every owner and claimant on the map, and every country registered in the document whether or not it holds a region — a registered country stays until it is removed, and `buildGameSeed` ships it to the game with or without land (a government in exile, a nation registered before it is painted). Clicking a country selects its whole territory and zooms to it; under its name a **Regions** list names each region it owns (click one to select and zoom to it). **Create country** registers a name at once — with a selection it takes those regions, otherwise it waits, landless, for the paint tool or **Assign selected**. **Rename** (a country is keyed by its name, so a rename re-keys it everywhere in one undo step — regions and claims via `OlMap.renameOwner`, the record, colour, flag, tags and city markers via `renamePolityInDocument` in `server/polityRename.js`; the old name is kept as a former name), recolour, tag, flag, transfer all territory from another country, and **Remove from the map** (its regions become unowned, claims in its name are dropped, the record goes with its colour, flag and tags — the only way a registered country leaves). "Fill standard flags" copies the built-in flag for recognised stock countries. Bulk import a roster (`importPolityRoster`). "Paint this polity" hands the country to the paint tool. |
| **Topology** chip | `TopologyPanel.jsx` + `geometry.js` (`planarGeometryArea`, `intersectionGeom`, `unionAllGeoms`, `enclosedGapGeoms` / `enclosedGapsOfUnion`, `overlapGeoms`) | Finds slivers, overlaps and enclosed gaps between the selected regions and repairs them; the map highlights diagnostics (`topologyDiagnosticStyle`). The same pass runs over the whole map on every scenario save (see **Saving**). |
| **Import Map** chip | `ProvinceImportPanel.jsx` + `provinceRasterWorker.js` | Turns a colour-coded province raster (a HOI4-style `provinces.bmp`, any PNG) into regions in a worker, entirely in the browser; optional definition CSV / GeoJSON metadata assign polities, names and city markers (`importCityMarkers`); a GeoJSON backup of the current regions and cities is downloaded first. Colours are never assigned by feature order — ambiguous sources are refused. |
| **Paint** tool | `OlMap.jsx`, `MapEditor.jsx` | Paints a stable polity key by click or drag (one stroke = one undo), with a "paint over" filter (any region / unowned only / only regions of one polity); the picker lists registry polities by display name. |
| **Edit vertices** / **Shared border precision** | `OlMap.jsx` (`weldPointIntoFeature`, `sharedBorderPoint`, `removeSharedVertexNear`) | Vertex editing with snapping and undo; with exactly two neighbouring regions selected, a dragged border vertex or edge is welded into BOTH regions. |
| **Selection inspector** | `SelectionInspector.jsx` | The owner field is free text over the registry: existing polities are suggested and matched by key or display name, and a name nobody has becomes a new polity on Enter or the Create button — never on blur or a keystroke — so a country that does not exist yet can be made from the map without a typo silently minting one. |
| **Basemaps** | `basemaps.js`, `BasemapPicker.jsx`, `OlMap.jsx` | Two dark physical presets (`ocean-dark`, `atlas-relief-dark`) with graded preview cards and a dark editor presentation (`editorOpacity`, `editorBackground`). |

**Saving.** The Workshop has three actions: **Save** (write the map into the scenario and keep editing), **Save & Exit**, and **Apply & Play** (the old flow: save, then create and activate a fresh game). `libraryBar.jsx` `applyMapToScenario(scenario, seed, { play })` replaces the scenario's `polityOverrides` with the Workshop's registry (it hydrated the full registry, landless polities included, so merging would resurrect deleted entries), writes `ownerSchema`, and refreshes the drawer's cached scenario details from the save's response so a later ordinary scenario save cannot write a stale basemap back. A "Scenario unsaved" chip shows while the document has autosaved edits not yet written into the scenario, and closing asks first. All three actions stay disabled (the Save button reads "Loading map…") until the scenario's map has arrived: the Workshop opens empty and its geometry downloads afterwards, and a save in that window used to write an empty map over the scenario — the first click wiped it, the second, once the map had appeared, wrote it back. `applyMapToScenario` also refuses an empty map for a scenario that has territory.

**Border cleanup on save.** All three actions first run the Topology panel's conservative repair over **every region at 500 m** (`repairTopologyEverywhere` in `OlMap.jsx`; the pure parts — chunk grid, progress wording — in `topologySweep.js`): enclosed cracks are filled into the neighbour they touch most, thin overlaps are trimmed from the smaller region, as one Undo step, and only then is the map written. It is not an all-pairs check: overlap discovery asks the map's spatial index for extent neighbours only (the stock 4,848-region world is 14,011 pairs, ~3 s), and the gap search reads the holes of ONE union of every region, built as the union of chunk unions — the same polygon set as a single call (the stock world yields the identical 324 cracks either way), with bounded memory and a repaint between chunks. A per-chunk search was rejected because a crack longer than a chunk (a double-traced border between two large countries) could go unseen. Two measured facts shape the rest: trimming a sliver can expose a hairline between the winner and a third region, so a pass that repaired something is followed by another until one finds nothing (at most three; the stock world is 98 cracks and 57 slivers, then nothing), and the save writes coordinates at five decimals (about a metre), which leaves centimetre slivers along every repaired border on reload — so defects narrower than **2 m** are ignored (`BORDER_CLEANUP.minWidth`; the panel itself keeps its 0 m floor), or every save would move hundreds of regions by centimetres. Repairs are applied in one go (a repaint between them redraws the whole world each time), every crack of one target in a single union. A follow-up pass looks only around the previous pass's repairs (`hotspotsOf` in `topologySweep.js`: the padded footprints of the slivers trimmed and the cracks filled — a repair can only expose something inside its own footprint, and the first pass has seen everything else), so passes two and three cost a fraction of the first. **Time is bounded.** The search stops at `BORDER_CLEANUP.maxMillis` (60 s), or when the player presses **Save now** on the screen (offered after ten seconds); what it has found by then is applied (until `maxApplyMillis`, 90 s) and the note says the check stopped and why. An error inside a phase (polygon-clipping's precision refusals, which a detailed map can hit on a follow-up pass) ends the search the same way and keeps the repairs already made, instead of throwing the cleanup away. **Each pair check and each trim is local.** `geometry.js` clips both inputs to the box their extents share before polygon-clipping sees them (Sutherland–Hodgman against the box; exact — the same pieces and areas, pinned by `geometry.test.js` on the built-in map's own pairs — and the cost of the neighbourhood rather than of the region), and the crack-target touch score reads a region's boundary from an R-tree instead of walking every segment for every point. Measured in Node: the built-in map's pass 11 s → 4.5 s; the map with its borders drawn eight times finer 103 s → 25 s; a map with a single 41,000-vertex sea zone, which every coastal region is a neighbour of, 914 s → 14 s a pass — the case that held a player's save for forty minutes. The `BorderCleanupOverlay.jsx` screen ("Cleaning up the borders", progress bar, what is being checked, which pass, the seconds so far, Save now) is painted before the work starts so the page never looks frozen, and stays up until the scenario is written; a failure in the pass never blocks the save, and a plain Save leaves a one-line note beside the buttons saying what was fixed — or that the check stopped after so many seconds and what it left for the next save.

**Export.** `buildGameSeed` emits one `polityOverrides` record per registry entry and per owner (code = stable key, display name, cumulative aliases, colour, status, `verbatim` for a code-shaped key) plus `ownerSchema`, and cities export their authored `tier` (1 town, 2 city, 3 major) with `capital` as an independent flag (`CityPopup.jsx`).
