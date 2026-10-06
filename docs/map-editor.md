# Map Editor

The Map Editor is a standalone OpenLayers map-authoring surface (reachable at `/?editor=1`, or embedded from a scenario's library bar) that lets a user re-own, reshape, recolour, and re-populate the world map and export it as a game-playable seed. It runs in its own React tree with its own map instance, deliberately isolated from the game's MapLibre map so the two can never disturb each other (`src/Editor/MapEditor.jsx`). Region *geometry* lives outside React in an OpenLayers vector source and is driven imperatively; everything else (types, cities, colours, flags, tags, metadata) lives in a document-state hook.

The editor writes a game seed in one of two tiers: **tier 1 (re-ownership)** keeps stock GADM region ids so the game renders from the shipped `regions.pmtiles`, and **tier 2 (custom geometry)** ships an exported `regions.geojson` the game renders directly. Understanding that split (`src/Editor/exportPreset.js`) is the key to the whole subsystem.

---

## 1. How the editor is reached (routes / entry points)

| Entry | Where | What it does |
|---|---|---|
| `/?editor=1` | `src/App.jsx` | Standalone mode. `App` reads the URL param once at render and mounts `<MapEditor />` (lazy-loaded) with no props — no `onClose`, no `onApplyToScenario`. Authoring-only; export happens via the Documents menu's download buttons, and an export is this editor's save: each one runs the border cleanup first (§24, **Border cleanup on save**). |
| Scenario "Edit map" button | `src/Game/GameUI/libraryBar.jsx` (`onOpenMapEditor`) | Embedded mode. Sets `mapEditorScenario`, opens the editor, and streams the scenario's current map assets into `mapEditorSeed`. |
| Embedded `<MapEditor>` mount | `src/Game/GameUI/libraryBar.jsx` | Passes `onClose`, `scenarioName`, `initialMap={mapEditorSeed}`, and `onApplyToScenario`. Presence of `onApplyToScenario` is what flips the editor into "scenario mode". |

`MapEditor`'s prop contract (`src/Editor/MapEditor.jsx`):

| Prop | Meaning |
|---|---|
| `onClose` | Present in embedded mode → renders the top-right **✕ Close** button. |
| `scenarioName` | Label shown in the Apply button tooltip. |
| `onApplyToScenario(seed)` | Callback that writes the built game seed into the scenario. Its presence sets `scenarioMode = true`, which forces `seedKind="deferred"` so the default world is **not** auto-seeded underneath the scenario's own map. |
| `initialMap` | The scenario's current map (regions/owners/cities/palette/flags/tags/background/basemap), hydrated once it arrives. |
| `review` | `{ suggestion, decisions, onSaved(decisions) }`: a suggestion's map changes to review in this map (§25). The **Suggested changes** panel opens once the map has loaded, the bottom bar gains a **Suggested changes: N** chip, and `onSaved` is called after each save with the decisions. |

---

## 2. File map (`src/Editor/`)

| File | Role |
|---|---|
| `MapEditor.jsx` | Root component. Composes the map + toolbar + panels + inspector + bottom bar; owns cross-cutting state (open panel, paint owner, doc id, save flow, custom background, FMG). |
| `OlMap.jsx` | The OpenLayers surface. Owns the region source/layers, all editing interactions, click-selection, undo/redo, and the imperative region API exposed via `onReady`. |
| `useMapDocument.js` | Document state hook: metadata, types, features (cities), colorOverrides, flags, tags + all setters + ephemeral UI state. Region geometry is **not** here. |
| `Toolbar.jsx` | Top tool strip (single-choice tool + undo/redo/fit). |
| `BottomBar.jsx` | Status bar: counts (open managers), Layers/Reference buttons, basemap picker, map name, save-status dot, search box. On a phone (`isMobile`) the chips fold into one **Panels** menu that opens upward (Back closes it), the basemap button and the status keep only their icon and dot, and the map name moves into the Documents menu (`DocumentsMenu.jsx`). |
| `SelectionInspector.jsx` | Right panel for the current region selection: name/type/country/disputed-by/colour/flag/tags + merge/copy/zoom/delete. |
| `TypeManager.jsx` | Region "type" editor (render + gameplay settings). |
| `RegionsPanel.jsx` | Searchable region list → select + zoom. Matches and shows the owner's display name (`regionSearch.js`). |
| `FeatureManager.jsx` | City/point-feature list; bulk import from the seed, or from the author's own file (`featureImport.js`). |
| `CityPopup.jsx` | Inline city editor anchored at the click. |
| `SearchBar.jsx` | Unified place search (this map's cities, regions, ~70k world places). |
| `LayersPanel.jsx` | Visibility toggles for regions, region labels, group outlines, cities and map features, and starting units. Reads each toggle's state from the map when it opens. |
| `ReferencePanel.jsx` | Tracing-image upload/opacity/placement (session-only). |
| `BasemapPicker.jsx` | Overlay to choose a built-in ESRI basemap, a saved basemap, upload, or a community one. Its header wraps on a phone, where Upload is an icon, like `FlagPicker`'s. Deleting a saved basemap asks first and says when it fails; a map keeps its own copy in `doc.metadata.customBackground`. |
| `FlagPicker.jsx` | Overlay to choose a country flag (My flags / built-in / community). |
| `DocumentsMenu.jsx` | Top-left menu: new/open/save/export-JSON/export-for-game + author field. In the standalone editor the two exports run the border cleanup first (§24). Deleting a saved map asks first, says when the delete fails, and is disabled for the map that is open (the saves kept writing to the deleted id, and every one failed). |
| `exportPreset.js` | `buildGameSeed` + tier detection + region normalization + verbatim-polity logic. |
| `regionImport.js` | Loads `regions-seed.geojson` into the OL source; resolves owner NAMEs from `gid0`. |
| `documentMigration.js` | Brings a legacy code-keyed document forward to name-keyed on open. |
| `documentIO.js` | REST client for `/api/mapeditor/documents` + local JSON download. |
| `customBackground.js` | Loads uploaded backgrounds (GeoJSON/KML/KMZ/SHP/GeoTIFF/PMTiles/image) into OL layers; persistence helpers. |
| `geometry.js` | Polygon boolean ops (union/difference/intersection), translate. |
| `olStyle.js` | Region → OL `Style` mapping (owner colour, opacity, stroke, disputed striping). |
| `basemaps.js` | ESRI basemap presets + XYZ/preview URL builders. |
| `editorStyles.js` | Shared chrome styling constants (`panelSurface`, `inputStyle`, `ACCENT`, `pillButton`, `toolButton`). |
| `fields.jsx` | Form-field primitives (`Row`, `TextField`, `NumberField`, `ColorField`, `Toggle`, `SelectField`, `TagField`) + hex/rgb helpers. |
| `fmg/FmgPanel.jsx`, `fmg/fmgDriver.js`, `fmg/fmgImport.js` | Fantasy Map Generator drawer, headless Azgaar runner, result→editor-seed converter. |
| `flagImage.js`, `citiesImport.js` | Flag downscaling; seed-city import + search. |
| `SuggestionReviewPanel.jsx`, `suggestionReview.js` | Reviewing a suggestion's map changes (§25): the review's state (`useSuggestionReview`), the markup layer (`useSuggestionMarkup`), the panel; and the pure half — each change's status against the open map, its dependencies, applying it (with an undo), accepting a list in order (`acceptMapChanges`), what a save records (`decisionsFor`), and what to mark on the map. |

---

## 3. Architecture & data flow

Two stores, split by weight (`src/Editor/useMapDocument.js`):

- **Document state** (React, in `useMapDocument`) — metadata, region `types`, point `features` (cities), `colorOverrides`, `flags`, `tags`. Cheap, serialisable, the source of truth for everything except geometry.
- **Region geometry** (OpenLayers `VectorSource`, in `OlMap`) — ~3,662 filled/stroked polygons, far too heavy for React state. Materialised into the document only on **save/export** via `api.serializeRegions()`.

`MapEditor` receives the imperative region API through `OlMap`'s `onReady={setApi}` callback (`src/Editor/MapEditor.jsx`). Panels never touch the map directly; they call `api.*` methods, which mutate OL features and call `layer.changed()` to restyle. Region mutations fire `onRegionsChanged` → `setSaveStatus("dirty")` → debounced autosave. A whole map being loaded (`loadRegions`, `reseedWorld`, `reseedWorldWithOwners`) fires it with `{ loaded: true }`, which is not an edit and does not dirty the document.

```
DocumentsMenu / BottomBar ─┐
SelectionInspector ────────┤   props (colors, types, selection…)
TypeManager / Features … ──┼──► MapEditor ──► OlMap  ──► OL VectorSource (geometry)
                           │        │  ▲            (api.* imperative calls)
                           └────────┘  └── onReady(api), onSelectionChange, onRegionsChanged
```

---

## 4. Document model (`useMapDocument.js`)

`createDocument()` shape:

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

The hook exposes a derived `colors` = `{ ...fetchedPalette, ...colorOverrides }` so an edited colour paints immediately exactly as it will in-game; `basePalette` is the fetched palette alone (`/assets/colors.json`) so the UI can offer a **Reset** when an override exists. `mergeColors(extra)` layers a scenario's own polity colours on top. The stock palette's fetch merges **under** what is already there (`setColors((current) => ({ ...fetched, ...current }))`). Hydration can merge the scenario's colours before that fetch lands, and a fetch that replaced them used to wipe them: the next save then wrote generated colours over every country the author had coloured.

Setters (all set `saveStatus="dirty"`):

| Setter | Guard |
|---|---|
| `setColorOverride(country, rgb)` | `null` rgb deletes the key. |
| `setFlag(country, dataUrl)` | `null` deletes. Value is an already-downscaled PNG data URL. |
| `setTags(country, list)` | Uses `.length` (not truthiness) so an empty `[]` deletes rather than persisting `[]` for every touched country. |
| `setTypes`, `setFeatures`, `setUnits` | Accept updater fn or value. |
| `patchMetadata` / `setBasemap` / `setName` / `setAuthor` | Metadata patches. |

`saveStatus` ∈ `saved | dirty | saving | error`; `counts` = `{ regions, features, units, types }`.

---

## 5. The OpenLayers surface (`OlMap.jsx`)

Created once in a `[]`-dep effect and driven through refs so it survives React re-renders. Props flow in through refs (`typesByIdRef`, `colorsRef`, `selectedIdsRef`, `activeToolRef`, `paintOwnerRef`, …) so the map stays valid without recreating.

### Layers (z-index ladder)

| Layer | Type | zIndex | Source / notes |
|---|---|---|---|
| Base basemap | `TileLayer` (XYZ ESRI / OSM) | 0 | Swapped by `basemap` prop; **not created** while a custom image/vector background is active. |
| Custom background | vector/raster `VectorLayer`/`WebGLTileLayer`/`TileLayer`, or image `ImageLayer`(`ImageStatic`) | 5 | Uploaded map; image is stretched across the whole world extent (`WORLD_EXTENT_3857`). |
| Regions | `VectorImageLayer` | 10 | `regionSource`, `imageRatio:2`, `wrapX:false`; style = `makeRegionStyle(...)`. |
| Region labels | `VectorLayer` (declutter) | 20 | Same source; `minZoom:4`; label per named region unless `type.includedInLabels === false`. |
| Cities / points | `VectorLayer` (declutter) | 30 | `pointSource`; zoom+prominence gated so ~70k cities never all render. |
| Reference image | `ImageLayer` | 40 | Tracing aid (session only). |
| Reference frame | `VectorLayer` | 41 | Dashed outline + corner handles while the Reference panel is open. |
| Suggestion review markup | `VectorLayer` (`name: "suggestion-review"`) | 57 | Only while a suggestion is reviewed (§25). |

**Two performance-critical choices** (both explained in comments in `OlMap.jsx`): `wrapX:false` on the source/layers (stops OL redrawing the world sideways *and* fixes ±180° editing), and `VectorImageLayer` for regions (rasterise-once/re-blit instead of re-rasterising thousands of paths per frame). Serialisation uses `writeFeaturesObject` (not `JSON.parse(writeFeatures(...))`) to avoid building an ~83MB string on every 2s autosave.

### Click handling (`map.on("singleclick")`)

Only these tools consume a click: `select`, `delete`, `paint`, `feature`, `dissolve`. `map.forEachFeatureAtPixel` hit-tests the region layer (tolerance 2). Ctrl/Cmd/Shift = additive selection. Double-click with Select selects the **whole country** (all regions sharing the owner) and returns `false` to suppress OL's DoubleClickZoom.

### The imperative region API (returned by `onReady`)

This is the surface every panel drives. Each mutating call pushes an undo/redo command onto an 80-entry stack (`pushCmd`) and calls `notifyRegions()` (→ dirty).

| Method | Purpose |
|---|---|
| `map`, `regionSource`, `regionLayer`, `labelLayer` | Raw OL handles. |
| `fitToData()` | Fit view to all regions. |
| `zoomToRegion(id)` / `zoomToSelection(ids)` | Fit to one/many. |
| `setRegionAttrs(ids, patch)` | Patch `owner` / `typeId` / `name` / `claimants` on many regions at once, undoably. The workhorse behind the inspector. |
| `deleteRegions(ids)` | Remove regions. |
| `mergeRegions(ids)` | Union ≥2 regions into the first, which is marked `edited`; others removed. One undo step that also restores the survivor's `edited` flag (`mergeRegionFeatures`, `shapeEdits.js`). |
| `copyRegions(ids)` | Duplicate with a view-scaled offset; new ids, `" copy"` name, carries typeId/owner/gid0/claimants. |
| `exportRegions(ids)` | The regions as a GeoJSON FC (EPSG:4326, 5 decimals, ids in the properties) for the region clipboard (§9c). |
| `pasteRegions(fc)` | Adds regions copied from another map, carving each one's land out of whatever already covers it (`overlaps` + `subtractFrom`, the Draw tool's rule: a bite, a hole, or the region beneath removed, survivors marked `edited`). A pasted region keeps its id when the target has none by that id, else gets a fresh `reg_` id, and is always marked `edited`. Selects the pasted regions; returns `{ added, trimmed, removed }`; one undo step. |
| `getRegionSummary(id)` | `{ id, name, owner, typeId, country, claimants }`. |
| `listOwners()` | Sorted unique owner names — backs the Country field's suggestions so re-owning offers existing names (avoids near-miss forks). |
| `queryRegions(text, limit=200, { polities })` | Search id/name/owner key, and with `polities` the owner's display name and aliases (`regionSearch.js`), so a code-keyed roster polity is found by its name. |
| `countByType()` | Region count per typeId (Type Manager usage). |
| `setLayerVisibility(key, visible)`, `getLayerVisibility(key)` | `regions` \| `labels` \| `groups` \| `features` (cities and map features) \| `units`. |
| `locateFeature(coord)` | Fly to a lon/lat. |
| `serializeRegions()` | Region geometry → GeoJSON FC (EPSG:4326, 5 decimals). Used on save/export. |
| `loadRegions(fc)` | Replace the source from a FeatureCollection (ids pulled from `properties.id`). |
| `applyRegionPatch({ upsert, remove, withAttributes })` | Puts in regions (GeoJSON features in EPSG:4326) and takes others out, as **one** undo step. An existing region gets the new geometry, and its attributes too with `withAttributes`. A new one is added marked `edited`. Used when a suggested border change is accepted (§25). |
| `reseedWorld()` | Load the stock world seed fresh. Resolves once it is on the map; a newer load in the meantime wins and the seed is dropped. |
| `reseedWorldWithOwners(overrides)` | Load stock world, then stamp `{regionId: ownerName}` overrides — how a tier-1 scenario opens. Resolves once it is on the map, like `reseedWorld`. |
| `undo()` / `redo()` | Drive the command stack. |
| `pushStep(step)` | Put a document-only step (`{ undo, redo }`, `documentUndo.js`) on the same stack, so Ctrl+Z takes it back in turn with the region operations. The Features panel's deletes use it. |
| `restyle()` | Force `layer.changed()`. |

Every load — `loadRegions`, `reseedWorld`, `reseedWorldWithOwners`, `replaceRegionsFromImport` — empties the undo and redo stacks (their steps hold the previous map's regions) and starts a new load. A world seed still downloading when another load starts is dropped when it arrives, so a slow seed (the standalone editor's first one, or New) never lands on a map opened in the meantime.

Keyboard: **Ctrl/⌘+Z** undo, **Ctrl/⌘+Shift+Z / Ctrl+Y** redo, **Delete/Backspace** removes the selection — all suppressed while typing in an input.

---

## 6. Tools (`Toolbar.jsx` + `OlMap.jsx` interaction effect)

Single-choice; the active tool mounts/unmounts OL interactions in the `[activeTool]` effect (`src/Editor/OlMap.jsx`).

The strip sits in a band between the documents chip and the Save / Apply / Close group (on a phone, the whole window) and wraps into more rows when the band is narrower than the strip; it publishes its bottom edge as the CSS variable `--editor-toolbar-bottom`, which every side panel (`Panel.jsx`) uses as its top, so a wrapped strip never sits under a panel and no tool ever sits under a Save button.

| Tool | id | Interaction / behaviour |
|---|---|---|
| Select | `select` | Click = select region; Ctrl/Shift = additive; double-click = whole country. |
| Lasso select | `lasso` | Freehand `Draw` polygon; on `drawend` selects every region whose interior point falls inside (`selectWithinPolygon`). |
| Pan | `pan` | No interaction added; default map drag. |
| Draw region | `draw` | `Draw` (Polygon, `trace:true`, `traceSource:source`) + `Snap`. Clicking a border traces along it. **On `drawend` the new polygon is carved OUT of every region it overlaps** (`subtractFrom`, R-tree extent query for candidates) so no ground is owned twice; carved neighbours get `edited:true`. Inside → hole; across an edge → bite; fully over → deletes the underlying region. |
| Edit vertices | `modify` | `Modify` on the selected regions only + `Snap` against every region. With nothing selected the tool mounts nothing and its banner asks for a selection. On `modifyend` sets `edited:true` on dragged features. |
| Move | `move` | `Translate` on the region layer. A moved region is marked `edited`, and each move is one undo step (`trackMove`, `shapeEdits.js`); a click that moves nothing records nothing. |
| Delete | `delete` | Click removes a region (a unit, then a city or map feature, under the cursor wins). Every removal is an undo step: `onUnitRemove` / `onFeatureRemove` return the document's undo step (`removeRowStep`, `documentUndo.js`), which puts the row back where it was. |
| Delete border (dissolve) | `dissolve` | Click a region; probes neighbouring pixels for the region across the nearest border and unions the two into one, marking the survivor `edited` (`mergeRegionFeatures`, `shapeEdits.js`). A union that fails says so (saving the map into the scenario repairs its borders, see **Border cleanup on save**; then try again; in the standalone editor the message names the export, which is what repairs them there) instead of doing nothing. |
| Paint owner | `paint` | Click stamps the current **Paint owner** value (a country NAME, trimmed, never case-folded) onto the clicked region. A floating owner input + swatch appears at the top (`MapEditor.jsx`). |
| City tool | `feature` | Click empty map → `onFeatureCreate` (drops a city + opens `CityPopup`); click a city → `onFeatureEdit`. Carries the underlying region's owner/regionId. |
| Unit tool | `unit` | Click empty map → `onUnitCreate` (drops a starting unit owned by the region's owner and opens `UnitPopup`); click a unit → `onUnitEdit`. The Delete tool removes a unit under the cursor. See §9b. |
| Box-select features | `feature-box` | Drag a rectangle (`DragBox`) over cities and features → `onFeatureSelectionChange(ids)`; Shift adds to the selection. Selected features draw a yellow ring, and the Features panel's selection bar tags or deletes them together (§9). |
| Undo / Redo / Fit | — | Toolbar buttons wired to `api.undo/redo/fitToData`. |

The **`edited` flag** is the linchpin of tier-2 correctness, and every tool that changes a region's shape sets it — Draw (the carved neighbours), Edit vertices, Shared border, Move, Merge, Delete border, the save-time border cleanup and Paste — and its undo puts the old flag back (`shapeEdits.test.js`): a reshaped GADM region's true geometry now lives in the exported GeoJSON while the stock tiles still hold its original shape. The exporter carries `edited:true` into the game so `Nations.jsx` renders it from the GeoJSON and excludes it from the stock-tile fill (otherwise the original shape repaints on top, darker — the "edited-region shade" bug).

---

## 7. Editing a region's attributes (`SelectionInspector.jsx`)

Shown whenever ≥1 region is selected. Writes go straight through `api.setRegionAttrs(selection, patch)`, which live-restyles. Fields:

| Field | Applies | Notes |
|---|---|---|
| **Name** (single only) | `{ name }` | The region label. |
| **Type** | `{ typeId }` | `— mixed —` shown when a multi-selection disagrees. |
| **Polity** (owner) | `{ owner: key \| null }` | Free text over the polity registry, backed by a `<datalist>` of existing polities (registry entries plus `listOwners()`), shown by display name. An existing polity is matched by its stable key or display name without regard to case and its key is stored unchanged, so "france" cannot fork a second France. **A name nobody has yet becomes a new polity** — `upsertPolity` writes the same record the Polities panel creates (`name`, `code`, `aliases`, `status`) and the selection is assigned to it — but only on **Enter** or the **Create “…”** button that appears under the field; leaving the field assigns only an existing match, and Escape reverts, so a half-typed name never mints a one-province country by accident. Blanking the field offers **Make unowned**. |
| **Disputed by** (claimants) | `{ claimants }` | `TagField` of claimant names. Any claimant makes the region render **striped** (owner colour + each claimant's), here and in-game. When a multi-selection's lists differ the field shows only the claims every region shares ("mixed" placeholder), and an edit is applied per region against its own list (`claimantEdits.js`; `setRegionAttrs` takes `claimants` as a function of the region's list): an added claimant joins every list, a removed one leaves every list, and the claims only some regions carry are kept. Identical lists are replaced whole. |
| **Controlled by group** | `{ group }` | Which group's area the regions are in (§24b), or none. The group's tint shows on the region at once; **Groups…** opens the Groups panel. |
| **Colour** | `setColorOverride(owner, rgb)` | Only shown with an owner. **Reset** appears when an override exists (`colorOverrides[owner]`). |
| **Flag** | opens `FlagPicker` via `onOpenFlagPicker(owner)` | Renders current flag thumbnail. |
| **Tags** | `setTags(owner, next)` | `TagField` with `TAG_SUGGESTIONS`; free vocabulary. Each `TagField` owns its datalist (`useId()`), so the Tags box never offers the Disputed-by polity names. |

Footer buttons: **Clear country** (`owner:null`), **Merge** (≥2; a union that fails says so and points to the save, which repairs the map's borders, or in the standalone editor to the export), **Duplicate** (`copyRegions`, a copy beside the original on this map), **Copy to clipboard** (§9c), **Zoom**, **Delete**.

Note the owner/colour/flag/tag edits are keyed to the *country name*, so editing one region's colour recolours the whole country everywhere.

---

## 8. Region types (`TypeManager.jsx`)

A "type" carries render + gameplay settings and is referenced by each region's `typeId`. Seeded with `DEFAULT_TYPES` = Land + Coastal (`useMapDocument.js`). Editing a type live-restyles (OlMap restyles on the `types` prop). Type schema:

| Field | Used by | Meaning |
|---|---|---|
| `id`, `name` | — | Identity. |
| `opacity` | `olStyle.js`; game map | Fill alpha for **owned** regions. |
| `unownedOpacity` | `olStyle.js`; game map | Fill alpha for unowned. |
| `zIndex` | `olStyle.js` | Draw order. Workshop only: the game's regions never overlap. |
| `strokeWidth`, `strokeColor`, `strokeOpacity` | `olStyle.js`; game map | Border. |
| `overrideColor` | `olStyle.js`; game map | Force a fixed fill instead of the owner colour (`null` = off). |
| `pathfindingSpeed`, `passable`, `interactable` | the time skip, or the game's unit and structure directors | Rules for moving and placing, told to the AI (below). Tooltips on the rows say what each does. |
| `showToDefaultPrompt` | nothing | The official editor's flag. The game has no reader for it, so the panel does not offer it; a type keeps the value it has. |
| `includedInLabels` | `OlMap` label layer | `false` suppresses the region label. Workshop only: the game labels countries, not regions. |
| `zoomSettings: [{minZoom,maxZoom}]` | `pickZoomBand` (`olStyle.js`); game map | Hides the type outside the zoom band. |

At least one type must always exist (delete is disabled at length 1).

**Types in the game** (`src/runtime/regionTypes.js`). The scenario save writes the document's types into the world as `world.regionTypes` (`buildGameSeed`, `normalizeRegionTypes`), each region keeps its `typeId` in the regions file, and opening the scenario's map in the Workshop again restores them (a scenario saved before this opens with Land and Coastal, as before). Only what differs from the default Land type counts, so a map whose types are left as they come looks and plays exactly as before:
- **The map** (`Nations.jsx`) draws a type's override colour over the owner's, its opacity and unowned opacity as a factor on the game's own fill strength (twice Land's 0.55 fills twice as strongly as a Land region, never above full), its border colour and width over the game's close-zoom province hairline, and hides the fill and border outside its zoom band, counted in Workshop zoom levels (the game's MapLibre zoom plus one). They reach the paint as feature-state beside the owner's colour (`typeFill`, `typeOpacity`, `typeStroke`, `typeStrokeScale`; `regionTypePaint.js`), written only for regions of a type that draws differently, and rewritten when a region changes hands (its opacity follows whether it is owned) or the zoom crosses a band. The province hairline shows only from zoom 4.15, so a type's border does too. During a conquest's colour flood the region shows its owners' colours and returns to its type's once the flood ends.
- **The AI.** A type that is impassable (`passable` off, or speed 0), slower or faster to cross (`pathfindingSpeed`), or out of play (`interactable` off) becomes one line under `[Region types]`, naming up to 12 of its regions from the compact region catalog (`regionTypeRules`), in whichever prompt moves the units and places the structures: the time skip's own while AI requests are being saved (a skip is then one request, and asks no director; `regionTypesBlock`, `gameplay.js`), and the unit and structure directors' otherwise. Either way it rides in a request that is made anyway, and a map without such types adds nothing. The engine does not enforce the rules itself: they are the AI's to follow.

The panel says under its Add row which settings the game draws, and above the three flags that the AI is told them.

---

## 9. Cities / point features

Point features (mostly cities) live in `doc.features`. Feature schema (`citiesImport.js`, `MapEditor.jsx` create paths):

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
- **Feature Manager** (`FeatureManager.jsx`; the bottom bar's **Features: N** chip opens it, and the panel is titled **Map features**, because the bare "Features" is the scenario and game editors' tab of gameplay features and a language pack has one translation per string: [i18n](i18n.md)) — searchable list; per-feature name/symbol/tags, locate, delete, **Delete All** (asks first, naming the count), and **Import major cities** (the primary button: capitals and cities of 500,000 or more) / **All cities…** which pull from `public/assets/cities-seed.json` (~70k, deduped by `name|coord`; the panel says how many were added). **All cities…** asks first when it would add 1,000 or more, with the number it would add and an estimate of the megabytes they add to the map, its saves and the scenario (`estimateJsonBytes`, from a sample). `citiesImport.js` caches the seed only once it has arrived: a failed download (on the web build it comes from `VITE_OH_PMTILES_URL`) is reported in the panel, finds nothing in the search, and is tried again next time (`citiesImport.test.js`). **Import from file…** adds the author's own point features — GeoJSON Point/MultiPoint features (other geometries are counted as skipped), a Workshop document or its `features` array, or a JSON list of rows with lon/lat (`featureImport.js`: names from name/title/city/label, tags from tags/kind/category, a country from country/owner, a city size from `tier`); a row of a Workshop document (it has `coord` and `type: "Coordinate"`) that is a map feature (§9d) keeps its `kind`, state, note, holder, `markerId` and `markerExtra`, so a base or a port comes back as one rather than as a city label, while another file's `kind` stays a tag only; exact duplicates of features already listed are dropped, and the panel reports what was added. **Selection:** every row has a checkbox (Shift-click selects a range), the **Box-select features** tool selects by dragging a rectangle on the map, and the selection bar above the list adds a tag to every selected feature at once, removes one from all of them, deletes them all, or clears the selection. The selection (`featureSelection` in `MapEditor.jsx`) is shared by the map and the panel, so a box drawn on the map ticks the rows and a ticked row rings its marker. **Every delete here is one undo step** — a row's delete, Delete selected and Delete All — on the map's own stack (`api.pushStep`): the autosave still writes the shorter list, and **Ctrl/⌘+Z** or the toolbar's Undo puts the rows back where they were (`removeRowStep` / `removeRowsStep`, `documentUndo.js`; a row whose id came back meanwhile is left as it is). Features include the Map feature tool's bases, ports and landmarks, so those come back too.
- **Search bar** (`SearchBar.jsx`) — unified search over this map's cities, its regions (by name, id, or the owner's key, display name or aliases; a region hit selects the region and zooms to it), and the ~70k world place index; world results get a **＋ Add** button to drop them as a city.

Prominence tier (`exportPreset.js`, `cityTier`): `capital`→4, ≥1M→3, ≥100k→2, else 1. This gates when a city label appears in-game (`Cities.jsx`).

---

## 9d. Map features that are not cities (`mapFeatures.js`, `MarkerPopup.jsx`)

The **Map feature tool** (toolbar, beside the City tool) places a military base, a port, a landmark — the game's structures (`world.markers`), which the AI builds and destroys in play and a scenario can now start with. A map feature is a point feature with a `kind` and no `city` tag: `{ id, name, type: "Coordinate", symbol: "diamond", coord, owner, regionId, tags: ["feature"], kind, status, note, createdAt, markerId?, markerExtra? }`. Clicking the map adds one (held by the region's owner) and opens its popup: name, **Type** (landmark, military HQ, military base, fortress, airfield, port, mine or quarry, oil field, industrial plant, power plant, research facility, embassy, or any typed kind), **Held by**, **State** (the game's marker statuses) and a note the AI reads. On the map it is drawn with the game's glyph for its kind (`getMarkerPresentation`) in its holder's colour. `buildCitiesForGame` leaves it out; `buildMarkersForGame` writes it to `world.markers` with a stable id (`marker-<feature id>`, or the id it came with). Opening a scenario brings its `world.markers` back as map features (`markerToFeature`), each keeping its id and every field the Workshop does not edit, so a save hands them back whole.

**Population by year.** A city's popup has a **Population by year** box (one `year: population` a line, BC negative). Every city import keeps a series it finds — `populationByYear`, rows of `{year, population}`, or Natural Earth's `POP1950`-style fields (`src/runtime/cityPopulation.js` `populationByYearField`) — and the export writes it to the city's `populationByYear` in `cities.geojson`, which the game reads for its date until the AI sets that city's population (game-map.md §8).

## 9b. Starting units (`UnitsPanel.jsx`, `UnitPopup.jsx`)

`doc.units` holds the formations that stand on the map at round one. Place one with the **Unit tool** (click the map: the unit belongs to the region's owner, and `UnitPopup` opens at the click for name, type — `UNIT_TYPES` from `src/runtime/gameState.js` — strength 1..100 (the unit takes a typed value once it is a whole 1..100, so the box can be emptied and retyped), owner, composition and note; click an existing unit to edit it; the Delete tool removes one). The **Units** chip opens `UnitsPanel`: a searchable list with locate / edit / delete per unit, **Remove all**, and a toggle for the tool. Units draw on their own layer (`unitLayer`, z 31: a diamond in the owner's colour with a type glyph).

Export (`buildUnitsForGame`, `exportPreset.js`) writes them as `world.units` with `source: "scenario"` and `status: "idle"`; the scenario's `world.json` gets them on Save (`applyMapToScenario`), the editor reads them back on open (`mapEditorSeed.units`), and every new game starts with them — `"units"` is in `TEMPLATE_WORLD_OVERRIDE_KEYS` (server and web stores), so a game made from a scenario that has been played still gets the authored formations rather than the played-out ones.

---

## 9c. Combining maps: the region clipboard (`regionClipboard.js`, `ClipboardPanel.jsx`)

Pieces of one map can be pasted into another. **Copy to clipboard** in the selection panel (or Ctrl/⌘+C with regions selected and no text selected) calls `api.exportRegions(ids)` and stores, through `buildClipboardPayload`, the regions as GeoJSON plus everything they need elsewhere: for every country they name as owner or claimant, the source document's registry record, effective colour, flag and tags, the region types they use, and the record (what it is, its colour) of every group whose area they are in (`payload.groups`). The clipboard is one slot in IndexedDB (`oh-workshop` / `clipboard`), mirrored in a module store the editor reads with `useSyncExternalStore`, so it survives closing the Workshop and switching scenarios: open the built-in map, copy a country, open your own scenario's map, paste.

**Paste into this map** (the Clipboard chip's panel, or Ctrl/⌘+V) first gives the document what it lacks — `planClipboardMerge`: a country the target already knows keeps its record, colour, flag and tags, only the missing ones arrive; missing region types are added, and so is a group's record where the target has no group by that name in any case (`plan.groups`, applied with `setGroups`) — then `api.pasteRegions(fc)` carves and adds: each pasted region takes its land out of whatever already covers it exactly as the Draw tool does (a region beneath keeps what is not covered, a hole or a bite, and is marked `edited`; one covered entirely is removed), then the copies are added, selected and zoomed to. A pasted region keeps its id when the target has no region by that id (a stock-world id keeps its tile linkage; a region the paste removed entirely frees its id for its replacement), otherwise it gets a fresh `reg_` id (`resolvePastedIds`, one id per pasted region in order, so two with the same id or none still get one each); it is always marked `edited`. The whole paste is one undo step, and the panel reports what happened ("12 regions · 3 underneath trimmed · 1 replaced entirely"). Cities and units are not copied. Tests: `regionClipboard.test.js`.

---

## 10. Owner-name handling (names, not codes)

This is the single most important invariant and the source of most historical bugs.

**A region's `owner` is the owning country's DISPLAY NAME** ("Russia", "Roman Empire"), not a GADM code. So are the keys of `colorOverrides`, `flags`, and `tags`. The region **id** stays a GADM identifier (`DEU.2_1`) or an editor id (`reg_…`) and is the thing tier detection tests — it does **not** move with owner renames (`isGid1`, `exportPreset.js`).

Where names come from and stay clean:

1. **Seed load** (`regionImport.js`) — each stock region's owner is resolved from its `gid0` through `COUNTRY_NAMES` (`gid0 → name`), **not** the seed's own `country` string (which disagrees: "México" vs "Mexico", truncated names). The seed's `country` is unset after resolution so a second copy can't drift.
2. **Paint / inspector** — owner text is trimmed but the STORED key is **never case-folded** (`OlMap.jsx`, `SelectionInspector.jsx`). The inspector's lookup of an existing polity is case-insensitive (it stores that polity's own key, not the typed spelling); a genuinely new name is stored exactly as typed.
3. **Legacy documents** — `migrateDocumentOwners` (§23) rekeys code→name on open.

**Export polity logic** (`exportPreset.js`): `STOCK_COUNTRY_NAMES = new Set(Object.values(COUNTRY_NAMES))`. For each owner:
- If the stock world already knows the name (`STOCK_COUNTRY_NAMES.has(owner)`) → no polity entry needed; the game names/colours/flags it itself.
- Otherwise → emit a `polityOverrides[owner]` entry so the game and the model learn the country exists at all.
- **Verbatim flag**: if the invented name *collides with a real GADM code* (`COUNTRY_NAMES[owner]` truthy — e.g. a map-maker literally names a country `"USA"`), the entry gets `verbatim: true` so the server's `resolveOwnerName` (`server/ownerMigration.js`) keeps it literal instead of canonicalising `"USA" → "United States"`. A plain invented name ("Freedonia") needs no flag — it already resolves to itself.

Colours priority in the seed: `colorOverrides[owner]` (a human's chosen colour, wins) → `palette[owner]` → `codeToColor(owner)` (deterministic hash, mirrors the game's fallback).

---

## 11. Region colours & disputed striping (`olStyle.js`)

One style function for all regions, memoised per `typeId|owner|selected|zoomBand|claimants` (`makeRegionStyle`). Fill = `type.overrideColor` → owner colour (`palette[owner] || codeToColor(owner)`) → neutral gray. Alpha switches on owned vs unowned; a selected region gets +0.22 alpha, an accent stroke, and zIndex 999. The palette-swap guard clears the cache when the palette identity changes (so a scenario's `colors.json` arriving late doesn't leave stale fills).

**Disputed regions** with claimants get a diagonally striped `CanvasPattern` (`makeStripePattern`): administrator colour first, then each deduped claimant, `(x+y) mod period` bands. Requires ≥2 distinct colours.

---

## 12. Flags (`FlagPicker.jsx`)

A full-screen overlay (community-hub purple, not editor blue) mounted at `MapEditor`'s root — **not** inside the inspector, because the panel's `backdrop-filter` makes a containing block that would trap a `position:fixed` overlay (`FlagPicker.jsx`). Opened via `flagPickerFor` state, wired to `d.setFlag(flagPickerFor, value)`.

Tabs:
- **In the game** — *Suggested* (the built-in flag for the polity the picker is open for, when that polity is a standard country — `resolveStockCountryCode`, the recognition **Fill standard flags** uses; hidden while searching), *Already on this map* (flags already placed → reuse), *My flags* (saved to the library, reusable across maps), and *Built-in flags* (`builtInFlagChoices()` in `builtInFlags.js`: `listBuiltInFlags()` titled with the country name and sorted by it, the ISO3 code underneath; search matches the name, the code, the alpha-2 code, or an official full name such as "Russian Federation").
- **Community** — fetched via the hub proxy; a single flag installs as a data URL, a scenario **flag pack** (`fromScenario`) installs wholesale into My flags (dedup by content hash). A flag installed from the hub is saved with `source.community` and its post's url: its card (in My flags, and on this map) shows a **Community** link to the post instead of the ⤴ publish button, and a single community flag already in My flags is applied from there without downloading it again.

**Sharing** (the ⤴ on an uploaded flag in *Already on this map* or *My flags*; built-in flags have nothing to share) saves the flag as a file named after it (`<name>.png`, or the extension of its image type; `publishFlag` in `communityFlags.js`), opens the hub's flag form, and says to drag that file into it, like publishing a basemap. The form carries the polity's exact name as `Flag-Polity`. My flags keeps that name exactly in each flag's `polity` field (uploads, installed posts and flag packs all set it; `code` is only an upper-cased 12-character hint), and sharing from My flags sends `polity` as the name. An entry saved before the library kept `polity` sends its code only as the `Flag-Code` hint, never as the name. Upload (`fileToFlagDataUrl`, `FLAG_ACCEPT`) saves to the library first, then applies. **Remove** re-selects the standard code-derived flag (`pick(null)`). Deleting one of *My flags* asks first and says when it fails; maps keep their own copy in `doc.flags`. Values stored in `doc.flags` are downscaled PNG data URLs.

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

A basemap installed from the Community tab (`installCommunityBasemap`, saved with `source.community`) shows a **Community** link to its post on its Your basemaps card instead of the ⤴ publish button, and the Community tab shows **✓ Installed** instead of Install for a post whose content hash or post url is already in the library. GeoTIFF/PMTiles are not saved with the map, not added to Your basemaps and not shown by the game; `uploadBasemap` answers `{ sessionOnly: true }` for them and the picker says so, and it answers `{ libraryError }` when an image or vector basemap is on the map but the library would not take it, which the picker also shows (it used to go only to the console). The Upload button's tooltip and the empty Your basemaps shelf say which formats are kept. Heavy parsers (`shpjs`, `jszip`) are dynamically imported so they only load on demand. Persistable backgrounds (`vector`/`image`) are saved into `doc.metadata.customBackground` and rebuilt on open via `rebuildPersistedBackground(saved, {persisted})` — the `persisted` flag stops a restored background from re-dirtying the doc on load. In the game, a custom background **replaces Earth** and forces `world.customRegions` on (so the stock political overlay is hidden).

---

## 14. Reference image / tracing aid (`ReferencePanel.jsx` + OlMap ref-image effects)

A semi-transparent image above the region fills (z40) that a map-maker aligns a source map to and traces over. Upload → placed at 60% of the view width; **Opacity**, **Visible**, **Center on view**, **Remove**. While the Reference panel is open, a dashed frame with corner handles appears (z41) — drag inside to move, drag a corner to resize (free aspect). **Session-only**: it lives entirely in component state (`refImage`) and a ref (`refImageExtentRef`), never saved to the document and never exported (`MapEditor.jsx`, `OlMap.jsx`).

---

## 15. Fantasy Map Generator (`fmg/`)

A right-edge **🗺 GENERATE** drawer (`FmgPanel.jsx`) with inputs: seed, landmass template (`random`, then the driver's own `SYNC_TEMPLATES` list — `continents`/`archipelago`/`pangea`/…/`shattered`/`fractious`; `random` picks a world-scale shape from the seed's digits, or at random when the seed has none), detail (points), countries, cultures (1–`MAX_CULTURES`, 30, the most the driver passes on), cities, and "regions from provinces". **Generate** calls `generateFromFmg` (`MapEditor.jsx`), which runs Azgaar's Fantasy Map Generator headlessly (`fmgDriver.js`, vendored FMG at `/fmg`) and converts the result via `fmgToEditorSeed` (pinned by `fmgImport.test.js` on a six-cell bundle). The import: `api.loadRegions(seed.regions)`, cities → `doc.features`, `mergeColors(seed.colors)`, and the biome basemap saved as a vector custom background (also added to "Your basemaps"). Marks the doc dirty and fits the view.

**Source checkouts only.** `/fmg/` is served only when `fmg/dist` exists, which only `node scripts/fetch-fmg.mjs` creates; no installer packages it, nothing in the updater or the release workflows runs the script, and the web and Android builds have no server at all. So the Workshop asks once when it opens (`checkFmgAvailable` in `fmgDriver.js`: fetch `/fmg/index.html` and check it is the generator's page, not a 404 or the app's own page from the SPA fallback) and renders the GENERATE tab only when it is. Before this, every build showed the tab, and pressing Generate loaded the whole game a second time in a hidden 1920×1080 frame and gave up after about 90 seconds. Shipping the generator in the desktop installer (adding `fmg/dist` to the build files and running the script in the release workflow) is a separate decision.

---

## 16. Geometry operations (`geometry.js`)

Boolean ops run directly on OL geometries in EPSG:3857 via `polygon-clipping` (no reprojection round-trip):

| Fn | Use |
|---|---|
| `unionGeoms(geoms)` | Merge / dissolve. |
| `subtractFrom(target, cutter)` | Draw-carve (returns survivor, `null` if swallowed whole, or unchanged if disjoint). Drawing inside leaves a hole (interior ring). |
| `overlaps(a, b)` | Cheap intersection guard so draw only rewrites genuinely-overlapping neighbours. |
| `translatedClone(g, dx, dy)` | Copy/paste offset. |

---

## 17. Persistence (`documentIO.js`, save flow)

Server REST at `/api/mapeditor/documents` (web build routes through `runtime/web/editorStore.js`): `GET` list, `GET /:id`, `POST` create, `PUT /:id` update, `DELETE /:id`. The list is built from a summary kept beside each document (a `.summary.json` file on desktop, the `mapeditorMeta` IndexedDB store on the web build), never by loading the documents. `downloadJson` writes a local `.json`: the Documents menu's **Export JSON** (the document, map and all) and **Export for game** (`buildGameSeed`, §18). In the standalone editor both run the border cleanup first (`exportFromMenu` in `MapEditor.jsx`; §24, **Border cleanup on save**); **Save now** and every other save to this store do not.

`buildDocumentFields()` (`MapEditor.jsx`) is a **strict whitelist** — `name, metadata, types, features, colorOverrides, flags, tags, polities, ownerSchema`. **Anything not named here is silently dropped on save**; a new document field appears to work until the first reload. `buildPayload(regions?)` adds the map to it, for an export or a full save.

**A save carries only the regions that moved.** The autosave runs every 2 seconds while the document is dirty, and it used to write the whole world each time — 5.5 MB of JSON on the shipped map, an ~83 MB string on the z9 seed, whether or not a polygon had moved. Now `api.serializeRegionChanges()` writes each region on its own, stamps it (`src/Editor/regionChanges.js`) and compares the stamp with what the last save wrote, so an autosave after a rename sends nothing at all and one after redrawing a border sends that border. Nothing asks a tool to declare what it touched: the comparison is against the geometry itself, so an edit cannot be missed however it was made.

- The payload is then `regionsDelta: { changed, removed, count }` instead of `regions`, applied by `server/regionDelta.js` — shared by the desktop store (`server/mapEditorStore.js`) and the website's IndexedDB one (`src/runtime/web/editorStore.js`).
- A difference that does not add up — `count` disagreeing with the merge, a region with no id, a document whose geometry the store does not have — is **refused whole**, the stored map is left exactly as it was, and the store answers `needsFullRegions`; `saveNow` then immediately writes the whole map. A half-applied difference would be a map the author silently loses; one extra full save is not.
- The whole map travels anyway on the first save after a document is opened, loaded or reseeded (the record of stamps is empty), on create, and when any region has no id to key it by.
- The stamps are committed only once the save has landed, so a failed save is retried with the same contents.

Save robustness:
- **Debounced autosave** every 2s while `dirty`, keyed on `d.doc` (a fresh object per change) rather than a hand-listed field set — the old field list went stale and silently lost colour/flag/tag edits.
- **`beforeunload`** guard while `dirty`/`saving`/`error` (`isUnsavedStatus`): after a failed save the work is still only in memory, and on the website the IndexedDB copy is the only copy.
- **`visibilitychange`/`pagehide` flush** via refs (avoids stale-closure loss on mobile suspend); it also retries a save that failed.
- **A failed save is retried** on its own after 5 s, 15 s and 60 s (`saveRetryDelay`), then left to the chip and the next edit. The bottom bar's chip reads "Save failed: <the store's reason> — Retry" and clicking it saves again; `documentIO.js` passes on the `{ error }` both stores answer with. Retrying a map difference is safe: the stamps are committed only once a save lands.
- **Saves take turns** (`createSaveRunner`, `src/Editor/documentSaving.js`). A save asked for while one is running waits for it and then writes whatever is still unsaved, however many were asked for meanwhile, so two never write at once: the autosave and the hide flush used to run side by side, and with no document id yet each created a document. The id a create returns is in `docIdRef` before the save queued behind it runs.
- **An edit made during a save stays unsaved.** Every change goes through `setSaveStatus("dirty")`, which counts it (`d.editCount()`); a save notes the count before it writes and calls the document saved only if the count has not moved. It used to set "saved" regardless, which hid the edit and cancelled the autosave the edit had armed.
- **Close** saves first (`settleUnsavedWork`) and asks only if that save does not land. It goes by what `saveNow()` resolves to: reading React state after the await still said "saving", so a save that worked asked "could not be saved" anyway.
- **New and Open** settle the open map the same way (`settleBeforeReplacing`), then wait for any save still writing it (`run.idle()`) before swapping. They used to replace the document at once: edits in the autosave's two seconds were dropped, and after a failed save everything unsaved went without a prompt. Open settles before it fetches the other map, so re-opening the map that is open reads the copy that includes the flush; an edit made during the fetch is settled again before the swap. The world seed a standalone Workshop loads on start is dropped if a map was opened or started before it arrived (it used to be added on top).
- **A failed Open changes nothing.** The document is fetched, migrated and built, and `OlMap.loadRegions` reads the whole map, before anything on screen is replaced; a failure says "Could not open this map: <reason>. Your current map is unchanged." It used to log and leave the new document's fields over an emptied map while the saves still wrote to the old id.

---

## 18. Exporting to a game seed (`exportPreset.js` → `buildGameSeed`)

`buildGameSeed(doc, regionsFC, palette, {playerCountry})` is called for **Export for game** (download; in the standalone editor after the border cleanup, §24) and for the three scenario saves. Steps:

1. Walk regions → build `regionOwnershipOverrides = {regionId: ownerName}`, collect owners, count custom-id regions.
2. `detectCustomGeometry(regionsFC, kind)` → **tier 2** if `kind==="blank"`, or any region has a non-GADM id (`reg_…`), `mergedFrom`, or `edited`. Otherwise **tier 1**.
3. `normalizeRegionsForGame` → rebuild an FC whose **properties** (MapLibre reads `["get","id"]`) carry `id, owner, gid0, name, typeId`, plus `claimants` and `edited` when present. Feature id is kept in properties only (a non-integer top-level id spams warnings).
4. Build `colors`, `polityOverrides` (§10), `regionClaimants` (every region's `claimants`, deduplicated, at most four — the AI, the region popup and the cheats read disputes from the world, so a dispute that lived only in the map file striped the map and was never named to the model), cities (`buildCitiesForGame`: name, population, `capital`, `tier`, `populationByYear`, and — only when they say more than that — the Features panel's `tags`, `symbol` and `country`), and background descriptor + heavy payload (`buildBackgroundForGame`).

### Seed shape (return value)

| Key | Contents |
|---|---|
| `name`, `kind`, `author`, `credit` | Identity. |
| `hasCustomGeometry` | Tier flag. |
| `stats` | `{ ownedRegions, owners, customGeometry }`. |
| `world.regionOwnershipOverrides` | `{regionId: ownerName}`. |
| `world.polityOverrides` | `{name:{name,aliases:[],color:'#hex',note:'',verbatim?}}`. |
| `world.groups` / `world.groupAreas` | The groups (§24b) and which region each controls — the registry, plus any group a region names that the registry lacks (default colour). Regions carry no `group` in the regions file: the world is the whole truth. |
| `world.markers` | The map features that are not cities (§9d), `buildMarkersForGame`. |
| `world.puppets` | The puppet states (§24c), `buildPuppetsForGame`. |
| `world.regionTypes` | The document's region types (§8), `normalizeRegionTypes`. The game draws them and tells the AI their rules. |
| `world.regionClaimants` | `{regionId: [claimant]}` — the map's disputes. |
| `world.settledRegionClaims` | `[]` — a scenario starts with no dispute already over. |
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

In embedded mode, **▶ Apply & Play** calls `onApplyToScenario(seed)` (`MapEditor.jsx`), which runs `applyMapToScenario(scenario, seed)` (`libraryBar.jsx`). It writes `world`/`game` via `saveScenario` (merging over the current world; sets `ownerCodes` for the start-country picker, `customRegions:true`; keeps the scenario's player country while the map still has it, by its exact name, since the seed's own `game.country` is only the map's first owner: `playerCountryAfterSave.js`, which fixed saves resetting every scenario's start country). A Workshop rename keeps no old name, so the countries renamed since the last save (`polityRenames`, a session log on the document kept by `useMapDocument.renamePolity` and passed as `onApplyToScenario(seed, { play, renames })`) are first replayed, in order, onto the scenario's own world and game (`scenarioAfterWorkshopRenames`): the player country follows a rename of its exact key, and the world's name-keyed records (tags, goals, relations, stats…) are re-keyed through `renamePolityInWorld`; the drawer's Country field follows too. It then uploads each seed piece as a scenario asset. The writes pass `{ refresh: false }` and run inside `withSingleLibraryRefresh` (`src/runtime/library.js`), so the library catalog is rebuilt once after the last one rather than after each:

| Seed field | Scenario asset | Empty behaviour |
|---|---|---|
| `colors` | `colors` | always written |
| `flags` | `flags` | `clearScenarioAsset` when null |
| `tags` | `tags` | `clearScenarioAsset` when null |
| `regions` | `regionsGeojson` | always written |
| `cities` | `citiesGeojson` | always written |
| `backgroundData` | `backgroundData` | `clearScenarioAsset` when null |

The `null`-means-clear contract is why hydration (§20) must reload the scenario's existing flags/tags/background — otherwise a round-trip that "loaded none" would clear the author's work. For the same reason a piece that fails to download (rather than one the scenario lacks: `downloadScenarioJsonAsset` throws for anything but a 404) closes the Workshop before it can save, with the reason shown in the scenario drawer. Finally it creates + activates a fresh game so the running map reflects the edit, starting as the scenario's own player country just saved (never the seed's first owner). The activation remounts the UI (App keys it on the active game), so the optional "pick who you control" picker is handed to the instance mounted for the new game (`src/runtime/afterActivation.js`) rather than set up in the one being unmounted.

---

## 20. Opening a scenario's current map (hydration)

When the editor opens from a scenario, `onOpenMapEditor` (`libraryBar.jsx`) fetches the scenario's `regionsGeojson`, `citiesGeojson`, `colors`, `flags`, `tags`, and (if any) `backgroundData`, assembling `mapEditorSeed` = `{ name, author, ownershipOverrides, regions, cities, colors, flags, tags, background, basemap }`. A download that finishes after that Workshop was closed, or reopened on another scenario, is dropped (`src/runtime/latestRequest.js`): the Workshop hydrates once, from the first map it is handed, and saves into its own scenario whatever that map was. `MapEditor`'s hydrate effect (runs once) builds the base document, restores flags/tags/background/basemap, maps cities → features (`gameCityToFeature`, `exportPreset.js`: size, series, tags, symbol and country come back; `exportPreset.test.js`), then:
- `api.loadRegions(initialMap.regions)` if the scenario has custom geometry, **else** `api.reseedWorldWithOwners(initialMap.ownershipOverrides)` (stock world + overrides = its tier-1 map).
- `hydrated` (which enables Save, Save & Exit and Apply & Play) is set only once the map is on it; the stock world arrives seconds after the Workshop opens. Loading it is not an edit: it used to mark the map dirty when it landed, so closing without an edit asked about unsaved changes, and the autosave wrote the whole stock world as a new "Scenario Map" document on every open.

`scenarioMode` forces `seedKind="deferred"` so `OlMap` doesn't auto-seed the default world under the scenario's map.

---

## 20b. Groups, puppet states and structures round-trip

`libraryBar.jsx` hands the Workshop the scenario world's `groups`, `groupAreas` (stamped onto the regions with the disputes, `claimStamper`), `markers`, `puppets` and `regionTypes`, and `applyMapToScenario` writes back the Workshop's: it opened with the whole of each, so what it saves is the whole of each. The document keeps them as `doc.groups`, the regions' `group`, map features in `doc.features`, and `doc.puppets`; `buildDocumentFields` lists `units`, `groups` and `puppets` (units were missing there, so a document's units vanished on reopening it), and both stores' creates keep every one of them, built from the one field list in `server/mapEditorFields.js` (`DOCUMENT_FIELDS`) — each store kept its own list, and neither named `puppets`, so puppet states set before a new map's first save were gone on reopening it. A field added to `buildDocumentFields` goes in that list too.

## 21. Document migration (`documentMigration.js`)

`migrateDocumentOwners(doc)` runs on every **open** (`MapEditor.openDoc`). A doc is legacy while `ownerSchema < OWNER_SCHEMA`. Migration rekeys `colorOverrides`/`flags`/`tags` and every region `owner` from GADM code → name via `COUNTRY_NAMES` (`rekeyOwnerMap`), strips region `country`, and stamps `ownerSchema = OWNER_SCHEMA`. It lives in the editor (not the store) because a document is the one path where legacy owners can enter a scenario already wearing a "migrated" badge (an applied doc inherits the target's `ownerSchema`, so the store's migration would never run). No-op once migrated — safe to call every open. `polities`, `units`, `groups` and `puppets` are deliberately not re-keyed: they were added to documents after `createDocument` began stamping `ownerSchema`, so any document carrying them is name-keyed already. `documentMigration.test.js` pins all of this.

---

## 22. Standalone editor repo & mirroring note

The editor was split into a standalone repo (`Open-Historia/open-historia-map-editor`), but the game still **embeds its own copy** under `src/Editor/`. Edits to editor source generally need mirroring to both. Copying whole files wholesale between the two drifts app-only wiring (e.g. the game-embed props); prefer targeted edits. The FMG generator is vendored at `/fmg` (Azgaar v1.109).

---

## 23. Gotchas & invariants (quick reference)

- **Owner is the polity's NAME, everywhere, and a rename re-keys it.** Never re-introduce a code path or case-fold stored owner text (`OlMap.jsx`, `SelectionInspector.jsx`). Matching typed text to an EXISTING key case-insensitively is a lookup, not a fold — the key stored is the registry's. Changing a name goes through `renamePolity` (`MapEditor.jsx`), never through editing the record's `name` alone.
- **`buildPayload` is a whitelist** — a new doc field that isn't listed silently fails to persist (`MapEditor.jsx`).
- **`edited`/`mergedFrom`/non-GADM id ⇒ tier 2.** These are the only signals that ship geometry (`exportPreset.js`).
- **`flags`/`tags`/`background` null = "clear the scenario asset."** Always re-hydrate them on open so a round-trip is a no-op (`MapEditor.jsx`, `libraryBar.jsx`).
- **`wrapX:false` + `VectorImageLayer`** are correctness+performance load-bearing; don't revert (`OlMap.jsx`).
- **Reference image is session-only** — never let it into saves or exports (`MapEditor.jsx`).
- **Render-path changes must be verified by booting the app** — build+grep proves nothing (see the runtime-verification memory).
- Region geometry is verified in-app; a headless WebGL context can't pixel-check the game map.

Related: [World state](world-state.md) (`world.json` fields the seed writes — `regionOwnershipOverrides`, `polityOverrides`, `customRegions`, `countryTags`).

## 24b. Groups (`GroupsPanel.jsx`)

A group — a terrorist organisation, a cartel, a militia, a zombie outbreak — controls an area of regions without owning them (`src/runtime/groups.js`). The **Groups: N** chip opens the panel: every group in the document (and any a region names that the registry lacks) with its colour and region count; **Create** (with a selection, the new group takes it); per group, its name (a rename re-keys the record and every region in its area as one undo step, `retagGroup` with the registry move from `groupRenameSteps` in `documentUndo.js`, so Ctrl+Z moves the record back with the regions), **What it is (the AI is told this)**, a **Tint colour** (a palette of ten, or any colour), **Select its regions**, **Add the selection**, **Remove the selection**, and **Erase group** (two clicks: the group and its area; one undo step that brings back the area and the record, description and colour with it — `groupEraseSteps`). The region inspector's **Controlled by group** sets it per selection. On the Workshop's map a group's regions get its tint over their owner's colour (`olStyle.js`) and its whole area an outline in its colour (`OlMap.jsx` `rebuildGroupOutlines`, a beat after any region change): cut by the game's own code (`vnext/groupAreas.js`) over a topology of the members alone, so the Workshop shows the outline the game will draw.

## 24c. Puppet states (`PuppetFields.jsx`, `scenarioPuppets.js`)

Each country in the Countries panel has **Puppet of**: whose protectorate, puppet state or client state it is, openly known or covert, and its loyalty (below 35 the game starts it plotting against its overlord). The document keeps the rows as `doc.puppets` in the game's own shape (`world.puppets`, `normalizeWorldPuppet`), so a scenario's rows open and save unchanged. The panel keeps the ledger's rules: one overlord, nobody their own, no chains — an overlord offers only countries that are nobody's puppet, and a country holding puppets cannot become one. Ended rows (released, annexed, revolted) pass through untouched. A rename re-keys the rows (and the country's starting units) in the document, and `renamePolityInWorld` now does the same in play; removing a country drops its rows. `buildPuppetsForGame` gives a live row the scenario's start date and both parties in `knownTo`.

## 24. Scenario Workshop: polities, border cleanup, province import

Ported from kernely's Continuum branch. The editor's document gained an explicit **polity registry** (`doc.polities`, keyed by the STABLE polity identity; `name` is presentation) and two panels reached from the bottom bar. (A third, **Topology**, found and repaired cracks and overlaps between the selected regions; it was removed once the same repair ran over the whole map on every scenario save — see **Border cleanup on save** below.)

| Panel / tool | File | What it does |
|---|---|---|
| **Countries** (`Countries: N` chip) | `PolitiesPanel.jsx` | The map's countries (polities): every owner and claimant on the map, and every country registered in the document whether or not it holds a region — a registered country stays until it is removed, and `buildGameSeed` ships it to the game with or without land (a government in exile, a nation registered before it is painted). Clicking a country selects its whole territory and zooms to it; under its name a **Regions** list names each region it owns (click one to select and zoom to it). **Create country** registers a name at once — with a selection it takes those regions, otherwise it waits, landless, for the paint tool or **Assign selected**. **Rename** (a country is keyed by its name, so a rename re-keys it everywhere in one undo step — regions and claims via `OlMap.renameOwner`, the record, colour, flag, tags, city markers, starting units and puppet ties via `renamePolityInDocument` in `server/polityRename.js`; the old name is not kept — no former name, no alias that was an old name, since nothing in the document still uses it, and the button's tooltip says so; a rename during play keeps its former names. A name another country already answers to, registered or only on the map, is refused and the panel stays on the country it showed), recolour, tag, flag, transfer all territory from another country, and **Remove from the map** (its regions become unowned, claims in its name are dropped, the record goes with its colour, flag and tags — the only way a registered country leaves). **Puppet of** makes it another country's puppet state (§24c). "Fill standard flags" copies the built-in flag for recognised stock countries. Bulk import a roster (`importPolityRoster`, a state wrapper around `mergePolityRoster` in `polityRoster.js`: a row is keyed by the first filled of `key`, `stableKey`, `stable_key`, `code`, `id` or `name`, exactly as written; the first row for a key wins; aliases merge, and an existing country keeps its code, and its status and note where the row gives none). "Paint this polity" hands the country to the paint tool. |
| **Import Map** chip | `ProvinceImportPanel.jsx` + `provinceRasterWorker.js` | Turns a colour-coded province raster (a HOI4-style `provinces.bmp`, any PNG) into regions in a worker, entirely in the browser; optional definition CSV / GeoJSON metadata assign polities, names and city markers (`importCityMarkers`); a GeoJSON backup of the current regions and cities (`open-historia-pre-province-import-<stamp>.geojson`) is saved first and awaited — if it fails to save (the app's file write can) nothing is replaced unless the author confirms going on with no backup. The raster is read as equirectangular (`mapRing` spaces its rows evenly in latitude between the bounds), and the alignment overlay (`showProvinceImportPreview`) is an `ImageStatic` in EPSG:4326 over the same bounds, reprojected onto the map, so what lines up in the preview lines up in the import. Colours are never assigned by feature order — ambiguous sources are refused. Every province is traced from the same pixel lattice (`vectorizeColorGrid`), so neighbours share exact border vertices; `provinceRasterWorker.test.js` pins that, holes, corner-only touches, the black / transparent / `minPixels` / `landOnly` filters and the definition names. |
| **Paint** tool | `OlMap.jsx`, `MapEditor.jsx` | Paints a stable polity key by click or drag (one stroke = one undo), with a "paint over" filter (any region / unowned only / only regions of one polity); the picker lists registry polities by display name. |
| **Edit vertices** / **Shared border precision** | `OlMap.jsx` (`weldPointIntoFeature`, `sharedBorderPoint`, `removeSharedVertexNear`, `analyzeTopology`) | Vertex editing with snapping and undo; with exactly two neighbouring regions selected, a dragged border vertex or edge is welded into BOTH regions. After each such edit a check marks any crack (yellow) or overlap (red) up to 100 m wide still left between the two (`analyzeTopology`, drawn with `topologyDiagnosticStyle`). It repairs nothing — the save does — and the marks stay until the next shared-border edit, save or import. |
| **Selection inspector** | `SelectionInspector.jsx` | The owner field is free text over the registry: existing polities are suggested and matched by key or display name, and a name nobody has becomes a new polity on Enter or the Create button — never on blur or a keystroke — so a country that does not exist yet can be made from the map without a typo silently minting one. |
| **Basemaps** | `basemaps.js`, `BasemapPicker.jsx`, `OlMap.jsx` | Two dark physical presets (`ocean-dark`, `atlas-relief-dark`) with graded preview cards and a dark editor presentation (`editorOpacity`, `editorBackground`). |

**Saving.** The Workshop has three actions: **Save** (write the map into the scenario and keep editing), **Save & Exit**, and **Apply & Play** (the old flow: save, then create and activate a fresh game). `libraryBar.jsx` `applyMapToScenario(scenario, seed, { play })` replaces the scenario's `polityOverrides` with the Workshop's registry (it hydrated the full registry, landless polities included, so merging would resurrect deleted entries), writes `ownerSchema` and the map's disputes (`regionClaimants`, with `settledRegionClaims` emptied: the Workshop is where a scenario's disputes are authored), and refreshes the drawer's cached scenario details from the save's response so a later ordinary scenario save cannot write a stale basemap back — and, when the drawer is open on that scenario, its form's Player Country and Game Date, which the save may have moved (`followSavedFields`, `src/runtime/editorForm.js`; a field the author changed in the form keeps their value). A "Scenario unsaved" chip shows while the document has autosaved edits not yet written into the scenario, and closing asks first. All three actions stay disabled (the Save button reads "Loading map…") until the scenario's map has arrived: the Workshop opens empty and its geometry downloads afterwards, and a save in that window used to write an empty map over the scenario — the first click wiped it, the second, once the map had appeared, wrote it back. `applyMapToScenario` also refuses an empty map for a scenario that has territory.

**Disputes round-trip.** The Workshop opens with the scenario world's disputes stamped over the map file's (`claimOverrides.js` `claimStamper`, called from `OlMap.loadRegions` / `reseedWorldWithOwners` with the `claimOverrides` `libraryBar.jsx` passes in), by the rule the game reads them with: a world row wins, even an empty one, and a settled region has no claimants. A scenario derived from the built-in world keeps its disputes in its world file, and the save used to write only the map file, so the Workshop showed the map file's older list and a claimant added or removed there never reached the game — the world's row still won. Now the save writes the map's disputes into the world (above) and the Workshop opens with the world's, so both sides read one list.

**Border cleanup on save.** All three actions first ask which clean to run, **Quick clean** or **Deep clean** (below), and then run the border repair over **every region**, at that clean's width: 500 m or 1.5 km (`BORDER_CLEANUP.quickWidth` and `BORDER_CLEANUP.maxWidth`, in metres of the map's projection; `repairTopologyEverywhere` in `OlMap.jsx`, on `geometry.js`'s `unionAllGeoms`, `enclosedGapsOfUnion`, `overlapGeoms` and `subtractFrom`; the pure parts — chunk grid, boundary index, welding, progress wording — in `topologySweep.js`): enclosed cracks are filled into the neighbour they touch most, thin overlaps are trimmed from the smaller region, as one Undo step, and only then is the map written. Nothing else in the Workshop repairs borders, so a merge that fails sends the author to the save. **The standalone editor** (`/?editor=1`) has no scenario and none of the three buttons, and a map leaves it only as a file, so there the Documents menu's **Export JSON** and **Export for game** are its save: each runs the same repair first, behind the same screen with the same **Save now**, and leaves the same note (`exportFromMenu` in `MapEditor.jsx`; it and the scenario save both go through `cleanBorders`), and a merge that fails there sends the author to the export. **Save now** does not run it: it writes the stored map, the editor's own working copy, and is the autosave run early — the same write is made every two seconds while the map has unsaved edits, when the tab is hidden, and before Close, New and Open, none of which can wait behind a loading screen — so cleaning on the one of them the author pressed would leave the stored map repaired or not by which came first. Nor does the backup Import Map saves before it replaces the map, which is the map as it was. A stored map still reaches a game only through a save that cleans it: as an exported file, or through a scenario's Workshop (opened there from Saved maps, or pasted in from the clipboard) and that scenario's save. In a scenario's Workshop the two exports write their file at once, as they did. (On the standalone editor's default map, the stock world, one export only begins the repair, here or in a scenario: that map has 24,661 cracks and 49,647 slivers, the search finds them in about half its 60 s, and the 90 s cap ends the repairs with ten thousand or so slivers trimmed and the rest left for the next save, which the note says. It used to do nothing there at all: see **A call polygon-clipping refuses**, below.) **Quick or deep.** A save that cleans asks first (`BorderCleanupChoice` in `BorderCleanupOverlay.jsx`, put up by `chooseClean` in `MapEditor.jsx`: the scenario's three saves, and the standalone editor's two exports): **Quick clean**, cracks and slivers up to 500 m wide, the limit every save had before 1.5 km, or **Deep clean**, up to 1.5 km. Cancel, Escape or a click beside the card backs out, and then nothing is cleaned and nothing is saved. The question opens with the answer given last time under the keyboard (`lastCleanMode`, kept on the device; deep until one is chosen). The two differ in what is REPAIRED, not in what is read: both sweep every region, every time, and the width does not enter the search, so on a given map they take the same time to look and differ only by the repairs the deep one adds (`CLEANUP_MODES`, `cleanupWidthOf` in `topologySweep.js`; `cleanBorders` hands the width to `repairTopologyEverywhere`, whose progress and result carry it as `maxWidth`, so the screen's paragraph and the note give 0.5 km or 1.5 km). Replayed in Node on the built-in map: the quick clean fills 98 cracks and trims 58 slivers across 143 regions in 4.3 s, the deep one 106, 59 and 152 in 3.6 s, the same file byte for byte as before a save asked; a second save of either reads all 4,848 regions again, finds nothing, and takes as long. The two guards below apply to both (at 500 m the one for a hole inside a single region changes nothing: its limit is that width). A save no longer leaves anything out. For a day it read only the regions changed since its last finished sweep and never the stock world's own regions (`663f63d3`); both were taken out again, because the point of the cleanup is that every region is clean after every save. **Why 1.5 km.** A crack or a sliver is repaired when twice its area over its perimeter — its width, when it is long and thin — is no more than the limit, in metres of the map's projection (Web Mercator: 1,500 m is 1,500 m on the ground at the equator and half that at 60°). The limit was 500 m, which left eight cracks on the built-in map, 501 to 977 m, every one a triangle between two or three regions of one country whose shared border was simplified differently on each side (the longest runs 358 km along the Wyoming–Montana line and is nowhere wider than 900 m). At 1.5 km those are filled — 106 cracks and 59 slivers across 152 regions, against 98, 58 and 143 — and nothing else is: the map has no hole between 977 m and 4,402 m (one more triangle, between Kamchatka and Magadan), the narrowest water left as a hole, the lower Uruguay river, measures 7,031 m, and no two regions overlap by more than 930 m (East and West Antarctica, 87 m on the ground). `topologySweep.test.js` pins that band. **Two guards keep the limit to cracks between regions.** A hole with ONE region on its rim keeps the old 500 m (`BORDER_CLEANUP.maxWidthInsideOneRegion`; `cracksAmong` and `holdsRim` in `topologySweep.js`, asked by `assignGapTargets`): it is that region's lake or inlet, not a crack, so only a hole with two or more regions on its rim is filled up to 1.5 km. That is about 3 km across when the hole is round, and a lake lying on a border still qualifies, so one that should stay empty has to be a region of its own. And a pair of regions that shares more than a tenth of the smaller one's area is left alone (`maxSliverShare`; `isSliver`, asked by `findNarrowOverlaps` with the `shared` area `overlapGeoms` reports): past that it is no sliver, and the trim, which takes all the two share, would take that much of a region. Both guards come from maps cut from the stock world. (The whole stock world was out of reach at either width while a refused union ended the cleanup; what a save does to it now is further down.) Its regions were each simplified on their own, so neighbours disagree by up to 2.5 km along most borders, and the save rewrites such a map wholesale at either limit. Replayed in Node on a European cut of `regions-seed.geojson` (940 regions), first pass: 2,105 cracks filled and 2,856 slivers trimmed at 500 m. At 1.5 km with no guard it was 4,103 and 5,263, which closed the borders 500 m had left open and took what else was that narrow: 32 more holes of water inside one region (Randers Fjord, 13 km²; on an American cut Laguna Madre and Santa Rosa Sound, 38 and 39 km², on an Asian one 71 km² of Sundarbans channels), and over half the area of nine regions a few square kilometres across (Montegiardino in San Marino, 1.3 km², was left with 0.1, Italy's Marche keeping the land they shared). With the guards it is 4,071 and 5,220, with 32 holes and 34 pairs left alone: the holes of water still filled are the 33 under 500 m that the old limit filled too, and no region loses more than a fifth of its area (Dhekelia, 18.8%), where ten did at 500 m and three of them over half. The cut settles in three saves, the guards passing over the same holes and pairs each time: the first fills 4,073 cracks and trims 5,222 slivers in three passes (a refused union used to end it in its second, at 4,063 and 5,220, and it now leaves one part apart and two repairs unmade, which its note says), the second repairs 44 cracks and 3 slivers more (it was 54 and 5), the third nothing. On the built-in map the guards change nothing: every crack it fills has two or more regions on its rim, and no pair shares 1% of its smaller region. **The note says what the guards left alone.** A lagoon left open otherwise reads as a crack the cleanup missed, and a small region still lying over its neighbour as a sliver it missed. The sweep's result counts both (`holesLeftAlone`, `pairsLeftAlone`: `cracksAmong` and `findNarrowOverlaps` tell it of each one through `onLeftAlone`, and `leftAloneTally` in `topologySweep.js` keeps a hole once by where it is and a pair once by its two regions, since a follow-up pass meets the same ones again around its repairs — the cut's second save met two of its 34 pairs twice — and takes a pair back out if a later pass trims it), and `describeCleanupLeftAlone` makes a line of each under the result: "32 gaps, each inside a single region, were left open: they are treated as enclosed water, not cracks." and "34 pairs of overlapping regions were left as they are: trimming would take too much of the smaller region." on that cut, on each of its three saves, and no line for a count of zero, so nothing on the built-in map. The four sentences (singular and plural of each) are a `*_TEXTS` table, `CLEANUP_LEFT_ALONE_TEXTS`, which the string extractor reads, so the language packs carry each one whole ([i18n.md](i18n.md)); each line is drawn in an element of its own, on the note and on the loading screen, where the translator finds it by its sentence. Which neighbour receives a crack is decided within 8% of the limit (`assignGapTargets`: 120 m, was 40 m), which gave eight of the 98 cracks the old limit already filled to another of their neighbours. It is not an all-pairs check: overlap discovery asks the map's spatial index for extent neighbours only (the stock 4,848-region world is 14,011 pairs, ~3 s), and the gap search reads the holes of ONE union of every region, built as the union of chunk unions — the same polygon set as a single call (the stock world yields the identical 332 cracks either way, 106 of them at least 2 m wide), with bounded memory and a repaint between chunks. A per-chunk search was rejected because a crack longer than a chunk (a double-traced border between two large countries) could go unseen. Two measured facts shape the rest: trimming a sliver can expose a hairline between the winner and a third region, so a pass that repaired something is followed by another until one finds nothing (at most three; the stock world is 106 cracks and 59 slivers, then nothing), and the save writes coordinates at five decimals (about a metre), which leaves centimetre slivers along every repaired border on reload — so defects narrower than **2 m** are ignored (`BORDER_CLEANUP.minWidth`), or every save would move hundreds of regions by centimetres. Repairs are applied in one go (a repaint between them redraws the whole world each time), every sliver of one pair of regions in a single trim and every crack of one target in a single union. A trim takes all of the winner out of the loser, so the first trim of a pair clears every sliver the two share and a second has nothing left to take at the cost of the first: the sweep gathers what it found by winner and loser and trims each pair once, counting every sliver of the pair as trimmed, or as not made when the one trim is refused. Two regions that disagree along a border share a sliver wherever their lines cross, so on the stock world as it was (49,647 slivers between 7,541 pairs) the first pass's repairs took 120 s with the limits lifted where a trim per sliver took 550 s, and 492 of those second trims were refused and counted as repairs not made though the first had made them. The map that comes out is the same: on that world 202 regions are written with a few vertices more or fewer and none differs by more than 1,400 m², and the built-in map as it then was came out byte for byte the same. A follow-up pass looks only around the previous pass's repairs (`hotspotsOf` in `topologySweep.js`: the padded footprints of the slivers trimmed and the cracks filled — a repair can only expose something inside its own footprint, and the first pass has seen everything else), so passes two and three cost a fraction of the first. **Time is bounded.** The search stops at `BORDER_CLEANUP.maxMillis` (60 s), or when the player presses **Save now** on the screen (offered after ten seconds); what it has found by then is applied (until `maxApplyMillis`, 90 s) and the note says the check stopped and why. An error inside a phase ends the search the same way and keeps the repairs already made, instead of throwing the cleanup away; polygon-clipping refusing a call is no longer such an error. **A call polygon-clipping refuses** ("Unable to complete output ring starting at …", "Unable to find segment … in SweepLine tree", a stack overflow while it nests its rings) does not end the cleanup. One did: on the stock world, the standalone editor's default map (3,662 regions, 2,580,536 vertices), the second union of the gap search threw 0.3 s in, and the note read "Border cleanup stopped after 1 s (…); nothing was changed." Measured on that map: 6 of the 20 pieces of the staged union are refused, they hold 2,027 of the regions, and each comes down to a pair of neighbouring regions (eight pairs: Veracruz and Oaxaca, Tabasco and Campeche, Los Lagos and Chubut, Lago Nicaragua and Río San Juan, Loreto and Huánuco, Tete and Chikwawa, Fars and Kerman, Shan and Yunnan), never to one region on its own. Two things make it refuse, and both are in the coordinates. *Twin values.* polygon-clipping takes a coordinate for one it has already seen when the two are within one part in 2^52 of each other, x and y each on its own, and loses its way when two values lie just outside that. The stock world has 600 such values among its 1.2 million (392 x and 208 y, most of them 1e-10 to 1e-8 m from their twin), in 441 regions: two regions clipped against the same line separately, each with its own copy of the crossing (Veracruz at 17.559134472946308° N, Oaxaca at 17.559134472946305°). The built-in map has none — no two of its coordinate values are closer than 1.11 m — which is why it has always unioned clean. *Its own work.* A region the sweep has trimmed has new corners where its old border crossed the neighbour's; each lies on the neighbour's edge to within a nanometre, the neighbour has no vertex there, and polygon-clipping now and then refuses the next union of the two (91 times in 40,000 random pairs of overlapping polygons, each trimmed against the other and then unioned with it). That is what a map saved again without a reload is full of, and what ended a follow-up pass on the maps cut from the stock world. So when a union is refused the search starts over with the regions **welded** (`weldRegions` in `geometry.js`, on `weldTable` and `nodeBoundaries` in `topologySweep.js`; `welderFor` in `OlMap.jsx`): every coordinate value within a micron of another on its axis is made equal to it (`BORDER_CLEANUP.weldReach`), and every corner of one region within a micron of another's edge is put into that edge. Welding is only for finding. A welded region is what polygon-clipping is shown in the region's place: worked out at the first refusal (about 3 s for the stock world), thrown away with the search, and never put into a region, since every trim and every fill is made from the regions as they are. A region with no such value and no such corner is shown as it is, and a map on which nothing is refused is never welded at all: the built-in map's save is the same as it was, byte for byte, and so are a first pass over each of the three cuts and the saves of five maps written at five decimals. (Welded by force from the first union, where it would be shown with 36 corners put into straight borders, the built-in map still saves as that same file: finding through welded regions changes nothing that is written.) On the stock world the weld takes every refusal away: after the one refused call that turns it on, the 29 unions of the search all go through (at any reach tried for the values, 1e-8 to 1e-3 m), the map is read in the 10 parts its size makes it, and 25,079 holes are found in 24 s. It stays that way save after save without a reload — six in a row each read the map in the same 10 parts with nothing left apart — where with only the values welded the search after three saves is 329 unions with 119 refused, 19 of 29 parts left apart, and all of its 60 s. What a weld does not cure is **kept apart and counted**, not the end of the search. A piece of the staged union that is still refused is halved until its halves union (a region refused on its own stays a part as it is); two halves that each union are tried together once, and if that is refused the lighter stays a part of its own; in the merge, of two parts whose union is refused the lighter stays apart (`findEnclosedGaps`, `mergeWithinBudget`). The map is then read in parts as an over-budget map is — a hole of one part with a region of another under it is dropped — and what goes unseen is a crack between a part left apart and the rest. (That alone, with no weld, was the first design. On the stock world it is 154 unions with 49 refused, 36 s for the weld's 24, and 7 of 18 parts left apart with 462 of the holes unseen.) A pair whose intersection is refused is compared welded (`findNarrowOverlaps`) and passed over if that is refused too; a trim or a fill that is refused is skipped. The result counts each once over all the passes — `partsApart`, `pairsFailed`, `repairsFailed`, with `welded` for whether a gap search came to welding — and the note has a line for each count above zero (`CLEANUP_REFUSED_TEXTS`, a `*_TEXTS` table like the guards', so the language packs carry each sentence whole): "… parts of the map could not be joined to the rest, so cracks along their edges may have been missed.", "… pairs of neighbouring regions could not be compared, so slivers between them may have been missed.", "… cracks or slivers that were found could not be repaired, and were left as they are." A map in parts only because parts were left apart is not said to be too detailed. **What a save does to the stock world now.** The search takes 32 s (the gap search 24 s, 3 of them welding; the walk over 11,545 pairs 9 s) and finds 24,661 cracks and 49,647 slivers. The repairs then run until the 90 s cap: 8,000 to 13,000 slivers trimmed and no crack filled yet, since slivers come first, and the note says the check stopped, how many repairs were left for the next save, that the map was checked in 10 parts and 12 pairs of very large regions were not compared, and under it that 322 gaps and 3 pairs were left alone and that some hundred slivers could not be trimmed (those trims polygon-clipping refuses, and they stay). Saved six times over without a reload, the saves trim 8,420, 17,230, 12,167, 9,017 and 2,142 slivers and then fill 7,232 and 14,346 cracks, each in 90 to 101 s (the cap is asked between repairs, and one large fill can run past it), and leave 3,052 of the 74,308 for a seventh. With both limits lifted it is one sweep of 7.8 minutes: three passes, 24,882 cracks filled and 49,043 slivers trimmed across 3,345 regions, 627 repairs refused, no region emptied and none changed in area by more than a fifth (Saint George's in Bermuda gains 17%, Schellenberg in Liechtenstein loses 12%); that map read back is then settled but for 29 cracks and 124 slivers, which its next save repairs in 30 s with nothing refused. The sweep's heap on the stock world peaks at 750 to 850 MB in a process held to 1 GB, and it gets through in one held to 512 MB (it peaked at 419 MB in the 0.3 s it used to last), which took the boundary index below. **Each pair check and each trim is local.** `geometry.js` clips both inputs to the box their extents share before polygon-clipping sees them (Sutherland–Hodgman against the box; exact — the same pieces and areas, pinned by `geometry.test.js` on the built-in map's own pairs — and the cost of the neighbourhood rather than of the region), and the crack-target touch score reads a region's boundary from an index instead of walking every segment for every point (`indexBoundary` in `topologySweep.js`: the segments boxed sixteen at a time in the order the rings run, the boxes in a packed tree, all of it typed arrays over the geometry's own coordinates. It was an R-tree with an object for every segment, 470 bytes each, which nobody had measured on a map the sweep could not get through: for the stock world's regions the R-trees held 1.1 GB, and once that map's unions went through the sweep's heap peaked at 2.7 GB and a run held to 1 GB died. The index holds 14 MB for the same regions, is built in 0.1 s where the R-trees took 2.8 s, and hands back the same segments — `topologySweep.test.js` asks it what a walk over every segment answers). Measured in Node: the built-in map's pass 11 s → 4.5 s; the map with its borders drawn eight times finer 103 s → 25 s; a map with a single 41,000-vertex sea zone, which every coastal region is a neighbour of, 914 s → 14 s a pass — the case that held a player's save for forty minutes. The width does not enter the search, so 1.5 km costs what 500 m did: the built-in map is still read as one union (the largest call 79,546 vertices against the 250,000 budget), in two passes, and the save after it finds nothing. The `BorderCleanupOverlay.jsx` screen ("Cleaning up the borders", progress bar, what is being checked, which pass, the seconds so far, Save now) is painted before the work starts so the page never looks frozen, and stays up until the scenario is written (or, for an export from the standalone editor, the file; it then reads "exporting the map"); a failure in the pass never blocks the save, and a plain Save or such an export leaves a note beside the buttons saying what was fixed — or that the check stopped after so many seconds and what it left for the next save — with a line under it for each kind of thing the guards left alone and each kind polygon-clipping refused. The note stays nine seconds, and five more for each of those lines; Save & Exit and Apply & Play leave the Workshop, so they show the same lines only on the screen, while the scenario is written.

**Export.** `buildGameSeed` emits one `polityOverrides` record per registry entry and per owner (code = stable key, display name, cumulative aliases, colour, status, `verbatim` for a code-shaped key) plus `ownerSchema`, the map's disputes as `world.regionClaimants`, the groups and their areas, the map features and the puppet states, and cities export their authored `tier` (1 town, 2 city, 3 major) with `capital` as an independent flag (`CityPopup.jsx`).

## 25. Reviewing suggested changes (`SuggestionReviewPanel.jsx`)

When a player suggests changes to a community scenario, the author reviews the map's changes here ([game-ui.md §4.8](game-ui.md#48-suggested-changes) covers the rest of the flow). `libraryBar.jsx` `openMapReview` opens the Workshop on the scenario with a `review` prop. Reviewing works like tracked changes in a word processor: every change is listed beside the map and marked on it, and the author accepts or rejects them one at a time, a group at a time, or all at once.

- **The list.** Sections (`REVIEW_SECTIONS`, `src/runtime/suggestionSections.js`): Countries, Who owns which region, Borders, Region names and types, Claims, Groups, Cities, Units, Map features, Puppet states and Map settings. Ownership changes are grouped by from → to ("12 regions: Alpha → Beta"). A border change covers a cluster of neighbouring regions, with one line per region: "New region", "Region removed" or "Region redrawn". Decided changes can be hidden. Clicking a change zooms to it.
- **Status against the open map** (`mapChangeStatus`, `suggestionReview.js`):
  - *open*: the map still has the post's value;
  - *conflict*: the author changed it since posting ("You changed this too"; accepting replaces it);
  - *applied*: already so;
  - *missing*: what it changes is not on this map any more ("Not on your map").

  A new set of cities (`cities-replace`) is a conflict when the author's city count is no longer the post's (or the post had the built-in cities and the map now has its own), and applied when the map has exactly the suggested cities. Accepting "go back to the built-in cities" clears `citiesAuthored`. A custom basemap (`background`) is compared by its kind and a hash of its payload, as the diff fingerprints it.
- **Accepting applies the change at once** (`applyMapChange`, which returns its undo):
  - regions through the map's own API: `setRegionAttrs` for owners, names, types, claims and groups, and `applyRegionPatch` for borders, one undo step;
  - the document's records (countries, groups, cities, units, features, puppet states, the basemap and background) through `useMapDocument`'s setters.

  What a change needs is accepted first (`changeDependencies`: a country or group the suggestion adds). A list is accepted by `acceptMapChanges` (order from `planAccept`): countries and groups first, then the rest, with the ownership rows batched into one map step per country they go to, after every rename in the list. A change written against a country's old name follows a rename the author accepted in the same review. **Undo** takes an acceptance back. Only a change accepted since the Workshop opened has an undo; one accepted in an earlier review shows "To undo it, change it back by hand." and keeps its decision. Undoing a rename renames the country back and then puts both names as they were, so the old country gets its own record, colour, flag and tags back, not the suggestion's.
- **The markup layer** (`useSuggestionMarkup`, zIndex 57). Each change's regions are outlined in amber while it waits, green once accepted and grey once rejected. The suggested new borders are drawn dashed in blue over the old ones, and cities, units and features get a dot. The focused change is drawn in white, on a layer of its own (zIndex 58), so a click redraws that change alone. Where each change is (`changeTargets`) is worked out again only when the changes, the accepted renames or the regions change. The statuses and the targets read the map through a region cache (`createRegionCache`) that the hook makes anew on every `regionEpoch`: each region's measured shape, and which regions each owner and each group holds, are read once per state of the regions, so a document edit re-measures nothing. The statuses stay the same object while none of them changes, so a document edit that settles nothing redraws no markup; a custom basemap's fingerprint is kept per basemap object.
- **Nothing reaches the scenario until the map is saved**, as with any other edit here. After each save, `review.onSaved(review.decisionsForSave())` records the map decisions in the scenario's `hubReviews` (`decisionsFor`: an undecided change the map already has counts as accepted, one whose target is gone as rejected; the panel's count of what is left uses the same rule, `decisionOf`). The suggestion is `done` once every change, on the map and off it, is decided. Closing without saving keeps nothing.

The diff that produced the changes (`src/runtime/scenarioChanges.js`, `diffScenarioBundles`) compares shapes with a tolerance, so the Workshop's own save-time border cleanup, which runs over the whole map on every save, does not read as a suggestion. Coordinates are hashed at 5 decimals. A shape counts as changed when its area moved by more than 0.15%, or by more than a strip a quarter of the cleanup's width (1.5 km in the map's projection, 0.015° here; it was 500 m and 0.005° until the cleanup widened) along its whole border, or when its outline moved by more than that width. The outline leaves out what the cleanup makes and removes with next to no area: spikes (a vertex the ring runs out to and back from within about 6°), sliver tips (out and back within the cleanup's width), specks (parts under about 0.1 km²) and stray parts that are only a sliver. Before this, a save that changed nothing read as 15 border changes on one hub post. It also reads both versions as the stores do: legacy owner codes migrated (`migrateBundleOwners`), a city's size derived as the game derives it (`cityTierOf`), and records the Workshop writes on its own left out.
