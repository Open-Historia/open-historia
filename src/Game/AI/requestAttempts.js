/*! Open Historia — how many times a request is tried before the game gives up, as the player set it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/requestAttempts.test.js
//
// Every provider path tries a request three times: a busy provider (502, 503,
// 504, Anthropic's 529), a rate limit, an answer that never came. Fifteen
// seconds apart, that is half a minute of patience. A free Gemini key answers
// 503 "high demand" in runs longer than that, and a skip whose three attempts
// all met one lands as the fallback events, which the player then rolls back
// by hand and asks for again: the same wait, with clicks added.
//
// So the count is the player's: Settings → AI → Attempts per request. Three
// stays the default. More attempts cost nothing when the first one answers;
// when it does not, the skip waits longer before it gives up, and the row under
// the spinner says which attempt is running.
//
// With somewhere to fall back to, a busy provider is still left at once for the
// next entry of the Fallback list (providerErrors.js shouldRetryProviderFailure):
// this count is how long the LAST entry is given.
//
// Import-free, so it is tested under bare node.

export const DEFAULT_REQUEST_ATTEMPTS = 3;
export const MAX_REQUEST_ATTEMPTS = 30;

// What Settings offers. The stored value is the number as text; an empty or
// absent one is the default.
export const REQUEST_ATTEMPT_CHOICES = Object.freeze([3, 5, 10, 20, 30]);

// The count for a stored value: a whole number from 1 to MAX_REQUEST_ATTEMPTS.
// Anything else (nothing stored, a hand-edited store) is the default.
export const requestAttemptsFrom = (stored) => {
    const text = String(stored ?? "").trim();
    if (!/^\d+$/.test(text)) return DEFAULT_REQUEST_ATTEMPTS;
    const count = Number(text);
    if (count < 1) return DEFAULT_REQUEST_ATTEMPTS;
    return Math.min(MAX_REQUEST_ATTEMPTS, count);
};
