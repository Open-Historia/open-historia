/*! Open Historia — reading an answer through the game server's AI relay © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The relay (/api/ai/relay in server/server.js) pipes a self-hosted model's
// answer back as it arrives, so the status line has gone out before the answer
// is complete. When it then has to stop — the model went quiet for longer than
// OH_RELAY_TIMEOUT_MS, the answer passed the size cap, the model's connection
// dropped — the only thing left to do is break the connection, and the browser
// reports that as a bare "network error" from the middle of a stream reader,
// far from anything that knows a relay was involved. This puts the reason back.

import { RELAY_CUT_OFF_MESSAGE } from "./providerErrors.js";

export { RELAY_CUT_OFF_MESSAGE };

// Before any of that, the relay may not have reached the endpoint at all:
// nothing listening, a name that does not resolve, a connection dropped before
// a byte of an answer. It answers with a 502 of its own, and a 502 is also what
// a busy provider sends, so it marks its own with a header no endpoint can set
// (an endpoint's headers are not passed on) and says the socket's own code in
// the body. main.jsx reads the header first and turns the response into the
// error for a server that could not be reached, before anything can take the
// status for a busy provider's and wait on it.
export const RELAY_HEADER = "X-OH-Relay";

export const isRelayUnreachable = (response) => {
    try {
        return String(response?.headers?.get?.(RELAY_HEADER) ?? "").trim().toLowerCase() === "unreachable";
    } catch {
        return false;
    }
};

// Why, in the fewest words there are: the socket's code for it (ECONNREFUSED,
// ENOTFOUND, ETIMEDOUT), which reads the same in every language, and failing
// that whatever the relay said.
export const relayUnreachableReason = (payload) => {
    const code = typeof payload?.code === "string" ? payload.code.trim() : "";
    if (code) return code;
    const said = typeof payload?.error === "string" ? payload.error.trim() : "";
    return said || "no answer";
};

// Statuses a Response cannot be built with a body for.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

// The same response, with a body whose read error (other than the caller's own
// abort) says the relay cut the answer off. The browser's own error is kept as
// the cause: main.jsx reads it there to tell a broken connection from anything
// else that can go wrong in a reader.
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
