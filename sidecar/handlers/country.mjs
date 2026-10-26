import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EXTRA_MODULES = Object.freeze({
  politicalKnowledge: "ctPoliticalKnowledge",
  politicalPresentation: "ctPoliticalPresentation",
  statsHistoricalTracking: "ctStatsHistoricalTracking",
  puppets: "ctPuppets",
  groups: "ctGroups",
  militaryPower: "ctMilitaryPower",
  militaryRating: "ctMilitaryRating",
  militaryStats: "ctMilitaryStats",
  countryRanking: "ctCountryRanking",
  powerStatus: "ctPowerStatus",
  countryTags: "ctCountryTags",
  countryStats: "ctCountryStats",
  gameplaySchemas: "ctGameplaySchemas",
  warSettings: "ctWarSettings",
  attrition: "ctAttrition",
  warResources: "ctWarResources",
  alliances: "ctAlliances",
  peaceTerms: "ctPeaceTerms",
  warWeariness: "ctWarWeariness",
  afterActionData: "ctAfterActionData",
  gameDates: "ctGameDates",
  polityIdentity: "ctPolityIdentity",
  countryInfoPanel: "ctCountryInfoPanel",
  polityFlags: "ctPolityFlags",
  structurePlacement: "ctStructurePlacement",
  mapClaims: "ctMapClaims",
  gameFeatures: "ctGameFeatures",
  countryNames: "ctCountryNames",
  regionInfo: "ctRegionInfo",
  mapCards: "ctMapCards",
  scenarioCanon: "ctScenarioCanon",
  ownerNames: "ctOwnerNames",
  regionNameFixes: "ctRegionNameFixes",
  listenIn: "ctListenIn",
  i18n: "ctI18n",
  communityFlags: "ctCommunityFlags",
  gameFlagChoices: "ctGameFlagChoices",
  hubFiles: "ctHubFiles",
});

let extrasFound = null;

export const loadExtras = async (ctx) => {
  if (extrasFound) return extrasFound;
  const found = {};
  const missing = [];
  for (const [name, exported] of Object.entries(EXTRA_MODULES)) {
    const module = ctx.engine[exported];
    if (module && typeof module === "object") found[name] = module;
    else missing.push(exported);
  }
  if (missing.length) {
    console.error(`[country] engine bundle lacks ${missing.join(", ")}`);
    throw new Error("This build of the app is missing part of the game engine.");
  }
  extrasFound = found;
  return found;
};

export const asArray = (value) => (Array.isArray(value) ? value : []);
export const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const lowerText = (value) => cleanText(value).toLocaleLowerCase();
const fold = (value) => cleanText(value).toLowerCase();
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clamp01 = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const hex2 = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

const hslToRgb = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  if (sat === 0) return [light * 255, light * 255, light * 255];
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
};

export const cssHex = (value, fallback = "#a1a1aaff") => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  let match = /^#([0-9a-f]{3,8})$/.exec(text);
  if (match) {
    const body = match[1];
    if (body.length === 3 || body.length === 4) {
      const parts = body.split("").map((char) => char + char);
      return `#${parts.join("")}${body.length === 3 ? "ff" : ""}`;
    }
    if (body.length === 6) return `#${body}ff`;
    if (body.length === 8) return `#${body}`;
    return fallback;
  }
  const numbers = (inner) => inner.split(/[\s,/]+/).filter(Boolean);
  match = /^rgba?\(([^)]*)\)$/.exec(text);
  if (match) {
    const parts = numbers(match[1]);
    if (parts.length < 3) return fallback;
    const channel = (part) => (part.endsWith("%") ? (Number(part.slice(0, -1)) / 100) * 255 : Number(part));
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
    return `#${hex2(channel(parts[0]))}${hex2(channel(parts[1]))}${hex2(channel(parts[2]))}${hex2((Number.isFinite(alpha) ? alpha : 1) * 255)}`;
  }
  match = /^hsla?\(([^)]*)\)$/.exec(text);
  if (match) {
    const parts = numbers(match[1]);
    if (parts.length < 3) return fallback;
    const [r, g, b] = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2((Number.isFinite(alpha) ? alpha : 1) * 255)}`;
  }
  return fallback;
};

export const flagFile = (ctx, url) => {
  const raw = cleanText(url);
  if (!raw) return "";
  const cdn = /^https?:\/\/flagcdn\.com\/(?:(?:[wh]\d+|\d+x\d+)\/)?([a-z]{2}(?:-[a-z]{2,3})?)\.(?:svg|png|webp|jpe?g)(?:[?#].*)?$/i.exec(raw);
  const local = /^(?:\.?\/)?(?:[^?#]*\/)?flags\/([a-z]{2}(?:-[a-z]{2,3})?)\.svg$/i.exec(raw);
  const code = (cdn?.[1] || local?.[1] || "").toLowerCase();
  if (code) {
    const file = path.join(ctx.repo, "public", "flags", `${code}.svg`);
    return fs.existsSync(file) ? file : "";
  }
  const data = /^data:image\/(svg\+xml|png|jpeg|jpg|webp)(;base64)?,([\s\S]*)$/i.exec(raw);
  if (!data) return "";
  const kind = data[1].toLowerCase();
  const ext = kind.startsWith("svg") ? "svg" : kind === "jpeg" || kind === "jpg" ? "jpg" : kind;
  let body;
  try {
    body = data[2] ? Buffer.from(data[3], "base64") : Buffer.from(decodeURIComponent(data[3]), "utf8");
  } catch {
    return "";
  }
  const hash = crypto.createHash("sha1").update(body).digest("hex").slice(0, 24);
  const file = path.join(ctx.cacheDir, "flags", `${hash}.${ext}`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return file;
};

let countryNamesPromise = null;
export const countryNameRows = (ctx) => {
  if (!countryNamesPromise) {
    countryNamesPromise = Promise.resolve(ctx.engine.assets.loadCountryNames?.())
      .then((rows) => asArray(rows))
      .catch(() => {
        countryNamesPromise = null;
        return [];
      });
  }
  return countryNamesPromise;
};

export const polityNameResolver = (countries, world) => {
  const byCode = new Map();
  for (const country of asArray(countries)) {
    if (country?.code) byCode.set(String(country.code), country.name || country.code);
  }
  for (const polity of Object.values(record(world?.polityOverrides))) {
    if (polity?.code && polity?.name) byCode.set(String(polity.code), polity.name);
  }
  return (code) => {
    const key = String(code ?? "").trim();
    if (!key) return "";
    return byCode.get(key) || key;
  };
};

export const featuresOf = (ctx, extras) => {
  const library = ctx.engine.getLibraryState?.() ?? {};
  try {
    return extras.gameFeatures.resolveFeatures(library?.runtimeScenario?.features ?? null, library?.activeGame?.features ?? null) ?? {};
  } catch {
    return {};
  }
};

export const featureOn = (features, key) => features?.[key]?.enabled !== false;

let primedCatalog = null;
export const regionCatalog = async (ctx) => {
  const primed = ctx.engine.assets.getPrimedScenarioRegionCatalog?.();
  if (Array.isArray(primed) && primed.length) return primed;
  try {
    const loaded = await ctx.engine.assets.loadScenarioRegionCatalog();
    if (Array.isArray(loaded) && loaded.length) {
      primedCatalog = loaded;
      return loaded;
    }
  } catch {
    if (primedCatalog) return primedCatalog;
  }
  return primedCatalog ?? [];
};

const identityCache = new WeakMap();
export const identityIndexFor = (extras, world) => {
  if (!world || typeof world !== "object") return null;
  if (!identityCache.has(world)) identityCache.set(world, extras.statsHistoricalTracking.buildHistoricalTrackingIndex(world));
  return identityCache.get(world);
};

export const resolveIdentity = (extras, value, world, allowUnknown = true) => {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const resolved = extras.polityIdentity.resolvePolityIdentity(raw, world, {
      allowUnknown,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    return cleanText(resolved?.resolved) || raw;
  } catch {
    return raw;
  }
};

const STORAGE_KEY = "oh-stat-sheets-v2";
const TRACKING_STORAGE_KEY = "oh-stat-tracking-v1";
const MAX_STORED_SHEETS = 20;
const MAX_LOCAL_CACHE_COMPONENTS = 64;
const MAX_MEMORY_SHEETS = 24;
const RANKING_ROWS_FIRST = 25;
const TURN_RUNNING_NOTE = "A turn is running. This can be changed once it ends.";

const POWER_TIER_LABELS = Object.freeze({
  "major-power": "Major power",
  "regional-power": "Regional power",
  "minor-power": "Minor power",
});

const MILITARY_FIGURE_LABELS = Object.freeze({
  quality: "Troop quality",
  technology: "Technology",
  manpowerShare: "Manpower share",
  weariness: "War weariness",
  resources: "War resources",
  land: "Land",
  sea: "Naval",
  air: "Air",
  spending: "Spending",
});
const MILITARY_FIGURE_ORDER = Object.freeze(["quality", "technology", "spending", "manpowerShare", "weariness", "resources", "land", "sea", "air"]);
const MILITARY_OWN_COLOR = "#2bc1f3ff";
const MILITARY_SHARED_COLOR = "#ffffff52";
const MILITARY_WEARY_COLOR = "#f59e0bff";

const compactEconomyValue = (value) => {
  if (value === null || value === undefined) return value;
  const text = String(value).trim();
  const match = /^([^0-9-]{0,4})(-?\d[\d,]*)(?:\.(\d+))?$/.exec(text);
  if (!match) return value;
  const number = Number(`${match[2].replace(/,/g, "")}${match[3] ? `.${match[3]}` : ""}`);
  if (!Number.isFinite(number) || Math.abs(number) < 1e6) return value;
  const prefix = match[1] ?? "";
  const abs = Math.abs(number);
  const [divisor, suffix] = abs >= 1e12 ? [1e12, "T"] : abs >= 1e9 ? [1e9, "B"] : [1e6, "M"];
  const compact = (number / divisor).toFixed(abs / divisor >= 100 ? 0 : 1);
  return `${prefix}${compact}${suffix}`;
};

export const formatCompactNumber = (value, { digits = 1 } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const abs = Math.abs(number);
  if (abs >= 1e12) return `${(number / 1e12).toFixed(abs >= 100e12 ? 0 : digits)}T`;
  if (abs >= 1e9) return `${(number / 1e9).toFixed(abs >= 100e9 ? 0 : digits)}B`;
  if (abs >= 1e6) return `${(number / 1e6).toFixed(abs >= 100e6 ? 0 : digits)}M`;
  if (abs >= 1e3) return `${(number / 1e3).toFixed(abs >= 100e3 ? 0 : digits)}K`;
  return Number.isInteger(number) ? number.toLocaleString() : number.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatPopulation = (value) => formatCompactNumber(value);
const formatEuroTotal = (value) => {
  const text = formatCompactNumber(value);
  return text === "—" ? text : `€${text}`;
};
const formatEuroPerCapita = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? `€${Math.round(number).toLocaleString()}` : "—";
};
const formatPercent = (value, { signed = false } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const rounded = Math.round(number * 10) / 10;
  const prefix = signed && rounded > 0 ? "+" : "";
  return `${prefix}${rounded}%`;
};

const formatCustomStatValue = (stat, value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const decimals = Math.max(0, Math.min(4, Math.trunc(Number(stat?.decimals) || 0)));
  let body;
  if (stat?.compact) {
    body = formatCompactNumber(number, { digits: Math.min(2, decimals || 1) });
  } else {
    body = number.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  const prefix = String(stat?.prefix || "");
  const suffix = String(stat?.suffix || "");
  const suffixText = suffix ? (/^[%°]/.test(suffix) ? suffix : ` ${suffix}`) : "";
  return `${prefix}${body}${suffixText}`;
};

const customMetricUnit = (stat) => ["custom", stat?.kind || "number", String(stat?.prefix || ""), String(stat?.suffix || "")].join(":");

const customMetricUnitLabel = (stat) => {
  if (stat?.kind === "index") return "Index · 0–100";
  if (stat?.kind === "percentage") return stat?.suffix || "Percent";
  const display = [stat?.prefix, stat?.suffix].filter(Boolean).join(" … ");
  return display || "Value";
};

const countryStatsTrackingIntervalLabel = (months) => {
  const count = Math.max(0, Math.trunc(Number(months) || 0));
  if (!count) return "Manual only";
  return count === 1 ? "Every month" : `Every ${count} months`;
};

const stabilityColor = (value) => (value < 40 ? "#ef4444ff" : value < 70 ? "#f59e0bff" : "#22c55eff");

const relationStatusForScore = (score = 0) => {
  const numeric = Math.max(-100, Math.min(100, Math.round(Number(score) || 0)));
  if (numeric >= 55) return "friendly";
  if (numeric >= 20) return "cordial";
  if (numeric >= -10) return "neutral";
  if (numeric >= -30) return "cautious";
  if (numeric >= -60) return "strained";
  if (numeric > -90) return "hostile";
  return "rival";
};

const relationTone = (score = 0) => {
  const key = relationStatusForScore(score);
  if (["hostile", "rival"].includes(key)) return "#f87171";
  if (key === "strained") return "#fb923c";
  if (key === "cautious") return "#fbbf24";
  if (key === "friendly") return "#34d399";
  if (key === "cordial") return "#60a5fa";
  return "#d1d1d5";
};

const formatRelationScore = (value) => {
  const number = Math.max(-100, Math.min(100, Math.round(Number(value) || 0)));
  return `${number > 0 ? "+" : ""}${number}`;
};

const prettyToken = (value) => cleanText(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const agreementStatusTone = (status) => {
  const key = lowerText(status);
  if (key === "active") return "#34d399";
  if (key === "suspended") return "#fbbf24";
  return "#94a3b8";
};

const warStatusTone = (status) => (lowerText(status) === "active" ? "#f87171" : "#fbbf24");

const warCauseForDisplay = (cause) => {
  const text = cleanText(cause);
  return /^native bootstrap\b/i.test(text) ? "" : text;
};

const formatSupport = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Number.isInteger(number) ? `${number}%` : `${number.toFixed(1)}%`;
};

const stableHue = (value) => {
  let hash = 2166136261;
  for (const char of cleanText(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 360;
};

const partyColor = (party) => {
  const authored = cleanText(party?.color);
  if (/^#[0-9a-f]{3,8}$/i.test(authored) || /^rgb(a)?\(/i.test(authored) || /^hsl(a)?\(/i.test(authored)) return cssHex(authored);
  if (party?.isOther) return cssHex("rgba(148,163,184,0.72)");
  return cssHex(`hsl(${stableHue(party?.id || party?.name)} 68% 58%)`);
};

const officeholderName = (value) => {
  if (typeof value === "string") return cleanText(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return cleanText(value.name || value.id);
};

const listOf = (value) => (Array.isArray(value) ? value.map(cleanText).filter(Boolean) : (cleanText(value) ? [cleanText(value)] : []));

const refusalText = (error) => {
  if (error === "not-open") return "This is no longer open.";
  if (error === "not-yours") return "This is not yours to answer.";
  if (error === "played") return "That side is led by another player: make peace with them in a chat.";
  if (error === "no-war") return "That war is over.";
  if (error === "not-in-war") return "You are not in that war.";
  return cleanText(error) || "That could not be done.";
};

const REPARATION_CHOICES = Object.freeze([
  { key: "none", label: "Nobody pays" },
  { key: "they-light", label: "They pay 1% a year for 5 years" },
  { key: "they-heavy", label: "They pay 3% a year for 10 years" },
  { key: "we-light", label: "We pay 1% a year for 5 years" },
  { key: "we-heavy", label: "We pay 3% a year for 10 years" },
]);

const paymentOf = (key, mine, theirs) => {
  if (!key || key === "none") return null;
  const heavy = key.endsWith("heavy");
  const [payer, receiver] = key.startsWith("they") ? [theirs, mine] : [mine, theirs];
  return { payer, receiver, share: heavy ? 0.03 : 0.01, years: heavy ? 10 : 5 };
};

export const answerDiplomacy = async (ctx, op, ref, terms = null) => {
  if (ctx.engine.simulationStatus.isSimulationBusy()) return { ok: false, error: TURN_RUNNING_NOTE, accepted: false, to: "" };
  try {
    const answer = await ctx.engine.gameplay.answerDiplomacy({ op, ref, terms });
    return {
      ok: answer?.ok === true,
      error: answer?.error ? refusalText(answer.error) : "",
      accepted: answer?.accepted === true,
      to: cleanText(answer?.to),
    };
  } catch (error) {
    return { ok: false, error: cleanText(error?.message) || "That could not be done.", accepted: false, to: "" };
  }
};

const termsLines = (extras, terms) => {
  const payment = terms?.reparations ?? null;
  const share = payment ? Math.round(payment.share * 1000) / 10 : 0;
  return [
    terms?.territory === extras.peaceTerms.TERRITORY_AS_HELD ? "Each side keeps the ground it holds." : "Every region goes back to whose it was before the war.",
    payment ? `${payment.payer} pays ${payment.receiver} reparations: ${share}% of its economy a year for ${payment.years} years.` : "Nobody pays reparations.",
  ];
};

export const warPeaceState = async (ctx) => {
  const extras = await loadExtras(ctx);
  const [world, game] = await Promise.all([
    ctx.engine.readJson(ctx.engine.JSON_URLS.world, { defaultValue: {}, force: false }).catch(() => ({})),
    ctx.engine.gameState.readGameData({ force: false }).catch(() => ({})),
  ]);
  const country = cleanText(game?.country);
  if (!country) return { country: "", waiting: 0, calls: [], offers: [] };
  const offers = extras.peaceTerms.openOffersFor(asArray(world?.peaceOffers), country);
  const calls = extras.alliances.openCallsFor(asArray(world?.callsToArms), country);
  const reputation = extras.alliances.TREATY_BROKEN_REPUTATION;
  return {
    country,
    waiting: offers.length + calls.length,
    calls: calls.map((call) => ({
      id: cleanText(call.id),
      title: "Call to arms",
      yes: "Honour the alliance",
      no: "Break the treaty",
      yesOp: "honour",
      noOp: "refuse",
      lines: [
        { text: `${call.defender} has been attacked by ${asArray(call.attackers).join(", ") || "an enemy"} and calls on you to defend it.`, tone: "main" },
        ...(call.via?.title ? [{ text: `You are bound by ${call.via.title}.`, tone: "soft" }] : []),
        { text: `Honouring it puts you at war. Breaking the treaty costs ${reputation} of your reputation, and ends it. Left unanswered, it counts as broken.`, tone: "soft", gap: true },
      ],
    })),
    offers: offers.map((offer) => ({
      id: cleanText(offer.id),
      title: "Peace offered",
      yes: "Accept",
      no: "Decline",
      yesOp: "accept",
      noOp: "decline",
      lines: [
        { text: `${offer.from} offers you peace.`, tone: "main" },
        ...termsLines(extras, offer.terms).map((text, index) => ({ text, tone: "terms", gap: index === 0 })),
      ],
    })),
  };
};

export const register = (ctx) => {
  const { engine, emit, storage } = ctx;
  void loadExtras(ctx).catch((error) => emit("log", { category: "country", message: `The country panel's helpers could not be built: ${error?.message ?? error}` }));
  if (ctx.standIn) {
    ctx.addStandIn(({ tool, text }) => {
      if (tool !== "submit_country_stat_sheet") return null;
      const buckets = [...new Set([...String(text).matchAll(/\[M(\d+)\]/g)].map((match) => match[1]))];
      const each = Math.max(1, Math.round(66_000_000 / Math.max(1, buckets.length)));
      const rows = buckets.length ? buckets.map((index) => `${index}~core~${each}~38500`) : ["core~mainland~66000000~38500"];
      const calibration = { mode: "historical_start", historyAuthorityCutoff: "2016", basis: "Stand-in figures for a native test." };
      return {
        args: {
          capital: "Paris",
          continent: "Europe",
          government: "Semi-presidential republic",
          leader: "François Hollande",
          stability: 71,
          indices: { sovereignty: 82, foodAutonomy: 88, energyAutonomy: 54, economicIndependence: 70, internalSecurity: 66, internationalReputation: 78 },
          territorialMacroComponentsText: rows.join("\n"),
          populationCalibration: calibration,
          economicCalibration: { ...calibration, anchorYear: 2016, anchorCurrency: "EUR", nominalGdpBillions: 2230, nominalGdpPerCapita: 33500, rebasedGdpPerCapita2026Eur: 38500, divergenceEventIds: [] },
          economy: { gdpGrowth: 1.1, currency: "Euro", inflation: 0.3, unemployment: 10.1, publicDebt: 96.5, budgetBalance: -3.5 },
          gdpBreakdown: { agriculture: 2, industry: 19, services: 79 },
        },
      };
    });
  }

  const memoryCache = new Map();
  const generating = new Map();
  const historyCache = new Map();
  let militaryAsked = "";

  const rememberSheet = (key, entry) => {
    memoryCache.delete(key);
    memoryCache.set(key, entry);
    while (memoryCache.size > MAX_MEMORY_SHEETS) memoryCache.delete(memoryCache.keys().next().value);
  };

  const readStoredSheets = () => {
    try {
      return JSON.parse(storage.getItem(STORAGE_KEY)) ?? {};
    } catch {
      return {};
    }
  };

  const storeSheet = (key, entry) => {
    try {
      const componentCount = Array.isArray(entry?.sheet?.territorialComponents) ? entry.sheet.territorialComponents.length : 0;
      if (componentCount > MAX_LOCAL_CACHE_COMPONENTS) return;
      const all = readStoredSheets();
      all[key] = entry;
      const keys = Object.keys(all);
      if (keys.length > MAX_STORED_SHEETS) {
        for (const stale of keys.slice(0, keys.length - MAX_STORED_SHEETS)) delete all[stale];
      }
      storage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      return;
    }
  };

  const readPlayer = async () => {
    const game = await engine.gameState.readGameData({ force: false }).catch(() => ({}));
    const library = engine.getLibraryState?.() ?? {};
    return {
      code: cleanText(game?.country),
      date: String(game?.gameDate || game?.startDate || ""),
      startDate: String(game?.startDate || game?.gameDate || ""),
      round: Math.max(0, Math.trunc(Number(game?.round) || 0)),
      gameKey: String(library?.activeGameId || library?.activeGame?.id || game?.id || game?.name || engine.JSON_URLS.game || "game"),
    };
  };

  const readDefinition = async () => {
    try {
      const definition = await engine.statsSheet.loadStatSheetDefinition();
      const indexRows = definition?.custom
        ? engine.statsSheet.flattenStatSheetRows(definition).filter((row) => row.kind === "index")
        : engine.statsSheet.DEFAULT_STAT_INDEX_ROWS.map((row) => ({ ...row }));
      return { definition, indexRows, error: "" };
    } catch (error) {
      return {
        definition: { custom: false, sections: [] },
        indexRows: engine.statsSheet.DEFAULT_STAT_INDEX_ROWS.map((row) => ({ ...row })),
        error: error?.message || "Could not load this scenario's Stats definition.",
      };
    }
  };

  const withoutBackendFields = (sheet) => {
    if (!sheet || typeof sheet !== "object" || !("military" in sheet)) return sheet;
    const checked = { ...sheet };
    delete checked.military;
    return checked;
  };

  const sheetChecks = (extras) => {
    const { countryStats } = extras;
    const isValidStatSheet = (value, definition) => {
      const sheet = countryStats.finalizeCountryStatSheet(value);
      if (definition?.custom) return countryStats.isCompleteCustomCountryStatSheet(sheet, engine.statsSheet.statSheetKeys(definition));
      return countryStats.isCompleteCountryStatSheet(sheet) && extras.gameplaySchemas.validateGameplayPayload("countryStatSheet", withoutBackendFields(sheet)).valid;
    };
    const calibration = (value) => Math.max(0, Math.trunc(Number(value?.continuity?.populationCalibrationVersion) || 0));
    const needsCapAudit = (value) => Array.isArray(value?.territorialComponents)
      && value.territorialComponents.length === 64
      && calibration(value) < countryStats.COUNTRY_STATS_POPULATION_CALIBRATION_VERSION;
    const needsStartAudit = (value, player) => Boolean(
      value && player?.startDate && player?.date === player.startDate && Number(player?.round) <= 1
      && calibration(value) < countryStats.COUNTRY_STATS_POPULATION_CALIBRATION_VERSION,
    );
    return { isValidStatSheet, needsCapAudit, needsStartAudit };
  };

  const loadSheet = async ({ code, force = false, forceReassess = false, generate = true, signal, id }) => {
    const extras = await loadExtras(ctx);
    const { countryStats } = extras;
    const { isValidStatSheet, needsCapAudit, needsStartAudit } = sheetChecks(extras);
    const player = await readPlayer();
    const { definition, error: definitionError } = await readDefinition();
    if (definitionError) return { status: "definition-error", error: definitionError };
    const cacheKey = `${player.gameKey}:${code}`;
    let aiOverride = null;
    if (!force) {
      try {
        const world = await engine.gameState.readWorldStateView({ force: false });
        const persisted = world?.countryStats?.[code];
        const persistedIsValid = persisted && isValidStatSheet(persisted, definition);
        const capAudit = !definition.custom && persistedIsValid && needsCapAudit(persisted);
        const startAudit = !definition.custom && persistedIsValid && needsStartAudit(persisted, player);
        const nativeAudit = capAudit || startAudit;
        if (persistedIsValid && !nativeAudit) {
          rememberSheet(cacheKey, { date: player.date, sheet: persisted });
          return { status: "ready" };
        }
        if (persisted && typeof persisted === "object" && !nativeAudit) aiOverride = persisted;
        if (nativeAudit) aiOverride = null;
      } catch {
        aiOverride = aiOverride ?? null;
      }
      const cached = memoryCache.get(cacheKey) ?? readStoredSheets()[cacheKey];
      if (
        cached
        && isValidStatSheet(cached.sheet, definition)
        && (definition.custom || !needsCapAudit(cached.sheet))
        && (definition.custom || !needsStartAudit(cached.sheet, player))
      ) {
        const sheet = countryStats.mergeCountryStatPatch(cached.sheet, aiOverride);
        rememberSheet(cacheKey, { date: player.date, sheet });
        return { status: "ready" };
      }
      if (generating.has(code)) {
        if (!generate) return { status: "generating" };
        emit("country.sheet_loading", { call: id, target: code, waiting: engine.simulationStatus.isSimulationBusy() });
        return generating.get(code);
      }
      if (!generate) return { status: "idle" };
    }
    emit("country.sheet_loading", { call: id, target: code, waiting: engine.simulationStatus.isSimulationBusy() });
    const run = (async () => {
      try {
        if (!force) {
          const pending = await Promise.resolve(engine.gameplay.pendingCountryStatSheet(code)).catch(() => null);
          if (signal?.aborted) return { status: "aborted" };
          const usable = pending && isValidStatSheet(pending, definition)
            && (definition.custom || (!needsCapAudit(pending) && !needsStartAudit(pending, player)));
          if (usable) {
            const sheet = countryStats.finalizeCountryStatSheet(pending);
            rememberSheet(cacheKey, { date: player.date, sheet });
            return { status: "ready" };
          }
        }
        let generationName = code;
        try {
          const latestWorld = await engine.gameState.readWorldStateView({ force: false });
          const countries = await countryNameRows(ctx);
          const display = polityNameResolver(countries, latestWorld)(code);
          generationName = cleanText(latestWorld?.polityOverrides?.[code]?.name) || display || code;
        } catch {
          generationName = code;
        }
        const generated = await engine.gameplay.generateCountryStatSheet({ code, name: generationName, forceReassess, signal });
        if (definition.custom) {
          if (!countryStats.isCompleteCustomCountryStatSheet(generated, engine.statsSheet.statSheetKeys(definition))) {
            throw new Error("The scenario-defined stat sheet was incomplete.");
          }
        } else {
          const validation = extras.gameplaySchemas.validateGameplayPayload("countryStatSheet", withoutBackendFields(generated));
          if (!validation.valid) throw new Error(`The stat sheet failed validation: ${validation.error}`);
        }
        const sheet = countryStats.finalizeCountryStatSheet(generated);
        const entry = { date: player.date, sheet };
        rememberSheet(cacheKey, entry);
        storeSheet(cacheKey, entry);
        if (signal?.aborted) return { status: "aborted" };
        return { status: "ready" };
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return { status: "aborted" };
        return { status: "error", error: error?.message || "The stat sheet failed." };
      }
    })();
    generating.set(code, run);
    try {
      return await run;
    } finally {
      if (generating.get(code) === run) generating.delete(code);
    }
  };

  const economyView = (extras, { sheet, definition, indexRows, intelligence }) => {
    if (!sheet) return null;
    if (definition.custom) {
      const hidden = intelligence !== null ? ["intelligenceService"] : [];
      const values = sheet?.customStats || {};
      const sections = asArray(definition.sections)
        .map((section) => ({ ...section, stats: asArray(section.stats).filter((stat) => !hidden.includes(stat.key)) }))
        .filter((section) => section.stats.length > 0)
        .map((section) => ({
          title: `${section.icon || "◆"} ${section.label}`,
          stats: section.stats.map((stat) => {
            const numeric = Number(values[stat.key]);
            if (stat.kind === "index") {
              const bounded = clamp01(numeric);
              return { kind: "index", label: `${stat.icon ?? ""} ${stat.label}`, value: Number.isFinite(numeric) ? `${bounded}/100` : "—", bar: bounded, color: cssHex(stat.color || "#a1a1aa") };
            }
            return { kind: "value", label: `${stat.icon ?? ""} ${stat.label}`.toUpperCase(), value: formatCustomStatValue(stat, numeric), color: cssHex(stat.color || "#e7e7e9") };
          }),
        }));
      return { custom: true, intelligence, sections };
    }
    const raw = sheet?.gdpBreakdown ?? {};
    const parts = [
      { key: "agriculture", label: "Agriculture", color: "#22c55eff", value: clamp01(raw.agriculture) },
      { key: "industry", label: "Industry", color: "#3b82f6ff", value: clamp01(raw.industry) },
      { key: "services", label: "Services", color: "#f59e0bff", value: clamp01(raw.services) },
    ];
    const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
    const breakdown = parts.map((part) => ({ ...part, share: (part.value / total) * 100 }));
    const budgetNegative = Number(sheet?.economy?.budgetBalance) < 0;
    const totalPopulation = Number(sheet?.population?.total);
    const corePopulation = Number(sheet?.population?.coreIntegrated);
    const otherPopulation = Number(sheet?.population?.otherTerritories);
    const hasOtherTerritories = Number.isFinite(otherPopulation) && otherPopulation > 0;
    const wholePerCapita = Number(sheet?.economy?.gdpPerCapita);
    const corePerCapita = Number(sheet?.economy?.coreGdpPerCapita);
    const displayedPerCapita = hasOtherTerritories && Number.isFinite(corePerCapita) ? corePerCapita : wholePerCapita;
    const card = (label, value, sub, tone) => ({ label: label.toUpperCase(), value: String(compactEconomyValue(value) || "—"), sub: sub || "", tone });
    return {
      custom: false,
      intelligence,
      stability: { value: clamp01(sheet.stability), color: stabilityColor(clamp01(sheet.stability)) },
      indices: asArray(indexRows).map((row) => ({ label: `${row.icon} ${row.label}`, value: clamp01(sheet.indices?.[row.key]), color: cssHex(row.color) })),
      population: {
        total: formatPopulation(totalPopulation),
        scope: hasOtherTerritories ? `Core/integrated ${formatPopulation(corePopulation)} · Other territories ${formatPopulation(otherPopulation)}` : "",
      },
      cards: [
        card("GDP", formatEuroTotal(sheet.economy?.gdp), `Growth ${formatPercent(sheet.economy?.gdpGrowth, { signed: true })} · 2026-EUR eq.`, "#34d399ff"),
        card("GDP/capita", formatEuroPerCapita(displayedPerCapita), hasOtherTerritories ? `Core/integrated · Whole polity ${formatEuroPerCapita(wholePerCapita)}` : "Whole polity", "#e7e7e9ff"),
        card("Inflation", formatPercent(sheet.economy?.inflation), "", "#34d399ff"),
        card("Unemployment", formatPercent(sheet.economy?.unemployment), "", "#34d399ff"),
        card("Public debt", formatPercent(sheet.economy?.publicDebt), "of GDP", "#34d399ff"),
        card("Budget balance", formatPercent(sheet.economy?.budgetBalance, { signed: true }), `${budgetNegative ? "Deficit" : "Surplus"} · of GDP`, budgetNegative ? "#f87171ff" : "#34d399ff"),
      ],
      currency: cleanText(sheet.economy?.currency),
      breakdown,
    };
  };

  const militaryView = (extras, world, country) => {
    if (!world || !country) return null;
    let profile = null;
    try {
      profile = extras.militaryPower.militaryProfile(world, country);
    } catch {
      profile = null;
    }
    if (!profile) return null;
    let unrated = profile.power === null;
    if (!unrated && profile.counted) {
      try {
        unrated = extras.militaryRating.wantsRating(extras.militaryStats.militaryLookup(world)(country));
      } catch {
        unrated = false;
      }
    }
    if (unrated) void Promise.resolve(engine.gameplay.ensureMilitaryFigures([country], { reason: "its Military card" })).catch(() => {});
    const { figures, own } = profile;
    const RESOURCES_SHORT_FROM = extras.warResources.RESOURCES_SHORT_FROM;
    const marks = { quality: 50, technology: 50, spending: 50, manpowerShare: extras.militaryPower.MANPOWER_PERCENT, resources: RESOURCES_SHORT_FROM, land: 50, sea: 50, air: 50 };
    let worn = null;
    try {
      worn = extras.warSettings.warSettingsOf(world).mechanics.attrition ? extras.attrition.attritionOf(world?.attrition, country) : null;
    } catch {
      worn = null;
    }
    return {
      power: profile.power === null ? "—" : (Math.round(profile.power * 10) / 10).toLocaleString(),
      rows: MILITARY_FIGURE_ORDER.filter((key) => key !== "resources" || profile.supplied).map((key) => {
        const value = Number(figures?.[key]) || 0;
        const low = (key === "weariness" && value > 0) || (key === "resources" && value < RESOURCES_SHORT_FROM);
        return {
          label: MILITARY_FIGURE_LABELS[key],
          own: Boolean(own?.[key]),
          value: clamp01(value),
          mark: marks[key] === undefined ? -1 : clamp01(marks[key]),
          color: low ? MILITARY_WEARY_COLOR : own?.[key] ? MILITARY_OWN_COLOR : MILITARY_SHARED_COLOR,
          text: key === "manpowerShare" ? `${Math.round(value * 10) / 10}%` : `${Math.round(value)}/100`,
        };
      }),
      note: profile.counted
        ? "In colour: its own figures. In grey: what every country has. The mark on a bar is where every country stands."
        : "This scenario does not count countries' own military figures: every country fights with the same.",
      attrition: worn ? `Lost to attrition, the weather and being cut off: ${Number(worn.lastMen || 0).toLocaleString()} men last turn, ${Number(worn.warMen || 0).toLocaleString()} in this war.` : "",
      refill: profile.supplied && profile.refill !== null && profile.refill !== undefined ? `Its economy refills its war resources by about ${profile.refill} a month, less under a blockade.` : "",
    };
  };

  const institutionsView = (rows) => asArray(rows).map((entry) => {
    const institution = entry?.institution || {};
    const pending = asArray(entry?.cases).filter((item) => ["pending", "negotiating", "pending-approval"].includes(String(item?.status || "").toLowerCase()));
    const recent = [...asArray(entry?.history)].reverse()[0];
    const current = entry?.member;
    let label;
    if (current) label = `${current.status || "member"}${current.role && current.role !== "member" ? ` / ${current.role}` : ""}`;
    else {
      const last = [...asArray(entry?.history)].reverse().find(Boolean);
      if (!last) label = "historical";
      else if (["left", "withdrawn", "expelled"].includes(last.action)) label = `former member · ${last.action}`;
      else label = last.action || "historical";
    }
    return {
      name: cleanText(institution.name || institution.id),
      member: Boolean(current),
      label,
      detail: [current?.sinceDate ? `since ${current.sinceDate}` : "", pending.length ? `${pending.length} pending lifecycle matter${pending.length === 1 ? "" : "s"}` : "", recent?.date && !current ? `last change ${recent.date}` : ""].filter(Boolean).join(" · ") || (institution.kind || "institution"),
      pending: pending.slice(0, 2).map((item) => `• ${item.kind} · ${item.status}${item.requestedStatus ? ` · ${item.requestedStatus}` : ""}`),
    };
  });

  const politicsView = (extras, { profile, fallbackGovernment, fallbackLeader, intelligence, institutions }) => {
    const government = profile?.government || {};
    const form = cleanText(government.form || fallbackGovernment);
    const headOfState = officeholderName(government.headOfState || fallbackLeader || profile?.leader);
    const headOfGovernment = officeholderName(government.headOfGovernment);
    const governmentParties = extras.politicalPresentation.buildGovernmentPartyPresentation(profile);
    const landscape = extras.politicalPresentation.buildPoliticalLandscape(profile);
    const entryView = (party) => ({
      id: cleanText(party.id),
      name: cleanText(party.name),
      shortName: cleanText(party.shortName || party.name),
      valueText: party.displayValue || formatSupport(party.support),
      supportText: formatSupport(party.support),
      color: partyColor(party),
      chartPercent: Math.max(0, Number(party.chartPercent) || 0),
      isOther: Boolean(party.isOther),
      members: asArray(party.members).map((member) => ({ name: cleanText(member.name), support: formatSupport(member.support) })),
      unlistedText: party.unlistedSupport > 0.05 ? `${formatSupport(party.unlistedSupport)} is not individually represented in the current public political profile.` : "",
      ruling: Boolean(party.ruling),
      coalition: Boolean(party.coalition),
      supportApproximate: Boolean(party.supportApproximate),
      influenceApproximate: Boolean(party.influenceApproximate),
      displayValue: cleanText(party.displayValue),
      leader: cleanText(party.leader),
      kind: cleanText(party.kind),
      status: cleanText(party.status),
      ideology: listOf(party.ideology),
      publicDescription: cleanText(party.publicDescription),
      priorities: listOf(asArray(party.publicPriorities).length ? party.publicPriorities : party.goals),
      foreignPolicy: listOf(party.publicForeignPolicy),
    });
    return {
      government: (!form && !headOfState && !headOfGovernment && !governmentParties.names.length) ? null : {
        form,
        headOfState,
        headOfGovernment: headOfGovernment && headOfGovernment !== headOfState ? headOfGovernment : "",
        partiesLabel: governmentParties.names.length > 1 ? "Governing coalition:" : "Government:",
        parties: governmentParties.names.join(" | "),
      },
      landscape: asArray(landscape.entries).length ? {
        mode: landscape.mode,
        title: cleanText(landscape.title),
        subtitle: cleanText(landscape.subtitle),
        valueText: landscape.hasQuantitativeValues ? `${landscape.totalKnownPercent}% ${landscape.mappedLabel}` : "Qualitative",
        approximate: Boolean(landscape.hasQuantitativeValues && landscape.isApproximate),
        centerLabel: cleanText(landscape.centerLabel) || "Political",
        centerSubLabel: cleanText(landscape.centerSubLabel) || "landscape",
        slices: asArray(landscape.slices).map(entryView),
        entries: asArray(landscape.entries).map(entryView),
        governmentLabel: governmentParties.label,
        governmentNames: governmentParties.names.join(" | "),
      } : null,
      goals: listOf(profile?.goals).slice(0, 5),
      institutions: institutionsView(institutions),
      intelligence: intelligence ? {
        confidence: cleanText(intelligence.confidence),
        summary: cleanText(intelligence.summary),
        findings: asArray(intelligence.findings).map((finding) => ({ topic: cleanText(finding?.topic), text: cleanText(finding?.text) })),
        footer: [intelligence.source, intelligence.gatheredAt ? `Report ${intelligence.gatheredAt}` : "", intelligence.stale ? "Stale" : ""].filter(Boolean).join(" · "),
        stale: Boolean(intelligence.stale),
      } : null,
    };
  };

  const groupsView = async (extras, { world, target, isPlayer }) => {
    const features = featuresOf(ctx, extras);
    if (!featureOn(features, "groups") || !world || !target) return null;
    const entries = await regionCatalog(ctx);
    const catalog = new Map(asArray(entries).map((entry) => [entry.id, entry]));
    const ownerOf = (regionId) => world.regionOwnershipOverrides?.[regionId] || catalog.get(regionId)?.country || "";
    const rows = extras.groups.groupsOnTerritory(world, target, { ownerOf }).map((row) => {
      let bounds = null;
      for (const regionId of row.regionIds) {
        const entry = catalog.get(regionId);
        const box = entry?.bounds ?? (Number.isFinite(entry?.lng) && Number.isFinite(entry?.lat) ? [[entry.lng, entry.lat], [entry.lng, entry.lat]] : null);
        if (!box) continue;
        bounds = bounds
          ? [[Math.min(bounds[0][0], box[0][0]), Math.min(bounds[0][1], box[0][1])], [Math.max(bounds[1][0], box[1][0]), Math.max(bounds[1][1], box[1][1])]]
          : box;
      }
      const count = row.regionIds.length;
      return {
        name: cleanText(row.name),
        color: cssHex(row.color),
        held: count === 0 ? "Controls no area yet" : count === 1 ? "Controls 1 region" : `Controls ${count} regions`,
        description: cleanText(row.description),
        bounds: bounds ? [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]] : null,
        ours: Boolean(row.own && isPlayer),
      };
    });
    if (!rows.length) return null;
    return { title: isPlayer ? "👥 Groups on our territory" : "👥 Groups on its territory", rows };
  };

  const diplomacyView = (extras, { world, identity, target, viewer }) => {
    if (!world || !identity || !target) return null;
    const { canonicalKey, displayName } = identity;
    const canonical = canonicalKey(target);
    const targetKey = lowerText(canonical);
    if (!targetKey) return null;
    const history = world.simulationHistory;
    const relations = asArray(world.relations)
      .map((relation) => {
        const a = canonicalKey(relation?.a);
        const b = canonicalKey(relation?.b);
        if (lowerText(a) !== targetKey && lowerText(b) !== targetKey) return null;
        const counterpart = lowerText(a) === targetKey ? b : a;
        return { ...relation, counterpart, counterpartName: displayName(counterpart) };
      })
      .filter(Boolean)
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0) || left.counterpartName.localeCompare(right.counterpartName));
    const rank = { active: 0, suspended: 1, ended: 2, expired: 3 };
    const agreements = asArray(world.agreements)
      .map((agreement) => {
        const parties = asArray(agreement?.parties).map((party) => canonicalKey(party)).filter(Boolean);
        if (!parties.some((party) => lowerText(party) === targetKey)) return null;
        const counterparts = parties.filter((party) => lowerText(party) !== targetKey).map((party) => displayName(party));
        return { ...agreement, counterparts };
      })
      .filter(Boolean)
      .sort((left, right) => (rank[lowerText(left.status)] ?? 9) - (rank[lowerText(right.status)] ?? 9)
        || extras.gameDates.compareGameDates(right.lastUpdatedDate || right.startedDate || "", left.lastUpdatedDate || left.startedDate || ""));
    const wars = asArray(world.wars)
      .filter((war) => ["active", "ceasefire"].includes(lowerText(war?.status)))
      .map((war) => {
        const sideA = asArray(war?.sideA).map((party) => canonicalKey(party)).filter(Boolean);
        const sideB = asArray(war?.sideB).map((party) => canonicalKey(party)).filter(Boolean);
        const onA = sideA.some((party) => lowerText(party) === targetKey);
        const onB = sideB.some((party) => lowerText(party) === targetKey);
        if (!onA && !onB) return null;
        let timelineEventId = "";
        let timelineIsFirst = false;
        try {
          timelineEventId = cleanText(engine.turnReveal.warTimelineEventId(war, history));
          timelineIsFirst = Boolean(timelineEventId) && Boolean(engine.turnReveal.warTimelineEventOpensWar(war, history, timelineEventId));
        } catch {
          timelineEventId = "";
        }
        const sides = [asArray(war?.sideA), asArray(war?.sideB)];
        const mine = sides.findIndex((members) => members.some((member) => fold(member) === fold(viewer)));
        const leads = [cleanText(sides[0][0]), cleanText(sides[1][0])].filter(Boolean);
        const weary = leads
          .map((name) => ({ name, value: Math.round(extras.warWeariness.wearinessOf(world?.warWeariness, name)) }))
          .filter((entry) => entry.value > 0);
        const theirs = mine >= 0 ? cleanText(sides[1 - mine][0]) : "";
        const fought = ["active", "ceasefire"].includes(fold(war?.status || "active"));
        const started = extras.gameDates.formatGameDateReadable(war?.startedDate, "D MMM YYYY") || cleanText(war?.startedDate);
        const opponents = (onA ? sideB : sideA).map((party) => displayName(party));
        const allies = (onA ? sideA : sideB).filter((party) => lowerText(party) !== targetKey).map((party) => displayName(party));
        const causeText = warCauseForDisplay(war?.cause);
        return {
          id: cleanText(war.id),
          sortDate: war.lastUpdatedDate || war.startedDate || "",
          title: `vs ${opponents.length ? opponents.join(" · ") : "Unknown opponent"}`,
          subtitle: `${war.title || "Canonical conflict"}${started ? ` · since ${started}` : ""}`,
          allies: allies.length ? `Fighting alongside ${allies.join(" · ")}` : "",
          cause: causeText ? `Why it began: ${causeText}` : "",
          timelineEventId,
          timelineText: timelineEventId ? (timelineIsFirst ? "See how it began on the timeline" : "See it on the timeline") : "",
          weariness: weary.length ? weary.map((entry) => `${entry.name} ${entry.value}`).join(" · ") : "",
          canPropose: mine >= 0 && fought && Boolean(theirs),
          theirs,
          status: prettyToken(war.status || "active"),
          tone: cssHex(warStatusTone(war.status)),
        };
      })
      .filter(Boolean)
      .sort((left, right) => extras.gameDates.compareGameDates(right.sortDate, left.sortDate));
    const viewerKey = canonicalKey(viewer) || cleanText(viewer);
    const subordination = viewerKey ? extras.puppets.puppetSummaryFor(world, viewerKey, canonical) : null;
    const subordinates = viewerKey
      ? extras.puppets.livePuppetsFor(world, viewerKey)
        .filter((row) => lowerText(canonicalKey(row?.overlord)) === targetKey)
        .map((row) => {
          const facts = [
            row.loyaltyBand,
            row.startedDate ? `Since ${row.startedDate}` : "",
            row.secrecy === "covert" ? "Covert" : "Openly known",
            row.fromIntelligence ? "From intelligence" : "",
          ].filter(Boolean);
          return {
            name: displayName(row?.puppet),
            facts: facts.join(" · "),
            badge: prettyToken(extras.puppets.puppetKindLabel(row?.kind)),
            tone: cssHex(row.secrecy === "covert" ? "#d4d4d8" : "#60a5fa"),
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name))
      : [];
    const reports = (() => {
      try {
        return extras.afterActionData.reportsFor(world?.battlefields, viewer).map((report) => ({
          name: cleanText(report.name),
          ended: `Ended ${extras.gameDates.formatGameDateReadable(report.closedDate) || report.closedDate}`,
        }));
      } catch {
        return [];
      }
    })();
    const key = fold(target);
    const reparations = extras.peaceTerms.normalizeReparations(world?.reparations)
      .filter((entry) => fold(entry.payer) === key || fold(entry.receiver) === key)
      .map((entry) => {
        const years = Math.max(0, entry.days - entry.paidDays) / 365;
        return `${entry.payer} pays ${entry.receiver} ${Math.round(entry.share * 1000) / 10}% of its economy a year, for ${Math.round(years * 10) / 10} more years.`;
      });
    return {
      metrics: [
        { label: "RELATIONS", value: String(relations.length), tone: "#60a5faff" },
        { label: "ACTIVE AGREEMENTS", value: String(agreements.filter((agreement) => lowerText(agreement.status) === "active").length), tone: "#34d399ff" },
        { label: "CONFLICTS", value: String(wars.length), tone: wars.length ? "#f87171ff" : "#94a3b8ff" },
      ],
      subordination: subordination ? {
        headline: cleanText(subordination.headline),
        meaning: cleanText(subordination.meaning),
        facts: asArray(subordination.facts).map(cleanText),
        provenance: cleanText(subordination.provenance),
      } : null,
      subordinates,
      relations: relations.map((relation) => ({
        name: relation.counterpartName,
        summary: cleanText(relation.summary) || "Tracked bilateral relationship.",
        score: formatRelationScore(relation.score),
        scoreValue: Math.max(-100, Math.min(100, Number(relation.score) || 0)),
        status: prettyToken(relationStatusForScore(relation.score)),
        tone: cssHex(relationTone(relation.score)),
      })),
      agreements: agreements.map((agreement) => ({
        title: cleanText(agreement.title) || "Untitled agreement",
        detail: `${prettyToken(agreement.type || "other")} · ${agreement.counterparts.length ? agreement.counterparts.join(" · ") : "Multilateral agreement"}`,
        updated: agreement.lastUpdatedDate ? `Updated ${agreement.lastUpdatedDate}` : "",
        status: prettyToken(agreement.status || "active"),
        tone: cssHex(agreementStatusTone(agreement.status)),
      })),
      wars,
      reports,
      reparations,
      territoryChoices: [
        { key: extras.peaceTerms.TERRITORY_RESTORED, label: "The old borders: every region goes back" },
        { key: extras.peaceTerms.TERRITORY_AS_HELD, label: "Each side keeps the ground it holds" },
      ],
      reparationChoices: REPARATION_CHOICES.map((choice) => ({ ...choice })),
    };
  };

  const trackingSettingsOf = async (extras, player) => {
    const { countryStats } = extras;
    const fallback = () => {
      try {
        const all = JSON.parse(storage.getItem(TRACKING_STORAGE_KEY) || "{}");
        return countryStats.normalizeCountryStatsTracking(all?.[player.gameKey], { playerCountry: player.code });
      } catch {
        return countryStats.normalizeCountryStatsTracking({}, { playerCountry: player.code });
      }
    };
    try {
      const world = await engine.gameState.readWorldStateView({ force: false });
      const canonical = world?.countryStatsTracking && typeof world.countryStatsTracking === "object" && !Array.isArray(world.countryStatsTracking);
      const next = canonical ? countryStats.normalizeCountryStatsTracking(world.countryStatsTracking, { playerCountry: player.code }) : fallback();
      if (!canonical && (next.intervalMonths > 0 || next.trackedPolities.length > 0)) {
        try {
          const raw = await engine.gameState.readWorldState({ force: false });
          await engine.gameState.writeWorldState({ ...(raw || {}), countryStatsTracking: next });
        } catch {
          return next;
        }
      }
      return next;
    } catch {
      return fallback();
    }
  };

  const persistTracking = async (extras, player, next) => {
    if (engine.simulationStatus.isSimulationBusy()) return false;
    const { countryStats } = extras;
    const normalized = countryStats.normalizeCountryStatsTracking(next, { playerCountry: player.code });
    try {
      const all = JSON.parse(storage.getItem(TRACKING_STORAGE_KEY) || "{}");
      all[player.gameKey] = normalized;
      storage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(all));
    } catch {
      normalized.intervalMonths = normalized.intervalMonths ?? 0;
    }
    try {
      const world = await engine.gameState.readWorldState({ force: false });
      const prior = countryStats.normalizeCountryStatsTracking(world?.countryStatsTracking, { playerCountry: player.code });
      const canonical = countryStats.normalizeCountryStatsTracking({
        ...prior,
        intervalMonths: normalized.intervalMonths,
        trackedPolities: normalized.trackedPolities,
      }, { playerCountry: player.code });
      await engine.gameState.writeWorldState({ ...(world || {}), countryStatsTracking: canonical });
    } catch (error) {
      emit("log", { category: "country", message: `Tracking settings were kept on this device only: ${error?.message ?? error}` });
    }
    return true;
  };

  const trackingSummary = (extras, settings, identity) => {
    const max = extras.countryStats.COUNTRY_STATS_TRACKING_MAX_POLITIES;
    const names = asArray(settings?.trackedPolities).map((key) => (identity ? identity.displayName(key) : cleanText(key))).filter(Boolean);
    return {
      line: `Auto-refresh: ${countryStatsTrackingIntervalLabel(settings?.intervalMonths)} · Tracked: ${asArray(settings?.trackedPolities).length}/${max}`,
      preview: !names.length ? "No tracked countries yet" : names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3} more`,
    };
  };

  const view = async ({ target: requested = "" } = {}) => {
    const extras = await loadExtras(ctx);
    const player = await readPlayer();
    const { definition, indexRows, error: definitionError } = await readDefinition();
    const world = await engine.gameState.readWorldStateView({ force: false }).catch(() => null);
    const identity = identityIndexFor(extras, world);
    const asked = cleanText(requested);
    const target = asked ? (identity?.canonicalKey(asked) || asked) : player.code;
    const busy = engine.simulationStatus.isSimulationBusy();
    const base = {
      player: { code: player.code, date: player.date, round: player.round, gameKey: player.gameKey },
      target,
      custom: Boolean(definition.custom),
      economyTab: definition.custom ? "📊 National" : "📈 Economy",
      definitionError,
      turnRunning: busy,
      turnRunningNote: TURN_RUNNING_NOTE,
      refreshHint: definition.custom ? "Uses 1 request." : "Uses a request only if something has changed since the last assessment.",
    };
    if (!target) return { ...base, empty: "No active game. Start one to see national statistics." };
    const countries = await countryNameRows(ctx);
    const displayName = polityNameResolver(countries, world)(target);
    const polity = world?.polityOverrides?.[target] ?? null;
    const isPlayer = Boolean(target) && target.toUpperCase() === String(player.code).toUpperCase();
    const landless = world ? Boolean(engine.gameState.isPolityLandless(world, player.code)) : false;
    const customFlags = await engine.assets.getNationFlags().catch(() => ({}));
    const baseTags = await engine.assets.getNationTags().catch(() => ({}));
    const flagUrl = customFlags?.[target] || polity?.flag || (isPlayer && landless ? "" : engine.countryFlags.flagImageUrlFromGid(target));
    const resolvedKey = identity ? (identity.canonicalKey(target) || target) : target;
    const cacheKey = `${player.gameKey}:${target}`;
    const cachedSheet = memoryCache.get(cacheKey)?.sheet ?? null;
    const headerSheet = cachedSheet || world?.countryStats?.[resolvedKey] || world?.countryStats?.[target] || null;
    let profile = null;
    let intelligenceReport = null;
    if (world) {
      try {
        const intercepts = await engine.gameplay.readOpenedIntercepts();
        const playerView = extras.politicalKnowledge.buildPlayerPoliticalKnowledgeView(world, target, { viewerPolity: player.code, intercepts });
        profile = playerView?.public || null;
        intelligenceReport = playerView?.intelligence || null;
      } catch {
        profile = null;
      }
      if (!profile) {
        try {
          profile = extras.politicalKnowledge.buildPublicPoliticalView(world, target);
        } catch {
          profile = null;
        }
      }
    }
    const politicalKey = profile?.polityKey || resolvedKey || target;
    const tags = world ? asArray(extras.countryTags.resolveCountryTags(baseTags, world, politicalKey)) : [];
    const powerRows = world?.powerStatus?.byPolity || (world?.powerStatus && typeof world.powerStatus === "object" ? world.powerStatus : {});
    const hasTier = Boolean(politicalKey) && Object.keys(powerRows || {}).some((key) => key !== "schemaVersion" && String(key).toLowerCase() === String(politicalKey).toLowerCase());
    const tier = hasTier ? extras.powerStatus.powerTierForPolity(world, politicalKey) : "";
    let intelligence = null;
    try {
      intelligence = world ? engine.spycraft.intelligenceOf(world, target) : null;
    } catch {
      intelligence = null;
    }
    let institutions = [];
    try {
      institutions = world ? engine.institutionLifecycle.institutionPortfolioForPolity(world, target, { viewerPolity: player.code }) : [];
    } catch {
      institutions = [];
    }
    const settings = await trackingSettingsOf(extras, player);
    const sheet = cachedSheet;
    return {
      ...base,
      name: cleanText(polity?.name) || displayName || target,
      isPlayer,
      flag: flagFile(ctx, flagUrl),
      initials: String(target).replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??",
      header: {
        place: headerSheet ? [headerSheet.capital, headerSheet.continent].filter(Boolean).join(" · ") : "",
        government: headerSheet && !profile ? cleanText(headerSheet.government) : "",
        leader: headerSheet && !profile && headerSheet.leader ? `Leader: ${headerSheet.leader}` : "",
        tier: POWER_TIER_LABELS[tier] || "",
        tags: tags.map(cleanText).filter(Boolean),
      },
      politics: politicsView(extras, {
        profile,
        fallbackGovernment: headerSheet?.government || "",
        fallbackLeader: headerSheet?.leader || "",
        intelligence: intelligenceReport,
        institutions,
      }),
      groups: await groupsView(extras, { world, target, isPlayer: Boolean(player.code) && target === player.code }),
      diplomacy: world ? diplomacyView(extras, { world, identity, target, viewer: player.code }) : null,
      economy: economyView(extras, { sheet, definition, indexRows, intelligence }),
      military: world && sheet ? militaryView(extras, world, resolvedKey || target) : null,
      tracking: trackingSummary(extras, settings, identity),
      generating: generating.has(target),
    };
  };

  const rankingView = async ({ target = "", metricKey = "", showAll = false } = {}) => {
    const extras = await loadExtras(ctx);
    const player = await readPlayer();
    const { definition } = await readDefinition();
    const world = (await engine.gameState.readWorldStateView({ force: false }).catch(() => null)) ?? {};
    const identity = identityIndexFor(extras, world);
    const catalog = await regionCatalog(ctx);
    const flags = await engine.assets.getNationFlags().catch(() => ({}));
    const stockNames = Object.values(extras.countryNames.default ?? {});
    const metrics = extras.countryRanking.rankingMetricsFor({ definition, rows: definition?.custom ? engine.statsSheet.flattenStatSheetRows(definition) : [], world });
    const countries = extras.statsHistoricalTracking.buildHistoricalTrackingCandidateRows({ world, playerCountry: player.code, currentCountry: target, index: identity, stockNames }).rows;
    const opening = extras.countryRanking.openingMetric({ world, countries, metrics, catalog });
    const metric = metrics.find((entry) => entry.key === metricKey) ?? opening;
    if (!metric) return { metrics: [], rows: [] };
    const ranking = extras.countryRanking.buildRanking({ world, countries, metric, catalog });
    if (metric.key === "military") {
      const ranked = new Set(ranking.rows.map((row) => row.key));
      let lookup = null;
      try {
        lookup = extras.warSettings.warSettingsOf(world).mechanics.military ? extras.militaryStats.militaryLookup(world) : null;
      } catch {
        lookup = null;
      }
      const unrated = countries.map((country) => country.key).filter((key) => !ranked.has(key) || (lookup !== null && extras.militaryRating.wantsRating(lookup(key))));
      const asked = unrated.join("|");
      if (unrated.length > 0 && asked !== militaryAsked) {
        militaryAsked = asked;
        void Promise.resolve(engine.gameplay.ensureMilitaryFigures(unrated, { reason: "the military ranking" })).catch(() => {});
      }
    }
    const formatValue = (value) => {
      if (metric.stat) return formatCustomStatValue(metric.stat, value);
      if (metric.kind === "money") return formatEuroTotal(value);
      if (metric.kind === "money each") return formatEuroPerCapita(value);
      if (metric.kind === "index") return String(Math.round(value));
      if (metric.kind === "weight") return (Math.round(value * 10) / 10).toLocaleString();
      return formatCompactNumber(value);
    };
    const shown = showAll ? ranking.rows : ranking.rows.slice(0, RANKING_ROWS_FIRST);
    return {
      metric: metric.key,
      metrics: metrics.map((entry) => ({ key: entry.key, label: entry.label, selected: entry.key === metric.key })),
      rows: shown.map((row) => {
        const flagUrl = flags?.[row.key] || world?.polityOverrides?.[row.key]?.flag || engine.countryFlags.flagImageUrlFromGid(row.key);
        return {
          key: row.key,
          rank: String(row.rank),
          label: row.label,
          value: formatValue(row.value),
          bar: ranking.most > 0 ? Math.max(2, Math.round((Math.abs(row.value) / ranking.most) * 100)) : 0,
          flag: flagFile(ctx, flagUrl),
          mine: Boolean(player.code) && row.key === player.code,
          open: row.key === target,
        };
      }),
      more: ranking.rows.length > shown.length,
      empty: ranking.rows.length === 0 ? "No country has this figure yet." : "",
      unranked: ranking.unranked > 0
        ? `${metric.sheet
          ? "Countries that have not been assessed are left out. Open a country's sheet, or track it, to add it here."
          : metric.key === "military"
            ? "Countries whose military has not been rated yet are left out until the AI rates them against the others."
            : "Countries the game has no figure for are left out."} (${ranking.rows.length}/${ranking.total})`
        : "",
    };
  };

  const historyMetricValue = (sample, key) => sample?.[key] ?? sample?.indices?.[key] ?? sample?.customStats?.[key];

  const metricGroupsFor = (indexRows, definition) => {
    if (definition?.custom) {
      return asArray(definition.sections).map((section) => ({
        key: section.key,
        label: section.label,
        icon: section.icon || "◆",
        metrics: asArray(section.stats).map((stat) => ({
          key: stat.key,
          label: stat.label,
          unit: customMetricUnit(stat),
          unitLabel: customMetricUnitLabel(stat),
          color: stat.color || "#a1a1aa",
          format: (value) => formatCustomStatValue(stat, value),
          bounded01: stat.kind === "index" || (Number(stat.minimum) === 0 && Number(stat.maximum) === 100),
          nonNegative: Number.isFinite(Number(stat.minimum)) && Number(stat.minimum) >= 0,
        })),
      }));
    }
    return [
      { key: "headline", label: "Headline economy", icon: "◈", metrics: [
        { key: "gdp", label: "GDP", unit: "gdp", color: "#34d399", format: formatEuroTotal },
        { key: "gdpPerCapita", label: "GDP per capita", unit: "gdpPerCapita", color: "#e7e7e9", format: formatEuroPerCapita },
        { key: "population", label: "Population", unit: "population", color: "#94a3b8", format: formatPopulation },
      ] },
      { key: "economy", label: "Economic conditions", icon: "↗", metrics: [
        { key: "gdpGrowth", label: "GDP growth", unit: "economicPercent", color: "#34d399", format: (value) => formatPercent(value, { signed: true }) },
        { key: "inflation", label: "Inflation", unit: "economicPercent", color: "#f59e0b", format: formatPercent },
        { key: "unemployment", label: "Unemployment", unit: "economicPercent", color: "#60a5fa", format: formatPercent },
        { key: "publicDebt", label: "Public debt", unit: "economicPercent", color: "#94a3b8", format: formatPercent },
        { key: "budgetBalance", label: "Budget balance", unit: "economicPercent", color: "#f87171", format: (value) => formatPercent(value, { signed: true }) },
      ] },
      { key: "strategic", label: "Strategic indices", icon: "⚑", metrics: [
        { key: "stability", label: "National stability", unit: "index", color: "#22c55e", format: (value) => `${Math.round(Number(value) || 0)}` },
        ...asArray(indexRows).map((row) => ({ key: row.key, label: row.label, unit: "index", color: row.color, format: (value) => `${Math.round(Number(value) || 0)}%` })),
      ] },
      { key: "sectors", label: "GDP sectors", icon: "▦", metrics: [
        { key: "agriculture", label: "Agriculture", unit: "sector", color: "#22c55e", format: formatPercent },
        { key: "industry", label: "Industry", unit: "sector", color: "#3b82f6", format: formatPercent },
        { key: "services", label: "Services", unit: "sector", color: "#f59e0b", format: formatPercent },
      ] },
    ];
  };

  const ADVANCED_UNIT_LABELS = {
    gdp: "GDP · 2026-EUR equivalent",
    gdpPerCapita: "GDP per capita · 2026-EUR equivalent",
    population: "Population",
    economicPercent: "Percent",
    index: "Index · 0–100",
    sector: "Share of GDP · %",
  };

  const historyFor = async (extras, target, player, fallbackSheet) => {
    const key = `${player.gameKey}:${target}:${player.date}:${player.round}`;
    if (historyCache.has(key)) return historyCache.get(key);
    const { countryStats } = extras;
    const run = (async () => {
      const [world, snapshots] = await Promise.all([
        engine.gameState.readWorldStateView({ force: false }),
        engine.readJson(engine.JSON_URLS.snapshots, { defaultValue: [], clone: false }).catch(() => []),
      ]);
      const persistent = countryStats.normalizeCountryStatsHistory(world?.countryStatsHistory);
      const persistentCount = (persistent[target] || []).length;
      let recovered = {};
      for (const snapshot of asArray(snapshots)) {
        const snapshotWorld = snapshot?.state?.world || {};
        const snapshotKey = resolveIdentity(extras, target, snapshotWorld) || target;
        const snapshotSheet = snapshotWorld?.countryStats?.[snapshotKey] || snapshotWorld?.countryStats?.[target];
        const sample = countryStats.buildCountryStatHistorySample(snapshotSheet, {
          date: snapshot?.state?.game?.gameDate || snapshot?.fromDate || "",
          round: snapshot?.state?.game?.round ?? snapshot?.round ?? 0,
        });
        if (sample) recovered = countryStats.appendCountryStatHistorySample(recovered, target, sample);
      }
      let merged = countryStats.mergeCountryStatsHistory(persistent, recovered);
      const currentKey = resolveIdentity(extras, target, world) || target;
      const currentSheet = world?.countryStats?.[currentKey] || world?.countryStats?.[target] || fallbackSheet;
      merged = countryStats.appendCountryStatHistorySample(merged, target, currentSheet, { date: player.date, round: player.round });
      const stored = merged[target] || [];
      const samples = countryStats.withCurrentCountryStatSample(stored, currentSheet, { date: player.date, round: player.round });
      const recoveredCount = Math.max(0, stored.length - persistentCount);
      const persistedSeries = persistent[target] || [];
      if (JSON.stringify(persistedSeries) !== JSON.stringify(stored)) {
        try {
          const latestWorld = await engine.gameState.readWorldState({ force: false });
          let latestHistory = countryStats.mergeCountryStatsHistory(latestWorld?.countryStatsHistory, recovered);
          const latestKey = resolveIdentity(extras, target, latestWorld) || target;
          latestHistory = countryStats.appendCountryStatHistorySample(
            latestHistory,
            target,
            latestWorld?.countryStats?.[latestKey] || latestWorld?.countryStats?.[target] || currentSheet,
            { date: player.date, round: player.round },
          );
          await engine.gameState.writeWorldState({ ...latestWorld, countryStatsHistory: latestHistory });
        } catch (error) {
          emit("log", { category: "country", message: `Rollback history backfill could not be kept: ${error?.message ?? error}` });
        }
      }
      return { samples, recoveredCount, persistentCount };
    })();
    historyCache.set(key, run);
    run.catch(() => historyCache.delete(key));
    return run;
  };

  const chartView = async ({ target = "", metricKeys = [], range = "all", loading = false } = {}) => {
    const extras = await loadExtras(ctx);
    const player = await readPlayer();
    const { definition, indexRows } = await readDefinition();
    const groups = metricGroupsFor(indexRows, definition);
    const byKey = Object.fromEntries(groups.flatMap((group) => group.metrics.map((metric) => [metric.key, metric])));
    const firstKey = groups.flatMap((group) => group.metrics)[0]?.key;
    let keys = asArray(metricKeys).filter((key) => byKey[key]);
    if (!keys.length && firstKey) keys = [firstKey];
    const selected = keys.map((key) => byKey[key]).filter(Boolean);
    const selectedUnit = selected[0]?.unit || "gdp";
    const world = await engine.gameState.readWorldStateView({ force: false }).catch(() => null);
    const countries = await countryNameRows(ctx);
    const displayName = polityNameResolver(countries, world)(target);
    const polity = world?.polityOverrides?.[target] ?? null;
    const customFlags = await engine.assets.getNationFlags().catch(() => ({}));
    const isPlayer = target.toUpperCase() === String(player.code).toUpperCase();
    const landless = world ? Boolean(engine.gameState.isPolityLandless(world, player.code)) : false;
    const flagUrl = customFlags?.[target] || polity?.flag || (isPlayer && landless ? "" : engine.countryFlags.flagImageUrlFromGid(target));
    const base = {
      countryName: cleanText(polity?.name) || displayName || target,
      flag: flagFile(ctx, flagUrl),
      initials: String(target).replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??",
      keys,
      selectedCount: `Selected ${keys.length}/4`,
      title: selected.map((metric) => metric.label).join(" · "),
      unitLabel: selected[0]?.unitLabel || ADVANCED_UNIT_LABELS[selectedUnit] || "Value",
      legend: selected.map((metric) => ({ label: metric.label, color: cssHex(metric.color) })),
      groups: groups.map((group) => ({
        title: `${group.icon} ${group.label}`,
        metrics: group.metrics.map((metric) => ({
          key: metric.key,
          label: metric.label,
          unit: metric.unit,
          color: cssHex(metric.color),
          checked: keys.includes(metric.key),
          compatible: !selected.length || selectedUnit === metric.unit || keys.includes(metric.key),
        })),
      })),
    };
    const untouched = "0 permanent samples. A completed turn that changes these figures is recorded automatically.";
    if (loading) {
      return { ...base, status: "loading", error: "", sampleSpan: "No history yet", snapshots: "0 snapshots", chart: null, emptyText: "Loading campaign history…", summary: [], campaign: untouched };
    }
    let history;
    try {
      history = await historyFor(extras, target, player, memoryCache.get(`${player.gameKey}:${target}`)?.sheet ?? null);
    } catch (error) {
      return { ...base, status: "error", error: error?.message || "Historical Stats could not be loaded.", sampleSpan: "No history yet", snapshots: "0 snapshots", chart: null, summary: [], campaign: untouched };
    }
    const visible = extras.statsHistoricalTracking.historySamplesInRange(history.samples, range);
    const formatHistoryDate = (value, { compact = false } = {}) => {
      const text = String(value || "");
      const parts = extras.gameDates.parseGameDate(text);
      if (!parts) return text || "Unknown date";
      if (parts.year < 1000) return extras.gameDates.formatGameDateReadable(text, compact ? "MMM YYYY" : "D MMM YYYY");
      const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
      return new Intl.DateTimeFormat(undefined, compact
        ? { month: "short", year: "numeric", timeZone: "UTC" }
        : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
    };
    const dateMs = (value) => {
      const day = extras.gameDates.gameDateDayNumber(value);
      return day === null ? NaN : day * 86400000;
    };
    const sampleSpan = visible.length > 1
      ? `${formatHistoryDate(visible[0].date, { compact: true })} – ${formatHistoryDate(visible[visible.length - 1].date, { compact: true })}`
      : visible[0] ? formatHistoryDate(visible[0].date, { compact: true }) : "No history yet";
    const valid = visible.filter((sample) => selected.some((metric) => Number.isFinite(Number(historyMetricValue(sample, metric.key)))));
    let chart = null;
    if (valid.length && selected.length) {
      const width = 900;
      const height = 470;
      const pad = { left: 78, right: 34, top: 34, bottom: 58 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = height - pad.top - pad.bottom;
      const times = valid.map((sample) => dateMs(sample.date)).filter(Number.isFinite);
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const timeSpan = Math.max(1, maxTime - minTime);
      const values = valid.flatMap((sample) => selected.map((metric) => Number(historyMetricValue(sample, metric.key))).filter(Number.isFinite));
      let minValue = Math.min(...values);
      let maxValue = Math.max(...values);
      const unit = selected[0]?.unit;
      if (unit === "index" || unit === "sector" || selected[0]?.bounded01) {
        minValue = 0;
        maxValue = 100;
      } else {
        const span = Math.max(0.0001, maxValue - minValue);
        const padding = span * 0.12;
        minValue -= padding;
        maxValue += padding;
        if (unit === "population" || unit === "gdp" || unit === "gdpPerCapita" || selected[0]?.nonNegative) minValue = Math.max(0, minValue);
        if (minValue === maxValue) {
          minValue -= Math.abs(minValue || 1) * 0.08;
          maxValue += Math.abs(maxValue || 1) * 0.08;
        }
      }
      const valueSpan = Math.max(0.0001, maxValue - minValue);
      const xFor = (sample) => pad.left + ((dateMs(sample.date) - minTime) / timeSpan) * plotWidth;
      const yFor = (value) => pad.top + plotHeight - ((Number(value) - minValue) / valueSpan) * plotHeight;
      const axisFormat = selected[0]?.format || ((value) => String(value));
      const yTicks = Array.from({ length: 5 }, (_, index) => minValue + ((maxValue - minValue) * index) / 4).reverse()
        .map((tick, index, all) => ({ y: pad.top + (plotHeight * index) / Math.max(1, all.length - 1), label: axisFormat(tick), solid: index === all.length - 1 }));
      const xIndexes = [...new Set(Array.from({ length: Math.min(5, valid.length) }, (_, index) =>
        Math.round((index * (valid.length - 1)) / Math.max(1, Math.min(5, valid.length) - 1))))];
      chart = {
        width,
        height,
        plot: [pad.left, pad.top, plotWidth, plotHeight],
        unitLabel: selected[0]?.unitLabel || ADVANCED_UNIT_LABELS[unit] || "Value",
        yTicks,
        xTicks: xIndexes.map((index) => ({ x: xFor(valid[index]), label: formatHistoryDate(valid[index].date, { compact: true }) })),
        series: selected.map((metric) => {
          const runs = [];
          let current = [];
          for (const sample of valid) {
            const value = Number(historyMetricValue(sample, metric.key));
            if (!Number.isFinite(value)) {
              if (current.length) runs.push(current);
              current = [];
              continue;
            }
            current.push([xFor(sample), yFor(value)]);
          }
          if (current.length) runs.push(current);
          return { color: cssHex(metric.color), runs };
        }),
        dots: valid.length <= 24,
        samples: valid.map((sample) => ({
          x: xFor(sample),
          date: formatHistoryDate(sample.date).toUpperCase(),
          values: selected.map((metric) => {
            const value = Number(historyMetricValue(sample, metric.key));
            return Number.isFinite(value) ? { label: metric.label, color: cssHex(metric.color), text: metric.format(value), y: yFor(value) } : null;
          }).filter(Boolean),
        })),
      };
    }
    const first = visible[0];
    const last = visible[visible.length - 1];
    const summary = first && last ? selected.map((metric) => {
      const start = Number(historyMetricValue(first, metric.key));
      const end = Number(historyMetricValue(last, metric.key));
      const delta = Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
      const deltaText = delta == null
        ? "—"
        : String(metric.unit || "").startsWith("custom:")
          ? `${delta > 0 ? "+" : ""}${metric.format(delta)}`
          : metric.unit === "gdp"
            ? formatEuroTotal(delta)
            : metric.unit === "gdpPerCapita"
              ? formatEuroPerCapita(delta)
              : metric.unit === "population"
                ? formatCompactNumber(delta)
                : `${delta > 0 ? "+" : ""}${Math.round(delta * 10) / 10}${metric.unit === "index" ? "" : " pp"}`;
      return {
        label: metric.label.toUpperCase(),
        color: cssHex(metric.color),
        value: metric.format(end),
        delta: `${deltaText} over range`,
        tone: delta == null ? "#ffffff4d" : delta > 0 ? "#86efacff" : delta < 0 ? "#fca5a5ff" : "#ffffff6b",
      };
    }) : [];
    return {
      ...base,
      status: "ready",
      error: "",
      sampleSpan,
      snapshots: `${visible.length} snapshot${visible.length === 1 ? "" : "s"}`,
      chart,
      emptyText: "No historical samples are available for this selection yet.",
      summary,
      campaign: `${history.persistentCount} permanent sample${history.persistentCount === 1 ? "" : "s"}${history.recoveredCount > 0 ? ` · ${history.recoveredCount} recovered from rollback snapshots` : ""}. A completed turn that changes these figures is recorded automatically.`,
    };
  };

  const trackingView = async ({ target = "", search = "" } = {}) => {
    const extras = await loadExtras(ctx);
    const { countryStats } = extras;
    const player = await readPlayer();
    const { definition } = await readDefinition();
    const world = (await engine.gameState.readWorldStateView({ force: false }).catch(() => null)) ?? {};
    const identity = identityIndexFor(extras, world);
    const settings = await trackingSettingsOf(extras, player);
    const stockNames = Object.values(extras.countryNames.default ?? {});
    const candidates = extras.statsHistoricalTracking.buildHistoricalTrackingCandidateRows({ world, playerCountry: player.code, currentCountry: target, index: identity, stockNames });
    const index = candidates.index;
    const customKeys = definition?.custom ? engine.statsSheet.statSheetKeys(definition) : null;
    const ready = (key) => countryStats.isTrackedStatSheetReady(world?.countryStats?.[index.canonicalKey(key) || key], customKeys);
    const refreshRecord = countryStats.normalizeCountryStatsTracking(world?.countryStatsTracking, { playerCountry: player.code });
    const lastRefresh = (key) => refreshRecord.lastAutoRefreshByPolity?.[index.canonicalKey(key) || key] || "";
    const max = countryStats.COUNTRY_STATS_TRACKING_MAX_POLITIES;
    const tracked = asArray(settings.trackedPolities);
    const filtered = extras.statsHistoricalTracking.filterHistoricalTrackingCandidateRows(candidates.rows, search);
    const interval = Number(settings?.intervalMonths);
    const intervalLabel = countryStatsTrackingIntervalLabel(settings?.intervalMonths);
    return {
      intervals: countryStats.COUNTRY_STATS_TRACKING_INTERVALS.map((months) => ({ months, label: months === 0 ? "Off" : `${months} months`, active: interval === months })),
      intervalLabel,
      max,
      count: `${tracked.length}/${max}`,
      pickText: `Pick up to ${max} countries to keep historical charts rich without overloading the simulation.`,
      chips: tracked.map((key) => ({ key, label: index.displayName(key), isPlayer: lowerText(key) === lowerText(player.code), ready: ready(key) })),
      rows: filtered.map((row) => {
        const isTracked = tracked.some((item) => lowerText(item) === lowerText(row.key));
        const isPlayer = lowerText(row.key) === lowerText(player.code);
        const isViewed = lowerText(row.key) === lowerText(target);
        const maxed = !isTracked && tracked.length >= max;
        return {
          key: row.key,
          label: row.label,
          tracked: isTracked,
          isPlayer,
          isViewed: isViewed && !isPlayer,
          keyText: !isPlayer && !isViewed ? cleanText(row.key) : "",
          ready: ready(row.key),
          maxed,
          action: isTracked ? "Tracked" : maxed ? "Full" : "Add",
        };
      }),
      lastBatch: refreshRecord.lastBatchDate
        ? `The last automatic refresh ran on ${extras.gameDates.formatGameDateReadable(refreshRecord.lastBatchDate)}.`
        : "No automatic refresh has run yet.",
      status: tracked.map((key) => {
        const isReady = ready(key);
        const last = lastRefresh(key);
        return {
          key: index.canonicalKey(key) || key,
          label: index.displayName(key),
          ready: isReady,
          text: !isReady ? "Needs a first reading" : last ? `Last refreshed on ${extras.gameDates.formatGameDateReadable(last)}` : "Not refreshed automatically yet",
        };
      }),
      turnRunning: engine.simulationStatus.isSimulationBusy(),
    };
  };

  const standInSeed = async () => {
    const game = await engine.gameState.readGameData({ force: true });
    const date = cleanText(game?.gameDate || game?.startDate);
    await engine.gameState.mutateWorldState((world) => ({
      ...world,
      relations: [
        { id: "rel-fr-de", a: "France", b: "Germany", score: 64, summary: "The Franco-German engine of the European Union." },
        { id: "rel-fr-uk", a: "France", b: "United Kingdom", score: 31, summary: "Close defence partners across the Channel." },
        { id: "rel-fr-ly", a: "France", b: "Libya", score: -72, summary: "Open fighting along the southern border." },
      ],
      agreements: [
        { id: "agr-elysee", title: "Élysée Treaty", type: "friendship_consultation", parties: ["France", "Germany"], status: "active", startedDate: "1963-01-22", lastUpdatedDate: date },
        { id: "agr-lancaster", title: "Lancaster House Treaties", type: "military_cooperation", parties: ["France", "United Kingdom"], status: "active", startedDate: "2010-11-02" },
      ],
      wars: [
        { id: "war-sahel", title: "Southern Border War", status: "active", sideA: ["France", "Chad"], sideB: ["Libya"], cause: "Raids on Chad from Libyan soil.", startedDate: "2015-12-14", lastUpdatedDate: date },
      ],
      peaceOffers: [
        { id: "offer-libya", warId: "war-sahel", from: "Libya", to: "France", terms: { territory: "as held", reparations: { payer: "Libya", receiver: "France", share: 0.01, years: 5 } }, date, round: Number(game?.round) || 1, status: "open" },
      ],
      callsToArms: [
        { id: "call-germany", warId: "war-sahel", ally: "France", defender: "Germany", attackers: ["Russia"], via: { kind: "agreement", id: "agr-elysee", title: "the Élysée Treaty" }, date, round: Number(game?.round) || 1, status: "open" },
      ],
      units: [
        ...asArray(world.units).filter((unit) => unit?.id !== "unit-fr-armour"),
        { id: "unit-fr-armour", name: "2nd Armoured Brigade", type: "armor", ownerCode: "France", strength: 78, lng: 1.6, lat: 47.3, status: "idle", posture: "holding", composition: "Leclerc tanks and VBCI infantry carriers", note: "Holding the Loire crossings south of Paris." },
      ],
      markers: [
        ...asArray(world.markers).filter((marker) => marker?.id !== "marker-toulon"),
        { id: "marker-toulon", name: "Toulon Naval Base", kind: "naval base", ownerCode: "France", lng: 5.93, lat: 43.12, status: "active", foundedAt: "1599", note: "Home port of the Mediterranean fleet." },
      ],
      politicalActors: {
        ...(world.politicalActors || {}),
        byPolity: {
          ...(world.politicalActors?.byPolity || {}),
          France: {
            polityKey: "France",
            name: "France",
            government: { form: "Semi-presidential republic", headOfState: "François Hollande", headOfGovernment: "Manuel Valls", rulingParties: ["Socialist Party"] },
            parties: [
              { id: "ps", name: "Socialist Party", shortName: "PS", support: 29, leader: "Jean-Christophe Cambadélis", ideology: ["Social democracy"], publicDescription: "The governing party of the centre-left." },
              { id: "lr", name: "The Republicans", shortName: "LR", support: 27, ideology: ["Liberal conservatism"] },
              { id: "fn", name: "National Front", shortName: "FN", support: 25, ideology: ["National conservatism"] },
              { id: "fg", name: "Left Front", shortName: "FG", support: 11 },
            ],
            goals: ["Restore growth and cut unemployment", "Defeat the raids on Chad", "Hold the European Union together"],
          },
        },
      },
    }));
    return { ok: true };
  };

  return {
    ...(ctx.standIn ? { "country.standin_seed": async () => standInSeed() } : {}),
    "country.view": async (args) => view(args),
    "country.sheet": async ({ target = "", force = false, forceReassess = false, generate = true } = {}, { signal, id }) => {
      const code = cleanText(target);
      if (!code) return { status: "idle" };
      return loadSheet({ code, force, forceReassess, generate, signal, id });
    },
    "country.ranking": async (args) => rankingView(args),
    "country.chart": async (args) => chartView(args),
    "country.tracking": async (args) => trackingView(args),
    "country.tracking.interval": async ({ months = 0, target = "", search = "" } = {}) => {
      const extras = await loadExtras(ctx);
      const player = await readPlayer();
      const settings = await trackingSettingsOf(extras, player);
      await persistTracking(extras, player, { ...(settings || {}), intervalMonths: Number(months) || 0 });
      return trackingView({ target, search });
    },
    "country.tracking.toggle": async ({ key = "", target = "", search = "" } = {}) => {
      const extras = await loadExtras(ctx);
      const player = await readPlayer();
      const world = (await engine.gameState.readWorldStateView({ force: false }).catch(() => null)) ?? {};
      const identity = identityIndexFor(extras, world);
      const canonical = identity?.canonicalKey(key) || key;
      const current = extras.countryStats.normalizeCountryStatsTracking(await trackingSettingsOf(extras, player), { playerCountry: player.code });
      const already = current.trackedPolities.some((item) => lowerText(item) === lowerText(canonical));
      const nextTracked = already
        ? current.trackedPolities.filter((item) => lowerText(item) !== lowerText(canonical))
        : [...current.trackedPolities, canonical];
      await persistTracking(extras, player, { ...current, trackedPolities: nextTracked });
      return trackingView({ target, search });
    },
    "country.answer": async ({ op = "", ref = "", territory = "", money = "none", theirs = "" } = {}) => {
      if (op === "propose") {
        const player = await readPlayer();
        const answer = await answerDiplomacy(ctx, "propose", ref, { territory, reparations: paymentOf(money, player.code, cleanText(theirs)) });
        if (answer.error) return { ok: false, said: answer.error };
        if (!answer.accepted) return { ok: false, said: "They refuse these terms." };
        return { ok: true, said: "" };
      }
      const answer = await answerDiplomacy(ctx, op, ref);
      return { ok: answer.ok, said: answer.ok ? "" : refusalText(answer.error) };
    },
    "country.warpeace": async () => warPeaceState(ctx),
    "country.width": async ({ width = 0 } = {}) => {
      const next = Math.round(Number(width) || 0);
      if (next > 0) {
        storage.setItem("oh-advisor-width", String(next));
        return { width: next };
      }
      const saved = Number(storage.getItem("oh-advisor-width"));
      return { width: Number.isFinite(saved) && saved > 0 ? saved : 0 };
    },
    "country.busy": async () => ({ busy: engine.simulationStatus.isSimulationBusy(), note: TURN_RUNNING_NOTE }),
  };
};
