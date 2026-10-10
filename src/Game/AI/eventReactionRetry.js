/*! Open Historia — how often a failed Event Editor reaction is tried again © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An event written in the Event Editor may invite one polity's reaction
// (gameplay.js processPendingEventOutreach). When its request fails it is tried
// again, further apart each time, and after the last attempt it is given up and
// the event says so. It used to be tried every 30 seconds for as long as the game
// was open — on a dead key or a spent quota, about 120 failing requests an hour
// for one event. Import-free, so node tests can drive it.

// The wait after each failed attempt; one more failure than there are waits
// gives the reaction up.
export const EVENT_REACTION_RETRY_DELAYS_MS = Object.freeze([30_000, 120_000, 600_000]);
export const EVENT_REACTION_MAX_ATTEMPTS = EVENT_REACTION_RETRY_DELAYS_MS.length + 1;

// What becomes of a queued reaction whose request just failed, given the
// attempts it had already made.
export const eventReactionAfterFailure = (attemptsBefore) => {
  const attempts = Math.max(0, Math.trunc(Number(attemptsBefore) || 0)) + 1;
  if (attempts >= EVENT_REACTION_MAX_ATTEMPTS) return { attempts, giveUp: true, retryAfterMs: 0 };
  return { attempts, giveUp: false, retryAfterMs: EVENT_REACTION_RETRY_DELAYS_MS[attempts - 1] };
};

// The speaker a reaction goes out under on its last attempt. The model must
// speak for a government whose private context it was given; a named speaker
// without one used to fail every attempt the same way. On the last attempt the
// first invited government that has its context speaks instead, and with none
// the reaction is silence ("") rather than one more failed request.
export const reactionSpeakerWithContext = (speaker, invitees, hasContext) => {
  if (hasContext(speaker)) return speaker;
  return (Array.isArray(invitees) ? invitees : []).find((name) => name && hasContext(name)) || "";
};
