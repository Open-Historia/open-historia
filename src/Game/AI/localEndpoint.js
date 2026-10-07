/*! Open Historia — which AI endpoints are on the player's own machine or network © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One rule for "this is the player's own server" (Ollama, LM Studio,
// llama.cpp, KoboldCpp, a home gateway): the loopback names and addresses, a
// .local name, and the private IPv4 ranges. main.jsx asks it of a URL it is
// about to fetch (isLocalEndpoint), and the context preflight asks it of a
// Fallback entry (contextWindow.js: a local server's window is a setting).
//
// DELIBERATELY IMPORT-FREE, so Settings and node tests can use it.

export const isLocalHostname = (hostname) => {
    const host = String(hostname ?? "").trim().toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "::1" || host === "[::1]") return true;
    if (host.endsWith(".local")) return true;
    if (/^127\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
};

// An entry's endpoint as the player typed it. Anything that is not an address
// of its own (blank, as on a hosted provider with a built-in endpoint) is not
// local: it is never read against the page's own address.
export const endpointIsLocal = (endpoint) => {
    const value = String(endpoint ?? "").trim();
    if (!value) return false;
    try {
        return isLocalHostname(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`).hostname);
    } catch {
        return false;
    }
};
