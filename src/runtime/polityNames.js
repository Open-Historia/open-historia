/*! Open Historia — country display-name resolver © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Codes ("RUS", "KHAL") are load-bearing identifiers everywhere in the data,
// but the PLAYER should only ever see full names. This resolves a code to the
// era polity name (world.polityOverrides) or the base country name, with the
// code itself as a last resort, and caches the lookup for cheap sync access.
//
// Seeded once per game with a plain read of the cached world, then kept current
// by the writes themselves: every world write dispatches oh:world-updated with
// the world attached, and names only change on a world write. It used to
// force-read and clone the whole world.json whenever the map was 15 s old,
// which also replaced the cached world and made the next view re-normalize it.
import { useEffect, useState } from "react";
import { JSON_URLS, loadCountryNames, readJson } from "./assets.js";

let nameByCode = new Map();
let countryNames = null;
let loaded = false;
let inflight = null;
let generation = 0;
// A world written while the seed's read was out, which that read may predate.
let writtenDuringSeed = null;
const listeners = new Set();

const build = (countries, world) => {
  const next = new Map();
  for (const country of countries ?? []) {
    if (country?.code) next.set(String(country.code), country.name || country.code);
  }
  // Era polities win over modern names for the same code — but only when
  // they actually carry a name; a nameless override must not degrade one.
  for (const polity of Object.values(world?.polityOverrides ?? {})) {
    if (polity?.code && polity?.name) next.set(String(polity.code), polity.name);
  }
  return next;
};

const publish = (next) => {
  nameByCode = next;
  for (const listener of [...listeners]) listener();
};

const seed = async () => {
  const startedIn = generation;
  const [countries, world] = await Promise.all([
    countryNames ?? loadCountryNames().catch(() => []),
    readJson(JSON_URLS.world, { defaultValue: {}, clone: false }).catch(() => ({})),
  ]);
  // A game switched while the read was out: its answer is the old game's, so
  // read again for the new one. The switch's own ensurePolityNames joined this
  // read rather than starting its own, so nobody else would.
  if (startedIn !== generation) return seed();
  countryNames = countries ?? [];
  const newest = writtenDuringSeed ?? world;
  writtenDuringSeed = null;
  loaded = true;
  publish(build(countryNames, newest));
};

export const ensurePolityNames = async () => {
  if (loaded) return;
  inflight = inflight ?? seed().finally(() => {
    inflight = null;
  });
  await inflight;
};

// Told whenever the names change (a world write, a game switch).
export const subscribePolityNames = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const onWorldUpdated = (event) => {
  const world = event?.detail?.world;
  if (!world || typeof world !== "object") return;
  if (!countryNames) {
    // Not seeded yet: the seed takes this over whatever its read returns.
    writtenDuringSeed = world;
    return;
  }
  loaded = true;
  publish(build(countryNames, world));
};

const onActiveGameChanged = () => {
  generation += 1;
  loaded = false;
  // The country list belongs to the scenario, which a game switch may change.
  countryNames = null;
  writtenDuringSeed = null;
  publish(new Map());
  // Dispatched once the endpoints point at the new save (library.js), so a read
  // now gets its names; only when something on screen is showing them.
  if (listeners.size) void ensurePolityNames();
};

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("oh:world-updated", onWorldUpdated);
  window.addEventListener("oh:active-game-changed", onActiveGameChanged);
}

// Sync lookup — falls back to the code until ensurePolityNames has run.
export const polityDisplayName = (code) => {
  const key = String(code ?? "").trim();
  if (!key) return "";
  return nameByCode.get(key) || key;
};

// Hook variant for single values: renders the code briefly, then the name, and
// follows a rename as soon as it is written.
export const useCountryDisplayName = (code) => {
  const [name, setName] = useState(() => polityDisplayName(code));

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (!cancelled) setName(polityDisplayName(code));
    };
    sync();
    const unsubscribe = subscribePolityNames(sync);
    ensurePolityNames().then(sync);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [code]);

  return name;
};
