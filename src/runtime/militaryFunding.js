/*! Open Historia — what a country has to spend on its forces © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Budget: factors in economics for military strength to know how much funding
// exists in the backend."
//
// A country's sheet of statistics says what its economy is (runtime/
// countryStats.js: GDP, the balance of its budget, its public debt). From
// those this works out, and nothing asks a model for it:
//
//   militaryFunding   what it has for its forces in a year, in the sheet's
//                     own currency: a share of its GDP (MILITARY_GDP_SHARE),
//                     more with a budget in surplus, less with one in deficit
//                     and under a heavy debt;
//   fundingFactor     what that does to its weight in a land war (Game/AI/
//                     frontTurn.js countryWeight): how its treasury stands,
//                     and how well funded each of its people is against the
//                     other countries whose economies are known.
//
// A country the AI rated has a figure for it besides (militaryStats.js
// `spending`, rated against every other country: Game/AI/militaryRating.js),
// and that is what its weight takes (forcesFunding): every country so rated is
// on one scale, whether or not its economy is known.
//
// The second part needs other sheets to compare with, and in the same
// currency, which is true of a scenario's own countries; with fewer than
// FUNDING_COMPARED_LEAST of them known, only the state of the treasury counts.
// A country with no sheet has a factor of 1: nothing is known, and nothing is
// changed.
//
// Pure, and loads in plain Node.

import { statFactor } from "./fronts/military.js";

export const MILITARY_GDP_SHARE = 0.03;
// The budget's balance and the debt, as shares of GDP in percent: each point
// of surplus or deficit moves the funding by this much, and each point of
// debt past DEBT_EASY by that much, within these bounds.
export const BALANCE_PER_POINT = 0.02;
export const DEBT_EASY = 60;
export const DEBT_PER_POINT = 0.0015;
export const TREASURY_LEAST = 0.6;
export const TREASURY_MOST = 1.25;
// How strongly funding a head counts against the middle of the known
// countries (a power of the ratio), and the bounds of the whole factor.
export const FUNDING_POWER = 0.25;
export const FUNDING_COMPARED_LEAST = 3;
export const FUNDING_FACTOR_LEAST = 0.6;
export const FUNDING_FACTOR_MOST = 1.5;

const number = (value) => {
  const read = Number(value);
  return Number.isFinite(read) ? read : 0;
};
const within = (value, least, most) => Math.min(most, Math.max(least, value));

// How a treasury stands: 1 with a balanced budget and an easy debt.
export const treasuryFactor = (sheet) => {
  const economy = sheet?.economy ?? {};
  const balance = within(number(economy.budgetBalance), -25, 25);
  const debt = within(number(economy.publicDebt), 0, 400);
  return within(1 + balance * BALANCE_PER_POINT - Math.max(0, debt - DEBT_EASY) * DEBT_PER_POINT, TREASURY_LEAST, TREASURY_MOST);
};

// What a country has for its forces in a year, in its sheet's currency; 0 where its economy is not known.
export const militaryFunding = (sheet) => {
  const gdp = number(sheet?.economy?.gdp);
  return gdp > 0 ? gdp * MILITARY_GDP_SHARE * treasuryFactor(sheet) : 0;
};

// The same for each of its people; 0 where either is not known.
export const fundingPerHead = (sheet) => {
  const people = number(sheet?.population?.total);
  const funding = militaryFunding(sheet);
  return people > 0 && funding > 0 ? funding / people : 0;
};

// The middle of what the known countries have a head: 0 with too few of them to compare.
export const middleFundingPerHead = (countryStats) => {
  const known = Object.values(countryStats && typeof countryStats === "object" ? countryStats : {}).map(fundingPerHead).filter((value) => value > 0).sort((a, b) => a - b);
  if (known.length < FUNDING_COMPARED_LEAST) return 0;
  const half = Math.floor(known.length / 2);
  return known.length % 2 === 1 ? known[half] : (known[half - 1] + known[half]) / 2;
};

// What a country's funding does to its weight in a land war.
//   middle   middleFundingPerHead of the world's sheets, or 0 for none to compare with
export const fundingFactor = (sheet, middle = 0) => {
  if (!(number(sheet?.economy?.gdp) > 0)) return 1;
  const head = fundingPerHead(sheet);
  // (The treasury is in the funding already; with nothing to compare with, it is all there is.)
  const against = middle > 0 && head > 0 ? Math.pow(head / middle, FUNDING_POWER) : treasuryFactor(sheet);
  return within(against, FUNDING_FACTOR_LEAST, FUNDING_FACTOR_MOST);
};

// What a rated `spending` (0 to 100, 50 the middle of the world) does to a country's weight: FUNDING_FACTOR_LEAST
// at nothing, 1 at 50, FUNDING_FACTOR_MOST for the best funded, in a straight line between.
export const spendingFactor = (spending) => {
  const value = Number(spending);
  return spending !== null && spending !== undefined && spending !== "" && Number.isFinite(value)
    ? statFactor(within(value, 0, 100), FUNDING_FACTOR_LEAST, FUNDING_FACTOR_MOST)
    : 1;
};

// What a country's forces have to spend, as its weight in a land war takes it (countryWeight.js): the figure it
// was rated at against the others where it has one ("when this stuff is generated, it should be relative to other
// countries", the owner, 2026-10-16), else what its economy pays for (fundingFactor), else 1.
//   military   its figures as the game counts them (militaryStats.js militaryLookup), or null
export const forcesFunding = ({ sheet = null, middle = 0, military = null } = {}) => {
  const rated = military?.spending;
  return rated !== null && rated !== undefined && rated !== "" && Number.isFinite(Number(rated)) ? spendingFactor(rated) : fundingFactor(sheet, middle);
};
