/*
 * Open Historia Continuum — polity flag resolver / mutable campaign flag state.
 *
 * Political identity is a stable polity key. A flag is presentation state attached
 * to that lineage, not to a modern ISO/GADM code and not to the current display
 * name. mapRefs are used only as a stock-image fallback when the scenario has not
 * assigned a custom flag.
 */
import COUNTRY_NAMES from "./generated/countryNames.js";
import { getNationFlags, JSON_URLS, writeJson } from "./assets.js";
import { flagImageUrlFromGid } from "./countryFlags.js";
import { resolvePolityIdentity } from "./polityIdentity.js";

const str = (value) => String(value ?? "").trim();
const norm = (value) => str(value).toLowerCase();

const STOCK_CODES_BY_NAME = (() => {
  const out = new Map();
  for (const [code, name] of Object.entries(COUNTRY_NAMES)) {
    const key = norm(name);
    if (!key) continue;
    const list = out.get(key) || [];
    list.push(str(code).toUpperCase());
    out.set(key, list);
  }
  return out;
})();

const flagIndexCache = new WeakMap();
const flagIndex = (flags) => {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return new Map();
  const cached = flagIndexCache.get(flags);
  if (cached) return cached;
  const index = new Map();
  for (const [key, value] of Object.entries(flags)) {
    if (!str(key) || !str(value)) continue;
    index.set(norm(key), { key, value });
  }
  flagIndexCache.set(flags, index);
  return index;
};

const uniqueResolvedIdentity = (polity, world) => {
  const input = typeof polity === "string" ? { name: polity } : (polity || {});
  const directKey = str(input.polityKey || input.identityKey);
  if (directKey && world?.polityOverrides?.[directKey]) return directKey;

  const tokens = [input.name, input.code]
    .map(str)
    .filter(Boolean);
  const found = new Set();
  for (const token of tokens) {
    const result = resolvePolityIdentity(token, world, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    if (result.resolved) found.add(result.resolved);
  }
  return found.size === 1 ? [...found][0] : "";
};

const stockCodesFor = (polity) => {
  const input = typeof polity === "string" ? { name: polity } : (polity || {});
  const code = str(input.code).toUpperCase();
  const direct = code && COUNTRY_NAMES[code] ? [code] : [];
  const byName = STOCK_CODES_BY_NAME.get(norm(input.name)) || [];
  return [...new Set([...direct, ...byName])];
};

const customFlagForCandidates = (flags, candidates) => {
  const index = flagIndex(flags);
  for (const candidate of candidates) {
    const hit = index.get(norm(candidate));
    if (hit?.value) return { imageUrl: hit.value, key: hit.key };
  }
  return null;
};

export const resolvePolityFlag = ({ polity, world, flags = {} } = {}) => {
  const input = typeof polity === "string" ? { name: polity } : (polity || {});
  const polityKey = uniqueResolvedIdentity(input, world);
  const record = polityKey ? world?.polityOverrides?.[polityKey] : null;

  const custom = customFlagForCandidates(flags, [
    polityKey,
    record?.name,
    ...(Array.isArray(record?.aliases) ? record.aliases : []),
    input.name,
    input.code,
  ]);
  if (custom) {
    return {
      imageUrl: custom.imageUrl,
      polityKey: polityKey || custom.key,
      source: "custom",
    };
  }

  if (str(record?.flag)) {
    return {
      imageUrl: str(record.flag),
      polityKey,
      source: "legacy-polity",
    };
  }

  const mapRefs = Array.isArray(record?.mapRefs?.gadm0)
    ? [...new Set(record.mapRefs.gadm0.map((code) => str(code).toUpperCase()).filter(Boolean))]
    : [];

  // A single explicit base reference is safe as an asset fallback. Multiple refs
  // can be legitimate for composite/fantasy polities, but choosing one flag would
  // be arbitrary, so those require an authored flag instead.
  if (mapRefs.length === 1) {
    const imageUrl = flagImageUrlFromGid(mapRefs[0]);
    if (imageUrl) {
      return {
        imageUrl,
        mapCode: mapRefs[0],
        polityKey,
        source: "map-ref",
      };
    }
  }

  // Ordinary stock scenarios have no declared polity record at all. Preserve the
  // native built-in flag path for those actors without turning a modern code into
  // the political identity of historical/custom polities.
  if (!record) {
    const stockCodes = stockCodesFor(input);
    if (stockCodes.length === 1) {
      const imageUrl = flagImageUrlFromGid(stockCodes[0]);
      if (imageUrl) {
        return {
          imageUrl,
          mapCode: stockCodes[0],
          polityKey: polityKey || str(input.name) || str(input.code),
          source: "stock",
        };
      }
    }
  }

  return {
    imageUrl: null,
    polityKey,
    source: "none",
  };
};

export const canonicalizeFlagMap = (flags, world) => {
  const source = flags && typeof flags === "object" && !Array.isArray(flags) ? flags : {};
  const out = {};
  for (const [rawKey, value] of Object.entries(source)) {
    if (!str(rawKey) || !str(value)) continue;
    const resolved = resolvePolityIdentity(rawKey, world, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    const key = resolved.resolved || rawKey;
    // Stable/canonical keys win collisions over a stale alias encountered later.
    if (!(key in out) || norm(rawKey) === norm(key)) out[key] = value;
  }
  return out;
};

export const resolveWritablePolityKey = (polity, world) => {
  const resolved = uniqueResolvedIdentity(polity, world);
  if (resolved) return resolved;
  const raw = typeof polity === "string"
    ? str(polity)
    : str(polity?.polityKey || polity?.name || polity?.code);
  return raw;
};

export const setPolityFlag = async ({ polity, world, dataUrl }) => {
  const key = resolveWritablePolityKey(polity, world);
  if (!key) throw new Error("Cannot change a flag without a resolvable polity identity.");

  // force=true matters for an old save with no game-level flags.json yet: this read
  // returns the scenario's complete effective starting map, which we then clone and
  // write as the game's first mutable flag state rather than shadowing it with one key.
  const current = await getNationFlags({ force: true }).catch(() => ({}));
  const next = canonicalizeFlagMap(current, world);
  const value = str(dataUrl);
  if (value) next[key] = value;
  else delete next[key];

  await writeJson(JSON_URLS.flags, next, { pretty: true });
  return next;
};
