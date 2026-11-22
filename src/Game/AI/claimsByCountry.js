/*! Open Historia — claims withdrawn from a whole country in one entry © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so events can remove all claims on territory on a country" (the
// owner, 2026-11-09). A regionClaims entry written "country: <name>" with
// drop true withdraws claims on every region that country holds (as a
// transfer's "country: <name>" means it: its sovereign land, else what it
// controls), whichever of them carries one: the claimant's, or with
// allClaimants every claimant's, contests included, since a dispute is kept in
// the same claimant list. One entry, never a list of regions and never capped:
// written region by region, a withdrawal was as long as the model would write
// (about seventy regions in a player's game) and the rest stayed claimed.
//
// Import-free, so node tests and the resolver (gameplay.js) share it.

// `regions`: the country's regions ({ id, name }). `claimantsOf(regionId)`:
// the names claiming or contesting it. `isClaimant(name)`: whether a name is
// the withdrawing claimant. Returns one ordinary drop entry per region.
export const countryClaimWithdrawals = (claim, { regions = [], claimantsOf = () => [], isClaimant = () => false } = {}) => {
  if (!claim || claim.drop !== true) return [];
  const everyone = claim.allClaimants === true;
  const out = [];
  for (const region of Array.isArray(regions) ? regions : []) {
    const id = String(region?.id ?? "").trim();
    if (!id) continue;
    const names = Array.isArray(claimantsOf(id)) ? claimantsOf(id) : [];
    if (!names.some((name) => everyone || isClaimant(name))) continue;
    out.push({ ...claim, regionId: id, regionName: String(region?.name ?? "") });
  }
  return out;
};
