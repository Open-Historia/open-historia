/*! Open Historia — clearing the map copies other ports left behind © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The page once kept a copy of the world map in Cache Storage for every sitting
// of every game (src/runtime/assets.js, isStalePersistedCopy), and never deleted
// one: a profile grew to 20-30 GB. The page now keeps none and deletes what its
// own origin holds. But Cache Storage is kept per origin, and to the page each
// port is its own origin: a launch that found 3000 taken and started on 3002
// left gigabytes under localhost:3002 that the page at localhost:3000 can never
// see. Those are cleared from here, where every origin is in reach.

// How many ports a launch tries, counting from the one it asked for: the
// default of findFreePort in main.cjs, which a test holds this to. The same
// span is where old copies can be.
const PORT_SEARCH_SPAN = 20;

// Every origin a launch could have run on, except the one this launch has.
const otherPortOrigins = (port, requested = 3000, span = PORT_SEARCH_SPAN) => {
  const current = Number(port);
  const ports = new Set();
  // A launch with PORT set searches from there; one without, from 3000.
  for (const start of [Number(requested) || 3000, 3000]) {
    for (let candidate = start; candidate < start + span; candidate += 1) ports.add(candidate);
  }
  ports.delete(current);
  return [...ports].sort((a, b) => a - b).map((candidate) => `http://localhost:${candidate}`);
};

// Only Cache Storage: saves and settings are not in the page's storage at all
// (they are files under the data folder), but nothing else is touched anyway.
const clearOtherPortsCaches = async (session, { port, requested } = {}) => {
  const origins = otherPortOrigins(port, requested);
  let failed = 0;
  for (const origin of origins) {
    try {
      await session.clearStorageData({ origin, storages: ["cachestorage"] });
    } catch {
      failed += 1;
    }
  }
  return { origins: origins.length, failed };
};

module.exports = { PORT_SEARCH_SPAN, otherPortOrigins, clearOtherPortsCaches };
