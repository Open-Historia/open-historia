/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The Disputed-by field over a multi-region selection whose claimant lists
// differ. The field shows only the claimants every region shares, and an edit
// is applied to each region as a change against its OWN list — a claimant
// added joins every list, one removed leaves every list — so the claims only
// some regions carry are never overwritten. Keys are exact polity keys.

const listOf = (value) => (Array.isArray(value) ? value.map((v) => String(v)) : []);

// { shown, mixed }: the claimants every list has (in the first list's order),
// and whether the lists differ at all.
export const commonClaimants = (lists) => {
  const rows = (lists || []).map(listOf);
  if (!rows.length) return { shown: [], mixed: false };
  const first = JSON.stringify(rows[0]);
  const mixed = rows.some((row) => JSON.stringify(row) !== first);
  if (!mixed) return { shown: rows[0], mixed: false };
  const shown = rows[0].filter((key, i, all) => all.indexOf(key) === i && rows.every((row) => row.includes(key)));
  return { shown, mixed: true };
};

// The change from what the field showed to what it holds now.
export const claimantDelta = (shown, next) => {
  const before = listOf(shown);
  const after = listOf(next).map((v) => v.trim()).filter(Boolean);
  return {
    add: after.filter((key, i) => after.indexOf(key) === i && !before.includes(key)),
    remove: before.filter((key) => !after.includes(key)),
  };
};

// One region's list with the delta applied, deduplicated, order kept.
export const applyClaimantDelta = (list, { add = [], remove = [] } = {}) => {
  const kept = listOf(list).filter((key) => !remove.includes(key));
  return [...new Set([...kept, ...add])];
};
