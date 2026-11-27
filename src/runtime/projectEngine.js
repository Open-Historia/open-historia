/*! Open Historia — the projects engine: plans, funding, the daily clock and bounded effects © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "lets rework projects entirely… right now they dont actually effect the world
// actively and dont progress normally. it seems like they just sit doing
// nothing" (the owner, 2026-11-15).
//
// They sat because the model was the clock: an entry moved only when a time
// skip chose to write an op for it, and the prompt said that writing none was
// usually right. Here the ENGINE is the clock, as the front engine is for a war:
//
//   plan        what a project is set to cost and take, written once, when it is
//               planned (the Projects tab's one request, the advisor, or a time
//               skip opening one for a country nobody plays): how many days of
//               work at normal funding, what it costs a month, the checkpoints on
//               the way (each at a share of the work), and what it does to the
//               world when it is done (effects, applied once) or, for a
//               programme that runs on, every month it runs (yields).
//   funding     none, low, normal or high: what the owner pays a month and how
//               fast the work goes, both by FUNDING_RATE.
//   the tick    every day: each owner's project budget (a share of its economy,
//               set by how its treasury stands) pays its projects' daily cost,
//               the best funded first; the work moves by the share paid, times a
//               capacity the owner's economy and stability set (0.5 to 1.5). A
//               project paid next to nothing for a month stalls for want of
//               funds, and takes up again by itself on a day the budget has room.
//
// A time skip runs the period's tick BEFORE its prompt is written (forecast),
// and the prompt tells the model what came of it: these checkpoints reached on
// these days, this project done on that day with these effects, that one
// stalled. The model tells those as events. After the answer the same tick is
// run again on the same board (apply), so what was told is what happens. The
// model's own part is planning, and the setbacks and breakthroughs its events
// cause (adjustments, each bounded), which take hold from the next period, so
// they can never contradict what this period was told.
//
// Pure, deterministic, and loads in plain Node: no Date.now, no random, no
// import that reaches the map.

import { addGameDays, diffGameDays, gameDateDayNumber, normalizeGameDate } from "./gameDates.js";
import { treasuryFactor } from "./militaryFunding.js";
import { openProjectFinanceClock } from "./projectFinance.js";
import { nameKey, sameName } from "../../server/nameKey.js";

// ---- the vocabulary ---------------------------------------------------------

export const FUNDING_LEVELS = Object.freeze(["none", "low", "normal", "high"]);
// What a level multiplies, cost and speed alike.
export const FUNDING_RATE = Object.freeze({ none: 0, low: 0.5, normal: 1, high: 1.5 });
// The order the budget pays in: the best funded first.
const PAYING_ORDER = Object.freeze(["high", "normal", "low"]);
// The old priority dial, read as funding when a save from before is opened.
export const FUNDING_FROM_PRIORITY = Object.freeze({ high: "high", normal: "normal", low: "low" });

// The statuses a project can have. planning: opened without a plan yet (the
// advisor named an effort and nobody has planned it); active: being worked;
// stalled: work has stopped for a reason (STALL_REASONS); paused: funding
// none, by the owner's choice; and the three endings.
export const ENGINE_STATUSES = Object.freeze(["planning", "active", "stalled", "paused", "complete", "failed", "cancelled"]);
export const OPEN_ENGINE_STATUSES = Object.freeze(["planning", "active", "stalled", "paused"]);
// funds: paid next to nothing for STALL_AFTER_DAYS (it takes up again by itself);
// site: what it was built around is gone; blocked: the intelligence it rests on
// is in doubt (projects.js spyIntelDoubtOps).
export const STALL_REASONS = Object.freeze(["funds", "site", "blocked"]);

// A country's project budget: this share of its economy a year, more with a
// budget in surplus and less under deficit and debt (militaryFunding.js
// treasuryFactor, the same reading its forces' funding takes).
export const PROJECT_BUDGET_GDP_SHARE = 0.02;
// One project may cost at most this share of its owner's monthly project budget
// at normal funding, so no plan can swallow a country's whole budget.
export const COST_SHARE_OF_BUDGET_MOST = 0.5;
// A project paid less than this share of what it was due on a day is starved;
// STALL_AFTER_DAYS of that in a row stall it, and a stalled one resumes on a
// day the budget has RESUME_SHARE of its due left over after the others.
export const STARVED_SHARE = 0.1;
export const STALL_AFTER_DAYS = 30;
export const RESUME_SHARE = 0.5;
export const CAPACITY_LEAST = 0.5;
export const CAPACITY_MOST = 1.5;
export const DURATION_LEAST = 14;
export const DURATION_MOST = 3650;
export const LEGACY_DURATION_DAYS = 365;
export const DAYS_PER_MONTH = 30;
export const MILESTONES_MOST = 6;
export const EFFECTS_MOST = 8;
export const YIELDS_MOST = 4;
export const STRUCTURES_MOST = 2;
export const TERRITORY_MOST = 6;
// What one event may do to a project: set it back or bring it on by so many
// days of work, or raise its monthly cost by so much (each overrun at most
// OVERRUN_PERCENT_MOST, all of them together at most OVERRUN_TOTAL_MOST).
export const SETBACK_DAYS_MOST = 180;
export const BOOST_DAYS_MOST = 90;
export const OVERRUN_PERCENT_MOST = 50;
export const OVERRUN_TOTAL_MOST = 150;
export const ADJUSTMENTS_KEPT = 8;
// The countries nobody plays may run this many projects each at once, and this
// many between them; a time skip may open this many.
export const AI_OPEN_PER_COUNTRY_MOST = 3;
export const AI_OPEN_TOTAL_MOST = 36;
export const SKIP_CREATES_MOST = 4;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value, most = 400) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const within = (value, least, most) => Math.min(most, Math.max(least, value));
const finite = (value) => {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(typeof value === "string" ? value.replace(/[,_\s]/g, "") : value);
  return Number.isFinite(number) ? number : NaN;
};
const round2 = (value) => Math.round(value * 100) / 100;
// Progress is kept to four places: a ten-year programme moves a few hundredths a
// day, and a tick works unrounded and rounds once, at its end.
export const roundProgress = (value) => Math.round(value * 10000) / 10000;
// A share of the work counts as reached within this much of it, so 30 days of
// 100/30 lands on the thirtieth day and not, by a floating-point hair, the next.
const REACHED = 1e-9;

export const resolveFunding = (value) => {
  const raw = asText(value, 20).toLowerCase();
  return FUNDING_LEVELS.includes(raw) ? raw : "";
};
export const fundingRate = (funding) => FUNDING_RATE[resolveFunding(funding) || "normal"];

// ---- effects ------------------------------------------------------------------
//
// "AI decides freely, within bounds" (the owner's choice, 2026-11-15). An effect
// is a number on one of the game's own systems, and the engine holds its size:
//
//   stat        a figure of a country's sheet (the owner's unless `country`
//               names another): stability, indices.<key>, military.<figure>,
//               economy.<figure>, population.total, customStats.<key>.
//               Points on a 0-100 scale, per cent of the value for GDP and
//               population, percentage points for the economy's rates.
//   relation    the owner's relation with `country`, in points (-100 to 100).
//   structure   a structure on the map, at lng/lat (or the project's focus).
//   unitType    a unit type the owner may field from then on (unitTypes.js),
//               its figures within UNIT_FIGURE_LEAST..UNIT_FIGURE_MOST.
//   territory   a region (by name) that passes to `country`, or that it claims.
//
// The bounds are shares of a scale or of a value, so they hold for a country of
// any size: no single project moves a 0-100 figure by more than 8 points, a
// GDP by more than 3 %, a relation by more than 15.
export const EFFECT_TYPES = Object.freeze(["stat", "relation", "structure", "unitType", "territory"]);
export const UNIT_FIGURE_LEAST = 0.5;
export const UNIT_FIGURE_MOST = 1.6;
const UNIT_BASES = Object.freeze(["infantry", "armor", "air", "naval", "artillery", "garrison"]);
const MILITARY_FIGURES = Object.freeze(["quality", "technology", "land", "sea", "air", "spending"]);
const ECONOMY_RATES = Object.freeze(["gdpGrowth", "inflation", "unemployment", "budgetBalance"]);
const KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

// How a stat is measured, and the most one completion (`once`) or one month of
// a programme's yield (`month`) may move it.
//   points    0-100 scale          percent   share of the value     rate   percentage points
export const STAT_BOUNDS = Object.freeze({
  points: { once: 8, month: 0.5 },
  percentGdp: { once: 3, month: 0.25 },
  percentPopulation: { once: 1, month: 0.05 },
  rate: { once: 2, month: 0.2 },
  debt: { once: 5, month: 0.5 },
  percentCustom: { once: 5, month: 0.5 },
});
export const RELATION_BOUNDS = Object.freeze({ once: 15, month: 1 });

// The kind of figure a stat path names, or "" for none the engine can move.
export const statMeasure = (path) => {
  const [head, key, ...rest] = asText(path, 80).split(".");
  if (rest.length) return "";
  if (head === "stability" && key === undefined) return "points";
  if (head === "indices" && KEY.test(key ?? "")) return "points";
  if (head === "military" && MILITARY_FIGURES.includes(key)) return "points";
  if (head === "economy" && key === "gdp") return "percentGdp";
  if (head === "economy" && key === "publicDebt") return "debt";
  if (head === "economy" && ECONOMY_RATES.includes(key)) return "rate";
  if (head === "population" && key === "total") return "percentPopulation";
  if (head === "customStats" && KEY.test(key ?? "")) return "custom";
  return "";
};

// A stat path as written, folded onto the spelling the sheet uses ("Stability"
// is stability, "economy.GDP" is economy.gdp); "" for none.
const canonicalStatPath = (path) => {
  const raw = asText(path, 80).replace(/\s+/g, "");
  const [head = "", key] = raw.split(".");
  const lowerHead = head.toLowerCase();
  const heads = { stability: "stability", indices: "indices", military: "military", economy: "economy", population: "population", customstats: "customStats" };
  const fixedHead = heads[lowerHead] ?? "";
  if (!fixedHead) return "";
  if (fixedHead === "stability") return key === undefined ? "stability" : "";
  if (key === undefined) return "";
  if (fixedHead === "military") return MILITARY_FIGURES.find((figure) => figure.toLowerCase() === key.toLowerCase()) ? `military.${MILITARY_FIGURES.find((figure) => figure.toLowerCase() === key.toLowerCase())}` : "";
  if (fixedHead === "economy") {
    const known = ["gdp", "publicDebt", ...ECONOMY_RATES].find((figure) => figure.toLowerCase() === key.toLowerCase());
    return known ? `economy.${known}` : "";
  }
  if (fixedHead === "population") return key.toLowerCase() === "total" ? "population.total" : "";
  return KEY.test(key) ? `${fixedHead}.${key}` : "";
};

const boundOf = (measure, scale, current = NaN) => {
  if (measure === "custom") {
    // A custom figure on a 0-100 footing is points; anything else a share of its value.
    if (Number.isFinite(current) && current >= 0 && current <= 100) return STAT_BOUNDS.points[scale];
    return Number.isFinite(current) && current !== 0 ? Math.abs(current) * STAT_BOUNDS.percentCustom[scale] / 100 : STAT_BOUNDS.points[scale];
  }
  return STAT_BOUNDS[measure]?.[scale] ?? 0;
};

// One effect as a plan keeps it, bounded on its own scale; null for one the
// engine cannot carry out. `scale` "once" for a completion's effects, "month"
// for a programme's yields (stat and relation only).
export const normalizeProjectEffect = (value, { scale = "once" } = {}) => {
  if (!isRecord(value)) return null;
  const named = asText(value.type || value.system, 20);
  const type = named || (EFFECT_TYPES.includes(asText(value.kind, 20)) ? asText(value.kind, 20) : "");
  const country = asText(value.country || "", 120);
  if (type === "stat") {
    const stat = canonicalStatPath(value.stat || value.path || value.field);
    const measure = statMeasure(stat);
    const change = finite(value.change ?? value.delta ?? value.amount);
    if (!measure || !Number.isFinite(change) || change === 0) return null;
    // Custom figures are bounded against their value when applied; here only by
    // the widest a plan can say.
    const most = measure === "custom" ? Math.max(STAT_BOUNDS.points[scale], 1e15) : boundOf(measure, scale);
    const held = round2(within(change, -most, most));
    if (held === 0) return null;
    return { type, stat, change: held, ...(country ? { country } : {}) };
  }
  if (type === "relation") {
    const change = finite(value.change ?? value.delta ?? value.amount);
    if (!country || !Number.isFinite(change) || change === 0) return null;
    const most = RELATION_BOUNDS[scale];
    const held = round2(within(change, -most, most));
    return held === 0 ? null : { type, country, change: held };
  }
  if (scale !== "once") return null;
  if (type === "structure") {
    const name = asText(value.name, 120);
    if (!name) return null;
    const lng = finite(value.lng ?? value.lon);
    const lat = finite(value.lat);
    const placed = Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 && !(lng === 0 && lat === 0);
    const kind = asText(named ? value.kind : value.structure, 40).toLowerCase();
    return { type, name, kind: kind || "facility", ...(placed ? { lng: Math.round(lng * 1000) / 1000, lat: Math.round(lat * 1000) / 1000 } : {}) };
  }
  if (type === "unitType") {
    const name = asText(value.name, 60);
    if (!name) return null;
    const base = asText(value.base, 20).toLowerCase();
    const figure = (raw) => {
      const number = finite(raw);
      return Number.isFinite(number) ? round2(within(number, UNIT_FIGURE_LEAST, UNIT_FIGURE_MOST)) : 1;
    };
    return {
      type,
      name,
      base: UNIT_BASES.includes(base) ? base : "infantry",
      attack: figure(value.attack),
      toughness: figure(value.toughness),
      speed: figure(value.speed),
      ...(asText(value.icon, 8) ? { icon: asText(value.icon, 8) } : {}),
      ...(asText(value.note, 240) ? { note: asText(value.note, 240) } : {}),
    };
  }
  if (type === "territory") {
    const region = asText(value.region || value.regionId, 160).replace(/^region:\s*/i, "");
    if (!region || !country) return null;
    return { type, region, country, ...(value.claim === true ? { claim: true } : {}) };
  }
  return null;
};

// A list of effects as a plan keeps it: each bounded, a stat or a relation said
// twice summed and bounded again, at most `most` of them, at most
// STRUCTURES_MOST structures, one unit type and TERRITORY_MOST regions.
export const normalizeProjectEffects = (list, { scale = "once", most = scale === "once" ? EFFECTS_MOST : YIELDS_MOST } = {}) => {
  const out = [];
  let structures = 0;
  let unitTypes = 0;
  let territory = 0;
  for (const raw of asArray(list)) {
    const effect = normalizeProjectEffect(raw, { scale });
    if (!effect) continue;
    if (effect.type === "stat" || effect.type === "relation") {
      const keyOf = (entry) => `${entry.type}|${entry.stat ?? ""}|${nameKey(entry.country ?? "")}`;
      const same = out.find((other) => keyOf(other) === keyOf(effect));
      if (same) {
        const merged = normalizeProjectEffect({ ...same, change: same.change + effect.change }, { scale });
        out.splice(out.indexOf(same), 1, ...(merged ? [merged] : []));
        continue;
      }
    }
    if (effect.type === "structure" && (structures += 1) > STRUCTURES_MOST) continue;
    if (effect.type === "unitType" && (unitTypes += 1) > 1) continue;
    if (effect.type === "territory" && (territory += 1) > TERRITORY_MOST) continue;
    if (out.length >= most) break;
    out.push(effect);
  }
  return out;
};

// ---- the plan -----------------------------------------------------------------

const milestoneId = (index) => `m${index + 1}`;

// Checkpoints as a plan keeps them: a title and the share of the work at which
// it is reached (1-99), in order, each once; `reachedAt` is the day the engine
// reached it, `missed` one the project ended before.
export const normalizePlanMilestones = (list) => {
  const kept = [];
  for (const raw of asArray(list)) {
    const source = typeof raw === "string" ? { title: raw } : raw;
    if (!isRecord(source)) continue;
    const title = asText(source.title || source.name, 120);
    if (!title) continue;
    const at = finite(source.atProgress ?? source.at ?? source.progress);
    kept.push({
      id: asText(source.id, 40),
      title,
      atProgress: Number.isFinite(at) ? Math.round(within(at, 1, 99)) : NaN,
      reachedAt: normalizeGameDate(source.reachedAt) || "",
      ...(source.reached === true || normalizeGameDate(source.reachedAt) ? { reached: true } : {}),
      ...(source.missed === true ? { missed: true } : {}),
    });
  }
  // Any without a share of its own is spread evenly between those around it.
  kept.forEach((entry, index) => {
    if (Number.isFinite(entry.atProgress)) return;
    entry.atProgress = Math.round(((index + 1) / (kept.length + 1)) * 98) + 1;
  });
  const sorted = kept
    .sort((a, b) => a.atProgress - b.atProgress)
    .filter((entry, index, list) => list.findIndex((other) => other.title.toLowerCase() === entry.title.toLowerCase()) === index)
    .slice(0, MILESTONES_MOST);
  return sorted.map((entry, index) => ({ ...entry, id: entry.id || milestoneId(index) }));
};

// A plan as a project keeps it, held to the engine's absolute bounds; null for
// no plan. What is bounded against the owner's own budget is boundPlanForOwner.
export const normalizeProjectPlan = (value) => {
  if (!isRecord(value)) return null;
  const days = finite(value.durationDays ?? value.days ?? value.duration);
  const cost = finite(value.monthlyCost ?? value.costPerMonth ?? value.cost);
  if (!Number.isFinite(days)) return null;
  const ongoing = value.ongoing === true || value.ongoing === "true";
  return {
    durationDays: Math.round(within(days, DURATION_LEAST, DURATION_MOST)),
    monthlyCost: Number.isFinite(cost) && cost > 0 ? Math.min(cost, 1e15) : 0,
    ...(ongoing ? { ongoing: true } : {}),
    milestones: normalizePlanMilestones(value.milestones),
    effects: normalizeProjectEffects(value.effects, { scale: "once" }),
    ...(ongoing ? { yields: normalizeProjectEffects(value.yields, { scale: "month" }) } : {}),
    ...(normalizeGameDate(value.plannedAt) ? { plannedAt: normalizeGameDate(value.plannedAt) } : {}),
    ...(value.legacy === true ? { legacy: true } : {}),
  };
};

// ---- an owner's means -------------------------------------------------------

// A country's sheet by its name, case and accents aside; null for none.
// Scenario-level funding BASIS, not a treasury ledger. A non-monetary scenario
// deliberately models projects as time/effort without creating cash or GDP.
// The default is an estimated GDP allowance; no AI can switch the basis.
export const projectFundingMode = (world) =>
  world?.projectFundingMode === "nonmonetary" ? "nonmonetary" : "gdp-proxy";

export const sheetOf = (world, owner) => {
  const sheets = isRecord(world?.countryStats) ? world.countryStats : {};
  if (!asText(owner)) return null;
  if (isRecord(sheets[owner])) return sheets[owner];
  const key = Object.keys(sheets).find((name) => sameName(name, owner));
  return key ? sheets[key] : null;
};

// What an owner has for its projects per month in the native GDP unit.
// Null means UNASSESSED, never zero GDP or unlimited money; funded work
// cannot claim payments until the authoritative economic baseline exists.
export const monthlyProjectBudget = (sheet) => {
  const gdp = finite(sheet?.economy?.gdp);
  if (!(gdp > 0)) return null;
  return (gdp * PROJECT_BUDGET_GDP_SHARE * treasuryFactor(sheet)) / 12;
};

// How fast an owner can work: 1 for an ordinary state, up to CAPACITY_MOST for
// a stable, growing one with a sound treasury, down to CAPACITY_LEAST for one
// in collapse. A figure the sheet lacks counts as ordinary.
export const capacityOf = (sheet) => {
  if (!isRecord(sheet)) return 1;
  let factor = 1;
  const stability = finite(sheet.stability);
  if (Number.isFinite(stability)) factor += ((within(stability, 0, 100) - 50) / 100) * 0.8;
  const growth = finite(sheet.economy?.gdpGrowth);
  if (Number.isFinite(growth)) factor += within(growth, -10, 10) / 40;
  if (finite(sheet.economy?.gdp) > 0) factor += (treasuryFactor(sheet) - 1) * 0.5;
  return round2(within(factor, CAPACITY_LEAST, CAPACITY_MOST));
};

// A figure of a sheet by its stat path; NaN where the sheet has none.
export const statValueOf = (sheet, path) => {
  const [head, key] = asText(path, 80).split(".");
  if (!isRecord(sheet)) return NaN;
  if (head === "stability") return finite(sheet.stability);
  const group = sheet[head];
  return isRecord(group) ? finite(group[key]) : NaN;
};

// A stat change held to its bound against the figure it moves: points and rates
// on their scale, a custom figure off the 0-100 footing as a share of its value.
// `scale` "once" or "month".
export const boundStatChange = (path, change, sheet, scale = "once") => {
  const measure = statMeasure(path);
  const number = Number(change);
  if (!measure || !Number.isFinite(number)) return 0;
  const most = boundOf(measure, scale, statValueOf(sheet, path));
  return round2(within(number, -most, most));
};

// A plan held to its owner's means: its monthly cost at most
// COST_SHARE_OF_BUDGET_MOST of the owner's budget, and each custom figure it
// moves bounded against what that figure is now. `sheetFor(country)` gives the
// sheet of a country another effect names (the owner's when it names none).
export const boundPlanForOwner = (plan, sheet, { sheetFor = () => sheet } = {}) => {
  const normalized = normalizeProjectPlan(plan);
  if (!normalized) return null;
  const bound = (effects, scale) => effects
    .map((effect) => (effect.type === "stat"
      ? { ...effect, change: boundStatChange(effect.stat, effect.change, effect.country ? sheetFor(effect.country) : sheet, scale) }
      : effect))
    .filter((effect) => effect.type !== "stat" || effect.change !== 0);
  const budget = monthlyProjectBudget(sheet);
  return {
    ...normalized,
    ...(budget === null ? {} : { monthlyCost: Math.min(normalized.monthlyCost, budget * COST_SHARE_OF_BUDGET_MOST) }),
    effects: bound(normalized.effects, "once"),
    ...(normalized.yields ? { yields: bound(normalized.yields, "month") } : {}),
  };
};

// ---- what a plan does, paid for --------------------------------------------------
//
// An AI writes a plan's days and cost as what the effort would really take
// (gameplay.js PROJECT_PLAN_RULES), and the bounds above hold the size of each
// effect and the most it may cost. Nothing held what it may cost at LEAST: a
// plan written anywhere else (a player's device in a shared game,
// multiplayer/host/seatProjects.js) could do the most an effect may do, for
// nothing, in the fortnight a plan takes at least, as many times as it liked.
// Here the engine prices what a plan does from its own measures, so that the
// owner's own project budget bounds how much it can do, as it bounds an
// honest plan.
//
// Its worth: each completion effect its change over the most one project may
// move that figure (1 for one at its bound), and a structure, a unit type or a
// region 1 each; a programme's yields the same, over the same once-bound, for
// every month it runs. Its price: PLAN_WORTH_BUDGET_MONTHS of the owner's
// monthly project budget for each unit of worth, over the whole work at normal
// funding, and a programme's yields' worth each month it is paid for. At most
// COST_SHARE_OF_BUDGET_MOST of the budget a month as ever, so a plan that does
// more takes longer: never less than the days that price takes at that most,
// whether or not the owner's economy is on record.
export const PLAN_WORTH_BUDGET_MONTHS = 1;

const effectWorth = (effect, sheet) => {
  if (effect?.type === "stat") {
    const most = boundOf(statMeasure(effect.stat), "once", statValueOf(sheet, effect.stat));
    return most > 0 ? Math.min(1, Math.abs(Number(effect.change) || 0) / most) : 0;
  }
  if (effect?.type === "relation") return Math.min(1, Math.abs(Number(effect.change) || 0) / RELATION_BOUNDS.once);
  return ["structure", "unitType", "territory"].includes(effect?.type) ? 1 : 0;
};

// { once, monthly }: what a plan's completion and its monthly yields are worth.
export const planWorth = (plan, sheet = null) => ({
  once: roundProgress(asArray(plan?.effects).reduce((sum, effect) => sum + effectWorth(effect, sheet), 0)),
  monthly: roundProgress(asArray(plan?.yields).reduce((sum, effect) => sum + effectWorth(effect, sheet), 0)),
});

// A plan held to its owner's means (boundPlanForOwner) and priced by what it
// does: its monthly cost raised to its price, as far as the most a project may
// cost a month, and its days lengthened for the rest. null for no plan.
export const pricePlanForOwner = (plan, sheet, options = {}) => {
  const bounded = boundPlanForOwner(plan, sheet, options);
  if (!bounded) return null;
  const worth = planWorth(bounded, sheet);
  const share = PLAN_WORTH_BUDGET_MONTHS / COST_SHARE_OF_BUDGET_MOST;
  let days = Math.max(bounded.durationDays, Math.ceil(worth.once * share * DAYS_PER_MONTH));
  let cost = bounded.monthlyCost;
  const budget = monthlyProjectBudget(sheet);
  if (budget !== null) {
    const most = budget * COST_SHARE_OF_BUDGET_MOST;
    const whole = worth.once * PLAN_WORTH_BUDGET_MONTHS * budget;
    const monthly = worth.monthly * PLAN_WORTH_BUDGET_MONTHS * budget;
    cost = Math.min(most, Math.max(cost, (whole * DAYS_PER_MONTH) / days, monthly));
    if (whole > 0 && cost > 0) days = Math.max(days, Math.ceil((whole * DAYS_PER_MONTH) / cost));
  }
  return { ...bounded, durationDays: Math.min(DURATION_MOST, days), monthlyCost: round2(cost) };
};

// ---- a project's place on the clock ----------------------------------------------

export const projectOwnerOf = (project, host = "") => asText(project?.ownerCode, 120) || asText(host, 120);
const isOpen = (project) => OPEN_ENGINE_STATUSES.includes(asText(project?.status) || "active");

// A BELIEF is no country's work: a programme a service was made to believe in
// by material planted on its turned agent. It is that service's knowledge, kept
// on its own board (`belief`; `believedBy` names the service while a time skip
// that opened it carries it home, runtime/seatBoards.js returnBoards). The
// engine never runs one, no cap counts it, and nobody but its believer is shown
// it. A programme opened from planted material used to be the country's real
// work, and ran to completion with its effects.
export const isBelief = (project) => project?.belief === true || Boolean(asText(project?.believedBy, 120));

// Is the engine working on it: open, planned, and not paused, and for a
// programme that runs on, whether it is set up or not. Never a belief.
const ticks = (project) => isOpen(project) && !isBelief(project) && Boolean(project?.plan) && asText(project?.status) !== "planning" && asText(project?.status) !== "paused" && !(asText(project?.status) === "stalled" && asText(project?.stallReason) !== "funds");
// What a project is due a day at its funding, overruns included.
export const dailyCostOf = (project) => {
  const cost = Number(project?.plan?.monthlyCost) || 0;
  const overrun = within(Number(project?.costOverrun) || 0, 0, OVERRUN_TOTAL_MOST);
  return (cost * (1 + overrun / 100) * fundingRate(project?.funding)) / DAYS_PER_MONTH;
};
// The share of the whole work one day at full pay moves it, at its funding.
const dailyWork = (project, capacity) => (100 / Math.max(DURATION_LEAST, Number(project?.plan?.durationDays) || LEGACY_DURATION_DAYS)) * fundingRate(project?.funding) * capacity;

// ---- adjustments: the setbacks and breakthroughs the story causes ----------------
//
// A time skip's event may set a project back (days of work lost, a cost
// overrun) or bring it on (days gained). They are recorded with the round they
// were told in and take hold at the start of the NEXT tick, never this one: the
// period they were told in had its outcomes decided before its story was
// written, and the story cannot unsay them.
export const normalizeAdjustment = (value) => {
  if (!isRecord(value)) return null;
  const kind = asText(value.kind || value.op, 20).toLowerCase();
  if (kind !== "setback" && kind !== "boost") return null;
  const days = finite(value.days);
  const overrun = finite(value.overrun ?? value.costOverrun);
  const heldDays = Number.isFinite(days) ? Math.round(within(Math.abs(days), 0, kind === "setback" ? SETBACK_DAYS_MOST : BOOST_DAYS_MOST)) : 0;
  const heldOverrun = kind === "setback" && Number.isFinite(overrun) ? Math.round(within(overrun, 0, OVERRUN_PERCENT_MOST)) : 0;
  if (!heldDays && !heldOverrun) return null;
  return {
    kind,
    days: heldDays,
    ...(heldOverrun ? { overrun: heldOverrun } : {}),
    round: Math.max(0, Math.trunc(Number(value.round) || 0)),
    date: normalizeGameDate(value.date) || "",
    ...(value.applied === true ? { applied: true } : {}),
    ...(asText(value.note, 240) ? { note: asText(value.note, 240) } : {}),
  };
};

// ---- the tick ---------------------------------------------------------------------
//
// tickProjects runs the clock from `fromDate` to `toDate` over every project on
// the board, and returns the board as the days left it and what happened on the
// way, in date order:
//   { type: "milestone", date, project, owner, milestone }
//   { type: "complete", date, project, owner, effects }
//   { type: "established", date, project, owner, effects }   (a programme now running)
//   { type: "stall", date, project, owner, reason }
//   { type: "resume", date, project, owner }
//   { type: "yield", date, project, owner, yields, share }
// `world` is read for the owners' sheets only (countryStats), as it stood when
// the period began: the forecast and the apply read the same world and so come
// to the same days. `host` is the country a blank owner means (the game's own).
// `round` is the turn this tick belongs to: adjustments told in an earlier one
// take hold first.
//
// Nothing here applies an effect: the caller does that, once, from the
// outcomes (gameState.js applyProjectOutcomesToWorld).
// Finance is an explicit receipt-ledger input, not an unchecked world field.
// The live turn writer must supply an authorized ledger and commit its result
// atomically. Until that authority seam is connected, ordinary turns are unchanged.
export const tickProjects = ({ projects = [], world = {}, fromDate = "", toDate = "", host = "", round = 0, finance } = {}) => {
  const start = gameDateDayNumber(fromDate);
  const end = gameDateDayNumber(toDate);
  // A copy deep enough to work on: the tick dates checkpoints and appends to
  // adjustments, and the board it was handed (the forecast's, the apply's) must
  // come out of it as it went in.
  const board = asArray(projects).map((project) => (isRecord(project)
    ? {
      ...project,
      ...(isRecord(project.plan) ? { plan: { ...project.plan, milestones: asArray(project.plan.milestones).map((entry) => ({ ...entry })) } } : {}),
      adjustments: asArray(project.adjustments).map((entry) => ({ ...entry })),
    }
    : project));
  const outcomes = [];
  const nonmonetary = projectFundingMode(world) === "nonmonetary";
  const hasFinanceReceipts = Boolean(finance?.receipts?.length);
  if (hasFinanceReceipts && nonmonetary) throw new Error("Project Finance is not available in non-monetary scenarios.");
  const financeClock = finance === undefined || nonmonetary ? null : openProjectFinanceClock(finance, { fromDate, toDate });
  const financeOwners = new Set(financeClock?.borrowers ?? []);
  if (start === null || end === null || end <= start) return { projects: board, outcomes, days: 0, ...(financeClock?{finance:financeClock.finish()}: {}) };
  const days = end - start;

  // The adjustments told before this turn take hold now, in the order told.
  for (const project of board) {
    if (!isRecord(project) || !project.plan) continue;
    const pending = asArray(project.adjustments).filter((entry) => !entry?.applied && (Number(entry?.round) || 0) < round);
    if (!pending.length) continue;
    let progress = Number(project.progress) || 0;
    let overrun = Number(project.costOverrun) || 0;
    const perDay = 100 / Math.max(DURATION_LEAST, Number(project.plan.durationDays) || LEGACY_DURATION_DAYS);
    for (const entry of pending) {
      if (entry.kind === "setback") {
        progress -= perDay * (Number(entry.days) || 0);
        overrun += Number(entry.overrun) || 0;
      } else {
        progress += perDay * (Number(entry.days) || 0);
      }
    }
    // A breakthrough brings the work to the brink, never over it: the finish is
    // a day of the clock's like any other. A setback never undoes a checkpoint
    // already reached.
    const floor = Math.max(0, ...asArray(project.plan.milestones).filter((entry) => entry.reached).map((entry) => entry.atProgress));
    project.progress = roundProgress(within(progress, Math.min(floor, 99.99), 99.99));
    project.costOverrun = within(overrun, 0, OVERRUN_TOTAL_MOST);
    project.adjustments = asArray(project.adjustments).map((entry) => (pending.includes(entry) ? { ...entry, applied: true } : entry)).slice(-ADJUSTMENTS_KEPT);
  }

  // Each owner's projects, in board order, with its means for the period.
  // Explicit non-monetary scenarios never book money; time/capacity govern work.
  const owners = new Map();
  board.forEach((project, index) => {
    if (!isRecord(project) || !ticks(project)) return;
    const owner = projectOwnerOf(project, host);
    // Use the same polity identity fold as sheetOf and ownerMeans. Otherwise
    // aliases of one country create multiple independent daily funding pools.
    const key = nameKey(owner);
    if (!owners.has(key)) {
      const sheet = sheetOf(world, owner);
      const monthly = monthlyProjectBudget(sheet);
      owners.set(key, { owner, daily: monthly === null ? null : monthly / DAYS_PER_MONTH, capacity: capacityOf(sheet), indexes: [] });
    }
    owners.get(key).indexes.push(index);
  });

  // Debt service is owed even when the borrower has no running project. The
  // finance intake must use the same exact owner token as the board/sheets.
  for (const owner of financeOwners) {
    const key=nameKey(owner);
    if (owners.has(key) && owners.get(key).owner!==owner) throw new Error("Project Finance borrower identity does not match the canonical board.");
    if (!owners.has(key)) {
      const sheet=sheetOf(world,owner), monthly=monthlyProjectBudget(sheet);
      owners.set(key,{owner,daily:monthly===null?null:monthly/DAYS_PER_MONTH,capacity:capacityOf(sheet),indexes:[]});
    }
  }
  const toMinor = amount => {
    const cents=Math.floor(amount*100);
    if(!Number.isSafeInteger(cents)||cents<0)throw new Error("Project Finance amount exceeds safe minor-unit accounting.");
    return cents;
  };
  const hasFinance = owner => financeClock && financeOwners.has(owner);
  const paidThisPeriod = new Map();
  const dueThisPeriod = new Map();
  const note = (map, index, amount) => map.set(index, (map.get(index) ?? 0) + amount);

  for (let day = 1; day <= days; day += 1) {
    const date = addGameDays(fromDate, day);
    for (const { owner, daily, capacity, indexes } of owners.values()) {
      // Unknown GDP is not proof of unlimited public funds. With no assessed
      // allowance only work explicitly costing zero may advance.
      let pool = nonmonetary ? Infinity : daily === null ? 0 : daily;
      const financed=hasFinance(owner);
      // Service consumes only the already-authorized recurring envelope.
      // No loan proceeds or unknown GDP can create a repayment.
      if(financed)pool=Math.max(0,pool-financeClock.service(owner,date,toMinor(pool))/100);
      const working = indexes.filter((index) => {
        const project = board[index];
        return isOpen(project) && asText(project.status) === "active";
      });
      // The budget pays the best funded first, and shares what is left between
      // projects of one level by what each is due.
      const shareOf = new Map();
      const creditOf = new Map();
      if(financed)for(const index of working){
        const project=board[index];
        if(projectOwnerOf(project,host)!==owner)throw new Error("Project Finance project owner identity mismatch.");
        creditOf.set(index,financeClock.fund(owner,project.id,date,toMinor(dailyCostOf(project)))/100);
      }
      for (const level of PAYING_ORDER) {
        const tier = working.filter((index) => resolveFunding(board[index].funding) === level || (!resolveFunding(board[index].funding) && level === "normal"));
        const due = tier.reduce((sum, index) => sum + Math.max(0,dailyCostOf(board[index])-(creditOf.get(index) ?? 0)), 0);
        const share = due <= 0 ? 1 : Math.min(1, pool / due);
        for (const index of tier) shareOf.set(index, share);
        if (due > 0) pool = Math.max(0, pool - due * share);
      }
      for (const index of working) {
        const project = board[index];
        const due = dailyCostOf(project);
        const baseShare = shareOf.get(index) ?? 1;
        const credit=creditOf.get(index) ?? 0;
        const paid = nonmonetary ? 0 : credit + (due-credit)*baseShare;
        const share = financed && due>0 ? within(paid/due,0,1) : baseShare;
        project.spent = round2((Number(project.spent) || 0) + paid);
        note(paidThisPeriod, index, paid);
        note(dueThisPeriod, index, due);
        advanceOne(project, { date, share, capacity, owner, outcomes, due });
      }
      // What is left over is offered to the projects stalled for want of funds,
      // in board order: one that can have RESUME_SHARE of its due takes up again.
      for (const index of indexes) {
        const project = board[index];
        if (asText(project.status) !== "stalled" || asText(project.stallReason) !== "funds") continue;
        const due = dailyCostOf(project);
        if(financed && projectOwnerOf(project,host)!==owner)throw new Error("Project Finance project owner identity mismatch.");
        const available=financed?Math.min(toMinor(due),financeClock.available(owner,project.id,date))/100:0;
        if (due > 0 && pool+available < due * RESUME_SHARE) continue;
        const credit=financed?financeClock.fund(owner,project.id,date,toMinor(due))/100:0;
        const basePaid = nonmonetary ? 0 : Math.min(Math.max(0,due-credit), pool);
        const paid=basePaid+credit;
        pool = Math.max(0, pool - basePaid);
        project.status = "active";
        project.stallReason = "";
        project.starvedDays = 0;
        outcomes.push({ type: "resume", date, projectId: project.id, project: project.name, owner });
        project.spent = round2((Number(project.spent) || 0) + paid);
        note(paidThisPeriod, index, paid);
        note(dueThisPeriod, index, due);
        advanceOne(project, { date, share: nonmonetary ? 1 : due > 0 ? paid / due : 1, capacity, owner, outcomes, due });
      }
    }
  }

  // Progress rounded once, now the days are done.
  for (const project of board) {
    if (isRecord(project) && Number.isFinite(Number(project.progress))) project.progress = roundProgress(Number(project.progress));
  }
  // What each project was paid of what it was due over the period, for the
  // board ("underfunded"), and when it should be done at the rate it ended on.
  for (const [index, due] of dueThisPeriod) {
    const project = board[index];
    project.paidShare = nonmonetary ? 1 : due > 0 ? round2(within((paidThisPeriod.get(index) ?? 0) / due, 0, 1)) : 1;
  }
  for (const { owner, capacity, indexes } of owners.values()) {
    for (const index of indexes) {
      const project = board[index];
      if (!isOpen(project) || project.plan?.ongoing) continue;
      // A temporary credit stock cannot be extrapolated as a recurring flow.
      // The live finance UI must calculate a bounded depletion forecast.
      project.targetDate = hasFinance(owner) ? "" : expectedFinish(project, { from: toDate, capacity, share: Number(project.paidShare ?? 1) }) || "";
    }
  }
  return { projects: board, outcomes, days, ...(financeClock?{finance:financeClock.finish()}: {}) };
};

// One day's work on one project. Mutates the copy tickProjects made.
const advanceOne = (project, { date, share, capacity, owner, outcomes, due }) => {
  const plan = project.plan;
  // Starved: paid next to nothing for a month running, it stalls.
  if (due > 0 && share < STARVED_SHARE) {
    project.starvedDays = (Number(project.starvedDays) || 0) + 1;
    if (project.starvedDays >= STALL_AFTER_DAYS) {
      project.status = "stalled";
      project.stallReason = "funds";
      outcomes.push({ type: "stall", date, projectId: project.id, project: project.name, owner, reason: "funds" });
      return;
    }
  } else {
    project.starvedDays = 0;
  }
  if (plan.ongoing && project.established) {
    // A programme that runs on: its yield every month it is paid for.
    project.yieldDays = (Number(project.yieldDays) || 0) + 1;
    project.yieldShare = (Number(project.yieldShare) || 0) + share;
    if (project.yieldDays >= DAYS_PER_MONTH) {
      const monthShare = round2(project.yieldShare / project.yieldDays);
      project.yieldDays = 0;
      project.yieldShare = 0;
      if (asArray(plan.yields).length && monthShare > 0) {
        project.lastYieldAt = date;
        outcomes.push({ type: "yield", date, projectId: project.id, project: project.name, owner, yields: plan.yields, share: monthShare });
      }
    }
    return;
  }
  const before = Number(project.progress) || 0;
  const after = Math.min(100, before + dailyWork(project, capacity) * share);
  project.progress = after;
  for (const milestone of asArray(plan.milestones)) {
    if (milestone.reached || milestone.missed || after + REACHED < milestone.atProgress) continue;
    milestone.reachedAt = date;
    milestone.reached = true;
    outcomes.push({ type: "milestone", date, projectId: project.id, project: project.name, owner, milestone: milestone.title });
  }
  if (after + REACHED < 100) return;
  project.progress = 100;
  if (plan.ongoing) {
    project.established = true;
    project.yieldDays = 0;
    project.yieldShare = 0;
    outcomes.push({ type: "established", date, projectId: project.id, project: project.name, owner, effects: asArray(plan.effects) });
    return;
  }
  project.status = "complete";
  project.completedAt = date;
  outcomes.push({ type: "complete", date, projectId: project.id, project: project.name, owner, effects: asArray(plan.effects) });
};

// When a project should be done, from `from`, at the work a day it moves at
// (its funding, the owner's capacity, the share of its cost being paid); "" for
// one that is not moving.
export const expectedFinish = (project, { from = "", capacity = 1, share = 1 } = {}) => {
  if (!project?.plan) return "";
  const rate = dailyWork(project, capacity) * within(Number(share), 0, 1);
  if (!(rate > 0)) return "";
  const left = Math.max(0, 100 - (Number(project.progress) || 0));
  return addGameDays(from, Math.ceil(left / rate));
};

// What one owner's projects cost and have, now: its monthly budget (null where
// unassessed), what its running projects are due a month at their funding, the
// share of that the budget covers, and its capacity. For the board and the
// planner's prompt.
export const ownerMeans = (world, owner, projects = [], host = "") => {
  const sheet = sheetOf(world, owner);
  const budget = monthlyProjectBudget(sheet);
  const committed = asArray(projects)
    .filter((project) => isRecord(project) && ticks(project) && sameName(projectOwnerOf(project, host), owner))
    .reduce((sum, project) => sum + dailyCostOf(project) * DAYS_PER_MONTH, 0);
  const mode = projectFundingMode(world);
  return {
    mode,
    budget: mode === "nonmonetary" ? null : budget,
    committed: mode === "nonmonetary" ? 0 : committed,
    covered: mode === "nonmonetary" || committed <= 0 ? 1 : budget === null ? 0 : within(budget / committed, 0, 1),
    capacity: capacityOf(sheet),
  };
};

// A project's expected finish as the board shows it between turns: a one-day
// look at its owner's budget from today. "" for a closed one, one not moving,
// or a programme that runs on and is already set up.
export const estimateProjectFinish = (project, { world = {}, projects = [], host = "", date = "" } = {}) => {
  if (!isRecord(project) || !isOpen(project) || !project.plan || (project.plan.ongoing && project.established)) return "";
  if (!ticks(project) || asText(project.status) === "stalled") return "";
  const owner = projectOwnerOf(project, host);
  const next = addGameDays(date, 1);
  const peek = tickProjects({
    projects: asArray(projects).filter((entry) => isRecord(entry) && sameName(projectOwnerOf(entry, host), owner)),
    world,
    fromDate: date,
    toDate: next,
    host,
    round: Number.MAX_SAFE_INTEGER,
  });
  const ticked = peek.projects.find((entry) => entry?.id === project.id) ?? project;
  return expectedFinish(project, { from: date, capacity: capacityOf(sheetOf(world, owner)), share: Number(ticked.paidShare ?? 1) });
};

// ---- a plan for a project from before -----------------------------------------------
//
// A save written before the engine has entries with no plan. Each is given one,
// deterministically, so it takes up where it stood: as many days as lay between
// its start and its target date (LEGACY_DURATION_DAYS where it had neither),
// nothing a month (it was never costed, and charging for it now would be a
// bill nobody ran up), no effects (its onComplete, where it has one, still
// releases), its progress kept. Its checkpoints already reached stay reached,
// with the dates they had; those still ahead are spread over the work that is
// left, in the order their dates fell, so the first skip after an update does
// not report a flood of checkpoints the old board had simply never ticked off.
export const legacyPlanFor = (entry) => {
  const started = normalizeGameDate(entry?.startedAt);
  const target = normalizeGameDate(entry?.targetDate);
  const span = started && target ? diffGameDays(started, target) : null;
  const durationDays = span && span > 0 ? within(span, DURATION_LEAST, DURATION_MOST) : LEGACY_DURATION_DAYS;
  const progress = within(finite(entry?.progress) || 0, 0, 100);
  const sources = asArray(entry?.milestones)
    .map((milestone) => (typeof milestone === "string" ? { title: milestone } : milestone))
    .filter((source) => isRecord(source) && asText(source.title || source.name));
  const statusOf = (source) => asText(source.status).toLowerCase();
  const ahead = sources
    .filter((source) => statusOf(source) !== "done" && statusOf(source) !== "missed")
    .map((source, index) => ({ source, index, date: normalizeGameDate(source.date || source.due) }))
    .sort((a, b) => (a.date && b.date ? diffGameDays(b.date, a.date) : 0) || a.index - b.index);
  const milestones = sources.map((source) => {
    const status = statusOf(source);
    const date = normalizeGameDate(source.date || source.due);
    if (status === "done") {
      return { title: source.title || source.name, atProgress: Math.round(within(progress, 1, 99)), reached: true, reachedAt: normalizeGameDate(source.lastCompletedAt) || date || "" };
    }
    if (status === "missed") return { title: source.title || source.name, atProgress: Math.round(within(progress, 1, 99)), missed: true };
    const place = ahead.findIndex((entry) => entry.source === source);
    const at = progress + ((100 - progress) * (place + 1)) / (ahead.length + 1);
    return { title: source.title || source.name, atProgress: Math.round(within(Math.max(at, progress + 1), 1, 99)) };
  });
  return normalizeProjectPlan({
    durationDays,
    monthlyCost: 0,
    ongoing: entry?.ongoing === true,
    milestones,
    effects: [],
    yields: [],
    legacy: true,
  });
};

// ---- words for the prompt -------------------------------------------------------------

const signed = (value) => `${value > 0 ? "+" : ""}${value}`;
export const describeEffect = (effect, { owner = "" } = {}) => {
  if (!isRecord(effect)) return "";
  if (effect.type === "stat") {
    const measure = statMeasure(effect.stat);
    const unit = measure === "percentGdp" || measure === "percentPopulation" ? "%" : measure === "rate" || measure === "debt" ? " pts" : "";
    const whose = effect.country && !sameName(effect.country, owner) ? `${effect.country}'s ` : "";
    return `${whose}${effect.stat} ${signed(effect.change)}${unit}`;
  }
  if (effect.type === "relation") return `relations with ${effect.country} ${signed(effect.change)}`;
  if (effect.type === "structure") return `a ${effect.kind || "structure"}: ${effect.name}`;
  if (effect.type === "unitType") return `a unit type: ${effect.name} (${effect.base}, attack ${effect.attack}, toughness ${effect.toughness}, speed ${effect.speed})`;
  if (effect.type === "territory") return effect.claim ? `${effect.country} claims ${effect.region}` : `${effect.region} passes to ${effect.country}`;
  return "";
};

export const describeEffects = (effects, options) => asArray(effects).map((effect) => describeEffect(effect, options)).filter(Boolean).join("; ");

// What the engine decided for a period, as the time skip is told it: one line
// an outcome, in date order. Yields are left out: a month of a programme's
// running is not news.
export const describeOutcomes = (outcomes) => asArray(outcomes)
  .filter((outcome) => outcome?.type !== "yield")
  .map((outcome) => {
    const who = `${outcome.owner} · "${outcome.project}"`;
    if (outcome.type === "milestone") return `- ${outcome.date}: ${who} reaches "${outcome.milestone}".`;
    if (outcome.type === "complete") {
      const effects = describeEffects(outcome.effects, { owner: outcome.owner });
      return `- ${outcome.date}: ${who} is COMPLETED${effects ? `; it takes effect: ${effects}` : ""}.`;
    }
    if (outcome.type === "established") {
      const effects = describeEffects(outcome.effects, { owner: outcome.owner });
      return `- ${outcome.date}: ${who} is set up and running from now on${effects ? `; it takes effect: ${effects}` : ""}.`;
    }
    if (outcome.type === "stall") return `- ${outcome.date}: ${who} STALLS for want of funds.`;
    if (outcome.type === "resume") return `- ${outcome.date}: ${who} has money again and work resumes.`;
    return "";
  })
  .filter(Boolean)
  .join("\n");

// ---- the period's result, laid over the board the turn ended with ---------------------
//
// The tick of a period runs on the board as the period BEGAN (`base`), the
// board its prompt was told about, so what it decides is what was told. The
// turn's own ops (a project opened, set back, called off) were applied to the
// board meanwhile (`current`). This lays the engine's result over that board:
//   - the engine's fields (progress, checkpoints, money, its status changes)
//     come from the tick, for every project the tick ran;
//   - a project the tick completed is complete, even if an event of the same
//     turn called it off (it was told as completed);
//   - a project an event ended otherwise stays ended;
//   - adjustments are the tick's (those it applied marked so) and the turn's
//     new ones after them, which take hold from the next period;
//   - a project the turn opened is as the turn left it: it starts working next
//     period.
const ENGINE_FIELDS = Object.freeze([
  "progress", "spent", "paidShare", "starvedDays", "costOverrun", "established",
  "yieldDays", "yieldShare", "lastYieldAt", "completedAt", "targetDate",
]);
const adjustmentKey = (entry) => JSON.stringify([entry?.kind, entry?.days, entry?.overrun ?? 0, entry?.round, entry?.date]);

export const mergeTickedBoard = ({ base = [], ticked = [], current = [] } = {}) => {
  const before = new Map(asArray(base).filter(isRecord).map((project) => [project.id, project]));
  const after = new Map(asArray(ticked).filter(isRecord).map((project) => [project.id, project]));
  return asArray(current).map((project) => {
    if (!isRecord(project)) return project;
    const was = before.get(project.id);
    const run = after.get(project.id);
    if (!was || !run) return project;
    const merged = { ...project };
    for (const field of ENGINE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(run, field)) merged[field] = run[field];
    }
    // Its checkpoints as the tick reached them; anything else of the plan as
    // the turn left it.
    if (merged.plan && run.plan) {
      const reached = new Map(asArray(run.plan.milestones).map((entry) => [entry.id, entry]));
      merged.plan = {
        ...merged.plan,
        milestones: asArray(merged.plan.milestones).map((entry) => {
          const done = reached.get(entry.id);
          return done?.reached && !entry.reached ? { ...entry, reached: true, reachedAt: done.reachedAt } : entry;
        }),
      };
    }
    const engineChanged = asText(run.status) !== asText(was.status) || asText(run.stallReason) !== asText(was.stallReason);
    const turnChanged = asText(project.status) !== asText(was.status);
    if (asText(run.status) === "complete") {
      merged.status = "complete";
      merged.stallReason = "";
      // Told as completed: nothing it had was missed after all.
      if (merged.plan) merged.plan = { ...merged.plan, milestones: merged.plan.milestones.map(({ missed: _missed, ...entry }) => entry) };
    } else if (!(turnChanged && !OPEN_ENGINE_STATUSES.includes(asText(project.status))) && engineChanged) {
      merged.status = run.status;
      merged.stallReason = run.stallReason ?? "";
    }
    const known = new Set(asArray(was.adjustments).map(adjustmentKey));
    merged.adjustments = [
      ...asArray(run.adjustments),
      ...asArray(project.adjustments).filter((entry) => !known.has(adjustmentKey(entry))),
    ].slice(-ADJUSTMENTS_KEPT);
    return merged;
  });
};

// ---- what the world may open ---------------------------------------------------------
//
// A time skip (or a scene) opens projects for countries nobody plays: each with
// a plan, at most AI_OPEN_PER_COUNTRY_MOST running for one country,
// AI_OPEN_TOTAL_MOST for all of them, and SKIP_CREATES_MOST in one answer. The
// countries people play open their own, from the Projects tab. A gate over the
// board as it stands and the people who play; each call says whether one more
// create may land ("" when it may, else why not: "theirs", "plan" or "cap"), and
// counts it when it does. A belief (isBelief) is no country's work: it is
// counted among what the answer opens, never as its country's running work,
// and may be of any country, a played one too.
export const worldProjectGate = ({ board = [], players = [] } = {}) => {
  const played = asArray(players).map((name) => asText(name, 120)).filter(Boolean);
  const isPlayed = (owner) => played.some((name) => sameName(name, owner));
  const open = asArray(board).filter((project) => isRecord(project) && isOpen(project) && !isBelief(project) && asText(project.ownerCode));
  const openOf = new Map();
  for (const project of open) {
    if (isPlayed(project.ownerCode)) continue;
    const key = nameKey(project.ownerCode);
    openOf.set(key, (openOf.get(key) ?? 0) + 1);
  }
  let total = [...openOf.values()].reduce((sum, count) => sum + count, 0);
  let opened = 0;
  return (project) => {
    const owner = asText(project?.ownerCode || project?.owner, 120);
    if (owner && isBelief(project)) {
      if (!normalizeProjectPlan(project?.plan)) return "plan";
      if (opened >= SKIP_CREATES_MOST) return "cap";
      opened += 1;
      return "";
    }
    if (!owner || isPlayed(owner)) return "theirs";
    if (!normalizeProjectPlan(project?.plan)) return "plan";
    const key = nameKey(owner);
    if (opened >= SKIP_CREATES_MOST || total >= AI_OPEN_TOTAL_MOST || (openOf.get(key) ?? 0) >= AI_OPEN_PER_COUNTRY_MOST) return "cap";
    opened += 1;
    total += 1;
    openOf.set(key, (openOf.get(key) ?? 0) + 1);
    return "";
  };
};
