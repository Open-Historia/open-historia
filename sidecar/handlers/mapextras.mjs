import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const RAD = Math.PI / 180;
const FLOOD_FIELD_LIMIT = 8;
const FLOOD_VERTEX_LIMIT = 24000;
const MAX_ANCESTOR_LEVELS = 6;
const GAME_PICK_PREFIX = "map_basemap_pick:";
const STARTING_PICK_STORED = "start";
const BACKGROUND_SEA = "#0b1a2b";
const NATGEO_CACHE_VERSION = "v2";
const here = path.dirname(fileURLToPath(import.meta.url));
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion:reduce)";
const BASEMAP_GROUP_LABELS = { own: "This scenario's maps", builtin: "Built-in maps" };
const BASEMAP_OPTION_LABELS = {
  starting: "{{name}} (starting map)",
  detailed: "{{name}} (detailed map)",
  detailedToDownload: "{{name}} (detailed map, {{size}} to download)",
  detailedNotHere: "{{name}} (detailed map, not on this device)",
};
const PERFORMANCE_LABELS = { constrained: "Low memory", full: "Full" };
const PICTURE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(githubusercontent\.com|github\.com|arcgisonline\.com|arcgis\.com|githubassets\.com)\//i;
const HUB_URL = "https://github.com/Open-Historia/Open-historia-scenarios";

const fillSlots = (template, values) => String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => String(values?.[key] ?? ""));

const motionScript = "Add-Type -Namespace OH -Name Spi -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SystemParametersInfo(uint a, uint b, ref bool c, uint d);'; $v = $true; [void][OH.Spi]::SystemParametersInfo(0x1042, 0, [ref]$v, 0); if ($v) { 'on' } else { 'off' }";

const probeReducedMotion = () => new Promise((resolve) => {
  const settle = (value) => resolve(Boolean(value));
  try {
    if (process.platform === "win32") {
      const encoded = Buffer.from(motionScript, "utf16le").toString("base64");
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { timeout: 10000, windowsHide: true }, (error, stdout) => settle(!error && String(stdout).trim().toLowerCase() === "off"));
    } else if (process.platform === "darwin") {
      execFile("defaults", ["read", "com.apple.universalaccess", "reduceMotion"], { timeout: 5000 }, (error, stdout) => settle(!error && String(stdout).trim() === "1"));
    } else {
      execFile("gsettings", ["get", "org.gnome.desktop.interface", "enable-animations"], { timeout: 5000 }, (error, stdout) => settle(!error && String(stdout).trim() === "false"));
    }
  } catch {
    settle(false);
  }
});

const polygonsOf = (geometry) => {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

const ringTerritoryArea = (ring) => {
  const points = (Array.isArray(ring) ? ring : []).filter(
    (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (points.length < 3) return 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const point of points) {
    minLat = Math.min(minLat, point[1]);
    maxLat = Math.max(maxLat, point[1]);
  }
  const cosLat = Math.max(0.08, Math.cos(((((minLat + maxLat) / 2) || 0) * Math.PI) / 180));
  const xs = [];
  const ys = [];
  let previousLng = Number(points[0][0]);
  for (const point of points) {
    let lng = Number(point[0]);
    while (lng - previousLng > 180) lng -= 360;
    while (lng - previousLng < -180) lng += 360;
    xs.push(lng * cosLat);
    ys.push(Number(point[1]));
    previousLng = lng;
  }
  let twiceArea = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    twiceArea += xs[previous] * ys[index] - xs[index] * ys[previous];
  }
  return Math.abs(twiceArea) / 2;
};

const geometryTerritoryWeight = (geometry) => {
  let total = 0;
  for (const polygon of polygonsOf(geometry)) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    const outer = ringTerritoryArea(polygon[0]);
    const holes = polygon.slice(1).reduce((sum, ring) => sum + ringTerritoryArea(ring), 0);
    total += Math.max(0, outer - holes);
  }
  return total;
};

const geometryBoundsCenter = (geometry) => {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon ?? []) {
      for (const point of ring ?? []) {
        const lng = Number(point?.[0]);
        const lat = Number(point?.[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
  }
  return Number.isFinite(west) ? { lng: (west + east) / 2, lat: (south + north) / 2 } : null;
};

const wrappedLongitudeDelta = (fromLng, toLng) => {
  let delta = Number(toLng) - Number(fromLng);
  if (!Number.isFinite(delta)) return 0;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
};

const vertexCountOf = (geometry) => polygonsOf(geometry)
  .reduce((sum, polygon) => sum + (Array.isArray(polygon) ? polygon.reduce((inner, ring) => inner + (Array.isArray(ring) ? ring.length : 0), 0) : 0), 0);

const pointsOf = (geometry) => polygonsOf(geometry)
  .flat()
  .flatMap((ring) => (Array.isArray(ring) ? ring : []))
  .filter((point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
  .map(([x, y]) => [Number(x), Number(y)]);

const normalizedDirection = (dx, dy) => {
  const x = Number(dx);
  const y = Number(dy);
  const length = Math.hypot(x, y);
  if (!(length > 1e-9)) return [1, 0];
  return [x / length, y / length];
};

const parseRgb = (value) => {
  const text = String(value ?? "").trim();
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(text);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
};

const base64Of = (bytes) => Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length).toString("base64");

const topologySegments = (topology) => {
  const segments = new Map();
  const regionToSegments = Array.from({ length: topology?.regionIds?.length ?? 0 }, () => []);
  const register = (id, regionIndexes, aPoint, bPoint) => {
    const indexes = [...new Set((regionIndexes ?? []).filter((value) => Number.isInteger(value) && value >= 0))];
    if (indexes.length < 2) return;
    segments.set(id, { id, regionIndexes: indexes, a: aPoint, b: bPoint });
    for (const regionIndex of indexes) regionToSegments[regionIndex]?.push(id);
  };
  for (let edge = 0; edge < (topology?.a?.length ?? 0); edge += 1) {
    const second = topology.region2[edge];
    const more = topology.extra.get(edge);
    if (second === -1 && !more) continue;
    const regionIndexes = [topology.region1[edge]];
    if (second !== -1) regionIndexes.push(second);
    if (more) regionIndexes.push(...more);
    register(`e:${edge}`, regionIndexes, [topology.pointX[topology.a[edge]], topology.pointY[topology.a[edge]]], [topology.pointX[topology.b[edge]], topology.pointY[topology.b[edge]]]);
  }
  for (let index = 0; index < (topology?.recoveredA?.length ?? 0); index += 1) {
    register(`r:${index}`, [topology.recoveredRegion1[index], topology.recoveredRegion2[index]], topology.recoveredA[index], topology.recoveredB[index]);
  }
  return { segments, regionToSegments };
};

export const register = (ctx) => {
  const { engine, emit, storage, clean, list, cacheDir } = ctx;
  const sx = () => engine.mxSeasonTint;
  const mp = () => engine.mxMapPatterns;
  const ownerName = (value) => clean(engine.mxOwnerNames?.toCountryName ? engine.mxOwnerNames.toCountryName(value) : value);

  let regions = { sha: "", features: [], ids: [], byId: new Map() };
  let geometry = { sha: "", topology: null, state: null, records: null, groupIndex: null };
  let backgroundCache = { key: "", payload: null };
  let geometryWarm = null;

  const loadRegions = async () => {
    const response = await fetch(engine.JSON_URLS.regionsGeojson || "/api/runtime/json/regionsGeojson");
    if (!response.ok) throw new Error(`The map's regions could not be read (${response.status}).`);
    const text = await response.text();
    const sha = crypto.createHash("sha256").update(text).digest("hex");
    if (sha !== regions.sha) {
      const parsed = JSON.parse(text);
      const features = list(parsed?.features);
      const ids = features.map((feature, index) => String(feature?.properties?.id ?? feature?.properties?.GID_1 ?? feature?.id ?? index));
      const byId = new Map();
      ids.forEach((id, index) => {
        if (!byId.has(id)) byId.set(id, index);
      });
      regions = { sha, features, ids, byId };
    }
    return regions;
  };

  const ensureGeometry = async () => {
    const current = await loadRegions();
    if (geometry.sha === current.sha && geometry.topology) return geometry;
    const collection = { type: "FeatureCollection", features: current.features };
    const topology = engine.mxTopology.buildPoliticalBoundaryTopology(collection);
    const state = topologySegments(topology);
    const records = current.features.map((feature) => {
      const props = feature?.properties ?? {};
      const centroid = props?.centroid?.coordinates;
      const center = geometryBoundsCenter(feature?.geometry);
      const rawLng = Number(Array.isArray(centroid) ? centroid[0] : props?.lng ?? props?.longitude);
      const rawLat = Number(Array.isArray(centroid) ? centroid[1] : props?.lat ?? props?.latitude);
      const lng = Number.isFinite(rawLng) ? rawLng : Number(center?.lng);
      const lat = Number.isFinite(rawLat) ? rawLat : Number(center?.lat);
      const weight = geometryTerritoryWeight(feature?.geometry);
      return { lng: Number.isFinite(lng) ? lng : null, lat: Number.isFinite(lat) ? lat : null, territoryWeight: weight > 1e-12 ? weight : 1 };
    });
    geometry = { sha: current.sha, topology, state, records, groupIndex: null };
    return geometry;
  };

  const warmGeometry = () => {
    if (geometryWarm || geometry.sha === regions.sha) return;
    geometryWarm = setTimeout(() => {
      ensureGeometry().catch(() => null).finally(() => {
        geometryWarm = null;
      });
    }, 2500);
  };

  const readWorld = async () => {
    const world = await engine.readJson(engine.JSON_URLS.world, { defaultValue: {}, force: true });
    return world && typeof world === "object" ? world : {};
  };

  const readShown = async () => (ctx.shownWorld && typeof ctx.shownWorld === "object" ? ctx.shownWorld : readWorld());

  const readGame = async () => {
    const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true });
    return game && typeof game === "object" ? game : {};
  };

  const readColors = async () => {
    const colors = await engine.readJson(engine.JSON_URLS.colors, { defaultValue: {}, force: true });
    return colors && typeof colors === "object" ? colors : {};
  };

  const groupsEnabled = () => engine.gameFeatures?.getActiveFeatures?.()?.groups?.enabled !== false;

  const indexOf = (id) => {
    const index = regions.byId.get(String(id));
    return index === undefined ? -1 : index;
  };

  const claimsOf = (world, colors) => {
    const store = engine.mxWorldStore;
    const folded = store.foldOwnerTokens(world);
    const regionClaimants = store.withoutHeldDisputes(store.withSettledClaims(folded.claimants, world?.settledRegionClaims), world, folded.overrides);
    const overrides = folded.overrides ?? {};
    const resolve = engine.mxOwnerColors.createOwnerRgbResolver(colors, world?.polityOverrides);
    const claims = [];
    regions.features.forEach((feature, index) => {
      const props = feature?.properties ?? {};
      const id = props.id != null ? String(props.id) : props.GID_1 != null ? String(props.GID_1) : "";
      if (!id) return;
      const recorded = Boolean(regionClaimants) && Object.prototype.hasOwnProperty.call(regionClaimants, id);
      const raw = recorded ? regionClaimants[id] : props.claimants;
      const claimants = Array.isArray(raw) ? raw.map((entry) => String(entry ?? "")).filter(Boolean) : [];
      if (!claimants.length) return;
      const liveOwner = String(overrides?.[id] ?? props.owner ?? "");
      const seen = new Set();
      const stripes = [];
      for (const name of liveOwner ? [liveOwner, ...claimants] : claimants) {
        const key = String(name ?? "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const rgb = resolve(key) ?? engine.mxOwnerColors.fallbackRgbFromOwner(key);
        stripes.push(rgb.slice(0, 3).map((part) => Math.max(0, Math.min(255, Math.round(Number(part) || 0)))));
      }
      if (stripes.length >= 2) claims.push({ index, stripes });
    });
    return claims;
  };

  const regionTypesOf = (world) => {
    const styles = engine.mxRegionTypes.regionTypeRenderStyles(world?.regionTypes);
    if (!styles.size) return { styles: [], regions: [] };
    const order = [...styles.keys()];
    const slot = new Map(order.map((id, index) => [id, index]));
    const out = order.map((id) => {
      const style = styles.get(id);
      const fill = style.fill ? parseRgb(style.fill) : null;
      const stroke = style.stroke ? parseRgb(style.stroke) : null;
      return {
        id,
        fill: fill ? fill.slice(0, 3) : null,
        ownedScale: style.ownedScale,
        unownedScale: style.unownedScale,
        stroke,
        strokeScale: style.strokeScale,
        bands: style.bands,
      };
    });
    const typed = [];
    regions.features.forEach((feature, index) => {
      const typeId = String(feature?.properties?.typeId ?? "");
      if (slot.has(typeId)) typed.push([index, slot.get(typeId)]);
    });
    return { styles: out, regions: typed };
  };

  const groupsOf = (world) => {
    if (!groupsEnabled() || !world?.groups || !Object.keys(world.groups).length) return { groups: {}, areas: {} };
    const groups = engine.mxGroups.normalizeGroups(world.groups);
    return { groups, areas: engine.mxGroups.normalizeGroupAreas(world.groupAreas, groups) };
  };

  const settingsValues = () => {
    const ms = engine.mapSettings;
    const keys = ms.MAP_SETTING_KEYS;
    try {
      engine.mxBasemapPick.migrateBasemapSettings({
        has: (key) => storage.getItem(key) !== null,
        get: (key) => storage.getItem(key),
        set: (key, value) => storage.setItem(key, value),
        delete: (key) => storage.removeItem(key),
      });
    } catch {
      storage.flush();
    }
    const jsonFlag = (key, fallback) => {
      const saved = storage.getItem(key);
      if (saved === null) return fallback;
      try {
        return Boolean(JSON.parse(saved));
      } catch {
        return fallback;
      }
    };
    const library = engine.getLibraryState?.() ?? {};
    const gameId = clean(library.activeGameId ?? library.activeGame?.id);
    const stored = clean(storage.getItem(`${GAME_PICK_PREFIX}${gameId || "current"}`));
    const constrained = Boolean(engine.mxDeviceProfile?.isConstrainedDevice?.());
    return {
      globe: jsonFlag("Globe", false),
      terrain: jsonFlag("Terrain", !constrained),
      disableIdleRotation: ms.getMapSetting(keys.disableIdleRotation),
      disableEventCamera: ms.getMapSetting(keys.disableEventCamera),
      seasonsWeather: ms.getMapSettingDefaultOn(keys.seasonsWeather),
      weatherEffects: ms.getMapSettingDefaultOn(keys.weatherEffects),
      defaultBasemap: clean(storage.getItem(keys.defaultBasemap)),
      defaultBasemapOn: ms.getMapSetting(keys.defaultBasemapOn),
      scenarioTerrain: clean(storage.getItem(keys.scenarioTerrain)) === "painted" ? "painted" : "",
      gamePick: stored === "" ? null : stored === STARTING_PICK_STORED ? "" : stored,
      gameId,
      transitionMode: clean(storage.getItem("openhistoria:ownershipTransitionMode")).toLowerCase(),
      constrained,
    };
  };

  const regionOwnerOf = (previousNames, previousOwners) => (regionIndex) => {
    const slot = Number(previousOwners?.[regionIndex]);
    if (!Number.isInteger(slot) || slot < 0) return "";
    return ownerName(previousNames?.[slot] ?? "");
  };

  const transitionDirection = ({ index, toOwner, ownerAt, changedSet, shape }) => {
    const { topology, state, records } = shape;
    const target = records[index];
    const targetLng = Number(target?.lng);
    const targetLat = Number(target?.lat);
    if (!Number.isFinite(targetLng) || !Number.isFinite(targetLat) || !toOwner) {
      return { dx: 1, dy: 0, mode: "wipe", basis: "fallback", frontierSegments: [] };
    }
    const recipientSeeds = new Set();
    let contactWeight = 0;
    let contactLng = 0;
    let contactLat = 0;
    let inwardNormalX = 0;
    let inwardNormalY = 0;
    let inwardNormalWeight = 0;
    const sharedFrontierSegments = [];
    const precision = Number(topology?.precision ?? 0);
    const incidentSegments = state?.regionToSegments?.[index] ?? [];
    if (precision > 0 && state?.segments && incidentSegments.length) {
      for (const segmentId of incidentSegments) {
        const segment = state.segments.get(segmentId);
        if (!segment) continue;
        const recipientIndexes = (segment.regionIndexes ?? []).filter((otherIndex) => {
          if (otherIndex === index) return false;
          const otherId = String(topology?.regionIds?.[otherIndex] ?? "");
          if (!otherId || changedSet.has(otherId)) return false;
          return ownerAt(otherIndex) === toOwner;
        });
        if (!recipientIndexes.length) continue;
        for (const recipientIndex of recipientIndexes) recipientSeeds.add(recipientIndex);
        const ax = Number(segment.a?.[0]) / precision;
        const ay = Number(segment.a?.[1]) / precision;
        const bx = Number(segment.b?.[0]) / precision;
        const by = Number(segment.b?.[1]) / precision;
        if (![ax, ay, bx, by].every(Number.isFinite)) continue;
        const midLng = (ax + bx) / 2;
        const midLat = (ay + by) / 2;
        const cosSegmentLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
        const tangentX = bx - ax;
        const tangentY = (by - ay) / cosSegmentLat;
        const length = Math.hypot(tangentX, tangentY);
        if (!(length > 1e-9)) continue;
        sharedFrontierSegments.push({ a: [ax, ay], b: [bx, by], length });
        contactWeight += length;
        contactLng += midLng * length;
        contactLat += midLat * length;
        let normalX = -tangentY / length;
        let normalY = tangentX / length;
        const towardTargetX = wrappedLongitudeDelta(midLng, targetLng);
        const towardTargetY = (targetLat - midLat) / cosSegmentLat;
        if ((normalX * towardTargetX) + (normalY * towardTargetY) < 0) {
          normalX *= -1;
          normalY *= -1;
        }
        inwardNormalX += normalX * length;
        inwardNormalY += normalY * length;
        inwardNormalWeight += length;
      }
    }
    const recipientIndexes = new Set();
    if (recipientSeeds.size && state?.segments) {
      const queue = [...recipientSeeds];
      for (const seed of queue) recipientIndexes.add(seed);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const regionIndex = queue[cursor];
        for (const segmentId of state.regionToSegments?.[regionIndex] ?? []) {
          const segment = state.segments.get(segmentId);
          if (!segment) continue;
          for (const neighborIndex of segment.regionIndexes ?? []) {
            if (neighborIndex === regionIndex || recipientIndexes.has(neighborIndex)) continue;
            const neighborId = String(topology?.regionIds?.[neighborIndex] ?? "");
            if (!neighborId || changedSet.has(neighborId)) continue;
            if (ownerAt(neighborIndex) !== toOwner) continue;
            recipientIndexes.add(neighborIndex);
            queue.push(neighborIndex);
          }
        }
      }
    } else {
      for (let candidateIndex = 0; candidateIndex < records.length; candidateIndex += 1) {
        const candidateId = String(topology?.regionIds?.[candidateIndex] ?? "");
        if (!candidateId || candidateIndex === index || changedSet.has(candidateId)) continue;
        if (ownerAt(candidateIndex) === toOwner) recipientIndexes.add(candidateIndex);
      }
    }
    let massX = 0;
    let massY = 0;
    let massWeight = 0;
    for (const recipientIndex of recipientIndexes) {
      const candidate = records[recipientIndex];
      const lng = Number(candidate?.lng);
      const lat = Number(candidate?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const weight = Math.max(1e-9, Number(candidate?.territoryWeight) || 1);
      const meanLat = (targetLat + lat) / 2;
      const cosLat = Math.max(0.2, Math.cos((meanLat * Math.PI) / 180));
      massX += wrappedLongitudeDelta(targetLng, lng) * weight;
      massY += ((lat - targetLat) / cosLat) * weight;
      massWeight += weight;
    }
    const frontierSegments = (sharedFrontierSegments.length <= 4096
      ? sharedFrontierSegments
      : [...sharedFrontierSegments].sort((left, right) => right.length - left.length).slice(0, 4096)
    ).map((segment) => [segment.a, segment.b]);
    if (massWeight > 0) {
      const dx = -massX / massWeight;
      const dy = -massY / massWeight;
      const length = Math.hypot(dx, dy);
      if (length > 1e-6) {
        return { dx: dx / length, dy: dy / length, mode: "wipe", basis: recipientSeeds.size ? "recipient-landmass-mass" : "recipient-polity-mass", frontierSegments };
      }
    }
    if (inwardNormalWeight > 0) {
      const length = Math.hypot(inwardNormalX, inwardNormalY);
      if (length > 1e-6) {
        return { dx: inwardNormalX / length, dy: inwardNormalY / length, mode: "wipe", basis: "shared-frontier-normal", frontierSegments };
      }
    }
    const targetCosLat = Math.max(0.2, Math.cos((targetLat * Math.PI) / 180));
    if (contactWeight > 0) {
      const borderLng = contactLng / contactWeight;
      const borderLat = contactLat / contactWeight;
      const dx = wrappedLongitudeDelta(borderLng, targetLng);
      const dy = (targetLat - borderLat) / targetCosLat;
      const length = Math.hypot(dx, dy);
      if (length > 1e-6) {
        return { dx: dx / length, dy: dy / length, mode: "wipe", basis: "shared-frontier-contact", frontierSegments };
      }
    }
    let hash = 2166136261;
    for (const char of String(topology?.regionIds?.[index] ?? index)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    const angle = ((hash % 16) * Math.PI) / 8;
    return { dx: Math.cos(angle), dy: Math.sin(angle), mode: "wipe", basis: "deterministic-fallback", frontierSegments };
  };

  const sweepBandsOf = (feature) => {
    const points = pointsOf(feature?.geometry);
    if (!points.length) return null;
    const center = points.reduce((sum, [x, y]) => [sum[0] + x, sum[1] + y], [0, 0]).map((value) => value / points.length);
    const [screenDx, screenDy] = normalizedDirection(feature?.properties?.sweepDx, feature?.properties?.sweepDy);
    const centerLat = Number(center[1]);
    const cosLat = Math.max(0.2, Math.cos(((Number.isFinite(centerLat) ? centerLat : 0) * Math.PI) / 180));
    const [dx, dy] = normalizedDirection(screenDx, screenDy * cosLat);
    let minT = Infinity;
    let maxT = -Infinity;
    for (const [x, y] of points) {
      const t = (x - center[0]) * dx + (y - center[1]) * dy;
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }
    if (![minT, maxT].every(Number.isFinite) || maxT - minT <= 1e-9) return { center, d: [dx, dy], minT: 0, maxT: 1, bands: 1 };
    const vertices = vertexCountOf(feature?.geometry);
    const bands = vertices > 20000 ? 8 : vertices > 8000 ? 12 : 20;
    return { center, d: [dx, dy], minT, maxT, bands };
  };

  const imageQuad = (bounds, globe) => engine.mxMapProjection.imageQuad(bounds, { globe });

  const resolveBackground = async ({ globe = false } = {}) => {
    const world = await readWorld();
    const settings = settingsValues();
    const assets = engine.assets;
    const tiled = engine.mxTiled;
    const terrainLib = engine.mxScenarioTerrain;
    const descriptor = world?.background ?? null;
    const view = engine.mxMapProjection.mapViewOf(world?.projection);
    const maps = engine.mxBasemapPick.scenarioMapsOfWorld({
      background: descriptor,
      basemap: world?.basemap || null,
      allowedBasemaps: Array.isArray(world?.allowedBasemaps) ? world.allowedBasemaps.map(String) : null,
      ownBasemaps: assets.decodeOwnBasemaps(assets.encodeOwnBasemaps(world?.ownBasemaps)),
    });
    const showDetailed = settings.scenarioTerrain !== "painted";
    const shown = engine.mxBasemapPick.basemapShownFor({
      maps,
      gamePick: settings.gamePick,
      defaultBasemap: settings.defaultBasemap,
      useDefault: settings.defaultBasemapOn,
      showDetailed,
    });
    const archiveOf = (meta) => (meta ? tiled.tiledBasemapArchiveUrl(meta.id) : "");
    const probe = async (url) => {
      try {
        const header = await assets.getPmtilesArchive(String(url).replace(/^pmtiles:\/\//, "")).getHeader();
        return Boolean(header && header.numTileEntries !== 0);
      } catch {
        return false;
      }
    };
    const lookupNamed = async (named) => (named?.id ? tiled.findOfficialBasemap(named.id) : tiled.findTiledBasemap(named?.hash));
    let payload = null;
    let payloadFailed = false;
    const hasOwn = assets.hasOwnMap(descriptor);
    if (hasOwn && descriptor?.kind !== "plain") {
      try {
        payload = await engine.readJson(engine.JSON_URLS.backgroundData, { force: true });
      } catch {
        payloadFailed = true;
      }
    }
    let custom = null;
    let declared = false;
    let missingTiled = null;
    let tiledUpdate = null;
    if (hasOwn) {
      if (descriptor?.kind === "plain") {
        declared = true;
      } else {
        const namedTiled = terrainLib.wantsScenarioTerrain(settings.scenarioTerrain) ? terrainLib.scenarioTiledBasemap(descriptor) : null;
        let meta = null;
        let drawn = { tiles: null, missing: null, update: null };
        if (namedTiled && payload?.geojson) {
          meta = await lookupNamed(namedTiled);
          drawn = terrainLib.resolveTiledBasemap({ descriptor, setting: settings.scenarioTerrain, basemap: meta, archiveUrl: archiveOf(meta) });
          if (drawn.tiles && !(await probe(drawn.tiles.url))) {
            meta = null;
            drawn = { tiles: null, missing: null, update: null };
          }
        }
        if (descriptor?.kind === "image" && payload?.dataUrl) {
          custom = { kind: "image", imageUrl: payload.dataUrl, bounds: engine.mxMapProjection.normalizeImageBounds(descriptor.bounds) };
          declared = true;
        } else if (descriptor?.kind === "vector" && payload?.geojson) {
          custom = { kind: "vector", geojson: payload.geojson, ...(drawn.tiles ? { terrain: drawn.tiles } : {}) };
          declared = true;
          missingTiled = namedTiled?.id ? null : drawn.missing;
          const officialId = namedTiled?.id || meta?.official?.id;
          if (officialId) {
            const official = tiled.findOfficialEntry(await tiled.fetchOfficialBasemaps(), officialId);
            const offered = terrainLib.resolveTiledBasemap({ descriptor, setting: settings.scenarioTerrain, basemap: meta, archiveUrl: archiveOf(meta), official });
            missingTiled = offered.missing;
            tiledUpdate = offered.update;
          }
        } else if (payloadFailed) {
          declared = false;
        }
      }
    }
    const startingDrawn = custom?.terrain ? { ...custom, terrain: undefined } : custom;
    const otherDrawnPick = shown.kind === "detailed" ? shown.over : shown.pick;
    const ownPick = assets.ownBasemapIdOf(otherDrawnPick);
    let ownPickBg = null;
    if (ownPick) {
      const entry = assets.decodeOwnBasemaps(assets.encodeOwnBasemaps(world?.ownBasemaps)).find((own) => own.id === ownPick);
      if (entry) {
        const data = await engine.readJson(engine.JSON_URLS.ownBasemapsData, { force: true }).catch(() => null);
        const own = data && typeof data === "object" ? data[ownPick] : null;
        const sheet = engine.mxMapProjection.projectionIsDefault(world?.projection) ? null : engine.mxMapProjection.sheetBounds(world.projection);
        if (entry.kind === "image" && own?.dataUrl) ownPickBg = { kind: "image", imageUrl: own.dataUrl, bounds: sheet ? engine.mxMapProjection.normalizeImageBounds(sheet) : null };
        else if (entry.kind === "vector" && own?.geojson) ownPickBg = { kind: "vector", geojson: own.geojson };
      }
    }
    let otherDetailed = { tiles: null, missing: null, update: null };
    if (!shown.starting && shown.detailed) {
      const wanted = shown.detailed;
      const detailedDescriptor = { kind: "vector", tiled: wanted, ...(Array.isArray(shown.fillOpacity) ? { fillOpacity: shown.fillOpacity } : {}) };
      let meta = await lookupNamed(wanted);
      let drawn = terrainLib.resolveTiledBasemap({ descriptor: detailedDescriptor, setting: "", basemap: meta, archiveUrl: archiveOf(meta) });
      if (drawn.tiles && !(await probe(drawn.tiles.url))) {
        meta = null;
        drawn = { tiles: null, missing: null, update: null };
      }
      otherDetailed = { tiles: drawn.tiles, missing: wanted.id ? null : drawn.missing, update: null };
      const officialId = wanted.id || meta?.official?.id;
      if (officialId) {
        const official = tiled.findOfficialEntry(await tiled.fetchOfficialBasemaps(), officialId);
        const offered = terrainLib.resolveTiledBasemap({ descriptor: detailedDescriptor, setting: "", basemap: meta, archiveUrl: archiveOf(meta), official });
        otherDetailed = { ...otherDetailed, missing: offered.missing, update: offered.update };
      }
    }
    let shownOwnBg = null;
    if (!(shown.starting || shown.kind === "builtin")) {
      const base = ownPick ? ownPickBg : startingDrawn;
      shownOwnBg = base ? (shown.kind === "detailed" && otherDetailed.tiles && base.kind === "vector" ? { ...base, terrain: otherDetailed.tiles } : base) : null;
    }
    const useScenarioBackground = shown.pick === "";
    const otherMapShown = !shown.starting && shown.kind !== "builtin";
    const effective = otherMapShown ? shownOwnBg || startingDrawn : useScenarioBackground ? custom : null;
    const effectiveDeclared = otherMapShown ? Boolean(shownOwnBg) || declared : useScenarioBackground ? declared : false;
    const builtinOverride = shown.kind === "builtin" && !shown.starting ? shown.pick : "";
    const basemapId = assets.resolveBasemapId({ overrideId: builtinOverride, scenarioId: world?.basemap || "", fallbackId: assets.DEFAULT_BASEMAP_ID });
    const offeredMissing = shown.pick === "" ? missingTiled : shown.kind === "detailed" ? otherDetailed.missing : null;
    const offeredUpdate = shown.pick === "" ? tiledUpdate : shown.kind === "detailed" ? otherDetailed.update : null;
    const shownUpdate = offeredUpdate && (offeredUpdate.needed || !tiled.isTiledUpdateDismissed(offeredUpdate.id, offeredUpdate.version)) ? offeredUpdate : null;
    const key = crypto.createHash("sha1").update(JSON.stringify([effective?.kind ?? "", effective?.kind === "image" ? effective.imageUrl.length : 0, effective?.kind === "vector" ? JSON.stringify(effective.geojson).length : 0, globe, descriptor, ownPick])).digest("hex");
    let image = null;
    let vector = null;
    if (effective?.kind === "image") {
      const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(effective.imageUrl));
      image = {
        quad: imageQuad(effective.bounds, globe),
        data: match ? (match[2] ? match[3] : Buffer.from(decodeURIComponent(match[3]), "utf8").toString("base64")) : "",
      };
    }
    if (effective?.kind === "vector") {
      const features = list(effective.geojson?.features);
      const text = JSON.stringify({ type: "FeatureCollection", features: features.map((feature) => ({ type: "Feature", properties: {}, geometry: feature?.geometry ?? null })) });
      const sha = crypto.createHash("sha256").update(text).digest("hex");
      const file = path.join(cacheDir, "backgrounds", `${sha}.geojson`);
      if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(`${file}.tmp`, text);
        fs.renameSync(`${file}.tmp`, file);
      }
      vector = {
        file,
        fills: features.map((feature) => {
          const rgb = parseRgb(feature?.properties?.fill) ?? parseRgb("#33435c");
          return rgb;
        }),
      };
    }
    const relief = effective?.terrain
      ? { url: effective.terrain.url, minzoom: effective.terrain.minzoom, maxzoom: effective.terrain.maxzoom, bounds: effective.terrain.bounds ?? null, fillOpacity: effective.terrain.fillOpacity ?? null }
      : null;
    return {
      key,
      noGlobe: view.noGlobe,
      noWrap: view.noWrap,
      basemapId,
      kind: effective?.kind ?? (effectiveDeclared ? "declared" : "builtin"),
      sea: BACKGROUND_SEA,
      image,
      vector,
      relief,
      missing: offeredMissing,
      update: shownUpdate,
      moreDetailedMaps: list(shown.otherDetailed).length,
      maps: maps.map((map) => ({ pick: map.pick, kind: map.kind, name: map.name, starting: Boolean(map.starting) })),
      shownPick: shown.pick,
    };
  };

  let systemReduced = false;
  let motionProbe = null;
  const baseMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = (query) => {
    const media = typeof baseMatchMedia === "function" ? baseMatchMedia(query) : { matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
    if (String(query ?? "").replace(/\s+/g, "") === REDUCED_MOTION_QUERY) return { ...media, matches: systemReduced, media: String(query) };
    return media;
  };
  const refreshMotion = () => {
    if (!motionProbe) {
      motionProbe = probeReducedMotion().then((value) => {
        const changed = value !== systemReduced;
        systemReduced = value;
        motionProbe = null;
        if (changed) emit("mapextras.systemMotion", { reduced: value });
        return value;
      });
    }
    return motionProbe;
  };
  void refreshMotion();
  setInterval(() => { void refreshMotion(); }, 60000).unref?.();

  const scenarioMaps = (world) => engine.mxBasemapPick.scenarioMapsOfWorld({
    background: world?.background ?? null,
    basemap: world?.basemap || null,
    allowedBasemaps: Array.isArray(world?.allowedBasemaps) ? world.allowedBasemaps.map(String) : null,
    ownBasemaps: engine.assets.decodeOwnBasemaps(engine.assets.encodeOwnBasemaps(world?.ownBasemaps)),
  });

  const libraryEntry = (bm) => ({
    id: clean(bm?.id),
    name: clean(bm?.name),
    kind: clean(bm?.kind),
    thumbnail: typeof bm?.thumbnail === "string" ? bm.thumbnail : "",
    size: engine.mxTiled.formatBytes(bm?.bytes) || "",
    official: bm?.official ? { id: clean(bm.official.id), version: Number(bm.official.version) || 0 } : null,
    community: Boolean(bm?.source?.community),
    communityUrl: clean(bm?.source?.url) || "",
  });

  const downloadsDir = () => {
    const configured = clean(process.env.OH_NATIVE_DOWNLOADS);
    if (configured) return configured;
    const home = process.env.USERPROFILE || process.env.HOME || ".";
    return path.join(home, "Downloads", "Open Historia");
  };

  const safeName = (name) => (clean(name) || "basemap").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "basemap";

  let natgeoWorker = null;
  let natgeoStyle = null;
  let natgeoCall = 0;
  let natgeoSprite = null;
  const natgeoWaiting = new Map();
  const natgeoGlyphCache = new Map();
  const natgeoDir = () => path.join(cacheDir, "natgeo", NATGEO_CACHE_VERSION);
  const natgeoAssets = () => path.join(cacheDir, "natgeo", "assets");

  const cachedDownload = async (url, file) => {
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const response = await fetch(url);
    if (!response.ok) {
      const error = new Error(`The National Geographic map answered ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return bytes;
  };

  const loadNatgeoStyle = async () => {
    if (natgeoStyle) return natgeoStyle;
    const file = path.join(natgeoAssets(), "style.json");
    let source = null;
    if (fs.existsSync(file)) {
      try {
        source = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        source = null;
      }
    }
    if (!source) {
      const response = await fetch(engine.mxNatGeo.NATGEO_VECTOR_STYLE_URL);
      if (!response.ok) throw new Error(`The National Geographic style answered ${response.status}.`);
      source = await response.json();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(source));
    }
    const built = engine.mxNatGeo.buildNatGeoDarkStyle(source);
    const vector = Object.entries(built.sources ?? {}).find(([, value]) => value?.type === "vector");
    const template = list(vector?.[1]?.tiles)[0] ?? "";
    natgeoStyle = {
      template,
      sprite: typeof built.sprite === "string" ? built.sprite : "",
      glyphs: typeof built.glyphs === "string" ? built.glyphs : "",
      maxzoom: Number(vector?.[1]?.maxzoom) || 16,
      layers: list(built.layers).filter((layer) => layer?.source === vector?.[0] && ["fill", "line", "symbol"].includes(layer?.type)),
    };
    return natgeoStyle;
  };

  const loadNatgeoSprite = async () => {
    if (natgeoSprite) return natgeoSprite;
    const style = await loadNatgeoStyle();
    if (!style.sprite) {
      natgeoSprite = { json: {}, png: null };
      return natgeoSprite;
    }
    const [jsonBytes, png] = await Promise.all([
      cachedDownload(`${style.sprite}.json`, path.join(natgeoAssets(), "sprite.json")),
      cachedDownload(`${style.sprite}.png`, path.join(natgeoAssets(), "sprite.png")),
    ]);
    natgeoSprite = { json: JSON.parse(jsonBytes.toString("utf8")), png };
    return natgeoSprite;
  };

  const readVarint = (buf, state) => {
    let result = 0;
    let mul = 1;
    let byte = 0;
    do {
      byte = buf[state.pos];
      state.pos += 1;
      result += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte & 0x80 && state.pos < buf.length);
    return result;
  };

  const skipField = (buf, state, wire) => {
    if (wire === 0) readVarint(buf, state);
    else if (wire === 1) state.pos += 8;
    else if (wire === 2) {
      const length = readVarint(buf, state);
      state.pos += length;
    }
    else if (wire === 5) state.pos += 4;
    else state.pos = buf.length;
  };

  const decodeGlyphs = (buf) => {
    const glyphs = [];
    const top = { pos: 0 };
    while (top.pos < buf.length) {
      const tag = readVarint(buf, top);
      if (tag >> 3 !== 1 || (tag & 7) !== 2) {
        skipField(buf, top, tag & 7);
        continue;
      }
      const stackEnd = readVarint(buf, top) + top.pos;
      while (top.pos < stackEnd) {
        const stackTag = readVarint(buf, top);
        if (stackTag >> 3 !== 3 || (stackTag & 7) !== 2) {
          skipField(buf, top, stackTag & 7);
          continue;
        }
        const glyphEnd = readVarint(buf, top) + top.pos;
        const glyph = { id: 0, width: 0, height: 0, left: 0, top: 0, advance: 0, bitmap: "" };
        while (top.pos < glyphEnd) {
          const fieldTag = readVarint(buf, top);
          const field = fieldTag >> 3;
          if (field === 1) glyph.id = readVarint(buf, top);
          else if (field === 2) {
            const length = readVarint(buf, top);
            glyph.bitmap = Buffer.from(buf.subarray(top.pos, top.pos + length)).toString("base64");
            top.pos += length;
          } else if (field === 3) glyph.width = readVarint(buf, top);
          else if (field === 4) glyph.height = readVarint(buf, top);
          else if (field === 5) {
            const raw = readVarint(buf, top);
            glyph.left = raw % 2 === 1 ? -(raw + 1) / 2 : raw / 2;
          } else if (field === 6) {
            const raw = readVarint(buf, top);
            glyph.top = raw % 2 === 1 ? -(raw + 1) / 2 : raw / 2;
          } else if (field === 7) glyph.advance = readVarint(buf, top);
          else skipField(buf, top, fieldTag & 7);
        }
        top.pos = glyphEnd;
        glyphs.push(glyph);
      }
      top.pos = stackEnd;
    }
    return glyphs;
  };

  const natgeoGlyphs = async (font, start) => {
    const key = `${font}|${start}`;
    if (natgeoGlyphCache.has(key)) return natgeoGlyphCache.get(key);
    const style = await loadNatgeoStyle();
    if (!style.glyphs) return [];
    const range = `${start}-${start + 255}`;
    const safe = font.replace(/[^a-zA-Z0-9 ,_-]/g, "_");
    let glyphs = [];
    try {
      const bytes = await cachedDownload(style.glyphs.replace("{fontstack}", font).replace("{range}", range), path.join(natgeoAssets(), "glyphs", safe, `${range}.pbf`));
      glyphs = decodeGlyphs(new Uint8Array(bytes));
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    natgeoGlyphCache.set(key, glyphs);
    return glyphs;
  };

  const natgeoRender = async (message) => {
    if (!natgeoWorker) {
      natgeoWorker = new Worker(path.join(here, "natgeo_worker.cjs"));
      natgeoWorker.unref();
      natgeoWorker.on("message", (reply) => {
        const settle = natgeoWaiting.get(reply?.id);
        if (!settle) return;
        natgeoWaiting.delete(reply.id);
        settle(reply);
      });
      natgeoWorker.on("error", (error) => {
        for (const settle of natgeoWaiting.values()) settle({ error: String(error?.message ?? error) });
        natgeoWaiting.clear();
        natgeoWorker = null;
      });
      natgeoWorker.postMessage({ type: "style", layers: natgeoStyle.layers });
      let spriteData = { json: {}, png: null };
      try {
        spriteData = await loadNatgeoSprite();
      } catch {
        spriteData = { json: {}, png: null };
      }
      natgeoWorker.postMessage({ type: "sprite", json: spriteData.json, png: spriteData.png ? new Uint8Array(spriteData.png) : null });
    }
    natgeoCall += 1;
    const id = natgeoCall;
    return new Promise((resolve) => {
      natgeoWaiting.set(id, resolve);
      natgeoWorker.postMessage({ ...message, type: "tile", id }, message.pbf ? [message.pbf] : []);
    });
  };

  const natgeoTile = async (z, x, y, labelsOnly = false) => {
    const style = await loadNatgeoStyle();
    const dir = path.join(natgeoDir(), String(z), String(x));
    const base = path.join(dir, String(y));
    if (fs.existsSync(`${base}.json`)) {
      const labels = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"));
      if (labelsOnly) return { fills: "", lines: "", labels };
      const read = (suffix) => (fs.existsSync(`${base}.${suffix}.png`) ? fs.readFileSync(`${base}.${suffix}.png`).toString("base64") : "");
      return { fills: read("fills"), lines: read("lines"), labels };
    }
    if (labelsOnly && fs.existsSync(`${base}.labels.json`)) return { fills: "", lines: "", labels: JSON.parse(fs.readFileSync(`${base}.labels.json`, "utf8")) };
    const url = style.template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    let pbf = null;
    const response = await fetch(url);
    if (response.ok) pbf = new Uint8Array(await response.arrayBuffer());
    else if (response.status !== 404) throw new Error(`The National Geographic tiles answered ${response.status}.`);
    let result = { fills: null, lines: null, labels: [] };
    if (pbf && pbf.byteLength) {
      const bytes = pbf.byteOffset === 0 && pbf.byteLength === pbf.buffer.byteLength ? pbf.buffer : pbf.slice().buffer;
      const reply = await natgeoRender({ z, x, y, pbf: bytes, labelsOnly });
      if (reply?.error) throw new Error(reply.error);
      result = reply;
    }
    fs.mkdirSync(dir, { recursive: true });
    if (labelsOnly) {
      fs.writeFileSync(`${base}.labels.json`, JSON.stringify(result.labels ?? []));
      return { fills: "", lines: "", labels: result.labels ?? [] };
    }
    if (result.fills) fs.writeFileSync(`${base}.fills.png`, Buffer.from(result.fills));
    if (result.lines) fs.writeFileSync(`${base}.lines.png`, Buffer.from(result.lines));
    fs.writeFileSync(`${base}.json`, JSON.stringify(result.labels ?? []));
    return {
      fills: result.fills ? Buffer.from(result.fills).toString("base64") : "",
      lines: result.lines ? Buffer.from(result.lines).toString("base64") : "",
      labels: result.labels ?? [],
    };
  };

  return {
    "mapextras.systemMotion": async ({ fresh = false } = {}) => ({ reduced: fresh ? await refreshMotion() : systemReduced }),
    "mapextras.deviceProfile": async ({ value } = {}) => {
      const profile = engine.mxDeviceProfile;
      if (value !== undefined) {
        profile.setDeviceProfileOverride(value === "constrained" || value === "full" ? value : "");
        storage.flush();
        const next = profile.getDeviceProfileOverride();
        try {
          engine.debugLog?.logSettingChange?.("Performance mode", PERFORMANCE_LABELS[next] ?? "Auto");
        } catch {
          storage.flush();
        }
      }
      return { mode: profile.getDeviceProfileOverride(), running: Boolean(profile.isConstrainedDevice()) };
    },
    "mapextras.basemapChoices": async () => {
      const world = await readWorld();
      const maps = scenarioMaps(world);
      const settings = settingsValues();
      const shown = engine.mxBasemapPick.basemapShownFor({ maps, gamePick: settings.gamePick, defaultBasemap: settings.defaultBasemap, useDefault: settings.defaultBasemapOn });
      const lookups = await engine.mxDetailedOffers.lookUpDetailedMaps(maps.filter((map) => map.kind === "detailed")).catch(() => []);
      const status = Object.fromEntries(list(lookups).map(({ map, installed, official }) => {
        const latest = official?.versions?.[official.versions.length - 1] || null;
        return [map.pick, { have: Boolean(installed), bytes: latest?.bytes || null }];
      }));
      const labelOf = (map) => {
        if (map.starting) return fillSlots(BASEMAP_OPTION_LABELS.starting, { name: map.name });
        if (map.kind !== "detailed") return map.name;
        const here = status[map.pick];
        if (!here || here.have) return fillSlots(BASEMAP_OPTION_LABELS.detailed, { name: map.name });
        return here.bytes
          ? fillSlots(BASEMAP_OPTION_LABELS.detailedToDownload, { name: map.name, size: engine.mxTiled.formatBytes(here.bytes) })
          : fillSlots(BASEMAP_OPTION_LABELS.detailedNotHere, { name: map.name });
      };
      const own = maps.filter((map) => !map.starting && map.kind !== "builtin");
      const builtin = maps.filter((map) => !map.starting && map.kind === "builtin");
      const grouped = own.length > 0 && builtin.length > 0;
      const option = (map) => ({ pick: map.pick, label: labelOf(map) });
      const options = maps.length ? [option(maps[0])] : [];
      if (grouped) {
        options.push({ header: BASEMAP_GROUP_LABELS.own }, ...own.map(option), { header: BASEMAP_GROUP_LABELS.builtin }, ...builtin.map(option));
      } else {
        options.push(...[...own, ...builtin].map(option));
      }
      const offers = engine.mxDetailedOffers.detailedMapOffers(list(lookups), { optionalUpdates: true });
      const onScreen = offers.some((offer) => offer.pick === shown.pick);
      const view = engine.mxMapProjection.mapViewOf(world?.projection);
      return {
        options,
        only: maps.length === 1,
        shownPick: shown.pick,
        offers: offers.map((offer) => ({ ...offer, size: engine.mxTiled.formatBytes(offer.bytes), ticked: onScreen ? offer.pick === shown.pick : Boolean(offer.starting) })),
        line: offers.length ? engine.mxDetailedOffers.detailedMapsDownloadLine(offers) : "",
        noGlobe: Boolean(view.noGlobe),
      };
    },
    "mapextras.library": async () => {
      const books = await engine.cmBasemapLibrary.listBasemaps().catch(() => []);
      return { entries: list(books).map(libraryEntry) };
    },
    "mapextras.libraryUsers": async ({ id = "" } = {}) => ({ users: list(await engine.mxTiled.listTiledBasemapUsers(clean(id)).catch(() => [])).map((user) => ({ name: clean(user?.name) })) }),
    "mapextras.libraryDelete": async ({ id = "" } = {}) => {
      await engine.cmBasemapLibrary.deleteBasemap(clean(id));
      return { ok: true };
    },
    "mapextras.libraryPublish": async ({ id = "" } = {}) => {
      const books = list(await engine.cmBasemapLibrary.listBasemaps().catch(() => []));
      const meta = books.find((entry) => entry.id === clean(id));
      if (!meta) throw new Error("That basemap is not in Your basemaps any more.");
      if (meta.kind === "tiled") {
        if (meta.official) {
          return { message: `"${meta.name}" is already on the list of detailed maps (version ${meta.official.version}). Scenarios you publish with it offer it to players. To release a new version, edit the map's post on the hub with the new download link.` };
        }
        return {
          url: engine.mxTiled.officialBasemapSubmissionUrl(meta),
          message: "Players only download detailed maps from the hub's list. On the GitHub page that opened, paste a direct download link to your .pmtiles file and say who made it, then submit. The hub checks it within minutes and adds it to the list. Until then, players of scenarios you publish with it see the basemap.",
        };
      }
      const payload = await engine.cmBasemapLibrary.getBasemapPayload(meta.id);
      const kind = meta.kind === "vector" ? "vector" : "image";
      const safe = safeName(meta.name);
      let fileName = "";
      let bytes = null;
      if (kind === "image") {
        const match = String(payload?.dataUrl ?? "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
        if (!match) throw new Error("This basemap has no image to publish.");
        const mime = match[1] || "image/png";
        bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
        const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "png";
        fileName = `${safe}.${ext}`;
      } else {
        if (!payload?.geojson) throw new Error("This vector basemap has no geometry to publish.");
        const zip = new JSZip();
        zip.file("basemap.geojson", JSON.stringify(payload.geojson));
        bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
        fileName = `${safe}.zip`;
      }
      const dir = downloadsDir();
      fs.mkdirSync(dir, { recursive: true });
      const saved = path.join(dir, fileName);
      fs.writeFileSync(saved, bytes);
      const technical = `Basemap-Hash: ${meta.contentHash || ""}\nBasemap-Kind: ${kind}`;
      const query = [
        "template=basemap.yml",
        `title=${encodeURIComponent(`[Basemap] ${meta.name || "Untitled basemap"}`)}`,
        `name=${encodeURIComponent(meta.name || "")}`,
        `author=${encodeURIComponent(meta.author || "")}`,
        `technical=${encodeURIComponent(technical)}`,
      ].join("&");
      return {
        url: `${HUB_URL}/issues/new?${query}`,
        file: saved,
        message: `"${fileName}" was downloaded. On the GitHub page that opened, drag that file into the "Basemap image" box, then submit.`,
      };
    },
    "mapextras.officialMaps": async ({ refresh = false } = {}) => {
      const official = await engine.mxTiled.fetchOfficialBasemaps({ refresh: Boolean(refresh) });
      const books = list(await engine.cmBasemapLibrary.listBasemaps().catch(() => []));
      const entries = list(official?.basemaps).map((entry) => {
        const installed = books.find((bm) => bm.kind === "tiled" && bm.official?.id === entry.id);
        return {
          id: clean(entry.id),
          name: clean(entry.name),
          author: clean(entry.author),
          license: clean(entry.license),
          versions: list(entry.versions).map((version) => ({ version: Number(version.version) || 0, bytes: Number(version.bytes) || 0, size: engine.mxTiled.formatBytes(version.bytes), preview: clean(version.preview), notes: clean(version.notes) })),
          have: Number(installed?.official?.version) || 0,
        };
      });
      return { entries, error: clean(official?.error) };
    },
    "mapextras.communityMaps": async ({ force = false } = {}) => {
      const posts = list(await engine.communityBasemaps.fetchCommunityBasemaps({ force: Boolean(force) }));
      const books = list(await engine.cmBasemapLibrary.listBasemaps().catch(() => []));
      const hashes = new Set(books.flatMap((bm) => [bm.contentHash, bm.source?.hash]).filter(Boolean).map((hash) => String(hash).toLowerCase()));
      const urls = new Set(books.map((bm) => bm.source?.url).filter(Boolean));
      return {
        posts: posts.map((post) => ({
          id: String(post.id ?? ""),
          title: clean(post.title),
          author: clean(post.author),
          kind: clean(post.kind),
          picture: clean(post.pictureUrl),
          fromScenario: Boolean(post.fromScenario),
          installable: Boolean(engine.communityBasemaps.basemapPostInstallable(post)),
          installed: Boolean((post.contentHash && hashes.has(String(post.contentHash).toLowerCase())) || (post.url && urls.has(post.url))),
        })),
      };
    },
    "mapextras.communityInstall": async ({ id = "" } = {}) => {
      const posts = list(await engine.communityBasemaps.fetchCommunityBasemaps({ force: false }));
      const post = posts.find((entry) => String(entry.id ?? "") === String(id));
      if (!post) throw new Error("That post is not on the hub any more.");
      const meta = await engine.communityBasemaps.installCommunityBasemap(post);
      return { added: libraryEntry(meta) };
    },
    "mapextras.picture": async ({ url = "" } = {}) => {
      const target = String(url || "");
      if (target.startsWith("data:image/")) return { data: target.replace(/^data:[^,]*,/, "") };
      if (!PICTURE_HOSTS.test(target)) return { data: "" };
      const dir = path.join(cacheDir, "maps-pictures");
      const file = path.join(dir, `${crypto.createHash("sha1").update(target).digest("hex")}.img`);
      if (fs.existsSync(file)) return { data: fs.readFileSync(file).toString("base64") };
      try {
        const response = await fetch(target);
        if (!response.ok) return { data: "" };
        const bytes = Buffer.from(await response.arrayBuffer());
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, bytes);
        return { data: bytes.toString("base64") };
      } catch {
        return { data: "" };
      }
    },
    "mapextras.natgeoTile": async ({ z = 0, x = 0, y = 0, labelsOnly = false } = {}) => {
      const tz = Math.max(0, Math.min(16, Math.round(Number(z) || 0)));
      const count = 2 ** tz;
      const tx = ((Math.round(Number(x) || 0) % count) + count) % count;
      const ty = Math.round(Number(y) || 0);
      if (ty < 0 || ty >= count) return { fills: "", lines: "", labels: [] };
      return natgeoTile(tz, tx, ty, Boolean(labelsOnly));
    },
    "mapextras.natgeoSprite": async () => {
      const sprite = await loadNatgeoSprite();
      return { json: sprite.json ?? {}, png: sprite.png ? Buffer.from(sprite.png).toString("base64") : "" };
    },
    "mapextras.natgeoGlyphs": async ({ font = "", start = 0 } = {}) => {
      const first = Math.max(0, Math.floor((Number(start) || 0) / 256) * 256);
      const name = String(font || "").trim();
      if (!name || first > 65280) return { font: name, start: first, glyphs: [] };
      return { font: name, start: first, glyphs: await natgeoGlyphs(name, first) };
    },
    "mapextras.settings": async () => settingsValues(),
    "mapextras.setGamePick": async ({ pick = "" } = {}) => {
      const settings = settingsValues();
      const key = `${GAME_PICK_PREFIX}${settings.gameId || "current"}`;
      engine.mapSettings.setMapSettingValue(key, String(pick) === "" ? STARTING_PICK_STORED : String(pick));
      storage.flush();
      return settingsValues();
    },
    "mapextras.world": async () => {
      const [world, game, colors] = await Promise.all([readShown(), readGame(), readColors()]);
      await loadRegions();
      void warmGeometry();
      const frozen = engine.mxIceFeatures.iceRegionIds({ frozen: world?.frozenRegions }).frozen.map(indexOf).filter((index) => index >= 0);
      const { groups, areas } = groupsOf(world);
      const groupNames = Object.keys(groups);
      const groupIndex = new Map(groupNames.map((name, slot) => [name, slot]));
      const groupRegions = [];
      for (const [regionId, name] of Object.entries(areas ?? {})) {
        const index = indexOf(regionId);
        if (index >= 0 && groupIndex.has(name)) groupRegions.push([index, groupIndex.get(name)]);
      }
      const view = engine.mxMapProjection.mapViewOf(world?.projection);
      return {
        sha: regions.sha,
        regionCount: regions.features.length,
        worldKnown: Object.keys(world ?? {}).length > 0,
        customRegions: Boolean(world?.customRegions),
        date: String(game?.gameDate || game?.startDate || ""),
        seasons: engine.mxWarSettings.warSettingsOf(world).mechanics.weather === true,
        frozen,
        claims: claimsOf(world, colors),
        groups: groupNames.map((name) => ({ name, color: String(groups[name]?.color || "#e11d48") })),
        groupRegions,
        regionTypes: regionTypesOf(world),
        noGlobe: view.noGlobe,
        noWrap: view.noWrap,
      };
    },
    "mapextras.seasonTint": async ({ width = 512, topLat = 0 } = {}) => {
      const [world, game] = await Promise.all([readWorld(), readGame()]);
      const top = Number(topLat) > 0 ? Number(topLat) : sx().MERCATOR_TOP_LAT;
      const size = Math.max(16, Math.min(2048, Math.round(Number(width) || 512)));
      const height = sx().seasonTintHeight(size, top);
      const zones = engine.mxGeography.climateZonesOf(world);
      const date = String(game?.gameDate || game?.startDate || "");
      const field = sx().seasonTintField({ zones, date, width: size, height, topLat: top });
      if (!field) return { none: true, date };
      return { date, width: field.width, height: field.height, topLat: field.topLat, data: base64Of(field.data) };
    },
    "mapextras.patterns": async () => {
      const ice = mp().ICE_LAYERS.map((_, layer) => {
        const image = mp().icePattern(layer);
        return { width: image.width, height: image.height, data: base64Of(image.data) };
      });
      return { tint: mp().ICE_TINT, ice };
    },
    "mapextras.groupAreas": async () => {
      const world = await readShown();
      const shape = await ensureGeometry();
      const { groups, areas } = groupsOf(world);
      if (!Object.keys(areas ?? {}).length) return { fills: [], outlines: [], labels: [] };
      shape.groupIndex ??= engine.mxGroupAreas.buildGroupAreaIndex(shape.topology);
      const colors = Object.fromEntries(Object.entries(groups ?? {}).map(([name, group]) => [name, { color: group?.color }]));
      const derived = engine.mxGroupAreas.deriveGroupAreas({
        topology: shape.topology,
        index: shape.groupIndex,
        regions: { type: "FeatureCollection", features: regions.features },
        groupAreas: areas,
        groups: colors,
        pointFor: (regionIndex) => {
          const record = shape.records[regionIndex];
          return record && Number.isFinite(record.lng) && Number.isFinite(record.lat) ? { lng: record.lng, lat: record.lat, weight: record.territoryWeight } : null;
        },
      });
      const fills = [];
      for (const [regionId, name] of Object.entries(areas)) {
        const index = indexOf(regionId);
        if (index < 0 || !colors[name]) continue;
        fills.push([index, name]);
      }
      return {
        fills,
        outlines: list(derived.outlines?.features).map((feature) => ({ group: feature.properties.group, color: feature.properties.color, lines: feature.geometry.coordinates })),
        labels: list(derived.labels?.features).map((feature) => ({ group: feature.properties.group, color: feature.properties.color, regions: feature.properties.regions, lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] })),
      };
    },
    "mapextras.flood": async ({ changes = [], previousNames = [], previousOwners = [], sha = "" } = {}) => {
      const startedAt = Date.now();
      const warm = sha && regions.sha === sha && geometry.sha === sha && geometry.topology;
      const shape = warm ? geometry : await ensureGeometry();
      const ownerAt = regionOwnerOf(previousNames, previousOwners);
      const changedSet = new Set(list(changes).map((change) => String(regions.ids[Number(change?.index)] ?? "")).filter(Boolean));
      const features = [];
      for (const change of list(changes)) {
        const index = Number(change?.index);
        const feature = regions.features[index];
        const geometryOf = feature?.geometry;
        if (!geometryOf || !["Polygon", "MultiPolygon"].includes(geometryOf.type)) continue;
        const fromOwner = ownerName(change?.from);
        const toOwner = ownerName(change?.to);
        if (!fromOwner || !toOwner || fromOwner === toOwner) continue;
        const direction = transitionDirection({ index, toOwner, ownerAt, changedSet, shape });
        features.push({
          type: "Feature",
          id: regions.ids[index],
          geometry: geometryOf,
          properties: {
            id: regions.ids[index],
            index,
            fromOwner,
            toOwner,
            sweepDx: direction.dx,
            sweepDy: direction.dy,
            sweepMode: direction.mode,
            sweepBasis: direction.basis,
            frontierSegments: direction.frontierSegments ?? [],
            fromColor: String(change?.fromColor ?? ""),
            toColor: String(change?.toColor ?? ""),
          },
        });
      }
      if (!features.length) return { mode: "none", elapsedMs: Date.now() - startedAt };
      const mode = settingsValues().transitionMode;
      const vertices = features.reduce((sum, feature) => sum + vertexCountOf(feature.geometry), 0);
      const eligible = mode !== "sweep" && features.length <= FLOOD_FIELD_LIMIT && vertices <= FLOOD_VERTEX_LIMIT;
      if (eligible) {
        const fields = [];
        for (const feature of features) {
          for (const field of engine.mxFlood.buildOwnershipFloodFields(feature)) {
            fields.push({
              index: feature.properties.index,
              width: field.width,
              height: field.height,
              bounds: field.bounds,
              data: base64Of(field.textureData),
              fromColor: field.fromColor,
              toColor: field.toColor,
              durationMs: field.durationMs,
              feather: field.feather,
              detached: field.detached,
              basis: field.sweepBasis,
            });
          }
        }
        if (fields.length && fields.length <= FLOOD_FIELD_LIMIT) return { mode: "flood", fields, elapsedMs: Date.now() - startedAt };
      }
      return {
        mode: "sweep",
        regions: features.map((feature) => ({ index: feature.properties.index, fromColor: feature.properties.fromColor, toColor: feature.properties.toColor, basis: feature.properties.sweepBasis, ...sweepBandsOf(feature) })),
        elapsedMs: Date.now() - startedAt,
      };
    },
    "mapextras.background": async ({ globe = false } = {}) => resolveBackground({ globe: Boolean(globe) }),
    "mapextras.reliefTile": async ({ url = "", z = 0, x = 0, y = 0 } = {}) => {
      const archive = engine.assets.getPmtilesArchive(String(url).replace(/^pmtiles:\/\//, ""));
      const read = async (zoom, column, row) => {
        try {
          const tile = await archive.getZxy(zoom, column, row);
          return tile?.data?.byteLength ? new Uint8Array(tile.data) : null;
        } catch {
          return null;
        }
      };
      const direct = await read(Number(z), Number(x), Number(y));
      if (direct) return { data: base64Of(direct), levels: 0, ox: 0, oy: 0 };
      for (let levels = 1; levels <= MAX_ANCESTOR_LEVELS && Number(z) - levels >= 0; levels += 1) {
        const ax = Number(x) >> levels;
        const ay = Number(y) >> levels;
        const ancestor = await read(Number(z) - levels, ax, ay);
        if (!ancestor) continue;
        return { data: base64Of(ancestor), levels, ox: Number(x) - (ax << levels), oy: Number(y) - (ay << levels) };
      }
      return { data: "" };
    },
    "mapextras.installBasemap": async ({ id = "", version = 0 } = {}, { signal, id: call }) => {
      const meta = await engine.mxTiled.installOfficialBasemap({
        id: clean(id),
        version: Number.isInteger(Number(version)) && Number(version) > 0 ? Number(version) : undefined,
        signal,
        onProgress: ({ received, total }) => emit("mapextras.install", { call, received: Number(received) || 0, total: Number(total) || 0 }),
      });
      return { ok: true, id: clean(meta?.id) };
    },
    "mapextras.dismissUpdate": async ({ id = "", version = 0 } = {}) => {
      engine.mxTiled.dismissTiledUpdate(clean(id), Number(version));
      storage.flush();
      return true;
    },
    "mapextras.detailedMaps": async () => {
      const world = await readWorld();
      const assets = engine.assets;
      const maps = engine.mxBasemapPick.scenarioMapsOfWorld({
        background: world?.background ?? null,
        basemap: world?.basemap || null,
        allowedBasemaps: Array.isArray(world?.allowedBasemaps) ? world.allowedBasemaps.map(String) : null,
        ownBasemaps: assets.decodeOwnBasemaps(assets.encodeOwnBasemaps(world?.ownBasemaps)),
      });
      const lookups = await engine.mxDetailedOffers.lookUpDetailedMaps(maps);
      const offers = engine.mxDetailedOffers.detailedMapOffers(lookups, { optionalUpdates: true });
      const settings = settingsValues();
      const shown = engine.mxBasemapPick.basemapShownFor({ maps, gamePick: settings.gamePick, defaultBasemap: settings.defaultBasemap, useDefault: settings.defaultBasemapOn, showDetailed: settings.scenarioTerrain !== "painted" });
      return {
        offers: offers.map((offer) => ({ ...offer, size: engine.mxTiled.formatBytes(offer.bytes) })),
        line: engine.mxDetailedOffers.detailedMapsDownloadLine(offers),
        shownPick: shown.pick,
      };
    },
    "mapextras.wording": async ({ offer = null, atInstall = false } = {}) => engine.mxTiledWording.tiledBasemapWording(offer, { atInstall: Boolean(atInstall) }),
    "mapextras.formatBytes": async ({ bytes = 0 } = {}) => engine.mxTiled.formatBytes(bytes),
    ...(ctx.standIn ? {
      "mapextras.standin_freeze": async ({ indices = [] } = {}) => {
        await loadRegions();
        const world = await readWorld();
        const ids = list(indices).map((index) => regions.ids[Number(index)]).filter(Boolean);
        await engine.gameState.writeWorldState({ ...world, frozenRegions: ids });
        return { ids };
      },
    } : {}),
  };
};
