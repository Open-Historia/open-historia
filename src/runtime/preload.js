import {
  JSON_URLS,
  PMTILES_ARCHIVES,
  TERRAIN_TILE_TEMPLATE,
  buildTileUrl,
  esriTileTemplate,
  loadCountryNames,
  readJson,
  selectedBasemapId,
  warmJson,
  warmPmtilesArchive,
  warmRemoteResources,
} from "./assets.js";
import { warmCountryLabelCollections } from "./countryLabels.js";
import { logDebugEvent } from "./debugLog.js";

export const STARTUP_TIME_BUDGET_MS = 30_000;
const INITIAL_VIEWPORT = {
  latitude: 0,
  longitude: 0,
};

// ESRI and the AWS terrain bucket both speak HTTP/2, so these are multiplexed
// streams rather than sockets — 6 left the pipe mostly idle for the whole warm.
// 12 matches the parallelism configureMapRuntime() already hands MapLibre for
// exactly these hosts.
const TEXTURE_WARM_CONCURRENCY = 12;

const buildGlobalTextureUrls = (template, maxZoom) => {
  const urls = [];

  for (let z = 0; z <= maxZoom; z += 1) {
    const dimension = 2 ** z;
    for (let x = 0; x < dimension; x += 1) {
      for (let y = 0; y < dimension; y += 1) {
        urls.push(buildTileUrl(template, { x, y, z }));
      }
    }
  }

  return urls;
};

const lngLatToTile = (longitude, latitude, zoom) => {
  const tilesPerAxis = 2 ** zoom;
  const latRad = (latitude * Math.PI) / 180;
  const rawX = ((longitude + 180) / 360) * tilesPerAxis;
  const rawY =
    ((1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2) *
    tilesPerAxis;

  return {
    x: Math.floor(rawX),
    y: Math.max(0, Math.min(tilesPerAxis - 1, Math.floor(rawY))),
  };
};

const buildInitialViewportTextureUrls = (
  template,
  { latitude, longitude } = INITIAL_VIEWPORT,
) => {
  const zoomWindows = [
    { xRadius: 1, yRadius: 1, z: 3 },
    { xRadius: 2, yRadius: 1, z: 4 },
  ];

  return zoomWindows.flatMap(({ xRadius, yRadius, z }) => {
    const tilesPerAxis = 2 ** z;
    const center = lngLatToTile(longitude, latitude, z);
    const urls = [];

    for (let dx = -xRadius; dx <= xRadius; dx += 1) {
      for (let dy = -yRadius; dy <= yRadius; dy += 1) {
        const x = (center.x + dx + tilesPerAxis) % tilesPerAxis;
        const y = center.y + dy;

        if (y < 0 || y >= tilesPerAxis) continue;

        urls.push(buildTileUrl(template, { x, y, z }));
      }
    }

    return urls;
  });
};

// The tasks form a dependency GRAPH, not a queue: `deps` names the ids a task
// waits on, and everything else runs concurrently. Running them serially stacked
// ~2 s of remote texture fetches on top of ~162 MB of local archive reads that
// never contended for the same resource, so the startup screen stayed up for the
// SUM of every task rather than the longest chain through them.
//
// `background: true` marks a task that starts with the rest but does not hold
// the startup screen open. It keeps running after the game is playable and
// carries no abort signal — the time budget is a ceiling on the wait, and must
// not cancel work nothing is waiting on. Only warms qualify: a background task
// may make the map faster later, but the map has to render correctly without it.
const STARTUP_TASKS = [
  {
    id: "state",
    label: "Syncing saves and runtime state",
    weight: 12,
    deps: [],
    run: ({ signal }) =>
      Promise.all([
        warmJson(JSON_URLS.game, { signal }),
        warmJson(JSON_URLS.prompts, { signal }),
        warmJson(JSON_URLS.colors, { signal }),
        warmJson(JSON_URLS.actions, { defaultValue: [], signal }),
        warmJson(JSON_URLS.chat, { defaultValue: [], signal }),
        warmJson(JSON_URLS.advisor, { defaultValue: [], signal }),
        warmJson(JSON_URLS.events, { defaultValue: [], signal }),
        warmJson(JSON_URLS.world, { defaultValue: {}, signal }),
      ]),
  },
  {
    id: "textures",
    label: "Warming world textures",
    weight: 20,
    // Depends on `state` only for world.json. readJson would dedupe a concurrent
    // read anyway, so this costs nothing; the ordering is what keeps "a custom
    // map fires zero ESRI requests" a guarantee rather than a race.
    deps: ["state"],
    run: async ({ signal }) => {
      // A custom map background replaces the ESRI basemap + terrain entirely, so
      // for such scenarios the map never requests those tiles — don't warm them.
      // world.json was already warmed into cache by the "state" task above.
      const world = await readJson(JSON_URLS.world, { defaultValue: {} }).catch(() => ({}));
      if (world?.background?.kind) return undefined;
      return warmRemoteResources(
        [
          ...buildGlobalTextureUrls(esriTileTemplate(selectedBasemapId()), 2),
          ...buildInitialViewportTextureUrls(esriTileTemplate(selectedBasemapId())),
          ...buildGlobalTextureUrls(TERRAIN_TILE_TEMPLATE, 2),
          ...buildInitialViewportTextureUrls(TERRAIN_TILE_TEMPLATE),
        ],
        { concurrency: TEXTURE_WARM_CONCURRENCY, signal },
      );
    },
  },
  {
    id: "countries",
    // Warmed on every map, custom included: countries.pmtiles is not only
    // rendered, it is also where the country index and the country labels come
    // from. BACKGROUND for the same reason as regions, though — the two derived
    // catalogs below read exactly ONE tile out of it, z0, which is 40 KB of a
    // 60 MB archive. Range-reading that costs a couple of round trips; making the
    // startup screen wait for the other 59.96 MB bought nothing.
    label: "Caching country geometry",
    weight: 26,
    deps: [],
    background: true,
    run: ({ signal }) => warmPmtilesArchive(PMTILES_ARCHIVES.countries, { signal }),
  },
  {
    id: "country-index",
    label: "Building country index",
    weight: 8,
    // Deliberately NOT `deps: ["countries"]`. It reads the z0 tile, which
    // getPmtilesArchive serves over range reads while the full archive warms in
    // the background; waiting for the whole thing would put 60 MB in front of a
    // 40 KB read. The archive is registered under its URL either way, so whichever
    // source is live when this runs answers with the same bytes.
    deps: [],
    run: () => loadCountryNames(),
  },
  {
    id: "country-labels",
    label: "Building country labels",
    weight: 14,
    // Same z0-only read as country-index — see the note there.
    deps: [],
    run: () => warmCountryLabelCollections(),
  },
  {
    id: "cities",
    label: "Caching city layer",
    weight: 10,
    deps: [],
    run: ({ signal }) => warmPmtilesArchive(PMTILES_ARCHIVES.cities, { signal }),
  },
  {
    id: "regions",
    // Warmed on EVERY world, custom included — this archive is what paints
    // owners above z6.5 on a re-ownership scenario (Nations.jsx: regions-fill
    // fades in as the seed's far layer fades out), so a custom map needs it just
    // as much as a stock one.
    //
    // BACKGROUND, though, because nothing on the opening screen reads it. The
    // camera starts at z3.5, where TILE_FILL_FADE still holds regions-fill at
    // zero opacity, and the consumers of the archive outside rendering
    // (loadRegionCatalog, the click handler) each read a single z0 tile. Until
    // the full buffer lands, getPmtilesArchive answers from the same archive over
    // HTTP range reads — correct, just a round trip per tile — and
    // primePmtilesArchive swaps the in-memory source in underneath by URL key
    // when it does. Holding the startup screen open for ~101 MB that nothing was
    // about to draw was the single largest piece of the wait.
    label: "Caching regional borders",
    weight: 24,
    deps: [],
    background: true,
    run: ({ signal }) => warmPmtilesArchive(PMTILES_ARCHIVES.regions, { signal }),
  },
];

const TASKS_BY_ID = new Map(STARTUP_TASKS.map((task) => [task.id, task]));
const GATING_TASKS = STARTUP_TASKS.filter((task) => !task.background);
const TOTAL_WEIGHT = GATING_TASKS.reduce((sum, task) => sum + task.weight, 0);

const normalizeTaskResult = (result) => {
  if (!result) return 0;

  if (Array.isArray(result)) {
    return result.reduce((sum, entry) => sum + normalizeTaskResult(entry), 0);
  }

  return Number(result.size) || 0;
};

// Only gating tasks are listed. The screen dismisses the moment they finish, so a
// background row could only ever be drawn mid-flight — it would read as a step
// that never completed.
const buildStepState = (activeIds, completedIds) =>
  GATING_TASKS.map((task) => ({
    id: task.id,
    label: task.label,
    status: completedIds.has(task.id)
      ? "done"
      : activeIds.has(task.id)
      ? "active"
      : "pending",
  }));

export const createInitialStartupState = () => ({
  activeId: null,
  completed: 0,
  done: false,
  elapsedMs: 0,
  errors: [],
  loadedBytes: 0,
  progress: 0,
  stage: "Starting preload",
  steps: buildStepState(new Set(), new Set()),
  timeBudgetMs: STARTUP_TIME_BUDGET_MS,
  timedOut: false,
  total: GATING_TASKS.length,
});

// Held at module scope so a background warm that outlives runStartupPreload stays
// reachable — and its rejection stays handled — after the caller has moved on.
let backgroundWarms = [];

export const runStartupPreload = async ({
  onProgress,
  timeBudgetMs = STARTUP_TIME_BUDGET_MS,
} = {}) => {
  const activeIds = new Set();
  const completedIds = new Set();
  const errors = [];
  const startedAt = performance.now();
  const results = new Map();
  let completedWeight = 0;
  let loadedBytes = 0;
  let timedOut = false;

  const publish = (stage, done = false) => {
    // Several tasks run at once now, so `activeId` reports the heaviest of them —
    // the one the wait is actually made of — rather than "the current step".
    const heaviestActive = GATING_TASKS.filter((task) => activeIds.has(task.id)).sort(
      (a, b) => b.weight - a.weight,
    )[0];

    onProgress?.({
      activeId: heaviestActive?.id ?? null,
      completed: completedIds.size,
      done,
      elapsedMs: Math.min(timeBudgetMs, performance.now() - startedAt),
      errors: [...errors],
      loadedBytes,
      progress: Math.round((completedWeight / TOTAL_WEIGHT) * 100),
      stage,
      steps: buildStepState(activeIds, completedIds),
      timeBudgetMs,
      timedOut,
      total: GATING_TASKS.length,
    });
  };

  publish("Preparing the world");

  // One controller for the whole gating set rather than one per task: with tasks
  // running concurrently there is no "remaining budget for this step" left to
  // divide up, and the budget was only ever a ceiling on the startup screen.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort("startup-time-budget");
  }, timeBudgetMs);

  const runTask = (task) => {
    const started = results.get(task.id);
    if (started) return started;

    const promise = (async () => {
      // allSettled, not all: a failed dependency is already recorded as an error,
      // and every dependent here re-reads what it needs lazily on its own, so
      // blocking it forever would be the worse failure.
      await Promise.allSettled(
        (task.deps ?? []).map((id) => runTask(TASKS_BY_ID.get(id))),
      );

      if (!task.background && controller.signal.aborted) {
        throw controller.signal.reason || new DOMException("Aborted", "AbortError");
      }

      const taskStartedAt = performance.now();
      activeIds.add(task.id);
      if (!task.background) publish(task.label);

      try {
        const result = await task.run({
          signal: task.background ? undefined : controller.signal,
        });
        const bytes = normalizeTaskResult(result);
        logDebugEvent(
          "startup",
          `Preload task "${task.id}" finished`,
          {
            ms: Math.round(performance.now() - taskStartedAt),
            bytes,
            ...(task.background ? { background: true } : {}),
          },
          { verbose: true },
        );
        return { bytes };
      } finally {
        activeIds.delete(task.id);
      }
    })();

    results.set(task.id, promise);
    return promise;
  };

  // Launched alongside the gating set, then deliberately not awaited.
  backgroundWarms = STARTUP_TASKS.filter((task) => task.background).map((task) =>
    runTask(task).catch((error) => {
      console.warn(`Background preload task "${task.id}" failed:`, error);
      return null;
    }),
  );

  await Promise.all(
    GATING_TASKS.map((task) =>
      runTask(task).then(
        ({ bytes }) => {
          completedIds.add(task.id);
          completedWeight += task.weight;
          loadedBytes += bytes;
          publish(task.label);
        },
        (error) => {
          if (controller.signal.aborted) {
            timedOut = true;
            return;
          }

          console.error(`Startup preload failed during "${task.id}":`, error);
          errors.push({
            id: task.id,
            message: error instanceof Error ? error.message : String(error),
          });
          publish(task.label);
        },
      ),
    ),
  );

  clearTimeout(timeoutId);

  publish(
    timedOut
      ? "30-second budget reached. Remaining assets will continue loading in-game"
      : "World is ready",
    true,
  );

  const durationMs = performance.now() - startedAt;
  logDebugEvent("startup", "Startup preload complete", {
    ms: Math.round(durationMs),
    mb: Math.round((loadedBytes / 1048576) * 10) / 10,
    ...(errors.length ? { failed: errors.map((entry) => entry.id).join(",") } : {}),
    ...(timedOut ? { timedOut: true } : {}),
  });

  return {
    durationMs,
    errors,
    loadedBytes,
    timedOut,
  };
};

// The archives still warming after the startup screen dismissed. Awaiting this is
// optional — the map renders from range reads meanwhile — but a caller that
// genuinely needs a whole archive resident (a bulk export, say) can.
export const whenBackgroundWarmsSettle = () => Promise.allSettled(backgroundWarms);
