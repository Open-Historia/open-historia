/*! Open Historia — who sits at a diplomatic table: the governments the AI answers for, and the people © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A table's turn (gameplay.js runChatActionBatch) answers for the governments
// the AI plays at it, and never for a person. In single player the one person
// is the player, who is never among a thread's members. In a shared game a
// stored thread is written around its owner (chat.player, or the host's seat),
// who is in no member list, and the one writing may be a member of someone
// else's thread: the owner sits at that table too.
//
// The owner is a person only while a person plays it. A guest who left the game
// leaves their country to the AI, and its government answers in the threads
// they opened, as it answers in any other. It used to be counted a person
// whatever became of its player: a line written into a leaver's thread was
// answered by nobody, and nobody was told (the gap audit of 2026-11-18).
//
// Pure, so it is tested under bare node.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();

// `player`: the one writing now. `owner`: the thread's owner when it is not
// single player's (gameplay.js passes it only when several people play).
// `members`: the thread's members by name. `people`: the polities people play.
// `governments`: on a player's own device (settings.replies "own"), the ones
// the host said answer this line; everyone else at the table is then a person,
// whatever this device's own game says, and the view already lists the owner
// among the members. `keyOf`: how names are compared (the caller's own key).
// Returns { otherPeople, governments }: the people at the table besides the
// writer, and the governments the AI answers for, each once, in table order.
export const tableSeats = ({ player = "", owner = "", members = [], people = [], governments = null, keyOf = fold } = {}) => {
  const key = (value) => keyOf(clean(value));
  const me = key(player);
  const stated = Array.isArray(governments) ? new Set(governments.map(key).filter(Boolean)) : null;
  const persons = new Set((Array.isArray(people) ? people : []).map(key).filter(Boolean));
  const others = (Array.isArray(members) ? members : []).map(clean).filter((name) => name && key(name) !== me);
  const host = !stated && clean(owner) && key(owner) !== me ? [clean(owner)] : [];
  const seated = [...host, ...others].filter((name, index, rows) => rows.findIndex((other) => key(other) === key(name)) === index);
  const otherPeople = seated.filter((name) => (stated ? !stated.has(key(name)) : persons.has(key(name))));
  const isPerson = new Set(otherPeople.map(key));
  return { otherPeople, governments: seated.filter((name) => !isPerson.has(key(name))) };
};
