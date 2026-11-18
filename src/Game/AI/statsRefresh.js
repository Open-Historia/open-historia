/*! Open Historia — keeping countries' stat sheets up to date after time skips © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "readd the background ai for refreshing the stats where you could set how
// often it runs the background agent to keep stats up to date" (the owner,
// 2026-11-18). It was removed on 2026-11-07, when it was a request after the
// skip, counted inside the skip's own budget. It is back as a job of its own:
//
//   - "NO SETTING FOR IT, JUST IN THE ADVANCED STATS MENU YOU CAN CHOOSE WHAT
//     INTERVAL IT CHECKS AT AND YOU CAN SET THE INTERVAL TO OFF. BY DEFAULT ITS
//     6 MONTHS" (the owner, 2026-11-18). No switch and nothing in Settings: the
//     Stats pane's Advanced Statistics carries the interval, in GAME months, as
//     the old auto-refresh cadence did (Off, 3, 6, 12 or 24 months), 6 unless
//     the player picks another.
//   - It runs AFTER a time skip has landed and been written, once that much
//     game time has passed since its last run in the campaign (or since the
//     campaign began), as a background request of its own (requestBudget.js
//     BACKGROUND_REQUEST), never inside the skip's one request. A skip of
//     years is still one run: at most ONE request a skip. It waits for the
//     world to be idle, so it never runs beside a skip or a sheet the player
//     asked for.
//   - ONE request a run, for at most STATS_REFRESH_BATCH_MOST countries: those
//     whose sheets are stale, the players' own first, then the countries at war
//     with them, then the longest unrefreshed. A sheet is stale when it was not
//     assessed within the interval AND something it rests on has changed since
//     (the same test the Stats pane's own Refresh makes before it spends a
//     request: gameplay.js generateCountryStatSheet). Nothing stale, no request.
//   - Under the day's cap for background work (backgroundAllowance), and never
//     in a shared game except on the host whose own AI answers for everyone
//     (runtime/sharedReadings.js hostReadsFigures).
//
// This module is the schedule, the choice of countries, the request's words
// and the reading of its answer: pure, and loads in plain Node. The asking and
// the writing are gameplay.js refreshStaleStatSheets, which writes through the
// same stat-sheet write the Stats pane's Refresh uses (persistStatSheet).

import { countryStatsTrackingMonthsElapsed } from "../../runtime/countryStats.js";

// How often, in game months. 0 is Off. The old cadence's choices, so its
// words are the ones the language packs already carry.
export const STATS_REFRESH_MONTH_CHOICES = Object.freeze([0, 3, 6, 12, 24]);
export const STATS_REFRESH_DEFAULT_MONTHS = 6;
// The most countries one refresh asks of.
export const STATS_REFRESH_BATCH_MOST = 6;
// The most fresh developments shown for one country.
export const STATS_REFRESH_EVIDENCE_MOST = 8;

// Where it is kept, on this device (localStorage in the game): the interval
// is the device's, so in a shared game the host's is the one that runs.
export const STATS_REFRESH_KEYS = Object.freeze({
  months: "ai_stats_refresh_months",
  // { [campaign]: the game date of the last run that asked }: the bound.
  lastRun: "ai_stats_refresh_last_date",
});
const LAST_RUN_CAMPAIGNS_KEPT = 40;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const whole = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? number : null;
};

// Anything that is not one of the choices reads as the default.
export const normalizeStatsRefreshMonths = (value) => {
  const number = whole(value);
  return STATS_REFRESH_MONTH_CHOICES.includes(number) ? number : STATS_REFRESH_DEFAULT_MONTHS;
};

// --- The interval and the record of the last run ---------------------------
//
// Reads never throw: a browser that refuses storage runs on the default.
const read = (storage, key) => {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
};
const write = (storage, key, value) => {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch {
    return false;
  }
};

// The game's own: this device's localStorage, or none (tests, the harness).
export const deviceStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const readStatsRefreshMonths = (storage = deviceStorage()) => normalizeStatsRefreshMonths(read(storage, STATS_REFRESH_KEYS.months));
export const writeStatsRefreshMonths = (storage, value) => write(storage, STATS_REFRESH_KEYS.months, String(normalizeStatsRefreshMonths(value)));

const readLastRuns = (storage) => {
  try {
    const parsed = JSON.parse(read(storage, STATS_REFRESH_KEYS.lastRun) || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const lastStatsRefreshDate = (storage, campaign) => clean(readLastRuns(storage)[clean(campaign)]) || null;

// Remembered as the request is made, so a run whose answer is lost still
// counts: the request was spent.
export const rememberStatsRefreshDate = (storage, campaign, date) => {
  const key = clean(campaign);
  const value = clean(date);
  if (!key || !value) return false;
  const runs = readLastRuns(storage);
  delete runs[key];
  runs[key] = value;
  const kept = Object.entries(runs).slice(-LAST_RUN_CAMPAIGNS_KEPT);
  return write(storage, STATS_REFRESH_KEYS.lastRun, JSON.stringify(Object.fromEntries(kept)));
};

// --- The schedule ----------------------------------------------------------
//
// Whether a run may ask after the skip that reached `date`: not Off, and at
// least `months` of game time since the last run that asked (`lastDate`), or
// since the campaign began (`startDate`) when none has. Asked once a skip,
// however long the skip: a skip of years is one run. A record dated after the
// game's date is from a future the player stepped back from, and does not
// hold the refresh off.
export const statsRefreshRunDue = ({ months = STATS_REFRESH_DEFAULT_MONTHS, date = "", lastDate = null, startDate = "" } = {}) => {
  const step = normalizeStatsRefreshMonths(months);
  const now = clean(date);
  if (!step || !now) return false;
  const last = clean(lastDate);
  if (last && countryStatsTrackingMonthsElapsed(now, last) > 0) return true;
  const from = last || clean(startDate);
  if (!from) return false;
  return countryStatsTrackingMonthsElapsed(from, now) >= step;
};

// The countries one run asks of.
//   candidates  [{ name, assessedDate, fresh }]: every country with a whole
//               sheet; `assessedDate` the game date its sheet was last
//               assessed on ("" when it never was), `fresh` how many
//               developments it rests on have changed since (0: nothing, and
//               refreshing it would only cost)
//   players     the countries people play
//   opponents   the countries at war with them
// Stale: not assessed within the interval, with something fresh. The players'
// own first, then their opponents, then the longest unrefreshed.
export const pickStatsRefreshCountries = ({ candidates = [], players = [], opponents = [], date = "", months = STATS_REFRESH_DEFAULT_MONTHS, most = STATS_REFRESH_BATCH_MOST } = {}) => {
  const step = Math.max(1, normalizeStatsRefreshMonths(months));
  const playing = new Set(list(players).map(fold).filter(Boolean));
  const fighting = new Set(list(opponents).map(fold).filter(Boolean));
  const seen = new Set();
  const stale = [];
  for (const entry of list(candidates)) {
    const name = clean(entry?.name);
    if (!name || seen.has(fold(name))) continue;
    seen.add(fold(name));
    if (!(Number(entry?.fresh) > 0)) continue;
    const assessed = clean(entry?.assessedDate);
    const since = assessed ? countryStatsTrackingMonthsElapsed(assessed, date) : Infinity;
    if (since < step) continue;
    stale.push({ name, since, rank: playing.has(fold(name)) ? 0 : fighting.has(fold(name)) ? 1 : 2 });
  }
  stale.sort((a, b) => a.rank - b.rank || b.since - a.since || a.name.localeCompare(b.name));
  return stale.slice(0, Math.max(0, whole(most) ?? STATS_REFRESH_BATCH_MOST)).map((entry) => entry.name);
};

// --- What is sent ----------------------------------------------------------

// A standard sheet as the request shows it: the figures a refresh may move,
// and nothing of its map ledger, which only the Stats pane's own Refresh
// rebuilds against the map.
export const compactStatSheet = (sheet, indexRows = []) => {
  if (!isRecord(sheet)) return null;
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const indices = {};
  for (const row of list(indexRows)) {
    const key = clean(row?.key);
    const value = number(sheet.indices?.[key]);
    if (key && value !== undefined) indices[key] = value;
  }
  return {
    stability: number(sheet.stability),
    indices,
    population: { total: number(sheet.population?.total) },
    economy: Object.fromEntries(["gdp", "gdpPerCapita", "gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance"]
      .map((key) => [key, number(sheet.economy?.[key])])
      .filter(([, value]) => value !== undefined)),
    gdpBreakdown: Object.fromEntries(["agriculture", "industry", "services"]
      .map((key) => [key, number(sheet.gdpBreakdown?.[key])])
      .filter(([, value]) => value !== undefined)),
  };
};

// The developments a country's sheet rests on, as lines: dated, by title and
// what happened. Never their ids.
export const describeStatsRefreshEvidence = (events, { most = STATS_REFRESH_EVIDENCE_MOST } = {}) => list(events)
  .slice(-Math.max(1, whole(most) ?? STATS_REFRESH_EVIDENCE_MOST))
  .map((event) => {
    const detail = clean(event?.description);
    return `- ${clean(event?.date) || "undated"}: ${clean(event?.title) || "A development"}${detail ? `: ${detail.length > 320 ? `${detail.slice(0, 319).trimEnd()}…` : detail}` : ""}`;
  })
  .join("\n");

// The request.
//   date       the game's date
//   rules      the scenario's own rules of its world and era, or ""
//   countries  [{ name, since, values, backend, evidence }]: `since` the date
//              its sheet was last assessed; `values` its sheet as shown
//              (compactStatSheet, or a scenario's own values); `backend` the
//              hidden layer under a scenario's own sheet, or null; `evidence`
//              the developments since (describeStatsRefreshEvidence)
//   sheet      { description, keys } of a scenario's own sheet, or null for the
//              standard one
//   indices    the standard sheet's strategic indices described, and `indexKeys`
//              their keys
// Returns { systemPrompt, userMessage, asked }: `asked` the countries' names as
// the answer must write them.
export const statsRefreshRequest = ({ date = "", rules = "", countries = [], sheet = null, indices = "", indexKeys = [] } = {}) => {
  const custom = isRecord(sheet) && list(sheet.keys).length > 0;
  const asked = list(countries).map((entry) => ({ ...entry, name: clean(entry?.name) })).filter((entry) => entry.name);
  const example = custom
    ? `{"updates":[{"country":"a country's name exactly as given","customStats":{"${clean(list(sheet.keys)[0]) || "oneDefinedKey"}":0},"backend":{"population":0,"gdp":0,"budgetBalance":0,"publicDebt":0}}]}`
    : `{"updates":[{"country":"a country's name exactly as given","stability":0,"indices":${JSON.stringify(Object.fromEntries(list(indexKeys).map((key) => [clean(key), 0]).filter(([key]) => key)))},"population":{"total":0},"economy":{"gdp":0,"gdpPerCapita":0,"gdpGrowth":0,"inflation":0,"unemployment":0,"publicDebt":0,"budgetBalance":0},"gdpBreakdown":{"agriculture":0,"industry":0,"services":0}}]}`;
  const systemPrompt = [
    "You keep the stat sheets of several countries in a running alternate-history campaign up to date, all in one answer.",
    "Each country's current sheet is campaign canon. Move it only as far as the developments listed since its last assessment warrant, over the time that has passed. With nothing to go on, a figure stays as it is.",
    "Respect the campaign date and the campaign's own events: what happened in real history after the campaign began is not canon.",
    "A development already reflected in a sheet is not applied again.",
    custom
      ? [
        "The scenario defines its own statistics. Use only these keys, exactly as written, with plain numbers:",
        clean(sheet.description) ? String(sheet.description) : "",
        "Each country also has a HIDDEN BACKEND the player never sees: population (a count), gdp (its economy in a year, in the one unit used for every country of this world), budgetBalance and publicDebt (percentages of that economy). Move it first by what happened, and return it whole in \"backend\"; the scenario's own values then say the same thing. A country shown with no backend has none yet: establish one that fits the era and its size.",
      ].filter(Boolean).join("\n")
      : [
        "Keep GDP, population, GDP per capita, growth, inflation, unemployment, debt and budget balance consistent with each other. Strategic indices are 0 to 100 and move gradually unless a development is a real shock. GDP sector shares sum to 100 if you give them.",
        indices ? `The scenario's strategic indices (use only these keys):\n${indices}` : "",
        "Do not change territory: borders are the map's, and this refresh keeps each country's territorial ledger as it is.",
      ].filter(Boolean).join("\n"),
    "Include a country only when one of its figures changed, and only the figures that changed. Write each country's name exactly as it is given.",
    "Return exactly one JSON object and nothing else:",
    example,
  ].join("\n\n");
  const userMessage = [
    `Campaign date: ${clean(date) || "unknown"}`,
    clean(rules) ? `ERA & WORLD RULES:\n${String(rules).slice(0, 1200)}` : "",
    ...asked.map((entry) => [
      `=== ${entry.name} ===`,
      `Last assessed: ${clean(entry.since) || "at the start of the campaign"}.`,
      `CURRENT SHEET: ${JSON.stringify(entry.values ?? {})}`,
      custom ? `HIDDEN BACKEND: ${isRecord(entry.backend) ? JSON.stringify(entry.backend) : "none yet"}` : "",
      `DEVELOPMENTS SINCE:\n${clean(entry.evidence) ? entry.evidence : "None recorded."}`,
    ].filter(Boolean).join("\n")),
  ].filter(Boolean).join("\n\n");
  return { systemPrompt, userMessage, asked: asked.map((entry) => entry.name) };
};

// --- What comes back -------------------------------------------------------
//
// The answer's updates, each on a country that was asked of under the name it
// was asked by (the same name, whatever its case and spacing: never a guess
// at a near one), once each. [{ name, update }].
export const readStatsRefreshUpdates = (payload, asked = []) => {
  const names = new Map(list(asked).map(clean).filter(Boolean).map((name) => [fold(name), name]));
  const updates = isRecord(payload) ? list(payload.updates) : list(payload);
  const out = [];
  const taken = new Set();
  for (const update of updates) {
    if (!isRecord(update)) continue;
    const name = names.get(fold(update.country ?? update.name));
    if (!name || taken.has(fold(name))) continue;
    taken.add(fold(name));
    out.push({ name, update });
  }
  return out;
};

// A standard sheet's update as a patch the stat sheet's merge takes
// (runtime/countryStats.js mergeCountryStatPatch): only finite numbers, in
// their ranges, and only the scenario's own strategic indices. Null when it
// carries nothing usable.
export const statsRefreshPatch = (value, indexRows = []) => {
  if (!isRecord(value)) return null;
  const finite = (raw) => {
    if (raw === null || raw === undefined || raw === "") return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  };
  const percent = (raw) => {
    const number = finite(raw);
    return number === null ? null : Math.max(0, Math.min(100, number));
  };
  const signed = (raw) => {
    const number = finite(raw);
    return number === null ? null : Math.max(-1000, Math.min(1000, number));
  };
  const positive = (raw) => {
    const number = finite(raw);
    return number !== null && number > 0 ? number : null;
  };
  const patch = {};
  const stability = percent(value.stability);
  if (stability !== null) patch.stability = stability;
  const indices = {};
  for (const row of list(indexRows)) {
    const key = clean(row?.key);
    const number = key ? percent(value.indices?.[key]) : null;
    if (number !== null) indices[key] = number;
  }
  if (Object.keys(indices).length) patch.indices = indices;
  const total = positive(value.population?.total);
  if (total !== null) patch.population = { total: Math.round(total) };
  const economy = {};
  const gdp = positive(value.economy?.gdp);
  const gdpPerCapita = positive(value.economy?.gdpPerCapita);
  if (gdp !== null) economy.gdp = gdp;
  else if (gdpPerCapita !== null) economy.gdpPerCapita = gdpPerCapita;
  for (const key of ["gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance"]) {
    const number = signed(value.economy?.[key]);
    if (number !== null) economy[key] = number;
  }
  if (Object.keys(economy).length) patch.economy = economy;
  const breakdown = {};
  for (const key of ["agriculture", "industry", "services"]) {
    const number = percent(value.gdpBreakdown?.[key]);
    if (number !== null) breakdown[key] = number;
  }
  if (Object.keys(breakdown).length === 3) patch.gdpBreakdown = breakdown;
  return Object.keys(patch).length ? patch : null;
};
