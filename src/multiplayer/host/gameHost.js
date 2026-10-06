/*! Open Historia — the host's side of a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host runs the one real game and everyone else plays it through the host:
//
//   - who plays what is the seat book's (host/seats.js), and when a round ends
//     is the round machine's (host/round.js);
//   - a player never writes the game. It sends REQUESTS (game/messages.js), and
//     the host checks each one against who is asking and where the round is
//     before it changes anything, then answers it (ack);
//   - after anything changes, every player is sent their VIEW
//     (host/projection.js), and only the documents that changed since the last
//     one they were sent;
//   - when the round machine ends a round, the game's own time skip runs for
//     every player at once (resolveRound), with the polities people play written
//     into the game (game.humanCountries) so the engine protects each of them.
//
// Runtime-free: the game's documents come and go through `store`, messages
// through `transport`, and time through `now` and `timers`, so this is tested
// in node and the same code runs in the host's engine window.

import { createRoundMachine } from "./round.js";
import { SEAT_STATUS, createSeatBook } from "./seats.js";
import { roundSettingsOf } from "./settings.js";
import { projectForViewer } from "./projection.js";
import { ORDER_MAX_CHARS } from "../game/messages.js";
import { withPlayerGoal } from "../../runtime/playerGoal.js";
import { normalizeProjects } from "../../runtime/gameState.js";

export const MAX_ORDERS_PER_ROUND = 12;
const SEEN_REQUESTS = 64;
const VIEW_KEYS = ["world", "game", "events", "chat", "actions", "intercepts", "colors", "flags"];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// One player's Projects board put where the game keeps it: the host's seat has
// the game's own (world.projects, single player's); every other person's is
// kept beside it by country (world.seatBoards), where no time skip, no rollback
// and no other player's view mistakes it for the host's. The game's normalizer
// holds it to a board's shape and size, whatever was sent.
export const withSeatBoard = (world, country, projects, { host = "" } = {}) => {
  const board = normalizeProjects(projects);
  if (same(country, host)) return { ...world, projects: board };
  const boards = Object.fromEntries(Object.entries(isRecord(world?.seatBoards) ? world.seatBoards : {})
    .filter(([key]) => !same(key, country)));
  if (board.length) boards[clean(country)] = board;
  return { ...world, seatBoards: boards };
};

let sequence = 0;
const mintId = (prefix, now) => {
  sequence += 1;
  return `${prefix}-${now().toString(36)}-${sequence.toString(36)}`;
};

export const createGameHost = ({
  transport,
  settings,
  // The host plays its campaign's own country (game.country) from its own
  // device; its seat is taken before anyone joins.
  hostSeat = { device: "", name: "", country: "" },
  scenario = { id: "", name: "", hash: "" },
  countries = [],
  store,
  resolveRound = async () => {},
  replyTo = async () => {},
  onStatus = () => {},
  log = () => {},
  now = () => Date.now(),
  timers = globalThis,
} = {}) => {
  const seats = createSeatBook({
    countries,
    maxPlayers: settings.seats,
    graceMs: settings.leaverGraceMinutes * 60 * 1000,
    allowMidGameJoin: settings.allowMidGameJoin,
    now,
  });
  const hostCountry = clean(hostSeat.country);
  if (hostCountry && hostSeat.device) seats.claim(hostCountry, { device: hostSeat.device, name: hostSeat.name });
  // playerId → { id, device, name, sent: Map(key → json), rev, seen: string[] }
  const connections = new Map();
  let expiryTimer = null;
  let stopped = false;
  let pushing = Promise.resolve();

  const isHost = (connection) => Boolean(hostSeat.device) && connection.device === hostSeat.device;
  const seatOf = (connection) => {
    const seat = seats.seatOf(connection.device);
    return seat && seat.status !== SEAT_STATUS.AI ? seat : null;
  };
  const present = () => seats.list().filter((seat) => seat.status === SEAT_STATUS.HUMAN).map((seat) => seat.country);

  const lobbyFor = (connection) => ({
    t: "lobby",
    settings,
    scenario,
    countries: countries.slice(0, 600),
    seats: seats.list().map((seat) => ({
      country: seat.country,
      name: clean(seat.name).slice(0, 40),
      status: seat.status,
      you: Boolean(connection) && seat.device === connection.device,
    })),
    started: seats.started,
  });

  const roundMessage = (status) => ({
    t: "round",
    phase: status.phase,
    round: status.round,
    remainingMs: Math.max(0, Math.round(status.remainingMs)),
    paused: status.paused,
    ready: status.ready,
    counted: status.counted.length,
    needed: status.needed,
  });

  const send = (connection, message) => {
    try {
      transport.send(connection.id, message);
    } catch (error) {
      log("warn", "send failed", { player: connection.id, error: String(error?.message || error) });
    }
  };
  const broadcastLobby = () => {
    for (const connection of connections.values()) send(connection, lobbyFor(connection));
    onStatus({ lobby: lobbyFor(null), round: round.status() });
  };

  // Every player's view, and only the documents that changed since the last
  // one each was sent. Pushes run one at a time, in order.
  const pushViews = () => {
    pushing = pushing.then(async () => {
      if (stopped) return;
      const seated = [...connections.values()].filter((connection) => seatOf(connection));
      if (!seated.length) return;
      const docs = await store.read();
      for (const connection of seated) {
        const seat = seatOf(connection);
        if (!seat) continue;
        const view = projectForViewer(docs, seat.country);
        const changed = {};
        for (const key of VIEW_KEYS) {
          const text = JSON.stringify(view[key] ?? null);
          if (connection.sent.get(key) !== text) {
            connection.sent.set(key, text);
            changed[key] = view[key];
          }
        }
        if (!Object.keys(changed).length) continue;
        connection.rev += 1;
        send(connection, { t: "view", rev: connection.rev, docs: changed });
      }
    }).catch((error) => log("warn", "view push failed", { error: String(error?.message || error) }));
    return pushing;
  };

  // The game must know who people are: before the engine runs a round, and
  // from the lobby on, so that nothing ever answers a message for a country a
  // person has taken. Forgotten again when the game stops being shared (stop).
  const recordHumans = () => (stopped
    ? Promise.resolve()
    : store.updateGame((game) => ({ ...game, humanCountries: seats.humanCountries() })));
  const forgetHumans = () => store.updateGame((game) => {
    if (!list(game?.humanCountries).length) return null;
    const { humanCountries: _gone, ...rest } = game;
    return rest;
  });

  const round = createRoundMachine({
    settings: roundSettingsOf(settings),
    now,
    timers,
    onChange: (status) => {
      const message = roundMessage(status);
      for (const connection of connections.values()) send(connection, message);
      onStatus({ lobby: lobbyFor(null), round: status });
    },
    onResolve: async ({ round: number }) => {
      await recordHumans();
      await resolveRound({ round: number, humanCountries: seats.humanCountries(), daysPerRound: settings.daysPerRound });
      await pushViews();
    },
  });

  const seatsChanged = async () => {
    // A connection closing after the game stopped changes nothing.
    if (stopped) return;
    round.setPlayers(present());
    broadcastLobby();
    await recordHumans();
    await pushViews();
  };

  // --- Requests ------------------------------------------------------------------

  const planning = () => ["planning", "countdown"].includes(round.status().phase);

  const handlers = {
    pick: async (connection, { country }) => {
      if (isHost(connection)) return "The host plays its own game's country.";
      const result = seats.claim(country, { device: connection.device, name: connection.name });
      if (!result.ok) return result.reason;
      connection.sent.clear();
      await seatsChanged();
      return "";
    },
    unpick: async (connection) => {
      if (isHost(connection)) return "The host plays its own game's country.";
      if (!seats.unclaim(connection.device)) return "You have no country to give back.";
      connection.sent.clear();
      await seatsChanged();
      return "";
    },
    ready: async (connection, { value }, seat) => (round.setReady(seat.country, value) ? "" : "Not now: the round is not being planned."),
    revealed: async (connection, message, seat) => {
      round.revealedBy(seat.country);
      return "";
    },
    order: async (connection, { text }, seat) => {
      if (!planning()) return "Orders are taken while a round is being planned.";
      const body = clean(text).slice(0, ORDER_MAX_CHARS);
      if (!body) return "An order needs words.";
      let refusal = "";
      await store.updateActions((actions) => {
        const mine = list(actions).filter((action) => same(action?.ownerCode, seat.country) && clean(action?.status || "planned") === "planned");
        if (mine.length >= MAX_ORDERS_PER_ROUND) {
          refusal = `At most ${MAX_ORDERS_PER_ROUND} orders a round.`;
          return null;
        }
        return [...list(actions), {
          id: mintId("order", now),
          kind: "action",
          source: "manual",
          status: "planned",
          title: body.length > 64 ? `${body.slice(0, 61)}...` : body,
          text: body,
          rawInput: body,
          ownerCode: seat.country,
          createdAt: new Date(now()).toISOString(),
        }];
      });
      round.touch(seat.country);
      return refusal;
    },
    unorder: async (connection, { order }, seat) => {
      if (!planning()) return "Orders can be withdrawn while a round is being planned.";
      let found = false;
      await store.updateActions((actions) => {
        const next = list(actions).filter((action) => {
          const mine = clean(action?.id) === clean(order) && same(action?.ownerCode, seat.country) && clean(action?.status || "planned") === "planned";
          if (mine) found = true;
          return !mine;
        });
        return found ? next : null;
      });
      round.touch(seat.country);
      return found ? "" : "That is not one of your queued orders.";
    },
    goal: async (connection, { text }, seat) => {
      // The game's own rule for a standing goal (runtime/playerGoal.js).
      await store.updateWorld((world) => withPlayerGoal(world, seat.country, text));
      round.touch(seat.country);
      return "";
    },
    // The player's own Projects board, whole, as their screen has just changed
    // it: their advisor's entries, or the board's own buttons. A board is a
    // government's working papers, so it may be changed whenever a round is not
    // being resolved (the time skip is then rewriting the host's own).
    board: async (connection, { projects }, seat) => {
      if (!Array.isArray(projects)) return "A board is a list of projects.";
      if (round.status().phase === "resolving") return "The round is being resolved: change the board once it has landed.";
      await store.updateWorld((world) => withSeatBoard(world, seat.country, projects, { host: hostCountry }));
      round.touch(seat.country);
      return "";
    },
    say: async (connection, { thread, to, text }, seat) => {
      const body = clean(text);
      if (!body) return "A message needs words.";
      const recipients = list(to).map(clean).filter(Boolean);
      if (!thread && !recipients.length) return "Say it to someone.";
      if (recipients.some((country) => same(country, seat.country))) return "A government does not write to itself.";
      if (recipients.some((country) => !countries.some((known) => same(known, country)))) return "Unknown country.";
      let chatId = clean(thread);
      let refusal = "";
      // Everyone at the table: the thread's owner and its members.
      let parties = [];
      // A person's line is theirs by name (speaker); "user" is the role every
      // line a person writes is stored with, whoever owns the thread. Each
      // player's view then reads its own lines as its own (host/projection.js).
      const message = {
        id: mintId("message", now),
        role: "user",
        speaker: seat.country,
        code: seat.country,
        text: body,
        createdAt: new Date(now()).toISOString(),
      };
      await store.updateChats((chats) => {
        const all = list(chats);
        if (chatId) {
          const index = all.findIndex((chat) => clean(chat?.id) === chatId);
          const chat = all[index];
          // A thread's owner is chat.player, or the host's seat when blank.
          const owner = chat ? clean(chat.player) || hostCountry : "";
          const members = list(chat?.countries).map((entry) => clean(typeof entry === "object" && entry ? entry.name ?? entry.code : entry));
          const inIt = chat && (same(owner, seat.country) || members.some((name) => same(name, seat.country)));
          if (!inIt) {
            refusal = "You are not in that conversation.";
            return null;
          }
          parties = [owner, ...members];
          const next = [...all];
          next[index] = { ...chat, messages: [...list(chat.messages), message] };
          return next;
        }
        chatId = mintId("thread", now);
        parties = [seat.country, ...recipients];
        return [...all, {
          id: chatId,
          player: seat.country,
          countries: recipients.map((country) => ({ code: country, name: country })),
          messages: [message],
        }];
      });
      if (refusal) return refusal;
      round.touch(seat.country);
      // The AI governments in the thread answer (the game's own diplomacy),
      // after the player's view shows what they wrote. A country a person plays
      // answers for itself: a thread between people asks the model nothing.
      const people = seats.humanCountries();
      const hasAiGovernment = parties.some((name) => name && !same(name, seat.country) && !people.some((human) => same(human, name)));
      if (hasAiGovernment) {
        pushViews().then(() => replyTo({ chatId, seat: seat.country })).then(() => pushViews())
          .catch((error) => log("warn", "reply failed", { error: String(error?.message || error) }));
      }
      return "";
    },
  };

  const receive = async (player, message) => {
    const connection = connections.get(player.id);
    if (!connection || stopped) return;
    const id = clean(message?.id);
    // A request sent twice over a shaky connection is applied once.
    if (id && connection.seen.includes(id)) return;
    if (id) {
      connection.seen.push(id);
      if (connection.seen.length > SEEN_REQUESTS) connection.seen.shift();
    }
    const handler = handlers[message?.t];
    if (!handler) return;
    const seat = seatOf(connection);
    const needsSeat = !["pick", "unpick"].includes(message.t);
    let error = "";
    if (needsSeat && (!seat || seat.status !== SEAT_STATUS.HUMAN)) error = "Take a country first.";
    else {
      try {
        error = await handler(connection, message, seat);
      } catch (failure) {
        log("warn", "request failed", { t: message.t, error: String(failure?.message || failure) });
        error = "The host could not do that.";
      }
    }
    if (id) send(connection, { t: "ack", id, ok: !error, error: error || null });
    if (!error && message.t !== "ready" && message.t !== "revealed") await pushViews();
  };

  return {
    // A player's connection (session/host.js onJoin, or the host's own screen).
    join(player) {
      if (stopped) return;
      connections.set(player.id, { id: player.id, device: player.device, name: player.name, sent: new Map(), rev: 0, seen: [] });
      const seat = seats.seatOf(player.device);
      if (seat && seat.status !== SEAT_STATUS.HUMAN) seats.returned(player.device, { name: player.name });
      const connection = connections.get(player.id);
      send(connection, lobbyFor(connection));
      send(connection, roundMessage(round.status()));
      void seatsChanged();
    },
    leave(player) {
      const connection = connections.get(player.id);
      if (!connection) return;
      connections.delete(player.id);
      // Another connection of the same device (a reconnect) keeps the seat, and
      // the host's own seat is the host's for as long as the game runs.
      if ([...connections.values()].some((entry) => entry.device === connection.device) || isHost(connection)) return;
      seats.left(connection.device);
      void seatsChanged();
    },
    receive,
    // The host's own controls, from the host's own screen only.
    control: {
      async start() {
        if (seats.started) return;
        seats.start();
        await recordHumans();
        round.start();
        broadcastLobby();
        await pushViews();
      },
      pause: () => round.pause(),
      resume: () => round.resume(),
      resolveNow: () => round.resolveNow(),
      kick(country) {
        const seat = seats.list().find((entry) => same(entry.country, country));
        if (!seat || same(seat.country, hostCountry)) return null;
        seats.release(seat.country);
        void seatsChanged();
        return seat.device;
      },
    },
    start() {
      expiryTimer = timers.setInterval(() => {
        const handed = seats.expire();
        if (!handed.length) return;
        for (const connection of connections.values()) {
          send(connection, { t: "notice", level: "info", text: `${handed.join(", ")} ${handed.length === 1 ? "is" : "are"} now played by the AI.` });
        }
        void seatsChanged();
      }, 15_000);
    },
    // The game is single player again: nobody is played by a person but the
    // host, and the AI plays every other country as before.
    async stop() {
      stopped = true;
      timers.clearInterval(expiryTimer);
      round.stop();
      await pushing.catch(() => {});
      await forgetHumans().catch((error) => log("warn", "the shared game's players were not cleared", { error: String(error?.message || error) }));
    },
    pushViews,
    status: () => ({ lobby: lobbyFor(null), round: round.status(), players: [...connections.values()].map((entry) => ({ id: entry.id, name: entry.name, seat: seatOf(entry)?.country ?? "" })) }),
  };
};
