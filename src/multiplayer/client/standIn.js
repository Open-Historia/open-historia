/*! Open Historia — which of a guest's scenarios a shared game is drawn on © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A guest's screen draws the host's game on its own copy of the host's
// scenario (client/sharedGame.js prepareStandIn). The host states its map's
// checksum in the lobby (server/scenarioFingerprint.js), and the copy used is
// the one whose map is the host's, whatever it is called here: a scenario the
// host made or changed has an id of its own on every device it was copied to.
// Before, the same id or the same name was enough, and a copy that differed
// (a region the host split in two, an older version from the hub) drew another
// world for the whole game without a word.
//
// Runtime-free: `fingerprintOf(id)` gives a local scenario's checksum.

const clean = (value) => String(value ?? "").trim();
const sameName = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();

// { scenario } the copy to use; { scenario: null, differs } none: `differs` when
// the host's scenario is here by id or name, and its map is not the host's.
export const chooseStandInScenario = async ({ scenarios = [], host = {}, fingerprintOf = async () => "" } = {}) => {
  const all = scenarios.filter((entry) => clean(entry?.id));
  const byId = all.find((entry) => clean(entry.id) === clean(host.id)) ?? null;
  const named = all.filter((entry) => sameName(entry.name, host.name));
  const hash = clean(host.hash).toLowerCase();
  // An older host states no checksum: its id, else its one scenario of that name.
  if (!hash) return { scenario: byId ?? (named.length === 1 ? named[0] : null), differs: false };
  // The likely copies first, then any other: a copy renamed here is still the map.
  const order = [...new Set([byId, ...named, ...all].filter(Boolean))];
  for (const candidate of order) {
    const mine = clean(await Promise.resolve(fingerprintOf(candidate.id)).catch(() => "")).toLowerCase();
    if (mine && mine === hash) return { scenario: candidate, differs: false };
  }
  return { scenario: null, differs: Boolean(byId || named.length) };
};
