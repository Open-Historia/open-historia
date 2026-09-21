/*! Open Historia — when a time skip offers an interactive event © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/interactiveOffer.test.js
//
// An interactive event is a moment of the campaign played out as a scene, beat
// by beat, then written into the record as one event (GameUI/interactive.jsx).
// The player does not ask for one. Now and then a time skip offers one of its
// own events for it: that event's card says so, and the player plays the moment
// out or lets it pass. The next skip replaces the offer, taken up or not.
//
// Choosing costs no request. The turn's events are ranked here and the dice are
// seeded by the turn, so the same turn always offers the same event: a turn held
// on its board and applied again, or an Intervene that keeps the offered event.
//
// Import-free apart from the seeded draw espionage already rolls with.
import { draw } from "./spycraft.js";

// The dice: a skip with an event worth playing out offers it one time in three,
export const INTERACTIVE_OFFER_CHANCE = 1 / 3;
// and never within this many rounds of the last offer, so offers stay rare.
export const INTERACTIVE_OFFER_COOLDOWN = 3;

const text = (value) => String(value ?? "").trim();
const whole = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);

// How much an event weighs: "normally minor or major" (the jump schema), with
// the odd critical or high. Minor events are never offered.
const IMPORTANCE_WEIGHT = { critical: 3, high: 2, major: 2 };

// An event worth playing out: about the player, of weight, written by the
// simulation, and not itself a played-out scene.
export const isOfferableEvent = (event) => {
  if (!event || typeof event !== "object") return false;
  if (event.playerRelated !== true) return false;
  if (!text(event.id) || !text(event.title) || !text(event.description)) return false;
  // A canned stand-in is no moment, an agent's discovery is the engine's
  // own, and a resolved scene has been played already.
  if (["fallback", "espionage"].includes(text(event.source))) return false;
  if (text(event.kind) === "interactive") return false;
  return Boolean(IMPORTANCE_WEIGHT[text(event.importance).toLowerCase()]) || event.notable === true;
};

// The offer a turn makes, or null. `events` are the turn's events in reveal
// order, `round` the round the turn lands on, `lastOfferRound` the round of the
// last offer this campaign made (0 for none).
export const chooseInteractiveOffer = ({
  events = [],
  round = 0,
  lastOfferRound = 0,
  chance = INTERACTIVE_OFFER_CHANCE,
  cooldown = INTERACTIVE_OFFER_COOLDOWN,
} = {}) => {
  const list = Array.isArray(events) ? events : [];
  const landing = whole(round);
  const last = whole(lastOfferRound);
  if (last && landing - last < cooldown) return null;
  const candidates = list.filter(isOfferableEvent);
  if (!candidates.length) return null;
  // Seeded by the turn's first event, which an Intervene always keeps.
  if (draw(`interactive-offer|${landing}|${text(list[0]?.id)}`) >= chance) return null;
  // The weightiest; a notable one (an auto-jump's stop) above its peers; the
  // latest of equals, which is the moment closest to where the player stands.
  const weigh = (event) => (IMPORTANCE_WEIGHT[text(event.importance).toLowerCase()] ?? 0) * 2 + (event.notable === true ? 1 : 0);
  const best = candidates.reduce((top, event) => (weigh(event) >= weigh(top) ? event : top));
  return { eventId: text(best.id), round: landing };
};

// A stored offer, or null.
export const normalizeInteractiveOffer = (value) => {
  if (!value || typeof value !== "object") return null;
  const eventId = text(value.eventId);
  return eventId ? { eventId, round: whole(value.round) } : null;
};

// The event a stored offer stands on, or null when there is none to play: no
// offer, a scene already in progress, or an event no longer on the record.
export const offeredEvent = ({ offer, events = [], sceneInProgress = false } = {}) => {
  const stored = normalizeInteractiveOffer(offer);
  if (!stored || sceneInProgress) return null;
  return (Array.isArray(events) ? events : []).find((event) => text(event?.id) === stored.eventId) ?? null;
};
