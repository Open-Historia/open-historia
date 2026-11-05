/*! Open Historia — a community basemap that could not be downloaded © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A hub scenario can use a community basemap by reference. When the download
// fails at import or Update (offline, a 403 or 502, a moved file), both stores
// keep the reference with the scenario (scenario.missingBasemap,
// server/hubProvenance.js) instead of forgetting it. Opening the scenario (its
// editor, its country picker, or a game on it) tries the download again here,
// once per scenario per session, so a failure that has cleared up mends itself
// without a second import; the stores then put the basemap in place
// (PUT /api/scenarios/:id/basemap) without counting it as an edit.
import { basemapFailureReason, fetchReferencedBasemap } from "./communityBasemaps.js";

const tried = new Set();

// The URL is part of the key: an Update that references another basemap is
// tried again.
const triedKey = (scenario) => {
  const url = scenario?.missingBasemap?.reference?.url;
  return scenario?.id && url ? `${scenario.id}\n${url}` : "";
};

// The import or Update that has just failed to download it counts as this
// session's try: opening the scenario straight after would only fail again.
export const noteMissingBasemapTried = (scenario) => {
  const key = triedKey(scenario);
  if (key) tried.add(key);
};

// Loaded when needed: library.js pulls in the game's runtime modules.
const restoreThroughLibrary = async (scenarioId, payload) =>
  (await import("./library.js")).restoreScenarioBasemap(scenarioId, payload);

// null when there is nothing to try (no missing basemap, or it was tried this
// session); otherwise { restored: true, details } or { restored: false, reason }
// with the reason as one whole sentence.
export const retryMissingBasemap = async (
  scenario,
  { fetchBasemap = fetchReferencedBasemap, restore = restoreThroughLibrary } = {},
) => {
  const key = triedKey(scenario);
  if (!key || tried.has(key)) return null;
  tried.add(key);
  try {
    const payload = await fetchBasemap(scenario.missingBasemap.reference);
    return { restored: true, details: await restore(scenario.id, payload) };
  } catch (error) {
    return { restored: false, reason: basemapFailureReason(error) };
  }
};
