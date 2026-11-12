import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEXT_COLOR = "rgba(250, 249, 244, 0.995)";
const HALO_COLOR = "rgba(4, 6, 9, 0.96)";
const RASTER_SAMPLES = 128;
const here = path.dirname(fileURLToPath(import.meta.url));
const LABEL_BUNDLE = path.join(here, "..", "dist", "labels.mjs");

const roundPoint = (value) => Math.round(Number(value) * 1e8) / 1e8;

const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
};

const runPolityTextWorker = async () => {
  for (const method of ["log", "info", "debug", "warn"]) {
    console[method] = (...args) => process.stderr.write(`${args.map(String).join(" ")}\n`);
  }
  const bundle = await import(pathToFileURL(LABEL_BUNDLE).href);
  const geometry = bundle.polityGeometry;
  const labels = bundle.polityLabels;
  const recordsModule = bundle.polityTextRecords;
  const layer = bundle.polityTextCustomLayer;
  const placement = bundle.polityTextPlacement;
  const continuity = bundle.polityTextContinuity;
  const { toCountryName } = bundle.ownerNames;
  const codeHash = crypto.createHash("sha256");
  for (const source of [LABEL_BUNDLE, fileURLToPath(import.meta.url)]) codeHash.update(fs.readFileSync(source));
  const codeVersion = codeHash.digest("hex");
  const cacheRoot = workerData.cacheDir ? path.join(String(workerData.cacheDir), "polity-text") : "";
  let cacheFile = "";
  let cacheDirty = false;

  let measured = null;
  const measuringContext = {
    font: "",
    fontKerning: "normal",
    letterSpacing: "0px",
    measureText: () => ({
      width: measured?.width ?? 0,
      actualBoundingBoxAscent: measured?.ascent ?? 0,
      actualBoundingBoxDescent: measured?.descent ?? 0,
    }),
  };
  globalThis.document = {
    createElement(tag) {
      if (String(tag).toLowerCase() !== "canvas") throw new Error(`No <${tag}> in the label worker.`);
      return { width: 0, height: 0, getContext: () => measuringContext };
    },
  };

  let regions = { type: "FeatureCollection", features: [] };
  let regionsFile = "";
  let baseOwners = [];
  const ownerLabels = new Map();
  const session = crypto.randomUUID();
  let revision = 0;
  let snapshotDigest = "";
  let snapshot = [];
  let entryCache = new Map();

  const loadRegions = (file) => {
    if (file === regionsFile && regions.features.length) return;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    regions = { type: "FeatureCollection", features: Array.isArray(parsed?.features) ? parsed.features : [] };
    regionsFile = file;
    ownerLabels.clear();
    entryCache = new Map();
    snapshotDigest = "";
    cacheDirty = false;
    cacheFile = cacheRoot ? path.join(cacheRoot, `${path.basename(file, path.extname(file))}.json`) : "";
    if (cacheFile) {
      try {
        const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        if (saved?.version === codeVersion) {
          for (const [owner, entry] of Object.entries(saved.owners ?? {})) ownerLabels.set(owner, entry);
          for (const [key, entry] of Object.entries(saved.entries ?? {})) entryCache.set(key, entry);
        }
      } catch {
        ownerLabels.clear();
        entryCache = new Map();
      }
    }
    const owners = new Set();
    for (const feature of regions.features) {
      const owner = feature?.properties?.owner;
      if (owner) owners.add(String(owner));
    }
    baseOwners = [...owners];
  };

  const saveCache = () => {
    if (!cacheFile || !cacheDirty) return;
    cacheDirty = false;
    try {
      writeAtomic(cacheFile, JSON.stringify({
        version: codeVersion,
        owners: Object.fromEntries(ownerLabels),
        entries: Object.fromEntries(entryCache),
      }));
    } catch (error) {
      console.warn(`The map's names could not be kept for next time: ${error?.message ?? error}`);
    }
  };

  const ownerSignatures = (overrides, labelNames) => {
    const indices = new Map();
    const features = regions.features;
    for (let index = 0; index < features.length; index += 1) {
      const properties = features[index]?.properties ?? {};
      const regionId = String(properties.id ?? properties.GID_1 ?? features[index]?.id ?? index);
      const owner = toCountryName(overrides?.[regionId] ?? properties.owner ?? "");
      if (!owner) continue;
      if (!indices.has(owner)) indices.set(owner, []);
      indices.get(owner).push(index);
    }
    const signatures = new Map();
    for (const [owner, list] of indices) {
      const name = String(labelNames?.[owner] ?? owner).trim() || owner;
      signatures.set(owner, `${name}\u0001${list.join(",")}`);
    }
    return signatures;
  };

  const buildRecords = ({ overrides = {}, labelNames = {} }) => {
    const labelName = (owner) => String(labelNames?.[owner] ?? owner).trim() || owner;
    const signatures = ownerSignatures(overrides, labelNames);
    for (const owner of [...ownerLabels.keys()]) {
      if (signatures.has(owner)) continue;
      ownerLabels.delete(owner);
      cacheDirty = true;
    }
    const changed = [...signatures.keys()].filter((owner) => ownerLabels.get(owner)?.signature !== signatures.get(owner));
    if (changed.length) {
      cacheDirty = true;
      const collection = geometry.aggregatePolityGeometryForOwners(regions, overrides, changed);
      const built = new Set();
      for (const feature of collection?.features ?? []) {
        const owner = toCountryName(feature?.properties?.owner ?? "");
        if (!owner) continue;
        const collections = labels.buildPolityLabelCollections(
          { type: "FeatureCollection", features: [feature] },
          { nameResolver: () => labelName(owner) },
        );
        ownerLabels.set(owner, {
          signature: signatures.get(owner),
          logical: collections.labelData?.features ?? [],
          ptr: collections.ptrLabelData?.features ?? [],
        });
        built.add(owner);
      }
      for (const owner of changed) {
        if (!built.has(owner)) ownerLabels.set(owner, { signature: signatures.get(owner), logical: [], ptr: [] });
      }
    }
    const logical = [];
    const ptr = [];
    for (const entry of ownerLabels.values()) {
      logical.push(...entry.logical);
      ptr.push(...entry.ptr);
    }
    const records = recordsModule.buildPolityTextPtr1Records({
      ptrLabelData: { type: "FeatureCollection", features: ptr },
      labelData: { type: "FeatureCollection", features: logical },
    });
    const digest = records.map((record) => continuity.polityTextRecordFingerprint(record)).join("\n");
    if (digest !== snapshotDigest) {
      revision += 1;
      snapshotDigest = digest;
      snapshot = records;
    }
    return {
      revision,
      token: `${session}:${revision}`,
      changedOwners: changed.length,
      records: snapshot.map((record) => ({
        key: continuity.polityTextRecordKey(record),
        owner: record.owner,
        text: record.text,
        letterSpacingEm: record.letterSpacingEm,
        measureKey: `${record.letterSpacingEm}|${record.text}`,
      })),
    };
  };

  const compactEntry = (record, entry) => ({
    key: continuity.polityTextRecordKey(record),
    owner: record.owner,
    text: record.text,
    measureKey: `${record.letterSpacingEm}|${record.text}`,
    letterSpacingEm: record.letterSpacingEm,
    minZoom: record.minZoom,
    maxZoom: record.maxZoom,
    fadeInZoomSpan: record.fadeInZoomSpan,
    fadeOutStartZoom: record.fadeOutStartZoom,
    priorityScale: record.priorityScale,
    raster: {
      width: entry.raster.width,
      height: entry.raster.height,
      contentWidth: entry.raster.contentWidth,
      paddingPx: entry.raster.paddingPx,
      ascent: entry.raster.ascent,
      descent: entry.raster.descent,
      fontSizePx: entry.raster.fontSizePx,
    },
    effectiveFontPxAtZoom4: entry.effectiveFontPxAtZoom4,
    points: entry.supportPoints.flatMap(([x, y]) => [roundPoint(x), roundPoint(y)]),
  });

  const layout = ({ metrics = {}, fontFamilies = [], textColor = TEXT_COLOR, haloColor = HALO_COLOR }) => {
    const nextCache = new Map();
    const entries = [];
    let solved = 0;
    for (const record of snapshot) {
      const measureKey = `${record.letterSpacingEm}|${record.text}`;
      const sample = metrics?.[measureKey];
      if (!Array.isArray(sample) || sample.length < 3) continue;
      const cacheKey = `${continuity.polityTextRecordFingerprint(record)}\u0002${sample.join(",")}`;
      let compact = entryCache.get(cacheKey);
      if (compact === undefined) {
        measured = { width: Number(sample[0]) || 0, ascent: Number(sample[1]) || 0, descent: Number(sample[2]) || 0 };
        let entry = null;
        try {
          const plan = layer.measurePolityTextRenderRecord({
            record,
            fontFamilies,
            fillStyle: textColor,
            haloStyle: haloColor,
            haloWidthPx: 5,
            samples: RASTER_SAMPLES,
          });
          const optimized = plan?.placementTask ? placement.optimizeTerritorialArcPlacement(plan.placementTask) : null;
          entry = layer.finalizePolityTextRenderRecord({ plan, optimizedPlacement: optimized, placementResolved: true });
        } finally {
          measured = null;
        }
        compact = entry ? compactEntry(record, entry) : null;
        solved += 1;
      }
      nextCache.set(cacheKey, compact);
      if (compact) entries.push(compact);
    }
    if (solved > 0 || nextCache.size !== entryCache.size) cacheDirty = true;
    entryCache = nextCache;
    return { revision, token: `${session}:${revision}`, solved, entries };
  };

  parentPort.on("message", (message) => {
    const { id, type } = message ?? {};
    try {
      let result = null;
      if (type === "load") {
        loadRegions(String(message.file));
        result = { baseOwners };
      } else if (type === "records") {
        loadRegions(String(message.file));
        result = buildRecords(message);
      } else if (type === "layout") {
        result = layout(message);
      } else {
        throw new Error(`Unknown label work: ${type}`);
      }
      parentPort.postMessage({ id, ok: true, result });
    } catch (error) {
      parentPort.postMessage({ id, ok: false, error: String(error?.stack ?? error?.message ?? error) });
    }
    saveCache();
  });
};

if (!isMainThread && workerData?.ohPolityText) await runPolityTextWorker();

const foldOverrides = (engine, world) => {
  const overrides = world?.regionOwnershipOverrides ?? {};
  const polityOverrides = world?.polityOverrides;
  if (!polityOverrides || typeof polityOverrides !== "object") return overrides;
  const aliasMap = engine.ownerNames.buildOwnerAliasMap(polityOverrides);
  if (!aliasMap.size) return overrides;
  const resolve = engine.ownerNames.createOwnerResolver(aliasMap);
  const folded = {};
  for (const [regionId, owner] of Object.entries(overrides)) folded[regionId] = resolve(owner) || owner;
  return folded;
};

export const register = (ctx) => {
  const { engine, clean } = ctx;
  let worker = null;
  let nextId = 0;
  const pending = new Map();

  const failAll = (error) => {
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  };

  const ensureWorker = () => {
    if (worker) return worker;
    const spawned = new Worker(new URL(import.meta.url), {
      workerData: { ohPolityText: true, cacheDir: ctx.cacheDir },
      stdout: true,
      stderr: true,
    });
    spawned.stdout.on("data", (chunk) => process.stderr.write(chunk));
    spawned.stderr.on("data", (chunk) => process.stderr.write(chunk));
    spawned.on("message", ({ id, ok, result, error }) => {
      const waiting = pending.get(id);
      if (!waiting) return;
      pending.delete(id);
      if (ok) waiting.resolve(result);
      else waiting.reject(new Error(error || "The map's names could not be laid out."));
    });
    spawned.on("error", (error) => {
      if (worker === spawned) worker = null;
      failAll(error);
    });
    spawned.on("exit", () => {
      if (worker === spawned) worker = null;
      failAll(new Error("The map's name worker stopped."));
    });
    spawned.unref();
    worker = spawned;
    return worker;
  };

  const work = (message) => new Promise((resolve, reject) => {
    nextId += 1;
    const id = nextId;
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ ...message, id });
  });

  const style = (world) => {
    const keys = engine.mapSettings.MAP_SETTING_KEYS;
    const fontOverride = clean(engine.mapSettings.getMapSettingValue(keys.labelFont, ""));
    return {
      hidden: engine.mapSettings.getMapSetting(keys.hideCountryLabels) === true,
      fontFamilies: [fontOverride || clean(world?.labelFont) || "Georgia", "Georgia", "Times New Roman", "Palatino Linotype", "serif"],
      textColor: clean(world?.labelTextColor) || TEXT_COLOR,
      haloColor: clean(world?.labelHaloColor) || HALO_COLOR,
    };
  };

  let lastStyle = null;

  return {
    "labels.records": async () => {
      const state = await ctx.mapState();
      const file = path.join(ctx.cacheDir, "regions", `${state.sha}.geojson`);
      const bundle = await engine.readGameStateBundle({ force: true });
      const world = bundle.world ?? {};
      const overrides = foldOverrides(engine, world);
      const { baseOwners } = await work({ type: "load", file });
      const labelNames = engine.polityNaming.resolvePolityLabelNames({
        records: baseOwners.map((owner) => ({ owner })),
        regionOwnershipOverrides: overrides,
        polityOverrides: world.polityOverrides ?? {},
        canonicalOwner: engine.ownerNames.toCountryName,
        displayName: engine.assets.resolveCountryDisplayName,
        translate: (label) => label,
      });
      const result = await work({ type: "records", file, overrides, labelNames });
      lastStyle = style(world);
      return { ...lastStyle, sha: state.sha, ...result };
    },
    "labels.layout": async ({ metrics = {} } = {}) => {
      const current = lastStyle ?? style({});
      return work({ type: "layout", metrics, fontFamilies: current.fontFamilies, textColor: current.textColor, haloColor: current.haloColor });
    },
  };
};
