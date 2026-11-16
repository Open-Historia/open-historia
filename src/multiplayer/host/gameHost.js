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
//     into the game (game.humanCountries) so the engine protects each of them;
//   - every change is one entry in one queue (host/worldQueue.js), applied one at
//     a time, the round's skip among them: nothing is applied between a skip's
//     reading of the world and its saving of it, and whatever arrives meanwhile
//     is applied straight after, as the next round's.
//
// Runtime-free: the game's documents come and go through `store`, messages
// through `transport`, and time through `now` and `timers`, so this is tested
// in node and the same code runs in the host's engine window.

import { createRoundMachine } from "./round.js";
import { createWorldQueue } from "./worldQueue.js";
import { SEAT_STATUS, createSeatBook } from "./seats.js";
import { seatFoundings, seatSuccessions, withSeatMoved } from "./foundings.js";
import { sessionRecordOf } from "./sessionRecord.js";
import { REPLY_MODES, roundSettingsOf } from "./settings.js";
import { projectForViewer } from "./projection.js";
import { COUNTRY_MAX_CHARS, HOST_MESSAGES, ORDER_MAX_CHARS, VIEW_KEYS } from "../game/messages.js";
import { validate } from "../protocol/validate.js";
import { digestText } from "../protocol/digest.js";
import { withPlayerGoal } from "../../runtime/playerGoal.js";
import { withPlayerPost } from "../../runtime/socialFeed.js";
import { normalizeProjects } from "../../runtime/gameState.js";
import { deployFor, disbandFor, revertOrderFor } from "./forces.js";
import { agentOrderFor } from "./agents.js";
import { acceptStructure, canSettleStructure, moveStructure } from "../../runtime/structurePlacement.js";
import { applyWarRoomOp, cleanWarRoomOp } from "../../runtime/fronts/warRoomOps.js";
import { applyFortifyOp, cleanFortifyOp } from "../../runtime/fronts/fortifyOps.js";
import { applyFleetOp, cleanFleetOp } from "../../runtime/naval/fleetOps.js";
import { applyAirStrikeOp, cleanAirStrikeOp } from "../../runtime/fronts/airStrikeOps.js";
import { activeTransportMedia, activeWars, isActiveFeatureEnabled } from "../../runtime/gameFeatures.js";
import { transportFiguresOf } from "../../runtime/militaryStats.js";
import { eraSettingOf } from "../../runtime/warSettings.js";
import { humanCountriesOf } from "../../runtime/humanPolities.js";
import { playerDiplomacy } from "../../Game/AI/warAndPeace.js";
import { warBetween } from "../../runtime/peaceTerms.js";

export const MAX_ORDERS_PER_ROUND = 12;
// Stat sheets a player may ask the host to write in one round: each is a
// request on the host's own AI key.
export const MAX_SHEETS_PER_ROUND = 6;
// The answers a device's requests were given, kept so that one sent again (the
// page sends again what was not answered before a reconnect) is applied once
// and answered as it was the first time.
const ANSWERS_KEPT = 128;
// Answered at once, whatever is being applied: they change no document (the
// round's own state, or what a page did with a view), so a round being
// resolved never holds them up.
const AT_ONCE = new Set(["ready", "revealed", "viewed"]);
// Their thinking is the AI's, done outside the queue so it holds nobody up;
// what they write is put in the queue (a stat sheet under the game's own lock,
// an institution's business by the desk, engineMain.js).
const THINKING = new Set(["sheet", "institution"]);
// Lines whose answer a player's own device is writing (settings.replies "own"):
// the newest this many are remembered.
const OWN_LINES_KEPT = 200;
// A view a page has not said it applied, this long after it was sent, is sent
// again whole: the host never takes a view's arrival for granted.
export const VIEW_ACK_MS = 60_000;
// The least time between two whole views a page asked for.
const RESYNC_GAP_MS = 2_000;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// A word for a player's screen, as long as a notice may be (game/messages.js):
// one naming two long countries was longer, and would not be sent at all.
const notice = (level, text) => ({ t: "notice", level, text: clean(text).slice(0, 500) });
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const fold = (value) => clean(value).toLocaleLowerCase();

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
// What a government said, as it was written: its paragraphs are kept.
const wordsOf = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
// Who is in a thread besides its owner, by name.
const membersOf = (chat) => list(chat?.countries).map((entry) => clean(typeof entry === "object" && entry ? entry.name ?? entry.code : entry)).filter(Boolean);
// An institution's Council or a hearing: its governments vote and decide in
// their answer, which only the host's own game can carry out.
const isInstitutionThread = (chat) => Boolean(clean(chat?.institutionId) || clean(chat?.lifecycleInstitutionId));

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
// A connection's name for its views: new for every connection, so a page
// that reconnects is never asked to follow numbers it has not seen.
const mintEpoch = (now) => {
  sequence += 1;
  return `${now().toString(36)}${sequence.toString(36)}`;
};

export const createGameHost = ({
  transport,
  settings,
  // The host plays its campaign's own country (game.country) from its own
  // device; its seat is taken before anyone joins.
  hostSeat = { device: "", name: "", country: "" },
  scenario = { id: "", name: "", hash: "" },
  // The game's feature switches as the host's game resolves them, which every
  // screen plays by (runtime/gameFeatures.js setSharedGameFeatures).
  features = null,
  countries = [],
  // The game's countries as the world has them now, every one (a country
  // founded mid-game is among them, one dissolved or annexed whole is not):
  // what may be taken, and what tells a seat's country is gone; `countries`
  // until then.
  countriesOf = null,
  // The campaign shared, and the session the game saved for it
  // (host/sessionRecord.js sessionFromRecord), taken up again: null for a new one.
  campaign = "",
  restored = null,
  // `store` reads and writes the game's documents (read, update*), and the
  // session's own record (writeShared).
  store,
  // The round's time skip, for everyone at once. `signal` ends it when the
  // shared game is stopped meanwhile.
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
  // A session taken up again: every seat its device's, and every player whose
  // country is gone watching it, before anyone joins.
  if (restored) seats.restore(restored.seats ?? [], { hostDevice: hostSeat.device, watching: restored.watching ?? [] });
  if (hostCountry && hostSeat.device) seats.claim(hostCountry, { device: hostSeat.device, name: hostSeat.name });
  if (restored?.started) seats.start();
  // The countries that may be taken now.
  let countriesNow = countries.map(clean).filter(Boolean);
  // Players who asked to change country, waiting for the host's word (the
  // owner's decision 12): device → { device, name, from, to }. One saved for a
  // seat its player no longer holds is let go.
  const changes = new Map((restored?.changes ?? [])
    .filter((entry) => same(seats.seatOf(entry.device)?.country, entry.from))
    .map((entry) => [entry.device, { ...entry }]));
  // Devices the host has banned from this game.
  const banned = new Set(restored?.banned ?? []);
  // playerId → { id, device, name, epoch, rev, sent: Map(key → json),
  // sums: Map(key → digest), acked, lastAckAt, resyncAt }
  const connections = new Map();
  // device → Map(request id → its ack, or null while it is being applied).
  const answers = new Map();
  // seat (folded) → { round, count }: the stat sheets it has asked for this round.
  const sheetsAsked = new Map();
  // Who answers a player's message to a government the AI plays (settings.js
  // `replies`): the host's computer, or the writer's own device. The host may
  // change it while the game runs (control.setReplies).
  let replies = REPLY_MODES.includes(settings.replies) ? settings.replies : "host";
  // "own": the lines whose answer their writer's device is writing: line id →
  // { thread, seat }. A "reply" is taken for one of these, once, and for
  // nothing else. In memory: one still waiting when the host closes is written
  // to again.
  const ownLines = new Map((restored?.ownLines ?? []).map((entry) => [entry.line, { thread: entry.thread, seat: entry.seat }]));
  // "host": the tables the host's AI is answering: thread id → { tail, waiting }.
  const tables = new Map();
  let expiryTimer = null;
  let stopped = false;
  let pushing = Promise.resolve();
  // The round being resolved, to stop if the shared game is.
  let roundAbort = null;
  // Every player's view after anything is applied: one push for however many
  // changes landed together.
  let pushWanted = null;
  const schedulePush = () => {
    if (!pushWanted) {
      pushWanted = Promise.resolve().then(() => {
        pushWanted = null;
        return pushViews();
      });
    }
    return pushWanted;
  };
  const queue = createWorldQueue({ onSettled: () => { void schedulePush(); } });

  // The session as it stands, saved with the game (host/sessionRecord.js) in
  // the queue's order, once for however many changes asked meanwhile. The
  // engine can be closed at any moment and the game shared again later.
  let sessionWanted = false;
  // The round a game taken up again plans: one that has landed (being read)
  // is done, and the next is planned; one being planned or resolved had not
  // landed, and is planned again with its orders.
  const roundToPlan = (status) => (status.phase === "revealing" ? status.round + 1 : status.round);
  const sessionNow = () => sessionRecordOf({
    campaign,
    started: seats.started,
    round: roundToPlan(round.status()),
    hostDevice: hostSeat.device,
    seats: seats.list(),
    watching: seats.watching(),
    changes: [...changes.values()],
    ownLines: [...ownLines].map(([line, entry]) => ({ line, ...entry })),
    banned: [...banned],
  });
  const sessionChanged = () => {
    if (sessionWanted || stopped || !campaign || typeof store.writeShared !== "function") return;
    sessionWanted = true;
    void queue.run("session", async () => {
      sessionWanted = false;
      await store.writeShared(sessionNow());
    }).catch((error) => log("warn", "the shared game's session was not saved", { error: String(error?.message || error) }));
  };

  const isHost = (connection) => Boolean(hostSeat.device) && connection.device === hostSeat.device;
  const seatOf = (connection) => {
    const seat = seats.seatOf(connection.device);
    return seat && seat.status !== SEAT_STATUS.AI ? seat : null;
  };
  // Whose view a connection is sent: its seat's country, or for a player
  // whose country is gone, that country's (the public world, and what its
  // government knew).
  const viewerOf = (connection) => seatOf(connection)?.country || seats.watcherOf(connection.device)?.was || "";
  const present = () => seats.list().filter((seat) => seat.status === SEAT_STATUS.HUMAN).map((seat) => seat.country);

  const lobbyFor = (connection) => ({
    t: "lobby",
    settings: { ...settings, replies },
    scenario,
    // The countries that may be taken now, and every seat's own.
    countries: countriesNow.filter(fits).slice(0, 600),
    seats: [
      ...seats.list().map((seat) => ({
        country: seat.country,
        name: clean(seat.name).slice(0, 40),
        status: seat.status,
        held: Boolean(seat.device),
        you: Boolean(connection) && seat.device === connection.device,
      })),
      ...seats.watching().map((entry) => ({
        country: entry.was,
        name: clean(entry.name).slice(0, 40),
        status: "watching",
        held: true,
        you: Boolean(connection) && entry.device === connection.device,
      })),
    ].filter((seat) => fits(seat.country)).slice(0, 64),
    started: seats.started,
    // Players asking to change country: the host's to allow.
    changes: (!connection || isHost(connection) ? [...changes.values()] : [])
      .map((entry) => ({ from: entry.from, to: entry.to, name: clean(entry.name).slice(0, 40) }))
      .filter((entry) => fits(entry.from) && fits(entry.to)).slice(0, 64),
    ...(features && typeof features === "object" ? { features } : {}),
  });

  const roundMessage = (status) => ({
    t: "round",
    phase: status.phase,
    round: status.round,
    remainingMs: Math.max(0, Math.round(status.remainingMs)),
    paused: status.paused,
    ready: status.ready.filter(fits).slice(0, 64),
    counted: status.counted.length,
    needed: status.needed,
    failed: status.failure?.round ?? 0,
    failure: clean(status.failure?.reason).slice(0, 300),
  });

  // What the host sends is held to the same schemas the players read it by
  // (game/messages.js): one they would drop is not sent, and is said here.
  // Before, it went out and every page threw it away without a word. A view's
  // documents are plain JSON the game's own normalizers check, so a view is
  // not walked through again here.
  const send = (connection, message) => {
    if (message?.t !== "view") {
      const checked = validate(HOST_MESSAGES[message?.t] ?? { type: "literal", value: null }, message);
      if (!checked.ok) {
        log("warn", "a message the players could not read was not sent", { t: message?.t, error: checked.error });
        return;
      }
    }
    try {
      transport.send(connection.id, message);
    } catch (error) {
      log("warn", "send failed", { player: connection.id, error: String(error?.message || error) });
    }
  };
  const fits = (name) => clean(name).length > 0 && clean(name).length <= COUNTRY_MAX_CHARS;
  const broadcastLobby = () => {
    for (const connection of connections.values()) send(connection, lobbyFor(connection));
    onStatus({ lobby: lobbyFor(null), round: round.status() });
  };
  // A word for whoever plays `country`, on every screen of theirs.
  const tell = (country, level, text) => {
    for (const connection of connections.values()) {
      if (same(seatOf(connection)?.country, country)) send(connection, notice(level, text));
    }
  };

  // Every player's view: the documents that changed since the last view each
  // was sent, or every one after a reconnect or when a page asks for it again.
  // Each view names the view it follows and what every document adds up to, so
  // the page can tell it has all of it (client/remoteRuntime.js check). Pushes
  // run one at a time, in order.
  const pushViews = () => {
    pushing = pushing.then(async () => {
      if (stopped) return;
      const seated = [...connections.values()].filter((connection) => viewerOf(connection));
      if (!seated.length) return;
      const docs = await store.read();
      for (const connection of seated) {
        const viewer = viewerOf(connection);
        if (!viewer) continue;
        const view = projectForViewer(docs, viewer);
        const whole = connection.sent.size === 0;
        const changed = {};
        for (const key of VIEW_KEYS) {
          const text = JSON.stringify(view[key] ?? null);
          if (connection.sent.get(key) !== text) {
            connection.sent.set(key, text);
            connection.sums.set(key, digestText(text));
            changed[key] = view[key] ?? null;
          }
        }
        if (!Object.keys(changed).length) continue;
        const base = whole ? 0 : connection.rev;
        connection.rev += 1;
        // Waiting on the page's word from this view on, unless it had said
        // nothing since an earlier one.
        if (connection.acked >= connection.rev - 1) connection.lastAckAt = now();
        send(connection, {
          t: "view",
          epoch: connection.epoch,
          rev: connection.rev,
          base,
          docs: changed,
          sums: Object.fromEntries(VIEW_KEYS.map((key) => [key, connection.sums.get(key)])),
        });
      }
    }).catch((error) => log("warn", "view push failed", { error: String(error?.message || error) }));
    return pushing;
  };
  // The whole view, again, for one connection.
  const resend = (connection, why) => {
    if (now() - connection.resyncAt < RESYNC_GAP_MS) return;
    connection.resyncAt = now();
    connection.sent.clear();
    log("info", "a player is sent their whole view again", { player: connection.id, why });
    void pushViews();
  };
  // Views a page has not said it applied, long after they were sent.
  const checkAcks = () => {
    for (const connection of connections.values()) {
      if (connection.acked < connection.rev && now() - connection.lastAckAt >= VIEW_ACK_MS) {
        connection.lastAckAt = now();
        resend(connection, "no-ack");
      }
    }
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

  // The host's screen gone (a reload, a crash, its window closed): the round
  // waits for it, and goes on when it is back. A round the host had paused
  // itself stays paused. Before, the engine went on resolving rounds on the
  // host's AI key with nobody at the host's screen. `hostSeen`: the host's
  // screen has been here (it is not yet while the game opens).
  let hostSeen = false;
  let waitingForHost = false;
  const hostHere = () => [...connections.values()].some(isHost);
  const holdForHost = () => {
    if (stopped || !hostSeen || waitingForHost || hostHere()) return;
    const status = round.status();
    if (status.paused || !["planning", "countdown", "revealing"].includes(status.phase)) return;
    waitingForHost = true;
    round.pause();
    for (const connection of connections.values()) send(connection, notice("info", "The host's screen is away: the round waits until it is back."));
  };
  const hostReturned = () => {
    hostSeen = true;
    if (!waitingForHost) return;
    waitingForHost = false;
    round.resume();
    for (const connection of connections.values()) send(connection, notice("info", "The host is back: the round goes on."));
  };

  // The round last saved with the game.
  let savedRound = -1;
  const round = createRoundMachine({
    settings: roundSettingsOf(settings),
    now,
    timers,
    onChange: (status) => {
      const message = roundMessage(status);
      for (const connection of connections.values()) send(connection, message);
      onStatus({ lobby: lobbyFor(null), round: status });
      // Where the rounds are is saved with the game, to be taken up there again.
      if (roundToPlan(status) !== savedRound) {
        savedRound = roundToPlan(status);
        sessionChanged();
      }
      // A round that comes to be planned or read while the host's screen is
      // gone waits for it too.
      holdForHost();
    },
    // The round is one entry in the queue: it starts once whatever was being
    // applied is done, and nothing else is applied until it has landed.
    onResolve: ({ round: number }) => queue.run("round", async () => {
      await recordHumans();
      const start = await store.read();
      const before = { eventIds: new Set(list(start.events).map((event) => clean(event?.id))), areas: { ...(start.world?.groupAreas ?? {}) } };
      roundAbort = new AbortController();
      try {
        await resolveRound({ round: number, humanCountries: seats.humanCountries(), daysPerRound: settings.daysPerRound, signal: roundAbort.signal });
      } catch (error) {
        // Said to everyone, with why: a round that failed used to go back to
        // planning without a word, and fail again twenty minutes later.
        if (!stopped) {
          const why = clean(error?.message || error).slice(0, 280) || "the host's AI did not answer.";
          log("warn", "the round could not be resolved", { round: number, error: why });
          for (const connection of connections.values()) {
            send(connection, notice("warn", `Round ${number} could not be resolved: ${why} Its orders are still queued, and the host can end the round again.`));
          }
        }
        throw error;
      } finally {
        roundAbort = null;
      }
      await followSeats(before).catch((error) => log("warn", "a seat did not follow its country", { error: String(error?.message || error) }));
    }),
  });

  // What became of the countries people play this round, read from the game's
  // own records (host/foundings.js), and the seats moved in one place for all
  // of it: a seat whose people founded a country and gave it their land, or
  // whose country was renamed, follows it, with its queued orders, its board,
  // its agents and its threads, and the game remembers the old name
  // (game.seatFoundings), so what that government knew is still theirs to
  // read (host/projection.js). Before, a rename moved the country's army and
  // records to the new name and left its player's seat on the old one: the AI
  // took the country, and the player played nothing. A seat whose country is
  // gone (dissolved or annexed) is let go, and its player stays to watch or
  // takes any free country (the owner's decision 11). Every seat is looked at,
  // whoever minds it this round: a player who is away, or whose country the AI
  // minds, holds their seat still. Run when a round lands (`before`: the event
  // ids and the groups' areas it started with), and when a saved session is
  // taken up again (no `before`: whatever became of its countries meanwhile,
  // the game played alone, is read from the world as it is).
  const followSeats = async (before = null) => {
    const docs = await store.read();
    const held = seats.list();
    const founded = before
      ? seatFoundings({
        events: list(docs.events).filter((event) => !before.eventIds.has(clean(event?.id))),
        actions: docs.actions,
        seated: held.filter((seat) => seat.device).map((seat) => seat.country),
        host: hostCountry,
        areas: before.areas,
      }).map((move) => ({ ...move, why: "founded" }))
      : [];
    const moving = new Set(founded.map((move) => fold(move.from)));
    const after = countriesOf ? countriesOf(docs).map(clean).filter(Boolean) : null;
    const successions = seatSuccessions({
      world: docs.world,
      seated: held.map((seat) => seat.country).filter((country) => !moving.has(fold(country))),
      countries: after,
    });
    const moves = [...founded, ...successions.renamed.map((move) => ({ ...move, why: "renamed" }))]
      .filter((move) => seats.move(move.from, move.to));
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
      log("info", move.why === "founded" ? "a seat followed its people to the country they founded" : "a seat followed its country to its new name", { from: move.from, to: move.to });
      // Told to the player whose seat moved; everyone sees the lobby change.
      const device = seats.list().find((seat) => same(seat.country, move.to))?.device;
      const text = move.why === "founded"
        ? `${move.from} has founded ${move.to}: you now play ${move.to}.`
        : `${move.from} is now called ${move.to}: you play it as before.`;
      for (const connection of connections.values()) {
        if (device && connection.device === device) send(connection, notice("info", text));
      }
    }
    for (const country of successions.gone) {
      if (same(country, hostCountry)) {
        // The host's own country: the host keeps the game, and is told.
        for (const connection of connections.values()) {
          if (isHost(connection)) send(connection, notice("warn", `${country} is gone. As the host you keep the game; you can stop sharing it, or go on watching.`));
        }
        continue;
      }
      // The book keeps its player in the game, watching it (host/seats.js).
      const seat = seats.vanish(country);
      if (!seat?.device) continue;
      log("info", "a seat's country is gone; its player watches", { country });
      for (const connection of connections.values()) {
        if (connection.device === seat.device) send(connection, notice("warn", `${country} is gone. You can take any free country under Players, or stay to watch.`));
      }
    }
    if (after) {
      countriesNow = after;
      seats.setCountries(countriesNow);
    }
    if (moves.length) onSeatsMoved(moves.map(({ from, to, host }) => ({ from, to, host })));
    if (moves.length || successions.gone.length || after) await seatsChanged({ inEntry: true });
  };

  // Who plays what changed: the round counts its players again, everyone is
  // sent the lobby, and the game records who is human, in the queue's order.
  // `inEntry`: called from inside an entry, which records it itself.
  const seatsChanged = async ({ inEntry = false } = {}) => {
    // A connection closing after the game stopped changes nothing.
    if (stopped) return;
    round.setPlayers(present());
    broadcastLobby();
    sessionChanged();
    if (inEntry) await recordHumans();
    else await queue.run("who-plays-what", recordHumans);
  };

  // --- Requests ------------------------------------------------------------------

  // Orders, and everything else a player does to the world, are taken from
  // the start of the game. One given while a round is being resolved waits in
  // the queue behind it and is the next round's: the queue, not a check of the
  // phase on the way in, is what keeps it from the round already under way.
  const started = () => round.status().phase !== "lobby";

  // The AI governments at a table answer a person's line on the host's own AI
  // key (settings.replies "host", and an institution's table always), one
  // answer at a time for each table: two at once each wrote the thread from
  // what it had read, and the second's writing dropped the first's lines.
  // Someone who writes again while their answer is still waiting is answered
  // once, for all they have written by then. When the host's AI could not be
  // reached the writer is told, or their line just went unanswered.
  const answerOnHost = (chatId, seat, governments) => {
    const table = tables.get(chatId) ?? { tail: Promise.resolve(), waiting: new Set() };
    tables.set(chatId, table);
    const who = fold(seat);
    if (table.waiting.has(who)) return;
    table.waiting.add(who);
    const turn = table.tail.then(async () => {
      if (stopped) return;
      table.waiting.delete(who);
      const outcome = await replyTo({ chatId, seat });
      // (Its writing was an entry in the queue: every view follows on its own.)
      if (outcome?.unreachable) {
        tell(seat, "warn", `The host's AI could not be reached: ${governments.join(", ")} did not answer. Write again to ask once more.`.slice(0, 500));
      }
    }).catch((error) => {
      table.waiting.delete(who);
      log("warn", "reply failed", { error: String(error?.message || error) });
    }).finally(() => {
      if (table.tail === turn) tables.delete(chatId);
    });
    table.tail = turn;
  };

  // A line left to its writer's own device to answer.
  const awaitOwnReply = (line, entry) => {
    ownLines.set(line, entry);
    while (ownLines.size > OWN_LINES_KEPT) ownLines.delete(ownLines.keys().next().value);
  };

  const handlers = {
    // A country taken. Once the game is under way a seated player's change of
    // country is asked of the host (the owner's decision 12): it waits in the
    // host's Players list; a player whose country is gone takes any free one.
    pick: async (connection, { country }) => {
      if (isHost(connection)) return "The host plays its own game's country.";
      const wanted = clean(country);
      const mine = seats.seatOf(connection.device);
      if (seats.started && mine && !same(mine.country, wanted)) {
        if (!countriesNow.some((known) => same(known, wanted))) return "not-a-country";
        changes.set(connection.device, { device: connection.device, name: connection.name, from: mine.country, to: wanted });
        broadcastLobby();
        sessionChanged();
        for (const other of connections.values()) {
          if (isHost(other)) send(other, notice("info", `${mine.country}'s player asks to play ${wanted}. Allow it or refuse it under Players.`));
        }
        return { error: "", result: { asked: wanted.slice(0, 160) } };
      }
      const result = seats.claim(wanted, { device: connection.device, name: connection.name });
      if (!result.ok) return result.reason;
      changes.delete(connection.device);
      connection.sent.clear();
      await seatsChanged({ inEntry: true });
      return "";
    },
    unpick: async (connection) => {
      if (isHost(connection)) return "The host plays its own game's country.";
      if (seats.started) return "Ask the host to change your country.";
      if (!seats.unclaim(connection.device)) return "You have no country to give back.";
      connection.sent.clear();
      await seatsChanged({ inEntry: true });
      return "";
    },
    ready: async (connection, { value }, seat) => (round.setReady(seat.country, value) ? "" : "Not now: the round is not being planned."),
    // A player has read a round through. Counted for the round it names only:
    // reading round 3 to the end while round 4 was resolved counted for round
    // 4, whose reveal then ended as it began.
    revealed: async (connection, message, seat) => {
      round.revealedBy(seat.country, message.round);
      return "";
    },
    order: async (connection, { text }, seat) => {
      if (!started()) return "Orders are taken while a round is being planned.";
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
      if (!started()) return "Orders can be withdrawn while a round is being planned.";
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
      if (!started()) return "Formations are raised while a round is being planned.";
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
      if (!started()) return "Formations are stood down while a round is being planned.";
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
    // it is taken at any time.
    settle: async (connection, { marker, move, lng, lat }, seat) => {
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
    // round is resolved.
    warroom: async (connection, { op }, seat) => {
      const sent = cleanWarRoomOp(op);
      if (!sent) return "Nothing was asked.";
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const result = applyWarRoomOp(world?.battlefields, sent, { player: seat.country, date: clean(game?.gameDate), transports: world?.transports, era: eraSettingOf(world), media: activeTransportMedia(), military: transportFiguresOf(world, seat.country) });
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
    // to the host's own map (readChart), read in the same entry as the write:
    // a line is built and a fleet sails as time passes.
    fortify: async (connection, { op }, seat) => {
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
    // The war room's air strikes (runtime/fronts/airStrikeOps.js), by the same
    // rule: the air unit must be the seat's country's, and a city struck is held
    // to the host's own map. Flown when the round is resolved.
    airstrike: async (connection, { op }, seat) => {
      const sent = cleanAirStrikeOp(op);
      if (!sent) return "Nothing was asked.";
      const chart = sent.op === "airstrike" && sent.kind === "city" ? await Promise.resolve().then(readChart).catch(() => null) : null;
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const result = applyAirStrikeOp(world, sent, { player: seat.country, date: clean(game?.gameDate), round: game?.round, chart, air: activeWars().air });
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
      if (!started()) return "Agents take orders while a round is being planned.";
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const mine = same(seat.country, hostCountry);
        const boards = isRecord(world?.seatBoards) ? world.seatBoards : {};
        const key = Object.keys(boards).find((country) => same(country, seat.country));
        const board = mine ? list(world?.projects) : list(key ? boards[key] : []);
        const result = agentOrderFor(world, board, seat.country, request, {
          host: hostCountry,
          date: clean(game?.gameDate),
          known: (name) => countriesNow.some((country) => same(country, name))
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
    // answer waits for the writing, so the pane can say why when it fails. The
    // model is asked outside the queue; the sheet is written under the game's
    // own lock, which a round being resolved holds (gameplay.js beginStatsWrite).
    sheet: async (connection, { country, fresh }, seat) => {
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
    // message says.
    peace: async (connection, { op, ref, terms }, seat) => {
      let refusal = "";
      // (A peace taken may annex a country or cede regions by name: they are found on the map.)
      const map = op === "accept"
        ? await Promise.all([import("../../runtime/assets.js"), import("../../Game/AI/promptContext.js")])
          .then(async ([assets, context]) => ({ catalog: await assets.loadRegionCatalog(), rendered: context.filterToRenderedRegions }))
          .catch(() => null)
        : null;
      await store.updateForces(({ world, game }) => {
        const regions = map ? map.rendered(map.catalog, world) : [];
        const outcome = playerDiplomacy(world, { op, ref, terms, country: seat.country, players: humanCountriesOf(game), date: clean(game?.gameDate), round: game?.round, regions });
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
      // The game's own rule for a standing goal (runtime/playerGoal.js).
      await store.updateWorld((world) => withPlayerGoal(world, seat.country, text));
      round.touch(seat.country);
      return "";
    },
    // A post on Rostra (runtime/socialFeed.js), written as the leader of the
    // seat's own country by the game's own rule, and dated by the game. It is
    // public: every view carries the feed.
    post: async (connection, { text, quote, choices }, seat) => {
      if (!isActiveFeatureEnabled("socialMedia")) return "This game has no social media.";
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const made = withPlayerPost(world, {
          by: seat.country,
          text,
          quote,
          // A poll's choices, when the post asks one.
          choices: Array.isArray(choices) && choices.length ? choices : null,
          date: clean(game?.gameDate),
          round: Number(game?.round) || 0,
        });
        if (made.error) {
          refusal = made.error;
          return null;
        }
        return { world: made.world };
      });
      round.touch(seat.country);
      return refusal;
    },
    // The player's own Projects board, whole, as their screen has just changed
    // it: their advisor's entries, or the board's own buttons. A board is a
    // government's working papers, so it may be changed at any time.
    board: async (connection, { projects }, seat) => {
      if (!Array.isArray(projects)) return "A board is a list of projects.";
      await store.updateWorld((world) => withSeatBoard(world, seat.country, projects, { host: hostCountry }));
      round.touch(seat.country);
      return "";
    },
    // An institution's business, done for this seat's country by the game's
    // own institution functions (host/institutions.js), which check that the
    // country may do it. A Council's or a hearing's turn asks the AI, so the
    // call is made outside the queue and each of its writes is an entry in it
    // (engineMain.js). What was made goes back with the ack, so the asker's
    // screen can show it.
    institution: async (connection, { call, args }, seat) => {
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
    // What the page did with a view. A view it applied is one the host need
    // not send again; one it could not apply is answered with the whole view.
    // A word about an earlier connection's views is about views this one never
    // sent, and this connection began with a whole view of its own: it is let
    // be (the wait for the page's word, checkAcks, covers a page that never
    // had that one).
    viewed: async (connection, { epoch, rev, ok }) => {
      if (epoch !== connection.epoch) return "";
      if (!ok) {
        resend(connection, "not-applied");
        return "";
      }
      if (rev > connection.acked) {
        connection.acked = rev;
        connection.lastAckAt = now();
      }
      return "";
    },
    say: async (connection, { thread, to, text, fromDraft }, seat) => {
      const body = clean(text);
      if (!body) return "A message needs words.";
      const recipients = list(to).map(clean).filter(Boolean);
      if (!thread && !recipients.length) return "Say it to someone.";
      if (recipients.some((country) => same(country, seat.country))) return "A government does not write to itself.";
      if (recipients.some((country) => !countriesNow.some((known) => same(known, country)))) return "Unknown country.";
      // A letter written while a round is being resolved waits in the queue
      // behind it, and is the next round's.
      const people = seats.humanCountries();
      const playedByAi = (name) => name && !same(name, seat.country) && !people.some((human) => same(human, name));
      // Dated by the game, as a government's own reply is (chat.jsx `time`):
      // a letter between people was shown with no date at all.
      const docs = await store.read();
      const gameDate = clean(docs?.game?.gameDate);
      let chatId = clean(thread);
      const opens = !chatId;
      let refusal = "";
      let institutional = false;
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
        // The advisor's drafted letter it was sent from, as the player's own
        // screen sends it (GameUI/advisorDrafts.js): that draft then says it went.
        ...(clean(fromDraft) ? { fromDraft: clean(fromDraft) } : {}),
      };
      await store.updateChats((chats) => {
        const all = list(chats);
        if (chatId) {
          const index = all.findIndex((chat) => clean(chat?.id) === chatId);
          const chat = all[index];
          // A thread's owner is chat.player, or the host's seat when blank.
          const owner = chat ? clean(chat.player) || hostCountry : "";
          const members = membersOf(chat);
          const inIt = chat && (same(owner, seat.country) || members.some((name) => same(name, seat.country)));
          if (!inIt) {
            refusal = "You are not in that conversation.";
            return null;
          }
          parties = [owner, ...members];
          institutional = isInstitutionThread(chat);
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
      const governments = parties.filter(playedByAi)
        .filter((name, index, all) => all.findIndex((other) => same(other, name)) === index);
      // A thread opened by this line goes back with the ack, so the screen
      // that began it can open it as soon as its view holds it
      // (client/sharedThreads.js).
      const result = opens ? { chatId } : {};
      if (governments.length) {
        // Some answers do more than speak, and only the host's own game can
        // carry them out: an institution's table votes and decides in its
        // answer, and a government at war with the writer may make peace in
        // its own, or accept the writer's terms (AI/warStatsPrompt.js
        // describePeaceTalk, which asks the same of the same wars). Those are
        // answered here, whatever the setting.
        const decides = institutional || governments.some((name) => Boolean(warBetween(docs?.world?.wars, name, seat.country)));
        if (replies === "own" && !decides) {
          // The writer's own device answers, on its own AI key: the ack says
          // so, with the line it is to answer and the governments that do
          // (client/ownReplies.js). The words come back as a "reply".
          awaitOwnReply(message.id, { thread: chatId, seat: seat.country });
          Object.assign(result, { answer: "own", line: message.id, governments: governments.slice(0, 16) });
        } else answerOnHost(chatId, seat.country, governments);
      }
      return Object.keys(result).length ? { error: "", result } : "";
    },
    // With settings.replies "own": what the governments the AI plays answered
    // a line of this seat's, written on the seat's own device and AI key. Words
    // alone, taken for a line the host itself left to that device ("say"),
    // once, and only from governments at that table that nobody plays; the
    // host gives each line its id and its date, as it does a person's own. No
    // key comes with it, and nothing a government "agrees" in it is carried
    // out here: the round's own skip reads the conversation, as it reads any.
    reply: async (connection, { thread, line, lines }, seat) => {
      const waiting = ownLines.get(clean(line));
      if (!waiting || waiting.thread !== clean(thread) || !same(waiting.seat, seat.country)) {
        return "That line is not waiting for an answer from your device.";
      }
      const said = list(lines)
        .map((entry) => ({ speaker: clean(entry?.speaker), text: wordsOf(entry?.text) }))
        .filter((entry) => entry.speaker && entry.text);
      if (!said.length) return "An answer needs words.";
      const gameDate = clean((await store.read())?.game?.gameDate);
      const people = seats.humanCountries();
      let refusal = "";
      let written = [];
      await store.updateChats((chats) => {
        const all = list(chats);
        const index = all.findIndex((chat) => clean(chat?.id) === waiting.thread);
        const chat = all[index];
        const owner = chat ? clean(chat.player) || hostCountry : "";
        const members = membersOf(chat);
        if (!chat || !(same(owner, seat.country) || members.some((name) => same(name, seat.country)))) {
          refusal = "You are not in that conversation.";
          return null;
        }
        if (isInstitutionThread(chat)) {
          refusal = "An institution's table is answered on the host's computer.";
          return null;
        }
        // Only a government at this table that nobody plays is answered for,
        // under its own name as the thread has it.
        const governments = [owner, ...members].filter((name) => name && !same(name, seat.country) && !people.some((human) => same(human, name)));
        written = said.flatMap((entry) => {
          const name = governments.find((government) => same(government, entry.speaker));
          return name
            ? [{ id: mintId("message", now), role: "leader", speaker: name, code: name, text: entry.text, ...(gameDate ? { time: gameDate } : {}) }]
            : [];
        });
        if (!written.length) {
          refusal = "None of those governments is the AI's to play at that table.";
          return null;
        }
        const next = [...all];
        next[index] = { ...chat, messages: [...list(chat.messages), ...written] };
        return next;
      });
      if (refusal) return refusal;
      ownLines.delete(clean(line));
      round.touch(seat.country);
      // Whose device wrote these governments' words is the host's to know.
      log("info", "a player's own device answered for the AI's governments", { seat: seat.country, thread: waiting.thread, governments: written.map((entry) => entry.speaker) });
      return "";
    },
  };

  // People in without a seat (there to take one), other than `device`.
  const waitingFor = (device) => new Set([...connections.values()].map((entry) => entry.device)
    .filter((other) => other && other !== device && !seats.seatOf(other) && !seats.watcherOf(other))).size;

  // An answer for a device, on whichever connection it has now: a request
  // waiting behind a round may be answered after its player reconnected.
  const answerDevice = (device, message) => {
    for (const connection of connections.values()) if (connection.device === device) send(connection, message);
  };

  const receive = async (player, message) => {
    const connection = connections.get(player.id);
    if (!connection || stopped) return;
    const handler = handlers[message?.t];
    if (!handler) return;
    const id = clean(message?.id);
    // A request sent again (the page resends what was not answered before a
    // reconnect) is applied once, and answered as the first time; one still
    // being applied is answered when it is.
    const mine = answers.get(connection.device) ?? new Map();
    if (id) {
      answers.set(connection.device, mine);
      if (mine.has(id)) {
        const earlier = mine.get(id);
        if (earlier) send(connection, earlier);
        return;
      }
      mine.set(id, null);
      while (mine.size > ANSWERS_KEPT) mine.delete(mine.keys().next().value);
    }
    const seat = seatOf(connection);
    const needsSeat = !["pick", "unpick"].includes(message.t);
    let error = "";
    let result = null;
    if (needsSeat && (!seat || seat.status !== SEAT_STATUS.HUMAN)) error = "Take a country first.";
    else {
      try {
        // A refusal's words, or { error, result } from a request that made
        // something. A change to the world is an entry in the queue; what
        // changes nothing, or only asks the AI, is not.
        const apply = () => handler(connection, message, seat);
        const outcome = await (AT_ONCE.has(message.t) || THINKING.has(message.t) ? apply() : queue.run(message.t, apply));
        if (outcome && typeof outcome === "object") {
          error = clean(outcome.error).slice(0, 300);
          result = outcome.result && Object.keys(outcome.result).length ? outcome.result : null;
        } else error = clean(outcome).slice(0, 300);
      } catch (failure) {
        log("warn", "request failed", { t: message.t, error: String(failure?.message || failure) });
        error = "The host could not do that.";
      }
    }
    if (id) {
      const ack = { t: "ack", id, ok: !error, error: error || null, ...(result && !error ? { result } : {}) };
      mine.set(id, ack);
      answerDevice(connection.device, ack);
    }
    // What changed of the session (a line left to a device, one answered).
    if (!error && ["say", "reply"].includes(message.t)) sessionChanged();
    if (!error && !AT_ONCE.has(message.t)) await schedulePush();
  };

  return {
    // A player's connection (session/host.js onJoin, or the host's own screen).
    join(player) {
      if (stopped || banned.has(player.device)) return;
      // A new connection, a new name for its views: the page starts again from a
      // whole view, whatever it held before.
      connections.set(player.id, {
        id: player.id, device: player.device, name: player.name,
        epoch: mintEpoch(now), rev: 0, sent: new Map(), sums: new Map(), acked: 0, lastAckAt: now(), resyncAt: 0,
      });
      const seat = seats.seatOf(player.device);
      if (seat && seat.status !== SEAT_STATUS.HUMAN) seats.returned(player.device, { name: player.name });
      const connection = connections.get(player.id);
      send(connection, lobbyFor(connection));
      if (isHost(connection)) hostReturned();
      send(connection, roundMessage(round.status()));
      void seatsChanged();
    },
    leave(player) {
      const connection = connections.get(player.id);
      if (!connection) return;
      connections.delete(player.id);
      // Another connection of the same device (a reconnect) keeps the seat.
      if ([...connections.values()].some((entry) => entry.device === connection.device)) return;
      // The host's own seat is the host's for as long as the game runs: the
      // round waits for its screen to come back.
      if (isHost(connection)) {
        holdForHost();
        return;
      }
      seats.left(connection.device);
      void seatsChanged();
    },
    receive,
    // The host's own controls, from the host's own screen only.
    control: {
      async start() {
        if (seats.started) return;
        seats.start();
        await queue.run("start", recordHumans);
        round.start();
        broadcastLobby();
      },
      pause: () => round.pause(),
      resume: () => round.resume(),
      resolveNow: () => round.resolveNow(),
      setRoundMinutes: (minutes) => round.setRoundMinutes(minutes),
      // Who answers a player's message to a government the AI plays, from here
      // on (settings.js `replies`). A line already left to its writer's device
      // is still answered from there; an answer the host has begun is finished.
      setReplies(mode) {
        if (!REPLY_MODES.includes(mode) || mode === replies) return false;
        replies = mode;
        broadcastLobby();
        const text = mode === "own"
          ? "From now on each player's own AI answers the messages they write to countries the AI plays."
          : "From now on the host's AI answers the messages written to countries the AI plays.";
        for (const connection of connections.values()) send(connection, notice("info", text));
        return true;
      },
      // The host takes a country back from its player, or lets go of a player
      // who watches a country that is gone; with `ban` that device is kept out
      // of this game for good (saved with it). Returns the device.
      kick(country, { ban = false } = {}) {
        const named = seats.list().find((entry) => same(entry.country, country))?.country
          ?? seats.watching().find((entry) => same(entry.was, country))?.was;
        if (!named || same(named, hostCountry)) return null;
        const device = seats.release(named);
        if (device) {
          changes.delete(device);
          if (ban) banned.add(device);
        }
        void seatsChanged();
        return device;
      },
      // A player's change of country, as the host decides it (the owner's
      // decision 12): `allow` gives them the country they asked for and frees
      // their old one; `refuse` keeps them where they are. `from`: the
      // country the asking player plays now.
      async seat({ op, from }) {
        const change = [...changes.values()].find((entry) => same(entry.from, from));
        if (!change) return false;
        changes.delete(change.device);
        const tellPlayer = (text) => {
          for (const connection of connections.values()) if (connection.device === change.device) send(connection, notice("info", text));
        };
        if (op !== "allow") {
          tellPlayer(`The host keeps you as ${change.from}.`);
          broadcastLobby();
          sessionChanged();
          return true;
        }
        const done = await queue.run("change-of-country", async () => {
          const result = seats.claim(change.to, { device: change.device, name: change.name, approved: true });
          if (!result.ok) return result.reason;
          for (const connection of connections.values()) if (connection.device === change.device) connection.sent.clear();
          await seatsChanged({ inEntry: true });
          return "";
        });
        if (done) {
          tellPlayer(done === "taken" ? `You could not be moved to ${change.to}: another player holds it.` : `You could not be moved to ${change.to}.`);
          broadcastLobby();
          sessionChanged();
          return false;
        }
        tellPlayer(`The host let you play ${change.to}.`);
        return true;
      },
    },
    start() {
      // A game taken up again: its seats checked against the world as it is
      // now, and its rounds go on from the one it was at.
      if (restored) {
        void queue.run("session-taken-up", () => followSeats())
          .catch((error) => log("warn", "a saved seat did not follow its country", { error: String(error?.message || error) }));
      }
      if (restored?.started) {
        round.resumeAt(restored.round);
        // Paused until the host resumes it: its players come back one by one,
        // and a round left to run meanwhile would end on the host alone.
        round.pause();
      }
      expiryTimer = timers.setInterval(() => {
        checkAcks();
        const handed = seats.expire();
        if (!handed.length) return;
        for (const connection of connections.values()) {
          send(connection, notice("info", `${handed.join(", ")} ${handed.length === 1 ? "is" : "are"} now played by the AI.`));
        }
        void seatsChanged();
      }, 15_000);
    },
    // The game is single player again: nobody is played by a person but the
    // host, and the AI plays every other country as before. A round under way
    // is stopped, and what was waiting is applied first.
    async stop() {
      stopped = true;
      timers.clearInterval(expiryTimer);
      round.stop();
      roundAbort?.abort(new Error("The shared game was stopped."));
      await pushing.catch(() => {});
      await queue.run("end", forgetHumans).catch((error) => log("warn", "the shared game's players were not cleared", { error: String(error?.message || error) }));
    },
    pushViews,
    // Whether a device is banned from this game (session/host.js isBanned).
    isBanned: (device) => banned.has(device),
    // Whether a device may come in (session/host.js roomFor): a player in the
    // game always may, however many have come meanwhile; anyone else while
    // the game has a seat for them beside those in it and those already in
    // without one (host/seats.js hasRoom).
    roomFor: (device) => !stopped && !banned.has(device) && seats.hasRoom(device, { waiting: waitingFor(device) }),
    // Seats a newcomer could take, for the lobby's beacon.
    openSeats: () => seats.open({ waiting: waitingFor("") }),
    // A change made outside a request (an AI government's answer being
    // written, an institution's business): applied in the queue's order, and
    // every view follows.
    write: (label, fn) => queue.run(label, fn),
    status: () => ({ lobby: lobbyFor(null), round: round.status(), players: [...connections.values()].map((entry) => ({ id: entry.id, name: entry.name, seat: seatOf(entry)?.country ?? "" })) }),
  };
};
