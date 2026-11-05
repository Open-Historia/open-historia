/*! Open Historia — Country Diplomacy roster presentation helpers © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
// These helpers operate on the already scoped/visible diplomatic rows produced
// by the Country drawer. They never read canonical world state or puppet ledgers.
const clean = (value) => String(value ?? "").trim();
const nameOf = (row) => clean(row?.counterpartName);
const scoreOf = (row) => {
  const value = row?.score;
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const COUNTRY_RELATION_SORTS = Object.freeze(["strongest", "weakest", "alphabetical"]);

export const filterAndSortCountryRelations = (rows, { search = "", sort = "strongest" } = {}) => {
  const query = clean(search).toLocaleLowerCase();
  const visible = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!query) return true;
    return [row?.counterpartName, row?.summary, row?.displayStatus].some(
      (value) => clean(value).toLocaleLowerCase().includes(query),
    );
  });
  const mode = COUNTRY_RELATION_SORTS.includes(sort) ? sort : "strongest";
  return visible.sort((a, b) => {
    if (mode !== "alphabetical") {
      const aScore = scoreOf(a);
      const bScore = scoreOf(b);
      // Unknown values stay at the bottom, never silently ranked as neutral.
      if (aScore === null && bScore !== null) return 1;
      if (bScore === null && aScore !== null) return -1;
      if (aScore !== null && bScore !== null && aScore !== bScore) {
        return mode === "weakest" ? aScore - bScore : bScore - aScore;
      }
    }
    return nameOf(a).localeCompare(nameOf(b));
  });
};
