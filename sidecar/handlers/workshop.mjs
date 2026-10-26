import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const NEUTRAL = [130, 130, 138];
const GROUP_TINT_ALPHA = 0.3;
const EARTH = 6378137;

const fallbackColorCache = new Map();
const editorCodeToColor = (code) => {
  const hit = fallbackColorCache.get(code);
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c = 0.5;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 0.25;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const rgb = [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  fallbackColorCache.set(code, rgb);
  return rgb;
};

const hexRgb = (hex) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hexToRgb = (value) => {
  const m = /^#?([a-f0-9]{6})$/i.exec(String(value || "").trim());
  if (!m) return null;
  const hex = m[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
};

const over = (topRgb, topAlpha, rgb, alpha) => {
  const out = topAlpha + alpha * (1 - topAlpha);
  if (out <= 0) return [rgb[0], rgb[1], rgb[2]];
  const mix = (i) => Math.round((topRgb[i] * topAlpha + rgb[i] * alpha * (1 - topAlpha)) / out);
  return [mix(0), mix(1), mix(2)];
};

const normalizePolityKeyedMap = (input, polities) => {
  const out = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  for (const [key, record] of Object.entries(polities || {})) {
    if (out[key] !== undefined) continue;
    const candidates = [record?.name, ...(Array.isArray(record?.aliases) ? record.aliases : [])]
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    const found = candidates.find((candidate) => out[candidate] !== undefined);
    if (found) out[key] = out[found];
  }
  return out;
};

const FLAGCDN = /^https?:\/\/flagcdn\.com\/(?:(?:[wh]\d+|\d+x\d+)\/)?([a-z]{2}(?:-[a-z]{2,3})?)\.(svg|png|webp|jpe?g)(?:[?#].*)?$/i;

export const register = (ctx) => {
  const { engine, emit, plain, clean, list, cacheDir, repo } = ctx;
  const lib = engine.library;
  const VectorSource = engine.wsOlVectorSource.default;
  const Feature = engine.wsOlFeature.default;
  const GeoJSON = engine.wsOlGeoJSON.default;
  const Polygon = engine.wsOlPolygon.default;
  const { toLonLat, fromLonLat } = engine.wsOlProj;
  const geo = engine.wsGeometry;
  const sweep = engine.wsTopology;
  const mapDoc = engine.wsMapDocument;
  const rename = engine.wsPolityRename;
  const groupsLib = engine.wsGroups;
  const typesLib = engine.wsRegionTypes;
  const undoLib = engine.wsDocumentUndo;
  const flagsDir = path.join(repo, "public", "flags");
  const workDir = path.join(cacheDir, "workshop");
  const clipboardFile = path.join(cacheDir, "workshop-clipboard.json");
  fs.mkdirSync(workDir, { recursive: true });

  let session = null;
  let clipboard = null;
  try {
    const stored = JSON.parse(fs.readFileSync(clipboardFile, "utf8"));
    clipboard = engine.wsRegionClipboard.isRegionClipboard(stored) ? stored : null;
  } catch {
    clipboard = null;
  }

  const need = (id) => {
    if (!session || (id && session.id !== id)) throw new Error("The map editor is not open.");
    return session;
  };

  const flagFileOf = (value) => {
    const match = FLAGCDN.exec(String(value ?? "").trim());
    if (!match) return "";
    const file = path.join(flagsDir, `${match[1].toLowerCase()}.svg`);
    return fs.existsSync(file) ? file : "";
  };

  const fmt = new GeoJSON();
  const READ = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" };
  const WRITE = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857", decimals: 5 };

  const paintColors = (s) => ({ ...s.palette, ...(s.doc.colorOverrides || {}) });
  const typesById = (s) => Object.fromEntries((s.doc.types || []).map((type) => [type.id, type]));

  const status = (s) => ({
    saveStatus: s.saveStatus,
    saveError: s.saveError,
    scenarioDirty: s.scenarioDirty,
    hydrated: s.hydrated,
    action: s.action,
  });
  const pushStatus = (s) => {
    if (session === s) emit("workshop.status", { session: s.id, ...status(s) });
  };

  const scheduleAutosave = (s) => {
    clearTimeout(s.autosaveTimer);
    s.autosaveTimer = setTimeout(() => {
      if (session !== s || s.saveStatus !== "dirty") return;
      s.retries = 0;
      void s.runSave();
    }, 2000);
  };

  const dirty = (s) => {
    s.edits += 1;
    s.saveStatus = "dirty";
    if (s.hydrated) s.scenarioDirty = true;
    scheduleAutosave(s);
  };

  const setDocField = (s, field, fallback) => (updater) => {
    const current = s.doc[field] ?? fallback;
    s.doc = { ...s.doc, [field]: typeof updater === "function" ? updater(current) : (updater ?? fallback) };
    dirty(s);
  };
  const setters = (s) => ({
    features: setDocField(s, "features", []),
    units: setDocField(s, "units", []),
    groups: setDocField(s, "groups", {}),
    puppets: setDocField(s, "puppets", []),
    terrainAreas: setDocField(s, "terrainAreas", []),
    fortifications: setDocField(s, "fortifications", []),
    climateZones: setDocField(s, "climateZones", []),
    freezingRegions: setDocField(s, "freezingRegions", []),
    types: (updater) => {
      s.doc = { ...s.doc, types: typeof updater === "function" ? updater(s.doc.types) : updater };
      dirty(s);
    },
  });

  const patchMetadata = (s, patch) => {
    s.doc = { ...s.doc, metadata: { ...s.doc.metadata, ...patch } };
    dirty(s);
  };

  const setColorOverride = (s, country, rgb) => {
    const owner = clean(country);
    if (!owner) return;
    const next = { ...(s.doc.colorOverrides || {}) };
    if (rgb) next[owner] = rgb; else delete next[owner];
    s.doc = { ...s.doc, colorOverrides: next };
    dirty(s);
  };

  const setFlag = (s, country, dataUrl) => {
    const owner = clean(country);
    if (!owner) return;
    const next = { ...(s.doc.flags || {}) };
    if (dataUrl) next[owner] = dataUrl; else delete next[owner];
    s.doc = { ...s.doc, flags: next };
    dirty(s);
  };

  const setTags = (s, country, values) => {
    const owner = clean(country);
    if (!owner) return;
    const tags = engine.wsCountryTags.normalizeTagList(values);
    const next = { ...(s.doc.tags || {}) };
    if (tags.length) next[owner] = tags; else delete next[owner];
    s.doc = { ...s.doc, tags: next };
    dirty(s);
  };

  const upsertPolity = (s, key, patch = {}) => {
    const stableKey = clean(key);
    if (!stableKey) return;
    const current = s.doc.polities?.[stableKey] || {};
    const record = {
      ...current,
      ...patch,
      name: String(patch.name ?? current.name ?? stableKey).trim() || stableKey,
      aliases: Array.isArray(patch.aliases ?? current.aliases)
        ? [...new Set((patch.aliases ?? current.aliases).map((v) => String(v || "").trim()).filter(Boolean))]
        : [],
    };
    for (const [field, value] of Object.entries(patch)) if (value === undefined) delete record[field];
    s.doc = { ...s.doc, polities: { ...(s.doc.polities || {}), [stableKey]: record } };
    dirty(s);
  };

  const renamePolityDoc = (s, from, to) => {
    try {
      const renamed = rename.renamePolityInDocument(s.doc, from, to);
      const fromKey = rename.findPolityKey(s.doc.polities, from) || from;
      s.doc = { ...renamed, polityRenames: [...(Array.isArray(s.doc.polityRenames) ? s.doc.polityRenames : []), { from: fromKey, to }] };
    } catch (error) {
      console.warn("[editor] polity rename refused:", error);
    }
    dirty(s);
  };

  const removePolitiesDoc = (s, keys) => {
    const stableKeys = [...new Set((keys || []).map((key) => clean(key)).filter(Boolean))];
    if (!stableKeys.length) return;
    const polities = { ...(s.doc.polities || {}) };
    const colorOverrides = { ...(s.doc.colorOverrides || {}) };
    const flags = { ...(s.doc.flags || {}) };
    const tags = { ...(s.doc.tags || {}) };
    for (const stableKey of stableKeys) {
      delete polities[stableKey];
      delete colorOverrides[stableKey];
      delete flags[stableKey];
      delete tags[stableKey];
    }
    s.doc = { ...s.doc, polities, colorOverrides, flags, tags, puppets: engine.wsPuppets.withoutPolities(s.doc.puppets, stableKeys.length === 1 ? stableKeys[0] : stableKeys) };
    dirty(s);
  };

  const importPolityRoster = (s, rows) => {
    const { summary } = engine.wsPolityRoster.mergePolityRoster({ polities: s.doc.polities }, rows);
    if (!summary.count) return summary;
    s.doc = engine.wsPolityRoster.mergePolityRoster(s.doc, rows).doc;
    dirty(s);
    return summary;
  };

  const features = (s) => s.source.getFeatures();

  const pushCmd = (s, cmd) => {
    s.undo.push(cmd);
    if (s.undo.length > 80) s.undo.shift();
    s.redo = [];
  };

  const notify = (s, { loaded = false, geometry = false } = {}) => {
    if (!loaded) dirty(s);
    s.regionRev += 1;
    if (geometry) s.geometryRev += 1;
  };

  const summarize = (f) => ({
    id: f.getId(),
    name: f.get("name") || "",
    owner: f.get("owner") || null,
    typeId: f.get("typeId") || "land",
    country: f.get("country") || "",
    claimants: f.get("claimants") || [],
    group: f.get("group") || "",
  });

  const listPolityUsage = (s) => {
    const rows = new Map();
    const ensure = (key) => {
      const stableKey = clean(key);
      if (!stableKey) return null;
      if (!rows.has(stableKey)) rows.set(stableKey, { key: stableKey, regionCount: 0, claimantCount: 0 });
      return rows.get(stableKey);
    };
    for (const f of features(s)) {
      const owner = ensure(f.get("owner"));
      if (owner) owner.regionCount += 1;
      for (const claimant of Array.isArray(f.get("claimants")) ? f.get("claimants") : []) {
        const row = ensure(claimant);
        if (row) row.claimantCount += 1;
      }
    }
    return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
  };

  const listGroupUsage = (s) => {
    const counts = {};
    for (const f of features(s)) {
      const group = clean(f.get("group"));
      if (group) counts[group] = (counts[group] ?? 0) + 1;
    }
    return counts;
  };

  const listOwners = (s) => {
    const owners = new Set();
    for (const f of features(s)) {
      const owner = f.get("owner");
      if (owner) owners.add(String(owner));
    }
    return [...owners].sort((a, b) => a.localeCompare(b));
  };

  const polityChoices = (s, extra = "") => {
    const keys = new Set(Object.keys(s.doc.polities || {}));
    for (const row of listPolityUsage(s)) keys.add(row.key);
    if (extra) keys.add(extra);
    return [...keys]
      .filter(Boolean)
      .map((key) => ({ key, name: String(s.doc.polities?.[key]?.name || key) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  };

  const setRegionAttrs = (s, ids, patch) => {
    const undos = [];
    for (const id of ids) {
      const f = s.source.getFeatureById(id);
      if (!f) continue;
      const before = {};
      let claimants;
      if ("owner" in patch) { before.owner = f.get("owner") || null; f.set("owner", patch.owner || null); }
      if ("typeId" in patch) { before.typeId = f.get("typeId"); f.set("typeId", patch.typeId); }
      if ("name" in patch) { before.name = f.get("name"); f.set("name", patch.name); s.nameEdits.set(String(f.getId()), String(patch.name ?? "")); }
      if ("claimants" in patch) {
        before.claimants = f.get("claimants") || null;
        claimants = typeof patch.claimants === "function" ? patch.claimants(before.claimants || []) : patch.claimants;
        claimants = claimants?.length ? claimants : null;
        f.set("claimants", claimants);
      }
      if ("group" in patch) { before.group = f.get("group") || null; f.set("group", patch.group || null); }
      undos.push([f, before, claimants]);
    }
    notify(s);
    if (undos.length) {
      const after = { ...patch };
      pushCmd(s, {
        undo: () => undos.forEach(([f, b]) => Object.keys(b).forEach((k) => {
          f.set(k, b[k]);
          if (k === "name") s.nameEdits.set(String(f.getId()), String(b[k] ?? ""));
        })),
        redo: () => undos.forEach(([f, , claimants]) => {
          if ("owner" in after) f.set("owner", after.owner || null);
          if ("typeId" in after) f.set("typeId", after.typeId);
          if ("name" in after) { f.set("name", after.name); s.nameEdits.set(String(f.getId()), String(after.name ?? "")); }
          if ("claimants" in after) f.set("claimants", claimants);
          if ("group" in after) f.set("group", after.group || null);
        }),
      });
    }
  };

  const renameOwner = (s, from, to) => {
    const same = (value) => rename.samePolityName(value, from);
    const undos = [];
    for (const f of features(s)) {
      const owner = f.get("owner") || null;
      const claimants = Array.isArray(f.get("claimants")) ? f.get("claimants") : [];
      const ownerHit = Boolean(owner) && same(owner);
      const claimHit = claimants.some(same);
      if (!ownerHit && !claimHit) continue;
      const before = { owner, claimants: claimants.length ? claimants.slice() : null };
      const nextClaimants = claimHit ? [...new Set(claimants.map((claimant) => (same(claimant) ? to : claimant)))] : before.claimants;
      const after = { owner: ownerHit ? to : owner, claimants: nextClaimants?.length ? nextClaimants : null };
      f.set("owner", after.owner);
      f.set("claimants", after.claimants);
      undos.push([f, before, after]);
    }
    if (!undos.length) return 0;
    notify(s);
    pushCmd(s, {
      undo: () => undos.forEach(([f, b]) => { f.set("owner", b.owner); f.set("claimants", b.claimants); }),
      redo: () => undos.forEach(([f, , a]) => { f.set("owner", a.owner); f.set("claimants", a.claimants); }),
    });
    return undos.length;
  };

  const removeOwners = (s, ownerKeys) => {
    const keys = new Set((ownerKeys || []).map((key) => clean(key)).filter(Boolean));
    if (!keys.size) return { affectedRegions: 0, ownedRegions: 0, claimRefs: 0 };
    const undos = [];
    let ownedRegions = 0;
    let claimRefs = 0;
    for (const f of features(s)) {
      const owner = f.get("owner") || null;
      const claimants = Array.isArray(f.get("claimants")) ? f.get("claimants") : [];
      const ownerHit = Boolean(owner) && keys.has(String(owner).trim());
      const removedClaims = claimants.filter((claimant) => keys.has(clean(claimant)));
      if (!ownerHit && !removedClaims.length) continue;
      const before = { owner, claimants: claimants.length ? claimants.slice() : null };
      const nextClaimants = removedClaims.length ? claimants.filter((claimant) => !keys.has(clean(claimant))) : claimants;
      const after = { owner: ownerHit ? null : owner, claimants: nextClaimants.length ? nextClaimants : null };
      f.set("owner", after.owner);
      f.set("claimants", after.claimants);
      if (ownerHit) ownedRegions += 1;
      claimRefs += removedClaims.length;
      undos.push([f, before, after]);
    }
    if (!undos.length) return { affectedRegions: 0, ownedRegions: 0, claimRefs: 0 };
    notify(s);
    pushCmd(s, {
      undo: () => undos.forEach(([f, b]) => { f.set("owner", b.owner); f.set("claimants", b.claimants); }),
      redo: () => undos.forEach(([f, , a]) => { f.set("owner", a.owner); f.set("claimants", a.claimants); }),
    });
    return { affectedRegions: undos.length, ownedRegions, claimRefs };
  };

  const selectOwner = (s, ownerKey) => {
    const key = clean(ownerKey);
    if (!key) return [];
    return features(s).filter((f) => clean(f.get("owner")) === key).map((f) => f.getId());
  };

  const unionExtent = (feats) => {
    if (!feats.length) return null;
    let ext = feats[0].getGeometry().getExtent().slice();
    for (const f of feats.slice(1)) {
      const e = f.getGeometry().getExtent();
      ext = [Math.min(ext[0], e[0]), Math.min(ext[1], e[1]), Math.max(ext[2], e[2]), Math.max(ext[3], e[3])];
    }
    const [west, south] = toLonLat([ext[0], ext[1]]);
    const [east, north] = toLonLat([ext[2], ext[3]]);
    return [[west, south], [east, north]];
  };

  const interiorPoint = (geom) => {
    const type = geom.getType();
    if (type === "Polygon") {
      const c = geom.getInteriorPoint().getCoordinates();
      return [c[0], c[1]];
    }
    if (type === "MultiPolygon") {
      const pts = geom.getInteriorPoints().getCoordinates();
      return pts.length ? [pts[0][0], pts[0][1]] : null;
    }
    return null;
  };

  const featureList = (s) => s.doc.features || [];

  const regionsPart = (s) => {
    const colors = paintColors(s);
    const groupColors = Object.fromEntries(Object.entries(groupsLib.normalizeGroups(s.doc.groups)).map(([name, group]) => [name, group.color]));
    const byType = typesById(s);
    const ownerKeys = [];
    const ownerIndexOf = new Map();
    const ownerIndex = new Array(s.baked.length);
    const fills = new Array(s.baked.length);
    for (let i = 0; i < s.baked.length; i += 1) {
      const f = s.baked[i];
      if (!f) {
        ownerIndex[i] = -1;
        fills[i] = -1;
        continue;
      }
      const owner = f.get("owner") || null;
      if (owner) {
        if (!ownerIndexOf.has(owner)) {
          ownerIndexOf.set(owner, ownerKeys.length);
          ownerKeys.push(owner);
        }
        ownerIndex[i] = ownerIndexOf.get(owner);
      } else {
        ownerIndex[i] = -1;
      }
      const type = byType[f.get("typeId") || "land"];
      const ownerRgb = (name) => (Array.isArray(colors[name]) ? colors[name] : editorCodeToColor(name));
      const base = type?.overrideColor ? (Array.isArray(type.overrideColor) ? type.overrideColor : NEUTRAL) : owner ? ownerRgb(owner) : null;
      const group = f.get("group") || "";
      const groupRgb = group ? hexRgb(groupColors[group]) : null;
      if (!base && !groupRgb) {
        fills[i] = -1;
        continue;
      }
      const baseRgb = base || NEUTRAL;
      const alpha = owner ? (type?.opacity ?? 0.55) : (type?.unownedOpacity ?? 0.25);
      const rgb = groupRgb ? over(groupRgb, GROUP_TINT_ALPHA, baseRgb, alpha) : baseRgb;
      fills[i] = ((rgb[0] & 255) << 16) | ((rgb[1] & 255) << 8) | (rgb[2] & 255);
    }
    const ownerColors = ownerKeys.map((key) => {
      const rgb = Array.isArray(colors[key]) ? colors[key] : editorCodeToColor(key);
      return rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))));
    });
    const names = {};
    for (const [id, name] of s.nameEdits) {
      const index = s.bakedIndex.get(id);
      if (index !== undefined) names[index] = name;
    }
    return { rev: s.regionRev, ownerIndex, owners: ownerKeys, ownerNames: ownerKeys.map((key) => String(s.doc.polities?.[key]?.name || key)), ownerColors, fills, names, count: features(s).length };
  };

  const docPart = (s) => {
    const colors = paintColors(s);
    const keys = new Set([...Object.keys(s.doc.polities || {}), ...listOwners(s)]);
    const polityColors = {};
    for (const key of keys) polityColors[key] = Array.isArray(colors[key]) ? colors[key].slice(0, 3) : editorCodeToColor(key);
    const flagFiles = {};
    for (const [key, value] of Object.entries(s.doc.flags || {})) flagFiles[key] = flagFileOf(value);
    return {
      name: s.doc.metadata?.name || "",
      author: s.doc.metadata?.author || "",
      metadata: {
        basemap: s.doc.metadata?.basemap || "ocean",
        projection: s.doc.metadata?.projection ?? null,
        customBackground: s.doc.metadata?.customBackground ? { kind: s.doc.metadata.customBackground.kind } : null,
        tiledBasemap: s.doc.metadata?.tiledBasemap ? { name: s.doc.metadata.tiledBasemap.name || "" } : null,
      },
      polities: s.doc.polities || {},
      colors: polityColors,
      colorOverrides: s.doc.colorOverrides || {},
      flags: s.doc.flags || {},
      flagFiles,
      tags: s.doc.tags || {},
      groups: groupsLib.normalizeGroups(s.doc.groups),
      rawGroups: s.doc.groups || {},
      puppets: s.doc.puppets || [],
      types: s.doc.types || [],
      polityCount: (() => {
        const all = new Set(Object.keys(s.doc.polities || {}));
        for (const row of listPolityUsage(s)) all.add(row.key);
        return all.size;
      })(),
      groupCount: new Set([...Object.keys(s.doc.groups || {}), ...Object.keys(listGroupUsage(s))]).size,
      counts: { regions: features(s).length, features: featureList(s).length, units: (s.doc.units || []).length, types: (s.doc.types || []).length },
      clipboardCount: clipboard?.regions?.features?.length ?? 0,
      militaryDefaults: s.initialMap?.militaryDefaults ?? null,
      freezingCount: freezingCountOf(s),
    };
  };

  const featuresPart = (s) => featureList(s).map((f) => ({
    id: f.id,
    name: f.name || "",
    coord: Array.isArray(f.coord) ? f.coord : null,
    population: f.population ?? 0,
    tags: Array.isArray(f.tags) ? f.tags : [],
    tier: f.tier ?? null,
    kind: f.kind || "",
    owner: f.owner || null,
    country: f.country || "",
    status: f.status || "",
    note: f.note || "",
    symbol: f.symbol || "square",
    type: f.type || "Coordinate",
    populationByYear: f.populationByYear || null,
    isMap: engine.wsMapFeatures.isMapFeature(f),
  }));

  const warPart = (s) => ({
    terrainAreas: s.doc.terrainAreas || [],
    fortifications: s.doc.fortifications || [],
    climateZones: s.doc.climateZones || [],
    freezingRegions: s.doc.freezingRegions || [],
  });

  const freezingCountOf = (s) => {
    const typesById = Object.fromEntries((s.doc.types || []).map((type) => [type.id, type]));
    return (s.doc.freezingRegions || []).filter((rid) => {
      const f = s.source.getFeatureById(String(rid));
      return Boolean(f) && engine.wsRegionTypes.isWaterType(typesById[f.get("typeId")]);
    }).length;
  };

  const writeBakeFile = (s, fc) => {
    s.bakeSerial += 1;
    const file = path.join(workDir, `${s.id}-${s.bakeSerial}.geojson`);
    fs.writeFileSync(file, typeof fc === "string" ? fc : JSON.stringify(fc));
    if (s.bakeFile && s.bakeFile !== file) fs.rm(s.bakeFile, { force: true }, () => {});
    s.bakeFile = file;
    return file;
  };

  const rebake = (s) => {
    const feats = features(s);
    const fc = fmt.writeFeaturesObject(feats, WRITE);
    s.baked = feats.slice();
    s.bakedIndex = new Map(feats.map((f, index) => [String(f.getId()), index]));
    s.nameEdits.clear();
    s.bakedGeometryRev = s.geometryRev;
    return writeBakeFile(s, fc);
  };

  const delta = (s, parts = {}) => {
    const out = { session: s.id, status: status(s), history: { canUndo: s.undo.length > 0, canRedo: s.redo.length > 0 } };
    if (s.geometryRev !== s.bakedGeometryRev) {
      out.bake = { file: rebake(s) };
      parts.regions = true;
    }
    if (parts.regions || parts.all) out.regions = regionsPart(s);
    if (parts.doc || parts.all || parts.regions) out.doc = docPart(s);
    if (parts.features || parts.all) out.features = featuresPart(s);
    if (parts.units || parts.all) out.units = s.doc.units || [];
    if (parts.war || parts.all) out.war = warPart(s);
    return plain(out);
  };

  const buildDocumentFields = (s) => ({
    name: s.doc.metadata?.name,
    metadata: s.doc.metadata,
    types: s.doc.types,
    features: s.doc.features,
    colorOverrides: s.doc.colorOverrides || {},
    flags: s.doc.flags || {},
    tags: s.doc.tags || {},
    polities: s.doc.polities || {},
    units: s.doc.units || [],
    groups: s.doc.groups || {},
    puppets: s.doc.puppets || [],
    terrainAreas: s.doc.terrainAreas || [],
    fortifications: s.doc.fortifications || [],
    climateZones: s.doc.climateZones || [],
    freezingRegions: s.doc.freezingRegions || [],
    ownerSchema: s.doc.ownerSchema ?? engine.wsDocumentMigration.OWNER_SCHEMA,
  });

  const serializeRegions = (s) => fmt.writeFeaturesObject(features(s), WRITE);

  const buildPayload = (s, regions = null) => ({ ...buildDocumentFields(s), regions: regions || serializeRegions(s) });

  const serializeRegionChanges = (s) => {
    const feats = features(s);
    const writtenFeatures = (function* write() {
      for (const feature of feats) yield fmt.writeFeatureObject(feature, WRITE);
    })();
    const result = engine.wsRegionChanges.buildRegionChanges({ writtenFeatures, saved: s.savedRegionHashes });
    const commit = () => {
      s.savedRegionHashes.clear();
      if (result.marks) for (const [id, stamp] of result.marks) s.savedRegionHashes.set(id, stamp);
    };
    if (result.full) {
      return {
        full: result.features ? { type: "FeatureCollection", features: result.features } : fmt.writeFeaturesObject(feats, WRITE),
        changed: [],
        removed: [],
        count: feats.length,
        commit,
      };
    }
    return { full: null, changed: result.changed, removed: result.removed, count: result.count, commit };
  };

  const attemptSave = async (s) => {
    const id = s.docId;
    const edits = s.edits;
    if (id && edits === s.savedEdits) return true;
    try {
      s.saveStatus = "saving";
      pushStatus(s);
      const changes = serializeRegionChanges(s);
      const creating = !id;
      const payload = !changes || creating || changes.full
        ? buildPayload(s, changes?.full ?? null)
        : { ...buildDocumentFields(s), regionsDelta: { changed: changes.changed, count: changes.count, removed: changes.removed } };
      let saved = await engine.wsDocumentIO.saveDocument(id, payload);
      if (saved?.needsFullRegions) {
        console.warn("[editor] the store could not apply the map difference; writing the whole map:", saved.needsFullRegions);
        s.savedRegionHashes.clear();
        saved = await engine.wsDocumentIO.saveDocument(saved.id ?? id, buildPayload(s));
      }
      if (!id) s.docId = saved.id;
      changes?.commit?.();
      if (s.edits !== edits) {
        pushStatus(s);
        return false;
      }
      s.savedEdits = edits;
      s.retries = 0;
      s.saveError = "";
      s.saveStatus = "saved";
      pushStatus(s);
      return true;
    } catch (error) {
      console.warn("[editor] save failed:", error);
      s.saveError = error?.message || String(error);
      s.saveStatus = "error";
      pushStatus(s);
      const delay = engine.wsDocumentSaving.saveRetryDelay(s.retries);
      if (delay != null) {
        clearTimeout(s.retryTimer);
        s.retryTimer = setTimeout(() => {
          if (session !== s || s.saveStatus !== "error") return;
          s.retries += 1;
          void s.runSave();
        }, delay);
      }
      return false;
    }
  };

  const loadBasePalette = async () => {
    try {
      const response = await fetch("/assets/colors.json");
      return response.ok ? (await response.json()) || {} : {};
    } catch {
      return {};
    }
  };

  const buildSeedFor = async (scenario, world, { gameDate = "", warSettings } = {}) => {
    const asset = (key) => lib.downloadScenarioJsonAsset(scenario.id, key);
    const [regions, cities, colors, flags, tags, bgData, ownBasemapsData] = await Promise.all([
      asset("regionsGeojson"),
      asset("citiesGeojson"),
      asset("colors"),
      asset("flags"),
      asset("tags"),
      world.background?.kind === "image" || world.background?.kind === "vector" ? asset("backgroundData") : Promise.resolve(null),
      engine.assets.normalizeOwnBasemaps(world.ownBasemaps).length ? asset("ownBasemapsData").catch(() => null) : Promise.resolve(null),
    ]);
    const bgDesc = world.background;
    const background = bgDesc?.kind === "image" && bgData?.dataUrl
      ? { kind: "image", dataUrl: bgData.dataUrl, ...(bgDesc.bounds ? { bounds: bgDesc.bounds } : {}) }
      : bgDesc?.kind === "vector" && bgData?.geojson
        ? { kind: "vector", geojson: bgData.geojson }
        : bgDesc?.kind === "plain"
          ? { kind: "plain" }
          : null;
    const tiledBasemap = bgDesc?.kind === "vector" && (bgDesc.tiled?.id || bgDesc.tiled?.hash)
      ? { ...bgDesc.tiled, ...(Array.isArray(bgDesc.fillOpacity) ? { fillOpacity: bgDesc.fillOpacity } : {}) }
      : null;
    const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
    return {
      tiledBasemap,
      name: scenario.name || "",
      author: world.author || "",
      ownershipOverrides: world.regionOwnershipOverrides || {},
      claimOverrides: {
        claimants: isRecord(world.regionClaimants) ? world.regionClaimants : {},
        settled: Array.isArray(world.settledRegionClaims) ? world.settledRegionClaims : [],
        groupAreas: isRecord(world.groupAreas) ? world.groupAreas : {},
      },
      groups: isRecord(world.groups) ? world.groups : {},
      regions: regions && Array.isArray(regions.features) && regions.features.length ? regions : null,
      cities: cities && Array.isArray(cities.features) ? cities : null,
      colors: isRecord(colors) ? colors : null,
      flags: isRecord(flags) ? flags : null,
      tags: isRecord(tags) ? tags : null,
      polities: isRecord(world.polityOverrides) ? world.polityOverrides : {},
      background,
      startingMapName: typeof bgDesc?.name === "string" ? bgDesc.name : "",
      projection: world.projection ?? null,
      basemap: world.basemap || null,
      allowedBasemaps: Array.isArray(world.allowedBasemaps) ? world.allowedBasemaps : null,
      ownBasemaps: engine.wsOwnBasemaps.ownBasemapsFromGame(world.ownBasemaps, ownBasemapsData),
      customCities: Boolean(world.customCities),
      units: Array.isArray(world.units) ? world.units : [],
      markers: Array.isArray(world.markers) ? world.markers : [],
      puppets: Array.isArray(world.puppets) ? world.puppets : [],
      regionTypes: Array.isArray(world.regionTypes) && world.regionTypes.length ? world.regionTypes : null,
      militaryDefaults: engine.wsMilitaryForm.militaryDefaultsFor(warSettings === undefined ? world.warSettings : warSettings, gameDate, { rules: world.simulationRules }),
      ...engine.wsWarGeography.warGeographyOf(world),
    };
  };

  const hydrate = async (s, initialMap) => {
    s.polityAuthoringOps = [];
    const base = mapDoc.createDocument({ name: initialMap.name || "Scenario Map", kind: "import-world" });
    base.metadata.author = initialMap.author || "";
    if (initialMap.basemap) base.metadata.basemap = initialMap.basemap;
    if (Array.isArray(initialMap.allowedBasemaps)) base.metadata.allowedBasemaps = initialMap.allowedBasemaps;
    if (Array.isArray(initialMap.ownBasemaps) && initialMap.ownBasemaps.length) base.metadata.ownBasemaps = initialMap.ownBasemaps;
    if (initialMap.background) base.metadata.customBackground = initialMap.background;
    if (initialMap.tiledBasemap) base.metadata.tiledBasemap = initialMap.tiledBasemap;
    if (initialMap.startingMapName) base.metadata.startingMapName = initialMap.startingMapName;
    if (initialMap.projection) base.metadata.projection = initialMap.projection;
    if (initialMap.polities && typeof initialMap.polities === "object") base.polities = structuredClone(initialMap.polities);
    base.groups = groupsLib.normalizeGroups(initialMap.groups);
    base.puppets = Array.isArray(initialMap.puppets) ? structuredClone(initialMap.puppets) : [];
    Object.assign(base, engine.wsWarGeography.warGeographyOf(initialMap));
    const regionTypes = typesLib.normalizeRegionTypes(initialMap.regionTypes);
    if (regionTypes.length) base.types = regionTypes;
    if (initialMap.flags) base.flags = normalizePolityKeyedMap(initialMap.flags, base.polities);
    if (initialMap.tags) base.tags = normalizePolityKeyedMap(initialMap.tags, base.polities);
    if (initialMap.customCities) base.metadata.citiesAuthored = true;
    base.features = (initialMap.cities?.features || [])
      .map((f) => engine.wsExportPreset.gameCityToFeature(f, mapDoc.newId("feat")))
      .filter(Boolean);
    base.features.push(...(Array.isArray(initialMap.markers) ? initialMap.markers : [])
      .map((marker) => engine.wsMapFeatures.markerToFeature(marker, mapDoc.newId("feat")))
      .filter(Boolean));
    base.units = (Array.isArray(initialMap.units) ? initialMap.units : [])
      .filter((u) => Number.isFinite(Number(u?.lng)) && Number.isFinite(Number(u?.lat)))
      .map((u) => ({
        id: String(u.id || mapDoc.newId("unit")),
        name: String(u.name || "Unit"),
        type: String(u.type || "infantry"),
        ownerCode: String(u.ownerCode || ""),
        lng: Number(u.lng),
        lat: Number(u.lat),
        strength: Number.isFinite(Number(u.strength)) ? Number(u.strength) : 100,
        composition: String(u.composition || ""),
        note: String(u.note || ""),
      }));
    s.doc = base;
    let palette = {};
    if (initialMap.colors) palette = { ...palette, ...normalizePolityKeyedMap(initialMap.colors, initialMap.polities) };
    if (initialMap.polities) {
      const polityColors = {};
      for (const [key, record] of Object.entries(initialMap.polities)) {
        const rgb = hexToRgb(record?.color);
        if (rgb) polityColors[key] = rgb;
      }
      palette = { ...palette, ...polityColors };
    }
    s.palette = { ...(await loadBasePalette()), ...palette };
    let feats = [];
    let fileText = null;
    if (initialMap.regions) {
      feats = fmt.readFeatures(initialMap.regions, READ);
      const stampClaims = engine.wsClaims.claimStamper(initialMap.claimOverrides || null);
      const overrides = initialMap.ownershipOverrides || {};
      for (const f of feats) {
        const p = f.getProperties();
        if (f.getId() == null && p.id != null) f.setId(String(p.id));
        if (f.get("typeId") == null) f.set("typeId", "land");
        const id = f.getId();
        if (overrides && id != null && Object.prototype.hasOwnProperty.call(overrides, id)) f.set("owner", overrides[id] || null);
        stampClaims(f);
      }
      fileText = JSON.stringify(initialMap.regions);
    } else {
      feats = await engine.wsRegionImport.loadSeedFeatures();
      const stampClaims = engine.wsClaims.claimStamper(initialMap.claimOverrides || null);
      const overrides = initialMap.ownershipOverrides || {};
      for (const f of feats) {
        const id = f.getId();
        if (id != null && overrides[id] !== undefined) f.set("owner", overrides[id] || null);
        stampClaims(f);
      }
    }
    s.source.clear();
    s.savedRegionHashes.clear();
    if (feats.length) s.source.addFeatures(feats);
    s.baked = feats.slice();
    s.bakedIndex = new Map(feats.map((f, index) => [String(f.getId()), index]));
    s.nameEdits.clear();
    s.undo = [];
    s.redo = [];
    s.regionRev += 1;
    s.bakedGeometryRev = s.geometryRev;
    writeBakeFile(s, fileText ?? fmt.writeFeaturesObject(feats, WRITE));
    s.docId = null;
    s.savedEdits = s.edits;
    s.retries = 0;
    s.saveError = "";
    s.saveStatus = "saved";
    s.scenarioDirty = false;
    s.hydrated = true;
  };

  const newSession = (scenario) => {
    const s = {
      id: crypto.randomUUID(),
      scenario: { id: clean(scenario.id), name: clean(scenario.name) },
      doc: mapDoc.createDocument(),
      palette: {},
      source: new VectorSource({ wrapX: false }),
      baked: [],
      bakedIndex: new Map(),
      nameEdits: new Map(),
      bakeFile: "",
      bakeSerial: 0,
      regionRev: 0,
      geometryRev: 0,
      bakedGeometryRev: 0,
      undo: [],
      redo: [],
      polityAuthoringOps: [],
      scenarioDirty: false,
      hydrated: false,
      saveStatus: "saved",
      saveError: "",
      edits: 0,
      savedEdits: 0,
      retries: 0,
      docId: null,
      savedRegionHashes: new Map(),
      initialMap: null,
      action: "",
      cleanupStop: false,
      autosaveTimer: null,
      retryTimer: null,
    };
    s.runSave = engine.wsDocumentSaving.createSaveRunner(() => attemptSave(s));
    return s;
  };

  const closeSession = (s) => {
    clearTimeout(s.autosaveTimer);
    clearTimeout(s.retryTimer);
    if (s.bakeFile) fs.rm(s.bakeFile, { force: true }, () => {});
    if (session === s) session = null;
  };

  const removalsForScenario = (operations) => {
    const removals = [];
    operations.forEach((operation, index) => {
      if (operation?.op !== "remove") return;
      let key = operation.key;
      for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
        const previous = operations[earlier];
        if (previous?.op === "rename" && rename.samePolityName(previous.to, key)) key = previous.from;
      }
      removals.push({ op: "remove", key });
    });
    return removals;
  };

  const expandExtent = (extent, pad) => [extent[0] - pad, extent[1] - pad, extent[2] + pad, extent[3] + pad];
  const pointSegmentDistance = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const wx = p[0] - a[0];
    const wy = p[1] - a[1];
    const vv = vx * vx + vy * vy;
    const t = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
    const x = a[0] + t * vx;
    const y = a[1] + t * vy;
    return Math.hypot(p[0] - x, p[1] - y);
  };
  const geometryRings = (geom) => {
    if (!geom) return [];
    const type = geom.getType?.();
    const coords = geom.getCoordinates?.() || [];
    if (type === "Polygon") return coords;
    if (type === "MultiPolygon") return coords.flat();
    return [];
  };
  const buildBoundaryIndex = (regionGeom) => {
    const type = regionGeom?.getType?.();
    const ends = type === "Polygon" ? regionGeom.getEnds() : type === "MultiPolygon" ? regionGeom.getEndss().flat() : [];
    return sweep.indexBoundary(ends.length ? regionGeom.getFlatCoordinates() : [], ends, regionGeom?.getStride?.() || 2);
  };
  const boundaryTouchScore = (gapGeom, boundaryIndex, epsilon) => {
    const gapRing = geometryRings(gapGeom)[0] || [];
    if (!gapRing.length || !boundaryIndex || !boundaryIndex.size) return 0;
    const step = Math.max(1, Math.floor(gapRing.length / 80));
    let score = 0;
    for (let i = 0; i < gapRing.length; i += step) {
      const p = gapRing[i];
      const near = boundaryIndex.near(p[0], p[1], epsilon);
      for (const [a, b] of near) {
        if (pointSegmentDistance(p, a, b) <= epsilon) {
          score += 1;
          break;
        }
      }
    }
    return score;
  };

  const topologyTools = (s) => {
    const regionSource = s.source;
    const topologyContext = (feats) => {
      const selectedSet = new Set(feats);
      const featureOrder = new Map(feats.map((feature, index) => [feature, index]));
      const areaCache = new Map();
      const areaOf = (feature) => {
        if (!feature) return -1;
        if (!areaCache.has(feature)) areaCache.set(feature, geo.planarGeometryArea(feature.getGeometry()));
        return areaCache.get(feature);
      };
      const boundaryIndexes = new Map();
      const boundaryIndexOf = (feature) => {
        let index = boundaryIndexes.get(feature);
        if (!index) {
          index = buildBoundaryIndex(feature.getGeometry());
          boundaryIndexes.set(feature, index);
        }
        return index;
      };
      let serial = 0;
      return { selectedSet, featureOrder, areaOf, boundaryIndexOf, nextId: () => ++serial };
    };
    const assignGapTargets = (holes, width, { selectedSet, featureOrder, areaOf, boundaryIndexOf, nextId }, { maxTargetVertices = Infinity, onLeftAlone } = {}) => {
      const items = [];
      const epsilon = Math.max(4, width * 0.08);
      const rimRegionsOf = (row) => {
        const ring = geometryRings(row.geom)[0] || [];
        let holders = 0;
        for (const feature of regionSource.getFeaturesInExtent(row.geom.getExtent())) {
          if (!selectedSet.has(feature)) continue;
          const index = boundaryIndexOf(feature);
          if (sweep.holdsRim(ring, ([x, y], reach) => index.near(x, y, reach))) holders += 1;
          if (holders > 1) break;
        }
        return holders;
      };
      for (const row of sweep.cracksAmong(holes, rimRegionsOf, { maxWidth: width, onLeftAlone })) {
        const ext = expandExtent(row.geom.getExtent(), Math.max(4, width * 1.5));
        const neighbors = regionSource
          .getFeaturesInExtent(ext)
          .filter((feature) => selectedSet.has(feature) && sweep.vertexCountOf(feature.getGeometry()) <= maxTargetVertices)
          .sort((a, b) => featureOrder.get(a) - featureOrder.get(b));
        let target = null;
        let bestScore = -1;
        for (const f of neighbors) {
          const score = boundaryTouchScore(row.geom, boundaryIndexOf(f), epsilon);
          if (score > bestScore || (score === bestScore && areaOf(f) > areaOf(target))) {
            target = f;
            bestScore = score;
          }
        }
        if (!target || bestScore <= 0) continue;
        items.push({ id: `gap-${nextId()}`, kind: "gap", geom: row.geom.clone(), area: row.area, width: row.width, targetId: target.getId() });
      }
      return items;
    };
    const findNarrowOverlaps = (feats, width, { featureOrder, areaOf, nextId }, { from = 0, to = feats.length, minWidth = 0, maxPairVertices = Infinity, onSkip, onLeftAlone, weld = null, onRefused } = {}) => {
      const items = [];
      for (let i = from; i < to; i += 1) {
        const a = feats[i];
        const aExtent = a.getGeometry().getExtent();
        const nearby = regionSource
          .getFeaturesInExtent(aExtent)
          .map((feature) => ({ feature, index: featureOrder.get(feature) }))
          .filter((row) => Number.isInteger(row.index) && row.index > i)
          .sort((x, y) => x.index - y.index);
        for (const { feature: b } of nearby) {
          if (sweep.vertexCountOf(a.getGeometry()) + sweep.vertexCountOf(b.getGeometry()) > maxPairVertices) {
            onSkip?.();
            continue;
          }
          let pieces = [];
          try {
            pieces = geo.overlapGeoms(a.getGeometry(), b.getGeometry(), { maxWidth: width, minWidth });
          } catch (e) {
            try {
              if (!weld) throw e;
              pieces = geo.overlapGeoms(weld(a.getGeometry()), weld(b.getGeometry()), { maxWidth: width, minWidth });
            } catch (again) {
              console.warn("[editor] topology overlap analysis failed:", again);
              onRefused?.(a, b);
              continue;
            }
          }
          if (!pieces.length) continue;
          const aArea = areaOf(a);
          const bArea = areaOf(b);
          if (!sweep.isSliver(pieces[0].shared, Math.min(aArea, bArea))) {
            onLeftAlone?.(a, b);
            continue;
          }
          const winner = aArea >= bArea ? a : b;
          const loser = winner === a ? b : a;
          for (const row of pieces) {
            items.push({ id: `overlap-${nextId()}`, kind: "overlap", geom: row.geom.clone(), area: row.area, width: row.width, winnerId: winner.getId(), loserId: loser.getId() });
          }
        }
      }
      return items;
    };
    const beginTopologyEdit = () => {
      const before = new Map();
      const remember = (f) => {
        if (!f || before.has(f.getId())) return;
        before.set(f.getId(), { feature: f, geometry: f.getGeometry().clone(), edited: f.get("edited") });
      };
      return { before, remember };
    };
    const trimOverlap = (item, remember) => {
      const winner = regionSource.getFeatureById(item.winnerId);
      const loser = regionSource.getFeatureById(item.loserId);
      if (!winner || !loser) return false;
      remember(loser);
      let after;
      try {
        after = geo.subtractFrom(loser.getGeometry(), winner.getGeometry());
      } catch (e) {
        console.warn("[editor] topology overlap repair failed:", e);
        return false;
      }
      if (!after) return false;
      loser.setGeometry(after);
      loser.set("edited", true);
      return true;
    };
    const fillGap = (item, remember) => {
      const target = regionSource.getFeatureById(item.targetId);
      if (!target) return false;
      remember(target);
      try {
        target.setGeometry(geo.unionGeoms([target.getGeometry(), item.geom]));
        target.set("edited", true);
        return true;
      } catch (e) {
        console.warn("[editor] topology gap repair failed:", e);
        return false;
      }
    };
    const fillGaps = (targetId, items, remember, onFailed) => {
      const target = regionSource.getFeatureById(targetId);
      const oneByOne = () => items.reduce((filled, item) => {
        if (target && fillGap(item, remember)) return filled + 1;
        onFailed?.(item);
        return filled;
      }, 0);
      if (!target || items.length < 2) return oneByOne();
      remember(target);
      try {
        target.setGeometry(geo.unionGeoms([target.getGeometry(), ...items.map((item) => item.geom)]));
        target.set("edited", true);
        return items.length;
      } catch (e) {
        console.warn("[editor] topology gap repair failed for a batch; filling one by one:", e);
        return oneByOne();
      }
    };
    const finishTopologyEdit = ({ before }) => {
      if (!before.size) return 0;
      const after = new Map();
      for (const [id] of before.entries()) {
        const f = regionSource.getFeatureById(id);
        if (f) after.set(id, { feature: f, geometry: f.getGeometry().clone(), edited: f.get("edited") });
      }
      const restore = (snapshot) => {
        for (const row of snapshot.values()) {
          row.feature.setGeometry(row.geometry.clone());
          if (row.edited === undefined) row.feature.unset("edited", true);
          else row.feature.set("edited", row.edited);
        }
        s.geometryRev += 1;
      };
      pushCmd(s, { undo: () => restore(before), redo: () => restore(after) });
      notify(s, { geometry: true });
      return before.size;
    };
    const welderFor = (regions) => {
      let tables = null;
      let ofRegion = null;
      const ofUnion = new WeakMap();
      return (geom) => {
        if (!tables) {
          const place = new Map(regions.map((feature, index) => [feature, index]));
          const geoms = regions.map((feature) => feature.getGeometry());
          const welded = geo.weldRegions(geoms, (index, box) => regionSource.getFeaturesInExtent(box).map((feature) => place.get(feature)).filter((at) => at !== undefined));
          tables = welded.tables;
          ofRegion = new Map(geoms.map((own, index) => [own, welded.geoms[index]]));
        }
        const region = ofRegion.get(geom);
        if (region) return region;
        let out = ofUnion.get(geom);
        if (!out) {
          out = geo.weldedGeometry(geom, tables);
          ofUnion.set(geom, out);
        }
        return out;
      };
    };
    const repairTopologyEverywhere = async ({ maxWidth = sweep.BORDER_CLEANUP.maxWidth, onProgress, stopRequested } = {}) => {
      const BORDER_CLEANUP = sweep.BORDER_CLEANUP;
      const width = Math.max(1, Number(maxWidth) || BORDER_CLEANUP.maxWidth);
      const floor = Math.min(width, BORDER_CLEANUP.minWidth);
      const feats = regionSource.getFeatures().filter((f) => f.getGeometry?.());
      const regionCount = feats.length;
      const startedAt = Date.now();
      const elapsed = () => Date.now() - startedAt;
      let stopped = "";
      let error = "";
      const shouldStop = () => {
        if (!stopped) {
          if (stopRequested?.()) stopped = "user";
          else if (elapsed() > BORDER_CLEANUP.maxMillis) stopped = "time";
        }
        return Boolean(stopped);
      };
      const progress = {
        phase: "gaps",
        pass: 1,
        maxPasses: BORDER_CLEANUP.maxPasses,
        maxWidth: width,
        regionCount,
        passRegions: regionCount,
        chunkIndex: 0,
        chunkCount: 0,
        gapsFound: 0,
        regionsChecked: 0,
        overlapsFound: 0,
        repairsDone: 0,
        repairCount: 0,
        gapsFilled: 0,
        overlapsTrimmed: 0,
        startedAt,
        elapsedMs: 0,
      };
      const report = (patch) => {
        Object.assign(progress, patch, { elapsedMs: elapsed() });
        onProgress?.({ ...progress });
      };
      const totals = { gaps: 0, overlaps: 0, gapsFound: 0, overlapsFound: 0 };
      let passes = 0;
      let parts = 1;
      let skippedPairs = 0;
      let repairsLeft = 0;
      const leftAlone = sweep.leftAloneTally();
      let welded = false;
      let partsApart = 0;
      const pairsFailed = new Set();
      const repairsFailed = new Set();
      const repairKey = (item) => `${item.kind}:${item.geom.getExtent().map((value) => Math.round(value)).join(",")}`;
      const outcome = (affectedRegions) => ({
        changed: affectedRegions > 0,
        gaps: totals.gaps,
        overlaps: totals.overlaps,
        affectedRegions,
        regionCount,
        maxWidth: width,
        gapsFound: totals.gapsFound,
        overlapsFound: totals.overlapsFound,
        passes,
        parts,
        skippedPairs,
        ...leftAlone.counts(),
        welded,
        partsApart,
        pairsFailed: pairsFailed.size,
        repairsFailed: repairsFailed.size,
        stopped,
        error,
        elapsedMs: elapsed(),
        repairsLeft,
      });
      if (regionCount < 2) {
        report({ phase: "done" });
        return outcome(0);
      }
      const edit = beginTopologyEdit();
      let hotspots = null;
      let changedLast = new Set();
      try {
        while (passes < BORDER_CLEANUP.maxPasses && !shouldStop()) {
          passes += 1;
          const local = hotspots !== null;
          let passFeats = feats;
          let walk = regionCount;
          if (local) {
            const around = new Set();
            for (const spot of hotspots) for (const f of regionSource.getFeaturesInExtent(spot)) around.add(f);
            const changed = feats.filter((f) => changedLast.has(f));
            const others = feats.filter((f) => around.has(f) && !changedLast.has(f));
            passFeats = [...changed, ...others];
            walk = changed.length;
          }
          report({ pass: passes, phase: "gaps", passRegions: passFeats.length, chunkIndex: 0, chunkCount: 0, gapsFound: 0, regionsChecked: 0, overlapsFound: 0, repairsDone: 0, repairCount: 0 });
          const context = topologyContext(passFeats);
          const weld = welderFor(passFeats);
          let passExtent = regionSource.getExtent();
          if (local && passFeats.length) {
            passExtent = passFeats[0].getGeometry().getExtent().slice();
            for (const f of passFeats) {
              const e = f.getGeometry().getExtent();
              passExtent = [Math.min(passExtent[0], e[0]), Math.min(passExtent[1], e[1]), Math.max(passExtent[2], e[2]), Math.max(passExtent[3], e[3])];
            }
          }
          const search = passFeats.length < 2 ? { holes: [], parts: 1, stopped: false } : await sweep.findEnclosedGaps(passFeats, {
            plan: sweep.planTopologyChunks(passExtent, passFeats.length),
            geometryOf: (f) => f.getGeometry(),
            union: geo.unionAllGeoms,
            gapsOf: geo.enclosedGapsOfUnion,
            isCovered: (point) => regionSource.getFeaturesAtCoordinate(point).length > 0,
            maxWidth: width,
            minWidth: floor,
            partial: local,
            shouldStop,
            onChunks: (chunkCount) => report({ chunkCount }),
            onChunk: (chunkIndex) => report({ chunkIndex }),
            weld,
            welded,
            onRefused: (e) => console.warn("[editor] border cleanup: polygon-clipping refused a union:", e),
          });
          parts = Math.max(parts, search.parts);
          welded = welded || Boolean(search.welded);
          partsApart = Math.max(partsApart, Number(search.apart) || 0);
          const holes = local ? search.holes.filter((hole) => sweep.touchesHotspot(hole.geom.getExtent(), hotspots)) : search.holes;
          const gaps = assignGapTargets(holes, width, context, { maxTargetVertices: BORDER_CLEANUP.maxUnionVertices, onLeftAlone: leftAlone.hole });
          report({ gapsFound: gaps.length });
          await sweep.yieldToBrowser();
          const overlapsFound = [];
          let skippedThisPass = 0;
          report({ phase: "overlaps", regionsChecked: 0 });
          for (let from = 0; from < walk && !shouldStop(); from += BORDER_CLEANUP.overlapBatch) {
            const to = Math.min(walk, from + BORDER_CLEANUP.overlapBatch);
            overlapsFound.push(...findNarrowOverlaps(passFeats, width, context, {
              from,
              to,
              minWidth: floor,
              maxPairVertices: BORDER_CLEANUP.maxUnionVertices,
              onSkip: () => { skippedThisPass += 1; },
              onLeftAlone: (a, b) => leftAlone.pair(a.getId(), b.getId()),
              weld,
              onRefused: (a, b) => pairsFailed.add([a.getId(), b.getId()].sort().join("\n")),
            }));
            report({ regionsChecked: to, overlapsFound: overlapsFound.length });
            await sweep.yieldToBrowser();
          }
          skippedPairs = Math.max(skippedPairs, skippedThisPass);
          totals.gapsFound += gaps.length;
          totals.overlapsFound += overlapsFound.length;
          const repairCount = overlapsFound.length + gaps.length;
          report({ phase: "apply", repairCount, repairsDone: 0 });
          if (!repairCount) break;
          await sweep.yieldToBrowser();
          const overApplyBudget = () => elapsed() > BORDER_CLEANUP.maxApplyMillis;
          const applied = [];
          const changed = new Set();
          let gapsFilled = 0;
          let overlapsTrimmed = 0;
          let attempted = 0;
          const notFailed = (item) => {
            if (repairsFailed.size) repairsFailed.delete(repairKey(item));
          };
          const failed = (item) => repairsFailed.add(repairKey(item));
          const byPair = new Map();
          for (const item of overlapsFound) {
            const pair = `${item.winnerId}\n${item.loserId}`;
            if (!byPair.has(pair)) byPair.set(pair, []);
            byPair.get(pair).push(item);
          }
          for (const items of byPair.values()) {
            if (overApplyBudget()) break;
            attempted += items.length;
            const [{ winnerId, loserId }] = items;
            if (trimOverlap(items[0], edit.remember)) {
              overlapsTrimmed += items.length;
              applied.push(...items);
              changed.add(regionSource.getFeatureById(loserId));
              leftAlone.trimmed(winnerId, loserId);
              items.forEach(notFailed);
            } else {
              items.forEach(failed);
            }
          }
          const byTarget = new Map();
          for (const item of gaps) {
            if (!byTarget.has(item.targetId)) byTarget.set(item.targetId, []);
            byTarget.get(item.targetId).push(item);
          }
          for (const [targetId, items] of byTarget) {
            if (overApplyBudget()) break;
            attempted += items.length;
            items.forEach(notFailed);
            const filled = fillGaps(targetId, items, edit.remember, failed);
            if (filled) {
              gapsFilled += filled;
              applied.push(...items);
              changed.add(regionSource.getFeatureById(targetId));
            }
          }
          if (attempted < repairCount) {
            repairsLeft += repairCount - attempted;
            if (!stopped) stopped = "time";
          }
          totals.gaps += gapsFilled;
          totals.overlaps += overlapsTrimmed;
          report({ repairsDone: attempted, gapsFilled: totals.gaps, overlapsTrimmed: totals.overlaps });
          await sweep.yieldToBrowser();
          if (!gapsFilled && !overlapsTrimmed) break;
          hotspots = sweep.hotspotsOf(applied, width * BORDER_CLEANUP.hotspotPad);
          changedLast = changed;
        }
      } catch (e) {
        console.warn("[editor] border cleanup stopped early; keeping the repairs made so far:", e);
        stopped = "error";
        error = e?.message || String(e);
      }
      const affectedRegions = finishTopologyEdit(edit);
      report({ phase: "done" });
      return outcome(affectedRegions);
    };
    return { repairTopologyEverywhere };
  };

  const cleanupEvent = (s, state) => {
    if (session !== s) return;
    const text = sweep.describeCleanupProgress(state);
    emit("workshop.cleanup", { session: s.id, state: plain(state), fraction: text.fraction, headline: text.headline, detail: text.detail, leftAlone: text.leftAlone || [] });
  };

  const cleanBorders = async (s, { exporting = false, mode = "deep" } = {}) => {
    const maxWidth = sweep.cleanupWidthOf(mode);
    let cleanup = null;
    let cleanupError = "";
    s.cleanupStop = false;
    let current = { phase: "gaps", maxWidth, regionCount: 0, chunkIndex: 0, chunkCount: 0, startedAt: Date.now() };
    cleanupEvent(s, current);
    await sweep.yieldToBrowser();
    try {
      cleanup = (await topologyTools(s).repairTopologyEverywhere({
        maxWidth,
        onProgress: (state) => {
          current = state;
          cleanupEvent(s, state);
        },
        stopRequested: () => s.cleanupStop,
      })) ?? null;
    } catch (e) {
      console.warn("[editor] border cleanup before saving failed; saving the map as it is:", e);
      cleanupError = e?.message || String(e);
    }
    current = { ...(current || {}), phase: "save", result: cleanup, error: cleanupError, exporting };
    cleanupEvent(s, current);
    await sweep.yieldToBrowser();
    return [sweep.describeCleanupResult(cleanup, cleanupError), ...sweep.describeCleanupLeftAlone(cleanup)].filter(Boolean);
  };

  const writeMapToScenario = async (scenarioId, seed, renames) => {
    const details = await lib.loadScenarioDetails(scenarioId);
    const currentWorld = details?.data?.world ?? {};
    const { world: reconciledWorld, game: currentGame } = engine.wsPlayerCountry.scenarioAfterWorkshopRenames(
      rename.reconcileMapPolityAuthoringOps(currentWorld, seed.polityAuthoringOps),
      details?.data?.game ?? {},
      renames,
    );
    const seedRegionCount = Array.isArray(seed.regions?.features) ? seed.regions.features.length : 0;
    const hadTerritory = Object.keys(currentWorld.regionOwnershipOverrides ?? {}).length > 0;
    if (seedRegionCount === 0 && hadTerritory) {
      throw new Error("The map in the editor is empty while this scenario has territory — its map had not finished loading. Wait for it to appear, then save again.");
    }
    const scenarioCountry = engine.wsPlayerCountry.playerCountryAfterSave(currentGame.country, seed);
    const savedScenarioDetails = await lib.saveScenario(scenarioId, {
      world: {
        ...reconciledWorld,
        regionOwnershipOverrides: seed.world?.regionOwnershipOverrides ?? {},
        polityOverrides: seed.world?.polityOverrides ?? {},
        ...(seed.world?.regionClaimants
          ? { regionClaimants: seed.world.regionClaimants, settledRegionClaims: seed.world.settledRegionClaims ?? [] }
          : {}),
        ownerSchema: seed.world?.ownerSchema ?? currentWorld.ownerSchema,
        ownerCodes: [...new Set(Object.values(seed.world?.regionOwnershipOverrides ?? {}))].sort(),
        customRegions: true,
        customCities: seed.world?.customCities ?? false,
        author: seed.world?.author ?? "",
        mapCredit: seed.world?.mapCredit ?? "",
        background: seed.world?.background ?? null,
        ...(seed.world?.projection ? { projection: seed.world.projection } : {}),
        basemap: seed.world?.basemap ?? null,
        allowedBasemaps: seed.world?.allowedBasemaps ?? null,
        ownBasemaps: seed.world?.ownBasemaps ?? null,
        units: seed.world?.units ?? [],
        ...(seed.world?.groups ? { groups: seed.world.groups, groupAreas: seed.world.groupAreas ?? {} } : {}),
        ...(Array.isArray(seed.world?.markers) ? { markers: seed.world.markers } : {}),
        ...(Array.isArray(seed.world?.puppets) ? { puppets: seed.world.puppets } : {}),
        ...(Array.isArray(seed.world?.regionTypes) ? { regionTypes: seed.world.regionTypes } : {}),
        ...engine.wsWarGeography.warGeographyWorldPatch(seed.world),
      },
      game: {
        ...currentGame,
        country: scenarioCountry,
        gameDate: currentGame.gameDate || currentGame.startDate || seed.game?.gameDate || seed.game?.startDate || "2016-01-01",
        startDate: currentGame.startDate || currentGame.gameDate || seed.game?.startDate || seed.game?.gameDate || "2016-01-01",
      },
    }, { refresh: false });
    const json = (value) => new Blob([JSON.stringify(value)], { type: "application/json" });
    await lib.uploadScenarioAsset(scenarioId, "colors", json(seed.colors ?? {}), { refresh: false });
    if (seed.flags) await lib.uploadScenarioAsset(scenarioId, "flags", json(seed.flags), { refresh: false });
    else await lib.clearScenarioAsset(scenarioId, "flags", { refresh: false });
    if (seed.tags) await lib.uploadScenarioAsset(scenarioId, "tags", json(seed.tags), { refresh: false });
    else await lib.clearScenarioAsset(scenarioId, "tags", { refresh: false });
    await lib.uploadScenarioAsset(scenarioId, "regionsGeojson", json(seed.regions ?? { type: "FeatureCollection", features: [] }), { refresh: false });
    await lib.uploadScenarioAsset(scenarioId, "citiesGeojson", json(seed.cities ?? { type: "FeatureCollection", features: [] }), { refresh: false });
    if (seed.backgroundData) await lib.uploadScenarioAsset(scenarioId, "backgroundData", json(seed.backgroundData), { refresh: false });
    else await lib.clearScenarioAsset(scenarioId, "backgroundData", { refresh: false });
    if (seed.ownBasemapsData) await lib.uploadScenarioAsset(scenarioId, "ownBasemapsData", json(seed.ownBasemapsData), { refresh: false });
    else await lib.clearScenarioAsset(scenarioId, "ownBasemapsData", { refresh: false });
    return { scenarioCountry, details: savedScenarioDetails };
  };

  const featureById = (s, id) => featureList(s).find((f) => f.id === id) || null;

  const persistClipboard = () => {
    try {
      if (clipboard) fs.writeFileSync(clipboardFile, JSON.stringify(clipboard));
      else fs.rmSync(clipboardFile, { force: true });
    } catch (error) {
      console.warn("[editor] region clipboard not persisted:", error);
    }
  };

  const exportRegions = (s, ids) => {
    const feats = (ids || []).map((id) => s.source.getFeatureById(id)).filter(Boolean);
    const fc = fmt.writeFeaturesObject(feats, WRITE);
    for (const f of fc.features || []) {
      if (f.id != null) f.properties = { ...(f.properties || {}), id: String(f.id) };
    }
    return fc;
  };

  const pasteRegions = (s, fc, { simplify = false } = {}) => {
    const incoming = fc && Array.isArray(fc.features) ? fmt.readFeatures(fc, READ) : [];
    const pasted = incoming.filter((f) => /Polygon$/.test(f.getGeometry()?.getType() || ""));
    if (!pasted.length) return { added: [], trimmed: 0, removed: 0 };
    const simplifyLib = engine.wsSimplify;
    if (simplify) {
      const meters = simplifyLib.detailToleranceMeters(features(s).map((f) => f.getGeometry()));
      const lighter = simplifyLib.simplifyShared(pasted.map((f) => f.getGeometry()), { toleranceAt: simplifyLib.toleranceAtLatitude(meters) });
      pasted.forEach((f, at) => f.setGeometry(lighter[at]));
    }
    const hairline = (geom) => {
      const polys = geom.getType() === "Polygon" ? [geom.getCoordinates()] : geom.getCoordinates();
      let perimeter = 0;
      for (const poly of polys) {
        for (const ring of poly) {
          for (let i = 1; i < ring.length; i += 1) perimeter += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
        }
      }
      return perimeter === 0 || (2 * geom.getArea()) / perimeter < 2;
    };
    const carved = new Map();
    for (const f of pasted) {
      const cutter = f.getGeometry();
      const candidates = [];
      s.source.forEachFeatureIntersectingExtent(cutter.getExtent(), (other) => {
        candidates.push(other);
      });
      for (const other of candidates) {
        const g = other.getGeometry();
        if (!g || !geo.overlaps(g, cutter)) continue;
        const entry = carved.get(other) || { feature: other, before: g.clone(), after: null, removed: false, edited: other.get("edited") };
        const after = geo.subtractFrom(g, cutter);
        if (!after || hairline(after)) {
          s.source.removeFeature(other);
          entry.after = null;
          entry.removed = true;
        } else {
          other.setGeometry(after);
          other.set("edited", true);
          entry.after = after.clone();
          entry.removed = false;
        }
        carved.set(other, entry);
      }
    }
    const ids = engine.wsRegionClipboard.resolvePastedIds(
      pasted.map((f) => f.getId() ?? f.get("id") ?? null),
      features(s).map((f) => f.getId()),
      () => mapDoc.newId(),
    );
    const added = [];
    pasted.forEach((f, index) => {
      const id = ids[index];
      f.setId(id);
      f.set("id", id);
      if (f.get("typeId") == null) f.set("typeId", s.doc.types?.[0]?.id || "land");
      if (f.get("owner") === undefined) f.set("owner", null);
      if (!f.get("name")) f.set("name", "Region");
      f.set("edited", true);
      s.source.addFeature(f);
      added.push(f);
    });
    const entries = [...carved.values()];
    const restore = (entry) => {
      entry.feature.setGeometry(entry.before.clone());
      if (entry.edited) entry.feature.set("edited", entry.edited);
      else entry.feature.unset("edited");
      if (entry.removed) s.source.addFeature(entry.feature);
    };
    const reapply = (entry) => {
      if (entry.removed) {
        s.source.removeFeature(entry.feature);
      } else {
        entry.feature.setGeometry(entry.after.clone());
        entry.feature.set("edited", true);
      }
    };
    notify(s, { geometry: true });
    pushCmd(s, {
      undo: () => {
        added.forEach((f) => s.source.removeFeature(f));
        entries.forEach(restore);
        s.geometryRev += 1;
      },
      redo: () => {
        entries.forEach(reapply);
        added.forEach((f) => s.source.addFeature(f));
        s.geometryRev += 1;
      },
    });
    return { added: added.map((f) => f.getId()), trimmed: entries.filter((entry) => !entry.removed).length, removed: entries.filter((entry) => entry.removed).length };
  };

  const describeClipboard = () => {
    const summary = engine.wsRegionClipboard.describeClipboard(clipboard);
    return summary ? plain(summary) : null;
  };

  const ownerAllowed = (filter, feature) => {
    const owner = feature?.get?.("owner") || null;
    if (filter === "*") return true;
    if (filter === "__unowned__") return !owner;
    return owner === filter;
  };

  const mapsOf = (s) => plain(engine.wsScenarioMaps.scenarioMaps(s.doc.metadata, { scenarioName: s.doc.metadata?.name }));

  const applyMaps = (s, result) => {
    if (result.refused) return { refused: result.refused };
    patchMetadata(s, result.patch);
    return { ok: true };
  };

  return {
    "workshop.open": async ({ scenarioId, world = null, gameDate = "", warSettings = null, hasWarSettings = false } = {}) => {
      if (session) closeSession(session);
      const details = await lib.loadScenarioDetails(clean(scenarioId));
      const scenario = details.scenario;
      const s = newSession(scenario);
      session = s;
      try {
        const sourceWorld = world && typeof world === "object" ? world : details?.data?.world ?? {};
        const initialMap = await buildSeedFor(scenario, sourceWorld, { gameDate: gameDate || details?.data?.game?.gameDate || "", warSettings: hasWarSettings ? warSettings : undefined });
        if (session !== s) throw new Error("The map editor was closed.");
        s.initialMap = initialMap;
        await hydrate(s, initialMap);
      } catch (error) {
        closeSession(s);
        throw new Error(`The map editor was closed because this scenario's map could not be loaded, so nothing was saved over it. ${error?.message || error}`);
      }
      return { ...delta(s, { all: true }), scenario: { id: s.scenario.id, name: s.scenario.name }, bake: { file: s.bakeFile } };
    },
    "workshop.close": async ({ session: id } = {}) => {
      if (session && (!id || session.id === id)) closeSession(session);
      return true;
    },
    "workshop.flush": async ({ session: id } = {}) => {
      const s = need(id);
      if (!engine.wsDocumentSaving.isUnsavedStatus(s.saveStatus)) return { ok: true };
      const ok = await s.runSave();
      await s.runSave.idle?.();
      return { ok: Boolean(ok) && s.saveStatus === "saved", status: status(s) };
    },
    "workshop.regions": async ({ session: id } = {}) => delta(need(id), { regions: true }),
    "workshop.state": async ({ session: id } = {}) => delta(need(id), { all: true }),
    "workshop.summaries": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const summaries = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean).map(summarize);
      const owners = listOwners(s);
      const keys = new Set([...owners, ...Object.keys(s.doc.polities || {})]);
      const polityOptions = [...keys]
        .map((key) => ({ key, name: String(s.doc.polities?.[key]?.name || key) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
      return plain({ summaries, polityOptions, tagSuggestions: engine.wsCountryTags.TAG_SUGGESTIONS });
    },
    "workshop.paint": async ({ session: id, ids = [], owner = "", only = "*" } = {}) => {
      const s = need(id);
      const after = clean(owner) || null;
      const filter = clean(only) || "*";
      const visited = new Set();
      const rows = [];
      for (const rid of list(ids)) {
        const feature = s.source.getFeatureById(String(rid));
        if (!feature) continue;
        const key = feature.getId() ?? feature;
        if (visited.has(key)) continue;
        visited.add(key);
        const before = feature.get("owner") || null;
        if (!ownerAllowed(filter, feature) || before === after) continue;
        rows.push({ feature, before });
      }
      if (rows.length) {
        for (const row of rows) row.feature.set("owner", after, true);
        pushCmd(s, {
          undo: () => rows.forEach((row) => row.feature.set("owner", row.before, true)),
          redo: () => rows.forEach((row) => row.feature.set("owner", after, true)),
        });
        notify(s);
      }
      return delta(s, { regions: true });
    },
    "workshop.attrs": async ({ session: id, ids = [], patch = {} } = {}) => {
      const s = need(id);
      const next = { ...patch };
      if (patch.claimantsDelta) {
        const deltaRows = patch.claimantsDelta;
        delete next.claimantsDelta;
        next.claimants = (current) => engine.wsClaimantEdits.applyClaimantDelta(current, deltaRows);
      }
      setRegionAttrs(s, list(ids).map(String), next);
      return delta(s, { regions: true });
    },
    "workshop.selectOwner": async ({ session: id, key = "", regionId = "" } = {}) => {
      const s = need(id);
      let owner = clean(key);
      if (!owner && regionId) {
        const hit = s.source.getFeatureById(String(regionId));
        if (!hit) return { ids: [] };
        owner = hit.get("owner") || "";
        if (!owner) return { ids: [String(regionId)] };
        return { ids: features(s).filter((f) => (f.get("owner") || null) === owner).map((f) => String(f.getId())), bounds: null };
      }
      const ids = selectOwner(s, owner).map(String);
      return { ids, bounds: unionExtent(ids.map((rid) => s.source.getFeatureById(rid)).filter(Boolean)) };
    },
    "workshop.selectGroup": async ({ session: id, name = "" } = {}) => {
      const s = need(id);
      const key = clean(name);
      const feats = key ? features(s).filter((f) => clean(f.get("group")) === key) : [];
      return { ids: feats.map((f) => String(f.getId())), bounds: unionExtent(feats) };
    },
    "workshop.bounds": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      return { bounds: unionExtent(list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean)) };
    },
    "workshop.lasso": async ({ session: id, ring = [] } = {}) => {
      const s = need(id);
      const coords = list(ring).map((point) => fromLonLat([Number(point[0]), Number(point[1])]));
      if (coords.length < 3) return { ids: [] };
      const poly = new Polygon([[...coords, coords[0]]]);
      const ids = [];
      s.source.forEachFeatureInExtent(poly.getExtent(), (f) => {
        const pt = interiorPoint(f.getGeometry());
        if (pt && poly.intersectsCoordinate(pt)) ids.push(String(f.getId()));
      });
      return { ids };
    },
    "workshop.queryRegions": async ({ session: id, text = "", limit = 300 } = {}) => {
      const s = need(id);
      const search = engine.wsRegionSearch;
      const q = String(text || "").trim().toLowerCase();
      const owners = search.ownersMatchingQuery(s.doc.polities, q);
      const out = [];
      for (const f of features(s)) {
        if (q && !search.regionMatchesQuery({ id: f.getId(), name: f.get("name"), owner: f.get("owner") }, q, owners)) continue;
        const row = summarize(f);
        out.push({ ...row, ownerName: search.polityDisplayName(s.doc.polities, row.owner) || "" });
        if (out.length >= limit) break;
      }
      return plain({ results: out });
    },
    "workshop.search": async ({ session: id, text = "" } = {}) => {
      const s = need(id);
      const q = String(text || "").trim().toLowerCase();
      if (q.length < 2) return { custom: [], regions: [], world: [] };
      const search = engine.wsRegionSearch;
      const custom = featureList(s).filter((f) => Array.isArray(f.coord) && String(f.name || "").toLowerCase().includes(q)).slice(0, 6);
      const owners = search.ownersMatchingQuery(s.doc.polities, q);
      const regions = [];
      for (const f of features(s)) {
        if (!search.regionMatchesQuery({ id: f.getId(), name: f.get("name"), owner: f.get("owner") }, q, owners)) continue;
        const row = summarize(f);
        regions.push({ ...row, ownerName: search.polityDisplayName(s.doc.polities, row.owner) || "" });
        if (regions.length >= 5) break;
      }
      const world = await engine.wsCitiesImport.searchSeedCities(q, 8);
      return plain({ custom, regions, world });
    },
    "workshop.polities": async ({ session: id } = {}) => {
      const s = need(id);
      return plain({ usage: listPolityUsage(s) });
    },
    "workshop.ownerRegions": async ({ session: id, key = "" } = {}) => {
      const s = need(id);
      const owner = clean(key);
      if (!owner) return { regions: [] };
      return plain({
        regions: features(s)
          .filter((f) => clean(f.get("owner")) === owner)
          .map((f) => ({ id: String(f.getId()), name: clean(f.get("name")), typeId: f.get("typeId") || "land" }))
          .sort((a, b) => (a.name || String(a.id)).localeCompare(b.name || String(b.id))),
      });
    },
    "workshop.polity.create": async ({ session: id, name = "", assign = [] } = {}) => {
      const s = need(id);
      const key = clean(name);
      if (!key) return delta(s, {});
      const usage = new Set(listPolityUsage(s).map((row) => row.key));
      if (Object.prototype.hasOwnProperty.call(s.doc.polities || {}, key) || usage.has(key)) {
        return { ...delta(s, {}), refused: `A polity named “${key}” already exists.` };
      }
      upsertPolity(s, key, { name: key, code: key, aliases: [key], status: "active", note: "" });
      if (list(assign).length) setRegionAttrs(s, list(assign).map(String), { owner: key });
      return { ...delta(s, { regions: true }), key };
    },
    "workshop.polity.createNamed": async ({ session: id, name = "", assign = [] } = {}) => {
      const s = need(id);
      const text = clean(name);
      if (!text) return delta(s, {});
      upsertPolity(s, text, { name: text, code: text, aliases: [text], status: "active", note: "" });
      if (list(assign).length) setRegionAttrs(s, list(assign).map(String), { owner: text });
      return { ...delta(s, { regions: true }), key: text };
    },
    "workshop.polity.upsert": async ({ session: id, key = "", patch = {} } = {}) => {
      const s = need(id);
      const next = { ...patch };
      if (Object.prototype.hasOwnProperty.call(next, "populationText")) {
        const people = engine.wsPopulation.readPopulationFigure(next.populationText);
        delete next.populationText;
        next.population = people > 0 ? people : undefined;
      }
      if (Object.prototype.hasOwnProperty.call(next, "military") && next.military === null) next.military = undefined;
      upsertPolity(s, key, next);
      return delta(s, { doc: true });
    },
    "workshop.polity.rename": async ({ session: id, key = "", name = "" } = {}) => {
      const s = need(id);
      const from = clean(key);
      const to = clean(name);
      if (!from || !to || from === to) return { ...delta(s, {}), renamed: false };
      const names = [...Object.keys(s.doc.polities || {}), ...listPolityUsage(s).map((row) => row.key)];
      const clash = names.find((other) => rename.samePolityName(other, to) && !rename.samePolityName(other, from));
      if (clash) {
        return { ...delta(s, {}), renamed: false, refused: `“${to}” is already the name of another polity (“${clash}”). A rename cannot merge two countries.` };
      }
      renameOwner(s, from, to);
      renamePolityDoc(s, from, to);
      s.polityAuthoringOps.push({ op: "rename", from, to });
      return { ...delta(s, { regions: true, features: true, units: true, war: true }), renamed: true, to };
    },
    "workshop.polity.remove": async ({ session: id, keys = [] } = {}) => {
      const s = need(id);
      const stableKeys = [...new Set(list(keys).map((key) => clean(key)).filter(Boolean))];
      if (!stableKeys.length) return delta(s, {});
      removeOwners(s, stableKeys);
      removePolitiesDoc(s, stableKeys);
      for (const key of stableKeys) s.polityAuthoringOps.push({ op: "remove", key });
      return delta(s, { regions: true });
    },
    "workshop.polity.transfer": async ({ session: id, from = "", to = "" } = {}) => {
      const s = need(id);
      if (!clean(to) || !clean(from) || clean(from) === clean(to)) return delta(s, {});
      const ids = selectOwner(s, from);
      if (ids.length) setRegionAttrs(s, ids, { owner: clean(to) });
      return delta(s, { regions: true });
    },
    "workshop.polity.color": async ({ session: id, key = "", rgb = null } = {}) => {
      const s = need(id);
      setColorOverride(s, key, Array.isArray(rgb) ? rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)))) : null);
      return delta(s, { regions: true });
    },
    "workshop.polity.flag": async ({ session: id, key = "", value = null } = {}) => {
      const s = need(id);
      setFlag(s, key, value || null);
      return delta(s, { doc: true });
    },
    "workshop.polity.tags": async ({ session: id, key = "", tags = [] } = {}) => {
      const s = need(id);
      setTags(s, key, list(tags));
      return delta(s, { doc: true });
    },
    "workshop.puppets.overlord": async ({ session: id, polity = "", overlord = "" } = {}) => {
      const s = need(id);
      const result = engine.wsPuppets.setOverlord(s.doc.puppets || [], polity, overlord);
      if (!result.error) setters(s).puppets(result.puppets);
      return { ...delta(s, { doc: true }), error: result.error || "" };
    },
    "workshop.puppets.patch": async ({ session: id, polity = "", patch = {} } = {}) => {
      const s = need(id);
      setters(s).puppets(engine.wsPuppets.patchPuppetRow(s.doc.puppets || [], polity, patch));
      return delta(s, { doc: true });
    },
    "workshop.puppets.view": async ({ session: id, polity = "" } = {}) => {
      const s = need(id);
      const puppets = engine.wsPuppets;
      const choices = polityChoices(s);
      return plain({
        own: puppets.overlordRowOf(s.doc.puppets || [], polity),
        held: puppets.puppetRowsOf(s.doc.puppets || [], polity),
        options: puppets.overlordChoicesFor(s.doc.puppets || [], polity, choices.map((row) => row.key)),
        kinds: puppets.PUPPET_KIND_OPTIONS,
        secrecy: puppets.PUPPET_SECRECY_OPTIONS,
        coupLoyalty: puppets.PUPPET_COUP_LOYALTY,
      });
    },
    "workshop.military.view": async ({ session: id, value = null } = {}) => {
      const form = engine.wsMilitaryForm;
      const kept = engine.wsMilitaryStats.normalizeMilitaryStats(value);
      const fields = ["quality", "technology", "spending", "weariness", "land", "sea", "air", "manpowerShare", "menPerCounter", "cavalryShare", "siegeShare"];
      const s = id ? need(id) : session;
      const defaults = s?.initialMap?.militaryDefaults ?? null;
      return plain({
        kept,
        texts: Object.fromEntries(fields.map((field) => [field, form.militaryFieldText(kept, field)])),
        mix: form.unitMixEra(defaults),
        defaults,
        defaultsText: defaults ? {
          manpowerShare: String(defaults.manpowerShare),
          menPerCounter: engine.wsPopulation.formatPopulationFigure(defaults.menPerCounter),
          cavalryShare: String(Math.round(Number(defaults.cavalryShare) * 1000) / 10),
          siegeShare: String(Math.round(Number(defaults.siegeShare) * 1000) / 10),
        } : null,
      });
    },
    "workshop.military.field": async ({ value = null, field = "", text = "" } = {}) => {
      const form = engine.wsMilitaryForm;
      const kept = engine.wsMilitaryStats.normalizeMilitaryStats(value);
      const { military, ok } = form.withMilitaryField(kept, field, text);
      return plain({ ok, military: ok ? military : kept, text: form.militaryFieldText(ok ? military : kept, field), changed: ok && JSON.stringify(military) !== JSON.stringify(kept) });
    },
    "workshop.population.format": async ({ text = "", value = null } = {}) => {
      const people = value !== null ? Number(value) || 0 : engine.wsPopulation.readPopulationFigure(text);
      return { people, text: engine.wsPopulation.formatPopulationFigure(people) };
    },
    "workshop.military.muster": async ({ value = null, points = null } = {}) => {
      const kept = engine.wsMilitaryStats.normalizeMilitaryStats(value);
      const next = engine.wsMilitaryForm.withMilitaryMuster(kept, points);
      return plain({ military: next, changed: JSON.stringify(next) !== JSON.stringify(kept) });
    },
    "workshop.military.rate": async ({ session: id, kind = "polity", key = "" } = {}) => {
      const s = need(id);
      const defaults = s.initialMap?.militaryDefaults ?? null;
      const groups = s.doc.groups || {};
      const record = kind === "group" ? (groups[key] ?? {}) : (s.doc.polities?.[key] ?? {});
      const figures = await engine.wsMilitaryRating.rateMilitaryFigures({
        name: kind === "group" ? key : (record?.name || key),
        note: kind === "group" ? record?.description : record?.note,
        population: record?.population,
        rated: kind === "group" ? engine.wsMilitaryForm.militaryScaleOf({}, groups) : engine.wsMilitaryForm.militaryScaleOf(s.doc.polities, kind === "inspector" ? groups : undefined),
        date: defaults?.gameDate,
        era: Number.isInteger(defaults?.era) ? defaults.era : null,
        rules: defaults?.rules,
      });
      const kept = engine.wsMilitaryStats.normalizeMilitaryStats(record?.military);
      const next = engine.wsMilitaryStats.normalizeMilitaryStats({ ...(figures ?? {}), ...(kept ?? {}) });
      if (next && JSON.stringify(next) !== JSON.stringify(kept)) {
        if (kind === "group") {
          const name = key;
          const base = groups[name] ?? { name, description: "", color: groupsLib.defaultGroupColor(name) };
          setters(s).groups((registry) => ({ ...registry, [name]: { ...base, ...(registry?.[name] ?? {}), military: next, name } }));
        } else {
          upsertPolity(s, key, { military: next });
        }
      }
      return delta(s, { doc: true });
    },
    "workshop.roster.read": async ({ session: id, path: file = "" } = {}) => {
      const s = need(id);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(clean(file), "utf8"));
      } catch (error) {
        return { message: error?.message || String(error) };
      }
      const rosterRowsFromJson = (value) => {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== "object") return [];
        if (Array.isArray(value.polities)) return value.polities;
        if (Array.isArray(value.roster)) return value.roster;
        if (Array.isArray(value.countries)) return value.countries;
        const keyed = value.polities && typeof value.polities === "object" && !Array.isArray(value.polities) ? value.polities : value;
        const ignoredTopLevel = new Set(["format", "track", "scenario", "derivation", "metadata", "version"]);
        const rows = [];
        for (const [key, record] of Object.entries(keyed || {})) {
          if (ignoredTopLevel.has(key)) continue;
          if (!record || typeof record !== "object" || Array.isArray(record)) continue;
          rows.push({ key, ...record });
        }
        return rows;
      };
      const rawRows = rosterRowsFromJson(parsed);
      const seen = new Set();
      const rows = [];
      let invalid = 0;
      let duplicates = 0;
      for (const row of rawRows) {
        const key = engine.wsPolityRoster.rosterRowKey(row);
        if (!key) {
          invalid += 1;
          continue;
        }
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        seen.add(key);
        rows.push({ ...row, key });
      }
      if (!rows.length) return { message: "No usable polity records were found in that JSON file." };
      const existing = rows.filter((row) => Object.prototype.hasOwnProperty.call(s.doc.polities || {}, row.key)).length;
      const fileName = path.basename(clean(file));
      return plain({
        preview: {
          fileName,
          rows,
          invalid,
          duplicates,
          existing,
          fresh: rows.length - existing,
          incomingColors: rows.filter((row) => row.color || row.rgb || row.colour).length,
          incomingTags: rows.filter((row) => (Array.isArray(row.tags) ? row.tags.length : clean(row.tags))).length,
          incomingFlags: rows.filter((row) => clean(row.flag || row.flagUrl || row.flag_url || row.flagDataUrl)).length,
        },
      });
    },
    "workshop.roster.apply": async ({ session: id, rows = [] } = {}) => {
      const s = need(id);
      const summary = importPolityRoster(s, list(rows));
      return { ...delta(s, { regions: true }), summary: plain(summary) };
    },
    "workshop.flags.fillPlan": async ({ session: id } = {}) => {
      const s = need(id);
      const usage = listPolityUsage(s);
      const keys = new Set([...Object.keys(s.doc.polities || {}), ...usage.map((row) => row.key)]);
      const importRows = [];
      let unresolved = 0;
      let alreadyFlagged = 0;
      const uniqueStandardFlagForCandidates = (candidates) => {
        const codes = new Set();
        for (const candidate of candidates || []) {
          const code = engine.wsPolityIdentity.resolveStockCountryCode(candidate);
          if (code) codes.add(code);
        }
        if (codes.size !== 1) return null;
        return engine.countryFlags.flagImageUrlFromGid([...codes][0]);
      };
      for (const key of keys) {
        const record = s.doc.polities?.[key] || null;
        if (s.doc.flags?.[key]) {
          alreadyFlagged += 1;
          continue;
        }
        const name = clean(record?.name) || key;
        const aliases = Array.isArray(record?.aliases) ? record.aliases : [];
        const flag = uniqueStandardFlagForCandidates([record?.code, key, name, ...aliases]);
        if (!flag) {
          unresolved += 1;
          continue;
        }
        importRows.push({ key, name, aliases, status: record?.status || "active", note: record?.note || "", mapRefs: record?.mapRefs || null, flag });
      }
      return plain({ importRows, unresolved, alreadyFlagged });
    },
    "workshop.flags.catalog": async ({ session: id, owner = "" } = {}) => {
      const s = need(id);
      const flags = engine.wsBuiltInFlags;
      const builtIn = flags.builtInFlagChoices();
      const suggested = flags.suggestedBuiltInFlag(builtIn, owner);
      const mine = await engine.wsFlagLibrary.listFlags();
      const withFile = (row, value) => ({ ...row, file: flagFileOf(value) });
      return plain({
        builtIn: builtIn.map((flag) => withFile({ code: flag.code, name: flag.name, alpha2: flag.alpha2, imageUrl: flag.imageUrl }, flag.imageUrl)),
        suggested: suggested ? withFile({ code: suggested.code, name: suggested.name, imageUrl: suggested.imageUrl }, suggested.imageUrl) : null,
        inThisMap: Object.entries(s.doc.flags || {}).map(([code, value]) => withFile({ code, value }, value)),
        mine: (Array.isArray(mine) ? mine : []).map((flag) => withFile({ id: flag.id, name: flag.name, code: flag.code, polity: flag.polity, dataUrl: flag.dataUrl, community: Boolean(flag.source?.community) }, flag.dataUrl)),
        current: s.doc.flags?.[owner] ?? null,
      });
    },
    "workshop.flags.filter": async ({ query = "" } = {}) => {
      const flags = engine.wsBuiltInFlags;
      return plain({ codes: flags.filterBuiltInFlags(flags.builtInFlagChoices(), query).map((flag) => flag.code) });
    },
    "workshop.flags.save": async ({ session: id, owner = "", name = "", dataUrl = "" } = {}) => {
      const s = need(id);
      try {
        await engine.wsFlagLibrary.saveFlag({ name: clean(name) || owner || "Flag", code: owner || "", polity: owner || "", author: s.doc.metadata?.author || "", dataUrl });
      } catch (error) {
        console.warn("[editor] could not save flag to the library:", error);
      }
      setFlag(s, owner, dataUrl);
      return delta(s, { doc: true });
    },
    "workshop.flags.delete": async ({ id: flagId = "" } = {}) => {
      try {
        await engine.wsFlagLibrary.deleteFlag(flagId);
        return { ok: true };
      } catch (error) {
        return { error: `Could not delete that flag: ${error?.message || error}` };
      }
    },
    "workshop.feature.add": async ({ session: id, coord = null, regionId = null, mapFeature = false } = {}) => {
      const s = need(id);
      const fid = mapDoc.newId("feat");
      const hit = regionId ? s.source.getFeatureById(String(regionId)) : null;
      const partial = {
        coord: [Number(Number(coord?.[0]).toFixed(5)), Number(Number(coord?.[1]).toFixed(5))],
        regionId: hit ? hit.getId() : null,
        owner: hit ? hit.get("owner") || null : null,
        country: hit ? hit.get("country") || "" : "",
      };
      if (mapFeature) {
        setters(s).features((rows) => [...rows, engine.wsMapFeatures.newMapFeature({ id: fid, ...partial })]);
      } else {
        setters(s).features((rows) => [...rows, { id: fid, name: "New City", type: "Coordinate", symbol: "square", tags: ["city"], population: 250000, ...partial }]);
      }
      return { ...delta(s, { features: true }), id: fid };
    },
    "workshop.feature.addCity": async ({ session: id, city = {} } = {}) => {
      const s = need(id);
      const fid = mapDoc.newId("feat");
      setters(s).features((rows) => [...rows, {
        id: fid,
        name: city.name,
        type: "Coordinate",
        symbol: "square",
        coord: city.coord,
        country: city.country || "",
        owner: null,
        regionId: null,
        population: city.population || 0,
        tags: city.capital ? ["city", "capital"] : ["city"],
      }]);
      return { ...delta(s, { features: true }), id: fid };
    },
    "workshop.feature.update": async ({ session: id, featureId = "", patch = {} } = {}) => {
      const s = need(id);
      const next = { ...patch };
      if (Object.prototype.hasOwnProperty.call(next, "populationByYearText")) {
        const out = {};
        for (const line of String(next.populationByYearText || "").split(/\n/)) {
          const match = /^\s*(-?\d{1,6})\s*[:=,\s]\s*([\d.,_\s]+)$/.exec(line);
          if (!match) continue;
          const year = Number(match[1]);
          const population = Number(match[2].replace(/[,_\s]/g, ""));
          if (Number.isInteger(year) && year !== 0 && Number.isFinite(population) && population > 0) out[year] = Math.round(population);
        }
        delete next.populationByYearText;
        next.populationByYear = Object.keys(out).length ? out : undefined;
      }
      setters(s).features((rows) => rows.map((f) => (f.id === featureId ? { ...f, ...next } : f)));
      const row = featureById(s, featureId);
      return plain({ session: s.id, status: status(s), feature: row ? featuresPart({ doc: { features: [row] } })[0] : null });
    },
    "workshop.feature.remove": async ({ session: id, featureId = "", undoable = false } = {}) => {
      const s = need(id);
      const step = undoLib.removeRowStep(featureList(s), setters(s).features, featureId);
      if (undoable && step) pushCmd(s, step);
      return delta(s, { features: true });
    },
    "workshop.feature.removeMany": async ({ session: id, ids = [], all = false } = {}) => {
      const s = need(id);
      const wanted = new Set(list(ids).map(String));
      const step = undoLib.removeRowsStep(featureList(s), setters(s).features, all ? () => true : (f) => wanted.has(String(f.id)));
      if (step) pushCmd(s, step);
      return delta(s, { features: true });
    },
    "workshop.feature.tagMany": async ({ session: id, ids = [], tag = "", add = true } = {}) => {
      const s = need(id);
      const wanted = new Set(list(ids).map(String));
      const value = clean(tag);
      if (!value || !wanted.size) return delta(s, {});
      if (add) setters(s).features((rows) => rows.map((f) => (wanted.has(String(f.id)) && !(f.tags || []).includes(value) ? { ...f, tags: [...(f.tags || []), value] } : f)));
      else setters(s).features((rows) => rows.map((f) => (wanted.has(String(f.id)) ? { ...f, tags: (f.tags || []).filter((t) => t !== value) } : f)));
      return delta(s, { features: true });
    },
    "workshop.feature.import": async ({ session: id, mode = "major", confirmed = false } = {}) => {
      const s = need(id);
      const cities = engine.wsCitiesImport;
      let imported;
      try {
        imported = mode === "all" ? await cities.importAllCities() : await cities.importMajorCities();
      } catch (error) {
        console.warn("[editor] city import failed:", error);
        return { ...delta(s, {}), note: "Import failed: the city list could not be downloaded. Check the connection and try again." };
      }
      const added = engine.wsFeatureImport.mergeImportedFeatures(featureList(s), imported).added;
      if (mode === "all" && added >= 1000 && !confirmed) {
        const mb = (cities.estimateJsonBytes(imported) * (added / imported.length)) / 1e6;
        const megabytes = mb < 10 ? mb.toFixed(1) : String(Math.round(mb));
        return { ...delta(s, {}), ask: `Add ${added.toLocaleString("en-US")} cities to this map? That is about ${megabytes} MB more in the map, its saves and the scenario, and so many cities can make the Workshop and the game slow, especially on phones.` };
      }
      setters(s).features((rows) => engine.wsFeatureImport.mergeImportedFeatures(rows, imported).features);
      return { ...delta(s, { features: true }), note: added === 0 ? "Every one of those cities is already on this map." : added === 1 ? "Added 1 city." : `Added ${added} cities.` };
    },
    "workshop.feature.importFile": async ({ session: id, path: file = "" } = {}) => {
      const s = need(id);
      try {
        const { features: imported, skipped, format } = engine.wsFeatureImport.parseFeatureImport(fs.readFileSync(clean(file), "utf8"));
        const outcome = engine.wsFeatureImport.mergeImportedFeatures(featureList(s), imported);
        setters(s).features(outcome.features);
        const name = path.basename(clean(file));
        return {
          ...delta(s, { features: true }),
          note: `Imported ${outcome.added} feature${outcome.added === 1 ? "" : "s"} from ${name} (${format})`
            + (outcome.duplicates ? `, ${outcome.duplicates} already here` : "")
            + (skipped ? `, ${skipped} entr${skipped === 1 ? "y" : "ies"} without a usable point skipped` : "")
            + ".",
        };
      } catch (error) {
        return { ...delta(s, {}), note: `Import failed: ${error?.message || error}` };
      }
    },
    "workshop.unit.add": async ({ session: id, lng = 0, lat = 0, regionId = null } = {}) => {
      const s = need(id);
      const uid = mapDoc.newId("unit");
      const hit = regionId ? s.source.getFeatureById(String(regionId)) : null;
      setters(s).units((rows) => [...rows, {
        id: uid,
        name: "New unit",
        type: "infantry",
        strength: 100,
        composition: "",
        note: "",
        lng: Number(Number(lng).toFixed(5)),
        lat: Number(Number(lat).toFixed(5)),
        ownerCode: hit ? hit.get("owner") || "" : "",
        regionId: hit ? hit.getId() : null,
      }]);
      return { ...delta(s, { units: true }), id: uid };
    },
    "workshop.unit.update": async ({ session: id, unitId = "", patch = {} } = {}) => {
      const s = need(id);
      setters(s).units((rows) => rows.map((u) => (u.id === unitId ? { ...u, ...patch } : u)));
      return delta(s, { units: true });
    },
    "workshop.unit.remove": async ({ session: id, unitId = "", undoable = false } = {}) => {
      const s = need(id);
      if (undoable) {
        const step = undoLib.removeRowStep(s.doc.units || [], setters(s).units, unitId);
        if (step) pushCmd(s, step);
      } else {
        setters(s).units((rows) => rows.filter((u) => u.id !== unitId));
      }
      return delta(s, { units: true });
    },
    "workshop.unit.removeAll": async ({ session: id } = {}) => {
      const s = need(id);
      setters(s).units([]);
      return delta(s, { units: true });
    },
    "workshop.group.create": async ({ session: id, name = "", selection = [] } = {}) => {
      const s = need(id);
      const groupName = groupsLib.normalizeGroupName(name);
      if (!groupName) return delta(s, {});
      const usage = listGroupUsage(s);
      const names = [...new Set([...Object.keys(s.doc.groups || {}), ...Object.keys(usage)])].sort((a, b) => a.localeCompare(b));
      const recordOf = (key) => s.doc.groups?.[key] ?? { name: key, description: "", color: groupsLib.defaultGroupColor(key) };
      const clash = groupsLib.findGroupKey(Object.fromEntries(names.map((key) => [key, recordOf(key)])), groupName);
      if (clash) return { ...delta(s, {}), note: `There is already a group called ${clash}.` };
      const color = groupsLib.GROUP_PALETTE[names.length % groupsLib.GROUP_PALETTE.length];
      setters(s).groups((registry) => ({ ...registry, [groupName]: { name: groupName, description: "", color } }));
      let note = "";
      if (list(selection).length) {
        setRegionAttrs(s, list(selection).map(String), { group: groupName });
        note = `${groupName} controls the ${list(selection).length === 1 ? "selected region" : `${list(selection).length} selected regions`}.`;
      }
      return { ...delta(s, { regions: true }), name: groupName, note };
    },
    "workshop.group.patch": async ({ session: id, name = "", patch = {} } = {}) => {
      const s = need(id);
      const next = { ...patch };
      if (Object.prototype.hasOwnProperty.call(next, "populationText")) {
        const people = engine.wsPopulation.readPopulationFigure(next.populationText);
        delete next.populationText;
        next.population = people > 0 ? people : undefined;
      }
      if (Object.prototype.hasOwnProperty.call(next, "descriptionFinal")) {
        next.description = groupsLib.normalizeGroupDescription(next.descriptionFinal);
        delete next.descriptionFinal;
      }
      if (Object.prototype.hasOwnProperty.call(next, "military") && next.military === null) next.military = undefined;
      const recordOf = (key) => s.doc.groups?.[key] ?? { name: key, description: "", color: groupsLib.defaultGroupColor(key) };
      setters(s).groups((registry) => {
        const record = { ...recordOf(name), ...(registry?.[name] ?? {}), ...next, name };
        for (const [field, value] of Object.entries(next)) if (value === undefined) delete record[field];
        return { ...registry, [name]: record };
      });
      return delta(s, { regions: true });
    },
    "workshop.group.rename": async ({ session: id, from = "", to: target = "" } = {}) => {
      const s = need(id);
      const to = groupsLib.normalizeGroupName(target);
      const usage = listGroupUsage(s);
      const names = [...new Set([...Object.keys(s.doc.groups || {}), ...Object.keys(usage)])];
      if (!from || !to || to === from) return { ...delta(s, {}), name: from };
      const clash = names.find((other) => other !== from && other.toLocaleLowerCase() === to.toLocaleLowerCase());
      if (clash) return { ...delta(s, {}), name: from, note: `There is already a group called ${clash}.` };
      const recordOf = (key) => s.doc.groups?.[key] ?? { name: key, description: "", color: groupsLib.defaultGroupColor(key) };
      const steps = undoLib.groupRenameSteps(setters(s).groups, from, to, recordOf(from));
      const touched = features(s).filter((f) => clean(f.get("group")) === from);
      const apply = (value) => touched.forEach((f) => f.set("group", value || null));
      apply(to);
      steps.redo();
      notify(s);
      pushCmd(s, { undo: () => { apply(from); steps.undo(); }, redo: () => { apply(to); steps.redo(); } });
      return { ...delta(s, { regions: true }), name: to, note: `Renamed to ${to}.` };
    },
    "workshop.group.erase": async ({ session: id, name = "" } = {}) => {
      const s = need(id);
      const steps = undoLib.groupEraseSteps(setters(s).groups, name, s.doc.groups?.[name] ?? null);
      const touched = features(s).filter((f) => clean(f.get("group")) === name);
      const apply = (value) => touched.forEach((f) => f.set("group", value || null));
      apply(null);
      steps.redo();
      notify(s);
      pushCmd(s, { undo: () => { apply(name); steps.undo(); }, redo: () => { apply(null); steps.redo(); } });
      return { ...delta(s, { regions: true }), note: `${name} erased, and its area with it.` };
    },
    "workshop.groups.usage": async ({ session: id } = {}) => plain({ usage: listGroupUsage(need(id)), palette: groupsLib.GROUP_PALETTE }),
    "workshop.types.set": async ({ session: id, types = [] } = {}) => {
      const s = need(id);
      setters(s).types(list(types));
      return delta(s, { regions: true });
    },
    "workshop.types.usage": async ({ session: id } = {}) => {
      const s = need(id);
      const m = {};
      for (const f of features(s)) {
        const t = f.get("typeId") || "land";
        m[t] = (m[t] || 0) + 1;
      }
      return { usage: m };
    },
    "workshop.freezing": async ({ session: id, ids = [], on = true } = {}) => {
      const s = need(id);
      const step = undoLib.membershipStep(s.doc.freezingRegions || [], setters(s).freezingRegions, list(ids).map(String), Boolean(on));
      if (step) pushCmd(s, step);
      return delta(s, { war: true, doc: true });
    },
    "workshop.meta": async ({ session: id, patch = {} } = {}) => {
      const s = need(id);
      const allowed = {};
      for (const key of ["name", "author"]) if (Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = String(patch[key] ?? "");
      patchMetadata(s, allowed);
      return delta(s, { doc: true });
    },
    "workshop.projection.view": async ({ session: id, patch = {} } = {}) => {
      const s = need(id);
      const next = { ...engine.wsMapProjection.normalizeProjection(s.doc.metadata?.projection) };
      for (const [key, on] of Object.entries(patch)) {
        if (on) delete next[key];
        else next[key] = false;
      }
      patchMetadata(s, { projection: next });
      return delta(s, { doc: true });
    },
    "workshop.projection.options": async ({ session: id } = {}) => {
      const s = need(id);
      const projection = engine.wsMapProjection;
      const convert = engine.wsProjectionConvert;
      return plain({
        projections: projection.PROJECTIONS.map((entry) => ({ id: entry.id, name: entry.name })),
        current: projection.normalizeProjection(s.doc.metadata?.projection),
        freeform: projection.FREEFORM,
        hasPicture: s.doc.metadata?.customBackground?.kind === "image",
        blocked: convert.hasDetailedMap(s.doc) ? convert.DETAILED_MAP_CONVERSION_MESSAGE : "",
      });
    },
    "workshop.projection.check": async ({ session: id, type = "", shape = "" } = {}) => {
      const s = need(id);
      const projection = engine.wsMapProjection;
      const convert = engine.wsProjectionConvert;
      const current = projection.normalizeProjection(s.doc.metadata?.projection);
      const aspect = convert.parseAspect(shape);
      const chosen = type === projection.FREEFORM ? (aspect ? convert.projectionChoice(type, aspect) : null) : convert.projectionChoice(type);
      return plain({ aspectOk: Boolean(aspect), chosen, changed: Boolean(chosen) && !projection.sameProjection(current, chosen), shapeText: convert.formatAspect(current.type === projection.FREEFORM ? current.aspect : 2) });
    },
    "workshop.projection.convert": async ({ session: id, target = null, keepPicture = false } = {}) => {
      const s = need(id);
      const projection = engine.wsMapProjection;
      const convert = engine.wsProjectionConvert;
      const from = projection.normalizeProjection(s.doc.metadata?.projection);
      const to = projection.normalizeProjection(target);
      if (projection.sameProjection(from, to)) return delta(s, {});
      const background = s.doc.metadata?.customBackground ?? null;
      const plan = convert.planBasemapChange({ from, to, background, keepPicture, detailedMap: convert.hasDetailedMap(s.doc) });
      if (plan.kind === "blocked") return { ...delta(s, {}), error: plan.reason };
      if (plan.kind === "redraw") return { ...delta(s, {}), error: "Redrawing the starting picture for another projection is not in the native Workshop yet: it paints the picture again in the browser." };
      const moveXY = (x, y) => {
        const [X, Y] = projection.convertPlane(from, to, x / EARTH, y / EARTH);
        return [X * EARTH, Y * EARTH];
      };
      let nextBg = background;
      if (plan.kind === "bounds") nextBg = { kind: "image", dataUrl: background.dataUrl, aspect: background.aspect, bounds: plan.bounds };
      else if (plan.kind === "vector") nextBg = { ...background, geojson: projection.moveGeojson(background.geojson, (lon, lat) => projection.convertDisplayPoint(from, to, lon, lat)) };
      else if (plan.kind === "plain") nextBg = { kind: "plain" };
      else if (plan.kind === "tiles") nextBg = null;
      for (const f of features(s)) {
        f.getGeometry()?.applyTransform((input, output, stride = 2) => {
          const out = output ?? input;
          for (let i = 0; i < input.length; i += stride) {
            const [x, y] = moveXY(input[i], input[i + 1]);
            out[i] = x;
            out[i + 1] = y;
          }
          return out;
        });
      }
      s.undo = [];
      s.redo = [];
      notify(s, { geometry: true });
      setters(s).features((rows) => convert.moveFeatureCoords(rows, from, to));
      setters(s).units((rows) => convert.moveUnits(rows, from, to));
      setters(s).terrainAreas((rows) => convert.moveWarShapes(rows, from, to));
      setters(s).fortifications((rows) => convert.moveWarShapes(rows, from, to));
      setters(s).climateZones((rows) => convert.moveWarShapes(rows, from, to));
      const movedOwnBasemaps = engine.wsOwnBasemaps.moveOwnBasemapsBetween(s.doc.metadata?.ownBasemaps, from, to);
      patchMetadata(s, {
        projection: { ...to, ...(from.globe === false ? { globe: false } : {}), ...(from.wrap === false ? { wrap: false } : {}) },
        ...(nextBg !== background ? { customBackground: nextBg } : {}),
        ...(movedOwnBasemaps ? { ownBasemaps: movedOwnBasemaps } : {}),
      });
      return delta(s, { all: true });
    },
    "workshop.maps": async ({ session: id } = {}) => {
      const s = need(id);
      const library = await engine.wsBasemapLibrary.listBasemaps().catch(() => []);
      return plain({
        maps: mapsOf(s),
        builtins: engine.wsBasemaps.EDITOR_BASEMAPS.map((b) => ({ id: b.id, label: b.label, preview: engine.wsBasemaps.esriPreviewUrl(b.service) })),
        mine: Array.isArray(library) ? library.map((bm) => ({ id: bm.id, name: bm.name, kind: bm.kind, thumbnail: bm.thumbnail || "", bytes: bm.bytes || 0, official: bm.official || null, contentHash: bm.contentHash || "", community: Boolean(bm.source?.community) })) : [],
      });
    },
    "workshop.maps.addBuiltin": async ({ session: id, builtinId = "" } = {}) => {
      const s = need(id);
      const result = applyMaps(s, engine.wsScenarioMaps.addBuiltinMap(s.doc.metadata, builtinId));
      return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
    },
    "workshop.maps.addLibrary": async ({ session: id, basemapId = "" } = {}) => {
      const s = need(id);
      const library = await engine.wsBasemapLibrary.listBasemaps().catch(() => []);
      const bm = (Array.isArray(library) ? library : []).find((entry) => entry.id === basemapId);
      if (!bm) return { ...delta(s, {}), refused: "Could not add that map: it is not in Your basemaps any more." };
      try {
        if (bm.kind !== "tiled") {
          const entry = engine.wsOwnBasemaps.ownBasemapFromLibrary(bm, await engine.wsBasemapLibrary.getBasemapPayload(bm.id));
          if (!entry) throw new Error("It has no picture or drawn map in it.");
          const result = applyMaps(s, engine.wsScenarioMaps.addOwnMap(s.doc.metadata, entry));
          return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
        }
        const metadata = s.doc.metadata;
        const detailed = {
          id: engine.wsOwnBasemaps.ownBasemapIdOfLibrary(bm),
          name: bm.name,
          detailed: bm.official?.id ? { id: bm.official.id, version: bm.official.version } : { hash: bm.contentHash },
        };
        let result = engine.wsScenarioMaps.addOwnMap(metadata, detailed);
        if (result.refused === engine.wsExportPreset.DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE) {
          const fallback = (await engine.wsBasemapLibrary.getBasemapPayload(bm.id).catch(() => null))?.geojson;
          if (fallback?.features?.length) {
            const drawn = engine.wsScenarioMaps.addOwnMap(metadata, { id: `${detailed.id.slice(0, 32)}-drawn`, name: `${bm.name} (drawn)`, background: { kind: "vector", geojson: fallback } });
            const both = drawn.patch ? engine.wsScenarioMaps.addOwnMap({ ...metadata, ...drawn.patch }, detailed) : drawn;
            if (both.patch) result = both;
          }
        }
        const applied = applyMaps(s, result);
        return { ...delta(s, { doc: true }), ...applied, maps: mapsOf(s) };
      } catch (error) {
        return { ...delta(s, {}), refused: `Could not add that map: ${error?.message || error}` };
      }
    },
    "workshop.maps.makeStarting": async ({ session: id, key = "" } = {}) => {
      const s = need(id);
      const result = applyMaps(s, engine.wsScenarioMaps.makeStartingMap(s.doc.metadata, key, { scenarioName: s.doc.metadata?.name }));
      return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
    },
    "workshop.maps.remove": async ({ session: id, key = "" } = {}) => {
      const s = need(id);
      const result = applyMaps(s, engine.wsScenarioMaps.removeMap(s.doc.metadata, key));
      return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
    },
    "workshop.maps.shownOver": async ({ session: id, key = "", over: overKey = "" } = {}) => {
      const s = need(id);
      const result = applyMaps(s, engine.wsScenarioMaps.setShownOver(s.doc.metadata, key, overKey, { scenarioName: s.doc.metadata?.name }));
      return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
    },
    "workshop.maps.deleteLibrary": async ({ basemapId = "" } = {}) => {
      try {
        await engine.wsBasemapLibrary.deleteBasemap(basemapId);
        return { ok: true };
      } catch (error) {
        return { error: `Could not delete that basemap: ${error?.message || error}` };
      }
    },
    "workshop.war.create": async ({ session: id, kind = "terrain", rings = null, points = null, owner: given = "" } = {}) => {
      let owner = given;
      const s = need(id);
      const war = engine.wsWarGeography;
      const field = war.WAR_LISTS[kind];
      if (!field) return delta(s, {});
      const rowsNow = s.doc[field] || [];
      if (kind === "fortification" && !clean(owner) && Array.isArray(points) && points.length >= 2) {
        const LineString = engine.wsOlLineString.default;
        const geometry = new LineString(points.map((point) => fromLonLat([Number(point[0]), Number(point[1])])));
        const owners = [];
        for (let i = 0; i <= 48; i += 1) {
          const hits = s.source.getFeaturesAtCoordinate(geometry.getCoordinateAt(i / 48));
          const hitOwner = hits.length ? hits[hits.length - 1].get("owner") : null;
          if (hitOwner) owners.push(String(hitOwner));
        }
        owner = engine.wsWarGeography.mostCommon(owners) || "";
      }
      const row = kind === "terrain"
        ? war.newTerrainArea(mapDoc.newId("terrain"), rings, rowsNow)
        : kind === "fortification"
          ? war.newFortification(mapDoc.newId("wall"), points, owner, rowsNow)
          : war.newClimateZone(mapDoc.newId("zone"), rings, rowsNow);
      const step = undoLib.addRowStep(setters(s)[field], row);
      pushCmd(s, step);
      return { ...delta(s, { war: true }), id: row.id };
    },
    "workshop.war.patch": async ({ session: id, kind = "terrain", rowId = "", fields = {} } = {}) => {
      const s = need(id);
      const field = engine.wsWarGeography.WAR_LISTS[kind];
      if (!field) return delta(s, {});
      setters(s)[field]((rows) => (rows || []).map((row) => {
        if (row.id !== rowId) return row;
        const next = { ...(row || {}), ...fields };
        for (const [key, value] of Object.entries(fields)) if (value === undefined || value === null) delete next[key];
        return next;
      }));
      return delta(s, { war: true });
    },
    "workshop.war.patchItem": async ({ session: id, rowId = "", list: listName = "seasons", index = -1, fields = null, effects = null, weather = null, add = null, remove = false } = {}) => {
      const s = need(id);
      if (listName !== "seasons" && listName !== "events") return delta(s, {});
      const mergeInto = (base, patch, dropZero = false) => {
        const next = { ...(base && typeof base === "object" ? base : {}) };
        for (const [key, value] of Object.entries(patch || {})) {
          if (value === undefined || value === null || (dropZero && !(Number(value) > 0))) delete next[key];
          else next[key] = value;
        }
        return next;
      };
      setters(s).climateZones((rows) => (rows || []).map((row) => {
        if (row.id !== rowId) return row;
        const items = Array.isArray(row[listName]) ? row[listName].slice() : [];
        if (add && typeof add === "object") {
          items.push(add);
        } else if (Number.isInteger(index) && index >= 0 && index < items.length) {
          if (remove) items.splice(index, 1);
          else {
            let item = mergeInto(items[index], fields);
            if (effects) item = { ...item, effects: mergeInto(item.effects, effects) };
            if (weather) item = { ...item, weather: mergeInto(item.weather, weather, true) };
            items[index] = item;
          }
        } else return row;
        return { ...row, [listName]: items };
      }));
      return delta(s, { war: true });
    },
    "workshop.war.remove": async ({ session: id, kind = "terrain", rowId = "" } = {}) => {
      const s = need(id);
      const field = engine.wsWarGeography.WAR_LISTS[kind];
      if (!field) return delta(s, {});
      const step = undoLib.removeRowStep(s.doc[field] || [], setters(s)[field], rowId);
      if (step) pushCmd(s, step);
      return delta(s, { war: true });
    },
    "workshop.war.worldStart": async ({ session: id, kind = "terrain" } = {}) => {
      const s = need(id);
      const defaults = engine.wsWorldGeographyDefaults;
      const field = engine.wsWarGeography.WAR_LISTS[kind];
      if (!field) return delta(s, {});
      setters(s)[field](() => JSON.parse(JSON.stringify(kind === "climate" ? defaults.WORLD_CLIMATE_ZONES : defaults.WORLD_TERRAIN_AREAS)));
      return delta(s, { war: true });
    },
    "workshop.war.climateSeasons": async ({ climate = "continental" } = {}) => plain({ seasons: engine.wsWarGeography.seasonsOfClimate(climate) }),
    "workshop.war.constants": async () => plain({
      weather: engine.wsWeather.WEATHER_STATES,
      terrainMost: engine.wsWarGeographyRuntime.TERRAIN_LEVEL_MOST,
      wallLeast: engine.wsWarGeographyRuntime.WALL_LEVEL_LEAST,
      wallMost: engine.wsWarGeographyRuntime.WALL_LEVEL_MOST,
      climatePresets: engine.wsWarGeography.CLIMATE_PRESETS,
      newSeason: engine.wsWarGeography.newSeason(),
      newEvent: engine.wsWarGeography.newClimateEvent(),
    }),
    "workshop.regions.delete": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const removed = [];
      for (const rid of list(ids)) {
        const f = s.source.getFeatureById(String(rid));
        if (f) {
          s.source.removeFeature(f);
          removed.push(f);
        }
      }
      if (removed.length) {
        notify(s, { geometry: true });
        pushCmd(s, {
          undo: () => { removed.forEach((f) => s.source.addFeature(f)); s.geometryRev += 1; },
          redo: () => { removed.forEach((f) => s.source.removeFeature(f)); s.geometryRev += 1; },
        });
      } else {
        notify(s);
      }
      return delta(s, { regions: true });
    },
    "workshop.regions.merge": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const feats = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean);
      if (feats.length < 2) return delta(s, {});
      const cmd = engine.wsShapeEdits.mergeRegionFeatures(s.source, feats);
      if (!cmd) {
        return { ...delta(s, {}), refused: "These regions could not be merged. Borders are repaired when the map is saved into its scenario, so save the map and then try again." };
      }
      notify(s, { geometry: true });
      pushCmd(s, { undo: () => { cmd.undo(); s.geometryRev += 1; }, redo: () => { cmd.redo(); s.geometryRev += 1; } });
      return { ...delta(s, { regions: true }), selection: [String(feats[0].getId())] };
    },
    "workshop.regions.dissolve": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const feats = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean);
      if (feats.length < 2) return delta(s, {});
      const cmd = engine.wsShapeEdits.mergeRegionFeatures(s.source, feats);
      if (!cmd) {
        return { ...delta(s, {}), refused: "The border between these two regions could not be removed. Borders are repaired when the map is saved into its scenario, so save the map and then try again." };
      }
      notify(s, { geometry: true });
      pushCmd(s, { undo: () => { cmd.undo(); s.geometryRev += 1; }, redo: () => { cmd.redo(); s.geometryRev += 1; } });
      return { ...delta(s, { regions: true }), selection: [String(feats[0].getId())] };
    },
    "workshop.regions.simplify": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const simplifyLib = engine.wsSimplify;
      const isArea = (f) => /Polygon$/.test(f?.getGeometry()?.getType() || "");
      const chosen = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(isArea);
      if (!chosen.length) return { ...delta(s, {}), changed: 0 };
      const picked = new Set(chosen);
      const box = engine.wsOlExtent.createEmpty();
      for (const f of chosen) engine.wsOlExtent.extend(box, f.getGeometry().getExtent());
      const nearby = [];
      s.source.forEachFeatureIntersectingExtent(box, (f) => {
        if (!picked.has(f) && isArea(f)) nearby.push(f);
      });
      const meters = simplifyLib.detailToleranceMeters(features(s).filter((f) => !picked.has(f)).map((f) => f.getGeometry()));
      const all = [...chosen, ...nearby];
      const lighter = simplifyLib.simplifyShared(all.map((f) => f.getGeometry()), { toleranceAt: simplifyLib.toleranceAtLatitude(meters), movable: all.map((_, at) => at < chosen.length) });
      const same = (a, b) => {
        const x = a.getFlatCoordinates();
        const y = b.getFlatCoordinates();
        if (x.length !== y.length) return false;
        for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
        return true;
      };
      const changes = [];
      all.forEach((f, at) => {
        const before = f.getGeometry();
        if (!lighter[at] || lighter[at] === before || same(before, lighter[at])) return;
        changes.push({ feature: f, before, after: lighter[at], edited: f.get("edited") });
      });
      if (!changes.length) return { ...delta(s, {}), changed: 0 };
      const apply = (forward) => {
        for (const change of changes) {
          change.feature.setGeometry(forward ? change.after : change.before);
          change.feature.set("edited", forward ? true : change.edited);
        }
        s.geometryRev += 1;
      };
      apply(true);
      notify(s, { geometry: true });
      pushCmd(s, { undo: () => apply(false), redo: () => apply(true) });
      return { ...delta(s, { regions: true }), changed: changes.length };
    },
    "workshop.regions.duplicate": async ({ session: id, ids = [], offset = 0 } = {}) => {
      const s = need(id);
      const off = Number(offset) || 0;
      const created = [];
      for (const rid of list(ids)) {
        const f = s.source.getFeatureById(String(rid));
        if (!f) continue;
        const nf = new Feature({ geometry: geo.translatedClone(f.getGeometry(), off, -off) });
        nf.setId(mapDoc.newId());
        nf.setProperties({
          typeId: f.get("typeId") || "land",
          owner: f.get("owner") || null,
          name: (f.get("name") || "Region") + " copy",
          gid0: f.get("gid0") || "",
          country: f.get("country") || "",
          claimants: f.get("claimants") || null,
          group: f.get("group") || null,
        });
        s.source.addFeature(nf);
        created.push(nf);
      }
      notify(s, { geometry: Boolean(created.length) });
      if (created.length) {
        pushCmd(s, {
          undo: () => { created.forEach((f) => s.source.removeFeature(f)); s.geometryRev += 1; },
          redo: () => { created.forEach((f) => s.source.addFeature(f)); s.geometryRev += 1; },
        });
      }
      return { ...delta(s, { regions: true }), selection: created.map((f) => String(f.getId())) };
    },
    "workshop.regions.move": async ({ session: id, ids = [], from = null, to = null } = {}) => {
      const s = need(id);
      const feats = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean);
      if (!feats.length || !Array.isArray(from) || !Array.isArray(to)) return delta(s, {});
      const [ax, ay] = fromLonLat([Number(from[0]), Number(from[1])]);
      const [bx, by] = fromLonLat([Number(to[0]), Number(to[1])]);
      const dx = bx - ax;
      const dy = by - ay;
      if (!dx && !dy) return delta(s, {});
      const before = engine.wsShapeEdits.captureShapes(feats);
      for (const f of feats) {
        f.getGeometry().translate(dx, dy);
        f.set("edited", true);
      }
      const after = engine.wsShapeEdits.captureShapes(feats);
      notify(s, { geometry: true });
      pushCmd(s, {
        undo: () => { engine.wsShapeEdits.restoreShapes(before); s.geometryRev += 1; },
        redo: () => { engine.wsShapeEdits.restoreShapes(after); s.geometryRev += 1; },
      });
      return delta(s, { regions: true });
    },
    "workshop.clipboard": async ({ session: id } = {}) => {
      need(id);
      return { summary: describeClipboard() };
    },
    "workshop.clipboard.copy": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const regions = exportRegions(s, list(ids).map(String));
      if (!regions.features.length) return { ...delta(s, {}), result: null, summary: describeClipboard() };
      clipboard = engine.wsRegionClipboard.buildClipboardPayload({ regions, doc: s.doc, colors: paintColors(s), sourceName: s.doc.metadata?.name, sourceId: s.doc.id });
      persistClipboard();
      return { ...delta(s, { doc: true }), result: { kind: "copied", count: regions.features.length }, summary: describeClipboard() };
    },
    "workshop.clipboard.paste": async ({ session: id, simplify = true } = {}) => {
      const s = need(id);
      if (!clipboard) return { ...delta(s, {}), result: null };
      const plan = engine.wsRegionClipboard.planClipboardMerge(clipboard, { polities: s.doc.polities, colors: paintColors(s), flags: s.doc.flags, tags: s.doc.tags, types: s.doc.types, groups: s.doc.groups });
      if (plan.types.length) setters(s).types((rows) => [...rows, ...plan.types]);
      if (Object.keys(plan.groups).length) setters(s).groups((registry) => ({ ...plan.groups, ...registry }));
      for (const [key, record] of Object.entries(plan.upserts)) upsertPolity(s, key, record);
      for (const [key, rgb] of Object.entries(plan.colorOverrides)) setColorOverride(s, key, rgb);
      for (const [key, flag] of Object.entries(plan.flags)) setFlag(s, key, flag);
      for (const [key, rows] of Object.entries(plan.tags)) setTags(s, key, rows);
      const result = pasteRegions(s, clipboard.regions, { simplify: Boolean(simplify) });
      return { ...delta(s, { regions: true }), result: { kind: "pasted", ...result }, selection: result.added.map(String), bounds: unionExtent(result.added.map((rid) => s.source.getFeatureById(rid)).filter(Boolean)) };
    },
    "workshop.clipboard.clear": async ({ session: id } = {}) => {
      const s = need(id);
      clipboard = null;
      persistClipboard();
      return { ...delta(s, { doc: true }), summary: null };
    },
    "workshop.undo": async ({ session: id } = {}) => {
      const s = need(id);
      const c = s.undo.pop();
      if (c) {
        c.undo();
        s.redo.push(c);
        notify(s);
      }
      return delta(s, { all: true });
    },
    "workshop.redo": async ({ session: id } = {}) => {
      const s = need(id);
      const c = s.redo.pop();
      if (c) {
        c.redo();
        s.undo.push(c);
        notify(s);
      }
      return delta(s, { all: true });
    },
    "workshop.documents": async () => plain({ docs: await engine.wsDocumentIO.listDocuments() }),
    "workshop.documents.delete": async ({ docId = "" } = {}) => {
      try {
        await engine.wsDocumentIO.deleteDocument(docId);
        return { ok: true };
      } catch (error) {
        return { error: `Could not delete this map: ${error?.message || error}` };
      }
    },
    "workshop.documents.export": async ({ session: id, path: target = "", game = false } = {}) => {
      const s = need(id);
      const content = game
        ? engine.wsExportPreset.buildGameSeed(s.doc, serializeRegions(s), paintColors(s))
        : { ...buildPayload(s), id: s.docId, version: 1 };
      fs.writeFileSync(clean(target), JSON.stringify(content));
      return { saved: clean(target) };
    },
    "workshop.documents.fileName": async ({ session: id, game = false } = {}) => {
      const s = need(id);
      const name = game ? `${s.doc.name || s.doc.metadata?.name || "map"}-game-seed` : (s.doc.metadata?.name || "map");
      return { fileName: `${String(name).replace(/[^a-z0-9]+/gi, "-")}.json` };
    },
    "workshop.save": async ({ session: id, mode = "deep", play = false } = {}) => {
      const s = need(id);
      if (s.action) return { ...delta(s, {}), ignored: true };
      if (!s.hydrated) {
        console.warn("[editor] scenario save requested before its map loaded — ignored.");
        return { ...delta(s, {}), ignored: true };
      }
      s.action = play ? "play" : "save";
      pushStatus(s);
      const note = await cleanBorders(s, { mode });
      try {
        const authoringOps = s.polityAuthoringOps.slice();
        const seed = {
          ...engine.wsExportPreset.buildGameSeed(s.doc, serializeRegions(s) || { type: "FeatureCollection", features: [] }, paintColors(s)),
          polityAuthoringOps: removalsForScenario(authoringOps),
        };
        const renames = Array.isArray(s.doc.polityRenames) ? s.doc.polityRenames : [];
        const { scenarioCountry, details } = await lib.withSingleLibraryRefresh(() => writeMapToScenario(s.scenario.id, seed, renames));
        if (renames.length) s.doc = { ...s.doc, polityRenames: s.doc.polityRenames.slice(renames.length) };
        s.polityAuthoringOps = s.polityAuthoringOps.slice(authoringOps.length);
        s.scenarioDirty = false;
        let gameId = "";
        if (play) {
          const gameDetails = await lib.createGame({
            name: `${s.scenario.name} Session`,
            scenarioId: s.scenario.id,
            ...(scenarioCountry ? { gamePatch: { country: scenarioCountry } } : null),
            setActive: true,
          });
          gameId = clean(gameDetails?.game?.id);
        }
        return { ...delta(s, { regions: true }), note, details: plain(details), gameId };
      } catch (error) {
        console.warn("[editor] scenario save failed:", error);
        return { ...delta(s, {}), error: `Could not save the map into the scenario: ${error?.message || error}` };
      } finally {
        s.action = "";
        emit("workshop.cleanup", { session: s.id, state: null });
        pushStatus(s);
      }
    },
    "workshop.stopCleanup": async ({ session: id } = {}) => {
      const s = need(id);
      s.cleanupStop = true;
      return true;
    },
    "workshop.cleanupLimits": async () => {
      const limits = sweep.BORDER_CLEANUP;
      return { minWidth: limits.minWidth, quickWidth: limits.quickWidth, maxWidth: limits.maxWidth, maxMillis: limits.maxMillis };
    },
    "workshop.pref.get": async ({ keys = [] } = {}) => ({ values: Object.fromEntries(list(keys).map((key) => [String(key), ctx.storage.getItem(String(key))])) }),
    "workshop.pref.set": async ({ key = "", value = "" } = {}) => {
      if (clean(key)) {
        ctx.storage.setItem(clean(key), String(value ?? ""));
        ctx.storage.flush?.();
      }
      return true;
    },
    "workshop.extent": async ({ session: id } = {}) => {
      const s = need(id);
      const extent = s.source.getExtent();
      if (!extent || !Number.isFinite(extent[0])) return { bounds: null };
      const [west, south] = toLonLat([extent[0], extent[1]]);
      const [east, north] = toLonLat([extent[2], extent[3]]);
      return { bounds: [[west, south], [east, north]] };
    },
    "workshop.documents.new": async ({ session: id, kind = "blank" } = {}) => {
      const s = need(id);
      s.doc = mapDoc.createDocument({ name: kind === "blank" ? "Untitled Map" : kind === "modern-day" ? "Legacy World Map" : "World Map", kind });
      let feats = [];
      if (kind !== "blank") feats = await engine.wsRegionImport.loadSeedFeatures({ url: engine.wsRegionImport.seedUrlOf(kind) });
      s.source.clear();
      s.savedRegionHashes.clear();
      if (feats.length) s.source.addFeatures(feats);
      s.undo = [];
      s.redo = [];
      s.geometryRev += 1;
      s.regionRev += 1;
      s.docId = null;
      s.savedEdits = s.edits;
      s.retries = 0;
      s.saveError = "";
      s.saveStatus = "saved";
      if (feats.length) dirty(s);
      return delta(s, { all: true });
    },
    "workshop.documents.open": async ({ session: id, docId = "" } = {}) => {
      const s = need(id);
      let opened;
      let feats;
      try {
        opened = mapDoc.openStoredDocument(await engine.wsDocumentIO.loadDocument(docId));
        feats = opened.regions && Array.isArray(opened.regions.features) ? fmt.readFeatures(opened.regions, READ) : [];
        for (const f of feats) {
          const p = f.getProperties();
          if (f.getId() == null && p.id != null) f.setId(String(p.id));
          if (f.get("typeId") == null) f.set("typeId", "land");
        }
      } catch (error) {
        return { ...delta(s, {}), refused: `Could not open this map: ${error?.message || error}. Your current map is unchanged.` };
      }
      s.source.clear();
      s.savedRegionHashes.clear();
      if (feats.length) s.source.addFeatures(feats);
      s.doc = opened.doc;
      s.undo = [];
      s.redo = [];
      s.geometryRev += 1;
      s.regionRev += 1;
      s.docId = opened.doc.id;
      s.savedEdits = s.edits;
      s.retries = 0;
      s.saveError = "";
      s.saveStatus = "saved";
      return delta(s, { all: true });
    },
    "workshop.documents.current": async ({ session: id } = {}) => {
      const s = need(id);
      return { docId: s.docId, author: s.doc.metadata?.author || "" };
    },
  };
};
