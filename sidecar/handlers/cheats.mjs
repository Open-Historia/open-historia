const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const EVENT_IMPACT_LABELS = {
  regionTransfers: "territory",
  regionControlOps: "control",
  regionClaims: "claims",
  groupOps: "groups",
  polityChanges: "polity",
  politicalActorOps: "politics",
  institutionLifecycleOps: "institutions",
  unitOps: "units",
  markerOps: "markers",
  spyOps: "spies",
  projectOps: "projects",
  createdChats: "chats",
  reports: "reports",
  actionIds: "actions",
};

const IMPACT_KEYS = Object.keys(EVENT_IMPACT_LABELS);

const GM_PREVIEW_SECTIONED_IMPACTS = [
  "regionTransfers", "regionClaims", "regionControlOps", "polityChanges", "politicalActorOps",
  "unitOps", "markerOps", "createdChats", "groupOps", "institutionLifecycleOps",
];

const MAP_FEATURE_STATUS_META = {
  planned: "Planned",
  under_construction: "Under construction",
  active: "Active",
  damaged: "Damaged",
  inactive: "Inactive",
  abandoned: "Abandoned",
  destroyed: "Destroyed",
};

const GROUP_PALETTE = ["#e11d48", "#f97316", "#eab308", "#65a30d", "#10b981", "#06b6d4", "#3b82f6", "#ec4899", "#dc2626", "#0ea5e9"];
const GROUP_NAME_MAX = 80;
const GROUP_DESCRIPTION_MAX = 1200;
const MAX_GROUPS = 64;
const NPC_REACTION_GRACE_MS = 12000;
const IMPORTANCE_WEIGHT = { critical: 3, high: 2, major: 2 };
const PUPPET_KIND_LABELS = { protectorate: "protectorate", satellite: "puppet state", client: "client state" };

const text = (value) => String(value ?? "").trim();
const cleanEventText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const tidyProse = (value) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();
const capitalize = (value) => String(value ?? "").replace(/^./, (first) => first.toUpperCase());
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hexToRgb = (hex) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const rgbToHex = (rgb) => (Array.isArray(rgb) && rgb.length === 3
  ? `#${rgb.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`
  : "#888888");

const cleanEditorNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number * 1000) / 1000);
};

const editorNumber = (value, { min = -Infinity, max = Infinity, label = "Value" } = {}) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  if (number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return number;
};

const INDEX_FIELDS = [
  ["sovereignty", "Sovereignty"],
  ["foodAutonomy", "Food autonomy"],
  ["energyAutonomy", "Energy autonomy"],
  ["economicIndependence", "Economic independence"],
  ["internalSecurity", "Internal security"],
  ["internationalReputation", "International reputation"],
];

const SECTOR_FIELDS = [
  ["agriculture", "Agriculture share"],
  ["industry", "Industry share"],
  ["services", "Services share"],
];

const changedEditorFields = (form = {}, loaded = {}) => {
  const keys = new Set([...Object.keys(form ?? {}), ...Object.keys(loaded ?? {})]);
  return new Set([...keys].filter((key) => String(form?.[key] ?? "") !== String(loaded?.[key] ?? "")));
};

const countryStatPatchFromForm = ({ form = {}, changed = new Set() } = {}) => {
  const number = (key, bounds) => (changed.has(key) ? editorNumber(form[key], bounds) : null);
  const field = (key) => (changed.has(key) ? String(form[key] ?? "").trim() : "");
  const populationM = number("populationM", { min: 0.001, max: 20000, label: "Population (millions)" });
  const gdpB = number("gdpB", { min: 0.001, max: 1000000, label: "GDP (billions)" });
  const stability = number("stability", { min: 0, max: 100, label: "Stability" });
  const economy = {};
  const gdpGrowth = number("gdpGrowth", { min: -1000, max: 1000, label: "GDP growth" });
  const inflation = number("inflation", { min: -1000, max: 1000, label: "Inflation" });
  const unemployment = number("unemployment", { min: 0, max: 100, label: "Unemployment" });
  const publicDebt = number("publicDebt", { min: 0, max: 1000, label: "Public debt" });
  const budgetBalance = number("budgetBalance", { min: -1000, max: 1000, label: "Budget balance" });
  if (gdpB != null) economy.gdp = Math.round(gdpB * 1e9);
  if (gdpGrowth != null) economy.gdpGrowth = gdpGrowth;
  if (inflation != null) economy.inflation = inflation;
  if (unemployment != null) economy.unemployment = unemployment;
  if (publicDebt != null) economy.publicDebt = publicDebt;
  if (budgetBalance != null) economy.budgetBalance = budgetBalance;
  if (field("currency")) economy.currency = field("currency");
  const indices = {};
  for (const [key, label] of INDEX_FIELDS) {
    const value = number(key, { min: 0, max: 100, label });
    if (value != null) indices[key] = value;
  }
  let gdpBreakdown = null;
  if (SECTOR_FIELDS.some(([key]) => changed.has(key))) {
    const shares = SECTOR_FIELDS.map(([key, label]) => editorNumber(form[key], { min: 0, max: 100, label }));
    if (shares.some((value) => value != null)) {
      if (shares.some((value) => value == null)) throw new Error("Set all three GDP-sector shares together.");
      gdpBreakdown = { agriculture: shares[0], industry: shares[1], services: shares[2] };
    }
  }
  const patch = {
    ...(field("capital") ? { capital: field("capital") } : {}),
    ...(field("continent") ? { continent: field("continent") } : {}),
    ...(stability == null ? {} : { stability }),
    ...(Object.keys(indices).length ? { indices } : {}),
    ...(populationM == null ? {} : { population: { total: Math.round(populationM * 1e6) } }),
    ...(Object.keys(economy).length ? { economy } : {}),
    ...(gdpBreakdown ? { gdpBreakdown } : {}),
  };
  return Object.keys(patch).length ? patch : null;
};

const normalizeGroupColor = (value) => {
  const raw = cleanEventText(value).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) return `#${[...raw.slice(1)].map((digit) => digit + digit).join("")}`;
  return "";
};
const fold = (value) => cleanEventText(value).toLocaleLowerCase();
const defaultGroupColor = (name) => {
  let hash = 0;
  for (const char of fold(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return GROUP_PALETTE[hash % GROUP_PALETTE.length];
};
const normalizeGroupName = (value) => cleanEventText(value).slice(0, GROUP_NAME_MAX).trim();
const normalizeGroupDescription = (value) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, GROUP_DESCRIPTION_MAX).trim();
const findGroupKey = (groups, name) => {
  const registry = isRecord(groups) ? groups : {};
  const wanted = fold(name);
  if (!wanted) return "";
  if (isRecord(registry[cleanEventText(name)])) return cleanEventText(name);
  const keys = Object.keys(registry);
  return keys.find((key) => fold(key) === wanted)
    ?? keys.find((key) => (registry[key]?.formerNames ?? []).some((former) => fold(former) === wanted))
    ?? "";
};
const groupRegions = (groupAreas) => {
  const byGroup = {};
  for (const [regionId, name] of Object.entries(isRecord(groupAreas) ? groupAreas : {})) (byGroup[name] ??= []).push(regionId);
  return byGroup;
};

const isOfferableEvent = (event) => {
  if (!event || typeof event !== "object") return false;
  if (event.playerRelated !== true) return false;
  if (!text(event.id) || !text(event.title) || !text(event.description)) return false;
  if (["fallback", "espionage"].includes(text(event.source))) return false;
  if (text(event.kind) === "interactive") return false;
  return Boolean(IMPORTANCE_WEIGHT[text(event.importance).toLowerCase()]) || event.notable === true;
};

const POPULATION_SERIES_KEYS = ["populationByYear", "population_by_year", "populations", "populationHistory", "population_history"];
const hasPopulationByYear = (properties) => {
  const props = isRecord(properties) ? properties : {};
  const usable = (year, value) => {
    const y = Number(year);
    const p = Number(value);
    return Number.isInteger(y) && y !== 0 && Math.abs(y) <= 100000 && Number.isFinite(p) && p > 0;
  };
  for (const key of POPULATION_SERIES_KEYS) {
    let value = props[key];
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        value = null;
      }
    }
    if (Array.isArray(value)) {
      if (value.some((row) => (Array.isArray(row) ? usable(row[0], row[1]) : isRecord(row) && usable(row.year ?? row.y, row.population ?? row.pop ?? row.value)))) return true;
    } else if (isRecord(value) && Object.entries(value).some(([year, population]) => usable(year, population))) {
      return true;
    }
  }
  return Object.entries(props).some(([key, value]) => {
    const match = /^pop(?:ulation)?[\s_-]?(\d{3,4})$/i.exec(key);
    return Boolean(match) && usable(match[1], value);
  });
};

const isSceneInProgress = (interactive) => Boolean(interactive && typeof interactive === "object")
  && (interactive.origin === "player" || (Array.isArray(interactive.history) ? interactive.history : []).length > 0);

const eventRowIdentity = (event) => [cleanEventText(event?.id), cleanEventText(event?.createdAt)].join("\u001f");
const sameJson = (left, right) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};
const locateEventRow = (events, shown, index = -1) => {
  const rows = Array.isArray(events) ? events : [];
  const key = eventRowIdentity(shown);
  const matches = [];
  rows.forEach((event, at) => { if (eventRowIdentity(event) === key) matches.push(at); });
  if (matches.length === 0) return -1;
  const atShownIndex = matches.includes(index);
  if (atShownIndex && sameJson(rows[index], shown)) return index;
  return matches.find((at) => sameJson(rows[at], shown)) ?? (atShownIndex ? index : matches[0]);
};
const applyEventRowChange = (events, change = {}) => {
  const rows = Array.isArray(events) ? events : [];
  if (change.add) return [...rows, change.add];
  const at = locateEventRow(rows, change.shown, change.index);
  if (at < 0) return null;
  if (change.remove) return rows.filter((_, index) => index !== at);
  if (typeof change.update === "function") return rows.map((event, index) => (index === at ? change.update(event) : event));
  return rows;
};

const manualEventId = () => {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `event-manual-${uuid}`;
  } catch {
    return `event-manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return `event-manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
};

const annexationImpacts = (world, regions, owner, note = "Annexed by hand in the Cheats panel") => {
  const to = text(owner);
  const sovereignty = isRecord(world?.regionSovereigntyOverrides) ? world.regionSovereigntyOverrides : {};
  const regionTransfers = [];
  const regionControlOps = [];
  if (!to) return { regionTransfers, regionControlOps };
  for (const region of Array.isArray(regions) ? regions : []) {
    const regionId = text(region?.id);
    const regionName = text(region?.name);
    const from = text(region?.from);
    if (!regionId || from === to) continue;
    regionTransfers.push({ regionId, regionName, fromCode: from, toCode: to, note });
    const sovereign = text(sovereignty[regionId]);
    if (from && sovereign && sovereign !== from) {
      regionControlOps.push(
        { op: "control", regionId, regionName, fromCode: from, toCode: to, note },
        { op: "clear_contest", regionId, regionName, fromCode: to, claimantCode: from, clearAll: false, note },
      );
    }
  }
  return { regionTransfers, regionControlOps };
};

const polityNameInUse = (world, name, mapPolities = []) => {
  const wanted = text(name);
  if (!wanted) return false;
  const is = (value) => text(value) === wanted;
  const valuesOf = (record) => (isRecord(record) ? Object.values(record) : []);
  const overrides = isRecord(world?.polityOverrides) ? world.polityOverrides : {};
  if (Object.keys(overrides).some(is) || valuesOf(overrides).some((polity) => is(polity?.name) || is(polity?.code))) return true;
  if ((Array.isArray(world?.ownerCodes) ? world.ownerCodes : []).some(is)) return true;
  if (valuesOf(world?.regionOwnershipOverrides).some(is)) return true;
  if (valuesOf(world?.regionSovereigntyOverrides).some(is)) return true;
  if (valuesOf(world?.regionClaimants).some((entries) => Array.isArray(entries) && entries.some(is))) return true;
  return (Array.isArray(mapPolities) ? mapPolities : []).some((polity) => is(polity?.code) || is(polity?.name));
};

export const register = (ctx) => {
  const { engine, api, plain, clean, list, addStandIn, standIn } = ctx;
  const gs = engine.gameState;
  const assets = engine.assets;
  const URLS = engine.JSON_URLS;
  const readJson = engine.readJson;

  const gameDates = engine.gameDates ?? {};
  const parseDate = (value) => {
    const match = /^([+-]?)(\d{1,6})-(\d{1,2})-(\d{1,2})/.exec(text(value));
    if (!match) return null;
    const year = (match[1] === "-" ? -1 : 1) * Number(match[2]);
    return { year, month: Number(match[3]), day: Number(match[4]) };
  };
  const isGameDate = (value) => (typeof gameDates.isGameDate === "function" ? gameDates.isGameDate(value) : parseDate(value) !== null);
  const compareGameDates = (a, b) => {
    if (typeof gameDates.compareGameDates === "function") return gameDates.compareGameDates(a, b);
    const left = parseDate(a);
    const right = parseDate(b);
    if (left && right) {
      const l = left.year * 10000 + left.month * 100 + left.day;
      const r = right.year * 10000 + right.month * 100 + right.day;
      return l === r ? 0 : l < r ? -1 : 1;
    }
    if (left) return -1;
    if (right) return 1;
    return text(a).localeCompare(text(b));
  };
  const readable = (value, pattern = "D MMMM YYYY") => {
    if (typeof gameDates.formatGameDateReadable === "function") return gameDates.formatGameDateReadable(value, pattern);
    const parts = parseDate(value);
    if (!parts) return "";
    const year = parts.year < 0 ? `${-parts.year} BC` : String(parts.year);
    const day = parts.day;
    const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
    return pattern === "MMMM Do, YYYY" ? `${MONTHS[parts.month - 1]} ${day}${suffix}, ${year}` : `${day} ${MONTHS[parts.month - 1]} ${year}`;
  };

  let countryNames = null;
  const loadCountryNameTable = async () => {
    if (!countryNames) {
      const catalog = await api("/api/library").catch(() => null);
      countryNames = catalog?.countryNames ?? {};
    }
    return countryNames;
  };

  const readGame = () => gs.readGameData({ force: true });
  const readWorld = () => gs.readWorldState({ force: true });

  const noteGmChange = async (kind, summary, step = null) => {
    try {
      const [world, game] = await Promise.all([readWorld(), readGame()]);
      await gs.writeWorldState(engine.gmChanges.recordGmChange(world, {
        kind,
        summary,
        round: Number(game?.round) || 0,
        date: String(game?.gameDate || game?.startDate || ""),
        ...(step || {}),
      }));
    } catch (error) {
      console.warn("[cheats] the change was made, but the note for the next time skip was not:", error);
    }
  };

  const loadPolities = async () => {
    const world = await gs.readWorldState({ force: false });
    const overrides = world.regionOwnershipOverrides ?? {};
    const polityOverrides = world.polityOverrides ?? {};
    const names = await loadCountryNameTable();
    const nameByCode = new Map();
    for (const entry of (await assets.loadCountryNames().catch(() => [])) ?? []) {
      if (entry?.code) nameByCode.set(String(entry.code), entry.name || String(entry.code));
    }
    for (const [code, polity] of Object.entries(polityOverrides)) {
      if (code && polity?.name) nameByCode.set(String(code), polity.name);
    }
    const owners = new Set();
    for (const code of Object.keys(polityOverrides)) if (code) owners.add(String(code));
    for (const owner of Object.values(overrides)) if (owner) owners.add(String(owner));
    for (const code of world.ownerCodes ?? []) if (code) owners.add(String(code));
    for (const region of await assets.loadRegionCatalog().catch(() => [])) {
      const code = region.countryCode ? String(region.countryCode) : "";
      const owner = overrides[region.id] ?? region.country ?? names[code] ?? code;
      if (owner) owners.add(String(owner));
    }
    const polities = Array.from(owners)
      .filter((code) => code && code.toLowerCase() !== "unclaimed")
      .map((code) => ({ code, name: nameByCode.get(code) || code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { polities, world };
  };

  const regionOwnerNow = async (region, overrides = {}) => {
    const id = text(region?.id);
    const override = id && isRecord(overrides) ? overrides[id] : undefined;
    if (override != null) return text(override);
    const code = text(region?.countryCode);
    const names = await loadCountryNameTable();
    return text(region?.country) || text(names[code]) || code;
  };

  const regionsHeldBy = async (catalog, overrides = {}, source = "") => {
    const owner = text(source);
    if (!owner) return [];
    const held = new Map();
    for (const region of Array.isArray(catalog) ? catalog : []) {
      const id = text(region?.id);
      if (id && (await regionOwnerNow(region, overrides)) === owner) held.set(id, { id, name: text(region?.name) || id });
    }
    for (const [id, code] of Object.entries(isRecord(overrides) ? overrides : {})) {
      if (text(code) === owner && !held.has(id)) held.set(id, { id, name: id });
    }
    return [...held.values()];
  };

  const adminEvent = (game, idPrefix, title, description, impacts) => ({
    id: `${idPrefix}-${Date.now().toString(36)}`,
    date: game?.gameDate || game?.startDate || "",
    title,
    description,
    importance: "minor",
    kind: "world",
    notable: false,
    playerRelated: false,
    impacts,
    source: "manual-admin",
  });

  const annexByHand = (world, impacts, game) => gs.applyEventImpactsToWorld({
    world,
    round: game?.round || 0,
    events: [adminEvent(game, "admin-annex", "Cheats annexation", "Structured administrative annexation from the Cheats panel.", impacts)],
  }).world;

  const transferWholeCountry = async (source, owner, game) => {
    const world = await readWorld();
    const held = await regionsHeldBy(await assets.loadRegionCatalog(), { ...world.regionOwnershipOverrides }, source);
    if (held.length === 0) return 0;
    await gs.writeWorldState(annexByHand(world, annexationImpacts(world, held.map((region) => ({ ...region, from: source })), owner), game));
    return held.length;
  };

  let regionFile = { url: "", features: [] };
  const regionFeatures = async () => {
    const url = URLS.regionsGeojson || "/api/runtime/json/regionsGeojson";
    if (regionFile.url === url && regionFile.features.length) return regionFile.features;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The map's regions could not be read (${response.status}).`);
    const parsed = await response.json();
    regionFile = { url, features: list(parsed?.features) };
    return regionFile.features;
  };
  const featureIdOf = (feature) => clean(feature?.id ?? feature?.properties?.id ?? feature?.properties?.GID_1);

  const regionAt = async ({ index = -1, id = "" } = {}) => {
    const features = await regionFeatures();
    let feature = null;
    if (Number(index) >= 0) feature = features[Number(index)] ?? null;
    if (!feature && clean(id)) feature = features.find((entry) => featureIdOf(entry) === clean(id)) ?? null;
    if (!feature) return null;
    const props = feature.properties ?? {};
    const regionId = featureIdOf(feature);
    const world = await readWorld();
    const overrides = world.regionOwnershipOverrides ?? {};
    const baseOwner = clean(props.owner ?? props.COUNTRY);
    const gid0 = clean(props.gid0 ?? props.GID_0);
    const names = await loadCountryNameTable();
    const owner = Object.prototype.hasOwnProperty.call(overrides, regionId) ? clean(overrides[regionId]) : (baseOwner || clean(names[gid0]) || gid0);
    return { id: regionId, name: clean(props.name ?? props.NAME_1) || regionId, owner, baseOwner, baseGid0: gid0 };
  };

  const groupsOn = () => {
    const library = engine.getLibraryState?.() ?? {};
    const gameFlag = library?.activeGame?.features?.groups?.enabled;
    if (typeof gameFlag === "boolean") return gameFlag;
    const scenarioFlag = library?.runtimeScenario?.features?.groups?.enabled;
    if (typeof scenarioFlag === "boolean") return scenarioFlag;
    return true;
  };

  const gameView = (game) => ({
    country: clean(game?.country),
    round: Number(game?.round) || 0,
    gameDate: clean(game?.gameDate),
    startDate: clean(game?.startDate),
    difficulty: engine.difficulty?.normalizeDifficulty ? engine.difficulty.normalizeDifficulty(game?.difficulty) : clean(game?.difficulty) || "medium",
  });

  const collectImpactOps = (events, field) => list(events).flatMap((event, eventIndex) =>
    list(event?.impacts?.[field]).map((op, opIndex) => ({
      ...op,
      _eventIndex: eventIndex,
      _eventTitle: event?.title || `Event ${eventIndex}`,
      _opIndex: opIndex,
    })));
  const impactKeys = () => (Array.isArray(gs.EVENT_IMPACT_KEYS) ? gs.EVENT_IMPACT_KEYS : IMPACT_KEYS);
  const otherImpactFamilies = (events) => impactKeys()
    .filter((field) => !GM_PREVIEW_SECTIONED_IMPACTS.includes(field) && field !== "actionIds")
    .map((field) => ({ field, ops: collectImpactOps(events, field) }))
    .filter((family) => family.ops.length > 0);
  const compactJson = (value) => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value ?? "");
    }
  };
  const statusLabel = (value) => MAP_FEATURE_STATUS_META[String(value ?? "").trim().toLowerCase()] || MAP_FEATURE_STATUS_META.active;
  const ownFields = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith("_")));

  const describePreview = (preview, applied = null) => {
    const transaction = preview?.transaction ?? {};
    const events = list(transaction.events);
    const statPatches = list(transaction.countryStatPatches);
    const storylineUpdates = list(transaction.storylineUpdates);
    const warUpdates = list(transaction.warUpdates);
    const relationUpdates = list(transaction.relationUpdates);
    const agreementUpdates = list(transaction.agreementUpdates);
    const puppetUpdates = list(transaction.puppetUpdates);
    const outreach = list(transaction.diplomaticOutreach);
    const ops = (field) => collectImpactOps(events, field);
    const transferOps = ops("regionTransfers");
    const claimOps = ops("regionClaims");
    const controlOps = ops("regionControlOps");
    const polityOps = ops("polityChanges");
    const politicalOps = ops("politicalActorOps");
    const unitOps = ops("unitOps");
    const markerOps = ops("markerOps");
    const eventChats = ops("createdChats");
    const groupOps = ops("groupOps");
    const institutionOps = ops("institutionLifecycleOps");
    const projectOps = ops("projectOps");
    const otherFamilies = otherImpactFamilies(events);
    const otherCount = otherFamilies.reduce((sum, family) => sum + family.ops.length, 0) - projectOps.length;
    const chips = [
      ["events", events.length],
      ["territory", transferOps.length + claimOps.length],
      ["control", controlOps.length],
      ["groups", groupOps.length],
      ["polities", polityOps.length],
      ["politics", politicalOps.length],
      ["institutions", institutionOps.length],
      ["stats", statPatches.length],
      ["storylines", storylineUpdates.length],
      ["units", unitOps.length],
      ["markers", markerOps.length],
      ["projects", projectOps.length],
      ["wars", warUpdates.length],
      ["relations", relationUpdates.length],
      ["agreements", agreementUpdates.length],
      ["subordinations", puppetUpdates.length],
      ["chats", eventChats.length + outreach.length],
      ...(otherCount > 0 ? [["other", otherCount]] : []),
    ];
    const ref = (entry) => `event ${entry._eventIndex}`;
    const sections = [];
    const row = (strong, rest = "", entryRef = "", lines = []) => ({ strong, rest, ref: entryRef, lines: lines.filter((line) => line && line.text) });
    if (transferOps.length || claimOps.length || controlOps.length) {
      sections.push({
        id: "territory-sovereignty",
        title: "Territory · legal sovereignty",
        count: transferOps.length,
        note: transferOps.length ? "legal owner changes" : "unchanged",
        collapse: true,
        none: transferOps.length ? "" : "NONE · legal sovereignty remains with the current sovereigns.",
        noneTone: "green",
        rows: transferOps.map((entry) => row(
          entry.regionName || entry.regionId || "Unknown region",
          ` · ${entry.fromCode || "unclaimed"} → ${entry.toCode || "unclaimed"}${entry.wholeCountry ? " · whole country" : ""}`,
          ref(entry),
          [{ text: entry.note || "", tone: "note" }],
        )),
      });
      sections.push({
        id: "territory-control",
        title: "Territory · de-facto control / contest",
        count: controlOps.length,
        note: "does not change legal sovereignty",
        collapse: true,
        none: controlOps.length ? "" : "NONE",
        rows: controlOps.map((entry) => {
          let detail = entry.op || "operation";
          if (entry.op === "contest") detail = `CONTEST · current controller ${entry.fromCode || "unknown"} · challenger ${entry.actorCode || "unknown"}`;
          if (entry.op === "control") detail = `CONTROL · ${entry.fromCode || "unknown"} → ${entry.toCode || "unknown"}`;
          if (entry.op === "clear_contest") detail = `CLEAR CONTEST · controller ${entry.fromCode || "unknown"}${entry.clearAll ? " · all claimants" : ` · claimant ${entry.claimantCode || "unknown"}`}`;
          return row(entry.regionName || entry.regionId || "Unknown region", ` · ${detail}`, ref(entry), [{ text: entry.note || "", tone: "note" }]);
        }),
      });
      sections.push({
        id: "territory-claims",
        title: "Territory · claims",
        count: claimOps.length,
        note: "does not move the border",
        collapse: true,
        none: claimOps.length ? "" : "NONE",
        rows: claimOps.map((entry) => row(
          entry.regionName || entry.regionId || "Unknown region",
          ` · ${entry.drop ? "CLAIM WITHDRAWN" : "CLAIMED"} by ${entry.claimantCode || "unknown"}`,
          ref(entry),
          [{ text: entry.note || "", tone: "note" }],
        )),
      });
    }
    if (polityOps.length) {
      sections.push({
        id: "polities",
        title: "Polities",
        count: polityOps.length,
        note: "",
        rows: polityOps.map((entry) => {
          const stableIdentity = entry.code || entry.name || "Unknown polity";
          const displayName = String(entry.name || "").trim();
          const distinct = displayName && displayName.toLocaleLowerCase() !== String(stableIdentity).trim().toLocaleLowerCase();
          const details = Object.fromEntries(Object.entries(entry).filter(([key, value]) =>
            !key.startsWith("_") && !["operation", "code", "name"].includes(key) && value !== "" && value !== undefined && value !== null));
          return row(
            `${String(entry.operation || "update").toUpperCase()} · ${stableIdentity}${distinct ? ` → ${displayName}` : ""}`,
            "",
            ref(entry),
            [
              distinct ? { text: `Stable identity: ${stableIdentity} · current/display name: ${displayName}`, tone: "blue" } : null,
              Object.keys(details).length ? { text: compactJson(details), tone: "detail" } : null,
            ].filter(Boolean),
          );
        }),
      });
    }
    if (politicalOps.length) {
      sections.push({
        id: "politics",
        title: "Political World",
        count: politicalOps.length,
        note: "exact political changes",
        rows: politicalOps.map((entry) => {
          let args = entry.argsJson;
          try {
            args = JSON.parse(entry.argsJson);
          } catch {
            args = entry.argsJson;
          }
          return row(`${String(entry.op || "update").toUpperCase()} · ${entry.polityKey || entry.polity || entry.country || "Unknown polity"}`, "", ref(entry), [{ text: compactJson(args), tone: "detail" }]);
        }),
      });
    }
    if (statPatches.length) {
      sections.push({
        id: "stats",
        title: "Authoritative Stats baselines",
        count: statPatches.length,
        note: "",
        rows: statPatches.map((entry) => row(
          String(entry.country ?? ""),
          ` · ${compactJson(entry.patch)}`,
          list(entry.eventIndexes).length ? `events ${entry.eventIndexes.join(", ")}` : "",
          [{ text: entry.reason || "", tone: "note" }],
        )),
      });
    }
    if (unitOps.length) {
      sections.push({
        id: "units",
        title: "Military units",
        count: unitOps.length,
        note: "",
        rows: unitOps.map((entry) => {
          let detail = compactJson(ownFields(entry));
          if (entry.op === "spawn") detail = `SPAWN · ${entry.unit?.name || "unnamed"} · ${entry.unit?.ownerCode || "unknown owner"} · ${entry.unit?.type || "unit"} · strength ${entry.unit?.strength ?? "?"} · ${entry.unit?.regionId || `${entry.unit?.lat ?? "?"}, ${entry.unit?.lng ?? "?"}`}`;
          if (entry.op === "move") detail = `MOVE · ${entry.unitId || "unknown unit"} → ${entry.regionId || `${entry.toLat ?? "?"}, ${entry.toLng ?? "?"}`}`;
          if (entry.op === "attack") detail = `ATTACK · ${entry.unitId || "unknown unit"} → ${entry.targetUnitId || "unknown target"}`;
          if (entry.op === "strength") detail = `STRENGTH · ${entry.unitId || "unknown unit"} → ${entry.strength ?? "?"}`;
          if (entry.op === "remove") detail = `REMOVE · ${entry.unitId || "unknown unit"}`;
          return row(detail, "", ref(entry), [{ text: entry.note || "", tone: "note" }]);
        }),
      });
    }
    if (markerOps.length) {
      sections.push({
        id: "markers",
        title: "Map features",
        count: markerOps.length,
        note: "",
        rows: markerOps.map((entry) => {
          const patch = isRecord(entry?.changes) ? entry.changes : entry;
          const displayName = entry.name || entry.marker?.name || "unnamed feature";
          let detail = `${String(entry.op || "operation").toUpperCase()} · ${displayName}`;
          if (entry.markerId) detail += ` · id ${entry.markerId}`;
          if (entry.op === "build") detail += ` · ${entry.marker?.kind || "feature"} · owner ${entry.marker?.ownerCode || "none"} · status ${statusLabel(entry.marker?.status)} · ${entry.marker?.lat ?? "?"}, ${entry.marker?.lng ?? "?"}`;
          if (entry.op === "update") {
            const changes = [];
            if (patch.status) changes.push(`status → ${statusLabel(patch.status)}`);
            if (patch.kind) changes.push(`type → ${patch.kind}`);
            if (Object.prototype.hasOwnProperty.call(patch, "ownerCode")) changes.push(`owner → ${patch.ownerCode || "none"}`);
            if (Number.isFinite(Number(patch.lat)) && Number.isFinite(Number(patch.lng))) changes.push(`location → ${Number(patch.lat).toFixed(2)}, ${Number(patch.lng).toFixed(2)}`);
            if (patch.foundedAt) changes.push(`founded → ${patch.foundedAt}`);
            if (changes.length) detail += ` · ${changes.join(" · ")}`;
          }
          if (entry.op === "rename") detail += ` → ${entry.newName || "unnamed"}`;
          return row(detail, "", ref(entry), [{ text: patch.note || entry.marker?.note || "", tone: "note" }]);
        }),
      });
    }
    if (groupOps.length) {
      sections.push({
        id: "groups",
        title: "Groups",
        count: groupOps.length,
        note: "world.groups",
        rows: groupOps.map((entry) => {
          const regions = list(entry.regionIds);
          return row(
            `${String(entry.op || "update").toUpperCase()} · ${entry.name || "Unnamed group"}${entry.newName ? ` → ${entry.newName}` : ""}`,
            "",
            ref(entry),
            [
              regions.length ? { text: `Regions: ${regions.join(", ")}`, tone: "plain" } : null,
              entry.description ? { text: entry.description, tone: "detail" } : null,
              entry.note ? { text: entry.note, tone: "note" } : null,
            ].filter(Boolean),
          );
        }),
      });
    }
    if (institutionOps.length) {
      sections.push({
        id: "institutions",
        title: "Institutions",
        count: institutionOps.length,
        note: "world.institutions",
        rows: institutionOps.map((entry) => row(
          `${String(entry.op || "update").toUpperCase()} · ${entry.name || entry.institutionId || "Unknown institution"}`,
          "",
          ref(entry),
          [
            { text: entry.targetPolity ? `Actor: ${entry.actorPolity || "—"} · Target: ${entry.targetPolity}` : `Actor: ${entry.actorPolity || "—"}`, tone: "plain" },
            { text: entry.reason || entry.terms || "", tone: "note" },
          ],
        )),
      });
    }
    for (const { field, ops: familyOps } of otherFamilies) {
      sections.push({
        id: `other-${field}`,
        title: "Other operations",
        count: familyOps.length,
        note: field,
        rows: familyOps.map((entry) => row(String(entry.op || entry.operation || "operation").toUpperCase(), "", ref(entry), [{ text: compactJson(ownFields(entry)), tone: "detail" }])),
      });
    }
    if (storylineUpdates.length) {
      sections.push({
        id: "storylines",
        title: "Persistent storylines",
        count: storylineUpdates.length,
        note: "world.storylines",
        rows: storylineUpdates.map((entry) => row(
          `${String(entry.status || "active").toUpperCase()} · ${entry.id || "unnamed-storyline"}`,
          ` · pressure ${Number.isFinite(Number(entry.pressure)) ? Number(entry.pressure) : "—"} · momentum ${Number.isFinite(Number(entry.momentum)) ? Number(entry.momentum) : "—"}`,
          "",
          [
            entry.title ? { text: entry.title, tone: "plain" } : null,
            { text: `Participants: ${list(entry.participants).join(", ") || "—"} · Events: ${list(entry.eventIndexes).join(", ") || "—"}${entry.startedDate ? ` · Started: ${entry.startedDate}` : ""}`, tone: "note" },
            entry.state ? { text: entry.state, tone: "detail" } : null,
          ].filter(Boolean),
        )),
      });
    }
    if (warUpdates.length) {
      sections.push({
        id: "wars",
        title: "Wars",
        count: warUpdates.length,
        note: "world.wars",
        rows: warUpdates.map((entry) => row(`${String(entry.op || "update").toUpperCase()} · ${entry.id}`, "", "", [
          { text: `Actors: ${list(entry.actors).join(", ") || "—"}${list(entry.opponents).length ? ` · Opponents: ${entry.opponents.join(", ")}` : ""}`, tone: "plain" },
          { text: `Events: ${list(entry.eventIndexes).join(", ") || "—"}${entry.note ? ` · ${entry.note}` : ""}`, tone: "note" },
        ])),
      });
    }
    if (relationUpdates.length) {
      sections.push({
        id: "relations",
        title: "Relations",
        count: relationUpdates.length,
        note: "world.relations",
        rows: relationUpdates.map((entry) => row(`${entry.a} ↔ ${entry.b}`, ` · ${entry.score} · ${entry.status}`, "", [
          { text: `Events: ${list(entry.eventIndexes).join(", ") || "—"}${entry.summary ? ` · ${entry.summary}` : ""}`, tone: "note" },
        ])),
      });
    }
    if (agreementUpdates.length) {
      sections.push({
        id: "agreements",
        title: "Agreements",
        count: agreementUpdates.length,
        note: "world.agreements",
        rows: agreementUpdates.map((entry) => row(`${String(entry.op || "update").toUpperCase()} · ${entry.id}`, ` · ${entry.type}`, "", [
          { text: `Parties: ${list(entry.parties).join(", ") || "—"}${entry.title ? ` · ${entry.title}` : ""}`, tone: "plain" },
          { text: `Events: ${list(entry.eventIndexes).join(", ") || "—"}${entry.terms ? ` · ${entry.terms}` : ""}`, tone: "note" },
        ])),
      });
    }
    if (puppetUpdates.length) {
      sections.push({
        id: "subordinations",
        title: "Subordinations",
        count: puppetUpdates.length,
        note: "world.puppets",
        rows: puppetUpdates.map((entry) => row(`${String(entry.op || "update").toUpperCase()} · ${entry.overlord || "Unknown overlord"} → ${entry.puppet || "Unknown puppet"}`, "", "", [
          { text: `Kind: ${entry.kind || "—"} · Secrecy: ${entry.secrecy || "—"} · Loyalty: ${Number.isFinite(Number(entry.loyalty)) ? Number(entry.loyalty) : "—"}`, tone: "plain" },
          { text: `Events: ${list(entry.eventIndexes).join(", ") || "—"}${entry.note ? ` · ${entry.note}` : ""}`, tone: "note" },
        ])),
      });
    }
    if (eventChats.length || outreach.length) {
      const participants = (entry) => list(entry.countries).map((country) => country?.name || country).filter(Boolean).join(", ") || "—";
      sections.push({
        id: "chats",
        title: "Diplomatic chats",
        count: eventChats.length + outreach.length,
        note: "",
        rows: [
          ...eventChats.map((entry) => row(`EVENT CHAT · ${entry.title || "Untitled"}`, ` · speaker ${entry.speaker || "unknown"}`, "", [
            { text: `Participants: ${participants(entry)}`, tone: "plain" },
            { text: entry.openingMessage || "", tone: "note" },
            { text: ref(entry), tone: "faint" },
          ])),
          ...outreach.map((entry) => row(`OUTREACH · ${entry.title || "Untitled"}`, ` · speaker ${entry.speaker || "unknown"}`, "", [
            { text: `Participants: ${participants(entry)}`, tone: "plain" },
            { text: entry.openingMessage || "", tone: "note" },
          ])),
        ],
      });
    }
    return {
      id: preview?.id || "",
      summary: preview?.summary || "",
      date: preview?.date || "",
      mode: preview?.mode || "",
      source: preview?.generation?.source || "unknown",
      applied: Boolean(applied?.applied),
      transactionId: applied?.transactionId || "",
      chips,
      events: events.map((event, index) => ({
        heading: `EVENT ${index} · ${event.date || "undated"}`,
        badges: [
          String(event.importance || "minor").toUpperCase(),
          String(event.kind || "world").toUpperCase(),
          ...(event.notable ? ["NOTABLE"] : []),
          ...(event.playerRelated ? ["PLAYER-RELATED"] : []),
          ...(event.warId ? [`WAR · ${event.warId}`] : []),
        ],
        title: String(event.title ?? ""),
        description: String(event.description ?? ""),
        combatants: list(event.combatants).length ? `Combatants: ${event.combatants.join(" · ")}` : "",
      })),
      sections,
    };
  };

  const previews = new Map();
  const standInState = { date: "", country: "" };

  if (standIn && typeof addStandIn === "function") {
    addStandIn(({ tool, text: prompt }) => {
      if (tool !== "submit_game_master") return null;
      const mode = /Generate a (direct|exact-event|world-intervention) GM transaction preview/.exec(prompt)?.[1] || "world-intervention";
      const date = standInState.date;
      const country = standInState.country || "France";
      const event = {
        date,
        title: `${country} opens a national library annex`,
        description: `${country} opens a new annex of its national library in its capital, adding reading rooms and a public archive.`,
        importance: "minor",
        kind: "world",
        notable: false,
        playerRelated: true,
        impacts: {
          markerOps: [{
            op: "build",
            marker: { name: `${country} National Library Annex`, kind: "landmark", ownerCode: country, status: "active", lat: 48.8336, lng: 2.3755, note: "Opened by the Game Master." },
          }],
        },
      };
      return {
        args: {
          mode,
          summary: `Adds one event: ${country} opens a national library annex.`,
          eventsJson: JSON.stringify([event]),
          territorialScopesJson: "[]",
          countryStatPatchesJson: "[]",
          storylineUpdatesJson: "[]",
          warUpdatesJson: "[]",
          relationUpdatesJson: "[]",
          agreementUpdatesJson: "[]",
          puppetUpdatesJson: "[]",
          diplomaticOutreachJson: "[]",
          requestedSubordination: false,
          requestedDate: "",
          requestedOngoingProcess: false,
        },
      };
    });
  }

  const featureData = async () => {
    const [world, geojson] = await Promise.all([
      readWorld(),
      readJson(URLS.citiesGeojson, { defaultValue: { type: "FeatureCollection", features: [] }, force: true }).catch(() => ({ features: [] })),
    ]);
    return {
      customCities: Boolean(world?.customCities),
      markers: list(world?.markers),
      cities: list(geojson?.features),
    };
  };

  const saveScenarioCities = async (features) => {
    const cityNames = (entries) => new Set(list(entries).map((feature) => String(feature?.properties?.name ?? "").trim()).filter(Boolean));
    const before = cityNames((await readJson(URLS.citiesGeojson, { defaultValue: { features: [] }, force: true }).catch(() => ({ features: [] })))?.features);
    await assets.writeJson(URLS.citiesGeojson, { type: "FeatureCollection", features }, { pretty: true });
    const after = cityNames(features);
    const added = [...after].filter((name) => !before.has(name));
    const removed = [...before].filter((name) => !after.has(name));
    const listed = (names) => `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`;
    const parts = [
      added.length ? `added the cit${added.length === 1 ? "y" : "ies"} ${listed(added)}` : "",
      removed.length ? `removed the cit${removed.length === 1 ? "y" : "ies"} ${listed(removed)}` : "",
    ].filter(Boolean);
    await noteGmChange("feature", parts.length ? `${capitalize(parts.join("; "))} on the map by hand.` : "Edited the details of the map's cities by hand.");
  };

  const describeAdminMarkerOps = (markerOps) => {
    const ops = list(markerOps);
    const named = (op) => String(op?.name ?? op?.markerId ?? "a feature").trim();
    const group = (verb, entries) => {
      if (!entries.length) return "";
      const names = entries.map(named);
      return `${verb} ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`;
    };
    const byOp = (kind) => ops.filter((op) => String(op?.op ?? "").toLowerCase() === kind);
    const parts = [
      group("placed", byOp("add").concat(byOp("create"))),
      group("changed", byOp("update")),
      group("removed", byOp("remove").concat(byOp("delete"))),
    ].filter(Boolean);
    return parts.length ? `${capitalize(parts.join("; "))} on the map by hand.` : "Edited the map's features by hand.";
  };

  const applyAdminMarkerOps = async (markerOps) => {
    const [world, game] = await Promise.all([readWorld(), readGame()]);
    const result = gs.applyEventImpactsToWorld({
      world,
      game,
      events: [adminEvent(game, "admin-map-feature", "Map Feature Editor administrative change", "Structured administrative mutation from the Map Feature Editor.", { markerOps })],
    });
    await gs.writeWorldState(result.world);
    await noteGmChange("feature", describeAdminMarkerOps(markerOps));
  };

  const historyStatus = (bundle) => {
    const world = gs.normalizeWorldState(bundle?.world);
    const events = gs.normalizeEvents(bundle?.events);
    const last = list(world.consolidatedHistory).at(-1);
    let unconsolidated = events;
    if (last?.throughEventId) {
      const boundary = events.findIndex((event) => event.id === last.throughEventId);
      if (boundary >= 0) unconsolidated = events.slice(boundary + 1);
      else if (text(last.throughDate)) unconsolidated = events.filter((event) => !event.date || compareGameDates(event.date, text(last.throughDate)) > 0);
    }
    const sizeThreshold = 48;
    const intervalRounds = 5;
    const retainEvents = 24;
    const documentWordBudget = 1500;
    const round = Number(bundle?.game?.round) || 0;
    const priorChatIds = new Set(list(world.consolidatedHistory).flatMap((entry) => list(entry.chatIds)));
    const closedChats = gs.normalizeChats(bundle?.chats).filter((chat) => chat.status === "closed" && !priorChatIds.has(chat.id));
    const canFold = (unconsolidated.length > retainEvents) || closedChats.length > 0;
    const passes = list(world.consolidatedHistory).length;
    const since = unconsolidated.length;
    const words = (value) => {
      const normalized = text(value);
      return normalized ? normalized.split(/\s+/).length : 0;
    };
    const documentWords = words(world.historyDocument?.text);
    const documentText = world.historyDocument
      ? `The history document is ${documentWords} words of a ${documentWordBudget}-word budget (revision ${world.historyDocument.revision}, ${world.historyDocument.source === "manual" ? "last edited by hand" : "last written by the AI"}${world.historyDocument.throughDate ? `, through ${world.historyDocument.throughDate}` : ""}).`
      : passes > 0
        ? `No history document yet: the AI is shown the ${passes} pass ${passes === 1 ? "summary" : "summaries"} below until the next pass writes the document.`
        : "No history document yet: nothing has been folded.";
    return {
      text: `${since} event${since === 1 ? "" : "s"} since the last pass. A turn folds them by itself once more than ${sizeThreshold} have piled up, or on every ${intervalRounds}th round once more than ${retainEvents} have; the newest ${retainEvents} always stay in full. ${documentText}`,
      canFoldNow: canFold,
      round,
    };
  };

  const historyDocument = async () => {
    const [world, events, chats, actions, game] = await Promise.all([
      readWorld(),
      gs.readEventsState({ force: true }),
      readJson(URLS.chat, { defaultValue: [], force: true }).catch(() => []),
      readJson(URLS.actions, { defaultValue: [], force: true }).catch(() => []),
      readGame(),
    ]);
    const status = historyStatus({ world, events, chats, actions, game });
    return {
      document: world?.historyDocument ?? null,
      passes: list(world?.consolidatedHistory).map((entry, index) => ({
        meta: [
          `Pass ${index + 1}`,
          entry?.throughRound ? `through round ${entry.throughRound}` : "",
          entry?.throughDate ? `to ${entry.throughDate}` : "",
          list(entry?.chatIds).length ? `${entry.chatIds.length} chat${entry.chatIds.length === 1 ? "" : "s"}` : "",
          list(entry?.actionIds).length ? `${entry.actionIds.length} order${entry.actionIds.length === 1 ? "" : "s"}` : "",
          entry?.source === "fallback" ? "written without the AI" : "",
        ].filter(Boolean).join(" · "),
        summary: String(entry?.summary ?? ""),
      })),
      status,
      totalEvents: list(events).length,
    };
  };

  const eventsCache = { list: [] };

  const syncManualEventTimelineHistory = (worldInput, eventsInput, game) => {
    const world = isRecord(worldInput) ? { ...worldInput } : {};
    const isManualEvent = (event) => {
      const source = cleanEventText(event?.source).toLowerCase();
      const id = cleanEventText(event?.id).toLowerCase();
      return source === "manual" || id.startsWith("event-manual-");
    };
    const isManualRecord = (entry) => cleanEventText(entry?.source).toLowerCase() === "manual" || cleanEventText(entry?.mode).toLowerCase() === "manual-event";
    const isGameMasterRecord = (entry) => cleanEventText(entry?.source).toLowerCase() === "gm-console" || cleanEventText(entry?.mode).toLowerCase() === "game-master";
    const entryDate = (entry) => cleanEventText(entry?.toDate || entry?.date || entry?.fromDate);
    const covers = (entry, date) => {
      const wanted = cleanEventText(date);
      if (!wanted) return false;
      const from = cleanEventText(entry?.fromDate || entry?.date || entry?.toDate);
      const to = cleanEventText(entry?.toDate || entry?.date || entry?.fromDate);
      if (isGameDate(wanted) && isGameDate(from) && isGameDate(to)) {
        const [low, high] = compareGameDates(from, to) <= 0 ? [from, to] : [to, from];
        return compareGameDates(wanted, low) >= 0 && compareGameDates(wanted, high) <= 0;
      }
      return wanted === cleanEventText(entry?.date) || wanted === to || wanted === from;
    };
    const manualEvents = list(eventsInput).filter((event) => isManualEvent(event) && cleanEventText(event?.id) && cleanEventText(event?.date));
    const manualIds = new Set(manualEvents.map((event) => cleanEventText(event.id)));
    const knownIds = new Set(list(eventsInput).map((event) => cleanEventText(event?.id)).filter(Boolean));
    const original = list(world.simulationHistory);
    const priorRecord = new Map();
    for (const entry of original) {
      if (!isManualRecord(entry) || !Array.isArray(entry?.eventIds)) continue;
      for (const id of entry.eventIds) if (!priorRecord.has(cleanEventText(id))) priorRecord.set(cleanEventText(id), entry);
    }
    const history = original
      .map((entry) => ({
        ...entry,
        eventIds: list(entry?.eventIds).filter((id) => {
          const normalizedId = cleanEventText(id);
          if (manualIds.has(normalizedId)) return false;
          if (normalizedId.toLowerCase().startsWith("event-manual-") && !knownIds.has(normalizedId)) return false;
          return true;
        }),
      }))
      .filter((entry) => entry.eventIds.length > 0 || !(isManualRecord(entry) || isGameMasterRecord(entry)));
    const ordered = [...manualEvents].sort((a, b) => compareGameDates(cleanEventText(a.date), cleanEventText(b.date)));
    for (const event of ordered) {
      const eventId = cleanEventText(event.id);
      const date = cleanEventText(event.date);
      const targetIndex = history.findIndex((entry) => covers(entry, date));
      if (targetIndex >= 0) {
        const ids = history[targetIndex].eventIds;
        if (!ids.some((id) => cleanEventText(id) === eventId)) history[targetIndex] = { ...history[targetIndex], eventIds: [...ids, eventId] };
        continue;
      }
      const prior = priorRecord.get(eventId);
      const record = {
        date,
        eventIds: [eventId],
        fallbackReason: "",
        fromDate: date,
        mode: "manual-event",
        plannedActions: [],
        round: Number.isFinite(Number(prior?.round)) ? Number(prior.round) : Math.max(0, Math.trunc(Number(game?.round) || 0)),
        source: "manual",
        summary: `Manual exact event: ${cleanEventText(event?.title) || "Untitled event"}`,
        toDate: date,
      };
      let insertAt = history.findIndex((entry) => {
        const at = entryDate(entry);
        return isGameDate(date) && isGameDate(at) && compareGameDates(date, at) > 0;
      });
      if (insertAt < 0) insertAt = history.length;
      history.splice(insertAt, 0, record);
    }
    const changed = JSON.stringify(history) !== JSON.stringify(original);
    return changed ? { changed: true, world: { ...world, simulationHistory: history } } : { changed: false, world };
  };

  const syncVisibleTimeline = async (eventList) => {
    const [world, game] = await Promise.all([readWorld(), readGame()]);
    const synced = syncManualEventTimelineHistory(world, eventList, game);
    if (synced.changed) await gs.writeWorldState(synced.world);
    return synced.changed;
  };

  const sortEventsChronologically = (events) => events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftDate = cleanEventText(left.event?.date);
      const rightDate = cleanEventText(right.event?.date);
      if (leftDate && rightDate && leftDate !== rightDate) return compareGameDates(leftDate, rightDate);
      if (leftDate && !rightDate) return -1;
      if (!leftDate && rightDate) return 1;
      const leftCreated = cleanEventText(left.event?.createdAt);
      const rightCreated = cleanEventText(right.event?.createdAt);
      if (leftCreated && rightCreated && leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated);
      return left.index - right.index;
    })
    .map(({ event }) => event);

  const persistEvents = async (change) => {
    if (engine.simulationStatus?.isSimulationBusy?.()) throw new Error("A turn is being generated; wait for it to finish.");
    const fresh = list(await gs.readEventsState({ force: true }));
    const next = applyEventRowChange(fresh, change);
    if (!next) {
      eventsCache.list = fresh;
      throw new Error("That event is no longer in the record. The list has been refreshed.");
    }
    const ordered = sortEventsChronologically(next);
    await gs.writeEventsState(ordered);
    const persisted = list(await gs.readEventsState({ force: true }));
    const result = persisted.length ? persisted : ordered;
    await syncVisibleTimeline(result);
    eventsCache.list = result;
    return result;
  };

  const syncReactionQueueForEvent = async (event, enabled, { restart = false } = {}) => {
    const world = await readWorld();
    const queue = list(world?.pendingEventOutreach);
    const key = eventRowIdentity(event);
    const queueKey = (entry) => [cleanEventText(entry?.sourceEventId), cleanEventText(entry?.sourceEventCreatedAt)].join("\u001f");
    const existingIndex = queue.findIndex((entry) => queueKey(entry) === key);
    let nextQueue = queue;
    if (!enabled || event?.npcReaction?.evaluatedAt) {
      if (existingIndex >= 0) nextQueue = queue.filter((_, index) => index !== existingIndex);
    } else if (existingIndex < 0) {
      nextQueue = [...queue, {
        id: `event-outreach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceEventId: cleanEventText(event.id),
        sourceEventCreatedAt: cleanEventText(event.createdAt),
        queuedAt: new Date().toISOString(),
        deliverAfter: new Date(Date.now() + NPC_REACTION_GRACE_MS).toISOString(),
        attempts: 0,
        lastError: "",
      }];
    } else if (restart) {
      nextQueue = queue.map((entry, index) => (index === existingIndex
        ? { ...entry, queuedAt: new Date().toISOString(), deliverAfter: new Date(Date.now() + NPC_REACTION_GRACE_MS).toISOString(), attempts: 0, lastError: "" }
        : entry));
    }
    if (JSON.stringify(nextQueue) !== JSON.stringify(queue)) {
      await gs.writeWorldState({ ...world, pendingEventOutreach: nextQueue });
      try {
        globalThis.dispatchEvent?.(new CustomEvent("oh:event-outreach-queue-changed"));
      } catch {
        return nextQueue;
      }
    }
    return nextQueue;
  };

  const sourceGroup = (event) => {
    const source = cleanEventText(event?.source).toLowerCase();
    if (source.includes("manual") || source.includes("gm")) return "manual";
    if (source === "scenario") return "scenario";
    return "campaign";
  };

  const impactSummary = (event) => {
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    const populated = impactKeys().map((key) => [key, Array.isArray(impacts[key]) ? impacts[key].length : 0]).filter(([, count]) => count > 0);
    return {
      count: populated.reduce((sum, [, value]) => sum + value, 0),
      text: populated.map(([key, value]) => `${EVENT_IMPACT_LABELS[key] || key} ${value}`).join(" · "),
    };
  };

  const eventRows = async ({ search = "", filter = "all", sort = "newest", limit = 80 } = {}) => {
    const events = eventsCache.list;
    const world = await readWorld();
    const queue = list(world?.pendingEventOutreach);
    const now = Date.now();
    const queueKey = (entry) => [cleanEventText(entry?.sourceEventId), cleanEventText(entry?.sourceEventCreatedAt)].join("\u001f");
    const q = text(search).toLowerCase();
    const indexed = events.map((event, sourceIndex) => ({ event, sourceIndex }));
    const filtered = indexed.filter(({ event }) => {
      if (filter === "campaign" && sourceGroup(event) !== "campaign") return false;
      if (filter === "manual" && sourceGroup(event) !== "manual") return false;
      if (filter === "notable" && !event?.notable) return false;
      if (filter === "player" && !event?.playerRelated) return false;
      if (!q) return true;
      const haystack = [
        event?.date, event?.title, event?.description, event?.quote?.text, event?.quote?.speaker, event?.quote?.role,
        event?.importance, event?.kind, event?.source, ...list(event?.combatants),
      ].map((value) => cleanEventText(value)).join(" ").toLowerCase();
      return haystack.includes(q);
    }).sort((a, b) => {
      const dateCompare = compareGameDates(cleanEventText(a.event?.date), cleanEventText(b.event?.date));
      const createdCompare = cleanEventText(a.event?.createdAt).localeCompare(cleanEventText(b.event?.createdAt));
      const result = dateCompare || createdCompare || (a.sourceIndex - b.sourceIndex);
      return sort === "oldest" ? result : -result;
    });
    const importance = new Set(["minor", "major"]);
    const kinds = new Set(["world", "player", "diplomacy", "military", "economic", "domestic"]);
    for (const event of events) {
      if (cleanEventText(event?.importance)) importance.add(cleanEventText(event.importance));
      if (cleanEventText(event?.kind)) kinds.add(cleanEventText(event.kind));
    }
    return {
      counts: {
        total: events.length,
        campaign: events.filter((event) => sourceGroup(event) === "campaign").length,
        manual: events.filter((event) => sourceGroup(event) === "manual").length,
        notable: events.filter((event) => event?.notable).length,
      },
      matches: filtered.length,
      importanceOptions: [...importance],
      kindOptions: [...kinds],
      currentDate: cleanEventText((await readGame())?.gameDate),
      anyPending: queue.length > 0,
      rows: filtered.slice(0, Math.max(0, Number(limit) || 80)).map(({ event, sourceIndex }) => {
        const pending = queue.find((entry) => queueKey(entry) === eventRowIdentity(event)) ?? null;
        const pendingMs = pending ? Math.max(0, Date.parse(cleanEventText(pending.deliverAfter)) - now) : 0;
        const impact = impactSummary(event);
        return {
          index: sourceIndex,
          id: cleanEventText(event?.id),
          date: String(event?.date ?? ""),
          title: String(event?.title ?? ""),
          description: String(event?.description ?? ""),
          quoteText: String(event?.quote?.text ?? ""),
          quoteSpeaker: String(event?.quote?.speaker ?? ""),
          quoteRole: String(event?.quote?.role ?? ""),
          importance: String(event?.importance ?? ""),
          kind: cleanEventText(event?.kind),
          notable: Boolean(event?.notable),
          playerRelated: Boolean(event?.playerRelated),
          npcEnabled: Boolean(event?.npcReaction?.enabled),
          source: cleanEventText(event?.source) || "scenario",
          manual: sourceGroup(event) === "manual",
          major: cleanEventText(event?.importance).toLowerCase() === "major",
          impactCount: impact.count,
          impactText: impact.text,
          pending: Boolean(pending),
          pendingSeconds: pending ? Math.max(0, Math.ceil(pendingMs / 1000)) : 0,
          pendingAttempts: Math.max(0, Math.trunc(Number(pending?.attempts) || 0)),
          pendingError: cleanEventText(pending?.lastError),
          reactionResult: cleanEventText(event?.npcReaction?.result).toLowerCase(),
          failedAttempts: Math.max(0, Math.trunc(Number(event?.npcReaction?.attempts) || 0)),
          failedError: cleanEventText(event?.npcReaction?.lastError),
        };
      }),
    };
  };

  const eventQuoteFromForm = (form) => {
    const quoteText = cleanEventText(form?.quoteText);
    if (!quoteText) return null;
    const speaker = cleanEventText(form?.quoteSpeaker);
    const role = cleanEventText(form?.quoteRole);
    return { text: quoteText, ...(speaker ? { speaker } : {}), ...(role ? { role } : {}) };
  };

  const regionState = async (id) => {
    const located = await regionAt({ id });
    if (!located) throw new Error("That map click did not resolve to a region id.");
    const world = await readWorld();
    const ownership = world?.regionOwnershipOverrides ?? {};
    const sovereignty = world?.regionSovereigntyOverrides ?? {};
    const claims = world?.regionClaimants ?? {};
    const names = await loadCountryNameTable();
    const baseOwner = located.baseOwner || clean(names[located.baseGid0]) || located.baseGid0;
    const currentOwner = Object.prototype.hasOwnProperty.call(ownership, located.id) ? clean(ownership[located.id]) : baseOwner;
    const currentSovereign = Object.prototype.hasOwnProperty.call(sovereignty, located.id) ? clean(sovereignty[located.id]) : currentOwner;
    const raw = claims[located.id];
    const claimants = [...new Set((Array.isArray(raw) ? raw : isRecord(raw) ? Object.keys(raw).filter((key) => raw[key]) : [])
      .map((value) => clean(value)).filter((value) => value && value !== currentOwner))];
    const normalized = gs.normalizeWorldState(world);
    const groups = normalized.groups ?? {};
    const group = (normalized.groupAreas ?? {})[located.id] ?? "";
    return {
      id: located.id,
      name: located.name,
      baseGid0: located.baseGid0,
      baseOwner,
      controller: currentOwner,
      sovereign: currentSovereign,
      claimants,
      group,
      groups: Object.keys(groups).map((name) => ({ name, color: groups[name]?.color || defaultGroupColor(name) })),
      canRename: true,
    };
  };

  const methods = {
    "cheats.home": async () => {
      const [{ polities }, game] = await Promise.all([loadPolities(), readGame()]);
      return { polities, game: gameView(game), groupsOn: groupsOn() };
    },

    "cheats.region.at": async ({ index = -1 } = {}) => regionAt({ index }),

    "cheats.gm.preview": async ({ text: requestText = "", mode = "world-intervention" } = {}) => {
      const game = await readGame();
      standInState.date = clean(game?.gameDate || game?.startDate);
      standInState.country = clean(game?.country);
      const preview = await engine.gameplay.previewGameMasterCommand(clean(requestText), { mode });
      previews.set(preview.id, preview);
      return { view: describePreview(preview), summary: clean(preview?.summary) };
    },

    "cheats.gm.apply": async ({ id }) => {
      const preview = previews.get(clean(id));
      if (!preview) throw new Error("This GM preview is missing its transaction identity. Generate a fresh preview.");
      const result = await engine.gameplay.applyGameMasterPreview(preview);
      return { view: describePreview(preview, { applied: true, transactionId: result?.transactionId || preview.id }), summary: clean(result?.summary), transactionId: clean(result?.transactionId) };
    },

    "cheats.reminders.get": async () => {
      const [world, game] = await Promise.all([readWorld(), readGame()]);
      const round = Number(game?.round) || 0;
      const g = engine.gmChanges;
      return {
        limit: g.REMINDERS_LIMIT,
        maxChars: g.REMINDER_MAX_CHARS,
        reminders: g.normalizeReminders(world?.simulationReminders).map((entry) => ({
          id: entry.id,
          text: entry.text,
          meta: `${entry.date ? `since ${readable(entry.date)}` : ""}${entry.round ? ` · round ${entry.round}` : ""}`,
        })),
        pending: g.gmChangesForRound(world, round).map((entry) => ({ kind: g.gmChangeKindLabel(entry.kind), summary: entry.summary })),
      };
    },

    "cheats.reminders.add": async ({ text: reminder = "" }) => {
      const value = String(reminder ?? "").trim();
      if (!value) throw new Error("Write the reminder first.");
      const [current, game] = await Promise.all([readWorld(), readGame()]);
      const g = engine.gmChanges;
      if (g.normalizeReminders(current.simulationReminders).length >= g.REMINDERS_LIMIT) {
        throw new Error(`There can be ${g.REMINDERS_LIMIT} reminders at once. Withdraw one that no longer holds first.`);
      }
      await gs.writeWorldState(g.addReminder(current, { text: value, round: Number(game?.round) || 0, date: String(game?.gameDate || game?.startDate || "") }));
      return "Reminder issued. Every AI in the game is told it from its next call.";
    },

    "cheats.reminders.edit": async ({ id, text: reminder = "" }) => {
      const value = String(reminder ?? "").trim();
      if (!value) throw new Error("A reminder cannot be empty — withdraw it instead.");
      const current = await readWorld();
      await gs.writeWorldState(engine.gmChanges.editReminder(current, id, value));
      return "Reminder updated. The next call is told the new wording.";
    },

    "cheats.reminders.remove": async ({ id }) => {
      const [current, game] = await Promise.all([readWorld(), readGame()]);
      await gs.writeWorldState(engine.gmChanges.removeReminder(current, id, { round: Number(game?.round) || 0, date: String(game?.gameDate || game?.startDate || "") }));
      return "Reminder withdrawn. The next time skip is told it no longer holds.";
    },

    "cheats.rollback.list": async () => {
      const [snapshots, game] = await Promise.all([
        readJson(URLS.snapshots, { defaultValue: [], clone: false }).catch(() => []),
        readJson(URLS.game, { force: true }).catch(() => null),
      ]);
      const points = engine.turnCommit.restorePointsFor(list(snapshots), { round: game ? game.round || 1 : undefined });
      return { points: points.map((snap) => ({ id: clean(snap?.id), round: Number(snap?.round) || 0, fromDate: clean(snap?.fromDate) })) };
    },

    "cheats.rollback.apply": async ({ id }) => {
      const [snapshots, game] = await Promise.all([
        readJson(URLS.snapshots, { defaultValue: [], force: true, clone: false }).catch(() => []),
        readJson(URLS.game, { force: true }).catch(() => null),
      ]);
      const points = engine.turnCommit.restorePointsFor(list(snapshots), { round: game ? game.round || 1 : undefined });
      const index = points.findIndex((snap) => clean(snap?.id) === clean(id));
      if (index < 0) throw new Error("That restore point is gone. Open the tool again.");
      const snap = points[index];
      const s = snap.state ?? {};
      await Promise.all([
        assets.writeJson(URLS.game, s.game ?? {}, { pretty: true }),
        assets.writeJson(URLS.world, s.world ?? {}, { pretty: true }),
        assets.writeJson(URLS.events, s.events ?? [], { pretty: true }),
        assets.writeJson(URLS.actions, s.actions ?? [], { pretty: true }),
        assets.writeJson(URLS.chat, s.chat ?? [], { pretty: true }),
        assets.writeJson(URLS.colors, s.colors ?? {}, { pretty: true }),
      ]);
      const remaining = points.slice(index + 1);
      await assets.writeJson(URLS.snapshots, remaining);
      const dateLabel = snap.fromDate ? String(snap.fromDate) : "";
      await noteGmChange("rollback", `Rolled the world back to the start of round ${snap.round}${dateLabel ? ` (${dateLabel})` : ""}: the ${index === 0 ? "turn" : `${index + 1} turns`} after it never happened.`);
      return { message: `Rolled back to Round ${snap.round}. The map, date and panels catch up within a few seconds.`, points: remaining.map((entry) => ({ id: clean(entry?.id), round: Number(entry?.round) || 0, fromDate: clean(entry?.fromDate) })) };
    },

    "cheats.country.play": async ({ code, name = "", previousName = "" }) => {
      const current = await readGame();
      await gs.writeGameData({ ...current, country: code });
      await noteGmChange("polity", `The player now leads ${name || code}${current?.country ? ` instead of ${previousName || current.country}` : ""}.`);
      return `You now lead ${name || code}.`;
    },

    "cheats.difficulty.levels": async () => ({
      levels: list(engine.DIFFICULTY_LEVELS).map((level) => plain({
        id: level.id, label: level.label, emoji: level.emoji, blurb: level.blurb, description: level.description,
        profile: level.profile ?? {}, effects: list(level.effects),
      })),
    }),

    "cheats.difficulty.set": async ({ id }) => {
      const level = list(engine.DIFFICULTY_LEVELS).find((entry) => entry.id === id);
      if (!level) throw new Error(`Unknown difficulty: ${id}`);
      const nextGame = await readGame();
      await gs.writeGameData({ ...nextGame, difficulty: level.id });
      return `Difficulty set to ${level.label} ${level.emoji}. Future simulation and diplomatic bargaining use this rigor; GM/admin edits remain exact.`;
    },

    "cheats.annex.country": async ({ source, owner, sourceName = "", ownerName = "" }) => {
      if (!source || source === owner) return { moved: 0, message: "" };
      const game = await readGame();
      const count = await transferWholeCountry(source, owner, game);
      if (count === 0) return { moved: 0, message: `Failed: no regions of ${sourceName || source} were found on the map, so nothing was annexed.` };
      await noteGmChange("territory", `Annexed the whole of ${sourceName || source} into ${ownerName || owner} by hand (${count} regions).`);
      return { moved: count, message: `${sourceName || source} annexed into ${ownerName || owner} (${count} regions). The map updates within a few seconds.` };
    },

    "cheats.annex.region": async ({ index = -1, owner, ownerName = "" }) => {
      const region = await regionAt({ index });
      if (!region) return { message: "" };
      const [world, game] = await Promise.all([readWorld(), readGame()]);
      const overrides = { ...world.regionOwnershipOverrides };
      const from = await regionOwnerNow({ id: region.id, country: region.baseOwner, countryCode: region.baseGid0 }, overrides);
      if (from !== owner) {
        await gs.writeWorldState(annexByHand(world, annexationImpacts(world, [{ id: region.id, name: region.name, from }], owner), game));
        await noteGmChange("territory", "", { group: `regions→${owner}`, template: `Moved {items} to ${ownerName || owner} by hand.`, item: region.name });
      }
      return { message: `${region.name} → ${ownerName || owner}. Keep clicking, or press Done.` };
    },

    "cheats.add_country": async ({ name = "", color = "" }) => {
      const code = String(name ?? "").trim();
      const colorHex = String(color ?? "").trim();
      if (!code) throw new Error("Give the country a name.");
      const { polities: mapPolities } = await loadPolities();
      const world = await readWorld();
      if (polityNameInUse(world, code, mapPolities)) throw new Error(`${code} already exists. Use the Country Editor to change it.`);
      const nextOverride = { code, name: code, ...(hexToRgb(colorHex) ? { color: colorHex.startsWith("#") ? colorHex : `#${colorHex}` } : null) };
      await gs.writeWorldState({ ...world, polityOverrides: { ...world.polityOverrides, [code]: nextOverride } });
      const rgb = hexToRgb(colorHex);
      if (rgb) {
        const colors = await readJson(URLS.colors, { defaultValue: {}, force: true });
        await assets.writeJson(URLS.colors, { ...colors, [code]: rgb }, { pretty: true });
      }
      await noteGmChange("polity", `Created the polity ${nextOverride.name} by hand; it holds no land until it is given some.`);
      return `${nextOverride.name} created. Use Annex Country or Annex Regions to give it territory.`;
    },

    "cheats.country.load": async ({ code, fallbackName = "" }) => {
      const [world, colors] = await Promise.all([readWorld(), readJson(URLS.colors, { defaultValue: {}, force: true }).catch(() => ({}))]);
      const polity = world?.polityOverrides?.[code] ?? {};
      const sheet = world?.countryStats?.[code] ?? null;
      const rgb = colors?.[code];
      const population = Number(sheet?.population?.total);
      const gdp = Number(sheet?.economy?.gdp);
      const perCapita = Number(sheet?.economy?.gdpPerCapita);
      const value = (entry) => (entry === undefined || entry === null ? "" : String(entry));
      const form = {
        name: polity.name || fallbackName || code,
        color: polity.color || (Array.isArray(rgb) ? rgbToHex(rgb) : ""),
        capital: value(sheet?.capital),
        continent: value(sheet?.continent),
        government: value(sheet?.government),
        leader: value(sheet?.leader),
        populationM: Number.isFinite(population) ? cleanEditorNumber(population / 1e6) : "",
        gdpB: Number.isFinite(gdp) ? cleanEditorNumber(gdp / 1e9) : "",
        gdpGrowth: value(sheet?.economy?.gdpGrowth),
        inflation: value(sheet?.economy?.inflation),
        unemployment: value(sheet?.economy?.unemployment),
        publicDebt: value(sheet?.economy?.publicDebt),
        budgetBalance: value(sheet?.economy?.budgetBalance),
        currency: value(sheet?.economy?.currency),
        stability: value(sheet?.stability),
        sovereignty: value(sheet?.indices?.sovereignty),
        foodAutonomy: value(sheet?.indices?.foodAutonomy),
        energyAutonomy: value(sheet?.indices?.energyAutonomy),
        economicIndependence: value(sheet?.indices?.economicIndependence),
        internalSecurity: value(sheet?.indices?.internalSecurity),
        internationalReputation: value(sheet?.indices?.internationalReputation),
        agriculture: value(sheet?.gdpBreakdown?.agriculture),
        industry: value(sheet?.gdpBreakdown?.industry),
        services: value(sheet?.gdpBreakdown?.services),
      };
      return {
        form,
        componentCount: Array.isArray(sheet?.territorialComponents) ? sheet.territorialComponents.length : 0,
        perCapita: Number.isFinite(perCapita) ? perCapita : null,
        politicalExists: Boolean(world?.politicalActors?.[code]),
      };
    },

    "cheats.country.save": async ({ code, form = {}, baseline = {}, componentCount = 0, fallbackName = "" }) => {
      if (!code) throw new Error("Pick a country first.");
      const world = await readWorld();
      const existing = world.polityOverrides?.[code] ?? {};
      const changed = changedEditorFields(form, baseline);
      const requestedName = changed.has("name") ? String(form.name ?? "").trim() : "";
      const colorHex = changed.has("color") ? String(form.color ?? "").trim() : "";
      const nextName = requestedName || existing.name || fallbackName || code;
      const aliases = [...new Set([...list(existing.aliases), code, existing.name, nextName].map((value) => String(value ?? "").trim()).filter(Boolean))];
      world.polityOverrides = {
        ...(world.polityOverrides || {}),
        [code]: { ...existing, aliases, code, name: nextName, ...(hexToRgb(colorHex) ? { color: colorHex.startsWith("#") ? colorHex : `#${colorHex}` } : {}) },
      };
      const previousName = String(existing.name || fallbackName || code).trim();
      const sheetBefore = world.countryStats?.[code] ?? null;
      const headlineBefore = {
        leader: String(sheetBefore?.leader ?? "").trim(),
        government: String(sheetBefore?.government ?? "").trim(),
        capital: String(sheetBefore?.capital ?? "").trim(),
        stability: Number.isFinite(Number(sheetBefore?.stability)) ? Number(sheetBefore.stability) : null,
      };
      const hasComponentBaseline = Number(componentCount) > 0;
      let nextSheet = world.countryStats?.[code] ?? null;
      const patch = hasComponentBaseline ? countryStatPatchFromForm({ form, changed }) : null;
      if (patch) {
        nextSheet = gs.applyCountryStatPatchToWorld(world, code, patch);
        const reputation = Number(nextSheet?.indices?.internationalReputation);
        if (Number.isFinite(reputation)) {
          world.internationalReputation = { ...(world.internationalReputation || {}), [code]: Math.max(0, Math.min(100, Math.round(reputation))) };
        }
      }
      await gs.writeWorldState(world);
      const rgb = hexToRgb(colorHex);
      if (rgb) {
        const colors = await readJson(URLS.colors, { defaultValue: {}, force: true });
        await assets.writeJson(URLS.colors, { ...colors, [code]: rgb }, { pretty: true });
      }
      const edits = [
        previousName && previousName !== nextName ? `renamed it from ${previousName}` : "",
        ...["leader", "government", "capital"].map((key) => {
          const after = String(nextSheet?.[key] ?? "").trim();
          return after && after !== headlineBefore[key] ? `${key}: ${after}` : "";
        }),
        Number.isFinite(Number(nextSheet?.stability)) && Number(nextSheet.stability) !== headlineBefore.stability
          ? `stability ${headlineBefore.stability ?? "unset"} → ${Number(nextSheet.stability)}`
          : "",
      ].filter(Boolean);
      await noteGmChange(hasComponentBaseline ? "stats" : "polity", `Edited ${nextName} in the country editor${edits.length ? `: ${edits.join("; ")}` : ""}.`);
      return hasComponentBaseline
        ? `${nextName} updated. These values are the current baseline; future simulation can change them naturally.`
        : `${nextName} identity updated. Generate a Stats baseline before editing national statistics.`;
    },

    "cheats.regions.inspect": async ({ index = -1, id = "" } = {}) => {
      const located = id ? { id } : await regionAt({ index });
      if (!located) throw new Error("That map click did not resolve to a region id.");
      return regionState(located.id);
    },

    "cheats.regions.apply": async ({ id, action, target = "", names = {} }) => {
      const state = await regionState(id);
      const nameOf = (code) => names?.[code] || code || "unclaimed land";
      const regionName = state.name || "";
      let impacts = {};
      let message = "";
      if (action === "controller") {
        impacts = { regionControlOps: [{ op: "control", regionId: state.id, regionName, fromCode: state.controller, toCode: target, note: "Authoritative Region Inspector control edit" }] };
        message = `Controller → ${nameOf(target)}.`;
      } else if (action === "restore") {
        impacts = { regionControlOps: [
          { op: "control", regionId: state.id, regionName, fromCode: state.controller, toCode: state.sovereign, note: "Region Inspector restores legal sovereign control" },
          { op: "clear_contest", regionId: state.id, regionName, fromCode: state.sovereign, claimantCode: state.controller, clearAll: false, note: "Remove displaced foreign controller after restoration" },
        ] };
        message = `Control restored to sovereign ${nameOf(state.sovereign)}.`;
      } else if (action === "sovereign") {
        impacts = { regionTransfers: [{ regionId: state.id, regionName, fromCode: state.sovereign, toCode: target, note: "Authoritative Region Inspector sovereignty transfer" }] };
        message = `Legal sovereignty → ${nameOf(target)}.`;
      } else if (action === "claim") {
        impacts = { regionClaims: [{ regionId: state.id, regionName, claimantCode: target, note: "Region Inspector asserts a claim" }] };
        message = `${nameOf(target)} now claims the region.`;
      } else if (action === "withdraw") {
        impacts = { regionClaims: [{ regionId: state.id, regionName, claimantCode: target, drop: true, note: "Region Inspector withdraws a claim" }] };
        message = `${nameOf(target)}'s claim withdrawn.`;
      } else if (action === "withdraw-all") {
        impacts = { regionClaims: state.claimants.map((claimant) => ({ regionId: state.id, regionName, claimantCode: claimant, drop: true, note: "Region Inspector clears all claims" })) };
        message = "All claims withdrawn.";
      } else if (action === "group-release") {
        impacts = { groupOps: [{ op: "release", name: state.group, regionIds: [state.id], note: "Region Inspector ends a group's control" }] };
        message = `${state.group} no longer controls the region.`;
      } else if (action === "group-take") {
        impacts = { groupOps: [{ op: "take", name: target, regionIds: [state.id], note: "Region Inspector sets a group's control" }] };
        message = `${target} now controls the region.`;
      } else {
        throw new Error(`Unknown region edit: ${action}`);
      }
      const [world, game] = await Promise.all([readWorld(), readGame()]);
      const result = gs.applyEventImpactsToWorld({
        world,
        round: game?.round || 0,
        events: [adminEvent(game, "admin-region", "Region Inspector administrative change", "Structured administrative mutation from the Region Inspector.", impacts)],
      });
      await gs.writeWorldState(result.world);
      const region = String(regionName || state.id || "a region");
      const was = (code) => (code ? ` (was ${nameOf(code)})` : "");
      const edits = [
        ...list(impacts.regionControlOps).filter((op) => op.op === "control").map((op) => `${region} is now held by ${nameOf(op.toCode)}${was(op.fromCode)}`),
        ...list(impacts.regionTransfers).map((op) => `${region} now belongs legally to ${nameOf(op.toCode)}${was(op.fromCode)}`),
        ...list(impacts.regionClaims).map((op) => `${nameOf(op.claimantCode)} ${op.drop ? "no longer claims" : "now claims"} ${region}`),
        ...list(impacts.groupOps).map((op) => `${op.name} ${op.op === "release" ? "no longer controls" : "now controls"} ${region}`),
      ];
      if (edits.length) await noteGmChange("territory", `${edits.join("; ")} — set by hand.`);
      return { message, state: await regionState(state.id) };
    },

    "cheats.regions.rename": async ({ id, name }) => {
      const geojson = await readJson(URLS.regionsGeojson, { defaultValue: null, force: true });
      const feature = list(geojson?.features).find((entry) => featureIdOf(entry) === clean(id));
      if (!feature) throw new Error("The editable region geometry disappeared; pick the region again.");
      const formerName = String(feature.properties?.name ?? "").trim();
      feature.properties = { ...(feature.properties ?? {}), name: String(name).trim() };
      await assets.writeJson(URLS.regionsGeojson, geojson, { pretty: true });
      regionFile = { url: "", features: [] };
      if (formerName && formerName !== String(name).trim()) await noteGmChange("territory", `Renamed the region ${formerName} to ${String(name).trim()} by hand; it is the same place.`);
      return { message: `Region name → ${String(name).trim()}.`, state: await regionState(id) };
    },

    "cheats.groups.get": async () => {
      const world = gs.normalizeWorldState(await readWorld());
      const groups = world.groups ?? {};
      const areas = groupRegions(world.groupAreas ?? {});
      const catalog = await assets.loadRegionCatalog().catch(() => []);
      const regionNames = new Map(list(catalog).map((region) => [String(region.id), region.name]));
      for (const feature of await regionFeatures().catch(() => [])) {
        const id = featureIdOf(feature);
        if (id && !regionNames.has(id)) regionNames.set(id, clean(feature?.properties?.name) || id);
      }
      return {
        palette: GROUP_PALETTE,
        nameMax: GROUP_NAME_MAX,
        descriptionMax: GROUP_DESCRIPTION_MAX,
        groups: Object.keys(groups).map((name) => {
          const area = areas[name] ?? [];
          return {
            name,
            description: groups[name]?.description ?? "",
            color: groups[name]?.color ?? defaultGroupColor(name),
            count: area.length,
            area: area.length
              ? `${area.length === 1 ? "1 region" : `${area.length} regions`}: ${area.slice(0, 24).map((id) => regionNames.get(id) || id).join(", ")}${area.length > 24 ? ` and ${area.length - 24} more` : ""}`
              : "",
          };
        }),
      };
    },

    "cheats.groups.save": async ({ selected = "", name: rawName = "", description: rawDescription = "", color: rawColor = "" }) => {
      const world = gs.normalizeWorldState(await readWorld());
      const groups = world.groups ?? {};
      const name = normalizeGroupName(rawName);
      if (!name) throw new Error("Give the group a name.");
      const description = normalizeGroupDescription(rawDescription);
      const color = normalizeGroupColor(rawColor) || defaultGroupColor(name);
      const clash = findGroupKey(groups, name);
      const game = await readGame();
      const applyOps = async (ops, patch = null) => {
        let next = null;
        await gs.mutateWorldState((current) => {
          const result = gs.applyEventImpactsToWorld({
            world: current,
            round: game?.round || 0,
            events: [adminEvent(game, "admin-groups", "Groups administrative change", "Structured administrative mutation from the Groups tool.", { groupOps: ops })],
          });
          next = patch ? patch(result.world) : result.world;
          return next;
        });
        return next;
      };
      if (!selected) {
        if (clash) throw new Error(`There is already a group called ${clash}.`);
        const next = await applyOps([{ op: "create", name, description, color }]);
        if (!findGroupKey(gs.normalizeWorldState(next).groups, name)) throw new Error(`A game holds at most ${MAX_GROUPS} groups; erase one first.`);
        await noteGmChange("groups", `Created the group ${name} by hand${description ? ` — ${description.slice(0, 160)}` : ""}.`);
        return { selected: name, message: `${name} created. Give it an area: Edit the area on the map.` };
      }
      if (clash && clash !== selected) throw new Error(`There is already a group called ${clash}.`);
      const renamed = name !== selected;
      await applyOps(
        [{ op: "update", name: selected, ...(renamed ? { newName: name } : {}), ...(description ? { description } : {}), color }],
        description ? null : (next) => ({ ...next, groups: { ...next.groups, [name]: { ...next.groups?.[name], description: "" } } }),
      );
      await noteGmChange("groups", `Changed the group ${selected}${renamed ? `, now called ${name},` : ""} by hand${description ? ` — ${description.slice(0, 160)}` : ""}.`);
      return { selected: name, message: `${name} saved.` };
    },

    "cheats.groups.ops": async ({ name, action, index = -1 }) => {
      const game = await readGame();
      const apply = async (ops) => gs.mutateWorldState((current) => gs.applyEventImpactsToWorld({
        world: current,
        round: game?.round || 0,
        events: [adminEvent(game, "admin-groups", "Groups administrative change", "Structured administrative mutation from the Groups tool.", { groupOps: ops })],
      }).world);
      if (action === "erase") {
        await apply([{ op: "dissolve", name }]);
        await noteGmChange("groups", `Erased the group ${name} and the area it controlled by hand.`);
        return { message: `${name} erased.` };
      }
      if (action === "clear") {
        await apply([{ op: "release", name, regionIds: [] }]);
        await noteGmChange("groups", `Took away all of ${name}'s area by hand.`);
        return { message: `${name} controls no area now.` };
      }
      if (action === "toggle") {
        const region = await regionAt({ index });
        if (!region) return { message: "" };
        const world = gs.normalizeWorldState(await readWorld());
        const had = (world.groupAreas ?? {})[region.id] === name;
        await apply([{ op: had ? "release" : "take", name, regionIds: [region.id] }]);
        await noteGmChange("groups", "", {
          group: `group-${had ? "release" : "take"}→${name}`,
          template: had ? `Took {items} out of ${name}'s area by hand.` : `Put {items} under ${name}'s control by hand.`,
          item: region.name,
        });
        return { message: `${region.name}: ${had ? `no longer ${name}'s` : `now controlled by ${name}`}. Keep clicking, or press Done.` };
      }
      throw new Error(`Unknown group change: ${action}`);
    },

    "cheats.puppets.get": async () => {
      const world = await readWorld();
      const rows = list(world?.puppets).filter((row) => isRecord(row) && cleanEventText(row.overlord) && cleanEventText(row.puppet));
      const live = (row) => (cleanEventText(row.status) || "active") === "active";
      const loyalty = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : 50);
      const kindName = (kind) => capitalize(PUPPET_KIND_LABELS[kind || "client"] || kind || "client");
      return {
        live: rows.filter(live).map((row) => ({
          overlord: row.overlord,
          puppet: row.puppet,
          title: `${row.overlord} → ${row.puppet}`,
          meta: `${kindName(row.kind)} · ${row.secrecy === "covert" ? "Covert" : "Openly known"} · Loyalty ${loyalty(row.loyalty)}`,
        })),
        ended: rows.filter((row) => !live(row)).map((row) => `${row.overlord} → ${row.puppet} · ${capitalize(row.status)}${row.endedDate ? ` · ${row.endedDate}` : ""}`),
      };
    },

    "cheats.features.get": async () => {
      const data = await featureData();
      return {
        customCities: data.customCities,
        markers: data.markers.map((marker) => plain(marker)),
        cities: data.cities.map((feature, index) => ({
          index,
          name: String(feature?.properties?.city || feature?.properties?.name || `City ${index + 1}`),
          tier: Math.max(1, Math.min(4, Number(feature?.properties?.tier) || (feature?.properties?.capital === "primary" || feature?.properties?.capital === true ? 4 : 2))),
          population: Number(feature?.properties?.population) || 0,
          lng: Number(feature?.geometry?.coordinates?.[0]),
          lat: Number(feature?.geometry?.coordinates?.[1]),
        })),
        statuses: list(gs.MARKER_STATUSES),
      };
    },

    "cheats.features.marker_ops": async ({ ops = [] }) => {
      await applyAdminMarkerOps(list(ops));
      return true;
    },

    "cheats.features.marker_save": async ({ marker = {}, fields = {} }) => {
      const data = await featureData();
      const current = data.markers.find((entry) => entry.id === marker.id) ?? marker;
      const statuses = list(gs.MARKER_STATUSES);
      const statusRaw = String(fields.status ?? current.status ?? "active").trim().toLowerCase();
      const next = {
        name: String(fields.name ?? current.name ?? "").trim(),
        kind: (fields.kind === "other" ? String(fields.customKind ?? "").trim() : String(fields.kind ?? current.kind ?? "landmark").trim()) || "landmark",
        ownerCode: String(fields.ownerCode ?? current.ownerCode ?? "").trim(),
        lng: Number(fields.lng ?? current.lng),
        lat: Number(fields.lat ?? current.lat),
        note: String(fields.note ?? current.note ?? "").trim(),
        status: statuses.includes(statusRaw) ? statusRaw : "active",
        foundedAt: String(fields.foundedAt ?? current.foundedAt ?? "").trim(),
      };
      if (!next.name) throw new Error("Give the feature a name.");
      if (data.markers.some((entry) => entry.id !== current.id && String(entry.name || "").trim().toLowerCase() === next.name.toLowerCase())) {
        throw new Error(`Another runtime feature is already named “${next.name}”. Use a unique name so stable marker identities never become ambiguous.`);
      }
      if (!Number.isFinite(next.lng) || !Number.isFinite(next.lat) || (next.lng === 0 && next.lat === 0)) throw new Error("The feature needs valid map coordinates.");
      const ops = [];
      if (next.name !== String(current.name || "").trim()) ops.push({ op: "rename", markerId: current.id, name: current.name, newName: next.name, note: "Map Feature Editor rename" });
      ops.push({ op: "update", markerId: current.id, ...next });
      await applyAdminMarkerOps(ops);
      return { name: next.name };
    },

    "cheats.features.marker_add": async ({ marker = {} }) => {
      const name = String(marker.name ?? "").trim();
      const latestWorld = await readWorld();
      if (list(latestWorld?.markers).some((entry) => String(entry?.name ?? "").trim().toLowerCase() === name.toLowerCase())) {
        throw new Error(`A runtime feature named “${name}” already exists. Edit the existing feature or choose a unique name.`);
      }
      await applyAdminMarkerOps([{ op: "build", marker: { ...marker, name } }]);
      return true;
    },

    "cheats.features.city_save": async ({ index = -1, name = "", tier = 2, population = "", lng = null, lat = null }) => {
      const data = await featureData();
      const current = data.cities[index];
      if (!current) throw new Error("That scenario city no longer exists.");
      const level = Math.max(1, Math.min(4, Number(tier) || Number(current?.properties?.tier) || 2));
      const people = Number(population);
      const cityName = String(name || current?.properties?.city || current?.properties?.name || "").trim();
      if (!cityName) throw new Error("Give the city a name.");
      const moved = lng !== null && lat !== null && Number.isFinite(Number(lng)) && Number.isFinite(Number(lat));
      const nextCities = data.cities.map((entry, i) => (i !== index ? entry : {
        ...entry,
        geometry: { ...(entry.geometry || {}), type: "Point", coordinates: moved ? [Number(lng), Number(lat)] : entry?.geometry?.coordinates },
        properties: {
          ...(entry.properties || {}),
          city: cityName,
          name: cityName,
          tier: level,
          capital: level === 4 ? "primary" : "",
          ...(String(population ?? "").trim() && Number.isFinite(people) && people >= 0 ? { population: Math.round(people) } : { population: 0 }),
        },
      }));
      await saveScenarioCities(nextCities);
      const previous = Number(current?.properties?.population);
      if (hasPopulationByYear(current?.properties) && String(population ?? "").trim() && Number.isFinite(people) && people >= 0 && Math.round(people) !== previous) {
        const key = cityName.trim().toLowerCase();
        await gs.mutateWorldState((world) => ({ ...world, cityPopulations: { ...(world?.cityPopulations || {}), [key]: Math.round(people) } }));
      }
      return { name: cityName };
    },

    "cheats.features.city_add": async ({ name, tier = 2, population = "", lng, lat }) => {
      const latest = await readJson(URLS.citiesGeojson, { defaultValue: { features: [] }, force: true });
      const level = Math.max(1, Math.min(4, Number(tier) || 2));
      const people = Number(population);
      await saveScenarioCities([...list(latest?.features), {
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number(lng), Number(lat)] },
        properties: {
          city: name,
          name,
          tier: level,
          capital: level === 4 ? "primary" : "",
          ...(Number.isFinite(people) && people >= 0 && String(population ?? "").trim() !== "" ? { population: Math.round(people) } : { population: 0 }),
        },
      }]);
      return true;
    },

    "cheats.features.city_delete": async ({ index }) => {
      const data = await featureData();
      await saveScenarioCities(data.cities.filter((_, i) => i !== index));
      return true;
    },

    "cheats.features.clear": async ({ what }) => {
      const data = await featureData();
      if (what === "markers") {
        await applyAdminMarkerOps(data.markers.map((marker) => ({ op: "remove", markerId: marker.id, name: marker.name, note: "Clear Map Features" })));
        return "All runtime world features removed.";
      }
      if (what === "cities") {
        await saveScenarioCities([]);
        return "Scenario city layer cleared.";
      }
      if (what === "stock") {
        const world = await readWorld();
        await gs.writeWorldState({ ...world, customCities: false });
        await noteGmChange("feature", "Replaced the scenario's own cities with the standard world city list, by hand.");
        return "Scenario city layer disabled; stock world cities restored.";
      }
      throw new Error(`Unknown clean-up: ${what}`);
    },

    "cheats.events.load": async (args = {}) => {
      const next = list(await gs.readEventsState({ force: true }));
      if (!engine.simulationStatus?.isSimulationBusy?.()) await syncVisibleTimeline(next);
      eventsCache.list = next;
      return eventRows(args);
    },

    "cheats.events.rows": async (args = {}) => eventRows(args),

    "cheats.events.add": async ({ form = {} }) => {
      const title = cleanEventText(form.title);
      const description = tidyProse(form.description);
      const date = cleanEventText(form.date);
      const quote = eventQuoteFromForm(form);
      if (!date) throw new Error("Exact events need a date.");
      if (!title) throw new Error("Exact events need a title.");
      if (!description) throw new Error("Exact events need a description.");
      const nextEvent = {
        createdAt: new Date().toISOString(),
        date,
        description,
        id: manualEventId(),
        importance: cleanEventText(form.importance) || "major",
        kind: cleanEventText(form.kind) || "world",
        notable: Boolean(form.notable),
        playerRelated: Boolean(form.playerRelated),
        ...(quote ? { quote } : {}),
        ...(form.allowNpcReactions ? { npcReaction: { enabled: true } } : {}),
        source: "manual",
        title,
      };
      const persisted = await persistEvents({ add: nextEvent });
      const persistedEvent = persisted.find((event) => eventRowIdentity(event) === eventRowIdentity(nextEvent)) || nextEvent;
      if (form.allowNpcReactions) await syncReactionQueueForEvent(persistedEvent, true);
      await noteGmChange("timeline", `Wrote the event "${title}" (${date}) into the record by hand.`);
      return form.allowNpcReactions
        ? `Exact event added: ${title}. NPC reactions may arrive after the 12-second undo window.`
        : `Exact event added to canonical history and linked to the Events panel: ${title}`;
    },

    "cheats.events.edit": async ({ index, form = {} }) => {
      const event = eventsCache.list[index];
      if (!event) throw new Error("That event is no longer in the record. The list has been refreshed.");
      const title = cleanEventText(form.title);
      const description = tidyProse(form.description);
      const date = cleanEventText(form.date);
      const quote = eventQuoteFromForm(form);
      if (!date) throw new Error("Events need a date.");
      if (!title) throw new Error("Events need a title.");
      const wasEnabled = Boolean(event?.npcReaction?.enabled);
      const enabled = Boolean(form.allowNpcReactions);
      const deliberatelyReenabled = enabled && !wasEnabled;
      const nextReaction = (entry) => (enabled
        ? (deliberatelyReenabled ? { enabled: true } : { ...(entry?.npcReaction || {}), enabled: true })
        : { ...(entry?.npcReaction || {}), enabled: false });
      const persisted = await persistEvents({
        shown: event,
        index,
        update: (entry) => ({
          ...entry,
          date,
          description,
          importance: cleanEventText(form.importance) || entry.importance || "minor",
          kind: cleanEventText(form.kind) || entry.kind || "world",
          notable: Boolean(form.notable),
          playerRelated: Boolean(form.playerRelated),
          quote: quote || null,
          npcReaction: nextReaction(entry),
          title,
        }),
      });
      const persistedEvent = persisted.find((candidate) => eventRowIdentity(candidate) === eventRowIdentity(event));
      if (persistedEvent) await syncReactionQueueForEvent(persistedEvent, enabled, { restart: deliberatelyReenabled });
      const rewritten = [
        cleanEventText(event.title) !== title ? `retitled it "${title}"` : "",
        cleanEventText(event.date) !== date ? `redated it to ${date}` : "",
        tidyProse(event.description) !== description ? "rewrote what it says" : "",
      ].filter(Boolean);
      if (rewritten.length) await noteGmChange("timeline", `Edited the event "${cleanEventText(event.title) || title}" by hand: ${rewritten.join(", ")}.`);
      return `Canonical event updated: ${title}`;
    },

    "cheats.events.delete": async ({ index }) => {
      const event = eventsCache.list[index];
      if (!event) throw new Error("That event is no longer in the record. The list has been refreshed.");
      const world = await readWorld();
      const pending = list(world?.pendingEventOutreach).some((entry) => [cleanEventText(entry?.sourceEventId), cleanEventText(entry?.sourceEventCreatedAt)].join("\u001f") === eventRowIdentity(event));
      const impact = impactSummary(event);
      await persistEvents({ shown: event, index, remove: true });
      await syncReactionQueueForEvent(event, false);
      await noteGmChange("timeline", `Deleted the event "${cleanEventText(event.title) || "untitled"}"${cleanEventText(event.date) ? ` (${cleanEventText(event.date)})` : ""} from the record${impact.count ? "; what it changed on the map was left as it is" : ""}.`);
      return pending
        ? "Event removed from canonical history and its pending diplomatic reaction was cancelled. Existing world state was left untouched."
        : "Event removed from canonical history. Existing world state was left untouched.";
    },

    "cheats.events.cancel_reaction": async ({ index }) => {
      const event = eventsCache.list[index];
      if (!event) throw new Error("That event is no longer in the record. The list has been refreshed.");
      const persisted = await persistEvents({ shown: event, index, update: (entry) => ({ ...entry, npcReaction: { ...(entry?.npcReaction || {}), enabled: false } }) });
      const persistedEvent = persisted.find((candidate) => eventRowIdentity(candidate) === eventRowIdentity(event)) || event;
      await syncReactionQueueForEvent(persistedEvent, false);
      return "Pending NPC reaction cancelled. The event remains canonical.";
    },

    "cheats.events.retry_reaction": async ({ index }) => {
      const event = eventsCache.list[index];
      if (!event) throw new Error("That event is no longer in the record. The list has been refreshed.");
      const persisted = await persistEvents({ shown: event, index, update: (entry) => ({ ...entry, npcReaction: { enabled: true } }) });
      const persistedEvent = persisted.find((candidate) => eventRowIdentity(candidate) === eventRowIdentity(event));
      if (persistedEvent) await syncReactionQueueForEvent(persistedEvent, true, { restart: true });
      return "NPC reaction queued again. It is checked after the grace window.";
    },

    "cheats.interactive.get": async ({ search = "", limit = 30 } = {}) => {
      const [world, events] = await Promise.all([readWorld(), gs.readEventsState({ force: true })]);
      const sceneInProgress = isSceneInProgress(world?.activeInteractive);
      const offer = world?.interactiveOffer ?? null;
      const unseen = engine.unseenEvents?.unseenEvents?.unseenFor ? engine.unseenEvents.unseenEvents.unseenFor(world) : new Set();
      const query = cleanEventText(search).toLowerCase();
      const all = [...list(events)].reverse();
      const listed = query
        ? all.filter((event) => [event?.title, event?.date, event?.description, event?.id].some((value) => cleanEventText(value).toLowerCase().includes(query)))
        : all;
      const offeredTitle = offer ? cleanEventText(list(events).find((event) => cleanEventText(event?.id) === cleanEventText(offer.eventId))?.title) : "";
      return {
        sceneInProgress,
        offer: offer ? { eventId: cleanEventText(offer.eventId), title: offeredTitle || cleanEventText(offer.eventId) } : null,
        total: listed.length,
        empty: list(events).length === 0,
        rows: listed.slice(0, Math.max(0, Number(limit) || 30)).map((event) => ({
          id: cleanEventText(event.id),
          title: cleanEventText(event.title) || "Untitled event",
          date: isGameDate(event.date) ? readable(event.date) : "",
          offerable: isOfferableEvent(event),
          revealing: unseen.has?.(cleanEventText(event.id)) ?? false,
        })),
      };
    },

    "cheats.interactive.offer": async ({ eventId, title = "" }) => {
      const id = cleanEventText(eventId);
      if (!id) throw new Error("That event has no id, so a scene cannot be opened on it.");
      const [current, game] = await Promise.all([readWorld(), readGame()]);
      await gs.writeWorldState({ ...current, interactiveOffer: { eventId: id, round: Math.max(0, Math.trunc(Number(game?.round) || 0)) } });
      return `Offered "${cleanEventText(title) || id}". Play it out in the panel that just opened.`;
    },

    "cheats.interactive.clear": async () => {
      const current = await readWorld();
      await gs.writeWorldState({ ...current, interactiveOffer: null });
      return "The offer is gone. Nothing else changed.";
    },

    "cheats.history.get": async () => historyDocument(),

    "cheats.history.save": async ({ draft = "" }) => {
      const world = await readWorld();
      const current = world?.historyDocument ?? null;
      const value = String(draft ?? "").trim();
      const words = value ? value.split(/\s+/).length : 0;
      const next = value
        ? {
          text: value,
          revision: (current?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
          source: "manual",
          throughDate: current?.throughDate ?? "",
          throughEventId: current?.throughEventId ?? "",
          throughRound: current?.throughRound ?? 0,
        }
        : null;
      await gs.writeWorldState({ ...world, historyDocument: next });
      if ((current?.text ?? "").trim() !== value) {
        await noteGmChange("history", next ? "Rewrote the history document by hand; it is the account of the past to go by." : "Cleared the history document by hand.");
      }
      return next
        ? `History document saved (revision ${next.revision}, ${words} words). The AI reads it from its next call.`
        : "History document cleared. The AI is shown the pass summaries below until the next pass writes a new document.";
    },

    "cheats.history.reset": async () => {
      const world = await readWorld();
      await gs.writeWorldState({ ...world, historyDocument: null, consolidatedHistory: [] });
      return "Compression reset: the document and its pass ledger are gone. Every event is still in the timeline, and the AI is shown all of them in full until the next pass.";
    },

    "cheats.history.fold": async () => {
      const result = await engine.gameplay.consolidateHistoryNow();
      return result?.consolidated
        ? `Folded ${result.events} event${result.events === 1 ? "" : "s"} and ${result.chats} chat${result.chats === 1 ? "" : "s"}; the document is now revision ${result.documentRevision}, ${result.documentWords} words. The newest ${result.retained} events stay in full.`
        : "Nothing was folded: only the retained tail is waiting, or the consolidator came back empty.";
    },
  };

  return methods;
};
