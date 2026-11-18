/*! Open Historia — a multiplayer game's settings © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the host decides for the game, with the defaults the user asked for:
//   - seats: "up to 64 maximum, default limit is 8, controlled by a slider by
//     the host". Above 8 the turn needs a measured redesign first (the plan's
//     Phase 5b), so the slider runs to 64 but can only be set to 8 for now;
//   - the round: its length, the share of ready players that starts the
//     countdown (2/3 by default), and the countdown's length;
//   - cheats "not allowed by default": the Game Master's tools (decision 8,
//     "behind a visible notice") are off, or the host's ("host"), every change
//     they make told to every player and kept in the lobby's log
//     (host/gameMaster.js). "vote" is not built: it allows nothing;
//   - who pays for the round's one AI request (`payment`): the host ("host"),
//     or each player's device in turn, on its own AI ("cycle"; the owner's
//     decision 14, "build it now, option B"). No key is sent: the host's engine
//     builds the round's request and the paying device carries it to its own AI
//     and sends back the answer (host/roundPayers.js). That device sees the
//     round's whole request, every player's orders and secrets included, which
//     the lobby says plainly (multiplayer/costRules.js);
//   - with `replies` "own", how many answers of the host's AI a player may have
//     a round from a government whose answer can act (`hostAnswers`: one at war
//     with them, their overlord or puppet, an institution's table, Council or
//     hearing). Those can end a war, sign or vote, which only the host's own
//     game may carry out, so they are never left to a player's device; and they
//     are the host's requests, so they are a number the host sets, none unless
//     it says (rule 3: anything extra is off by default). Beyond it a line is
//     still written, and the round reads it;
//   - with `replies` "host", how many of each player's messages a round the
//     host's AI answers (`answersPerRound`), a Council's or a hearing's turn
//     and a Retry counted as a message. They were answered without limit, so
//     one guest writing each line to a new conversation spent the host's whole
//     day of requests, and then every round failed for everyone (the review of
//     2026-11-18, security S5; rule 10: anything extra is a number the host
//     sets). Beyond it a line is still written, and the round reads it;
//   - who answers a player's message to a government the AI plays (`replies`):
//     the host's computer on the host's key ("host"), or the writer's own
//     device on the writer's own key ("own"). The owner, 2026-11-15: "build C
//     and D, and the host can choose, but no sending api keys". A key never
//     leaves the device it is on: with "own" the device writes the governments'
//     words itself and sends the words (the "reply" request);
//   - the language the world is written in (`language`), a rule of the game
//     (the owner, 2026-11-18: "Host sets it"): every request the game makes,
//     on any screen, writes in it; each player translates on their own device
//     (runtime/i18n.js setWorldLanguage). "" is the language the host plays
//     in, made a code when the game is shared (host/engineMain.js);
//   - how many posts each player may make on Rostra, the social network, in a
//     round (`postsPerRound`): the feed keeps its newest 300, and one player
//     posting without end pushed everyone else's out of it (the gap audit of
//     2026-11-18). A post costs no AI request: the round's own reads them.
// The schema is shared with the players' screens, which show these settings,
// and is closed like every other message.

import { bool, int, literal, num, obj, str, validate } from "../protocol/validate.js";
import { LANGUAGES } from "../../runtime/i18n.js";

export const MAX_SEATS = 64;
// What the seat slider can be set to today; the rest of it is "coming later".
export const SEATS_AVAILABLE_NOW = 8;

// Who writes an AI government's reply to a player's message.
export const REPLY_MODES = Object.freeze(["host", "own"]);
// Who pays for the round's one AI request.
export const PAYMENT_MODES = Object.freeze(["host", "cycle"]);
// The most answers of the host's AI the host may give each player a round (`hostAnswers`).
export const HOST_ANSWERS_MAX = 50;
// Keys a record or a lobby from before they existed may lack: read as their
// default (normalizeSettings), never a reason to refuse the whole of it. A
// session record whose settings did not read was dropped whole, seats and all.
const LATER_KEYS = Object.freeze(["hostAnswers", "postsPerRound", "answersPerRound"]);
// The most Rostra posts the host may allow each player a round.
export const POSTS_PER_ROUND_MAX = 50;
// The languages a world can be written in (runtime/i18n.js LANGUAGES), by code.
export const WORLD_LANGUAGES = Object.freeze(LANGUAGES.map((entry) => entry.code));

export const DEFAULT_SETTINGS = Object.freeze({
  v: 1,
  name: "Open Historia game",
  seats: 8,
  roundMinutes: 20,
  readyThreshold: 2 / 3,
  countdownSeconds: 60,
  minPlanningSeconds: 0,
  afkSeconds: 0,
  daysPerRound: 30,
  leaverGraceMinutes: 5,
  allowMidGameJoin: true,
  cheats: "off",
  payment: "host",
  replies: "host",
  language: "",
  hostAnswers: 0,
  postsPerRound: 5,
  answersPerRound: 20,
});

export const SETTINGS_SCHEMA = obj({
  v: literal(1),
  name: str(60, { min: 1, pattern: /^\P{Cc}+$/u }),
  seats: int(2, MAX_SEATS),
  roundMinutes: int(1, 7 * 24 * 60),
  readyThreshold: num(0.5, 1),
  countdownSeconds: int(0, 3600),
  minPlanningSeconds: int(0, 3600),
  afkSeconds: int(0, 24 * 3600),
  daysPerRound: int(1, 3650),
  leaverGraceMinutes: int(0, 24 * 60),
  allowMidGameJoin: bool(),
  cheats: str(8, { enum: ["off", "host", "vote"] }),
  payment: str(8, { enum: PAYMENT_MODES }),
  replies: str(8, { enum: REPLY_MODES }),
  language: str(16, { enum: ["", ...WORLD_LANGUAGES] }),
  hostAnswers: int(0, HOST_ANSWERS_MAX),
  postsPerRound: int(1, POSTS_PER_ROUND_MAX),
  answersPerRound: int(0, HOST_ANSWERS_MAX),
}, LATER_KEYS);

// Whether the host may use the Game Master in this game (`cheats`).
export const gameMasterAllowed = (settings) => settings?.cheats === "host";

// What is wrong with one setting, in a sentence that names it, its bounds read
// from the schema itself so the words cannot drift from what is refused. A host
// who cleared or mistyped a number in "Host a lobby" was refused in the
// schema's own code ("$.roundMinutes: outside 1..10080").
const SETTING_PROBLEMS = Object.freeze({
  name: ({ max }) => `Give the lobby a name of up to ${max} characters.`,
  seats: ({ min, max }) => `Players must be a whole number from ${min} to ${max}.`,
  roundMinutes: ({ min, max }) => `Round length must be a whole number of minutes from ${min} to ${max}.`,
  readyThreshold: () => "Choose the share of players whose being ready starts the countdown.",
  countdownSeconds: ({ min, max }) => `The countdown must be a whole number of seconds from ${min} to ${max}.`,
  minPlanningSeconds: ({ min, max }) => `The least planning time must be a whole number of seconds from ${min} to ${max}.`,
  afkSeconds: ({ min, max }) => `The time before an idle player counts as ready must be a whole number of seconds from ${min} to ${max}.`,
  daysPerRound: ({ min, max }) => `Game time per round must be a whole number of days from ${min} to ${max}.`,
  leaverGraceMinutes: ({ min, max }) => `How long a leaver's country waits must be a whole number of minutes from ${min} to ${max}.`,
  hostAnswers: ({ min, max }) => `The messages your AI answers each player a round must be a whole number from ${min} to ${max}.`,
  postsPerRound: ({ min, max }) => `Rostra posts a player may make each round must be a whole number from ${min} to ${max}.`,
});
const SETTING_CHOICE = "Choose one of the choices offered for every setting.";

// Every setting that would be refused, in the form's order: [{ key, text }].
// The form shows each under its field; the engine refuses with the first.
export const settingsProblems = (input = {}) => {
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (input && Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) merged[key] = input[key];
  }
  if (typeof merged.name === "string") merged.name = merged.name.trim() || DEFAULT_SETTINGS.name;
  const problems = [];
  for (const [key, node] of Object.entries(SETTINGS_SCHEMA.props)) {
    if (validate(node, merged[key]).ok) continue;
    problems.push({ key, text: SETTING_PROBLEMS[key]?.(node) ?? SETTING_CHOICE });
  }
  if (!problems.some((problem) => problem.key === "seats") && Number(merged.seats) > SEATS_AVAILABLE_NOW) {
    problems.push({ key: "seats", text: `More than ${SEATS_AVAILABLE_NOW} players is coming later.` });
  }
  return problems;
};

// Settings the host typed, made whole and safe: unknown keys are dropped,
// anything out of range is refused with the reason in words (settingsProblems),
// and the seats are held to what can be played today.
export const normalizeSettings = (input = {}) => {
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (input && Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) merged[key] = input[key];
  }
  if (typeof merged.name === "string") merged.name = merged.name.trim() || DEFAULT_SETTINGS.name;
  const checked = validate(SETTINGS_SCHEMA, merged);
  if (!checked.ok) {
    const first = settingsProblems(merged)[0];
    return { ok: false, error: first?.text || SETTING_CHOICE, key: first?.key ?? "" };
  }
  if (checked.value.seats > SEATS_AVAILABLE_NOW) {
    return { ok: false, error: `More than ${SEATS_AVAILABLE_NOW} players is coming later.`, key: "seats" };
  }
  return { ok: true, settings: checked.value };
};

// The round machine's view of them (host/round.js).
export const roundSettingsOf = (settings) => ({
  roundMinutes: settings.roundMinutes,
  readyThreshold: settings.readyThreshold,
  countdownSeconds: settings.countdownSeconds,
  minPlanningSeconds: settings.minPlanningSeconds,
  afkSeconds: settings.afkSeconds,
});
