/*! Open Historia — where an offer of peace is shown in the diplomatic chats © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so peace is offered through the diplomatic chats instead of as a
// popup" (the owner, 2026-10-30). An offer of peace (world.peaceOffers,
// runtime/peaceTerms.js) is shown in a chat, on the message that made it
// (warAndPeace.jsx PeaceOfferCard). Which thread, and where in it, is worked
// out here, the way runtime/demandCheck.js places a demand:
//
//   a thread holds an offer whose message is in it, or that was made in it
//   (chatId); an offer with neither (a time skip's letter folded into a thread
//   opened before, a guest's terms the host kept) belongs to the one-on-one
//   thread with the other side
//   in the thread, an offer sits under its message when that message is drawn;
//   one still open whose message is not (out of the window, or never had one)
//   sits at the foot; one whose message the reveal has not reached yet waits
//   for it
//
// Pure, and loads in plain Node.

import { normalizePeaceOffers } from "../../runtime/peaceTerms.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

// The offers a thread shows.
//   offers        world.peaceOffers
//   player        the player's country: only offers it made or was made
//   chatId        the thread's id
//   messageIds    the ids of the thread's messages
//   counterpart   the other side's name in a one-on-one thread, "" in any other
export const peaceOffersForThread = ({ offers = [], player = "", chatId = "", messageIds = [], counterpart = "" } = {}) => {
  const here = new Set([...messageIds].map((id) => clean(id)).filter(Boolean));
  return normalizePeaceOffers(offers).filter((offer) => {
    const parties = [fold(offer.from), fold(offer.to)];
    if (!fold(player) || !parties.includes(fold(player))) return false;
    if (offer.messageId && here.has(offer.messageId)) return true;
    if (offer.chatId) return offer.chatId === clean(chatId);
    return Boolean(fold(counterpart)) && parties.includes(fold(counterpart));
  });
};

// Where in the thread each is shown: { byMessage: Map(messageId => [offers]), stranded: [offers] }.
//   drawnIds    the ids of the messages drawn now
//   waitingIds  the ids of the thread's messages the reveal has not reached
export const placePeaceOffers = ({ offers = [], drawnIds = [], waitingIds = [] } = {}) => {
  const drawn = new Set([...drawnIds].map((id) => clean(id)));
  const waiting = new Set([...waitingIds].map((id) => clean(id)));
  const byMessage = new Map();
  const stranded = [];
  for (const offer of offers) {
    if (offer.messageId && drawn.has(offer.messageId)) byMessage.set(offer.messageId, [...(byMessage.get(offer.messageId) ?? []), offer]);
    else if (offer.status === "open" && !(offer.messageId && waiting.has(offer.messageId))) stranded.push(offer);
  }
  return { byMessage, stranded };
};
