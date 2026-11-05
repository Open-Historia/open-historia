/*! Open Historia — the two layers of a country's statistics © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "There are 2 layers of stats: the backend layer, which is what the war stuff
// reads, and that backend layer gets translated into the frontend layer (if
// there is a frontend custom stats layer)."
//
// THE BACKEND is four figures every country's sheet can carry, whatever the
// scenario shows its player: its people, the size of its economy, the balance
// of its budget and its public debt. They are the standard sheet's own fields
// (population.total, economy.gdp, economy.budgetBalance, economy.publicDebt),
// and they are what the game's own arithmetic reads: what a country's troops
// are raised from (runtime/fronts/manpower.js), what it has to spend on them
// (runtime/militaryFunding.js), how it weighs in a land war.
//
// THE FRONTEND is what the player is shown. In an ordinary scenario it is the
// standard sheet, and the backend is simply part of it. A scenario with a
// sheet of its own (customStats: "Legions", "Grain", "Mana") shows only that,
// and used to keep nothing else: the war had no people to raise troops from.
// Such a scenario's sheet is now written WITH its backend, in the same
// request: the model works the four figures out first and then says the same
// thing in the scenario's own values, so that a country its backend makes
// populous and rich is not poor and empty on the sheet its player reads. The
// player of such a scenario never sees the backend.
//
// Pure, and loads in plain Node.

export const STATS_BACKEND_FIELD = "backend";
export const STATS_BACKEND_KEYS = Object.freeze(["population", "gdp", "budgetBalance", "publicDebt"]);

const number = (value) => {
  if (value === null || value === undefined || value === "") return NaN;
  const read = Number(value);
  return Number.isFinite(read) ? read : NaN;
};
const within = (value, least, most) => Math.min(most, Math.max(least, value));

// A backend as a model wrote it, held to what each figure can be; null when
// it says nothing usable of a country's people.
//   partial   a change to a backend that is there (a turn's patch): whichever of
//             the four it names, where a whole one has to say how many people
export const readStatsBackend = (value, { partial = false } = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const population = number(value.population);
  if (!(population >= 1) && !partial) return null;
  const backend = population >= 1 ? { population: Math.round(within(population, 1, 2e10)) } : {};
  const gdp = number(value.gdp);
  if (gdp > 0) backend.gdp = within(gdp, 1, 1e18);
  const balance = number(value.budgetBalance);
  if (!Number.isNaN(balance)) backend.budgetBalance = within(balance, -100, 100);
  const debt = number(value.publicDebt);
  if (!Number.isNaN(debt)) backend.publicDebt = within(debt, 0, 1000);
  return Object.keys(backend).length > 0 ? backend : null;
};

// The same as a patch for a country's sheet (runtime/countryStats.js mergeCountryStatPatch).
export const statsBackendPatch = (backend, options) => {
  const read = readStatsBackend(backend, options);
  if (!read) return {};
  const economy = {};
  if (read.gdp !== undefined) economy.gdp = read.gdp;
  if (read.budgetBalance !== undefined) economy.budgetBalance = read.budgetBalance;
  if (read.publicDebt !== undefined) economy.publicDebt = read.publicDebt;
  return { ...(read.population !== undefined ? { population: { total: read.population } } : {}), ...(Object.keys(economy).length ? { economy } : {}) };
};

// BOTH LAYERS IN ONE REQUEST. "I meant update both layers of the stats in one
// request." Whatever request writes a country's statistics writes the backend
// with them: the first sheet and the periodic refresh do (above); the request
// for the countries a player comes into conflict with does (Game/AI/
// conflictBackends.js); and a time skip, in a scenario with a sheet of its
// own, may write `backend` beside `customStats` in the same stats patch,
// which is told here. A patch's `backend` is taken for the standard fields it
// stands for wherever a patch is merged (countryStats.js mergeCountryStatPatch).
//
// What a time skip of such a scenario is told, with the backends it may move;
// "" when no polity has one yet.
//   countryStats   world.countryStats
export const statsBackendTurnRule = (countryStats, { most = 10 } = {}) => {
  const known = Object.entries(countryStats && typeof countryStats === "object" ? countryStats : {})
    .map(([name, sheet]) => ({ name, backend: statsBackendOf(sheet) }))
    .filter((entry) => entry.backend)
    .sort((a, b) => b.backend.population - a.backend.population || a.name.localeCompare(b.name))
    .slice(0, most);
  if (known.length === 0) return "";
  return [
    "[Hidden Backend]",
    "Under the sheet above every polity has a hidden backend the player never sees, which the game's own arithmetic reads (armies are raised from its people and paid from its economy): population, gdp, budgetBalance (% of gdp) and publicDebt (% of gdp). "
    + `The two are moved TOGETHER, in this one answer: when an event changes a polity's values above for a reason that also moves its people or its economy (a war's losses, a plague, a famine, a boom, a default), write the backend's new figures in the same stats patch, as \`${STATS_BACKEND_FIELD}\`, beside its customStats. `
    + "Absolute values, only the figures that changed, and only for a polity whose backend is shown here.",
    ...known.map((entry) => `- ${entry.name}: ${JSON.stringify(entry.backend)}`),
  ].join("\n");
};

// The backend a sheet carries, as the four figures; null for a sheet with no people on it.
export const statsBackendOf = (sheet) => {
  const population = number(sheet?.population?.total);
  if (!(population >= 1)) return null;
  const backend = { population: Math.round(population) };
  const gdp = number(sheet?.economy?.gdp);
  if (gdp > 0) backend.gdp = gdp;
  const balance = number(sheet?.economy?.budgetBalance);
  if (!Number.isNaN(balance)) backend.budgetBalance = balance;
  const debt = number(sheet?.economy?.publicDebt);
  if (!Number.isNaN(debt)) backend.publicDebt = debt;
  return backend;
};

// Whether a sheet has what the war reads.
export const hasStatsBackend = (sheet) => statsBackendOf(sheet) !== null;

// (The backend in a request's schema is with the other schemas: Game/AI/gameplaySchemas.js STATS_BACKEND_SCHEMA.)

// What a request that writes a scenario's own sheet is told of the backend.
//   previous   the backend the country's sheet already carries, or null
export const statsBackendInstruction = (previous = null) => [
  `HIDDEN BACKEND (\`${STATS_BACKEND_FIELD}\`), the one exception to the rule that nothing modern is kept: the game's own arithmetic needs four figures for every polity, which this scenario's player never sees. `
  + "population: its people, as a count. gdp: the size of its economy in a year, in one unit you use for every polity of this world. "
  + "budgetBalance: its treasury's balance as a percentage of that economy (a surplus above 0, a deficit below). publicDebt: what it owes, as a percentage of that economy. "
  + "Armies are raised from the first and paid from the rest. Work these four out FIRST, from the era, the world and this polity's place in it; "
  + "then write the scenario's own values so that they say the same thing: a polity its backend makes populous and rich is not poor and empty on its sheet, and one that has lost a tenth of its people shows it.",
  previous
    ? `Its backend as it stands (campaign canon; move it only by what has happened since): ${JSON.stringify(previous)}`
    : "It has no backend yet: establish one that fits the era and this polity's size.",
].join("\n");

// ---- the countries a person's country comes into conflict with --------------------------
//
// "Stats should be generated for countries you're going into conflict with,
// either if you deploy a front on them, if you redirect a front to attack them
// or anything else, so that the stats can be used."

// (They are all asked of in one request: Game/AI/conflictBackends.js.)

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// The countries that have nothing the war can read and are on a battlefield
// with a country a person plays, or about to be: those it fights first (in
// the order their side lists them), then those a route of its troops goes
// into, then those `extra` names (a route drawn and not yet marched), then
// those that fight beside it, and the played country itself. A group is not a
// country and has no sheet; a battlefield that has closed is nobody's conflict.
//   world     the game's world: battlefields, countryStats, groups
//   players   the countries and groups people play
export const conflictSheetTargets = (world, players, { extra = [] } = {}) => {
  const human = new Set(list(players).map(fold).filter(Boolean));
  if (human.size === 0) return [];
  const groups = new Set(Object.keys(world?.groups && typeof world.groups === "object" ? world.groups : {}).map(fold));
  const sheets = new Map(Object.entries(world?.countryStats && typeof world.countryStats === "object" ? world.countryStats : {}).map(([key, sheet]) => [fold(key), sheet]));
  const wanted = [];
  const seen = new Set();
  const add = (name) => {
    const key = fold(name);
    if (!key || seen.has(key) || groups.has(key)) return;
    seen.add(key);
    if (!hasStatsBackend(sheets.get(key))) wanted.push(String(name).replace(/\s+/g, " ").trim());
  };
  const fought = list(world?.battlefields).filter((record) => record && record.status !== "closed" && Array.isArray(record.sides));
  const mineOf = (record) => record.sides.findIndex((members) => list(members).some((member) => human.has(fold(member))));
  for (const record of fought) {
    const mine = mineOf(record);
    if (mine >= 0) list(record.sides[1 - mine]).forEach(add);
  }
  for (const record of fought) {
    const mine = mineOf(record);
    if (mine < 0) continue;
    for (const order of list(record.orders)) if (order?.chosen === true && order.s === mine) list(order.attacks).forEach(add);
  }
  list(extra).forEach(add);
  for (const record of fought) {
    const mine = mineOf(record);
    if (mine >= 0) list(record.sides[mine]).forEach(add);
  }
  return wanted;
};
