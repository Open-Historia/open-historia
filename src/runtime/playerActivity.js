/*! Open Historia — whether the player is at the game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The idle pulse (gameplay.js maybeSendIdleDiplomacy) is background AI: every
// attempt that passes its roll is a request, drawn from the day's background
// cap that agent reports and first readings share. It ran whenever the window
// was visible, so a desktop window left open while the player was away spent
// the cap on notes nobody was there to read. It now runs only while the player
// has touched the game recently — which changes nothing for a player who is
// playing.
//
// Import-free: a clock and a timestamp.

// Ten minutes without a pointer, key, wheel or touch.
export const PLAYER_ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

// The events that count as the player being there.
export const PLAYER_ACTIVITY_EVENTS = Object.freeze(["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]);

// Starts as present: the game was just opened or brought back.
export const createPlayerActivity = ({ windowMs = PLAYER_ACTIVITY_WINDOW_MS, now = () => Date.now() } = {}) => {
    let last = now();
    return {
        note: () => { last = now(); },
        isPresent: () => now() - last < windowMs,
    };
};
