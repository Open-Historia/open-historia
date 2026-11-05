/*! Open Historia — war at sea: blockades © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Make blockades affect the economy and land war."
//
// A fleet could be told to blockade (the posture of that name), and the war
// at sea fought whoever came to lift it (engine.js); but a blockade that
// stood did nothing to the country it was laid on. Now it does two things.
//
// WHAT A BLOCKADE IS. A fleet in the posture `blockade`, not beaten off,
// lying within its reach of the coast of a country its own is at war with.
// How hard it presses on that country, from 0 to 1, is worked out for every
// day of a period (engine.js runNaval) from three things:
//
//   how much of the coast it closes   the country's coast is read at up to
//                                     BLOCKADE_STATIONS_MOST places along it;
//                                     a place is closed by the fleets within
//                                     reach of it, wholly once they bring
//                                     BLOCKADE_CLOSES of weight to it
//   what is left to close it with     the country's own fleets, and its
//                                     allies', that lie in reach of a
//                                     blockading fleet and are not withdrawing
//                                     tie down their share of it
//   how much the country lives by sea its coast against the land borders it
//                                     has with countries it is not at war
//                                     with (an island lives by nothing else;
//                                     nobody with a coast lives by less than
//                                     SEA_TRADE_LEAST of it)
//
// A place on a coast whose water is frozen (fronts/climate.js) is shut by the
// ice: nothing comes in or goes out there, so under a blockade it counts as
// closed without a fleet. Ice alone lays no blockade on anyone.
//
// The period's pressure is the mean of its days, and the world keeps it
// (world.blockades) with how many days in a row the blockade has stood.
//
// THE ECONOMY. A country's economy shrinks under it: BLOCKADE_GDP_A_YEAR of
// its GDP in a year at full pressure, and BLOCKADE_BUDGET_A_YEAR points off its
// budget's balance, taken off the backend of its sheet
// (runtime/statsBackend.js) as a turn's manpower is. What it has to spend on
// its forces follows of itself (runtime/militaryFunding.js).
//
// THE LAND WAR. A country cut off from the sea is SHORT: by its pressure, and
// by how long it has stood, in full after BLOCKADE_BITES_DAYS (stockpiles run
// down). The side it fights on is weighed for it as the difficulty weighs a
// side (runtime/fronts/handicap.js shortEdge): its troops are brought back up
// to strength more slowly and fewer reserves come with them, and they fight
// and move a little worse. The land war of a period reads the blockades as
// the period began, so a blockade laid this period bites on land from the next.
//
// Pure, and loads in plain Node.

// The weight (a fleet's strength by what its country is, engine.js) that
// closes a place on a coast completely.
export const BLOCKADE_CLOSES = 60;
export const BLOCKADE_STATIONS_MOST = 48;
// What a land border with a country one is not at war with counts for against
// a like stretch of coast, and the least share of its trade any country with
// a coast has by sea.
export const LAND_TRADE_WEIGHT = 0.5;
export const SEA_TRADE_LEAST = 0.3;
// A pressure under this is no blockade.
export const BLOCKADE_LEAST = 0.02;
// The share of its GDP a country loses in a year at full pressure, and the
// most a single period takes however long it is.
export const BLOCKADE_GDP_A_YEAR = 0.2;
export const BLOCKADE_GDP_PERIOD_MOST = 0.5;
// And the points of GDP its budget's balance loses in a year at full pressure
// (customs and the trade it taxed are gone; the war at sea is paid for all
// the same): "make blockades directly effect economies" (the owner,
// 2026-10-14). A worse balance leaves it less for its forces
// (militaryFunding.js), and its war resources refill slower (warResources.js).
export const BLOCKADE_BUDGET_A_YEAR = 6;
// The days a blockade has to stand before a country is as short on land as
// its pressure makes it.
export const BLOCKADE_BITES_DAYS = 90;
export const BLOCKADES_KEPT_MOST = 40;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const within = (value, least, most) => Math.min(most, Math.max(least, value));

// The places a coast is read at: its cells' middles, evenly thinned to `most`.
//   centres   [[lng, lat]] of a country's coast cells, in the sheet's order
export const stationsOf = (centres, most = BLOCKADE_STATIONS_MOST) => {
  const all = list(centres);
  if (all.length <= most) return all.slice();
  const stations = [];
  for (let index = 0; index < most; index += 1) stations.push(all[Math.floor((index * all.length) / most)]);
  return stations;
};

// How much of its trade a country has by sea.
//   coast    how many cells of its land lie on the sea
//   border   how many lie on a land border with a country it is not at war with
export const seaShareOf = (coast, border) => {
  const sea = Math.max(0, Number(coast) || 0);
  if (sea === 0) return 0;
  const land = Math.max(0, Number(border) || 0) * LAND_TRADE_WEIGHT;
  return Math.max(SEA_TRADE_LEAST, sea / (sea + land));
};

// One day's pressure on a country.
//   stations     [[lng, lat]] along its coast (stationsOf)
//   blockaders   [{ lng, lat, weight }]: the fleets blockading it, each with what it can put into it today
//   reach        how far a fleet commands the water, in km
//   km           (lngA, latA, lngB, latB) => km
//   seaShare     seaShareOf of the country
//   iced         (lng, lat) => whether the water off that place is frozen today; null for none
// Returns { pressure, covered }: 0 to 1 each; `covered` is the share of its coast any blockading fleet reaches.
export const dayPressure = ({ stations = [], blockaders = [], reach = 0, km, seaShare = 1, iced = null } = {}) => {
  if (stations.length === 0 || blockaders.length === 0) return { pressure: 0, covered: 0 };
  let closed = 0;
  let covered = 0;
  for (const [lng, lat] of stations) {
    if (iced && iced(lng, lat)) {
      closed += 1;
      continue;
    }
    let weight = 0;
    for (const fleet of blockaders) if (km(lng, lat, fleet.lng, fleet.lat) <= reach) weight += fleet.weight;
    if (weight > 0) covered += 1;
    closed += Math.min(1, weight / BLOCKADE_CLOSES);
  }
  return { pressure: (seaShare * closed) / stations.length, covered: covered / stations.length };
};

// ---- what the world keeps ---------------------------------------------------------------

// world.blockades: { country, by: [names], pressure, covered, days, since }
//   pressure   the last period's, 0 to 1
//   covered    the share of its coast the blockading fleets reached
//   days       how many days in a row it has stood
//   since      the date it was laid
export const normalizeBlockade = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const country = clean(raw.country);
  const pressure = Number(raw.pressure);
  if (!country || !(pressure >= BLOCKADE_LEAST)) return null;
  return {
    country,
    by: [...new Set(list(raw.by).map((name) => clean(name)).filter(Boolean))].slice(0, 12),
    pressure: Math.round(within(pressure, 0, 1) * 1000) / 1000,
    covered: Math.round(within(Number(raw.covered) || 0, 0, 1) * 1000) / 1000,
    days: Math.max(0, Math.round(Number(raw.days) || 0)),
    since: clean(raw.since, 40),
  };
};

export const normalizeBlockades = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const record = normalizeBlockade(raw);
    if (record) kept.set(fold(record.country), record);
  }
  return [...kept.values()].slice(0, BLOCKADES_KEPT_MOST);
};

// The world's blockades after a period: each country the period pressed on,
// its days added to the days it had stood before; one the period no longer
// pressed on is lifted.
//   kept       world.blockades as the period began
//   period     what the period's run came to (engine.js runNaval `blockades`): [{ country, by, pressure, covered, days }]
//   fromDate   the day the period began
export const withTurnBlockades = (kept, period, fromDate = "") => {
  const before = new Map(normalizeBlockades(kept).map((record) => [fold(record.country), record]));
  const next = [];
  for (const raw of list(period)) {
    const was = before.get(fold(raw?.country));
    const record = normalizeBlockade({ ...raw, days: (was?.days ?? 0) + Math.max(0, Number(raw?.days) || 0), since: was?.since || clean(fromDate, 40) });
    if (record) next.push(record);
  }
  return next.slice(0, BLOCKADES_KEPT_MOST);
};

// How short on land a blockade leaves its country, 0 to 1.
export const shortageOfBlockade = (record) => {
  const pressure = Number(record?.pressure);
  const days = Number(record?.days);
  if (!(pressure >= BLOCKADE_LEAST) || !(days > 0)) return 0;
  return within(pressure, 0, 1) * Math.min(1, days / BLOCKADE_BITES_DAYS);
};

// A budget's balance (percent of GDP) after a period under blockade, no lower than -100.
export const budgetUnderBlockade = (balance, pressure, days) => {
  const was = Number(balance);
  if (!Number.isFinite(was)) return was;
  return Math.max(-100, was - (BLOCKADE_BUDGET_A_YEAR * within(Number(pressure) || 0, 0, 1) * Math.max(0, Number(days) || 0)) / 365);
};

// A country's GDP after a period under blockade.
//   pressure   the period's mean, 0 to 1
//   days       the period's length
export const gdpUnderBlockade = (gdp, pressure, days) => {
  const size = Number(gdp);
  if (!(size > 0)) return size;
  const lost = Math.min(BLOCKADE_GDP_PERIOD_MOST, (BLOCKADE_GDP_A_YEAR * within(Number(pressure) || 0, 0, 1) * Math.max(0, Number(days) || 0)) / 365);
  return size * (1 - lost);
};
