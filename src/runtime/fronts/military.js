/*! Open Historia — battlefields and fronts: each country's own military figures © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "military"). Before it, every country's
// soldiers fought alike: a peasant levy and a knightly host, the Unsullied and
// a wildling band, were the same counter. A run is now given each country's
// own figures (input.militaryOf(name); the game reads them from its scenario
// and the countries' backend sheets: runtime/militaryStats.js), each 0 to 100,
// where 50 is what every country was before:
//
//   quality         how well its soldiers fight: a levy, or elites
//   technology      what they fight with
//   land, sea, air  what it can do in each; 0 is nothing at all: no army, no
//                   navy, no air wings
//
// and besides, each null for the scenario's or its era's own:
//
//   manpowerShare   the share of its people who can fight, in percent
//   cavalryShare    the share of its counters that are horse (armour from
//                   1850), 0 to 1
//   siegeShare      the share that are siege engines (artillery from 1850), 0 to 1
//   menPerCounter   the men one of its counters stands for
//
// What its troops fight with on land is its quality, its technology and its
// land arm together (landWorth): each a straight line through 1 at 50, so a
// country at 50 in all three fights as every country did.
//
// Only + - * / and comparisons.

export const MILITARY_NEUTRAL = Object.freeze({
  quality: 50,
  technology: 50,
  land: 50,
  sea: 50,
  air: 50,
  manpowerShare: null,
  cavalryShare: null,
  siegeShare: null,
  menPerCounter: null,
});

// What a figure from 0 to 100 does, at 0 and at 100 (1 at 50).
export const QUALITY_FACTORS = Object.freeze([0.5, 1.5]);
export const TECHNOLOGY_FACTORS = Object.freeze([0.7, 1.3]);
export const ARM_FACTORS = Object.freeze([0.5, 1.5]);

const given = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const stat = (value) => {
  if (!given(value)) return 50;
  const number = Number(value);
  return number < 0 ? 0 : number > 100 ? 100 : number;
};
const between = (value, least, most) => {
  if (!given(value)) return null;
  const number = Number(value);
  return number >= least && number <= most ? number : null;
};

// A country's figures as a run reads them: each in range, what is not given at its neutral.
export const readMilitary = (value) => ({
  quality: stat(value?.quality),
  technology: stat(value?.technology),
  land: stat(value?.land),
  sea: stat(value?.sea),
  air: stat(value?.air),
  manpowerShare: between(value?.manpowerShare, 0.1, 100),
  cavalryShare: between(value?.cavalryShare, 0, 1),
  siegeShare: between(value?.siegeShare, 0, 1),
  menPerCounter: between(value?.menPerCounter, 1, 1000000),
});

// A figure as a factor: `least` at 0, exactly 1 at 50, `most` at 100, in a straight line between.
export const statFactor = (value, least, most) => (value === 50 ? 1 : value < 50 ? least + ((1 - least) * value) / 50 : 1 + ((most - 1) * (value - 50)) / 50);

const armWorth = (stats, arm) => (arm <= 0 ? 0 : statFactor(stats.quality, QUALITY_FACTORS[0], QUALITY_FACTORS[1])
  * statFactor(stats.technology, TECHNOLOGY_FACTORS[0], TECHNOLOGY_FACTORS[1])
  * statFactor(arm, ARM_FACTORS[0], ARM_FACTORS[1]));

// What a country's troops fight with on land, at sea and in the air, against
// what every country had before: 0 for an arm it has none of.
export const landWorth = (stats) => armWorth(stats, stats.land);
export const seaWorth = (stats) => armWorth(stats, stats.sea);
export const airWorth = (stats) => armWorth(stats, stats.air);

// The shares its counters are raised in (troops.js kindsFor): its own where it gave them, its era's otherwise.
export const mixOf = (stats) => (stats.cavalryShare === null && stats.siegeShare === null ? null : { armour: stats.cavalryShare, artillery: stats.siegeShare });
