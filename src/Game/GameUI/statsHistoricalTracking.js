/*! Open Historia — hot-path helpers for Advanced Stats historical tracking. */
import { buildPolityIdentityIndex, resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import { gameDateDayNumber } from "../../runtime/gameDates.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();

const resolveWithIndex = (value, world, identityIndex) => {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const resolved = resolvePolityIdentity(raw, world, {
      allowUnknown: true,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
      identityIndex,
    });
    return clean(resolved?.resolved) || raw;
  } catch {
    return raw;
  }
};

// Historical tracking used to call resolvePolityIdentity() and isPolityLandless()
// once per candidate (and polityDisplayName() again per keystroke). Both default
// paths rebuild/normalize large world structures. Build the identity index and
// land-presence sets ONCE for the immutable modal snapshot instead.
export const buildHistoricalTrackingIndex = (world = {}) => {
  const identityIndex = buildPolityIdentityIndex(world);
  const ownership = world?.regionOwnershipOverrides && typeof world.regionOwnershipOverrides === "object"
    ? world.regionOwnershipOverrides
    : {};
  const sovereignty = world?.regionSovereigntyOverrides && typeof world.regionSovereigntyOverrides === "object"
    ? world.regionSovereigntyOverrides
    : {};
  const hasOwnershipOverrides = Object.keys(ownership).length > 0;
  // Region ledgers can contain tens of thousands of entries but only a few
  // hundred distinct owner tokens. Resolve each DISTINCT owner through the
  // prebuilt identity index once so old/aliased saves preserve the same
  // landless semantics without paying resolver cost per region or candidate.
  // Every distinct land-holding polity, by its canonical key.
  const landedOwners = [...new Map(
    [...new Set([...Object.values(ownership), ...Object.values(sovereignty)].map(clean).filter(Boolean))]
      .map((owner) => resolveWithIndex(owner, world, identityIndex))
      .filter(Boolean)
      .map((owner) => [lower(owner), owner]),
  ).values()];
  const landed = new Set(landedOwners.map(lower));
  const declared = new Map(
    (identityIndex?.declared || []).map((entry) => [lower(entry?.canonical), entry]),
  );
  const overrideNames = new Map(
    Object.entries(world?.polityOverrides || {}).map(([key, value]) => [lower(key), clean(value?.name)]),
  );

  const canonicalKey = (value) => resolveWithIndex(value, world, identityIndex);
  const displayName = (value) => {
    const canonical = canonicalKey(value);
    if (!canonical) return "Unknown polity";
    // Match stats.jsx's old visual semantics exactly: a polity override's
    // explicit era name wins; otherwise show the canonical key. Aliases/codes
    // are identity inputs, not display labels.
    return overrideNames.get(lower(canonical)) || canonical;
  };
  const isLandless = (value) => {
    const canonical = canonicalKey(value);
    if (!canonical) return false;
    if (landed.has(lower(canonical))) return false;
    const known = declared.has(lower(canonical));
    // Match gameState.isPolityLandless: a stock-map save with no ownership
    // overrides does not make undeclared stock countries landless.
    if (!hasOwnershipOverrides && !known) return false;
    return true;
  };

  return { identityIndex, canonicalKey, displayName, isLandless, landedOwners, hasOwnershipOverrides };
};

// `index`: the caller's buildHistoricalTrackingIndex(world) when it already has
// one (the Stats pane builds one per world snapshot), so it is not built twice.
// `stockNames`: the stock map's country names, offered when the save has no
// ownership ledger (a stock-map game), where the land holders are exactly those.
//
// Every polity holding land is a candidate, not only those already opened in
// Stats: a rival the player never inspected can be picked directly. A row with
// no sheet yet shows "baseline needed"; tracking one costs nothing until its
// first sheet exists.
export const buildHistoricalTrackingCandidateRows = ({
  world = {},
  playerCountry = "",
  currentCountry = "",
  index: providedIndex = null,
  stockNames = [],
} = {}) => {
  const index = providedIndex || buildHistoricalTrackingIndex(world);
  const collected = new Map();
  const add = (value) => {
    const key = index.canonicalKey(value);
    if (!key) return;
    const folded = lower(key);
    if (collected.has(folded) || index.isLandless(key)) return;
    const label = index.displayName(key);
    collected.set(folded, {
      key,
      label,
      searchText: `${lower(key)}\n${lower(label)}`,
    });
  };

  add(playerCountry);
  add(currentCountry);
  Object.keys(world?.countryStats || {}).forEach(add);
  Object.keys(world?.polityOverrides || {}).forEach(add);
  (index.landedOwners || []).forEach(add);
  if (!index.hasOwnershipOverrides && Array.isArray(stockNames)) stockNames.forEach(add);

  return {
    index,
    rows: [...collected.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
};

export const filterHistoricalTrackingCandidateRows = (rows, search = "") => {
  const query = lower(search);
  if (!query) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => String(row?.searchText || "").includes(query));
};

const HISTORY_RANGE_YEARS = Object.freeze({ "1y": 1, "5y": 5, "10y": 10 });

// Advanced Statistics' time range: the samples within that many years of the
// newest one. Counted in game days, which run negative before 1970 and BC: the
// old reduce started at 0 and read every pre-1970 campaign as having no latest
// date, so "1 year" filtered nothing there.
export const historySamplesInRange = (samples, range = "all") => {
  const list = Array.isArray(samples) ? samples : [];
  const years = HISTORY_RANGE_YEARS[range];
  if (!years) return list;
  let latest = -Infinity;
  for (const sample of list) {
    const day = gameDateDayNumber(sample?.date);
    if (Number.isFinite(day) && day > latest) latest = day;
  }
  if (!Number.isFinite(latest)) return list;
  const cutoff = latest - years * 365.2425;
  return list.filter((sample) => {
    const day = gameDateDayNumber(sample?.date);
    return Number.isFinite(day) && day >= cutoff;
  });
};
