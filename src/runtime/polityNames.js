/*! Open Historia — country display-name resolver © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Codes ("RUS", "KHAL") are load-bearing identifiers everywhere in the data,
// but the PLAYER should only ever see full names. This resolves a code to the
// era polity name (world.polityOverrides) or the base country name, with the
// code itself as a last resort, and caches the lookup for cheap sync access.
import { useEffect, useState } from "react";
import { JSON_URLS, loadCountryNames, readJson } from "./assets.js";

let nameByCode = new Map();
let refreshedAt = 0;
let inflight = null;
// Bumped by a switch to another save: a refresh begun before it read that
// save's world, and its names are not this one's.
let generation = 0;
const resetListeners = new Set();

const refresh = async () => {
  const startedIn = generation;
  const [countries, world] = await Promise.all([
    loadCountryNames().catch(() => []),
    readJson(JSON_URLS.world, { defaultValue: {}, force: true }).catch(() => ({})),
  ]);
  if (startedIn !== generation) return;
  const next = new Map();
  for (const country of countries ?? []) {
    if (country?.code) next.set(String(country.code), country.name || country.code);
  }
  // Era polities win over modern names for the same code — but only when
  // they actually carry a name; a nameless override must not degrade one.
  for (const polity of Object.values(world?.polityOverrides ?? {})) {
    if (polity?.code && polity?.name) next.set(String(polity.code), polity.name);
  }
  nameByCode = next;
  refreshedAt = Date.now();
};

export const ensurePolityNames = async () => {
  if (Date.now() - refreshedAt > 15000) {
    if (!inflight) {
      const run = refresh().finally(() => {
        if (inflight === run) inflight = null;
      });
      inflight = run;
    }
    await inflight;
  }
};

// Another save is open: its polities may carry other names for the same codes
// ("German Reich" in one, "Federal Republic of Germany" in the next). The cache
// is emptied, a refresh still in flight is disowned, and every mounted name
// looks itself up again.
export const resetPolityNames = () => {
  generation += 1;
  nameByCode = new Map();
  refreshedAt = 0;
  inflight = null;
  for (const listener of [...resetListeners]) listener();
};

// Returns the unsubscribe.
export const onPolityNamesReset = (listener) => {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
};

if (typeof window !== "undefined") {
  window.addEventListener("oh:active-game-changed", resetPolityNames);
}

// Sync lookup — falls back to the code until ensurePolityNames has run.
export const polityDisplayName = (code) => {
  const key = String(code ?? "").trim();
  if (!key) return "";
  return nameByCode.get(key) || key;
};

// Hook variant for single values: renders the code briefly, then the name.
export const useCountryDisplayName = (code) => {
  const [name, setName] = useState(() => polityDisplayName(code));

  useEffect(() => {
    let cancelled = false;
    const lookUp = () => {
      setName(polityDisplayName(code));
      ensurePolityNames().then(() => {
        if (!cancelled) setName(polityDisplayName(code));
      });
    };
    lookUp();
    // The same code can name another polity in the save switched to.
    const unsubscribe = onPolityNamesReset(lookUp);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [code]);

  return name;
};
