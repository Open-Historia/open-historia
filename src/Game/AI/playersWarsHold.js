/*! Open Historia — a player's war ends only by the player's peace © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A war a player fights ends only by a peace that player makes or accepts:
// an offer taken in the chat (warAndPeace.js acceptPeaceOffer) or the player's
// own terms agreed (answerPeaceProposal), which end it in the ledger
// themselves. The time skip never does. A skip's warUpdates line that ends the
// war, declares a ceasefire in it or takes a player's country out of it is
// refused, with the events it was told by, and what they changed on the map:
// "Russo-Ukrainian peace treaty concluded in Geneva", with four regions given
// back, for a player who had asked for no peace (a player's report, 2026-10-31).
//
// Nor by the player's own order: "an action shouldnt inherently be able to end
// a war, but it offers peace to the opponent" (the owner, 2026-11-03). An ending
// told by an event that carries out an order of a player who fights in that war
// (the event's impacts.actionIds) is refused like any other and handed back in
// `proposals`: the turn puts it to the other side as that player's offer of
// peace (warAndPeace.js turnWarAndPeace). "i conquered czechia fully
// as germany and i want to end the war but somehow my game still thinks im in
// war" (a player's report, 2026-11-03): "retreat troops back to germany, the
// war is over" and "END THE WAR RIGHT NOW" were both thrown away.

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

// The country an order was given for, where the order says (a shared game's
// seat); "" where it does not, as a game with one player's never does.
const orderCountryOf = (order) => clean(order?.country ?? order?.seatCountry ?? order?.polity);

// updates: the skip's war records, bound to their events. events: the turn's
// events. wars: world.wars before the turn. players: the countries people play.
// orders: the players' orders the turn carried out ({ id, country? }).
// Hands back what is kept, what was refused, and the offers of peace the players' orders make
// ([{ warId, from, update }]).
export const holdPlayersWars = ({ updates = [], events = [], wars = [], players = [], orders = [] } = {}) => {
  const played = new Set(list(players).map(fold).filter(Boolean));
  if (!played.size) return { updates: list(updates), events: list(events), refused: [], proposals: [] };
  const warOf = new Map(list(wars).map((war) => [fold(war?.id), war]));
  const sidesOf = (war) => [...list(war?.sideA), ...list(war?.sideB)];
  const fights = (war) => sidesOf(war).some((name) => played.has(fold(name)));
  const eventOf = new Map(list(events).map((event) => [clean(event?.id), event]));
  const orderOf = new Map(list(orders).map((order) => [clean(order?.id), order]).filter(([id]) => id));
  // The player whose order one of the events telling it carries out, of those who fight in the war: "" for none.
  const orderedBy = (update, war) => {
    const fighting = sidesOf(war).filter((name) => played.has(fold(name)));
    for (const id of eventIdsOf(update)) {
      for (const cited of list(eventOf.get(id)?.impacts?.actionIds)) {
        const order = orderOf.get(clean(cited));
        if (!order) continue;
        const country = orderCountryOf(order);
        const by = country ? fighting.find((name) => fold(name) === fold(country)) : fighting[0];
        if (by) return clean(by);
      }
    }
    return "";
  };

  const proposals = [];
  const refused = list(updates).filter((update) => {
    const war = warOf.get(fold(update?.id));
    if (!war || !fights(war)) return false;
    const op = fold(update?.op);
    const ending = ENDING.has(op) || (op === "leave" && list(update?.actors).some((name) => played.has(fold(name))));
    if (!ending) return false;
    const by = orderedBy(update, war);
    if (by && !proposals.some((entry) => entry.warId === clean(war.id) && fold(entry.from) === fold(by))) proposals.push({ warId: clean(war.id), from: by, update });
    return true;
  });
  if (!refused.length) return { updates: list(updates), events: list(events), refused, proposals };

  const telling = new Set(refused.flatMap(eventIdsOf));
  const kept = list(events).filter((event) => !telling.has(clean(event?.id)));
  return { updates: list(updates).filter((update) => !refused.includes(update)), events: kept, refused, proposals };
};
