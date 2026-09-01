/*! Open Historia — idle deadline for AI tasks © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// "Limit AI generation" measures SILENCE, not elapsed time.
//
// The setting used to be a stopwatch started when the request was sent: five
// minutes for a timeline jump, then the turn was killed and the player got
// canned events. A stopwatch cannot tell the two cases apart that matter —
//
//   * a model that has been steadily writing a good turn for eight minutes
//     (healthy, and killed anyway — the player loses a real turn, and on a long
//     skip the queued orders in it), versus
//   * a request that died silently ten seconds in (broken, and waited out to
//     the end of the stopwatch before anyone notices).
//
// — because from the outside they look identical: no answer yet. What separates
// them is whether anything is still ARRIVING. Every token resets this timer, so
// a slow model is never punished for being slow, and a stalled one is caught in
// five minutes rather than never.
//
// NOT ARMED UNTIL THE FIRST SIGN OF LIFE, which is the subtle part. A response
// that does not stream (a gateway that refuses stream+tools, a proxy that
// ignores alt=sse) sends its headers only once the whole answer is ready — so
// arming on send would give a buffered endpoint a five-minute TOTAL budget and
// kill exactly the long generations this is meant to protect. Silence before
// the first byte is indistinguishable from work in progress, so it is not
// counted; silence AFTER something arrived is a stall. A request that never
// answers at all is left to the relay's own deadline and to Cancel.
//
// Kept import-free and separate from gameplay.js (which pulls in the whole
// browser runtime and so cannot be unit-tested) for the same reason as
// jsonSalvage.js and streamAssembly.js.

// Five minutes of silence. Long enough that a reasoning model thinking between
// blocks, or a local server swapping a model in, is never mistaken for a stall —
// the OpenAI-style path is the one that needs the room, since its reasoning
// models send an opening frame and then stream nothing while they think. Short
// enough that a player watching a dead spinner is not left there indefinitely.
export const AI_IDLE_TIMEOUT_MS = 300000;

// `onExpire` is called once, after `idleMs` has passed with no note() — never
// before the first note(), and never after cancel().
//
// idleMs of 0 (the setting off) returns the same shape with every method inert,
// so callers do not branch: generation then waits as long as the model needs.
export function createIdleDeadline(idleMs, onExpire) {
    const enabled = Number.isFinite(idleMs) && idleMs > 0;
    let timer = null;
    let expiresAt = null;
    let expired = false;

    const cancel = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        expiresAt = null;
    };

    return {
        // "Something arrived." Restarts the clock. Cheap enough to call per
        // network chunk, which is how it is used.
        note() {
            if (!enabled || expired) return;
            if (timer !== null) clearTimeout(timer);
            expiresAt = Date.now() + idleMs;
            timer = setTimeout(() => {
                timer = null;
                expiresAt = null;
                expired = true;
                onExpire();
            }, idleMs);
        },
        // When this task gives up if nothing more arrives, or null while it is
        // unarmed (nothing has come back yet) or off. Read by the providers'
        // busy-retry logic, which must not sleep past it.
        get deadline() {
            return expiresAt;
        },
        get armed() {
            return timer !== null;
        },
        cancel,
    };
}
