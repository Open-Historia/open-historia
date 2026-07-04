/*! Open Historia — minimal service worker (PWA installability only, no caching) */
// This project's data (scenarios, games, world state) is fetched live from
// the server on every read — a caching service worker would risk serving
// stale game state. This one exists only to satisfy install criteria; it
// passes every request straight through to the network.
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    event.respondWith(fetch(event.request));
});
