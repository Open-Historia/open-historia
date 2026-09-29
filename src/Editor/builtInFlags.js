/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The flag picker's built-in flags, by country name. listBuiltInFlags knows
// them by ISO3 code only, but owners are names now: nobody should need to know
// that Germany is DEU to find its flag. Each choice carries the stock name
// (the game's own code -> name table), search matches the name, the code and
// the alpha-2 code, and the picker suggests the flag for the polity it is open
// for when that polity is a standard country — the same recognition "Fill
// standard flags" uses (resolveStockCountryCode). A suggestion only; nothing
// is renamed or assigned.

import COUNTRY_NAMES from "../runtime/generated/countryNames.js";
import { listBuiltInFlags } from "../runtime/countryFlags.js";
import { resolveStockCountryCode } from "../runtime/polityIdentity.js";

// Flags the game can draw for places the GADM name table has no entry for.
const EXTRA_NAMES = { HKG: "Hong Kong", MAC: "Macao", MCO: "Monaco", VAT: "Vatican City" };

export const builtInFlagChoices = () =>
  listBuiltInFlags()
    .map((flag) => ({ ...flag, name: COUNTRY_NAMES[flag.code] || EXTRA_NAMES[flag.code] || flag.code }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));

// Choices whose name, code or alpha-2 code contains the query, plus the country
// a full official name resolves to ("Russian Federation" finds Russia).
export const filterBuiltInFlags = (choices, query) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return choices;
  const resolved = resolveStockCountryCode(query);
  return choices.filter(
    (flag) =>
      flag.code === resolved ||
      flag.name.toLowerCase().includes(q) ||
      flag.code.toLowerCase().includes(q) ||
      flag.alpha2.includes(q),
  );
};

// The built-in flag for a polity that is a standard country, or null.
export const suggestedBuiltInFlag = (choices, polity) => {
  const code = resolveStockCountryCode(polity);
  return code ? choices.find((flag) => flag.code === code) || null : null;
};
