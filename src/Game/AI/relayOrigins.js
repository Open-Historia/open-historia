/*! Open Historia — endpoints that only answer through the relay © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A direct call that the browser refused (fetch's TypeError) is sent again
// through the local server's /api/ai/relay, or the Android app's native HTTP
// (main.jsx providerFetch). An endpoint that needs that — a self-hosted model
// with no CORS headers — is remembered, so later calls skip the doomed direct
// attempt.
//
// Two things keep a network blip from being mistaken for that. The origin is
// remembered only when the second route actually answered: a relay that
// refused the caller (a LAN browser, which the relay does not serve by
// default) or a server that is simply down proves nothing about CORS. And the
// memory lapses after a while, so the direct route is tried again; before
// this, a one-second Wi-Fi drop made an endpoint relay-only until a reload.
//
// Import-free so the rule can be tested; main.jsx cannot be.

export const RELAY_ONLY_TTL_MS = 10 * 60 * 1000;

export const createRelayOnlyOrigins = ({ now = Date.now, ttlMs = RELAY_ONLY_TTL_MS } = {}) => {
    const until = new Map(); // origin -> remembered until
    return {
        has: (origin) => {
            const expires = until.get(origin);
            if (!expires) return false;
            if (expires > now()) return true;
            until.delete(origin);
            return false;
        },
        // Hands the response back, so a call site reads as one expression.
        remember: (origin, response) => {
            if (response?.ok) until.set(origin, now() + ttlMs);
            return response;
        },
    };
};
