/*! Open Historia — who a letter the world writes is for, when several people play © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip's chats (impacts.createdChats, diplomaticOutreach) are letters
// from the governments the AI plays. In single player they are all the
// player's. In a shared game each is written to one of the people
// (runtime/humanPolities.js), named in `to`; every thread used to go to the
// host's own player, so the lead read the others' mail and they got none.
//
// The model sometimes leaves `to` out and names the person among the other side
// instead (seen in a Discord test game, 2026-10-27: the Copperleaf Company's loan offer
// to Saltport came as a chat "with Saltport", spoken by Saltport). A
// person is never one of the governments writing, so a person in `countries`
// is the one it was written to, and the speaker the government writing.
//
// Pure.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const nameOf = (country) => clean(typeof country === "string" ? country : country?.name || country?.code);

// `people`: the polities people play; `host`: the host's own (game.country).
// Returns { chat, to, owner } or null when no government is left to write it:
// `chat` with only the governments the AI plays in `countries`, `to` the person
// it is written to, `owner` that person when it is not the host (whose threads
// name nobody, multiplayer/host/projection.js).
export const sharedLetterOf = (chatLike, { people = [], host = "" } = {}) => {
  if (!chatLike || typeof chatLike !== "object") return null;
  if (list(people).length < 2) return { chat: chatLike, to: clean(host), owner: "" };
  const personOf = (name) => list(people).find((person) => same(person, name)) ?? "";
  const named = list(chatLike.countries);
  let to = personOf(chatLike.to) || named.map((country) => personOf(nameOf(country))).find(Boolean) || clean(host);
  let countries = named.filter((country) => nameOf(country) && !personOf(nameOf(country)));
  // Only a person was named: the speaker is the government writing.
  if (!countries.length && clean(chatLike.speaker) && !personOf(chatLike.speaker)) countries = [clean(chatLike.speaker)];
  if (!countries.length) return null;
  if (!to) to = clean(host);
  return { chat: { ...chatLike, countries }, to, owner: same(to, host) ? "" : to };
};
