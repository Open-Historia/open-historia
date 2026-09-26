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
  const seats = new Map(); // country → { country, device, name, status, since }
  let started = false;

  const byDevice = (device) => [...seats.values()].find((seat) => seat.device === device) ?? null;
  const people = () => [...seats.values()].filter((seat) => seat.status === SEAT_STATUS.HUMAN || seat.status === SEAT_STATUS.AWAY);

  const refusal = (reason) => ({ ok: false, reason });

  return {
    // A person takes a country. In the lobby any free country; once the game
    // has started, only if the host allows joining mid-game, and then only a
    // country the AI is playing (or one no one has taken).
    claim(country, { device, name }) {
      const key = String(country ?? "");
      if (!choosable.has(key)) return refusal("not-a-country");
      if (started && !allowMidGameJoin) return refusal("game-started");
      const current = seats.get(key);
      const mine = byDevice(device);
      if (current && current.device !== device && current.status !== SEAT_STATUS.AI) return refusal("taken");
      if (!mine && people().length >= maxPlayers) return refusal("full");
      if (mine && mine.country !== key) {
        // Changing country in the lobby frees the old one; mid-game the old one
        // goes to the AI.
        if (started) seats.set(mine.country, { ...mine, status: SEAT_STATUS.AI, device: null, since: now() });
        else seats.delete(mine.country);
      }
      seats.set(key, { country: key, device, name: String(name ?? ""), status: SEAT_STATUS.HUMAN, since: now() });
      return { ok: true, country: key };
    },

    // Back to the lobby list, before the game starts.
    unclaim(device) {
      const mine = byDevice(device);
      if (!mine) return false;
      if (started) seats.set(mine.country, { ...mine, status: SEAT_STATUS.AI, device: null, since: now() });
      else seats.delete(mine.country);
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

    // The host takes a country back from a player (a kick), or hands the AI's.
    release(country) {
      const seat = seats.get(String(country));
      if (!seat) return false;
      if (started) seats.set(seat.country, { ...seat, status: SEAT_STATUS.AI, device: null, since: now() });
      else seats.delete(seat.country);
      return true;
    },

    start() {
      started = true;
    },

    seatOf: (device) => byDevice(device),
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
