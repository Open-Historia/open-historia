/*! Open Historia — what a multiplayer game says between players and the host © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's own messages, on top of the session's (session/messages.js).
//
// From a player to the host, every one is a REQUEST, never a write. A player
// cannot change a document; it asks the host to (the plan's "intents"), and
// the host checks the request against these schemas, against who is asking and
// against the round's phase before it changes anything. Each request carries
// an id the host answers with an `ack`, so a player's screen can show what was
// accepted or refused, and a request sent twice over a shaky connection is
// applied once.
//
// From the host, the player receives the lobby, the round, answers, notices
// and its VIEW: its own projection of the game's documents (host/projection.js),
// never anyone else's. The view is large and comes only from the host, so it
// is copied as plain JSON (validate.js "json") and then read through the game's
// own normalizers, like any document the game loads.

import { HEX_ID, NAME, bool, int, json, list, literal, num, obj, str } from "../protocol/validate.js";
import { SETTINGS_SCHEMA } from "../host/settings.js";
import { POLL_CHOICES_MAX, POLL_CHOICE_MAX_CHARS, SOCIAL_POST_MAX_CHARS } from "../../runtime/socialFeed.js";
import { SAY_FROM_DRAFT_MAX, SAY_RECIPIENTS_MAX } from "../client/sharedThreads.js";
import { TREATY_TERMS_MAX, TREATY_TITLE_MAX, TREATY_TYPES } from "../../runtime/treatyOffers.js";
import { PLAYER_GOAL_MAX_CHARS } from "../../runtime/playerGoal.js";
import { POLL_LABEL_MAX_CHARS, POLL_OPTION_LIMIT, POLL_QUESTION_MAX_CHARS } from "../../runtime/chatThreads.js";
import { DIFFICULTY_LEVELS } from "../../runtime/difficulty.js";

const DIFFICULTY_IDS = Object.freeze(DIFFICULTY_LEVELS.map((level) => level.id));

// A host and its players must speak the same game: raised whenever these
// messages or the views (host/projection.js) change in a way an older player's
// screen would misread. The session refuses a player on another version.
// 4: the world a player is sent has battlefields in it (their troops, the
// replay of the last run, the regions still drawn as their old holder's), and
// a screen from before would draw land war as loose units that are not there.
// 5: a battlefield's war room is its side's own (its generals, its talk, its
// planned movements are no longer sent to the other side), and a player can ask
// the host for what is done in one (the "warroom" request).
// 6: a player's institutions are asked of the host (the "institution" request),
// and an ack may carry what the host made (`result`).
// 7: Rostra, the social network: a player posts through the host (the "post"
// request), and the view carries the feed (world.socialFeed). A screen from
// before would offer no way to post, and a host from before would refuse one.
// 8: a Rostra post can be a poll (the "post" request's `choices`), which a host
// from before would refuse.
// 9: a line may say which of the advisor's drafted letters it was sent from
// (the "say" request's `fromDraft`), which a host from before would refuse.
// 10: who answers a player's message to a government the AI plays is the
// host's choice (settings.replies). With "own" the writer's device writes the
// governments' words on its own AI key and sends them (the "reply" request);
// no key is sent anywhere.
// 11: views are checked, not trusted to arrive. Each names its connection
// (`epoch`), its number, the number it follows (`base`, 0 for a whole
// view) and the digest of every document as the player is to hold it after it
// (`sums`, protocol/digest.js). The page applies a view only if it follows
// the one it holds and adds up, says so (the "viewed" message), and asks for
// the whole of it again when it does not. A reconnect is a whole view.
// 12: the session is saved with the game: a seat is its device's until the
// host releases it, a seated player's change of country is asked of the host
// (the lobby's `changes`), and a player whose country is gone watches it
// (a seat's status "watching"). The round says the last one that failed.
// 13: the lobby states the game's inputs every screen uses: its map's checksum
// (`scenario.hash`, which a guest's copy must match) and its feature switches
// (`features`, which a guest's screen takes for its own while it plays).
// 14: a stat sheet is written once and stands: the "sheet" request has no
// `fresh` (nothing is read again in a shared game), and with settings.replies
// "own" the host leaves a missing sheet to the asking device, which writes it
// on its own AI key and sends the figures (the "ownSheet" request). And a
// player puts terms of peace to another player by name (the "peace" request's
// `to`): each country makes its own peace. And two players sign treaties (the
// "treaty" request), and a view carries a player's own (world.treatyOffers).
// A conversation is closed, renamed or given countries for everyone in it (the
// "thread" request), where those were the asker's screen's alone and dropped;
// a line may carry a demand made or answered, or call a vote (the "say"
// request's `demand` and `poll`), and a player votes (the "vote" request),
// and a flag is changed through the host (the "flag" request). A country's
// parties are filled in once, by the replies setting, as a stat sheet is
// ("parties", "ownParties"), and a goal's progress read on the player's own
// device is kept with the goal ("goalProgress"). Version 15: those requests,
// orders kept by the screen's own id ("order" `ref`, "reword"), and the
// world's language among the host's settings (host/settings.js `language`).
export const SHARED_GAME_VERSION = "15";

// The documents a player's view holds: the game itself first (a screen that
// asks for one before the first view arrives waits for it), then the three a
// page may fall back to its own copy of until the host sends them.
export const VIEW_KEYS = Object.freeze(["world", "game", "events", "chat", "actions", "intercepts", "colors", "flags"]);
// A view's connection, as the host names it.
const EPOCH = str(24, { min: 1, pattern: /^[0-9a-z]+$/ });
const REV = int(0, 2 ** 40);

// A flag as the "flag" request carries it: an image as a data URL, scaled as
// the flag picker scales an upload, or nothing.
export const FLAG_IMAGE_MAX = 400_000;
const FLAG_IMAGE = /^(data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+=*)?$/;

// The longest a conversation's name may be (the "thread" request's `title`).
export const THREAD_TITLE_MAX = 120;
// The most countries a conversation holds beside its owner.
export const THREAD_MEMBERS_MAX = 12;

// A government's reply written on a player's device (the "reply" request): how
// long one government's words may be, and how many lines one reply may hold.
export const REPLY_MAX_CHARS = 6000;
export const REPLY_MAX_LINES = 8;

// What of the institutions a player's screen may ask the host for: the game's
// own institution functions, run on the host for the asker's country
// (host/institutions.js). Each is one thing the Institutions screen, a thread
// or the advisor does.
export const INSTITUTION_CALLS = Object.freeze(["lifecycle", "governance", "proposal", "voteRequest", "channel", "negotiation", "message", "council", "hearing"]);

// Orders are free text in single player; in a shared game one is held to this.
export const ORDER_MAX_CHARS = 1500;
// The project operations one request carries (an advisor's reply proposes at
// most this many, advisorActionReview.js).
export const PROJECT_OPS_MAX = 24;
// An order's id and title (runtime/gameState.js normalizeActionEntry; an
// advisor's proposal names ids and titles up to these, advisorActionReview.js).
export const ORDER_ID_MAX = 150;
export const ORDER_TITLE_MAX = 240;
export const SAY_MAX_CHARS = 2000;
// A country's name, as long as the game lets one be: the AI founds countries
// like "Provisional Government of the Northern Territories", and one name over
// a shorter limit made every lobby message unreadable, for every player.
export const COUNTRY_MAX_CHARS = 200;
const COUNTRY = NAME(COUNTRY_MAX_CHARS);
const REQUEST_ID = HEX_ID(8);

export const PLAYER_REQUESTS = Object.freeze({
  // The lobby.
  pick: obj({ t: literal("pick"), id: REQUEST_ID, country: COUNTRY }),
  unpick: obj({ t: literal("unpick"), id: REQUEST_ID }),
  // The round.
  ready: obj({ t: literal("ready"), id: REQUEST_ID, value: bool() }),
  revealed: obj({ t: literal("revealed"), id: REQUEST_ID, round: int(0, 1_000_000) }),
  // The player's government.
  // An order keeps what the screen queued: its own id (`ref`, an AI
  // suggestion's or an advisor's proposal's), so that screen finds it again and
  // the same order sent twice is queued once; its title and where it came from;
  // and a conversation it opens (`kind` "chat": who it invites, its opening line).
  order: obj({
    t: literal("order"), id: REQUEST_ID, text: str(ORDER_MAX_CHARS, { min: 1 }),
    ref: str(ORDER_ID_MAX, { min: 1 }),
    title: str(ORDER_TITLE_MAX),
    source: str(16, { enum: ["manual", "suggested", "advisor"] }),
    kind: str(8, { enum: ["action", "chat"] }),
    invitees: list(COUNTRY, SAY_RECIPIENTS_MAX),
    chatStarter: str(ORDER_MAX_CHARS),
  }, ["ref", "title", "source", "kind", "invitees", "chatStarter"]),
  unorder: obj({ t: literal("unorder"), id: REQUEST_ID, order: str(ORDER_ID_MAX, { min: 1 }) }),
  // A queued order of one's own, given other words (an advisor's proposal to
  // change it, approved by the player).
  reword: obj({ t: literal("reword"), id: REQUEST_ID, order: str(ORDER_ID_MAX, { min: 1 }), title: str(ORDER_TITLE_MAX), text: str(ORDER_MAX_CHARS) }, ["title", "text"]),
  goal: obj({ t: literal("goal"), id: REQUEST_ID, text: str(600) }),
  // A post on Rostra, the social network (runtime/socialFeed.js), as the leader
  // of the seat's own country, never one the message names; `quote` the id of
  // the post it quotes ("p12"), or empty. The host checks that it is still there.
  // `choices`: a poll's, when the post asks one (the text is then its question).
  post: obj({
    t: literal("post"),
    id: REQUEST_ID,
    text: str(SOCIAL_POST_MAX_CHARS, { min: 1 }),
    quote: str(12, { pattern: /^(?:p\d{1,7})?$/ }),
    choices: list(str(POLL_CHOICE_MAX_CHARS, { min: 1 }), POLL_CHOICES_MAX),
  }, ["choices"]),
  // The player's own Projects board, whole. The host puts it through the
  // game's own normalizer, which holds it to a board's shape and size, and the
  // session holds the message to its own size limit (session/host.js).
  // The player's own Projects board changed by the game's own project
  // operations (runtime/gameState.js applyProjectOpsToWorld), as the panel's
  // buttons or the player's advisor ask (`by`). Never the board itself: the
  // host keeps every entry's progress and what its plan does.
  projectOps: obj({ t: literal("projectOps"), id: REQUEST_ID, ops: list(json(10), PROJECT_OPS_MAX), by: str(8, { enum: ["panel", "advisor"] }) }, ["by"]),
  // The player's forces: raise a formation where the player put it (it waits
  // there for the next skip to confirm it), or stand one down. What a formation
  // is to DO is an order like any other, in words.
  deploy: obj({
    t: literal("deploy"), id: REQUEST_ID, type: str(24, { min: 1 }), strength: num(1, 100),
    name: str(80), composition: str(200), lng: num(-540, 540), lat: num(-90, 90),
  }),
  disband: obj({ t: literal("disband"), id: REQUEST_ID, unit: str(160, { min: 1 }) }),
  // A structure of the player's own, or of its puppet's, that the map placed
  // approximately (runtime/structurePlacement.js): kept where it stands, or,
  // with `move`, put at `lng`, `lat`.
  settle: obj({ t: literal("settle"), id: REQUEST_ID, marker: str(160, { min: 1 }), move: bool(), lng: num(-180, 180), lat: num(-90, 90) }),
  // The war room (runtime/fronts/warRoomOps.js): one thing the player does on a
  // battlefield its troops are on: an order for troops picked out, a route
  // drawn for them, what was said to its generals and what they took from it,
  // a diversion, a Board operation's arrow. The op is plain JSON; the host
  // cuts it to an op's own fields and sizes (cleanWarRoomOp) before it reads
  // a word of it, and the session holds the message to its own size limit.
  warroom: obj({ t: literal("warroom"), id: REQUEST_ID, op: json(4) }),
  // The war room's fortified lines (runtime/fronts/fortifyOps.js): a line the
  // player drew, to be built at a level, or one of theirs still being built
  // given up. Plain JSON as the war room's ops are: the host cuts it to an op's
  // own fields (cleanFortifyOp), builds it for the seat's country only, and on
  // ground its own map says that country holds.
  fortify: obj({ t: literal("fortify"), id: REQUEST_ID, op: json(4) }),
  // And its fleets (runtime/naval/fleetOps.js): a posture, a place at sea to
  // sail to or patrol, a blockade, an escort, or a standing order called off,
  // for one of the seat's own fleets (cleanFleetOp), sent only where the
  // host's own map says there is sea.
  fleet: obj({ t: literal("fleet"), id: REQUEST_ID, op: json(3) }),
  // And its air units (runtime/fronts/airStrikeOps.js): an air strike on troops
  // on a battlefield, an enemy's structure or a city, or one called off, for
  // one of the seat's own air units (cleanAirStrikeOp).
  airstrike: obj({ t: literal("airstrike"), id: REQUEST_ID, op: json(3) }),
  // The player's agents: place one in `target`, call `spy` home, send a
  // caught one home or turn it, and say what a turned one reports.
  agent: obj({
    t: literal("agent"), id: REQUEST_ID, op: str(8, { enum: ["deploy", "recall", "expel", "turn", "story", "focus", "mission"] }),
    target: str(80), spy: str(160), story: str(300),
  }),
  // A country's stat sheet, when the player's Stats pane has none to show: the
  // host writes it on its own AI key, or answers `{ answer: "own" }` when its
  // setting leaves it to each player's own (settings.replies). A sheet that is
  // there stands: there is nothing to ask for to have it written again.
  sheet: obj({ t: literal("sheet"), id: REQUEST_ID, country: COUNTRY }),
  // With settings.replies "own": that sheet, written on the asker's own device
  // and AI key (Game/AI/gameplayLazy.js), with the continuity it was assessed
  // under and the rating of the country's intelligence service that came in
  // the same request. Figures alone, no key: the host takes them for a country
  // that still has none, as the game merges its own reading.
  ownSheet: obj({
    t: literal("ownSheet"), id: REQUEST_ID, country: COUNTRY, sheet: json(8),
    continuity: json(5), rating: int(0, 100, { nullable: true }),
  }, ["continuity", "rating"]),
  // War and peace (Game/AI/warAndPeace.js): the player's answer to an offer of
  // peace ("accept", "decline") or to a call to arms ("honour", "refuse"), by
  // its id; or terms of its own put to the other side of a war ("propose", by
  // the war's id, with `terms`). Whose answer it is is the seat's country.
  // `to`, for "propose": the country the terms are put to, a person on the
  // other side by name (warAndPeace.js proposePeace).
  peace: obj({ t: literal("peace"), id: REQUEST_ID, op: str(8, { enum: ["accept", "decline", "honour", "refuse", "propose"] }), ref: str(160, { min: 1 }), terms: json(3), to: COUNTRY }, ["to"]),
  // A treaty between two players (runtime/treatyOffers.js): put to another
  // player's country ("propose", with its type, title and terms), signed or
  // declined by the one it was put to, or withdrawn by the one who put it
  // ("sign", "decline", "withdraw", by the offer's id). Signed, it is an
  // agreement of the world's. Whose answer it is is the seat's country.
  treaty: obj({
    t: literal("treaty"), id: REQUEST_ID, op: str(8, { enum: ["propose", "sign", "decline", "withdraw"] }),
    ref: str(160), to: COUNTRY, type: str(32, { enum: TREATY_TYPES }), title: str(TREATY_TITLE_MAX), terms: str(TREATY_TERMS_MAX),
  }, ["ref", "to", "type", "title", "terms"]),
  // An institution's business, done by the host for the asker's country:
  // found one, apply, invite, answer a case, vote, table a proposal, open its
  // Council or a hearing, and the Council's or the hearing's turn
  // (INSTITUTION_CALLS). The host checks every argument; the country is never
  // the asker's to name.
  institution: obj({ t: literal("institution"), id: REQUEST_ID, call: str(16, { enum: INSTITUTION_CALLS }), args: json(6) }),
  // Diplomacy: into a thread the player is in, or to open one with `to`.
  // `fromDraft`: the id of the advisor's drafted letter the line was sent from
  // (client/sharedThreads.js), kept on the line so the draft says it went.
  // A country's parties filled in (Game/AI/gameplay.js assessPoliticalLandscape),
  // as a stat sheet is: written once, by the host's AI or, with
  // settings.replies "own", the asker's ({ answer: "own" }; then "ownParties",
  // the reading alone). One filled in stands.
  parties: obj({ t: literal("parties"), id: REQUEST_ID, country: COUNTRY }),
  ownParties: obj({ t: literal("ownParties"), id: REQUEST_ID, country: COUNTRY, landscape: json(6) }),
  // How far the asker's standing goal has come, read on its own device and AI
  // key (assessGoalProgress), for the goal as it reads it: kept with that goal,
  // which only its player sees.
  goalProgress: obj({
    t: literal("goalProgress"), id: REQUEST_ID, goal: str(PLAYER_GOAL_MAX_CHARS, { min: 1 }),
    reading: obj({
      progress: num(0, 100), summary: str(600),
      achieved: list(str(400), 5), obstacles: list(str(400), 4), nextSteps: list(str(400), 3),
    }, ["achieved", "obstacles", "nextSteps"]),
  }),
  // A country's flag (runtime/polityFlags.js), an image, or "" for the one it
  // had: a player's own country's, or the host's for a country the AI plays.
  flag: obj({ t: literal("flag"), id: REQUEST_ID, country: COUNTRY, image: str(FLAG_IMAGE_MAX, { pattern: FLAG_IMAGE }) }),
  // A conversation's own business, done for everyone in it (the owner,
  // 2026-11-16: "All shared"): closed ("close", as a single player's delete
  // closes it), renamed ("rename", with `title`), or with countries added
  // ("add", with `members`). Only by someone in it.
  thread: obj({
    t: literal("thread"), id: REQUEST_ID, op: str(8, { enum: ["close", "rename", "add"] }),
    thread: str(120, { min: 1 }), title: str(THREAD_TITLE_MAX), members: list(COUNTRY, 8),
  }, ["title", "members"]),
  say: obj({
    t: literal("say"), id: REQUEST_ID, thread: str(120, { nullable: true }),
    to: list(COUNTRY, SAY_RECIPIENTS_MAX), text: str(SAY_MAX_CHARS, { min: 1 }),
    fromDraft: str(SAY_FROM_DRAFT_MAX),
    // A demand the line carries, in the one-on-one thread between a player
    // and their own Overlord or Puppet (runtime/demandCheck.js): "make" one
    // (the composer's "make this a demand", or an alternative rejected, with
    // the revised words in `text` or none to restate it), or "answer" the one
    // in play (`demandId`, `answer`, an alternative's words in `text`).
    demand: obj({
      op: str(8, { enum: ["make", "answer"] }),
      demandId: str(160), answer: str(24, { enum: ["accepted", "refused", "alternative", "alternative_accepted"] }),
      text: str(SAY_MAX_CHARS),
    }, ["demandId", "answer", "text"]),
    // A vote the line calls, in a group conversation (runtime/chatThreads.js
    // createPlayerPollEvent): its question and its choices.
    poll: obj({ question: str(POLL_QUESTION_MAX_CHARS, { min: 1 }), options: list(str(POLL_LABEL_MAX_CHARS, { min: 1 }), POLL_OPTION_LIMIT) }),
  }, ["fromDraft", "demand", "poll"]),
  // A player's vote in a conversation's poll, by the poll's and the choice's
  // ids: one each, never cast for them.
  vote: obj({ t: literal("vote"), id: REQUEST_ID, thread: str(120, { min: 1 }), poll: str(160, { min: 1 }), option: str(160, { min: 1 }) }),
  // With settings.replies "own": what the governments the AI plays answered a
  // line of the asker's, written on the asker's own device and AI key
  // (GameUI/ownTableReplies.js). Words only: each entry is one government's
  // message, and nothing a government "agrees" in it is carried out. `line` is
  // the asker's own line it answers (the id the "say" ack gave), and the host
  // takes one reply per line, from governments at that table nobody plays.
  reply: obj({
    t: literal("reply"), id: REQUEST_ID, thread: str(120, { min: 1 }), line: str(160, { min: 1 }),
    lines: list(obj({ speaker: COUNTRY, text: str(REPLY_MAX_CHARS, { min: 1 }) }), REPLY_MAX_LINES),
  }),
  // What the page did with a view (client/sharedGame.js): applied it (`ok`), or
  // found it did not follow the one it holds or did not add up, and wants the
  // whole view again. Not a request: it has no id and is not answered.
  viewed: obj({ t: literal("viewed"), epoch: EPOCH, rev: REV, ok: bool() }),
});

const SEAT = obj({
  country: COUNTRY,
  name: str(40),
  // "watching": a player whose country (`country`) is gone.
  status: str(8, { enum: ["human", "away", "ai", "watching"] }),
  // A player's device holds it, whoever minds it now: nobody else may take
  // it until the host releases it. False for a country the AI plays for good.
  held: bool(),
  you: bool(),
});

export const HOST_MESSAGES = Object.freeze({
  lobby: obj({
    t: literal("lobby"),
    settings: SETTINGS_SCHEMA,
    scenario: obj({ id: str(120), name: str(120), hash: str(64) }),
    countries: list(COUNTRY, 600),
    seats: list(SEAT, 64),
    started: bool(),
    // Players asking to change country, for the host to allow (sent to the host only).
    changes: list(obj({ from: COUNTRY, to: COUNTRY, name: str(40) }), 64),
    // The host's feature switches, as its game resolves them (runtime/gameFeatures.js).
    features: json(6),
    // What decides every round beyond the settings (host/hostRules.js): the
    // host's game's difficulty, one for every seat, and what a round costs the
    // host's AI and how long it waits on it.
    rules: obj({
      difficulty: str(24, { enum: DIFFICULTY_IDS }),
      requests: int(1, 64),
      most: int(1, 64),
      stallMinutes: int(0, 24 * 60),
    }),
  }, ["changes", "features", "rules"]),
  round: obj({
    t: literal("round"),
    phase: str(12, { enum: ["lobby", "planning", "countdown", "resolving", "revealing"] }),
    round: int(0, 1_000_000),
    remainingMs: int(0, 30 * 24 * 3600 * 1000),
    paused: bool(),
    ready: list(COUNTRY, 64),
    counted: int(0, 64),
    needed: int(0, 64),
    // The last round that could not be resolved, and why ("" for none), until a
    // round lands.
    failed: int(0, 1_000_000),
    failure: str(300),
  }),
  // `result`: what the host made for the request, by id (an institution, a
  // proposal, a thread), which the asker's screen goes on to show.
  ack: obj({ t: literal("ack"), id: REQUEST_ID, ok: bool(), error: str(300, { nullable: true }), result: json(3) }, ["result"]),
  notice: obj({ t: literal("notice"), level: str(8, { enum: ["info", "warn"] }), text: str(500) }),
  // The player's own view of the game's documents; only the ones that changed
  // since the view numbered `base`, whole (every one, when `base` is 0). `rev`
  // only goes up within an `epoch`, and `sums` is the digest of every document
  // as the player is to hold it after this view.
  view: obj({
    t: literal("view"), epoch: EPOCH, rev: REV, base: REV, docs: json(64),
    sums: obj(Object.fromEntries(VIEW_KEYS.map((key) => [key, str(16, { min: 1 })]))),
  }),
});

// Everything either side may send, for the session's message schema.
export const GAME_MESSAGES = Object.freeze({ ...PLAYER_REQUESTS, ...HOST_MESSAGES });
export const PLAYER_REQUEST_NAMES = Object.freeze(Object.keys(PLAYER_REQUESTS));
export const HOST_MESSAGE_NAMES = Object.freeze(Object.keys(HOST_MESSAGES));
