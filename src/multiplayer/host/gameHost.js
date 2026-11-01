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
import { seatFoundings, withSeatMoved } from "./foundings.js";
import { roundSettingsOf } from "./settings.js";
import { projectForViewer } from "./projection.js";
import { ORDER_MAX_CHARS } from "../game/messages.js";
import { withPlayerGoal } from "../../runtime/playerGoal.js";
import { normalizeProjects } from "../../runtime/gameState.js";
import { deployFor, disbandFor, revertOrderFor } from "./forces.js";
import { agentOrderFor } from "./agents.js";
import { acceptStructure, canSettleStructure, moveStructure } from "../../runtime/structurePlacement.js";
import { applyWarRoomOp, cleanWarRoomOp } from "../../runtime/fronts/warRoomOps.js";
import { applyFortifyOp, cleanFortifyOp } from "../../runtime/fronts/fortifyOps.js";
import { applyFleetOp, cleanFleetOp } from "../../runtime/naval/fleetOps.js";
import { eraSettingOf } from "../../runtime/warSettings.js";
import { humanCountriesOf } from "../../runtime/humanPolities.js";
import { playerDiplomacy } from "../../Game/AI/warAndPeace.js";

export const MAX_ORDERS_PER_ROUND = 12;
// Stat sheets a player may ask the host to write in one round: each is a
// request on the host's own AI key.
export const MAX_SHEETS_PER_ROUND = 6;
const SEEN_REQUESTS = 64;
const VIEW_KEYS = ["world", "game", "events", "chat", "actions", "intercepts", "colors", "flags"];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const fold = (value) => clean(value).toLocaleLowerCase();

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
  // Write a country's stat sheet (the game's own, on the host's AI key);
  // rejects with the reason when it cannot.
  readCountry = async () => {},
  // The host's own chart of the map (runtime/warRoomChart.js: where the sea
  // is, whose the ground), which the war room's fortified lines and fleets
  // are held to; resolves with null when the map could not be read.
  readChart = async () => null,
  // An institution's business for a seat (host/institutions.js): resolves
  // { institutionId, proposalId, chatId } or rejects with the reason.
  institution = async () => {
    throw new Error("Institutions are not run here.");
  },
  onStatus = () => {},
  // Seats that followed their people to a country they founded
  // (host/foundings.js): [{ from, to, host }], `host` when it was the host's own.
  onSeatsMoved = () => {},
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
  // The host's own country: the campaign's (game.country), until the host's
  // people found one of their own.
  let hostCountry = clean(hostSeat.country);
  if (hostCountry && hostSeat.device) seats.claim(hostCountry, { device: hostSeat.device, name: hostSeat.name });
  // playerId → { id, device, name, sent: Map(key → json), rev, seen: string[] }
  const connections = new Map();
  // seat (folded) → { round, count }: the stat sheets it has asked for this round.
  const sheetsAsked = new Map();
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
      const start = await store.read();
      const before = { eventIds: new Set(list(start.events).map((event) => clean(event?.id))), areas: { ...(start.world?.groupAreas ?? {}) } };
      await resolveRound({ round: number, humanCountries: seats.humanCountries(), daysPerRound: settings.daysPerRound });
      await followFoundings(before).catch((error) => log("warn", "a founded country's seat did not follow", { error: String(error?.message || error) }));
      await pushViews();
    },
  });

  // A player's people founded a country this round and gave it their land:
  // the seat goes with them (host/foundings.js), and with it their queued
  // orders, their board, their agents and their threads; the game remembers
  // the old name (game.seatFoundings), so what that government knew is still
  // theirs to read (host/projection.js). `before`: the event ids and the
  // groups' areas the round started with.
  const followFoundings = async (before) => {
    const docs = await store.read();
    const moves = seatFoundings({
      events: list(docs.events).filter((event) => !before.eventIds.has(clean(event?.id))),
      actions: docs.actions,
      seated: seats.humanCountries(),
      host: hostCountry,
      areas: before.areas,
    }).filter((move) => seats.move(move.from, move.to));
    if (!moves.length) return;
    for (const move of moves) {
      move.host = same(move.from, hostCountry);
      if (move.host) hostCountry = move.to;
      await store.updateGame((game) => ({
        ...game,
        ...(move.host ? { country: move.to } : {}),
        seatFoundings: [...list(game?.seatFoundings), { from: move.from, to: move.to }],
      }));
      await store.updateActions((actions) => withSeatMoved({ actions }, move).actions);
      await store.updateWorld((world) => withSeatMoved({ world }, move).world);
      await store.updateChats((chats) => withSeatMoved({ chats }, move).chats);
      log("info", "a seat followed its people to the country they founded", { from: move.from, to: move.to });
      // Told to the player whose seat moved; everyone sees the lobby change.
      const device = seats.list().find((seat) => same(seat.country, move.to))?.device;
      for (const connection of connections.values()) {
        if (device && connection.device === device) send(connection, { t: "notice", level: "info", text: `${move.from} has founded ${move.to}: you now play ${move.to}.` });
      }
    }
    onSeatsMoved(moves.map(({ from, to, host }) => ({ from, to, host })));
    await seatsChanged();
  };

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
  // Orders go on the queue the next skip reads: while a round is planned, and
  // while the one just resolved is being read, when they are the next round's.
  // A player who gave orders as the events came in was refused, and gave them
  // again ten seconds later. Never while a round is being resolved: its skip
  // has read the queue already.
  const takingOrders = () => ["planning", "countdown", "revealing"].includes(round.status().phase);
  const notNow = (outside) => (round.status().phase === "resolving"
    ? "The round is being resolved: try again once it has landed."
    : outside);

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
      if (!takingOrders()) return notNow("Orders are taken while a round is being planned.");
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
      if (!takingOrders()) return notNow("Orders can be withdrawn while a round is being planned.");
      let found = false;
      // An order that raised or stood down a formation is undone on the map in
      // the same write that takes it off the queue (host/forces.js).
      await store.updateForces(({ world, actions }) => {
        const withdrawn = list(actions).find((action) =>
          clean(action?.id) === clean(order) && same(action?.ownerCode, seat.country) && clean(action?.status || "planned") === "planned");
        if (!withdrawn) return null;
        found = true;
        const next = { actions: list(actions).filter((action) => action !== withdrawn) };
        const reverted = revertOrderFor(world, withdrawn, seat.country, { at: new Date(now()).toISOString() });
        return reverted === world ? next : { ...next, world: reverted };
      });
      round.touch(seat.country);
      return found ? "" : "That is not one of your queued orders.";
    },
    // Raise a formation: it stands on the map as pending, and its Deploy
    // request rides with the next skip (host/forces.js).
    deploy: async (connection, request, seat) => {
      if (!takingOrders()) return notNow("Formations are raised while a round is being planned.");
      let refusal = "";
      await store.updateForces(({ world, actions }) => {
        const result = deployFor({ world, actions }, seat.country, request, {
          orderId: mintId("order", now),
          unitId: mintId("unit", now),
          at: new Date(now()).toISOString(),
          maxOrders: MAX_ORDERS_PER_ROUND,
        });
        if (result.error) {
          refusal = result.error;
          return null;
        }
        return { world: result.world, actions: result.actions };
      });
      round.touch(seat.country);
      return refusal;
    },
    disband: async (connection, { unit }, seat) => {
      if (!takingOrders()) return notNow("Formations are stood down while a round is being planned.");
      let refusal = "";
      await store.updateForces(({ world, actions }) => {
        const result = disbandFor({ world, actions }, seat.country, unit, {
          orderId: mintId("order", now),
          at: new Date(now()).toISOString(),
          maxOrders: MAX_ORDERS_PER_ROUND,
        });
        if (result.error) {
          refusal = result.error;
          return null;
        }
        return { world: result.world, actions: result.actions };
      });
      round.touch(seat.country);
      return refusal;
    },
    // A structure the map could only place approximately, settled by the player
    // it belongs to (runtime/structurePlacement.js): Accept keeps it where it
    // stands, Move puts it at a point. A correction of the map, not an order, so
    // it is taken whenever a round is not being resolved.
    settle: async (connection, { marker, move, lng, lat }, seat) => {
      if (round.status().phase === "resolving") return "The round is being resolved: settle it once it has landed.";
      let refusal = "";
      await store.updateWorld((world) => {
        const found = list(world?.markers).find((entry) => clean(entry?.id) === clean(marker));
        if (!found) refusal = "That structure is not on the map.";
        else if (!canSettleStructure(found, { playerCountry: seat.country, world })) refusal = "That structure is not yours to settle.";
        if (refusal) return null;
        const markers = move ? moveStructure(world.markers, found.id, { lng, lat }) : acceptStructure(world.markers, found.id);
        return { ...world, markers };
      });
      round.touch(seat.country);
      return refusal;
    },
    // The war room (runtime/fronts/warRoomOps.js): what a player does on a
    // battlefield its troops are on. The op says which battlefield and what;
    // whose troops they are is the seat's country and nothing the op says.
    // Nothing moves for it: the engine puts orders to the troops when the
    // round is resolved, so it is taken whenever one is not being.
    warroom: async (connection, { op }, seat) => {
      if (round.status().phase === "resolving") return "The round is being resolved: the generals take orders once it has landed.";
      const sent = cleanWarRoomOp(op);
      if (!sent) return "Nothing was asked.";
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const result = applyWarRoomOp(world?.battlefields, sent, { player: seat.country, date: clean(game?.gameDate), transports: world?.transports, era: eraSettingOf(world) });
        if (result.error) {
          refusal = result.error;
          return null;
        }
        return { world: { ...world, battlefields: result.battlefields, ...(result.transports ? { transports: result.transports } : null) } };
      });
      round.touch(seat.country);
      return refusal;
    },
    // The war room's fortified lines (runtime/fronts/fortifyOps.js) and fleets
    // (runtime/naval/fleetOps.js), by the same rule: a line is the seat's
    // country's and a fleet must be, whatever the op says, and both are held
    // to the host's own map (readChart), read before the write. Taken whenever
    // a round is not being resolved: a line is built and a fleet sails as time
    // passes.
    fortify: async (connection, { op }, seat) => {
      if (round.status().phase === "resolving") return "The round is being resolved: order it once it has landed.";
      const sent = cleanFortifyOp(op);
      if (!sent) return "Nothing was asked.";
      const chart = sent.op === "fortify" ? await Promise.resolve().then(readChart).catch(() => null) : null;
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const result = applyFortifyOp(world, sent, { player: seat.country, date: clean(game?.gameDate), chart });
        if (result.error) {
          refusal = result.error;
          return null;
        }
        return { world: result.world };
      });
      round.touch(seat.country);
      return refusal;
    },
    fleet: async (connection, { op }, seat) => {
      if (round.status().phase === "resolving") return "The round is being resolved: order it once it has landed.";
      const sent = cleanFleetOp(op);
      if (!sent) return "Nothing was asked.";
      const chart = ["station", "blockade", "escort"].includes(sent.op) ? await Promise.resolve().then(readChart).catch(() => null) : null;
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const result = applyFleetOp(world, sent, { player: seat.country, date: clean(game?.gameDate), round: game?.round, chart, at: new Date(now()).toISOString() });
        if (result.error) {
          refusal = result.error;
          return null;
        }
        return { world: result.world };
      });
      round.touch(seat.country);
      return refusal;
    },
    // The Intelligence tab's orders (host/agents.js): the player's own agents,
    // and the foreign ones its own service has caught.
    agent: async (connection, request, seat) => {
      if (!planning()) return "Agents take orders while a round is being planned.";
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const mine = same(seat.country, hostCountry);
        const boards = isRecord(world?.seatBoards) ? world.seatBoards : {};
        const key = Object.keys(boards).find((country) => same(country, seat.country));
        const board = mine ? list(world?.projects) : list(key ? boards[key] : []);
        const result = agentOrderFor(world, board, seat.country, request, {
          host: hostCountry,
          date: clean(game?.gameDate),
          known: (name) => countries.some((country) => same(country, name))
            || Object.entries(isRecord(world?.polityOverrides) ? world.polityOverrides : {}).some(([polity, entry]) => same(polity, name) || same(entry?.name, name)),
        });
        if (result.error) {
          refusal = result.error;
          return null;
        }
        return { world: withSeatBoard(result.world, seat.country, result.board, { host: hostCountry }) };
      });
      round.touch(seat.country);
      return refusal;
    },
    // A country's stat sheet, when the player's Stats pane has none to show:
    // the host writes it, on its own AI key, and it reaches every view. The
    // answer waits for the writing, so the pane can say why when it fails.
    sheet: async (connection, { country, fresh }, seat) => {
      if (round.status().phase === "resolving") return "The round is being resolved: the figures come with it.";
      const current = round.status().round;
      const asked = sheetsAsked.get(fold(seat.country));
      const count = asked?.round === current ? asked.count : 0;
      if (count >= MAX_SHEETS_PER_ROUND) return `A player may ask for ${MAX_SHEETS_PER_ROUND} stat sheets a round.`;
      sheetsAsked.set(fold(seat.country), { round: current, count: count + 1 });
      try {
        await readCountry({ country: clean(country), fresh: fresh === true, seat: seat.country });
      } catch (failure) {
        return clean(failure?.message || failure).slice(0, 280) || "The host could not write that country's figures.";
      }
      round.touch(seat.country);
      return "";
    },
    // War and peace (Game/AI/warAndPeace.js): the seat's own answer to an
    // offer of peace or a call to arms, or terms of its own put to an enemy
    // nobody plays, which wait for that enemy's leader to answer them in the
    // seat's chat with it (the host's own table turn, runChatActionBatch, reads
    // the answer). Whose answer it is is the seat's country and nothing the
    // message says. Not while a round is being resolved: the round would
    // write over it.
    peace: async (connection, { op, ref, terms }, seat) => {
      if (round.status().phase === "resolving") return "The round is being resolved: answer once it has landed.";
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const outcome = playerDiplomacy(world, { op, ref, terms, country: seat.country, players: humanCountriesOf(game), date: clean(game?.gameDate), round: game?.round });
        if (outcome.error) {
          refusal = outcome.error === "not-yours" ? "This is not yours to answer." : outcome.error === "played" ? "That side is led by another player: make peace with them in a chat." : "This is no longer open.";
          return null;
        }
        return { world: outcome.world };
      });
      round.touch(seat.country);
      return refusal;
    },
    goal: async (connection, { text }, seat) => {
      if (round.status().phase === "resolving") return "The round is being resolved: set the goal once it has landed.";
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
    // An institution's business, done for this seat's country by the game's
    // own institution functions (host/institutions.js), which check that the
    // country may do it. Not while a round is being resolved: the turn writes
    // back the world the institutions live in. What was made goes back with
    // the ack, so the asker's screen can show it.
    institution: async (connection, { call, args }, seat) => {
      if (round.status().phase === "resolving") return "The round is being resolved: try again once it has landed.";
      try {
        const made = await institution({ seat: seat.country, call, args: args ?? {} });
        const result = {};
        for (const key of ["institutionId", "proposalId", "proposalStatus", "chatId"]) {
          const value = clean(made?.[key]).slice(0, 160);
          if (value) result[key] = value;
        }
        return { error: "", result };
      } catch (failure) {
        log("warn", "an institution request was refused", { call, error: String(failure?.message || failure) });
        return clean(failure?.message || failure).slice(0, 300) || "The host could not do that.";
      }
    },
    say: async (connection, { thread, to, text }, seat) => {
      const body = clean(text);
      if (!body) return "A message needs words.";
      const recipients = list(to).map(clean).filter(Boolean);
      if (!thread && !recipients.length) return "Say it to someone.";
      if (recipients.some((country) => same(country, seat.country))) return "A government does not write to itself.";
      if (recipients.some((country) => !countries.some((known) => same(known, country)))) return "Unknown country.";
      // A letter to a government the AI plays is part of the week: while one is
      // being resolved its skip has read the conversations already, so the
      // letter waits. People write to each other whenever they like.
      const resolving = round.status().phase === "resolving";
      const people = seats.humanCountries();
      const playedByAi = (name) => name && !same(name, seat.country) && !people.some((human) => same(human, name));
      if (resolving && recipients.some(playedByAi)) return "The round is being resolved: write to the AI's governments once it has landed.";
      // Dated by the game, as a government's own reply is (chat.jsx `time`):
      // a letter between people was shown with no date at all.
      const gameDate = clean((await store.read())?.game?.gameDate);
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
        ...(gameDate ? { time: gameDate } : {}),
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
          if (resolving && parties.some(playedByAi)) {
            refusal = "The round is being resolved: write to the AI's governments once it has landed.";
            return null;
          }
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
      const hasAiGovernment = parties.some(playedByAi);
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
    let result = null;
    if (needsSeat && (!seat || seat.status !== SEAT_STATUS.HUMAN)) error = "Take a country first.";
    else {
      try {
        // A refusal's words, or { error, result } from a request that made something.
        const outcome = await handler(connection, message, seat);
        if (outcome && typeof outcome === "object") {
          error = clean(outcome.error);
          result = outcome.result && Object.keys(outcome.result).length ? outcome.result : null;
        } else error = outcome;
      } catch (failure) {
        log("warn", "request failed", { t: message.t, error: String(failure?.message || failure) });
        error = "The host could not do that.";
      }
    }
    if (id) send(connection, { t: "ack", id, ok: !error, error: error || null, ...(result && !error ? { result } : {}) });
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
      setRoundMinutes: (minutes) => round.setRoundMinutes(minutes),
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
