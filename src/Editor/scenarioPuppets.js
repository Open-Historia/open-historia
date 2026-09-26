/*!
 * Open Historia Map Editor — puppet states a scenario starts with
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A scenario's starting subordinations — protectorates, puppet states, client
// states — kept in the document as doc.puppets, in the game's own row shape
// (world.puppets; runtime/gameState.js normalizeWorldPuppet), so a scenario's
// rows open and save unchanged and the export has nothing to translate. The
// Workshop edits the live rows only, by the rules the game's ledger keeps
// (AI/nativeDiplomaticDirector.js applyPuppetUpdates): a polity answers to one
// overlord, nobody is their own, and there are no chains — an overlord is
// nobody's puppet, and a puppet holds none of its own. Ended rows (released,
// annexed, revolted) are history and pass through untouched.
//
// Import-free, so the export and the tests share it.

export const PUPPET_KIND_OPTIONS = Object.freeze([
  { id: "protectorate", label: "Protectorate" },
  { id: "satellite", label: "Puppet state" },
  { id: "client", label: "Client state" },
]);
export const PUPPET_SECRECY_OPTIONS = Object.freeze([
  { id: "open", label: "Openly known" },
  { id: "covert", label: "Covert" },
]);
// Below this the game seeds a hidden coup storyline on the first turn.
export const PUPPET_COUP_LOYALTY = 35;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const rows = (puppets) => (Array.isArray(puppets) ? puppets.filter((row) => row && typeof row === "object") : []);
const isLive = (row) => (clean(row?.status) || "active") === "active";
const same = (a, b) => clean(a).toLocaleLowerCase() === clean(b).toLocaleLowerCase() && clean(a) !== "";
const slug = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "polity";
const loyaltyOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
};

// The live row that makes `polity` someone's puppet, or null.
export const overlordRowOf = (puppets, polity) => rows(puppets).find((row) => isLive(row) && same(row.puppet, polity)) ?? null;
// The live rows in which `polity` is the overlord.
export const puppetRowsOf = (puppets, polity) => rows(puppets).filter((row) => isLive(row) && same(row.overlord, polity));

// Who may be `polity`'s overlord: not itself, not a puppet (no chains), and
// nobody at all while `polity` holds puppets of its own.
export const overlordChoicesFor = (puppets, polity, candidates) => {
  if (puppetRowsOf(puppets, polity).length) return [];
  return (Array.isArray(candidates) ? candidates : []).filter((key) => !same(key, polity) && !overlordRowOf(puppets, key));
};

// Make `puppet` answer to `overlord` (or to no one, with an empty overlord).
// Returns { puppets, error }; on a refusal the list comes back unchanged.
export const setOverlord = (puppets, puppet, overlord, patch = {}) => {
  const list = rows(puppets).map((row) => ({ ...row }));
  const index = list.findIndex((row) => isLive(row) && same(row.puppet, puppet));
  const target = clean(overlord);
  if (!target) {
    if (index >= 0) list.splice(index, 1);
    return { puppets: list, error: "" };
  }
  if (same(target, puppet)) return { puppets: rows(puppets), error: "A polity cannot be its own puppet." };
  if (overlordRowOf(list, target)) return { puppets: rows(puppets), error: `${target} is itself a puppet, and a puppet holds no puppets of its own.` };
  if (puppetRowsOf(list, puppet).length) return { puppets: rows(puppets), error: `${clean(puppet)} holds puppets of its own, so it cannot be one.` };
  if (index >= 0) {
    list[index] = { ...list[index], overlord: target, ...patch };
  } else {
    const taken = new Set(list.map((row) => clean(row.id)));
    let id = `puppet-${slug(puppet)}`;
    for (let n = 2; taken.has(id); n += 1) id = `puppet-${slug(puppet)}-${n}`;
    list.push({ id, overlord: target, puppet: clean(puppet), kind: "satellite", secrecy: "open", loyalty: 50, status: "active", ...patch });
  }
  return { puppets: list, error: "" };
};

// Change the live row for `puppet` (kind, secrecy, loyalty).
export const patchPuppetRow = (puppets, puppet, patch) => rows(puppets).map((row) => (
  isLive(row) && same(row.puppet, puppet) ? { ...row, ...patch } : row
));

// A polity removed from the map takes its subordinations with it.
export const withoutPolities = (puppets, keys) => {
  const gone = (Array.isArray(keys) ? keys : [keys]).map(clean).filter(Boolean);
  if (!gone.length) return rows(puppets);
  return rows(puppets).filter((row) => !gone.some((key) => same(row.overlord, key) || same(row.puppet, key)));
};

// doc.puppets -> world.puppets. Live rows get a start date when they have none,
// and both parties in knownTo, as an install by the ledger writes them; the
// game's normalizer does the rest on read.
export const buildPuppetsForGame = (puppets, { startDate = "" } = {}) => rows(puppets)
  .filter((row) => clean(row.overlord) && clean(row.puppet) && !same(row.overlord, row.puppet))
  .map((row) => {
    if (!isLive(row)) return { ...row };
    const started = clean(row.startedDate) || clean(startDate);
    const known = Array.isArray(row.knownTo) ? row.knownTo.filter(Boolean) : [];
    const knows = (polity) => known.some((entry) => same(typeof entry === "string" ? entry : entry?.polity, polity));
    return {
      ...row,
      overlord: clean(row.overlord),
      puppet: clean(row.puppet),
      kind: PUPPET_KIND_OPTIONS.some((option) => option.id === row.kind) ? row.kind : "satellite",
      secrecy: row.secrecy === "covert" ? "covert" : "open",
      loyalty: loyaltyOf(row.loyalty),
      status: "active",
      startedDate: started,
      knownTo: [
        ...known,
        ...[row.overlord, row.puppet].filter((polity) => !knows(polity)).map((polity) => ({ polity: clean(polity), learnedDate: started })),
      ],
    };
  });
