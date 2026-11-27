/*! Open Historia — each player's advisor conversation, kept with the game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The advisor's conversation (advisor.json: its messages, the ministers and
// characters the player writes to, their group chats, the chief advisor's
// profile; runtime/advisorThreads.js) is the player's own. In single player
// the file is the player's. In a shared game the host keeps every seat's: the
// advisor's memory is the seat's, not a device's or an invite code's (the
// owner, 2026-11-18), so a player who comes back on another device, or with a
// new invite code, finds their advisor where they left it, and the host's
// engine is its one writer.
//
// The game's own country (the host's seat) has the file as single player has
// it. Every other seat's conversation is kept beside it in ONE reserved entry
// (role SEAT_ADVISORS_ROLE), by country, as the intercepts file keeps each
// spymaster's table under its reserved member (runtime/spycraft.js
// SEAT_INTERCEPTS). No reader of the conversation takes it for anything:
// advisorThreads.js reads messages, contacts and groups by their own roles and
// keeps every other entry where it is, and single player's file never has one.
//
// Pure.

export const SEAT_ADVISORS_ROLE = "advisor-seats";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isSeatsEntry = (entry) => entry?.role === SEAT_ADVISORS_ROLE;
const seatsOf = (file) => {
  const entry = list(file).find(isSeatsEntry);
  return isRecord(entry?.seats) ? entry.seats : {};
};
const ownEntries = (file) => list(file).filter((entry) => !isSeatsEntry(entry));
const seatsEntry = (seats) => (Object.keys(seats).length ? [{ role: SEAT_ADVISORS_ROLE, seats }] : []);

// `owner`'s conversation as the file holds it. `gameCountry`: the game's own
// country, whose conversation is the file itself.
export const advisorOfSeat = (file, owner, { gameCountry = "" } = {}) => {
  if (!clean(owner) || same(owner, gameCountry)) return ownEntries(file);
  const seats = seatsOf(file);
  const key = Object.keys(seats).find((name) => same(name, owner));
  return key ? list(seats[key]) : [];
};

// The file with `owner`'s conversation replaced; every other as it was. An
// empty conversation of a seat that is not the game's own is no entry at all.
export const withSeatAdvisor = (file, owner, entries, { gameCountry = "" } = {}) => {
  const seats = seatsOf(file);
  const mine = list(entries).filter((entry) => !isSeatsEntry(entry));
  if (!clean(owner) || same(owner, gameCountry)) return [...mine, ...seatsEntry(seats)];
  const others = Object.fromEntries(Object.entries(seats).filter(([name]) => !same(name, owner)));
  return [...ownEntries(file), ...seatsEntry(mine.length ? { ...others, [clean(owner)]: mine } : others)];
};

// A seat that moved to another country's name (multiplayer/host/foundings.js
// withSeatMoved): its conversation goes with it. The game's own country's is
// the file, which follows game.country, and moves with nothing.
export const withSeatAdvisorMoved = (file, from, to, { gameCountry = "" } = {}) => {
  if (same(from, gameCountry) || same(to, gameCountry) || same(from, to)) return file;
  const moving = advisorOfSeat(file, from, { gameCountry });
  if (!moving.length) return file;
  return withSeatAdvisor(withSeatAdvisor(file, from, [], { gameCountry }), to, moving, { gameCountry });
};
