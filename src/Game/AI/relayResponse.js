/*! Open Historia — reading an answer through the game server's AI relay © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The relay (/api/ai/relay in server/server.js) pipes a self-hosted model's
// answer back as it arrives, so the status line has gone out before the answer
// is complete. When it then has to stop — the model went quiet for longer than
// OH_RELAY_TIMEOUT_MS, the answer passed the size cap, the model's connection
// dropped — the only thing left to do is break the connection, and the browser
// reports that as a bare "network error" from the middle of a stream reader,
// far from anything that knows a relay was involved. This puts the reason back.

export const RELAY_CUT_OFF_MESSAGE =
    "The AI answer was cut off partway through the game server's relay. If a local model needs longer, raise OH_RELAY_TIMEOUT_MS on the server.";

// The relay refusing to answer this device at all (another computer on the
// LAN, with Settings → Network → "Let other devices send AI calls through this
// server" off). Marked by a header, because an AI endpoint's own 403 — a
// rejected key — is relayed with the same status. server/server.js sets it.
export const RELAY_REFUSED_HEADER = "X-OH-Relay";

export const isRelayRefusal = (response) =>
    response?.status === 403 && response.headers?.get?.(RELAY_REFUSED_HEADER) === "refused";

// The relay could not connect to the AI endpoint at all: nothing listening at
// the address, a name that does not resolve, a connection refused or reset
// before any answer. It says so with a 502, which is also what a gateway in
// front of a busy model answers, and the game used to read the two alike: it
// waited fifteen seconds and asked again, three times, then called a server
// that was not running "busy". The same header tells them apart, for the same
// reason as above: an endpoint's own 502 is relayed with the same status.
export const isRelayUnreachable = (response) =>
    response?.status === 502 && response.headers?.get?.(RELAY_REFUSED_HEADER) === "unreachable";

// What the connection reported, for the message: the error's code
// (ECONNREFUSED, ENOTFOUND) when there is one, else the relay's own words.
// Never throws: a body that cannot be read just says nothing more.
export const relayUnreachableReason = async (response) => {
    try {
        const payload = await response.json();
        const code = String(payload?.code ?? "").trim();
        if (code) return code;
        return String(typeof payload?.error === "string" ? payload.error : "").trim().replace(/^\((.*)\)$/, "$1");
    } catch {
        return "";
    }
};

// Statuses a Response cannot be built with a body for.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

// The same response, with a body whose read error (other than the caller's own
// abort) says the relay cut the answer off.
export const withRelayCutoffHint = (response, signal) => {
    if (!response?.body || NULL_BODY_STATUSES.has(response.status) || typeof ReadableStream === "undefined") {
        return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) controller.close();
                else controller.enqueue(value);
            } catch (error) {
                const aborted = signal?.aborted || error?.name === "AbortError";
                controller.error(aborted ? error : new Error(RELAY_CUT_OFF_MESSAGE, { cause: error }));
            }
        },
        cancel(reason) {
            return reader.cancel(reason);
        },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};
