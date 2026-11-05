/*! Open Historia — is the map a game zip carries already here? © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A game zip carries its map when nothing else can supply it (gameZip.js), and
// names it by the sender's scenario id. Ids come from names (ensureUniqueId(id
// || name) in both stores), so an id this library already holds says nothing
// about whether it is the same map: a player's own "New Scenario" holds the id
// of every other player's "New Scenario". Skipping the carried map on an id
// match opened the game on an unrelated map and lost the sender's.
//
// So the carried map is imported unless a copy of it is already here: a
// scenario under that id, or under the id an earlier import of it was given
// (the id with a -2, -3… suffix), whose name, world, game and prompts are the
// bundle's. Those are what an import writes, and what a copy imported from the
// same file reads back, so importing the same game twice still leaves one map.
// Anything else, including a copy since edited, is a different map and the
// carried one is imported beside it.

// JSON with every object's keys in order, so two equal values compare equal
// whatever order their keys were written in.
const stableJson = (value) => JSON.stringify(value, (_key, entry) => (
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
    : entry
));

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The scenarios that could be an earlier import of a bundle sent as `scenarioId`.
export const scenarioCopyCandidates = (scenarioId, scenarios) => {
  const id = String(scenarioId ?? "").trim();
  if (!id) return [];
  const suffixed = new RegExp(`^${escapeRegExp(id)}-\\d+$`);
  return (Array.isArray(scenarios) ? scenarios : []).filter((entry) => entry?.id === id || suffixed.test(String(entry?.id ?? "")));
};

// Whether a scenario's details (loadScenarioDetails) hold the same map as a
// scenario bundle.
export const bundleMatchesScenario = (bundle, details) => {
  if (!bundle || !details?.scenario) return false;
  const name = String(bundle.scenario?.name ?? "").trim();
  if (!name || name !== String(details.scenario.name ?? "").trim()) return false;
  return ["world", "game", "prompts"].every((key) => stableJson(bundle.data?.[key] ?? {}) === stableJson(details.data?.[key] ?? {}));
};

// The id of this library's copy of the map a game zip carries, or null when it
// has none and the carried map has to be imported.
export const findScenarioCopyOfBundle = async (bundle, scenarios, loadDetails) => {
  for (const candidate of scenarioCopyCandidates(bundle?.scenario?.id, scenarios)) {
    const details = await loadDetails(candidate.id).catch(() => null);
    if (bundleMatchesScenario(bundle, details)) return candidate.id;
  }
  return null;
};
