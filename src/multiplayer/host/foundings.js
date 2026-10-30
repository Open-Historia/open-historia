/*! Open Historia — a player's people founding a country of their own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A person who plays a group (or a country) can order it to found a country:
// "Found a new country... Saltport". The time skip writes it as an event that
// creates the polity and hands it the group's land, and from then on the land,
// the armies and the wars are the new country's. The seat must follow, or the
// new country is nobody's: the AI plays its troops, and what only its
// government knows reaches no one.
//
// The seat follows only when all three hold in one event, so a player who
// sponsors a breakaway or sets up a puppet keeps their own seat:
//   - the event creates the polity (polityChanges create; the resolver adds one
//     for a name a transfer founds, runtime/polityFounding.js);
//   - it resolves an order of that seat's (impacts.actionIds; an order naming
//     no owner is the host's, runtime/humanPolities.js orderOwner);
//   - it moves that seat's own land to the new polity: a regionTransfers entry
//     from the seat to it, or of a region in the seat's area when the seat is a
//     group (a faction's land is its countries', runtime/groups.js).
// A restore counts as a create: a resistance that brings back a lost state.
// What the new country is (its government, leader, goals, figures) is the
// model's to write from the story, as for any polity it founds; nothing of the
// old one is copied over.
//
// Pure.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// `events`: the events the round just added. `actions`: the order queue.
// `seated`: the countries people play. `host`: the host's own country.
// `areas`: the groups' areas as the round began (world.groupAreas, region id ->
// group). Returns [{ from, to, eventId }], at most one per seat, never onto a
// country someone already plays nor two seats onto one.
export const seatFoundings = ({ events = [], actions = [], seated = [], host = "", areas = {} } = {}) => {
  const ownerOf = new Map(list(actions).map((action) => [clean(action?.id), clean(action?.ownerCode) || clean(host)]));
  const moves = [];
  const taken = (name) => seated.some((seat) => same(seat, name) && !moves.some((move) => same(move.from, seat)))
    || moves.some((move) => same(move.to, name));
  for (const event of list(events)) {
    const impacts = event?.impacts ?? {};
    const created = list(impacts.polityChanges)
      .filter((change) => ["create", "restore"].includes(clean(change?.operation)))
      .map((change) => clean(change?.code) || clean(change?.name))
      .filter(Boolean);
    if (!created.length) continue;
    const owners = list(impacts.actionIds).map((id) => ownerOf.get(clean(id))).filter(Boolean);
    for (const seat of seated) {
      if (!owners.some((owner) => same(owner, seat)) || moves.some((move) => same(move.from, seat))) continue;
      const ours = (transfer) => same(transfer?.fromCode, seat) || same(areas?.[clean(transfer?.regionId)], seat);
      const to = created.find((name) => !same(name, seat) && !taken(name)
        && list(impacts.regionTransfers).some((transfer) => same(transfer?.toCode, name) && ours(transfer)));
      if (to) moves.push({ from: clean(seat), to, eventId: clean(event?.id) });
    }
  }
  return moves;
};

// What was the old seat's goes with it: its queued orders, its own Projects
// board (a guest's, kept by country), its agents and the threads it speaks in.
// What it already did stays done by it: when the host's seat moves, the host's
// orders that named no owner are written down as the old name's.
export const withSeatMoved = ({ actions, world, chats }, { from, to, host = false }) => ({
  actions: list(actions).map((action) => {
    const planned = clean(action?.status || "planned") === "planned";
    if (planned) return same(action?.ownerCode, from) ? { ...action, ownerCode: to } : action;
    return host && !clean(action?.ownerCode) ? { ...action, ownerCode: from } : action;
  }),
  world: world && typeof world === "object"
    ? {
      ...world,
      ...(world.seatBoards && typeof world.seatBoards === "object"
        ? { seatBoards: Object.fromEntries(Object.entries(world.seatBoards).map(([key, board]) => [same(key, from) ? to : key, board])) }
        : {}),
      ...(Array.isArray(world.spies) ? { spies: world.spies.map((spy) => (same(spy?.owner, from) ? { ...spy, owner: to } : spy)) } : {}),
    }
    : world,
  chats: list(chats).map((chat) => (same(chat?.player, from) ? { ...chat, player: to } : chat)),
});

// The names a seat's government has had, newest first (game.seatFoundings,
// written by the host as each seat moves): what only its government knew
// before it founded the country is still its own to read.
export const formerNamesOf = (game, seat) => {
  const names = [clean(seat)];
  const foundings = list(game?.seatFoundings);
  for (let step = 0; step < foundings.length; step += 1) {
    const before = foundings.find((entry) => same(entry?.to, names.at(-1)));
    if (!before || names.some((name) => same(name, before.from))) break;
    names.push(clean(before.from));
  }
  return names.filter(Boolean);
};
