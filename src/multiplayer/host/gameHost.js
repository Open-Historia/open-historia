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
import { formerNamesOf, groundHeldBy, seatFoundings, seatSuccessions, withGameCountryChanged, withSeatLetGo, withSeatMoved } from "./foundings.js";
import { holdSeatRecords, returnSeatRecords } from "./heldSeats.js";
import { sessionRecordOf } from "./sessionRecord.js";
import { DEFAULT_SETTINGS, REPLY_MODES, gameMasterAllowed, roundSettingsOf } from "./settings.js";
import { createHostAnswers, hostAnswersSpent, hostTurnsSpent } from "./hostAnswers.js";
import { createRoundPayers } from "./roundPayers.js";
import { GAME_MASTER_COMMAND_MAX, gameMasterEntryOf, gameMasterNotice, keptGameMasterLog, withGameMasterEntry } from "./gameMaster.js";
import { projectForViewer } from "./projection.js";
import { COUNTRY_MAX_CHARS, HOST_MESSAGES, ORDER_MAX_CHARS, ORDER_TITLE_MAX, THREAD_MEMBERS_MAX, THREAD_TITLE_MAX, VIEW_KEYS } from "../game/messages.js";
import { createPlayerPollEvent, eventsFromLegacyChat, projectChatThread } from "../../runtime/chatThreads.js";
import { openDemandOf, playerAnswerEvent, playerDemandEvent } from "../../runtime/demandCheck.js";
import { livePuppetsFor } from "../../runtime/puppets.js";
import { validate } from "../protocol/validate.js";
import { digestText } from "../protocol/digest.js";
import { withGoalProgress, withPlayerGoal } from "../../runtime/playerGoal.js";
import { normalizeSocialFeed, withPlayerPost } from "../../runtime/socialFeed.js";
import { applyProjectOpsToWorld, normalizeProjects } from "../../runtime/gameState.js";
import { seatProjectOps } from "./seatProjects.js";
import { deployFor, disbandFor, revertOrderFor } from "./forces.js";
import { orderCapRefusal } from "./orderCap.js";
import { huntSeenBy, opaqueId, withFleetOrdered, withLineGivenUp, withOrdersSeen, withRenamed } from "./onlyOrdered.js";
import { agentOrderFor } from "./agents.js";
import { institutionThreadRefusal } from "./institutions.js";
import { acceptStructure, canSettleStructure, moveStructure, structureMoveRefusal } from "../../runtime/structurePlacement.js";
import { applyWarRoomOp, cleanWarRoomOp } from "../../runtime/fronts/warRoomOps.js";
import { applyFortifyOp, cleanFortifyOp } from "../../runtime/fronts/fortifyOps.js";
import { applyFleetOp, cleanFleetOp } from "../../runtime/naval/fleetOps.js";
import { applyAirStrikeOp, cleanAirStrikeOp } from "../../runtime/fronts/airStrikeOps.js";
import { frontCitiesOf } from "../../runtime/frontCities.js";
import { activeTransportMedia, activeWars, isActiveFeatureEnabled } from "../../runtime/gameFeatures.js";
import { transportFiguresOf } from "../../runtime/militaryStats.js";
import { eraSettingOf } from "../../runtime/warSettings.js";
import { humanCountriesOf } from "../../runtime/humanPolities.js";
import { playerDiplomacy } from "../../Game/AI/warAndPeace.js";
import { unratedOf } from "../../Game/AI/militaryRating.js";
import { warBetween } from "../../runtime/peaceTerms.js";
import { answerTreaty, proposeTreaty } from "../../runtime/treatyOffers.js";
import { featureRefusal } from "./featureGates.js";
import { regionOwnerNow } from "../../runtime/gmAnnex.js";
import { landingNotice, tellLandings } from "./landings.js";
import { votesAwaited } from "./tableTurn.js";
import { withAdvisorChanges } from "../game/advisorChanges.js";
import { advisorOfSeat, withSeatAdvisor } from "../../runtime/seatAdvisors.js";
import { createRequestWaits } from "./requestWaits.js";

export const MAX_ORDERS_PER_ROUND = 12;
// The answers a device's requests were given, kept so that one sent again (the
// page sends again what was not answered before a reconnect) is applied once
// and answered as it was the first time.
const ANSWERS_KEPT = 128;
// Of those, the newest saved with the session for each device: what a page
// sends again after a reconnect is what it sent while it had no answer.
const ANSWERS_SAVED = 16;
// Answered at once, whatever is being applied: they change no document (the
// round's own state, or what a page did with a view), so a round being
// resolved never holds them up.
// A paying device's answer to the round's request, and its lookups, are part of
// the round being resolved, which is itself an entry of the queue: behind it
// they would wait for ever.
const AT_ONCE = new Set(["ready", "revealed", "viewed", "paid", "payLookup", "payAlive", "canPay"]);
// Judged by the device that sends them, not by a seat (host/roundPayers.js:
// only the device a request was sent to may answer it). A payer the host let
// go of had its answer refused for having no seat, and the round waited for ever.
const SEATLESS = new Set(["pick", "unpick", "paid", "payLookup", "payAlive", "canPay"]);
// Their thinking is the AI's, done outside the queue so it holds nobody up;
// what they write is put in the queue (a stat sheet under the game's own lock,
// an institution's business by the desk, engineMain.js).
const THINKING = new Set(["sheet", "parties", "institution", "ratings"]);
// With settings.replies "own": the most countries one "ratings" answer leaves
// to a device at a time (three of its requests). The ranking asks again for
// the rest when the figures come in, so the readings left to devices are not
// filled by one long list.
const RATINGS_LEFT_MOST = 60;
// With settings.replies "own": how long a reading left to one device is that
// device's alone (the page waits as long for a sheet or parties it writes:
// gameplayLazy.js SHEET_ANSWER_MS).
const READING_LEFT_MS = 5 * 60 * 1000;
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
// Why a seat's treaty was not put or answered (runtime/treatyOffers.js), in its words.
const TREATY_REFUSALS = Object.freeze({
  nobody: "Say which country the treaty is with.",
  "not-played": "A treaty is signed between two players: a country the AI plays makes its agreements in the story.",
  type: "Say what kind of treaty it is.",
  "at-war": "You are at war with them: make peace first.",
  open: "A treaty between you already waits for an answer.",
  "not-open": "This is no longer open.",
  "not-yours": "This is not yours to answer.",
  "maker-gone": "The player who made this offer does not play that country now.",
});
// Why a seat's answer about war and peace did nothing (warAndPeace.js playerDiplomacy), in its words.
const PEACE_REFUSALS = Object.freeze({
  "not-yours": "This is not yours to answer.",
  "maker-gone": "The player who made this offer does not play that country now.",
  played: "That side is led by another player: make peace with them in a chat.",
  crossed: "Another player fights on against you in this war, so no peace can take you out of it yet.",
  "no-war": "That war is over.",
  "not-in-war": "You are not in that war.",
});
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
// The demand event a line carries (game/messages.js "say" `demand`), by the
// game's own rules (runtime/demandCheck.js), or null when it may not be made:
// only in the one-on-one thread between the writer and the other side, made by
// an Overlord of its own Puppet, answered by the side that may answer.
const demandEventFor = (chat, { demand, seat, owner, members, world, message, gameDate }) => {
  const others = [owner, ...members].filter((name) => clean(name).toLowerCase() !== clean(seat).toLowerCase());
  if (others.length !== 1) return null;
  const other = others[0];
  const idFor = (prefix) => `${prefix}-${String(message.id).replace(/^message-/, "")}`;
  if (demand.op === "make") {
    const overlordOf = livePuppetsFor(world ?? {}, seat).some((row) => clean(row.overlord).toLowerCase() === clean(seat).toLowerCase()
      && clean(row.puppet).toLowerCase() === clean(other).toLowerCase());
    if (!overlordOf) return null;
    return playerDemandEvent({ player: seat, target: other, text: clean(demand.text) || (demand.text === undefined ? clean(message.text) : ""), openDemand: openDemandOf(chat), messageId: message.id, time: gameDate, idFor });
  }
  const projected = projectChatThread(list(chat.events).length ? list(chat.events) : eventsFromLegacyChat(chat));
  const held = list(projected.demands).find((entry) => clean(entry?.id) === clean(demand.demandId));
  return playerAnswerEvent({ demand: held, player: seat, answer: demand.answer, text: demand.text ?? "", time: gameDate, idFor });
};

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
  // What decides every round beyond the settings (host/hostRules.js
  // roundRulesOf): stated in the lobby; the host's engine says when it changes.
  rules = null,
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
  // The campaign's round (game.round) when the game is shared: the round
  // machine names the campaign's rounds (host/round.js, one round number).
  campaignRound = 0,
  // `store` reads and writes the game's documents (read, update*), and the
  // session's own record (writeShared).
  store,
  // The round's time skip, for everyone at once. `signal` ends it when the
  // shared game is stopped meanwhile.
  resolveRound = async () => {},
  replyTo = async () => {},
  // Write a country's stat sheet (the game's own, on the host's AI key) when
  // it has none; rejects with the reason when it cannot.
  readCountry = async () => {},
  // Whether a country has its figures: a whole sheet, which stands.
  hasSheet = async () => false,
  // Take a sheet a player's own device wrote ({ country, sheet, continuity,
  // rating }): resolves { taken } (false when the country had its figures
  // already), or rejects with the reason when it is no whole sheet.
  takeSheet = async () => ({ taken: false }),
  // Countries' military figures rated on the host's AI (gameplay.js
  // ensureMilitaryFigures, twenty to a request, each country once a sitting),
  // and figures a player's own device rated, kept where a country had none
  // (gameplay.js takeMilitaryRatings): [{ name, military?, population? }].
  rateMilitary = async () => {},
  takeRatings = async () => [],
  // The host's own chart of the map (runtime/warRoomChart.js: where the sea
  // is, whose the ground), which the war room's fortified lines and fleets
  // are held to; resolves with null when the map could not be read.
  readChart = async () => null,
  // The map's cities file as the host's game serves it (GeoJSON), which a city
  // struck from the air is looked up on (runtime/frontCities.js): where it
  // stands and how many live there, never a page's count; resolves with null
  // when it could not be read.
  readCities = async () => null,
  // A country's parties filled in on the host's AI (gameplay.js
  // assessPoliticalLandscape), whether they are, and a reading of them a
  // player's own device made, taken when they still are not: { taken }.
  compileParties = async () => {},
  hasParties = async () => false,
  takeParties = async () => ({ taken: false }),
  // A country's flag set to an image (a data URL), or "" for the one it had,
  // as the game sets one (runtime/polityFlags.js setPolityFlag); rejects with
  // the reason when it cannot.
  setFlag = async () => {},
  // An institution's business for a seat (host/institutions.js): resolves
  // { institutionId, proposalId, chatId } or rejects with the reason. Given
  // `onTable(chatId, job)`, which runs a turn of a table in that table's turn.
  institution = async () => {
    throw new Error("Institutions are not run here.");
  },
  // The Game Master's command, run by the game's own console (gameplay.js
  // previewGameMasterCommand, then applyGameMasterPreview at once): resolves
  // { summary, ... } for what it changed, or rejects with the reason
  // (host/gameMaster.js). Asked only of a game whose settings allow it.
  gameMaster = async () => {
    throw new Error("The Game Master is not run here.");
  },
  onStatus = () => {},
  // Seats that followed their people to a country they founded
  // (host/foundings.js): [{ from, to, host }], `host` when it was the host's own
  // (and the host's own when its country was gone and it took another).
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
  if (restored) seats.restore(restored.seats ?? [], { hostDevice: hostSeat.device, watching: restored.watching ?? [], released: restored.released ?? [] });
  if (hostCountry && hostSeat.device) seats.claim(hostCountry, { device: hostSeat.device, name: hostSeat.name });
  if (restored?.started) seats.start();
  // The countries that may be taken now.
  let countriesNow = countries.map(clean).filter(Boolean);
  // What the host keeps in memory for a seat is kept by the seat's id
  // (host/seats.js), and its country read from the book when it is used: a
  // rename or a founding moves the seat, and everything kept for it follows
  // without being moved. Kept by the country's name, a player's own AI's
  // answer that came after a round renamed their country was refused, and a
  // change of country they had asked for named the old name.
  const seatNamed = (country) => seats.list().find((seat) => seat.device && same(seat.country, country)) ?? null;
  // Players who asked to change country, waiting for the host's word (the
  // owner's decision 12): device → { device, name, to }; the country they ask
  // from is the one their seat has now (changeFrom). One saved for a seat its
  // player no longer holds is let go.
  const changes = new Map((restored?.changes ?? [])
    .filter((entry) => same(seats.seatOf(entry.device)?.country, entry.from))
    .map((entry) => [entry.device, { device: entry.device, name: entry.name, to: entry.to }]));
  const changeFrom = (entry) => seats.seatOf(entry?.device)?.country ?? "";
  // Devices the host has banned from this game.
  const banned = new Set(restored?.banned ?? []);
  // playerId → { id, device, name, epoch, rev, sent: Map(key → json),
  // sums: Map(key → digest), acked, lastAckAt, resyncAt }
  const connections = new Map();
  // device → Map(request id → its ack, or null while it is being applied).
  // The latest of each device's are saved with the session (ANSWERS_SAVED):
  // a request applied just before the engine closed, and sent again by its
  // page when the game was shared again, was applied twice (a letter, a post,
  // a formation raised twice).
  const answers = new Map();
  for (const { device, ack } of restored?.answers ?? []) {
    if (!answers.has(device)) answers.set(device, new Map());
    answers.get(device).set(ack.id, ack);
  }
  let roundRules = rules && typeof rules === "object" ? { ...rules } : null;
  // Who answers a player's message to a government the AI plays (settings.js
  // `replies`): the host's computer, or the writer's own device. The host may
  // change it while the game runs (control.setReplies).
  let replies = REPLY_MODES.includes(settings.replies) ? settings.replies : "host";
  // With "own": the answers of the host's AI each player may have a round from
  // a government whose answer can act (settings.hostAnswers, host/hostAnswers.js).
  const hostAnswers = createHostAnswers({ limit: settings.hostAnswers });
  // The settings as they stand, the host's changes during the game included.
  const settingsNow = () => ({ ...settings, replies, hostAnswers: hostAnswers.limit });
  // With settings.payment "cycle": whose device makes each round's request
  // (host/roundPayers.js), and how many each has made, kept with the session.
  const payers = createRoundPayers({
    send: (device, message) => answerDevice(device, message),
    connected: (device) => [...connections.values()].some((entry) => entry.device === device),
    lastPayer: restored?.lastPayer ?? "",
    log,
    timers,
  });
  // What the Game Master changed, in this game (host/gameMaster.js): every
  // player's lobby carries it, and the session keeps it.
  let gameMasterLog = keptGameMasterLog(restored?.gameMaster);
  // "own": the lines whose answer their writer's device is writing: line id →
  // { thread, seat } (the seat's id). A "reply" is taken for one of these,
  // once, and for nothing else. Saved with the session under the seat's
  // country as it is then: one still waiting when the host closes is written
  // to again.
  const ownLines = new Map((restored?.ownLines ?? [])
    .map((entry) => [entry.line, { thread: entry.thread, seat: seatNamed(entry.seat)?.id ?? "" }])
    .filter(([, entry]) => entry.seat));
  // With settings.replies "own": the readings the host has left to a seat's own
  // device, by what and of which country ("sheet|France"), each to the seat it
  // was left to (its id). A reading is taken only from that seat, once, as a
  // reply is only from the device that line was left to (ownLines): any seat
  // could send any country's figures and parties, unasked, and the first stood
  // for the whole game (the gap audit of 2026-11-18).
  // A reading is left ONCE, to the first to ask, for READING_LEFT_MS: it was
  // left to whoever asked last, so two players opening one country both paid
  // for its sheet, and the first was told its figures were refused (the review
  // of 2026-11-18, cost 7). Another who asks meanwhile is told it is being
  // read elsewhere, and its screen shows it when the view brings it. One
  // whose device never sends it back (it failed, or closed) is let go when
  // its time is up, for the next to ask; until then it is still taken from
  // the seat it was left to.
  const ownReadings = new Map();
  const OWN_READINGS_KEPT = 256;
  const readingKey = (kind, country) => `${kind}|${fold(country)}`;
  // Whether the reading is now `seat`'s to make: false while another's.
  const leaveReading = (kind, country, seat) => {
    const key = readingKey(kind, country);
    const held = ownReadings.get(key);
    if (held && held.seat !== seat.id && held.until > now()) return false;
    ownReadings.delete(key);
    ownReadings.set(key, { seat: seat.id, until: now() + READING_LEFT_MS });
    while (ownReadings.size > OWN_READINGS_KEPT) ownReadings.delete(ownReadings.keys().next().value);
    return true;
  };
  const readingLeftTo = (kind, country, seat) => Boolean(seat.id) && ownReadings.get(readingKey(kind, country))?.seat === seat.id;
  // A country a person plays is read by that person's own device (or the
  // host's AI), never by another player's: a rival's figures are not another
  // player's to write first.
  const playedByAnother = (country, seat) => seats.humanCountries().some((human) => same(human, country) && !same(human, seat.country));
  // "host": the tables the host's AI is answering: thread id → { tail, waiting }.
  const tables = new Map();
  let expiryTimer = null;
  let stopped = false;
  let pushing = Promise.resolve();
  // The round being resolved, to stop if the shared game is.
  let roundAbort = null;
  // Set when the host calls the round off (control.cancelRound).
  let roundCancelled = false;
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
  // A request that waits for the round being resolved is said to at once, and
  // its page waits for its answer (host/requestWaits.js).
  const waits = createRequestWaits({ tell: (device, message) => answerDevice(device, message), thinking: THINKING });

  // The session as it stands, saved with the game (host/sessionRecord.js) at
  // once, one write at a time, once for however many changes asked while one
  // waited. The engine can be closed at any moment and the game shared again
  // later. It is no world document, and needs no place in the world's order:
  // written as an entry of the queue, a ban made while a round resolved was
  // saved only when the round landed, minutes later, and an engine closed
  // meanwhile gave the banned player their seat back.
  let sessionWanted = false;
  let sessionWriting = Promise.resolve();
  // The last of the game's events the seats have followed the world through
  // ("^": before any; "": unknown, a session kept before this was), saved
  // with the session: a round whose engine was closed after its turn was
  // written, before the seats followed it, or rounds the host played alone,
  // are read when the game is shared again, foundings and all (followSeats).
  let followedThrough = clean(restored?.followed);
  const lastEventMark = (events) => clean(list(events).at(-1)?.id) || "^";
  const eventsSince = (events, mark) => {
    if (mark === "^") return list(events);
    const at = mark ? list(events).findIndex((event) => clean(event?.id) === mark) : -1;
    return at < 0 ? [] : list(events).slice(at + 1);
  };
  // The round a game taken up again plans: one that has landed (being read)
  // is done, and the next is planned; one being planned or resolved had not
  // landed, and is planned again with its orders.
  // (A machine that follows the campaign's rounds, host/round.js, already
  // names the landed round while it is read: it is the next to plan.)
  const roundToPlan = (status) => (status.phase === "revealing" && !status.followsCampaign ? status.round + 1 : status.round);
  const sessionNow = () => sessionRecordOf({
    campaign,
    started: seats.started,
    round: roundToPlan(round.status()),
    hostDevice: hostSeat.device,
    seats: seats.list(),
    watching: seats.watching(),
    changes: [...changes.values()].map((entry) => ({ ...entry, from: changeFrom(entry) })),
    ownLines: [...ownLines].map(([line, entry]) => ({ line, thread: entry.thread, seat: seats.seatById(entry.seat)?.country ?? "" })),
    banned: [...banned],
    released: seats.released(),
    answers: [...answers].flatMap(([device, mine]) => [...mine.values()].filter(Boolean).slice(-ANSWERS_SAVED).map((ack) => ({ device, ack }))),
    followed: followedThrough,
    settings: settingsNow(),
    lastPayer: payers.record(),
    gameMaster: gameMasterLog,
  });
  const writeSession = () => {
    sessionWriting = sessionWriting.then(async () => {
      sessionWanted = false;
      await store.writeShared(sessionNow());
    }).catch((error) => log("warn", "the shared game's session was not saved", { error: String(error?.message || error) }));
    return sessionWriting;
  };
  const sessionChanged = () => {
    if (sessionWanted || stopped || !campaign || typeof store.writeShared !== "function") return;
    sessionWanted = true;
    void writeSession();
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
    settings: settingsNow(),
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
        // With settings.payment "cycle": whether its device takes its turn to pay.
        ...(settings.payment === "cycle" && seat.device ? { pays: payers.canPay(seat.device, hostSeat.device) } : {}),
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
      .map((entry) => ({ from: changeFrom(entry), to: entry.to, name: clean(entry.name).slice(0, 40) }))
      .filter((entry) => fits(entry.from) && fits(entry.to)).slice(0, 64),
    ...(features && typeof features === "object" ? { features } : {}),
    ...(roundRules ? { rules: roundRules } : {}),
    // What the Game Master changed, for every player to read (decision 8).
    ...(gameMasterLog.length ? { gameMaster: gameMasterLog } : {}),
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
    // Whose device makes this round's request, with settings.payment "cycle".
    ...(payingCountry(status) && fits(payingCountry(status)) ? { payer: payingCountry(status) } : {}),
  });
  // The country whose device pays the round being resolved, or is due to pay
  // the one being planned: the one the host took on itself, or the next in turn.
  const payerFor = (number) => (settings.payment === "cycle"
    ? payers.payerOf({ seats: seats.list().map((seat) => ({ ...seat, here: seat.status === SEAT_STATUS.HUMAN })), host: hostSeat.device, round: number })
    : null);
  const payingCountry = (status) => clean((payers.paying()?.round === status.round ? payers.paying() : payerFor(status.round))?.country);
  // Who pays in turn changed (a device said whether it can pay): every lobby
  // says it, and every round bar whose turn is next.
  const payersChanged = () => {
    broadcastLobby();
    const message = roundMessage(round.status());
    for (const connection of connections.values()) send(connection, message);
  };

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
  // A word for the player of a seat (its id), whatever its country is called by now.
  const tellSeat = (id, level, text) => {
    const device = seats.seatById(id)?.device;
    if (device) answerDevice(device, notice(level, text));
  };
  // A peace or a treaty that landed between rounds (host/landings.js), said to
  // every screen beside its event: before, only the one who answered knew.
  const tellEveryone = (landed) => {
    for (const event of list(landed)) {
      for (const connection of connections.values()) send(connection, notice("info", landingNotice(event)));
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
  // The host's own game is its own seat's once nobody shares it: what is
  // another person's (their queued orders, their threads, the events only
  // others know of) is held apart, unseen and undone, and given back when the
  // session is taken up again, before anything else (host/heldSeats.js). The
  // people are every seat a person's device holds, the AI's while away too.
  const holdForLater = () => store.updateGameDocs?.((docs) => {
    const people = seats.list().filter((seat) => seat.device).map((seat) => seat.country);
    const held = holdSeatRecords(docs, { host: hostCountry, readers: formerNamesOf(docs.game, hostCountry), people });
    if (!held.changed) return null;
    log("info", "what the other players left is held until the session is taken up again", { held: held.held });
    return { world: held.world, actions: held.actions, chats: held.chats, events: held.events };
  });
  const giveBackHeld = () => store.updateGameDocs?.((docs) => {
    const back = returnSeatRecords(docs);
    if (!back.changed) return null;
    log("info", "what the other players left waiting is theirs again", { returned: back.returned });
    return { world: back.world, actions: back.actions, chats: back.chats, events: back.events };
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
      if (status.phase === "resolving") waits.roundBegan();
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
      // Saved before the skip: an engine closed after its turn is written, and
      // before the seats follow it, finds this round's events after the mark.
      followedThrough = lastEventMark(start.events);
      sessionChanged();
      roundAbort = new AbortController();
      roundCancelled = false;
      // With settings.payment "cycle", the device whose turn it is pays: the
      // host's own makes the request as ever, and another's is sent the
      // request the engine builds, carries it to its own AI and sends back the
      // answer, which the engine takes as its own (host/roundPayers.js `carry`).
      const payer = payerFor(number);
      const carry = payer && payer.device !== hostSeat.device ? payers.carry({ ...payer, round: number, signal: roundAbort.signal }) : null;
      payers.begin(payer ? { ...payer, round: number } : null);
      // The skip is built under the paying device's own settings, as it stated them (no key).
      const paying = carry ? { carry, payer: { device: payer.device, rules: payers.profileOf(payer.device) } } : {};
      try {
        await resolveRound({ round: number, humanCountries: seats.humanCountries(), daysPerRound: settings.daysPerRound, signal: roundAbort.signal, ...paying });
      } catch (error) {
        // A payer whose device was asked for this round has taken its turn,
        // landed or not: run again, the round is the next payer's. Before, the
        // same device was asked every time and the round failed every time.
        if (payer && payers.missed(payer) && !stopped) {
          sessionChanged();
          for (const connection of connections.values()) {
            send(connection, notice("info", `${payer.country}'s turn to pay is taken: run again, round ${number} is paid by the next player in turn.`));
          }
        }
        // The host called it off (control.cancelRound): said as that, and the
        // round waits with its orders, as one that failed does.
        if (roundCancelled && !stopped) {
          log("info", "the host cancelled the round", { round: number });
          for (const connection of connections.values()) {
            send(connection, notice("info", `The host cancelled round ${number}. Its orders are still queued, and the host can run it again.`));
          }
          throw new Error("The host cancelled the round.");
        }
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
        payers.begin(null);
      }
      // The next round is the next seat's to pay (saved with the session), and
      // the host's taking a round on itself is spent.
      if (payer) {
        payers.landed(payer);
        sessionChanged();
      }
      await followSeats(before).catch((error) => log("warn", "a seat did not follow its country", { error: String(error?.message || error) }));
      // What was only ordered before the round is the world's now (host/onlyOrdered.js).
      await store.updateWorld(withOrdersSeen);
      // The campaign's round the skip wrote: the round machine names it from
      // here on (host/round.js, one round number).
      return { round: Number((await store.read())?.game?.round) || 0 };
    }),
  });

  // What became of the countries people play this round, read from the game's
  // own records (host/foundings.js), and the seats moved in one place for all
  // of it: a seat whose people founded a country and gave it their land, or
  // whose country was renamed, follows it, with its queued orders, its board,
  // its agents, its forces and what it built on the new country's ground, and
  // its threads, and the game remembers the old name
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
  // the game played alone, is read from the world as it is), and after every
  // entry that can change the world's polities between rounds: the Game
  // Master's, and a peace or a treaty landed (followLandings). A peace that
  // annexed a played country left its player seated on it until the next
  // round landed, giving orders the skip carried out for a country with no land.
  const followSeats = async (before = null) => {
    const docs = await store.read();
    const held = seats.list();
    const after = countriesOf ? countriesOf(docs).map(clean).filter(Boolean) : null;
    // The events since the seats last followed the world: the round's, or
    // (with no `before`) those after the saved mark.
    const fresh = before ? list(docs.events).filter((event) => !before.eventIds.has(clean(event?.id))) : eventsSince(docs.events, followedThrough);
    const founded = fresh.length
      ? seatFoundings({
        events: fresh,
        actions: docs.actions,
        seated: held.filter((seat) => seat.device).map((seat) => seat.country),
        host: hostCountry,
        areas: before?.areas ?? docs.world?.groupAreas ?? {},
        // (A seat follows a founding only when its own polity ended with it.)
        world: docs.world,
        countries: after,
      }).map((move) => ({ ...move, why: "founded" }))
      : [];
    const marked = lastEventMark(docs.events);
    if (marked !== followedThrough) {
      followedThrough = marked;
      sessionChanged();
    }
    const moving = new Set(founded.map((move) => fold(move.from)));
    // A change of country asked for follows the country asked for: renamed, it
    // names the new name; gone, it is let go, and its player told.
    const asked = seatSuccessions({ world: docs.world, seated: [...changes.values()].map((entry) => entry.to), countries: after });
    for (const entry of [...changes.values()]) {
      const renamed = asked.renamed.find((move) => same(move.from, entry.to));
      if (renamed) changes.set(entry.device, { ...entry, to: renamed.to });
      else if (asked.gone.some((name) => same(name, entry.to))) {
        changes.delete(entry.device);
        answerDevice(entry.device, notice("info", `${entry.to} is gone, so your request to play it is withdrawn.`));
      }
    }
    const successions = seatSuccessions({
      world: docs.world,
      seated: held.map((seat) => seat.country).filter((country) => !moving.has(fold(country))),
      countries: after,
    });
    const moves = [...founded, ...successions.renamed.map((move) => ({ ...move, why: "renamed" }))]
      .filter((move) => seats.move(move.from, move.to));
    // Whose ground a structure or a line of a founder's stands on now, by the
    // host's own map (a rename moved all of them with the country already).
    const chart = moves.some((move) => move.why === "founded") ? await Promise.resolve().then(readChart).catch(() => null) : null;
    for (const move of moves) {
      move.host = same(move.from, hostCountry);
      if (move.host) hostCountry = move.to;
      // (What the round holds for the player, a reading said early among it, follows too.)
      round.rename(move.from, move.to);
      await store.updateGame((game) => ({
        ...game,
        ...(move.host ? { country: move.to } : {}),
        seatFoundings: [...list(game?.seatFoundings), { from: move.from, to: move.to }],
      }));
      await store.updateActions((actions) => withSeatMoved({ actions }, move).actions);
      await store.updateWorld((world) => withSeatMoved({ world }, { ...move, onNewGround: groundHeldBy(chart, move.to) }).world);
      await store.updateChats((chats) => withSeatMoved({ chats }, move).chats);
      await store.updateIntercepts?.((intercepts) => withSeatMoved({ intercepts }, move).intercepts);
      await store.updateAdvisor?.((advisor) => {
        const moved = withSeatMoved({ advisor }, move).advisor;
        return moved === advisor ? null : moved;
      });
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
      // The book keeps its player in the game, watching it (host/seats.js);
      // a change of country they had asked for is theirs to make now. The
      // host too, who keeps the game and its controls, and may take any free
      // country (handlers.pick, withGameCountryChanged): the host was told it
      // kept the game, and could only watch a dissolved polity.
      const seat = seats.vanish(country);
      if (!seat?.device) continue;
      changes.delete(seat.device);
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
    if (moves.length || successions.gone.length || after || asked.renamed.length || asked.gone.length) await seatsChanged({ inEntry: true });
  };
  // A peace or a treaty landed between rounds may annex a country people play:
  // the seats follow in the same entry (`landed`: the landings it told).
  const followLandings = async (landed) => {
    if (!list(landed).length) return;
    await followSeats().catch((error) => log("warn", "a seat did not follow its country after a peace", { error: String(error?.message || error) }));
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

  // A seat let go (host/foundings.js withSeatLetGo): the person's own queued
  // orders withdrawn, and what each moved on the map undone in the same write,
  // as their own "unorder" would; their goal, advice and advisor's
  // conversation cleared; their conversations with other people closed.
  // What they had put to other people and nobody answered lapses (their
  // treaties, their terms of peace). `people`: who played what before.
  const seatLetGo = async (country, people) => {
    await store.updateForces(({ world, actions, game }) => {
      const out = withSeatLetGo({ actions, world }, { country, people, round: game?.round });
      if (!out.withdrawn.length && JSON.stringify(out.world) === JSON.stringify(world)) return null;
      const at = new Date(now()).toISOString();
      const reverted = out.withdrawn.reduce((next, order) => revertOrderFor(next, order, country, { at }), out.world);
      return { actions: out.actions, world: reverted };
    });
    await store.updateChats((chats) => {
      const out = withSeatLetGo({ chats }, { country, people });
      return JSON.stringify(out.chats) === JSON.stringify(list(chats)) ? null : out.chats;
    });
    await store.updateAdvisor?.((advisor) => {
      const out = withSeatLetGo({ advisor }, { country, people }).advisor;
      return JSON.stringify(out) === JSON.stringify(advisor) ? null : out;
    });
    log("info", "a seat was let go: its player's own orders, goal, advice, advisor and conversations with people went with them", { country });
  };
  // The host whose own country is gone takes a free one, as every player whose
  // country is gone may (the owner's decision 11): the host was refused ("The
  // host plays its own game's country"), and its game ran on with a dissolved
  // polity for its country (the review of 2026-11-18, core 14). Its seat, and
  // the game's own country (game.country), which the engine plays as the
  // host's from then on (onSeatsMoved). What the game kept as its player's
  // without naming it is written down as the old country's first
  // (host/foundings.js withGameCountryChanged). In the pick's own entry.
  const hostTakes = async (connection, wanted) => {
    const from = hostCountry;
    const result = seats.claim(wanted, { device: connection.device, name: connection.name, approved: true });
    if (!result.ok) return result.reason;
    const move = { from, to: result.country };
    await store.updateForces(({ world, actions }) => {
      const out = withGameCountryChanged({ world, actions }, move);
      return { world: out.world, actions: out.actions };
    });
    await store.updateChats((chats) => withGameCountryChanged({ chats }, move).chats);
    await store.updateIntercepts?.((intercepts) => withGameCountryChanged({ intercepts }, move).intercepts);
    await store.updateAdvisor?.((advisor) => withGameCountryChanged({ advisor }, move).advisor);
    await store.updateGame((game) => ({ ...game, country: move.to }));
    hostCountry = move.to;
    onSeatsMoved([{ ...move, host: true }]);
    for (const other of connections.values()) if (isHost(other)) other.sent.clear();
    log("info", "the host's country is gone, and the host took a free one", move);
    await seatsChanged({ inEntry: true });
    return "";
  };
  // A seat the host released (control.kick), or a player who watched a
  // country that is gone let go: freed and its records let go in one entry,
  // for the seat it was (`id`, wherever a rename has taken it since; nothing
  // when it has ended already), and its player told (`told`), who until now
  // was not, and found the lobby's box back with no word why.
  const releaseSeat = async ({ id = "", device, told = true }) => {
    const seat = id ? seats.seatById(id) : null;
    const watched = id ? "" : seats.watcherOf(device)?.was ?? "";
    const country = seat?.device === device ? seat.country : watched;
    if (!country) return;
    const people = seats.humanCountries();
    seats.release(country);
    await seatLetGo(country, people);
    if (told) {
      answerDevice(device, notice("info", settings.allowMidGameJoin || !seats.started
        ? `The host released you from ${country}. You can take another free country under Players.`
        : `The host released you from ${country}.`));
    }
    await seatsChanged({ inEntry: true });
  };

  // --- Requests ------------------------------------------------------------------

  // Orders, and everything else a player does to the world, are taken from
  // the start of the game. One given while a round is being resolved waits in
  // the queue behind it and is the next round's: the queue, not a check of the
  // phase on the way in, is what keeps it from the round already under way.
  const started = () => round.status().phase !== "lobby";

  // Every turn of a table on the host's own AI key, one at a time for each
  // table: the answer to a person's line, and an institution's Council or a
  // hearing doing its business (host/institutions.js). Two at once each wrote
  // the thread from what it had read, and the second's lines were dropped as
  // known; a Council's turn ran outside this and could meet an answer half
  // way. Resolves with what the turn resolves with; a turn that fails holds
  // up none after it.
  const tableOf = (chatId) => {
    if (!tables.has(chatId)) tables.set(chatId, { tail: Promise.resolve(), waiting: new Set() });
    return tables.get(chatId);
  };
  // A peace a leader made in a turn's answer (engineMain.js decidedAndTold),
  // whether a person's line or an institution's business asked for the turn,
  // is said to every player, as one two players make is, and the seats follow
  // it in the next entry: a peace that annexes a country people play.
  const onTable = (chatId, job) => {
    const table = tableOf(chatId);
    const turn = table.tail.then(() => (stopped ? undefined : job())).then((outcome) => {
      const landed = list(outcome?.landed);
      if (landed.length && !stopped) {
        tellEveryone(landed);
        void queue.run("seats-follow", () => followLandings(landed));
      }
      return outcome;
    });
    const settled = turn.then(() => {}, () => {});
    table.tail = settled;
    void settled.then(() => {
      if (table.tail === settled) tables.delete(chatId);
    });
    return turn;
  };

  // The AI governments at a table answer a person's line on the host's own AI
  // key (settings.replies "host", and an institution's table always), in the
  // table's turn (onTable). Someone who writes again while their answer is
  // still waiting is answered once, for all they have written by then. When
  // the host's AI could not be reached the writer is told, or their line just
  // went unanswered.
  // `seat`: the writer's seat (its id, and its country as the line names it).
  const answerOnHost = (chatId, seat, governments) => {
    const table = tableOf(chatId);
    const who = seat.id;
    if (table.waiting.has(who)) return;
    table.waiting.add(who);
    void onTable(chatId, async () => {
      table.waiting.delete(who);
      const outcome = await replyTo({ chatId, seat: seat.country });
      // (Its writing was an entry in the queue: every view follows on its own,
      // and a peace it made is told by the table's turn, onTable.)
      if (outcome?.unreachable) {
        tellSeat(seat.id, "warn", `The host's AI could not be reached: ${governments.join(", ")} did not answer. Write again to ask once more.`.slice(0, 500));
      }
      return outcome;
    }).catch((error) => {
      table.waiting.delete(who);
      log("warn", "reply failed", { error: String(error?.message || error) });
    });
  };

  // With settings.replies "own": one of the answers the host's AI gives this
  // seat this round (host/hostAnswers.js). The host's own lines are its own
  // key's either way and are never counted, and a line written while the
  // seat's answer at that table still waits is answered with it, for nothing.
  // (Counted for the seat, by its id: a rename starts no count afresh.)
  const hostAnswerFor = (connection, seat, chatId) => isHost(connection)
    || Boolean(chatId && tables.get(chatId)?.waiting.has(seat.id))
    || hostAnswers.take(seat.id, round.status().round);

  // A line left to its writer's own device to answer.
  const awaitOwnReply = (line, entry) => {
    ownLines.set(line, entry);
    while (ownLines.size > OWN_LINES_KEPT) ownLines.delete(ownLines.keys().next().value);
  };

  // The AI governments at a table answer a seat's line (the game's own
  // diplomacy), each once. A country a person plays answers for itself: a
  // thread between people asks the model nothing. Who writes their answer is
  // the host's setting (settings.replies): the host's own AI (answerOnHost),
  // or the writer's own device on its own key, which the ack then says, with
  // the line it is to answer and the governments that do (client/ownReplies.js;
  // the words come back as a "reply"). Some answers do more than speak, and
  // only the host's own game can carry them out: an institution's table votes
  // and decides in its answer; a government at war with the writer may make
  // peace in its own, or accept the writer's terms (AI/warStatsPrompt.js
  // describePeaceTalk, which asks the same of the same wars); the writer's own
  // Overlord or Puppet may make, answer or settle a demand, which the host's
  // engine checks after it (engineMain.js replyTo, gameplay.js
  // checkDemandReply); and a vote open at the table that a government at it
  // has not voted in, one the line calls among them, is voted in only in the
  // host's own turn (host/tableTurn.js votesAwaited). Those are answered here,
  // whatever the setting. `seat`: the writer's seat. `parties`: everyone at
  // the table; `written`: the thread with the line in it; `line`: the line's
  // id. Returns what the ack carries (nothing when the host answers), or null
  // when nobody answers.
  const answerLine = ({ connection, chatId, seat: writer, parties, institutional, written, world, line }) => {
    const seat = writer.country;
    const people = seats.humanCountries();
    const governments = list(parties)
      .filter((name) => clean(name) && !same(name, seat) && !people.some((human) => same(human, name)))
      .filter((name, index, all) => all.findIndex((other) => same(other, name)) === index);
    if (!governments.length) return null;
    const tied = new Set(livePuppetsFor(world ?? {}, seat).flatMap((row) => [row.overlord, row.puppet]).map((name) => clean(name).toLowerCase()));
    const decides = institutional || votesAwaited(written, governments)
      || governments.some((name) => Boolean(warBetween(world?.wars, name, seat)) || tied.has(clean(name).toLowerCase()));
    if (replies === "own" && !decides) {
      awaitOwnReply(line, { thread: chatId, seat: writer.id });
      return { answer: "own", line, governments: governments.slice(0, 16) };
    }
    // Past what the host's AI gives each player a round with each player's own
    // AI (settings.hostAnswers, host/hostAnswers.js): the line stands, and the
    // round reads it. A Retry (the "answer" request) counts as the line did.
    if (replies === "own" && !hostAnswerFor(connection, writer, chatId)) {
      tell(seat, "info", hostAnswersSpent(hostAnswers.limit));
      return { answer: "round" };
    }
    answerOnHost(chatId, writer, governments);
    return {};
  };

  const handlers = {
    // A country taken. Once the game is under way a seated player's change of
    // country is asked of the host (the owner's decision 12): it waits in the
    // host's Players list; a player whose country is gone takes any free one.
    pick: async (connection, { country }) => {
      if (isHost(connection)) return seats.watcherOf(connection.device) ? hostTakes(connection, clean(country)) : "The host plays its own game's country.";
      const wanted = clean(country);
      const mine = seats.seatOf(connection.device);
      if (seats.started && mine && !same(mine.country, wanted)) {
        if (!countriesNow.some((known) => same(known, wanted))) return "not-a-country";
        changes.set(connection.device, { device: connection.device, name: connection.name, to: wanted });
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
    order: async (connection, { text, ref, title, source, kind, invitees, chatStarter }, seat) => {
      if (!started()) return "Orders are taken while a round is being planned.";
      const body = clean(text).slice(0, ORDER_MAX_CHARS);
      if (!body) return "An order needs words.";
      const chat = kind === "chat";
      const invited = chat ? list(invitees).map(clean).filter(Boolean) : [];
      if (invited.some((country) => same(country, seat.country))) return "A government does not write to itself.";
      if (invited.some((country) => !countriesNow.some((known) => same(known, country)))) return "Unknown country.";
      const id = clean(ref);
      let refusal = "";
      await store.updateActions((actions) => {
        const all = list(actions);
        // An order the screen named is queued once, however often it is sent
        // (a lost answer, a second press), and is never another's.
        const held = id ? all.find((action) => clean(action?.id) === id) : null;
        if (held) {
          if (!same(held.ownerCode, seat.country)) refusal = "That order is someone else's.";
          else if (clean(held.status || "planned") !== "planned") refusal = "That order was carried out already.";
          else if (clean(held.text) !== body) refusal = "That order is queued already, in other words.";
          return null;
        }
        // This round's own, and the whole queue at twice that: one carried over
        // unanswered is not this round's, but it waits (host/orderCap.js).
        refusal = orderCapRefusal(all, seat.country, MAX_ORDERS_PER_ROUND);
        if (refusal) return null;
        const named = clean(title).slice(0, ORDER_TITLE_MAX);
        return [...all, {
          id: id || mintId("order", now),
          kind: chat ? "chat" : "action",
          source: clean(source) || "manual",
          status: "planned",
          title: named || (body.length > 64 ? `${body.slice(0, 61)}...` : body),
          text: body,
          rawInput: body,
          ...(chat ? { invitees: invited, chatStarter: clean(chatStarter).slice(0, ORDER_MAX_CHARS) } : {}),
          ownerCode: seat.country,
          createdAt: new Date(now()).toISOString(),
        }];
      });
      round.touch(seat.country);
      return refusal;
    },
    // A queued order of the seat's own, given other words; nothing else of it
    // changes (advisorBlocks.js planAdvisorActionEdits, as single player edits it).
    reword: async (connection, { order, title, text }, seat) => {
      if (!started()) return "Orders are changed while a round is being planned.";
      const named = clean(title).slice(0, ORDER_TITLE_MAX);
      const body = clean(text).slice(0, ORDER_MAX_CHARS);
      if (!named && !body) return "An order needs words.";
      let found = false;
      await store.updateActions((actions) => {
        const all = list(actions);
        const index = all.findIndex((action) =>
          clean(action?.id) === clean(order) && same(action?.ownerCode, seat.country) && clean(action?.status || "planned") === "planned");
        if (index < 0) return null;
        found = true;
        const next = [...all];
        next[index] = { ...all[index], ...(named ? { title: named } : {}), ...(body ? { text: body } : {}) };
        return next;
      });
      round.touch(seat.country);
      return found ? "" : "That is not one of your queued orders.";
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
      // Its place is held to the host's own map (host/forces.js deployPlaceRefusal).
      const chart = await Promise.resolve().then(readChart).catch(() => null);
      let refusal = "";
      await store.updateForces(({ world, actions }) => {
        const result = deployFor({ world, actions }, seat.country, request, {
          orderId: mintId("order", now),
          unitId: mintId("unit", now),
          at: new Date(now()).toISOString(),
          maxOrders: MAX_ORDERS_PER_ROUND,
          chart,
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
    // it is taken at any time. A point Move names is held to the host's own map
    // (structurePlacement.js structureMoveRefusal): the structure's country's own
    // land, or the sea off it.
    settle: async (connection, { marker, move, lng, lat }, seat) => {
      const chart = move ? await Promise.resolve().then(readChart).catch(() => null) : null;
      let refusal = "";
      await store.updateWorld((world) => {
        const found = list(world?.markers).find((entry) => clean(entry?.id) === clean(marker));
        if (!found) refusal = "That structure is not on the map.";
        else if (!canSettleStructure(found, { playerCountry: seat.country, world })) refusal = "That structure is not yours to settle.";
        else if (move) refusal = structureMoveRefusal(found, { lng, lat }, { chart });
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
        // A hunt is for a convoy the hunter can see (host/onlyOrdered.js).
        const asked = huntSeenBy(sent, world?.transports, seat.country);
        const result = applyWarRoomOp(world?.battlefields, asked, { player: seat.country, date: clean(game?.gameDate), transports: world?.transports, era: eraSettingOf(world), media: activeTransportMedia(), military: transportFiguresOf(world, seat.country) });
        if (result.error) {
          refusal = result.error;
          return null;
        }
        // A convoy the player sent (the last of the list, transports.js
        // orderTransport) has an id of the host's that tells nothing of anyone
        // else's (host/onlyOrdered.js opaqueId).
        const made = sent.op === "transport" ? clean(list(result.transports).at(-1)?.id) : "";
        if (made && result.transports) result.transports = withRenamed(result.transports, made, opaqueId("t", result.transports.map((entry) => entry?.id)));
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
        const date = clean(game?.gameDate);
        const result = applyFortifyOp(world, sent, { player: seat.country, date, chart });
        if (result.error) {
          refusal = result.error;
          return null;
        }
        // A line given up that the others had seen stays theirs to see until
        // the skip; a new one has an id that tells nothing of anyone else's
        // (host/onlyOrdered.js).
        if (sent.op === "unfortify") return { world: withLineGivenUp(result.world, result.line, date) };
        const made = clean(result.line?.id);
        const lines = list(result.world?.fortifications);
        return { world: made ? { ...result.world, fortifications: withRenamed(lines, made, opaqueId("line-", lines.map((line) => line?.id))) } : result.world };
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
        // The others see the fleet as it stood until the skip (host/onlyOrdered.js).
        return { world: withFleetOrdered(world, result.world, sent.unit, clean(game?.gameDate)) };
      });
      round.touch(seat.country);
      return refusal;
    },
    // The war room's air strikes (runtime/fronts/airStrikeOps.js), by the same
    // rule: the air unit must be the seat's country's, and a city struck is the
    // host's own map's, held to its chart, with as many people as the host's
    // world says live there. Flown when the round is resolved.
    airstrike: async (connection, { op }, seat) => {
      const sent = cleanAirStrikeOp(op);
      if (!sent) return "Nothing was asked.";
      const city = sent.op === "airstrike" && sent.kind === "city";
      const [chart, cityMap] = city
        ? await Promise.all([Promise.resolve().then(readChart).catch(() => null), Promise.resolve().then(readCities).catch(() => null)])
        : [null, null];
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const cities = cityMap ? frontCitiesOf(cityMap, world, game) : null;
        const result = applyAirStrikeOp(world, sent, { player: seat.country, date: clean(game?.gameDate), round: game?.round, chart, cities, air: activeWars().air });
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
    // A country's stat sheet, when the player's Stats pane has none to show.
    // Whose AI writes it is the host's setting (settings.js `replies`), as it
    // is for the messages to governments the AI plays: the host's own, as many
    // as are asked for, or each player's own, when the answer leaves it to the
    // asking device ({ answer: "own" }; it sends the figures as "ownSheet"). A
    // sheet once written stands: nothing is read again in a shared game, for
    // anyone, so a country is written for once. The host's answer waits for
    // its writing, so the pane can say why when it fails. The model is asked
    // outside the queue; the sheet is written under the game's own lock, which
    // a round being resolved holds (gameplay.js beginStatsWrite).
    sheet: async (connection, { country }, seat) => {
      const name = clean(country);
      try {
        if (replies === "own" && !(await hasSheet(name))) {
          if (playedByAnother(name, seat)) return "Its figures are written when the player of that country opens them.";
          if (!leaveReading("sheet", name, seat)) return "Its figures are being written on another player's device: they show here when they are done.";
          return { error: "", result: { answer: "own" } };
        }
        await readCountry({ country: name, seat: seat.country });
      } catch (failure) {
        return clean(failure?.message || failure).slice(0, 280) || "The host could not write that country's figures.";
      }
      round.touch(seat.country);
      return "";
    },
    // With settings.replies "own": the sheet a player's device wrote on its own
    // AI key for a country that had none. The first to come is the sheet; one
    // that comes after it is answered as written, and the page reads the one
    // its view holds.
    ownSheet: async (connection, { country, sheet, continuity, rating }, seat) => {
      if (replies !== "own") return "The host's AI writes the figures in this game.";
      if (!readingLeftTo("sheet", country, seat)) return "Those figures were not left to your device.";
      ownReadings.delete(readingKey("sheet", country));
      try {
        await takeSheet({ country: clean(country), sheet, continuity: continuity ?? null, rating: rating ?? null });
      } catch (failure) {
        return clean(failure?.message || failure).slice(0, 280) || "The host could not take those figures.";
      }
      round.touch(seat.country);
      return "";
    },
    // Countries' military figures, where a player's Stats pane has none to
    // rank or show (Game/AI/militaryRating.js). In a shared game a page rated
    // nothing and the host only the countries at war after a round, so the
    // ranking stayed empty (the gap audit of 2026-11-18). Whose AI rates them
    // is the host's setting, as for a sheet (the owner's decision 3): the
    // host's own, twenty to a request and each country once a sitting, each
    // request's figures written in the host's one order as it comes; or each
    // player's own device, left the countries no other person plays, which
    // sends the figures ("ownRatings"). Only a country of this game that has
    // none: what stands is never rated again.
    ratings: async (connection, { countries }, seat) => {
      const known = list(countries).map((name) => countriesNow.find((country) => same(country, name))).filter(Boolean);
      const wanted = known.length ? unratedOf((await store.read())?.world ?? {}, known) : [];
      if (!wanted.length) return "";
      if (replies === "own") {
        // (Those another device is rating come with the view when it is done.)
        const left = [];
        for (const name of wanted) {
          if (left.length >= RATINGS_LEFT_MOST) break;
          if (!playedByAnother(name, seat) && leaveReading("military", name, seat)) left.push(name);
        }
        return left.length ? { error: "", result: { answer: "own", countries: left } } : "";
      }
      let refused = "";
      try {
        refused = clean((await rateMilitary({ countries: wanted }))?.refused);
      } catch (failure) {
        return clean(failure?.message || failure).slice(0, 280) || "The host could not rate those figures.";
      }
      round.touch(seat.country);
      // A rating not made is said, with why (rule 10): the ranking stayed part
      // empty with nothing to say for it (the review of 2026-11-18, wars 9). The
      // host's AI may decline (its day's background readings spent), or leave a
      // country out, which it is not asked of again this sitting.
      const missed = unratedOf((await store.read())?.world ?? {}, wanted);
      if (!missed.length) return "";
      if (refused) return refused;
      const count = missed.length;
      const named = missed.join(", ");
      return count > 6 ? `The host's AI gave no military figures for ${count} of those countries.` : `The host's AI gave no military figures for ${named}.`;
    },
    // With settings.replies "own": the figures a player's device rated for
    // the countries left to it, each taken once, and only where the country
    // had none (gameplay.js takeMilitaryRatings): a device fills what is
    // missing and never writes over what stands.
    ownRatings: async (connection, { ratings }, seat) => {
      if (replies !== "own") return "The host's AI rates the figures in this game.";
      const left = list(ratings).filter((entry) => readingLeftTo("military", entry?.country, seat));
      if (!left.length) return "Those figures were not left to your device.";
      for (const entry of left) ownReadings.delete(readingKey("military", entry.country));
      await takeRatings(left.map((entry) => ({
        name: countriesNow.find((country) => same(country, entry.country)) || clean(entry.country),
        military: entry.military ?? null,
        population: Number(entry.population) || 0,
      })));
      round.touch(seat.country);
      return "";
    },
    // War and peace (Game/AI/warAndPeace.js): the seat's own answer to an
    // offer of peace or a call to arms, or terms of its own: put to an enemy
    // nobody plays, they wait for that enemy's leader to answer them in the
    // seat's chat with it (the host's own table turn, runChatActionBatch, reads
    // the answer); put to another player (`to`), they wait for that player's
    // own answer. Whose answer it is is the seat's country and nothing the
    // message says. A peace made lands at once, and is told: an event on the
    // timeline with the borders it moved, and a word to every player
    // (host/landings.js), in the same write.
    peace: async (connection, { op, ref, terms, to }, seat) => {
      let refusal = "";
      let landed = [];
      // (A peace taken may annex a country or cede regions by name: they are found on the map.)
      const map = op === "accept"
        ? await Promise.all([import("../../runtime/assets.js"), import("../../Game/AI/promptContext.js")])
          .then(async ([assets, context]) => ({ catalog: await assets.loadRegionCatalog(), rendered: context.filterToRenderedRegions }))
          .catch(() => null)
        : null;
      await store.updateForces(({ world, game, events }) => {
        const regions = map ? map.rendered(map.catalog, world) : [];
        const outcome = playerDiplomacy(world, { op, ref, terms, to: clean(to), country: seat.country, players: humanCountriesOf(game), date: clean(game?.gameDate), round: game?.round, regions });
        if (outcome.error) {
          refusal = PEACE_REFUSALS[outcome.error] ?? "This is no longer open.";
          return null;
        }
        const baked = new Map(list(regions).map((region) => [clean(region?.id), region]));
        const told = tellLandings({ before: world, after: outcome.world, events, game, ownerOf: (id) => (baked.has(id) ? regionOwnerNow(baked.get(id), {}) : "") });
        landed = told?.landed ?? [];
        return told ? { world: told.world, events: told.events } : { world: outcome.world };
      });
      tellEveryone(landed);
      await followLandings(landed);
      round.touch(seat.country);
      return refusal;
    },
    // A treaty between two players (runtime/treatyOffers.js): put to another
    // player's country, or signed, declined or withdrawn, as the seat's own
    // country and nothing the message says. Signed, it is an agreement of the
    // world's, which every view, the wars and every prompt read, and it is told
    // as a peace is (host/landings.js).
    treaty: async (connection, { op, ref, to, type, title, terms }, seat) => {
      let refusal = "";
      let landed = [];
      await store.updateForces(({ world, game, events }) => {
        const date = clean(game?.gameDate);
        if (op === "propose") {
          const put = proposeTreaty(world, { from: seat.country, to: clean(to), type, title, terms, players: humanCountriesOf(game), date, round: game?.round });
          refusal = put.reason ? TREATY_REFUSALS[put.reason] ?? "That could not be done." : "";
          return put.reason ? null : { world: put.world };
        }
        const answer = answerTreaty(world, { op, ref, country: seat.country, date, round: game?.round, players: humanCountriesOf(game) });
        refusal = answer.error ? TREATY_REFUSALS[answer.error] ?? "That could not be done." : "";
        // (Signed after the two went to war, it lapses: that is written, and said.)
        if (answer.world === world) return null;
        const told = tellLandings({ before: world, after: answer.world, events, game });
        landed = told?.landed ?? [];
        return told ? { world: told.world, events: told.events } : { world: answer.world };
      });
      tellEveryone(landed);
      await followLandings(landed);
      round.touch(seat.country);
      return refusal;
    },
    // The seat's own advisor conversation, changed as its screen saved it
    // (game/advisorChanges.js): kept with the seat (runtime/seatAdvisors.js),
    // the host's own as the file itself, and written here alone. It lived in
    // each guest's local stand-in, lost with a new invite code or on another
    // device, and the host's file had two writers: its screen and this engine,
    // which flags each new paper in it (the gap audit of 2026-11-18). It is
    // private counsel, so it may change at any time, and is in no one's view
    // but the seat's.
    advisor: async (connection, { records, threads, receipts }, seat) => {
      if (typeof store.updateAdvisor !== "function") return "Your advisor's conversation is not kept here.";
      try {
        await store.updateAdvisor((file) => {
          const own = advisorOfSeat(file, seat.country, { gameCountry: hostCountry });
          const next = withAdvisorChanges(own, { records, threads, receipts });
          return JSON.stringify(next) === JSON.stringify(own) ? null : withSeatAdvisor(file, seat.country, next, { gameCountry: hostCountry });
        });
      } catch (failure) {
        return clean(failure?.message || failure).slice(0, 300) || "Your advisor's conversation could not be saved.";
      }
      return "";
    },
    goal: async (connection, { text }, seat) => {
      // The game's own rule for a standing goal (runtime/playerGoal.js).
      await store.updateWorld((world) => withPlayerGoal(world, seat.country, text));
      round.touch(seat.country);
      return "";
    },
    // A post on Rostra (runtime/socialFeed.js), written as the leader of the
    // seat's own country by the game's own rule, and dated by the game. It is
    // public: every view carries the feed, a document of its own, so a post
    // re-sends the feed and not the world (game/messages.js VIEW_PARTS). As
    // many a round as the host allows each player (settings.postsPerRound):
    // the feed keeps its newest posts, and one player posting without end
    // pushed everyone else's out of it.
    post: async (connection, { text, quote, choices }, seat) => {
      if (!isActiveFeatureEnabled("socialMedia")) return "This game has no social media.";
      const allowed = Number(settings.postsPerRound) || DEFAULT_SETTINGS.postsPerRound;
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const turn = Number(game?.round) || 0;
        const posted = normalizeSocialFeed(world?.socialFeed)
          .filter((entry) => entry.kind === "player" && same(entry.by, seat.country) && (Number(entry.round) || 0) === turn).length;
        if (posted >= allowed) {
          refusal = allowed === 1
            ? "You have made this round's post: post again next round."
            : `You have made this round's ${allowed} posts: post again next round.`;
          return null;
        }
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
    // The player's own Projects board, changed as their screen asks: the
    // board's own buttons, or their advisor's entries, through the game's own
    // door (gameState.js applyProjectOpsToWorld: a government's own programmes
    // only, and only what it does to them; every plan bounded), applied here to
    // that seat's own board. A board is a government's working papers, so it
    // may be changed at any time. It used to come whole from the page, and the
    // host kept it: a page could write any entry's progress, or a plan that
    // took another player's land, and a board saved while a round resolved
    // replaced the progress the round had made (the gap audit of 2026-11-18).
    projectOps: async (connection, { ops }, seat) => {
      const docs = await store.read();
      const date = clean(docs?.game?.gameDate);
      const turn = Number(docs?.game?.round) || 0;
      let refusal = "";
      await store.updateWorld((world) => {
        const mine = same(seat.country, hostCountry);
        const boards = isRecord(world?.seatBoards) ? world.seatBoards : {};
        const key = Object.keys(boards).find((country) => same(country, seat.country));
        const board = mine ? list(world?.projects) : list(key ? boards[key] : []);
        // Every op made again by the host, from what a government decides for
        // its own work (host/seatProjects.js): ids the host's, a plan priced
        // and held to the seat's own country. And the player's, whoever on the
        // page wrote it: `by` is the page's word, and lifted nothing.
        const door = seatProjectOps(list(ops), { board, world, country: seat.country, mint: () => mintId("project", now) });
        if (!door.ops.length) {
          refusal = door.refusal;
          return null;
        }
        const { refusedProjectIds, world: next } = applyProjectOpsToWorld({
          actor: "player",
          date,
          ops: door.ops,
          playerCountry: seat.country,
          round: turn,
          world: { ...world, projects: board },
        });
        const changed = JSON.stringify(next.projects) !== JSON.stringify(normalizeProjects(board));
        if (!changed) {
          refusal = refusedProjectIds.length ? "That is not one of your own programmes." : door.refusal;
          return null;
        }
        return withSeatBoard(world, seat.country, next.projects, { host: hostCountry });
      });
      if (refusal) return refusal;
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
      // A Council's or a hearing's turn is the host's AI answering for the
      // governments there, which vote and decide: with each player's own AI,
      // one of the answers the host gives this seat this round.
      if (replies === "own" && ["council", "hearing"].includes(call) && !hostAnswerFor(connection, seat, "")) {
        return hostTurnsSpent(hostAnswers.limit);
      }
      try {
        // A Council's or a hearing's turn is the table's next (onTable).
        const made = await institution({ seat: seat.country, call, args: args ?? {}, onTable });
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
    // A seat's own vote in a conversation's poll: once, by a choice the poll
    // has, and only by someone in it (runtime/chatThreads.js). No model ever
    // casts it for a person.
    vote: async (connection, { thread, poll, option }, seat) => {
      const id = clean(thread);
      const gameDate = clean((await store.read())?.game?.gameDate);
      let refusal = "";
      await store.updateChats((chats) => {
        const all = list(chats);
        const index = all.findIndex((chat) => clean(chat?.id) === id);
        const chat = all[index];
        const owner = chat ? clean(chat.player) || hostCountry : "";
        if (!chat || !(same(owner, seat.country) || membersOf(chat).some((name) => same(name, seat.country)))) {
          refusal = "You are not in that conversation.";
          return null;
        }
        const events = list(chat.events).length ? list(chat.events) : eventsFromLegacyChat(chat);
        const held = list(projectChatThread(events).polls).find((entry) => clean(entry?.id) === clean(poll));
        if (!held || !list(held.options).some((entry) => clean(entry?.id) === clean(option))) {
          refusal = "That is no choice of that vote.";
          return null;
        }
        if (Object.keys(held.votes ?? {}).some((voter) => same(voter, seat.country))) {
          refusal = "You have voted in it already.";
          return null;
        }
        const nextEvents = [...events, { id: mintId("vote", now), kind: "poll_vote_cast", time: gameDate, by: seat.country, pollId: held.id, optionId: clean(option) }];
        const projected = projectChatThread(nextEvents);
        const next = [...all];
        next[index] = { ...chat, events: nextEvents, polls: projected.polls };
        return next;
      });
      if (refusal) return refusal;
      round.touch(seat.country);
      return "";
    },
    // A conversation's own business, for everyone in it ("All shared", the
    // owner, 2026-11-16): closed, as a single player's delete closes it, so it
    // leaves every member's list; renamed; or with countries added, who then
    // read it and answer in it. Each is an entry of the thread's own log
    // (runtime/chatThreads.js), dated by the game and minted here, by someone
    // in it. On the asker's screen alone they were dropped: the thread came
    // back, the name reverted, and an added country never heard a word.
    // A country's parties filled in, by the replies setting as a stat sheet is
    // (the owner, 2026-11-16: "Like sheets"): the host's AI, as many as are
    // asked for, or the asking device's own ({ answer: "own" }; it sends the
    // reading as "ownParties"). Filled in, they stand for everyone: there is no
    // reading them again in a shared game. On a page they were read on the
    // player's key and kept nowhere.
    parties: async (connection, { country }, seat) => {
      const name = countriesNow.find((known) => same(known, country));
      if (!name) return "Unknown country.";
      try {
        if (await hasParties(name)) return "";
        if (replies === "own") {
          if (playedByAnother(name, seat)) return "Its parties are filled in when the player of that country opens them.";
          if (!leaveReading("parties", name, seat)) return "Its parties are being filled in on another player's device: they show here when they are done.";
          return { error: "", result: { answer: "own" } };
        }
        await compileParties({ country: name });
      } catch (failure) {
        return clean(failure?.message || failure).slice(0, 280) || "The host could not fill in those parties.";
      }
      round.touch(seat.country);
      return "";
    },
    ownParties: async (connection, { country, landscape }, seat) => {
      if (replies !== "own") return "The host's AI fills in the parties in this game.";
      const name = countriesNow.find((known) => same(known, country));
      if (!name) return "Unknown country.";
      if (!readingLeftTo("parties", name, seat)) return "Those parties were not left to your device.";
      ownReadings.delete(readingKey("parties", name));
      try {
        await takeParties({ country: name, landscape });
      } catch (failure) {
        return clean(failure?.message || failure).slice(0, 280) || "The host could not take those parties.";
      }
      round.touch(seat.country);
      return "";
    },
    // How far the seat's own standing goal has come, read on its own device and
    // AI key: kept with that goal (runtime/playerGoal.js), which only its player
    // sees; a reading of a goal since reworded judged something else.
    goalProgress: async (connection, { goal, reading }, seat) => {
      let refusal = "";
      await store.updateForces(({ world, game }) => {
        const next = withGoalProgress(world, seat.country, clean(goal), { ...reading, asOf: clean(game?.gameDate), round: game?.round });
        if (next === world) {
          refusal = "Your goal has changed since it was assessed.";
          return null;
        }
        return { world: next };
      });
      round.touch(seat.country);
      return refusal;
    },
    // A country's flag, drawn on every map: a player's own country's, and the
    // host's for a country the AI plays (the owner, 2026-11-16: "Own + host").
    flag: async (connection, { country, image }, seat) => {
      const name = countriesNow.find((known) => same(known, country));
      if (!name) return "Unknown country.";
      const ais = !seats.humanCountries().some((human) => same(human, name));
      if (!same(name, seat.country) && !(isHost(connection) && ais)) {
        return "You change your own country's flag; the host changes those of the countries the AI plays.";
      }
      try {
        await setFlag({ country: name, image: clean(image) });
      } catch (failure) {
        return clean(failure?.message || failure).slice(0, 280) || "The flag could not be changed.";
      }
      round.touch(seat.country);
      return "";
    },
    thread: async (connection, { op, thread, title, members }, seat) => {
      const id = clean(thread);
      const docs = await store.read();
      const gameDate = clean(docs?.game?.gameDate);
      let refusal = "";
      await store.updateChats((chats) => {
        const all = list(chats);
        const index = all.findIndex((chat) => clean(chat?.id) === id);
        const chat = all[index];
        const owner = chat ? clean(chat.player) || hostCountry : "";
        const inIt = chat && (same(owner, seat.country) || membersOf(chat).some((name) => same(name, seat.country)));
        if (!inIt) {
          refusal = "You are not in that conversation.";
          return null;
        }
        // An institution's table is the institution's (host/institutions.js).
        refusal = institutionThreadRefusal(chat, op, docs?.world);
        if (refusal) return null;
        const next = [...all];
        if (op === "close") {
          next[index] = { ...chat, status: "closed" };
          return next;
        }
        let added = [];
        if (op === "rename") {
          const name = clean(title).slice(0, THREAD_TITLE_MAX).trim();
          if (!name) {
            refusal = "Give the conversation a name.";
            return null;
          }
          added = [{ id: mintId("title", now), kind: "title_changed", time: gameDate, by: seat.country, title: name }];
        } else {
          // A table of an institution sits by its membership, not by invitation.
          if (isInstitutionThread(chat)) {
            refusal = "An institution's table seats its members.";
            return null;
          }
          const present = [owner, ...membersOf(chat)];
          const joining = [];
          for (const wanted of list(members).map(clean).filter(Boolean)) {
            const country = countriesNow.find((known) => same(known, wanted));
            if (!country) {
              refusal = "Unknown country.";
              return null;
            }
            if (!present.some((name) => same(name, country)) && !joining.some((name) => same(name, country))) joining.push(country);
          }
          if (!joining.length) return null;
          if (present.length - 1 + joining.length > THREAD_MEMBERS_MAX) {
            refusal = `A conversation holds at most ${THREAD_MEMBERS_MAX} countries besides the one that opened it.`;
            return null;
          }
          added = joining.map((country) => ({ id: mintId("join", now), kind: "member_joined", time: gameDate, by: seat.country, member: { name: country, code: country } }));
        }
        const events = [...(list(chat.events).length ? list(chat.events) : eventsFromLegacyChat(chat)), ...added];
        const projected = projectChatThread(events);
        next[index] = { ...chat, events, countries: projected.countries, title: projected.title, polls: projected.polls, demands: projected.demands };
        return next;
      });
      if (refusal) return refusal;
      round.touch(seat.country);
      return "";
    },
    say: async (connection, { thread, to, text, fromDraft, demand, poll }, seat) => {
      const body = clean(text);
      if (!body) return "A message needs words.";
      const recipients = list(to).map(clean).filter(Boolean);
      if (!thread && !recipients.length) return "Say it to someone.";
      if (recipients.some((country) => same(country, seat.country))) return "A government does not write to itself.";
      if (recipients.some((country) => !countriesNow.some((known) => same(known, country)))) return "Unknown country.";
      // A letter written while a round is being resolved waits in the queue
      // behind it, and is the next round's.
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
      // The thread as this line leaves it (its votes among it).
      let written = null;
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
        // The thread the line is written into: the one it names, or the one
        // it opens, owned by the writer, with the countries it is written to.
        // Either way the line is one line: what it carries is entered with it
        // the same, in a thread the host opens with it as in one it keeps.
        if (!chatId) chatId = mintId("thread", now);
        const found = opens ? -1 : all.findIndex((chat) => clean(chat?.id) === chatId);
        const index = opens ? all.length : found;
        const chat = opens
          ? { id: chatId, player: seat.country, countries: recipients.map((country) => ({ code: country, name: country })), messages: [] }
          : all[found];
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
        // A demand the line carries (runtime/demandCheck.js): made by an
        // Overlord of its own Puppet, or answered, by the side that may, in
        // the one-on-one thread between them. On the page it was an entry of
        // the thread's log, dropped; the host enters it with the line.
        const demanded = demand ? demandEventFor(chat, { demand, seat: seat.country, owner, members, world: docs?.world, message, gameDate }) : null;
        if (demand && !demanded) {
          refusal = "That is not a demand you can make or answer here.";
          return null;
        }
        // A vote the line calls (runtime/chatThreads.js createPlayerPollEvent),
        // in a conversation of several countries that is no institution's,
        // whose ballots are formal and its own.
        const called = poll && members.length >= 2 && !institutional
          ? createPlayerPollEvent({ player: seat.country, question: poll.question, options: poll.options, time: gameDate, idFor: (prefix) => mintId(prefix, now) })
          : null;
        if (poll && !called) {
          refusal = "A vote is called in a conversation of several countries, with a question and at least two different choices.";
          return null;
        }
        if (demanded || called) {
          // The line and what it does, in the thread's own log, in order.
          const line = { id: message.id, kind: "message", time: gameDate, by: seat.country, role: "user", code: seat.country, text: message.text };
          const events = [...(list(chat.events).length ? list(chat.events) : eventsFromLegacyChat(chat)), line, demanded ?? called];
          const projected = projectChatThread(events);
          next[index] = { ...chat, events, demands: projected.demands, polls: projected.polls, messages: [...list(chat.messages), message] };
          written = next[index];
          return next;
        }
        next[index] = { ...chat, messages: [...list(chat.messages), message] };
        written = next[index];
        return next;
      });
      if (refusal) return refusal;
      round.touch(seat.country);
      // The AI governments in the thread answer (the game's own diplomacy),
      // after the player's view shows what they wrote (answerLine). A thread
      // opened by this line goes back with the ack, so the screen that began
      // it can open it as soon as its view holds it (client/sharedThreads.js).
      const result = {
        ...(opens ? { chatId } : {}),
        ...(answerLine({ connection, chatId, seat, parties, institutional, written, world: docs?.world, line: message.id }) ?? {}),
      };
      // A person at the table who is away answers on coming back, and the
      // writer is told so: a line to a player who had gone was met by silence
      // (the gap audit of 2026-11-18). Once their seat is the AI's, their
      // government answers like any other (answerLine).
      const away = seats.list()
        .filter((entry) => entry.status === SEAT_STATUS.AWAY && !same(entry.country, seat.country) && parties.some((name) => same(name, entry.country)))
        .map((entry) => entry.country);
      if (away.length) {
        tell(seat.country, "info", away.length === 1
          ? `${away[0]}'s player is away, and will read it on coming back.`
          : `${away.join(", ")}: their players are away, and will read it on coming back.`);
      }
      return Object.keys(result).length ? { error: "", result } : "";
    },
    // With settings.payment "cycle": the answer the paying device's own AI gave
    // to the round's request the host sent it, or why it gave none; and a
    // lookup that request's model asked for, answered from the host's own game
    // as it would have been here (host/roundPayers.js). Only from the device
    // the request was sent to, and only while it waits.
    paid: async (connection, { job, answer, failure, statuses }) => payers.answered(connection.device, { job, answer: answer ?? null, failure: failure ?? null, statuses: statuses ?? [] }),
    payLookup: async (connection, { job, name, args, round }) => payers.lookup(connection.device, { job, name, args, round: round ?? 1 }),
    // That the paying device's model is at work (the engine's deadline for a
    // silent model counts from these), and a lookup round it began, counted
    // into the round's budget as the host's own are.
    payAlive: async (connection, { job, round }) => {
      payers.alive(connection.device, { job, round });
      return "";
    },
    // What a device states about paying for a round, with no key: whether it
    // can, and its own settings, which a round it pays is built under. Every
    // screen hears who pays in turn.
    canPay: async (connection, profile) => {
      if (payers.state(connection.device, profile) && settings.payment === "cycle") payersChanged();
      return "";
    },
    // A Retry from an error bubble (chat.jsx handleRetry): the governments at a
    // thread answer the seat's own last line again, as they would have when it
    // was written, by the same rule ("say" answerLine). No line is sent: the
    // page's Retry used to send its line a second time at a group table, and at
    // a one-on-one table it asked the player's own key and threw the reply
    // away. Only while that line is still the thread's last, unanswered.
    answer: async (connection, { thread }, seat) => {
      const docs = await store.read();
      const chat = list(docs?.chat).find((entry) => clean(entry?.id) === clean(thread));
      const owner = chat ? clean(chat.player) || hostCountry : "";
      const members = membersOf(chat);
      if (!chat || !(same(owner, seat.country) || members.some((name) => same(name, seat.country)))) return "You are not in that conversation.";
      const last = list(chat.messages).filter((line) => isRecord(line) && clean(line.text)).at(-1);
      if (!last || !same(clean(last.speaker || last.code) || (clean(last.role) === "user" ? owner : ""), seat.country) || !clean(last.id)) {
        return "Your last message there has been answered already.";
      }
      const answered = answerLine({ connection, chatId: clean(chat.id), seat, parties: [owner, ...members], institutional: isInstitutionThread(chat), written: chat, world: docs?.world, line: clean(last.id) });
      if (!answered) return "Nobody at that table is the AI's to answer.";
      round.touch(seat.country);
      return Object.keys(answered).length ? { error: "", result: answered } : "";
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
      if (!waiting || waiting.thread !== clean(thread) || waiting.seat !== seat.id) {
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
        else waits.again(connection.device, id);
        return;
      }
      mine.set(id, null);
      while (mine.size > ANSWERS_KEPT) mine.delete(mine.keys().next().value);
    }
    const seat = seatOf(connection);
    const needsSeat = !SEATLESS.has(message.t);
    // A request for what the host's game has switched off (host/featureGates.js).
    const switchedOff = featureRefusal(message, features);
    let error = "";
    let result = null;
    if (needsSeat && (!seat || seat.status !== SEAT_STATUS.HUMAN)) error = "Take a country first.";
    else if (switchedOff) error = switchedOff;
    else {
      try {
        // A refusal's words, or { error, result } from a request that made
        // something. A change to the world is an entry in the queue; what
        // changes nothing, or only asks the AI, is not. It acts for the seat
        // it was sent by, as that seat is when it is applied (rule 3): one that
        // waited behind a round acted for the country the seat had before the
        // round, so an order, a goal or a line written meanwhile went to a
        // name the round had renamed or founded away, which nobody played (the
        // review of 2026-11-18, core 1). A seat that has ended meanwhile (its
        // player released, their country gone, or changed) is refused.
        const apply = () => {
          const acting = needsSeat ? seats.seatById(seat.id) : seat;
          if (needsSeat && acting?.device !== connection.device) return `You no longer play ${seat.country}.`;
          return handler(connection, message, acting);
        };
        if (id && !AT_ONCE.has(message.t)) waits.begin({ device: connection.device, id, t: message.t, resolving: round.status().phase === "resolving" });
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
      waits.end(connection.device, id);
      const ack = { t: "ack", id, ok: !error, error: error || null, ...(result && !error ? { result } : {}) };
      mine.set(id, ack);
      answerDevice(connection.device, ack);
    }
    // What changed of the session (a line left to a device, one answered; and
    // the answer, for a request that may have changed the game).
    if ((id && !AT_ONCE.has(message.t)) || (!error && ["say", "reply", "answer"].includes(message.t))) sessionChanged();
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
      // A paying device back on a new connection is sent the request again.
      payers.joined(player.device);
      void seatsChanged();
    },
    leave(player) {
      const connection = connections.get(player.id);
      if (!connection) return;
      connections.delete(player.id);
      // Another connection of the same device (a reconnect) keeps the seat.
      if ([...connections.values()].some((entry) => entry.device === connection.device)) return;
      // A device paying the round that is gone is waited for a little, then
      // the round fails visibly (host/roundPayers.js PAYER_GONE_MS).
      payers.left(connection.device);
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
        // (What was ordered in the lobby stays its owner's until the first
        // skip: host/onlyOrdered.js keeps it by its date, not by this moment.)
        await queue.run("start", recordHumans);
        // The campaign's own round: one number on every screen (host/round.js).
        round.start(Number((await store.read())?.game?.round) || 0);
        broadcastLobby();
      },
      pause: () => round.pause(),
      resume: () => round.resume(),
      // A round being resolved, called off: its request is aborted, nothing it
      // was writing lands, and it waits with its orders for the host to run it
      // again. Only Stop could end a round that hung.
      cancelRound() {
        if (!roundAbort || round.status().phase !== "resolving") return false;
        roundCancelled = true;
        roundAbort.abort(new Error("The host cancelled the round."));
        return true;
      },
      resolveNow: () => round.resolveNow(),
      // With settings.payment "cycle": the host pays the round being planned
      // itself, on its own AI, and runs it now (a payer that is away, or whose
      // AI failed: decision 9, the round waits until the host runs it again).
      // The player whose turn it was is still the next to pay.
      payRound() {
        const status = round.status();
        if (settings.payment !== "cycle" || !["planning", "countdown"].includes(status.phase)) return false;
        payers.hostPays(status.round);
        for (const connection of connections.values()) send(connection, notice("info", `The host pays for round ${status.round} itself.`));
        round.resolveNow();
        return true;
      },
      // How many answers of the host's AI each player may have a round from a
      // government whose answer can act, with each player's own AI (settings.hostAnswers).
      setHostAnswers(count) {
        if (!hostAnswers.setLimit(count)) return false;
        broadcastLobby();
        sessionChanged();
        const text = hostAnswers.limit
          ? `From now on the host's AI answers up to ${hostAnswers.limit} of each player's messages a round to a government that can act on them (one at war with them, their overlord or puppet, an institution).`
          : "From now on the host's AI answers no messages between rounds to a government that can act on them (one at war with the writer, their overlord or puppet, an institution): the round reads them.";
        for (const connection of connections.values()) send(connection, notice("info", text));
        return true;
      },
      // The Game Master's command (decision 8), the host's alone and only in a
      // game whose lobby says so (settings.cheats "host"): run by the game's
      // own console in the host's engine as one entry of the queue, never while
      // a round is resolved (it waits for none: it is refused), and what it
      // changed told to every player and kept in every lobby
      // (host/gameMaster.js). Its reason goes to the host when it changes
      // nothing. Resolves whether it changed anything.
      async gameMaster(command) {
        const toHost = (text) => {
          for (const connection of connections.values()) if (isHost(connection)) send(connection, notice("warn", text));
          return false;
        };
        const asked = clean(command).slice(0, GAME_MASTER_COMMAND_MAX);
        if (!gameMasterAllowed(settings)) return toHost("The Game Master is off in this game: its lobby says so to every player.");
        if (!asked) return toHost("Tell the Game Master what to change.");
        if (round.status().phase === "resolving") return toHost("Not while a round is being resolved: ask the Game Master once it has landed.");
        try {
          const made = await queue.run("game-master", async () => {
            const done = await gameMaster({ command: asked });
            // A country it renamed keeps its player (host/foundings.js).
            await followSeats().catch((error) => log("warn", "a seat did not follow its country after the Game Master", { error: String(error?.message || error) }));
            return done;
          });
          const game = (await store.read())?.game ?? {};
          const entry = gameMasterEntryOf(made, { round: round.status().round, date: clean(game.gameDate) });
          gameMasterLog = withGameMasterEntry(gameMasterLog, entry);
          log("info", "the host used the Game Master", { summary: entry.summary });
          broadcastLobby();
          sessionChanged();
          for (const connection of connections.values()) send(connection, notice("info", gameMasterNotice(entry)));
          return true;
        } catch (error) {
          log("warn", "the Game Master changed nothing", { error: String(error?.message || error) });
          return toHost(`The Game Master changed nothing: ${clean(error?.message || error).slice(0, 400) || "it did not answer."}`);
        }
      },
      setRoundMinutes: (minutes) => round.setRoundMinutes(minutes),
      // What decides the rounds changed on the host's computer (its AI
      // settings): every screen is told, in the lobby.
      setRules(next) {
        const value = next && typeof next === "object" ? { ...next } : null;
        if (JSON.stringify(value) === JSON.stringify(roundRules)) return false;
        roundRules = value;
        broadcastLobby();
        return true;
      },
      // Who answers a player's message to a government the AI plays, from here
      // on (settings.js `replies`). A line already left to its writer's device
      // is still answered from there; an answer the host has begun is finished.
      setReplies(mode) {
        if (!REPLY_MODES.includes(mode) || mode === replies) return false;
        replies = mode;
        broadcastLobby();
        sessionChanged();
        const text = mode === "own"
          ? "From now on each player's own AI answers the messages they write to countries the AI plays."
          : "From now on the host's AI answers the messages written to countries the AI plays.";
        for (const connection of connections.values()) send(connection, notice("info", text));
        return true;
      },
      // The host takes a country back from its player, or lets go of a player
      // who watches a country that is gone; with `ban` that device is kept out
      // of this game for good (saved with it). Returns the device. What the
      // host decided is kept and saved at once (that player does not take the
      // country back; a banned one is kept out); the seat is let go in the
      // game's order, in one entry with its records (releaseSeat). It used to
      // be freed at once and cleaned in a later entry, and a pick for it that
      // waited behind a round took it in between, with the last player's
      // orders, goal and letters (the review of 2026-11-18, views 12).
      kick(country, { ban = false } = {}) {
        const seat = seats.list().find((entry) => entry.device && same(entry.country, country)) ?? null;
        const watcher = seat ? null : seats.watching().find((entry) => same(entry.was, country)) ?? null;
        const device = seat?.device ?? watcher?.device ?? null;
        if (!device || device === hostSeat.device || same(seat?.country, hostCountry)) return null;
        if (seat) seats.keepOff(seat.country, device);
        changes.delete(device);
        if (ban) banned.add(device);
        // A round its device was paying fails now, with why, and waits for the host.
        payers.released(device);
        sessionChanged();
        void queue.run("seat-let-go", () => releaseSeat({ id: seat?.id ?? "", device, told: !ban }))
          .catch((error) => log("warn", "a released seat was not let go", { error: String(error?.message || error) }));
        return device;
      },
      // A player's change of country, as the host decides it (the owner's
      // decision 12): `allow` gives them the country they asked for and frees
      // their old one; `refuse` keeps them where they are. `from`: the
      // country the asking player plays now.
      async seat({ op, from: asked }) {
        const found = [...changes.values()].find((entry) => same(changeFrom(entry), asked));
        if (!found) return false;
        const tellPlayer = (text) => {
          for (const connection of connections.values()) if (connection.device === found.device) send(connection, notice("info", text));
        };
        if (op !== "allow") {
          const change = { ...found, from: changeFrom(found) };
          changes.delete(change.device);
          tellPlayer(`The host keeps you as ${change.from}.`);
          broadcastLobby();
          sessionChanged();
          return true;
        }
        // Carried out in the game's order: the request, as it stands then (a
        // round before it may have renamed either country, host/seats.js), and
        // the country they leave, as their seat has it then.
        let change = found;
        const done = await queue.run("change-of-country", async () => {
          change = changes.get(found.device) ?? null;
          if (!change) return "gone";
          changes.delete(change.device);
          const people = seats.humanCountries();
          const leaving = changeFrom(change);
          const result = seats.claim(change.to, { device: change.device, name: change.name, approved: true });
          if (!result.ok) return result.reason;
          // Its player has left the country it played: what was theirs goes with them, and what is its government's stays.
          if (leaving) await seatLetGo(leaving, people);
          for (const connection of connections.values()) if (connection.device === change.device) connection.sent.clear();
          await seatsChanged({ inEntry: true });
          return "";
        });
        // (A request let go meanwhile, its country gone or its player released, was said where it was.)
        if (done === "gone") return false;
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
      // What the players left waiting while nobody shared it is theirs again
      // first, so their seats follow their countries with it.
      if (restored) {
        void queue.run("session-taken-up", async () => {
          await giveBackHeld();
          await followSeats().catch((error) => log("warn", "a saved seat did not follow its country", { error: String(error?.message || error) }));
          // A release or a ban the host made is saved at once, and its seat let
          // go in the queue after: one the engine closed before it ran is let
          // go now.
          for (const seat of seats.list()) {
            if (seat.device && (banned.has(seat.device) || seats.releasedFrom(seat.country, seat.device))) {
              await releaseSeat({ id: seat.id, device: seat.device, told: !banned.has(seat.device) });
            }
          }
        }).catch((error) => log("warn", "a released seat was not let go", { error: String(error?.message || error) }));
      }
      if (restored?.started) {
        // The campaign's round as the save has it now; a session kept before
        // the machine followed the campaign kept its own count instead.
        const atRound = Number(campaignRound) || 0;
        round.resumeAt(atRound || restored.round, { campaign: atRound > 0 });
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
      payers.stop();
      await pushing.catch(() => {});
      await queue.run("end", async () => {
        try {
          await holdForLater();
        } catch (error) {
          // The players stay recorded, so the host's game holds it when it
          // is next opened alone (runtime/seatsLeftBehind.js).
          log("warn", "what the other players left could not be held", { error: String(error?.message || error) });
          return;
        }
        await forgetHumans();
      }).catch((error) => log("warn", "the shared game's players were not cleared", { error: String(error?.message || error) }));
      // The session once more, as it stands at the end: what changed since the
      // last write (a change of who answers made just before Stop) is kept.
      if (campaign && typeof store.writeShared === "function") await writeSession();
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
