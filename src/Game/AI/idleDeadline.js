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
// TWO WINDOWS, because silence before the first byte means something different
// from silence in the middle of an answer:
//
//   * BEFORE anything arrives — a local model evaluating a big save's ~190 KB
//     prompt, or a buffered endpoint (one that refuses stream+tools, or a proxy
//     that ignored alt=sse) which sends its headers only once the whole answer
//     is ready. Both are working; both look exactly like a dead request. This
//     window has to be long enough to cover them, which is why it is not the
//     idle one: five minutes of prompt evaluation is ordinary on a slow local
//     box, and killing it is the bug this whole thing replaced.
//   * AFTER something has arrived — the model was producing and stopped. That is
//     a stall, and a much shorter window is right.
//
// Arming only on the first byte (the first version of this) got the second half
// right and left the first half unbounded: an endpoint that answered nothing at
// all was never caught, so a buffered generation that died could hang the turn
// with no sign to the player. Both are now bounded; they are just bounded
// differently.
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

// Fifteen minutes with NO answer at all. Three times the idle window, because
// what it covers is the one thing the game cannot observe: a model that has not
// written a byte yet is either thinking or dead, and the only way to tell is to
// wait longer than thinking plausibly takes. Prompt evaluation of a long save on
// a slow local model is minutes, so this is deliberately generous — it is a
// backstop against hanging forever, not a performance limit.
//
// A relayed call (every local model behind /api/ai/relay) also has the relay's
// own OH_RELAY_TIMEOUT_MS, 10 minutes by default, which reaches it first.
export const AI_FIRST_BYTE_TIMEOUT_MS = 900000;

// `onExpire` is called at most once: `firstByteMs` after start() if nothing ever
// arrives, or `idleMs` after the last note() if something did. Never after
// cancel(), and never twice.
//
// Windows of 0 (the setting off) return the same shape with every method inert,
// so callers do not branch: generation then waits as long as the model needs.
export function createIdleDeadline({ idleMs, firstByteMs = idleMs }, onExpire) {
    const enabled = Number.isFinite(idleMs) && idleMs > 0;
    let timer = null;
    let expiresAt = null;
    let expired = false;

    const cancel = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        expiresAt = null;
    };

    const arm = (windowMs) => {
        if (!enabled || expired) return;
        if (timer !== null) clearTimeout(timer);
        expiresAt = Date.now() + windowMs;
        timer = setTimeout(() => {
            timer = null;
            expiresAt = null;
            expired = true;
            onExpire();
        }, windowMs);
    };

    return {
        // "The request is on its way." Starts the long no-answer-at-all window.
        // Called per attempt, since a retry evaluates the prompt again.
        start() {
            arm(Number.isFinite(firstByteMs) && firstByteMs > 0 ? firstByteMs : idleMs);
        },
        // "Something arrived." Switches to the short stalled-mid-answer window
        // and restarts it. Cheap enough to call per network chunk, which is how
        // it is used.
        note() {
            arm(idleMs);
        },
        // When this task gives up if nothing more arrives, or null while it is
        // unarmed or off. Read by the providers' busy-retry logic, which must
        // not sleep past it.
        get deadline() {
            return expiresAt;
        },
        get armed() {
            return timer !== null;
        },
        cancel,
    };
}
