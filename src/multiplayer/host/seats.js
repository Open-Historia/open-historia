/*! Open Historia — who plays which country in a multiplayer game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every country is played either by a person or by the AI. A person takes a
// country in the lobby (or, if the host allows it, mid-game from the AI), and
// holds it while they play. The user's rule for leavers: "if someone leaves …
// becomes another ai player". So a player who drops is first "away" — their
// country waits for them for the host's grace period — and then the AI takes
// it over. The same device can come back and take it up again, unless someone
// else has taken it since. No country is ever held by two people, and no
// person holds two countries.
//
// Players are known by their device key (session/host.js): that is who they
// are across reconnects, whatever their player id on a given connection.
//
// A seat is its player's device's until the host releases it (the owner,
// 2026-11-15: a shared game is a lasting thing, seats "bound to each player's
// device, resumable another day"): taken by someone else while its player was
// away, it handed that player's threads, orders and stolen papers to them.
// The book is saved with the game (host/sessionRecord.js) and restored when
// the game is shared again. Once the game is under way a player changes
// country only with the host's yes (the owner's decision 12).
//
// The book also says who is in the game: everyone whose device holds a seat,
// here or not, and everyone who watches a country of theirs that is gone (the
// owner's decision 11). They are let in whenever they come back; anyone else
// only while they are fewer than the seats (hasRoom). Before, the session
// counted the connections open at that moment, so newcomers could fill the
// room while a player was away, and that player could not get back to the
// seat that is theirs.
//
// Each seat a person takes has an id of its own (`id`), kept while its player
// is away or the AI minds it, and when its country is renamed or its people
// found one (move), and never given to another seat: what the host keeps for a
// seat in memory is kept by it, and a request acts for the seat it was sent
// by, as that seat is when the request is applied (host/gameHost.js). A
// change of country, a release or a country gone ends the seat; a seat taken
// next is another. Kept by the country's name, a rename left the host's own
// records under the old name, and a request that waited behind the round
// that renamed the country acted for a name nobody played.
//
// A player the host released from a country cannot take it back (a ban keeps
// them out of the game): the book remembers who was released from what, and
// the game saves it with the seats.
//
// Pure: time comes in through `now`.

export const SEAT_STATUS = Object.freeze({ HUMAN: "human", AWAY: "away", AI: "ai" });

export const createSeatBook = ({
  countries = [],
  maxPlayers = 8,
  graceMs = 5 * 60 * 1000,
  allowMidGameJoin = true,
  now = () => Date.now(),
} = {}) => {
  const choosable = new Set(countries.map(String));
  const seats = new Map(); // country → { id, country, device, name, status, since }
  // Players whose country is gone, who watch it: device → { device, name, was }.
  const watchers = new Map();
  // The devices the host released from a country: country → Set(device).
  const released = new Map();
  let started = false;
  let minted = 0;
  const mint = () => {
    minted += 1;
    return `seat-${minted}`;
  };
  const releasedFrom = (country, device) => Boolean(device) && Boolean(released.get(String(country))?.has(device));
  const keepOff = (country, device) => {
    if (!device || !String(country ?? "")) return;
    if (!released.has(String(country))) released.set(String(country), new Set());
    released.get(String(country)).add(device);
  };

  const byDevice = (device) => [...seats.values()].find((seat) => seat.device === device) ?? null;
  const people = () => [...seats.values()].filter((seat) => seat.status === SEAT_STATUS.HUMAN || seat.status === SEAT_STATUS.AWAY);
  // Everyone in the game, by device: whoever holds a seat, and whoever watches.
  const members = () => new Set([...[...seats.values()].map((seat) => seat.device).filter(Boolean), ...watchers.keys()]);

  const refusal = (reason) => ({ ok: false, reason });

  return {
    // A person takes a country. In the lobby any free country; once the game
    // has started, a newcomer only if the host allows joining mid-game, and a
    // seated player only with the host's yes (`approved`). A country whose
    // seat is another device's is theirs until the host releases it, whoever
    // minds it meanwhile. A player whose country is gone takes any free
    // country, whatever the host allows newcomers (the owner's decision 11).
    // One the host released from a country does not take it back, unless the
    // host gives it to them (`approved`).
    claim(country, { device, name, approved = false }) {
      const key = String(country ?? "");
      if (!choosable.has(key)) return refusal("not-a-country");
      const current = seats.get(key);
      const mine = byDevice(device);
      const watching = watchers.has(device);
      if (current && current.device && current.device !== device) return refusal("taken");
      if (!approved && releasedFrom(key, device) && current?.device !== device) return refusal("released");
      if (started && !mine && !watching && !approved && !allowMidGameJoin) return refusal("game-started");
      if (started && mine && mine.country !== key && !approved) return refusal("ask-host");
      if (!mine && !watching && members().size >= maxPlayers) return refusal("full");
      if (mine && mine.country !== key) {
        // Changing country in the lobby frees the old one; mid-game the old one
        // goes to the AI.
        if (started) seats.set(mine.country, { ...mine, id: mint(), status: SEAT_STATUS.AI, device: null, since: now() });
        else seats.delete(mine.country);
      }
      watchers.delete(device);
      // Its own seat taken again (a player choosing it twice) is the same seat.
      const id = mine && mine.country === key ? mine.id : mint();
      seats.set(key, { id, country: key, device, name: String(name ?? ""), status: SEAT_STATUS.HUMAN, since: now() });
      return { ok: true, country: key };
    },

    // Back to the lobby list, before the game starts. Once it has, giving a
    // country up is changing it, which is the host's to allow.
    unclaim(device) {
      const mine = byDevice(device);
      if (!mine || started) return false;
      seats.delete(mine.country);
      return true;
    },

    // The player's connection dropped.
    left(device) {
      const mine = byDevice(device);
      if (!mine || mine.status !== SEAT_STATUS.HUMAN) return null;
      if (!started) {
        seats.delete(mine.country);
        return null;
      }
      const away = { ...mine, status: SEAT_STATUS.AWAY, since: now() };
      seats.set(mine.country, away);
      return away;
    },

    // The player came back on the same device. Their country is theirs again
    // if it was waiting for them or the AI has been minding it (and no one else
    // has taken it).
    returned(device, { name } = {}) {
      const mine = byDevice(device);
      if (!mine) return null;
      const back = { ...mine, status: SEAT_STATUS.HUMAN, name: name ?? mine.name, since: now() };
      seats.set(mine.country, back);
      return back;
    },

    // Seats left away longer than the grace go to the AI, which plays them
    // until their player returns. Returns the countries that changed hands.
    expire() {
      const handed = [];
      for (const seat of seats.values()) {
        if (seat.status === SEAT_STATUS.AWAY && now() - seat.since >= graceMs) {
          // The device stays on the seat so its player can reclaim it.
          seats.set(seat.country, { ...seat, status: SEAT_STATUS.AI, since: now() });
          handed.push(seat.country);
        }
      }
      return handed;
    },

    // The host takes a country back from a player (a kick), or hands the AI's;
    // or lets go of a player who watches a country that is gone. Returns the
    // device that held it, or null. Its player does not take it back (claim).
    release(country) {
      const seat = seats.get(String(country));
      if (!seat) {
        const watcher = [...watchers.values()].find((entry) => entry.was === String(country));
        if (!watcher) return null;
        watchers.delete(watcher.device);
        return watcher.device;
      }
      keepOff(seat.country, seat.device);
      if (started) seats.set(seat.country, { ...seat, id: mint(), status: SEAT_STATUS.AI, device: null, since: now() });
      else seats.delete(seat.country);
      return seat.device ?? null;
    },
    // Said at once, when the host releases a player, before the seat itself
    // is let go in the game's order (host/gameHost.js kick): from then on that
    // device does not take the country back.
    keepOff,
    // Whether the host released `device` from `country`.
    releasedFrom,

    // A seat's country is gone (dissolved, or annexed): the seat is no more,
    // and its player watches it, or takes a free country.
    vanish(country) {
      const seat = seats.get(String(country));
      if (!seat) return null;
      seats.delete(seat.country);
      released.delete(seat.country);
      if (seat.device) watchers.set(seat.device, { device: seat.device, name: seat.name, was: seat.country });
      return { ...seat };
    },

    // The countries that may be taken, as the world has them now: a country
    // founded mid-game can be, one dissolved cannot. A seat's own country
    // stays its seat's either way.
    setCountries(list) {
      choosable.clear();
      for (const name of list) choosable.add(String(name));
      for (const country of seats.keys()) choosable.add(country);
    },

    // The book as the game saved it (host/sessionRecord.js), before anyone has
    // joined: every seat its device's again. Its players are away until they
    // reconnect; one the AI was already minding stays so. The host's own seat
    // is claimed afresh after, from the game's own country.
    restore(saved, { hostDevice = "", watching = [], released: kept = [] } = {}) {
      for (const entry of watching) {
        if (entry?.device && entry.device !== hostDevice) watchers.set(entry.device, { device: entry.device, name: String(entry.name ?? ""), was: String(entry.was ?? "") });
      }
      for (const entry of kept) if (entry?.device !== hostDevice) keepOff(entry?.country, entry?.device);
      for (const seat of saved) {
        const country = String(seat?.country ?? "");
        if (!country || seat?.device === hostDevice) continue;
        choosable.add(country);
        seats.set(country, {
          id: mint(),
          country,
          device: seat.device || null,
          name: String(seat.name ?? ""),
          status: seat.device && seat.status !== SEAT_STATUS.AI ? SEAT_STATUS.AWAY : SEAT_STATUS.AI,
          since: now(),
        });
      }
    },

    // A person's people founded a country of their own (host/foundings.js), or
    // their country was renamed: the seat follows, with its player, whoever
    // minds it meanwhile: a player away, or one whose country the AI minds,
    // holds it still, and comes back to it under its new name. Never onto a
    // country another device holds. The new name was not on the list when the
    // game opened, and is from now on.
    move(from, to) {
      const seat = seats.get(String(from));
      const key = String(to ?? "");
      if (!seat || !key || key === seat.country) return false;
      const there = seats.get(key);
      if (there?.device && there.device !== seat.device) return false;
      choosable.add(key);
      seats.delete(seat.country);
      seats.set(key, { ...seat, country: key });
      // Who was released from it was released from it under its new name too.
      if (released.has(seat.country)) {
        for (const device of released.get(seat.country)) keepOff(key, device);
        released.delete(seat.country);
      }
      return true;
    },

    start() {
      started = true;
    },

    seatOf: (device) => byDevice(device),
    // The seat by its id, wherever it is now (null once it has ended).
    seatById: (id) => (id ? [...seats.values()].find((seat) => seat.id === id) ?? null : null),
    // Who the host released from what, for the game to save: [{ device, country }].
    released: () => [...released.entries()].flatMap(([country, devices]) => [...devices].map((device) => ({ device, country }))),
    // The player whose country is gone, who watches it.
    watcherOf: (device) => (watchers.has(device) ? { ...watchers.get(device) } : null),
    watching: () => [...watchers.values()].map((entry) => ({ ...entry })),
    // Whether a device may come in: one in the game always may; anyone else
    // while those in the game and `waiting` (people in without a seat, there
    // to take one) are fewer than the seats.
    hasRoom: (device, { waiting = 0 } = {}) => members().has(device) || members().size + waiting < maxPlayers,
    // Seats a newcomer could still take.
    open: ({ waiting = 0 } = {}) => Math.max(0, maxPlayers - members().size - waiting),
    // Countries people play (here or away): the ones the world may not decide for.
    humanCountries: () => people().map((seat) => seat.country),
    // Devices whose players are here: the ones a round waits for.
    presentDevices: () => [...seats.values()].filter((seat) => seat.status === SEAT_STATUS.HUMAN).map((seat) => seat.device),
    list: () => [...seats.values()].map((seat) => ({ ...seat })),
    get started() {
      return started;
    },
  };
};
