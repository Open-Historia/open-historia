/*! Open Historia — Political Cartography Pipeline v2 architecture checks © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const nations = fs.readFileSync(new URL("../Nations.jsx", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("./polityBoundariesWorker.js", import.meta.url), "utf8");
const displayMesh = fs.readFileSync(new URL("./regionDisplayMesh.js", import.meta.url), "utf8");
const displayMeshPolicy = fs.readFileSync(new URL("./regionDisplayMeshPolicy.js", import.meta.url), "utf8");
const renderRepair = fs.readFileSync(new URL("./regionRenderRepair.js", import.meta.url), "utf8");
const polityTextLayer = fs.readFileSync(new URL("../labels/PolityTextLayer.jsx", import.meta.url), "utf8");
const polityTextCustomLayer = fs.readFileSync(new URL("../labels/polityTextCustomLayer.js", import.meta.url), "utf8");
const polityTextPlacement = fs.readFileSync(new URL("../labels/polityTextPlacement.js", import.meta.url), "utf8");
const polityTextRecords = fs.readFileSync(new URL("../labels/polityTextRecords.js", import.meta.url), "utf8");
const polityTextContinuity = fs.readFileSync(new URL("../labels/polityTextContinuity.js", import.meta.url), "utf8");
const ownershipTransitionWorker = fs.readFileSync(new URL("./ownershipTransitionWorker.js", import.meta.url), "utf8");
const polityLabels = fs.readFileSync(new URL("./polityLabels.js", import.meta.url), "utf8");
const world = fs.readFileSync(new URL("../World.jsx", import.meta.url), "utf8");
const natGeoDarkStyle = fs.readFileSync(new URL("../natGeoDarkStyle.js", import.meta.url), "utf8");
const mapLayerOrder = fs.readFileSync(new URL("../mapLayerOrder.js", import.meta.url), "utf8");
const runtimeAssets = fs.readFileSync(new URL("../../../runtime/assets.js", import.meta.url), "utf8");
const editorBasemaps = fs.readFileSync(new URL("../../../Editor/basemaps.js", import.meta.url), "utf8");

// These are intentionally source-level architecture guards. They catch accidental
// reintroduction of the exact ownership/presentation coupling that caused the
// Russia→Poland stale-surface regression before runtime tests ever execute.

test("Pipeline v2 keeps canonical region fills authoritative and removes runtime dissolved polity surfaces", () => {
  assert.match(nations, /CUSTOM_FILL_COLOR/);
  assert.match(nations, /DETAIL_FILL_COLOR/);
  assert.match(nations, /custom-regions-fill/);
  assert.match(nations, /regions-fill/);
  assert.doesNotMatch(nations, /id="polity-surfaces-source"/);
  assert.doesNotMatch(nations, /derivePolitySurfaces/);
  assert.doesNotMatch(worker, /polygon-clipping/);
  assert.doesNotMatch(worker, /derivePolitySurfaces/);
});

test("Pipeline v2 discards obsolete worker revisions rather than publishing them", () => {
  assert.match(nations, /createPoliticalCartographyScheduler/);
  assert.match(nations, /scheduler\.complete\(result\?\.requestId\)/);
  assert.match(
    nations,
    /if \(!completion\.accepted\) \{[\s\S]*?cartographyDiscarded = true[\s\S]*?completion\.superseded[\s\S]*?return;\s*\}/,
  );
  assert.match(nations, /const request = completion\.request/);
});

test("catalog metadata stays early while scenario readiness waits for safe geometry and initial PTR first paint", () => {
  const catalogPost = worker.indexOf('messageType: "catalog-ready"');
  const initializeDerivation = worker.indexOf("initializePoliticalCartography");
  assert.ok(catalogPost >= 0);
  assert.ok(initializeDerivation >= 0);
  // Exact region identity still publishes before expensive derived cartography.
  const onMessage = worker.indexOf("self.onmessage");
  const postWithinHandler = worker.indexOf('messageType: "catalog-ready"', onMessage);
  const deriveMatch = /type === "initialize"\s*\? initializePoliticalCartography/g;
  deriveMatch.lastIndex = onMessage;
  const deriveWithinHandler = deriveMatch.exec(worker)?.index ?? -1;
  assert.ok(postWithinHandler >= 0 && deriveWithinHandler > postWithinHandler);
  assert.match(nations, /primeCustomRegionCatalogEntries/);
  assert.match(nations, /initialCartographySettled/);
  assert.match(nations, /initialRegionRepairSettled/);
  assert.match(nations, /customFlag && !initialRegionRepairSettled/);
  assert.match(worker, /if \(type === "initialize"\) \{[\s\S]*scheduleRegionRenderRepair/);
  assert.match(nations, /ptrBlocksInitialReadiness/);
  assert.match(nations, /!ptrPolityTextStatus\.mounted[\s\S]*!ptrPolityTextStatus\.failed/);
  assert.match(nations, /markPolitiesReady\(regionsGeojsonUrl\)/);
  // The source and the worker fetch through the worker-fetchable URL (a blob:
  // copy on the website); the runtime URL stays the identity above.
  assert.match(nations, /useWorkerFetchableUrl\(regionsGeojsonUrl\)/);
  assert.match(nations, /data=\{regionsGeojsonFetchUrl \|\| EMPTY_FEATURE_COLLECTION\}/);
  assert.match(nations, /regionsUrl: regionsGeojsonFetchUrl,/);
});

test("production PTR placement search runs in a dedicated worker before custom-layer mount", () => {
  assert.match(polityTextLayer, /new Worker\(new URL\("\.\/polityTextPlacementWorker\.js"/);
  assert.match(polityTextLayer, /placementResolved:\s*true/);
  assert.match(polityTextLayer, /preparedEntries/);
});


test("PTR multipart placement avoids long unsupported sea bridges", () => {
  assert.match(polityTextPlacement, /internalGapFraction/);
  assert.match(polityTextPlacement, /needsCompactRecovery/);
  assert.match(polityTextPlacement, /compactFractions/);
  assert.match(polityTextPlacement, /provisionalBest\.ownCoverage < 0\.88/);
  assert.match(polityTextPlacement, /recoveryAngle/);
  assert.match(polityTextPlacement, /bridging disconnected landmasses/);
});

test("prominent sovereign-secondary PTR sites are not forced onto the fast envelope path", () => {
  assert.match(polityTextRecords, /SECONDARY_OPTIMIZED_MIN_PRIORITY_SCALE = 100000/);
  assert.match(polityTextRecords, /siteRole === "sovereign-secondary"/);
  assert.match(polityTextRecords, /Number\(priorityScale\) >= SECONDARY_OPTIMIZED_MIN_PRIORITY_SCALE/);
  assert.match(polityTextRecords, /placementMode: placementModeForSite/);
});

test("PTR steady-state rendering avoids per-frame global sort and offscreen draws", () => {
  assert.match(polityTextCustomLayer, /const drawOrder = sortPreparedEntries\(prepared\)/);
  assert.match(polityTextCustomLayer, /mercatorBounds: boundsFromRibbonVertices/);
  assert.match(polityTextCustomLayer, /viewportMercatorBounds\(this\._map\)/);
  assert.match(polityTextCustomLayer, /_visibleEntries: new Array\(drawOrder\.length\)/);
  assert.match(polityTextCustomLayer, /_visibleOpacity: new Float32Array\(drawOrder\.length\)/);
  assert.match(polityTextCustomLayer, /_textureLocations = \{/);
  // Since #764 the programs are compiled per projection variant in
  // _ensurePrograms, which is where the locations are resolved — once per
  // variant, never per frame. render() only asks it to make sure they exist.
  assert.match(polityTextCustomLayer, /_lineLocations = lineProgram \? \{/);
  assert.match(polityTextCustomLayer, /if \(this\._textureProgram && this\._programVariant === shaderData\.variantName\) return true;/);
  const renderStart = polityTextCustomLayer.indexOf("    render(gl, args) {");
  const removeStart = polityTextCustomLayer.indexOf("    onRemove(", renderStart);
  const renderBody = polityTextCustomLayer.slice(renderStart, removeStart);
  assert.doesNotMatch(renderBody, /\.sort\(/);
  assert.doesNotMatch(renderBody, /getUniformLocation|getAttribLocation/);
});



test("PTR GPU resources are uploaded lazily in bounded batches", () => {
  assert.match(polityTextCustomLayer, /GPU_UPLOADS_PER_FRAME = 12/);
  assert.match(polityTextCustomLayer, /ensureEntryGpuResources/);
  assert.match(polityTextCustomLayer, /pendingVisibleResources/);
  assert.match(polityTextCustomLayer, /uploadsThisFrame >= GPU_UPLOADS_PER_FRAME/);
  assert.match(polityTextCustomLayer, /triggerRepaint/);
  const onAddStart = polityTextCustomLayer.indexOf("    onAdd(map, gl) {");
  const replaceStart = polityTextCustomLayer.indexOf("    replacePreparedEntries(", onAddStart);
  const onAddBody = polityTextCustomLayer.slice(onAddStart, replaceStart);
  assert.doesNotMatch(onAddBody, /for \(const entry of this\._entries\)/);
});

test("WebGL context loss remains instrumented for freeze diagnostics", () => {
  assert.match(world, /webglcontextlost/);
  assert.match(world, /webglcontextrestored/);
  assert.match(world, /recordMapTrace\("gpu:webgl-lost"/);
  assert.match(world, /recordMapTrace\("gpu:webgl-released"/);
  assert.match(world, /mapInstance\?\._removed \|\| !canvas\.isConnected/);
  assert.match(world, /setTimeout\(\(\) => \{/);
  assert.match(world, /recordMapTrace\("gpu:webgl-restored"/);
  assert.match(world, /canvas\.addEventListener\("webglcontextlost", onLost\)/);
  assert.match(world, /canvas\.addEventListener\("webglcontextrestored", onRestored\)/);
});

test("country fills are written again when MapLibre rebuilds the sources holding their feature-state", () => {
  // A restored WebGL context, or a style MapLibre cannot diff (3D Terrain),
  // brings every source back as a new object with no feature-state. The
  // applied-fill ledgers go with the old objects, or the whole map stays grey.
  assert.match(nations, /mapInstance\.on\("styledata", schedule\)/);
  assert.match(nations, /if \(!mapInstance\.style\) return;/);
  assert.match(nations, /seen\.custom && seen\.custom !== next\.custom\) \|\| \(seen\.repair && seen\.repair !== next\.repair/);
  assert.match(nations, /appliedCustomFillStateRef\.current = new Map\(\);\s*setCustomFillSourceEpoch/);
  assert.match(nations, /if \(seen\.tiles && seen\.tiles !== next\.tiles\) \{\s*appliedTileFillStateRef\.current = new Map\(\);\s*setTileFillSourceEpoch/);
  assert.match(nations, /\}, \[\s*customFillSourceEpoch,\s*customFlag,/);
  assert.match(nations, /shouldMountStockRegions, tileFillSourceEpoch\]\);/);
  // A pass still slicing when its ledger was reset must not put the old one back.
  assert.match(nations, /if \(appliedCustomFillStateRef\.current === applied\) appliedCustomFillStateRef\.current = appliedAfterSync;/);
  assert.match(nations, /if \(appliedTileFillStateRef\.current === applied\) appliedTileFillStateRef\.current = appliedAfterSync;/);
  assert.doesNotMatch(nations, /^\s*applied(Custom|Tile)FillStateRef\.current = appliedAfterSync;/m);
});

test("an ownership transition caught by a lost WebGL context or a style rebuild still ends, and the queue moves on", () => {
  // MapLibre drops the custom flood layer with its callbacks (onRemove on a lost
  // context; silently on a rebuilt style), so the sweep that waits for them is
  // ended by the fill-source watcher once the sources come back.
  assert.match(nations, /sweep\.finish = finish;/);
  assert.match(nations, /if \(seen\.custom !== next\.custom && ownershipSweepRef\.current\.active\) ownershipSweepRef\.current\.finish\?\.\(\);\s*appliedCustomFillStateRef\.current = new Map\(\);/);
  // With no style nothing can be read or drawn: finish() waits for the restore
  // instead of committing half a sweep, and the sweep's own frames stand down.
  assert.match(nations, /const finish = \(\) => \{\s*if \(token !== ownershipSweepRef\.current\.token \|\| committed\) return;[\s\S]{0,400}?if \(!mapInstance\.style\) return;\s*committed = true;/);
  assert.match(nations, /data\?\.requestId !== requestId\) return;[\s\S]{0,200}?if \(!mapInstance\.style\) return;/);
  assert.match(nations, /const waitForLayer = \(\) => \{\s*if \(token !== ownershipSweepRef\.current\.token \|\| !mapInstance\.style\) return;/);
  assert.match(nations, /const hydrate = \(\) => \{\s*frame = 0;[\s\S]{0,120}?if \(!mapInstance\.style\) return;/);
});

test("dark promotional basemaps have dedicated runtime paths instead of bright raster aliases", () => {
  assert.match(world, /basemapId === "ocean-dark"/);
  assert.match(world, /loadNatGeoDarkStyle/);
  assert.match(world, /effectiveBasemap === "natgeo-dark"/);
  assert.match(world, /"atlas-relief-dark"/);
  assert.match(world, /basemapId === "midnight-terrain"/);
  assert.match(world, /PAX_WORLD_RELIEF_MIDNIGHT_PAINT/);
  assert.match(world, /PAX_TERRAIN_MIDNIGHT_PAINT/);
  assert.match(world, /PAX_WORLD_RELIEF_MIDNIGHT_PAINT[\s\S]*?"raster-saturation": -0\.96/);
  assert.match(world, /PAX_WORLD_RELIEF_MIDNIGHT_PAINT[\s\S]*?"raster-brightness-max": 0\.16/);
  assert.match(world, /PAX_TERRAIN_MIDNIGHT_PAINT[\s\S]*?"raster-saturation": -0\.92/);
  assert.match(world, /PAX_TERRAIN_MIDNIGHT_PAINT[\s\S]*?"raster-brightness-max": 0\.20/);
  assert.match(world, /PAX_TERRAIN_MIDNIGHT_PAINT[\s\S]*?"raster-contrast": 0\.38/);
  assert.match(world, /5\.40, 0\.70[\s\S]*?6\.50, 0\.74[\s\S]*?12, 0\.78/);
  assert.match(world, /"#000205"/);
  assert.match(editorBasemaps, /id: "midnight-terrain"[\s\S]*previewFilter: "brightness\(0\.15\) saturate\(0\.14\) contrast\(1\.10\)"/);
  assert.match(natGeoDarkStyle, /3d1a30626bbc46c582f148b9252676ce/);
  assert.match(natGeoDarkStyle, /classifyNatGeoDarkLabelLayer/);
  assert.match(natGeoDarkStyle, /kind === "street"/);
  assert.doesNotMatch(natGeoDarkStyle, /Math\.max\(Number\(next\.minzoom \?\? 0\), 12\)/);
  assert.match(natGeoDarkStyle, /COUNTRY_LABEL_SOURCE_LAYERS/);
  assert.match(natGeoDarkStyle, /REGION_LABEL_WORDS/);
  assert.match(natGeoDarkStyle, /if \(has\(descriptor, ADMIN_FILL_WORDS\)\) return null/);
  assert.match(natGeoDarkStyle, /openhistoria:natgeo-reference-tier/);
  assert.match(mapLayerOrder, /openhistoria:natgeo-reference-tier/);
  assert.match(mapLayerOrder, /custom-regions-disputed-vnext/);
  assert.match(mapLayerOrder, /polity-boundaries/);
  assert.match(natGeoDarkStyle, /sprite: sourceStyle\.sprite/);
  assert.match(natGeoDarkStyle, /darkenNatGeoColor/);
  assert.match(natGeoDarkStyle, /oh-natgeo-dark-physical/);
  assert.match(natGeoDarkStyle, /World_Physical_Map/);
  assert.match(natGeoDarkStyle, /normalizeNatGeoVectorSource/);
  assert.match(natGeoDarkStyle, /tile\/\{z\}\/\{y\}\/\{x\}\.pbf/);
  assert.doesNotMatch(natGeoDarkStyle, /oh-natgeo-dark-hillshade/);
  assert.match(natGeoDarkStyle, /glyphs: sourceStyle\.glyphs/);
  assert.match(world, /Changing basemap…/);
  assert.match(world, /basemapTransition\.progress/);
  assert.match(world, /transition\.target === "natgeo-dark"/);
  assert.match(world, /ptrMountedBeforeBasemapCommit/);
  assert.match(world, /waitForPtr/);
  assert.match(world, /getLayer\?\.\("polity-text-renderer"\)/);
  assert.match(world, /noteBasemapTransitionProgress\(94\)/);
  assert.match(runtimeAssets, /id: "natgeo-dark"/);
  assert.match(editorBasemaps, /id: "natgeo-dark"/);
  assert.match(runtimeAssets, /id: "midnight-terrain"[\s\S]*service: "World_Terrain_Base"/);
  assert.match(editorBasemaps, /id: "midnight-terrain"[\s\S]*service: "World_Terrain_Base"/);
});

test("label geometry is worker-owned and Nations never fits live polity polygons on the main thread", () => {
  assert.match(worker, /buildPolityLabelCollections/);
  assert.match(worker, /aggregatePolityGeometryForOwners/);
  assert.doesNotMatch(nations, /buildPolityLabelCollections/);
  assert.match(nations, /setPolityLabelCollections/);
});

test("ownership changes patch boundaries immediately without forcing huge-label rebuilds for tiny deltas", () => {
  assert.match(worker, /updatePoliticalBoundaryState/);
  assert.match(worker, /changedRegionIds/);
  assert.match(worker, /chooseOwnershipLabelRefreshOwners/);
  assert.match(worker, /LARGE_OWNER_LABEL_VERTEX_THRESHOLD = 60000/);
  assert.match(worker, /labelChangeDebtByOwner/);
  assert.match(worker, /deferredLabelOwners/);
  assert.match(nations, /visibleBoundaryFilter/);
  assert.match(nations, /dirtyPoliticalOwners/);
  assert.match(nations, /ownershipDeferredLabelOwnerCount/);
  assert.match(nations, /updateData/);
});

test("large-polity coverage checks use a spatial index without changing territorial semantics", () => {
  assert.match(polityLabels, /buildComponentTileSpatialIndex/);
  assert.match(polityLabels, /cellCandidates|cells/);
  assert.match(polityLabels, /spatialIndex: componentSpatialIndex/);
  assert.match(polityLabels, /index\.contains\(\[x, y\]\)/);
});

test("legal ownership animation keeps canonical ownership separate from bounded flood/sweep presentation", () => {
  // The political worker owns transfer metadata; presentation workers/layers own animation.
  assert.match(worker, /const buildOwnershipTransitionData/);
  assert.match(worker, /fromOwner/);
  assert.match(worker, /toOwner/);
  assert.match(worker, /sweepDx/);
  assert.match(worker, /sweepDy/);

  // Flood is the preferred visual path; the bounded directional sweep remains the fallback.
  assert.match(nations, /createOwnershipFloodCustomLayer/);
  assert.match(nations, /OWNERSHIP_FLOOD_PREP_BUDGET_MS = 350/);
  assert.match(nations, /ownership-transition-sweep-source/);
  assert.match(nations, /ownership-transition-sweep-fill/);
  assert.match(nations, /ownershipTransitionHidden/);
  assert.match(nations, /ownershipTransitionQueueRef\.current\.push/);
  assert.match(
    nations,
    /new Worker\(new URL\("\.\/vnext\/ownershipTransitionWorker\.js"/,
  );
  assert.match(nations, /prefers-reduced-motion/);
  assert.match(ownershipTransitionWorker, /transitionT/);

  // Animation stays presentation-only; canonical political colour is not rewritten as an effect.
  assert.doesNotMatch(nations, /transitionColor/);
  assert.doesNotMatch(nations, /ownership-transition-fill-repair/);
});

test("mid-campaign PTR updates publish immediately, cancel stale solves, and refine only changed records", () => {
  assert.match(polityTextLayer, /Do not make them a dependency of the[\s\S]*mount effect/);
  assert.match(polityTextLayer, /runtime\.layer\.replacePreparedEntries/);
  assert.match(polityTextLayer, /incrementalChangedRecordCount/);
  assert.match(polityTextLayer, /incrementalChangedOwnerCount/);
  assert.match(polityTextLayer, /mounted: Boolean\(runtime\.layer/);
  assert.match(
    polityTextLayer,
    /runtime\.pendingSync = true;[\s\S]*runtime\.generation \+= 1;[\s\S]*cancelPlacementSolve\(\)/,
  );
  assert.match(polityTextLayer, /const cancel = runtime\.cancelPlacement/);
  assert.match(polityTextLayer, /onWorker\(worker, cancel\)/);
  assert.match(
    polityTextLayer,
    /if \(runtime\.layer && changedRecords\.length\) \{[\s\S]*optimizePlacement: false[\s\S]*publishPrepared\(provisional\)/,
  );
  assert.match(polityTextLayer, /placementTimeoutMs: initialMount \? 30000 : 4000/);
  assert.match(polityTextContinuity, /previousFingerprints\.get\(key\) !== fingerprint/);
  assert.doesNotMatch(polityTextLayer, /\[debugBaseline, enabled, fontFamilies, haloColor, map, mode, onStatusChange, records, textColor\]/);
});

test("custom political maps do not build an unused stock-country label atlas", () => {
  assert.match(nations, /if \(customFlag\) \{[\s\S]*setPointLabelData\(EMPTY_FEATURE_COLLECTION\)[\s\S]*setCurvedLabelData\(EMPTY_FEATURE_COLLECTION\)/);
});

test("dirty boundary filtering is owner-list based rather than capped to four overlapping owners", () => {
  assert.match(nations, /\["in", owner, \["get", "ownerList"\]\]/);
});

test("coalesced ownership or claim revisions cannot swallow simultaneous label invalidation", () => {
  assert.match(
    nations,
    /affectedOwners:\s*\[\.\.\.new Set\(\[\.\.\.diff\.affectedOwners, \.\.\.changedLabelOwners\]\)\]/,
  );
  assert.match(
    nations,
    /type:\s*"update-claims"[\s\S]*?affectedOwners:\s*changedLabelOwners/,
  );
  assert.match(
    worker,
    /if \(type === "update-claims"\)[\s\S]*?rebuildLabelsForOwners\(owners\)/,
  );
});

test("switching custom-map geometry invalidates old derived cartography before the new worker publishes", () => {
  assert.match(nations, /const cartographyGeometryEpochRef = useRef\(""\)/);
  assert.match(nations, /previousGeometryEpoch !== geometryEpoch/);
  assert.match(nations, /if \(geometryChanged\) \{[\s\S]*?clearDerivedCartography\(\{ resetMetadata: true \}\)/);
  assert.match(nations, /let catalogReady = Boolean\(customRegionMeta\.ready && !geometryChanged\)/);
  assert.match(nations, /catalogReady = true;[\s\S]*?setCustomRegionMeta\(metadata\)/);
});

test("political fill opacity expressions keep zoom at MapLibre top level", () => {
  assert.match(
    nations,
    /const buildPaxPoliticalFillOpacity = \(hiddenExpression = null\) => \[\s*"interpolate", \["linear"\], \["zoom"\]/,
  );
  assert.match(nations, /const PAX_POLITICAL_FILL_OPACITY = buildPaxPoliticalFillOpacity\(\)/);
  assert.match(
    nations,
    /const transitionAwareFillOpacity = useMemo\([\s\S]*?buildPaxPoliticalFillOpacity\(\[\s*"boolean",[\s\S]*?"ownershipTransitionHidden"/,
  );
  assert.doesNotMatch(
    nations,
    /const transitionAwareFillOpacity = useMemo\([\s\S]*?\[\s*"case",[\s\S]*?PAX_POLITICAL_FILL_OPACITY/,
  );
  assert.match(nations, /const DISPUTED_TILE_FILL_OPACITY = PAX_POLITICAL_FILL_OPACITY/);
  assert.doesNotMatch(nations, /\["\*", PAX_POLITICAL_FILL_OPACITY,/);
  assert.doesNotMatch(nations, /\["\*", TILE_FILL_FADE,/);
  assert.doesNotMatch(nations, /\["-", 1, TILE_FILL_FADE\]/);
});

test("whole-world display mesh stays quarantined while targeted malformed-region repair is live", () => {
  assert.doesNotMatch(worker, /buildRegionDisplayMeshBlob/);
  assert.doesNotMatch(worker, /scheduleDisplayMeshBuild/);
  assert.doesNotMatch(worker, /display-mesh-ready/);
  assert.match(displayMeshPolicy, /REGION_DISPLAY_MESH_ENABLED = false/);
  assert.match(displayMesh, /canonical scenario geometry is never mutated/i);

  assert.match(worker, /buildRegionRenderRepair/);
  assert.match(worker, /messageType: "render-repair-ready"/);
  assert.match(nations, /id="custom-regions-repair-source"/);
  assert.match(nations, /id="custom-regions-repair-fill"/);
  assert.match(nations, /id="custom-regions-repair-fill-far"/);
  assert.match(nations, /repairedRegionIds/);
  assert.match(nations, /canonicalCustomFarStockGeometryFilter/);
  assert.match(nations, /canonicalCustomAuthoritativeGeometryFilter/);
  assert.match(renderRepair, /maxAreaDriftRatio/);
  assert.match(renderRepair, /ringHasSelfIntersection/);
  assert.match(renderRepair, /stripDegenerateDetachedPolygons/);
  assert.doesNotMatch(renderRepair, /Austria|Graz|Kazakhstan|Karagandy|Egypt|Al Minya|Western Desert|Siwa|Al Binya/);
  assert.doesNotMatch(nations, /id="polity-surfaces-source"/);
});

test("hybrid map fallback keeps exact ownership and stock hit-testing even when authored geometry exists", () => {
  assert.match(
    nations,
    /for \(const \[regionId, owner\] of Object\.entries\(regionOwnershipOverrides \?\? \{\}\)\)[\s\S]*lookup\.set\(id, owner \?\? ""\)/,
  );
  assert.match(nations, /const candidateLayers = \(scenarioOwnsRegionGeometryAtAllZooms/);
  assert.match(nations, /"regions-fill"/);
  assert.doesNotMatch(nations, /const candidateLayers = \(hasDrawnGeometry/);
});

test("stock-vs-authored provenance is explicit rather than inferred from punctuation in region ids", () => {
  assert.match(worker, /isExplicitAuthoredGeometry\(feature, index\)/);
  assert.match(worker, /authored,/);
  assert.doesNotMatch(worker, /id\.includes\("\."\)/);
  assert.doesNotMatch(nations, /id\.includes\("\."\)/);
  assert.match(nations, /\["==", \["get", "edited"\], true\]/);
  assert.match(nations, /\["==", \["get", "geometrySource"\], "authored"\]/);
  assert.match(nations, /"reg_"/);
  assert.doesNotMatch(nations, /CUSTOM_GEOMETRY_FILTER/);
  assert.doesNotMatch(nations, /GADM_GEOMETRY_FILTER/);
});

test("legacy tier-2 scenario geometry can own an entire stock-country cohort without polity-name special cases", () => {
  assert.match(nations, /deriveLegacyAuthoritativeCountryCodes/);
  assert.match(nations, /const legacyAuthoritativeCountryCodes = useMemo/);
  assert.match(nations, /\["upcase", \["get", "GID_0"\]\], \["literal", legacyAuthoritativeCountryCodes\]/);
  assert.match(nations, /SCENARIO_GID0_EXPRESSION/);
  assert.match(nations, /filter=\{stockRegionsVisibilityFilter\}/);
  assert.match(nations, /filter=\{customAuthoritativeGeometryFilter\}/);
  assert.match(nations, /filter=\{customFarStockGeometryFilter\}/);
  assert.doesNotMatch(nations, /Austrian Empire|Niederösterreich|Vienna Outskirts/);
});

test("close-zoom region-tile authority requires exact scenario/catalog identity", () => {
  assert.match(nations, /loadRegionTileIdSet/);
  assert.match(nations, /hasExactRegionTileIdentity/);
  assert.match(nations, /const regionTileHandoffSafe = Boolean/);
  assert.match(nations, /const scenarioOwnsRegionGeometryAtAllZooms/);
  assert.match(nations, /const shouldMountStockRegions = !customFlag \|\| regionTileHandoffSafe/);
  assert.match(nations, /maxzoom=\{!regionTileHandoffSafe \? undefined : STOCK_REGION_HANDOFF_ZOOM\}/);
  assert.match(nations, /const candidateLayers = \(scenarioOwnsRegionGeometryAtAllZooms/);
  assert.doesNotMatch(nations, /id\.includes\("\."\)/);
});
