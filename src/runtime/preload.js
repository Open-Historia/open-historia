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

export const STARTUP_TIME_BUDGET_MS = 30_000;
const INITIAL_VIEWPORT = {
  latitude: 0,
  longitude: 0,
};

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

// A custom map draws its own geometry and NEVER draws the stock world's tiles —
// Nations.jsx does not even mount those sources when world.customRegions is set.
// Warming them anyway meant every custom-map player downloaded 161MB of
// modern-day Earth to render none of it, which on the website is the single
// longest thing between pressing play and seeing a map.
//
// Safe to read here: the "state" task above already warmed JSON_URLS.world and
// runs before these, so this resolves from cache rather than adding a request.
// Defaults to false — an unreadable world cannot be PROVEN custom, and warming
// tiles we might not need is a slow start, while skipping tiles we do need is a
// blank map.
const worldIsCustom = async () => {
  try {
    const world = await readJson(JSON_URLS.world, { defaultValue: {} });
    return Boolean(world?.customRegions);
  } catch {
    return false;
  }
};

const STARTUP_TASKS = [
  {
    id: "state",
    label: "Syncing saves and runtime state",
    weight: 12,
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
        { concurrency: 6, signal },
      );
    },
  },
  {
    id: "countries",
    label: "Caching country geometry",
    weight: 26,
    // NOT skipped on a custom map, unlike regions below. countries.pmtiles is
    // not only rendered: loadCountryNames reads its z0 tile for the country index
    // (assets.js) and warmCountryLabelCollections reads it for the labels
    // (countryLabels.js), and both run for every map. Skipping the warm would not
    // avoid the download — it would just make those tasks fetch the whole archive
    // lazily, later, and serially. Strictly worse than warming it here.
    run: ({ signal }) => warmPmtilesArchive(PMTILES_ARCHIVES.countries, { signal }),
  },
  {
    id: "country-index",
    label: "Building country index",
    weight: 8,
    run: () => loadCountryNames(),
  },
  {
    id: "country-labels",
    label: "Building country labels",
    weight: 14,
    run: () => warmCountryLabelCollections(),
  },
  {
    id: "cities",
    label: "Caching city layer",
    weight: 10,
    run: ({ signal }) => warmPmtilesArchive(PMTILES_ARCHIVES.cities, { signal }),
  },
  {
    id: "regions",
    label: "Caching regional borders",
    weight: 24,
    run: async ({ signal }) => {
      if (await worldIsCustom()) return;
      await warmPmtilesArchive(PMTILES_ARCHIVES.regions, { signal });
    },
  },
];

const TOTAL_WEIGHT = STARTUP_TASKS.reduce((sum, task) => sum + task.weight, 0);

const normalizeTaskResult = (result) => {
  if (!result) return 0;

  if (Array.isArray(result)) {
    return result.reduce((sum, entry) => sum + normalizeTaskResult(entry), 0);
  }

  return Number(result.size) || 0;
};

const buildStepState = (activeId, completedIds) =>
  STARTUP_TASKS.map((task) => ({
    id: task.id,
    label: task.label,
    status: completedIds.has(task.id)
      ? "done"
      : activeId === task.id
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
  steps: buildStepState(null, new Set()),
  timeBudgetMs: STARTUP_TIME_BUDGET_MS,
  timedOut: false,
  total: STARTUP_TASKS.length,
});

export const runStartupPreload = async ({
  onProgress,
  timeBudgetMs = STARTUP_TIME_BUDGET_MS,
} = {}) => {
  const completedIds = new Set();
  const errors = [];
  const startedAt = performance.now();
  let completedWeight = 0;
  let loadedBytes = 0;
  let timedOut = false;

  const publish = (stage, activeId = null, done = false) => {
    onProgress?.({
      activeId,
      completed: completedIds.size,
      done,
      elapsedMs: Math.min(timeBudgetMs, performance.now() - startedAt),
      errors: [...errors],
      loadedBytes,
      progress: Math.round((completedWeight / TOTAL_WEIGHT) * 100),
      stage,
      steps: buildStepState(activeId, completedIds),
      timeBudgetMs,
      timedOut,
      total: STARTUP_TASKS.length,
    });
  };

  publish("Preparing the world");

  for (const task of STARTUP_TASKS) {
    const elapsedMs = performance.now() - startedAt;
    const remainingMs = timeBudgetMs - elapsedMs;

    if (remainingMs <= 0) {
      timedOut = true;
      break;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("startup-time-budget"), remainingMs);

    publish(task.label, task.id);

    try {
      const result = await task.run({ signal: controller.signal });
      completedIds.add(task.id);
      completedWeight += task.weight;
      loadedBytes += normalizeTaskResult(result);
    } catch (error) {
      if (controller.signal.aborted) {
        timedOut = true;
        clearTimeout(timeoutId);
        break;
      }

      console.error(`Startup preload failed during "${task.id}":`, error);
      errors.push({
        id: task.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  publish(
    timedOut
      ? "30-second budget reached. Remaining assets will continue loading in-game"
      : "World is ready",
    null,
    true,
  );

  return {
    durationMs: performance.now() - startedAt,
    errors,
    loadedBytes,
    timedOut,
  };
};
