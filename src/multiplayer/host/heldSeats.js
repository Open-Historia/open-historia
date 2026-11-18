/*! Open Historia — what is a guest's waits while nobody shares the game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A shared game is a lasting thing (the owner's decision 1): its seats are kept
// with it, and so is everything a seat's person owns. Some of that the game
// keeps in places of its own that single player never reads (a guest's board
// in world.seatBoards, its seal, its table of the intercepts file, its advisor's
// conversation, its goal and advice keyed by its country). The rest sits in the
// game's own documents beside the host's, told apart only by a field: a
// guest's queued orders (ownerCode), its private threads (chat.player, and the
// threads where a person other than the host speaks or sits), and the events
// only some players' governments know of (event.audience).
//
// Single player reads those documents whole. So after "Stop sharing", or after
// the app was closed while the game was shared, the host's own game showed the
// host every guest's queued orders, letters, private threads and secret events
// as its own, the host could write in a guest's thread and have the AI answer
// there, and its first solo skip carried out "Invade Latvia" for Russia's
// absent player (the review of 2026-11-18, core 3 and views 5).
//
// The host's own game is its own seat's. When nobody shares it any more, what
// is another person's is HELD, here, in one reserved world record
// (world.seatsHeld) that nothing in the game reads and no view carries: unseen,
// and undone. When the session is taken up again it is given back, before
// anything else runs, exactly as it was. Holding and giving back are each one
// commit of the game's documents, and each is idempotent by id, so an engine
// killed between the two leaves nothing twice and nothing lost.
//
// Decided from the records themselves (who owns, who wrote, who may read),
// never from words, and from the people's countries only for a thread a
// person merely sits in. Single player's own records name nobody, so a save
// that was never shared holds nothing and is left exactly as it is.
//
// Pure.

export const SEATS_HELD_KEY = "seatsHeld";
// The bounds the save keeps (runtime/gameState.js normalizeWorldState).
export const SEATS_HELD_LIMITS = Object.freeze({ orders: 4000, threads: 1000, events: 4000, turns: 400 });

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nameOf = (entry) => clean(typeof entry === "object" && entry ? entry.name ?? entry.code : entry);
const idOf = (row) => clean(row?.id);

// What is held, as the save keeps it: { orders, threads, events: [{ after,
// event }], turns: [{ round, date, orders }] } (the last: the orders each past
// turn's record lists, world.simulationHistory, which the Events panel shows).
export const seatsHeldOf = (world) => {
  const held = isRecord(world?.[SEATS_HELD_KEY]) ? world[SEATS_HELD_KEY] : {};
  return {
    orders: list(held.orders).filter(isRecord),
    threads: list(held.threads).filter(isRecord),
    events: list(held.events).filter((entry) => isRecord(entry?.event)),
    turns: list(held.turns).filter((entry) => isRecord(entry) && list(entry.orders).length),
  };
};
export const hasSeatsHeld = (world) => {
  const held = seatsHeldOf(world);
  return held.orders.length + held.threads.length + held.events.length + held.turns.length > 0;
};
const sameTurn = (left, right) => Number(left?.round) === Number(right?.round) && clean(left?.date) === clean(right?.date);

// Who a line of a thread is by, when a person wrote it: the host stores every
// person's line as role "user" with the seat that wrote it (gameHost.js "say"),
// and a single player's own lines name nobody.
const personWrote = (line) => clean(line?.role).toLowerCase() === "user" ? clean(line?.speaker || line?.by || line?.code) : "";

// `host`: the game's own country (game.country), with `readers` the names its
// government had before (multiplayer/host/foundings.js formerNamesOf).
// `people`: the countries the seats' persons play, the host's among them or not.
export const holdSeatRecords = ({ actions, chats, events, world } = {}, { host = "", readers = [], people = [] } = {}) => {
  const hostNames = [host, ...list(readers)].map(clean).filter(Boolean);
  const isHost = (name) => hostNames.some((known) => same(known, name));
  const persons = list(people).map(clean).filter((name) => name && !isHost(name));
  const isPerson = (name) => persons.some((person) => same(person, name));
  const another = (name) => Boolean(clean(name)) && !isHost(name);

  // An order another country's person gave (single player's name none).
  const theirOrder = (action) => isRecord(action) && another(action.ownerCode);
  // A thread another person owns, or one where another person sits or speaks.
  const theirThread = (chat) => {
    if (!isRecord(chat)) return false;
    if (another(chat.player)) return true;
    if (list(chat.countries).some((entry) => isPerson(nameOf(entry)))) return true;
    const lines = [...list(chat.messages), ...list(chat.events).filter((event) => event?.kind === "message")];
    return lines.some((line) => another(personWrote(line)));
  };
  // An event only governments other than the host's know of.
  const secretFromHost = (event) => {
    const audience = list(event?.audience).map(clean).filter(Boolean);
    return isRecord(event) && audience.length > 0 && !audience.some(isHost);
  };

  const held = seatsHeldOf(world);
  const known = {
    orders: new Set(held.orders.map(idOf).filter(Boolean)),
    threads: new Set(held.threads.map(idOf).filter(Boolean)),
    events: new Set(held.events.map((entry) => idOf(entry.event)).filter(Boolean)),
  };
  const add = (kind, row) => {
    const id = idOf(row);
    if (id && known[kind].has(id)) return false;
    if (id) known[kind].add(id);
    return true;
  };

  const orders = [];
  const keptActions = [];
  for (const action of list(actions)) {
    if (!theirOrder(action)) keptActions.push(action);
    else if (add("orders", action)) orders.push(action);
  }
  const threads = [];
  const keptChats = [];
  for (const chat of list(chats)) {
    if (!theirThread(chat)) keptChats.push(chat);
    else if (add("threads", chat)) threads.push(chat);
  }
  // Each event where it stood: after the last event the host keeps before it.
  const heldEvents = [];
  const keptEvents = [];
  for (const event of list(events)) {
    if (!secretFromHost(event)) {
      keptEvents.push(event);
      continue;
    }
    if (add("events", event)) heldEvents.push({ after: idOf(keptEvents.at(-1)), event });
  }

  // The orders each past turn's record lists: the turn's own, and another's
  // only to that player (multiplayer/host/projection.js simulationHistory).
  const turns = [];
  let history = isRecord(world) ? world.simulationHistory : undefined;
  if (Array.isArray(history) && history.some((entry) => list(entry?.plannedActions).some(theirOrder))) {
    history = history.map((entry) => {
      const theirs = list(entry?.plannedActions).filter(theirOrder);
      if (!theirs.length) return entry;
      turns.push({ round: Number(entry.round) || 0, date: clean(entry.date), orders: theirs });
      return { ...entry, plannedActions: list(entry.plannedActions).filter((action) => !theirOrder(action)) };
    });
  }

  const taken = list(actions).length - keptActions.length + list(chats).length - keptChats.length + list(events).length - keptEvents.length + turns.length;
  if (!taken) return { changed: false, actions, chats, events, world, held: 0 };
  return {
    changed: true,
    held: orders.length + threads.length + heldEvents.length + turns.reduce((sum, turn) => sum + turn.orders.length, 0),
    actions: keptActions,
    chats: keptChats,
    events: keptEvents,
    world: {
      ...(isRecord(world) ? world : {}),
      ...(turns.length ? { simulationHistory: history } : {}),
      [SEATS_HELD_KEY]: {
        orders: [...held.orders, ...orders],
        threads: [...held.threads, ...threads],
        events: [...held.events, ...heldEvents],
        turns: [...held.turns, ...turns],
      },
    },
  };
};

// The session taken up again: everything held goes back where it was, and the
// record is gone. A row already back (an engine killed half way) is not added
// twice. An event goes back after the one it followed, or, if that one is gone
// (a history fold since), before the first event dated after it.
export const returnSeatRecords = ({ actions, chats, events, world } = {}) => {
  if (!isRecord(world) || !(SEATS_HELD_KEY in world)) return { changed: false, actions, chats, events, world, returned: 0 };
  const held = seatsHeldOf(world);
  const { [SEATS_HELD_KEY]: _held, ...rest } = world;
  const present = (rows) => new Set(list(rows).map(idOf).filter(Boolean));
  const actionIds = present(actions);
  const chatIds = present(chats);
  const eventIds = present(events);
  const orders = held.orders.filter((row) => !actionIds.has(idOf(row)));
  const threads = held.threads.filter((row) => !chatIds.has(idOf(row)));
  const timeline = [...list(events)];
  let returned = orders.length + threads.length;
  // Several held in a row followed the same event: each goes after the one
  // before it, in their order.
  const lastPut = new Map();
  for (const { after, event } of held.events) {
    if (eventIds.has(idOf(event))) continue;
    const anchor = lastPut.get(clean(after)) ?? clean(after);
    let at = anchor ? timeline.findIndex((row) => idOf(row) === anchor) + 1 : 0;
    lastPut.set(clean(after), idOf(event));
    if (anchor && at === 0) {
      const date = clean(event.date);
      const later = date ? timeline.findIndex((row) => clean(row?.date) > date) : -1;
      at = later < 0 ? timeline.length : later;
    }
    timeline.splice(at, 0, event);
    eventIds.add(idOf(event));
    returned += 1;
  }
  // A past turn's orders go back on its record, while the record is still kept.
  let history = rest.simulationHistory;
  if (held.turns.length && Array.isArray(history)) {
    history = history.map((entry) => {
      const turn = held.turns.filter((candidate) => sameTurn(candidate, entry));
      if (!turn.length) return entry;
      const there = present(entry?.plannedActions);
      const back = turn.flatMap((candidate) => candidate.orders).filter((action) => !there.has(idOf(action)));
      returned += back.length;
      return back.length ? { ...entry, plannedActions: [...list(entry.plannedActions), ...back] } : entry;
    });
  }
  return {
    changed: true,
    returned,
    actions: [...list(actions), ...orders],
    chats: [...list(chats), ...threads],
    events: timeline,
    world: history === rest.simulationHistory ? rest : { ...rest, simulationHistory: history },
  };
};
