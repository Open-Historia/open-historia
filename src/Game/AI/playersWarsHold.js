/*! Open Historia — a player's war ends only by the player's peace © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A war a player fights ends only by a peace that player makes or accepts:
// an offer taken in the chat (warAndPeace.js acceptPeaceOffer) or the player's
// own terms agreed (answerPeaceProposal), which end it in the ledger
// themselves. The time skip never does. A skip's warUpdates line that ends the
// war, declares a ceasefire in it or takes a player's country out of it is
// refused, with the events it was told by, and what they changed on the map:
// "Russo-Ukrainian peace treaty concluded in Geneva", with four regions given
// back, for a player who had asked for no peace (a player's report, 2026-10-31).

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

const ENDING = new Set(["end", "ceasefire"]);

// The events a ledger record names, by id.
const eventIdsOf = (update) => [
  ...list(update?.eventIds),
  ...list(update?.sourceEventIds),
  update?.eventId,
].map(clean).filter(Boolean);

// updates: the skip's war records, bound to their events. events: the turn's
// events. wars: world.wars before the turn. players: the countries people play.
// Hands back what is kept and what was refused.
export const holdPlayersWars = ({ updates = [], events = [], wars = [], players = [] } = {}) => {
  const played = new Set(list(players).map(fold).filter(Boolean));
  if (!played.size) return { updates: list(updates), events: list(events), refused: [] };
  const warOf = new Map(list(wars).map((war) => [fold(war?.id), war]));
  const fights = (war) => [...list(war?.sideA), ...list(war?.sideB)].some((name) => played.has(fold(name)));

  const refused = list(updates).filter((update) => {
    const war = warOf.get(fold(update?.id));
    if (!war || !fights(war)) return false;
    const op = fold(update?.op);
    if (ENDING.has(op)) return true;
    return op === "leave" && list(update?.actors).some((name) => played.has(fold(name)));
  });
  if (!refused.length) return { updates: list(updates), events: list(events), refused };

  const telling = new Set(refused.flatMap(eventIdsOf));
  const kept = list(events).filter((event) => !telling.has(clean(event?.id)));
  return { updates: list(updates).filter((update) => !refused.includes(update)), events: kept, refused };
};
