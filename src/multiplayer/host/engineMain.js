/*! Open Historia — the host's engine window © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A desktop host runs its shared game in a hidden window of its own
// (electron/main.cjs opens it on engine.html). This page owns the one real game,
// the host's active campaign. It takes requests from the players and from the
// host's own screen, runs the rounds with the game's own time skip, and sends
// every player their view. The host's ordinary window, meanwhile, plays the game
// like any other player (transport/loopback.js), so the host's screen shows only
// what the host's government may know.
//
// Nothing here renders: no map, no panels. The game's engine needs only the
// library catalog (which points the runtime at the active campaign) to run, as
// the offline harness shows.
//
// The host's screen opens the game with a control ("open", with its settings);
// until then this page waits.

import { getLibraryState, refreshLibraryCatalog } from "../../runtime/library.js";
import { JSON_URLS, loadRegionCatalog, readJson } from "../../runtime/assets.js";
import { setPolityFlag } from "../../runtime/polityFlags.js";
import { eventsFromLegacyChat, projectChatThread } from "../../runtime/chatThreads.js";
import {
  mutateActionsState,
  mutateAdvisorState,
  mutateCanonicalTurnState,
  mutateChatsState,
  mutateGameData,
  mutateInterceptsState,
  mutateSharedSessionState,
  mutateWorldState,
  readAdvisorMessages,
  readChatsState,
  readGameStateBundle,
  readWorldState,
} from "../../runtime/gameState.js";
import { filterToRenderedRegions } from "../../Game/AI/promptContext.js";
import { regionOwnerNow } from "../../runtime/gmAnnex.js";
import { landingEvents, tellLandings } from "./landings.js";
import { setHostingSharedGame } from "../../runtime/humanPolities.js";
import { discardHeldTurns, endSimulation, enterSimulation } from "../../Game/AI/simulationStatus.js";
import { getDebugLogEntries, logDebugEvent, setDebugLogPersistence, subscribeToDebugLog } from "../../runtime/debugLog.js";
import { GENERATION_COMPLETE_EVENT } from "../../Game/AI/telemetry.js";
import { applyGameMasterPreview, assessPoliticalLandscape, checkDemandReply, declineInteractiveOffer, ensureMilitaryFigures, hasCompiledParties, hasCountryStatSheet, maybeGeneratePregameHistory, maybeOpenScenarioFronts, previewGameMasterCommand, readCountryForPlayer, runChatActionBatch, setAsideActiveInteractive, simulateTimelineJump, takeCountryStatSheet, takeMilitaryRatings, takePoliticalLandscape, warRoomChart } from "../../Game/AI/gameplay.js";
import { finishGameStart } from "./gameStart.js";
import { installRoundCarrier } from "../../Game/AI/roundCarrier.js";
import { createLoopbackEngineSide } from "../transport/loopback.js";
import { createHostSession } from "../session/host.js";
import { probeNetwork } from "../transport/peer.js";
import { createInvite, parseInvite } from "../invite.js";
import { loadDeviceIdentity } from "../identity.js";
import { PLAYER_REQUESTS, SHARED_GAME_VERSION } from "../game/messages.js";
import { relayChannelFactory, usesCustomRelays } from "../signaling/relays.js";
import { describeClock, offsetClock, readSignalingClock } from "../client/clock.js";
import { createGameHost } from "./gameHost.js";
import { createInstitutionDesk } from "./institutions.js";
import { threadAfterTurn, turnWritesThread } from "./tableTurn.js";
import { commitInstitutionLifecycleCommand, ensureInstitutionLifecycleNegotiationChat } from "../../runtime/institutionLifecycle.js";
import { ensureInstitutionalChannel } from "../../runtime/institutionalChannels.js";
import {
  commitInstitutionGovernanceCommand,
  commitInstitutionalPlayerMessage,
  commitInstitutionalPlayerProposal,
  commitInstitutionalPlayerVoteRequest,
} from "../../runtime/institutionalGovernance.js";
import { commitWithVotingRuleBackfill } from "../../Game/AI/institutionGovernanceRetry.js";
import { normalizeSettings } from "./settings.js";
import { setWorldLanguage, writingLanguageCode } from "../../runtime/i18n.js";
import { getActiveFeatures, sharedGameFeaturesOf } from "../../runtime/gameFeatures.js";
import { credentialFromAddress, installWriteCredential } from "../../runtime/writeCredential.js";
import { sessionFromRecord } from "./sessionRecord.js";
import { roundRulesOf } from "./hostRules.js";
import { STAND_IN_NOT_SHARED, standInOf } from "../../runtime/standInGames.js";
import { getResolvedFallbackList, sharedRoundRefusal } from "../../Game/AI/providerConfig.js";
import { backgroundAiAllowance, requestSettings } from "../../Game/AI/requestBudget.js";
import { setHostReadsFigures } from "../../runtime/sharedReadings.js";
import { MAP_SETTING_KEYS, getMapSetting, getMapSettingDefaultOn } from "../../runtime/mapSettings.js";

const SCREEN = "host-screen";
// Why a game is not shared when its map's checksum cannot be read (openGame).
const MAP_UNCHECKED = "This game's map could not be read to check it against your guests' copies, so it is not shared: they could see another world. Check that its scenario is still in your library, then share it again.";
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// The one writer of the game it hosts (server/oneWriter.js): every write this
// window makes, and its workers ask it to make, carries the credential the app
// gave it in its address. Before anything else here can write.
installWriteCredential(credentialFromAddress());

// This window shares the app's storage with the host's own screen. Its log is
// sent there (see boot) and never stored from here, or the two windows would
// write over each other's stored copy.
setDebugLogPersistence(false);

// Nobody reads this window's console: what it warns of, and what goes wrong in
// it, goes in the log, which the host's screen is sent.
const captureConsole = () => {
  let inside = false;
  const record = (category, message, detail) => {
    if (inside) return;
    inside = true;
    try {
      logDebugEvent(category, message, detail, { problem: true });
    } finally {
      inside = false;
    }
  };
  for (const method of ["warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      const [first, ...rest] = args;
      record(method, typeof first === "string" ? first : String(first?.message ?? first), rest.length > 1 ? rest : rest[0]);
    };
  }
  window.addEventListener("unhandledrejection", (event) => record("crash", "Unhandled promise rejection", event.reason));
  window.addEventListener("error", (event) => record("crash", "Uncaught error", event.error ?? event.message));
};

// The game's own documents, through the game's own readers and its queued
// writers (gameState.js mutate*), so a request never races a turn.
const store = {
  read: async () => {
    const [bundle, intercepts, colors, flags, advisor] = await Promise.all([
      readGameStateBundle({ force: true }),
      readJson(JSON_URLS.intercepts, { defaultValue: {}, force: true }),
      readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
      readJson(JSON_URLS.flags, { defaultValue: {}, force: true }),
      // Every seat's advisor conversation (runtime/seatAdvisors.js); null when
      // it could not be read, which no view shows as an empty one.
      readAdvisorMessages({ force: true }).catch(() => null),
    ]);
    return {
      world: bundle.world,
      game: bundle.game,
      events: bundle.events,
      chat: bundle.chats,
      actions: bundle.actions,
      intercepts,
      colors,
      flags,
      advisor,
    };
  },
  updateActions: (fn) => mutateActionsState(fn),
  updateChats: (fn) => mutateChatsState(fn),
  updateWorld: (fn) => mutateWorldState(fn),
  updateGame: (fn) => mutateGameData(fn),
  // The agents' traffic, one table per spymaster (runtime/spycraft.js).
  updateIntercepts: (fn) => mutateInterceptsState(fn),
  // Every seat's advisor conversation, the host's own the file itself
  // (runtime/seatAdvisors.js): this window is its one writer while the game
  // is shared, as of the rest (server/oneWriter.js).
  updateAdvisor: (fn) => mutateAdvisorState(fn),
  // The world and the order queue changed together or not at all (a formation
  // and the order that tells the skip of it; a peace and the event that tells
  // it, host/landings.js): one commit, as a turn's own is.
  // `fn({ world, actions, game, events })` returns the documents it changed, or null.
  updateForces: (fn) => mutateCanonicalTurnState(({ world, actions, game, events }) => fn({ world, actions, game, events }) || null),
  // And the threads with them: what a seat's person left waiting while nobody
  // shares the game, held and given back in one commit (host/heldSeats.js).
  updateGameDocs: (fn) => mutateCanonicalTurnState(({ world, actions, game, events, chats }) => fn({ world, actions, game, events, chats }) || null),
  // The shared game's session, kept with the campaign (host/sessionRecord.js).
  // Only this window writes it, in the host's one order, through the game's
  // own write queue.
  readShared: () => readJson(JSON_URLS.shared, { defaultValue: {}, force: true }),
  writeShared: (record) => mutateSharedSessionState(() => record),
};

// The game's countries: the game's own, every polity that holds land on the
// map, and every one whose record says it is active. All of them: a seat whose
// country is not here is gone (host/foundings.js seatSuccessions), so a list
// cut short would take countries from their players. The lobby sends the first
// 600 (host/gameHost.js).
const gameCountries = (world, game) => {
  const owners = new Set([clean(game?.country)]);
  for (const owner of Object.values(world?.regionOwnershipOverrides ?? {})) if (clean(owner)) owners.add(clean(owner));
  for (const [key, entry] of Object.entries(world?.polityOverrides ?? {})) {
    if (clean(entry?.status || "active").toLowerCase() === "active") owners.add(clean(entry?.name || entry?.code || key));
  }
  return [...owners].filter(Boolean).sort((a, b) => a.localeCompare(b));
};
// A polity of this game, as the game names it, by the name a player's screen
// gave; throws when it is none.
const countryOfGame = async (country) => {
  const now = await store.read();
  const name = gameCountries(now.world, now.game).find((known) => clean(known).toLocaleLowerCase() === clean(country).toLocaleLowerCase());
  if (!name) throw new Error("That is not a country of this game.");
  return name;
};

// One invite token per campaign, kept until the host rotates it, so a host that
// closes and reopens its game keeps the same link.
const inviteKey = (campaign) => `oh:mp:invite:${campaign}`;
const loadInvite = (campaign, identity) => {
  try {
    const stored = localStorage.getItem(inviteKey(campaign));
    if (stored) {
      const parsed = parseInvite(stored);
      if (parsed.hostKey === identity.id) return parsed;
    }
  } catch {
    // a missing or damaged token is replaced below
  }
  return rotateInvite(campaign, identity);
};
const rotateInvite = (campaign, identity) => {
  const invite = createInvite(identity.publicKey);
  try {
    localStorage.setItem(inviteKey(campaign), invite.token);
  } catch {
    // unsaved: the token still works until this window closes
  }
  return invite;
};

// Every change the engine makes to the shared game is an entry in the host's
// one queue (host/worldQueue.js), the round's skip among them. Set while a game
// is shared; written at once otherwise.
let writeInOrder = (label, write) => write();

// What the governments at a table decided, written, and a peace it made (a
// leader took a seat's terms of peace: gameplay.js answerPeaceInChat) told as
// one two players make between rounds is (host/landings.js): an event on the
// timeline with the borders it moved. `landed` gathers the events, for the
// host to tell every player. Read only when the decisions are written: the
// world before them, and after.
const decidedAndTold = async (write, landed) => {
  const before = await readWorldState({ force: true });
  const out = await write();
  const after = await readWorldState({ force: true });
  if (!landingEvents(before, after).length) return out;
  const regions = await loadRegionCatalog().then((catalog) => filterToRenderedRegions(catalog, after)).catch(() => []);
  const baked = new Map(list(regions).map((region) => [clean(region?.id), region]));
  await mutateCanonicalTurnState(({ world, events, game }) => {
    const told = tellLandings({ before, after: world, events, game, ownerOf: (id) => (baked.has(id) ? regionOwnerNow(baked.get(id), {}) : "") });
    if (!told) return null;
    landed.push(...told.landed);
    return { world: told.world, events: told.events };
  });
  return out;
};

// One turn of a table for a seat: the AI governments at it answer (or a
// Council or a hearing does its business, with the flags the chat panel's own
// turn passes). The model is asked outside the queue; what the governments
// decided and what they said are written in it, the said added to the thread
// as it stands then (host/tableTurn.js). `landed`: a peace it made, told.
const tableTurn = async ({ chat, seat, ...flags }) => {
  const chatId = clean(chat?.id);
  const landed = [];
  const outcome = await runChatActionBatch({
    chat,
    playerCountry: seat,
    useCanonicalState: true,
    commit: (write) => writeInOrder("table-decided", () => decidedAndTold(write, landed)),
    ...flags,
  });
  if (landed.length && outcome && typeof outcome === "object") outcome.landed = landed;
  if (!turnWritesThread(outcome)) return outcome;
  await writeInOrder("table-said", () => mutateChatsState((current) => list(current).map((entry) => (clean(entry?.id) === clean(chatId)
    ? threadAfterTurn(entry, outcome)
    : entry))));
  return outcome;
};

// The AI governments at a table answer the line a seat has just written
// (settings.replies "host"). `unreachable`: the model could not be reached, so
// nobody answered, which the host tells the writer (host/gameHost.js).
const replyTo = async ({ chatId, seat }) => {
  const chats = await readChatsState({ force: true });
  const chat = list(chats).find((entry) => clean(entry?.id) === clean(chatId));
  if (!chat) return null;
  const lastLine = [...list(chat.messages)].reverse().find((message) => clean(message?.speaker || message?.code) === clean(seat));
  const outcome = await tableTurn({ chat, seat, playerMessage: clean(lastLine?.text) });
  await checkDemandsAfter({ chatId, seat, lastLine });
  return { unreachable: outcome?.generation?.source === "fallback", landed: list(outcome?.landed) };
};

// What the reply did about a demand, in the one-on-one thread between a seat
// and its own Overlord or Puppet: the game's own check (gameplay.js
// checkDemandReply, one small request, and none in any other thread), as single
// player runs it after each such reply, for that seat. Its events join the
// thread's log in the host's order.
const checkDemandsAfter = async ({ chatId, seat, lastLine }) => {
  const chat = list(await readChatsState({ force: true })).find((entry) => clean(entry?.id) === clean(chatId));
  // The answer: the first line after the seat's own that is not the seat's and is no error.
  const lines = list(chat?.messages);
  const from = lines.findIndex((message) => clean(message?.id) && clean(message?.id) === clean(lastLine?.id));
  const reply = lines.slice(from + 1).find((message) => clean(message?.speaker || message?.code) && clean(message?.speaker || message?.code) !== clean(seat) && !["error", "user"].includes(clean(message?.role)));
  if (!chat || from < 0 || !reply) return;
  const events = await checkDemandReply({ chat, speaker: clean(reply.speaker || reply.code), reply: clean(reply.text), answering: clean(lastLine.text), messageId: clean(reply.id), time: clean(reply.time), player: seat }).catch(() => []);
  if (!events.length) return;
  await writeInOrder("demand-checked", () => mutateChatsState((current) => list(current).map((entry) => {
    if (clean(entry?.id) !== clean(chatId)) return entry;
    const log = [...(list(entry.events).length ? list(entry.events) : eventsFromLegacyChat(entry)), ...events];
    return { ...entry, events: log, demands: projectChatThread(log).demands };
  })));
};

const boot = async () => {
  await refreshLibraryCatalog({ force: true });
  const identity = loadDeviceIdentity(localStorage);
  let gameHost = null;
  let session = null;
  let token = "";
  let campaign = "";
  let relays = null;
  // People the lobby's player list does not show: those whose connection is
  // being opened, and those the host answered whose connection never opened
  // (session/host.js report). The host's screen names them, because a lobby
  // nobody can get into otherwise looks like one nobody came to.
  let people = { joining: [], unreachable: [], clockRefused: false };
  // What this computer's own network looks like to a player connecting in
  // (transport/peer.js probeNetwork): "" until it is known.
  let network = "";
  let hostStatus = null;
  let failure = "";
  // Finishing the game's start before anyone joins (host/gameStart.js): its
  // backstory may be a request to the host's AI, which takes a while.
  let preparing = false;
  // The fronts a scenario begins with, tried again before each round when they
  // could not be built yet; asks nothing.
  const openPendingFronts = () => finishGameStart({
    fronts: () => maybeOpenScenarioFronts(),
    read: () => store.read(),
    log: (text, detail) => logDebugEvent("shared game", `${text}: ${detail}`, undefined, { problem: true }),
  });
  // Stops reading the host's AI settings for the lobby (openGame).
  let forgetRules = () => {};
  // The Game Master at work on the host's command (control "gm"), for the
  // host's screen to say so.
  let gameMasterBusy = false;

  const loopback = createLoopbackEngineSide({
    onHello: ({ device, name }) => {
      // The host's screen is this device, on this origin; nothing else is.
      if (device !== identity.id || !gameHost) return;
      gameHost.join({ id: SCREEN, device, name });
    },
    onRequest: (message) => gameHost?.receive({ id: SCREEN, device: identity.id, name: "" }, message),
    onBye: () => gameHost?.leave({ id: SCREEN }),
    onControl: (action, args) => {
      void control(action, args).catch((error) => {
        failure = String(error?.message || error);
        report();
      });
    },
  });

  // Every AI call of a shared game is made in this window. The host's own
  // screen is told as each one finishes, and is sent what this window logs: its
  // AI debug console and its diagnostics log then cover the game it hosts.
  window.addEventListener(GENERATION_COMPLETE_EVENT, (event) => loopback.ai(event.detail ?? {}));
  captureConsole();
  let logged = getDebugLogEntries().at(-1)?.seq ?? 0;
  subscribeToDebugLog(() => {
    const fresh = getDebugLogEntries().filter((entry) => entry.seq > logged);
    if (!fresh.length) return;
    logged = fresh.at(-1).seq;
    loopback.log(fresh);
  });

  // Plain JSON only: the screen checks it, and refuses a status with anything
  // else in it (an undefined field included).
  const report = () => {
    const { settings: _settings, ...round } = hostStatus?.round ?? {};
    const players = gameHost?.status().players ?? [];
    loopback.status({
      open: Boolean(gameHost),
      token,
      campaign,
      relays: relays ?? null,
      error: failure || null,
      preparing,
      lobby: hostStatus?.lobby ?? null,
      round: hostStatus?.round ? round : null,
      players,
      // In, and yet to take a country: the player list shows only seats.
      choosing: players.filter((player) => player.id !== SCREEN && !player.seat).map((player) => clean(player.name)).filter(Boolean).slice(0, 64),
      joining: people.joining,
      unreachable: people.unreachable,
      clockRefused: people.clockRefused === true,
      network,
      gameMasterBusy,
    });
  };

  // The host's screen asks until it is answered, and the game's documents take
  // a moment to read (longer on a busy machine): every ask made meanwhile is
  // the same opening, never a second game beside the first.
  let opening = null;
  const open = (args = {}) => {
    if (gameHost) return report();
    opening ??= openGame(args).finally(() => {
      opening = null;
    });
    return opening;
  };

  const openGame = async ({ settings: input, name } = {}) => {
    const checked = normalizeSettings(input ?? {});
    if (!checked.ok) throw new Error(checked.error);
    const docs = await store.read();
    // A stand-in shows a shared game this device joined: it is no game to share
    // (runtime/standInGames.js), whatever it is called.
    if (standInOf(docs.game)) throw new Error(STAND_IN_NOT_SHARED);
    // Every round is asked of this computer's AI, which an Agent Connection
    // never answers there (#1042): a list that cannot answer a round is refused
    // now, not after everyone has joined a lobby whose every round fails.
    const noAi = sharedRoundRefusal(getResolvedFallbackList());
    if (noAi) throw new Error(noAi);
    // The world's language, a rule of the game (host/settings.js `language`):
    // the one the host plays in unless the host chose another, named in the
    // lobby so every screen writes in it, this window's requests first.
    const settings = { ...checked.settings, language: checked.settings.language || writingLanguageCode(docs.world?.language || docs.game?.language) };
    setWorldLanguage(settings.language);
    // The host's own country; it changes if the host's people found one of
    // their own (host/foundings.js).
    let host = clean(docs.game?.country);
    if (!host) throw new Error("Open a game with a country before sharing it.");
    // A shared game plays no interactive scene (the owner, 2026-11-15: left out
    // of shared games until designed for several players). One the host left in
    // progress would stop every round ("An interactive event is in
    // progress"), and nobody's screen could end it: it is set aside, ending with
    // nothing written, and an offer still waiting is let pass.
    if (docs.world?.activeInteractive) await setAsideActiveInteractive();
    if (docs.world?.interactiveOffer) await declineInteractiveOffer();
    // The game's start, finished here before anyone joins (host/gameStart.js):
    // its backstory and the fronts its scenario begins with, the calls single
    // player makes when its player first enters the game, which no page of a
    // shared game may make. In the world's language, set above. Nothing to do
    // for a game already under way. The readings the game makes by itself
    // follow who answers from here, its fronts' too (runtime/sharedReadings.js).
    setHostReadsFigures(settings.replies !== "own");
    preparing = true;
    report();
    const startProblems = await finishGameStart({
      backstory: () => maybeGeneratePregameHistory(),
      fronts: () => maybeOpenScenarioFronts(),
      read: () => store.read(),
      log: (text, detail) => logDebugEvent("shared game", `${text}: ${detail}`, undefined, { problem: true }),
    }).finally(() => {
      preparing = false;
    });
    // The game as its start left it.
    const started = await store.read();
    // The game and its scenario, as the library knows them: a player must open
    // the same scenario to see the same map.
    const library = getLibraryState();
    const entry = list(library.games).find((game) => game?.id === library.activeGameId) ?? null;
    const scenario = list(library.scenarios).find((candidate) => candidate?.id === entry?.scenarioId) ?? null;
    campaign = clean(library.activeGameId) || clean(host);
    const invite = loadInvite(campaign, identity);
    token = invite.token;
    // The session this game saved when it was last shared, taken up again: its
    // seats are their devices' (host/sessionRecord.js). A record that does not
    // read, or is another campaign's or another host's, is not used.
    const fingerprint = await fetch(`/api/scenarios/${encodeURIComponent(clean(entry?.scenarioId))}/fingerprint`)
      .then((response) => (response.ok ? response.json() : null))
      .then((answer) => (/^[0-9a-f]{64}$/.test(String(answer?.fingerprint || "")) ? String(answer.fingerprint) : ""))
      .catch(() => "");
    // A map that cannot be checked is not shared: a host with no checksum
    // hosted all the same, and each guest drew whatever its library held under
    // the scenario's id or name (the review of 2026-11-18, wars 10).
    if (!fingerprint) {
      logDebugEvent("shared game", "this game's map has no checksum: it is not shared, as no guest's copy could be checked against it", undefined, { problem: true });
      throw new Error(MAP_UNCHECKED);
    }
    // What decides each round on this computer beyond the lobby's settings
    // (host/hostRules.js), stated in the lobby: the game's difficulty and this
    // device's AI settings, read again whenever the host changes one in its own
    // window, which shares this one's storage.
    const readRules = () => roundRulesOf({
      difficulty: docs.game?.difficulty,
      daysPerRound: settings.daysPerRound,
      noRequestLimit: requestSettings.noRequestLimit(),
      lookups: getMapSettingDefaultOn(MAP_SETTING_KEYS.lookupFunctions),
      segmented: getMapSetting(MAP_SETTING_KEYS.chunkLongJumps),
      limitGeneration: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration),
    });
    const saved = await store.readShared().catch(() => null);
    const restored = sessionFromRecord(saved, { campaign, hostDevice: identity.id });
    if (restored) logDebugEvent("shared game", `taking up the session saved with this game: round ${restored.round}, ${restored.seats.length} seat(s)`);
    gameHost = createGameHost({
      transport: {
        send: (playerId, message) => (playerId === SCREEN ? loopback.send(message) : session?.send(playerId, message)),
      },
      settings,
      hostSeat: { device: identity.id, name: clean(name) || "Host", country: host },
      // Its map by checksum (server/scenarioFingerprint.js): each guest's copy
      // must be this map, or it draws another world.
      scenario: { id: clean(entry?.scenarioId).slice(0, 120), name: clean(scenario?.name || entry?.name || "Open Historia").slice(0, 120), hash: fingerprint },
      features: sharedGameFeaturesOf(getActiveFeatures()),
      rules: readRules(),
      countries: gameCountries(started.world, started.game),
      countriesOf: (now) => gameCountries(now.world, now.game),
      campaign,
      restored,
      campaignRound: Number(started.game?.round) || 0,
      store,
      resolveRound: async ({ daysPerRound, signal, carry = null, payer = null }) => {
        // Fronts the game began with that could not be built when it opened.
        await openPendingFronts();
        // The game's own lock, waited for and taken in one step: a stat sheet
        // being written is waited out, and none is written until the round has
        // landed (it is an entry in the queue already, so nothing else is).
        await enterSimulation({ signal });
        try {
          // Every other player's own open projects are moved by the skip as the
          // host's are: lent to the game's board in the skip's own copy of the
          // world, and home in its one commit (runtime/seatBoards.js). Nothing
          // is written for it here, so an engine closed during the round leaves
          // no player's work on the host's board.
          // A round another player's device pays (settings.payment "cycle"):
          // its skip's requests go, as built, to that device and its answer
          // comes back to be applied here as ever (Game/AI/roundCarrier.js);
          // and the skip spends by that device's own settings, as it stated
          // them (`payer.rules`), not this computer's.
          const uncarry = carry ? installRoundCarrier(carry, { rules: payer?.rules ?? null, who: payer?.device ?? "" }) : () => {};
          try {
            // Never a canned turn in a shared game: a skip the AI could not
            // write fails, and the round says why (host/round.js).
            await simulateTimelineJump({ days: daysPerRound, signal, cannedTurn: false });
          } catch (error) {
            // A skip that failed part-way may have held its turn for a Retry (a
            // segment that did not come back, the Projects board). Nobody can
            // press it here: the turn is let go, so the game is not left busy,
            // and the round goes back to planning with its orders (host/round.js).
            discardHeldTurns();
            throw error;
          } finally {
            uncarry();
          }
        } finally {
          endSimulation();
        }
      },
      // A country's stat sheet for a player whose Stats pane has none: only
      // for a polity of this game, and the game's own reading writes it on the
      // host's AI key. One there already stands (nothing is read again in a
      // shared game).
      readCountry: async ({ country }) => {
        await readCountryForPlayer(await countryOfGame(country));
      },
      hasSheet: async (country) => hasCountryStatSheet(await countryOfGame(country)),
      // The sheet a player's own device wrote, on its own AI key.
      takeSheet: async ({ country, sheet, continuity, rating }) => takeCountryStatSheet({ name: await countryOfGame(country), sheet, continuity, rating }),
      // Countries' military figures a player's Stats pane wants, rated on the
      // host's AI: each request's figures written in the host's one order, so
      // every view follows as they come. And those a player's own device
      // rated, taken inside the request's own entry.
      // A rating is background work on this device's AI, under its day's cap
      // (requestBudget.js backgroundAllowance): one it declines is said, with
      // why, to the player who asked (host/gameHost.js "ratings").
      rateMilitary: async ({ countries }) => {
        const declined = () => (backgroundAiAllowance().allowed ? null : { refused: "The host's AI has made all the background readings it makes in a day: the rest of these figures wait until tomorrow." });
        if (declined()) return declined();
        await ensureMilitaryFigures(countries, {
          reason: "a player's Stats pane",
          commit: (read) => writeInOrder("ratings", () => takeMilitaryRatings(read)),
        });
        return declined();
      },
      takeRatings: (ratings) => takeMilitaryRatings(ratings),
      // The map as this game's own engine reads it, for the war room's lines and fleets.
      readChart: () => warRoomChart(),
      // Its cities, for a city struck from the air: the host's own, never a page's.
      readCities: () => readJson(JSON_URLS.citiesGeojson, { defaultValue: null }),
      // A country's parties filled in on the host's AI, when they are not.
      compileParties: async ({ country }) => {
        if (!(await hasCompiledParties(country))) await assessPoliticalLandscape(country);
      },
      hasParties: (country) => hasCompiledParties(country),
      takeParties: ({ country, landscape }) => takePoliticalLandscape({ name: country, landscape }),
      // A country's flag, as the game sets one.
      setFlag: async ({ country, image }) => {
        const docs = await store.read();
        await setPolityFlag({ polity: country, world: docs.world, dataUrl: image });
      },
      replyTo,
      // The Game Master's command (host/gameMaster.js), as the Cheats panel's
      // console runs one: its preview asked of the host's AI, then applied at
      // once, its fingerprint checked against the world as it stands. The host
      // reads what it changed in the notice every player is sent.
      gameMaster: async ({ command }) => applyGameMasterPreview(await previewGameMasterCommand(command)),
      // A player's institution business, run here for their country. Each
      // thing it writes is an entry in the queue; a Council's or a hearing's
      // turn asks the AI outside it (tableTurn).
      institution: createInstitutionDesk({
        host: () => host,
        game: {
          lifecycle: (args) => writeInOrder("institution-business", () => commitInstitutionLifecycleCommand(args)),
          negotiation: (args) => writeInOrder("institution-business", () => ensureInstitutionLifecycleNegotiationChat(args)),
          channel: (args) => writeInOrder("institution-business", () => ensureInstitutionalChannel(args)),
          proposal: (args) => writeInOrder("institution-business", () => commitInstitutionalPlayerProposal(args)),
          voteRequest: (args) => writeInOrder("institution-business", () => commitWithVotingRuleBackfill(
            () => commitInstitutionalPlayerVoteRequest(args),
            { institutionId: args.institutionId, proposalId: args.proposalId },
          )),
          governance: (args) => writeInOrder("institution-business", () => commitInstitutionGovernanceCommand(args)),
          message: (args) => writeInOrder("institution-business", () => commitInstitutionalPlayerMessage(args)),
          chatTurn: (args) => tableTurn(args),
          readChats: () => readChatsState({ force: true }),
          updateChats: (fn) => writeInOrder("institution-business", () => mutateChatsState(fn)),
        },
      }),
      onStatus: (status) => {
        hostStatus = status;
        // The readings the game makes by itself follow who answers (runtime/sharedReadings.js).
        setHostReadsFigures(status?.lobby?.settings?.replies !== "own");
        report();
      },
      // The host's people founded a country: the engine plays it as the host's.
      onSeatsMoved: (moves) => {
        const mine = moves.find((move) => move.host);
        if (!mine) return;
        host = mine.to;
        setHostingSharedGame(true, { host });
      },
      log: (level, text, detail) => console[level === "warn" ? "warn" : "info"](`[shared game] ${text}`, detail ?? ""),
    });
    // The relays' time, which the lobby's signaling is stamped by
    // (client/clock.js): a host whose clock is out cannot be found at all.
    const clock = await readSignalingClock({ customRelays: usesCustomRelays() });
    if (clock.offsetMs) logDebugEvent("shared game", describeClock(clock));
    session = createHostSession({
      invite,
      host: identity,
      channelFactory: relayChannelFactory,
      now: offsetClock(clock.offsetMs),
      room: { name: settings.name, seats: settings.seats, version: SHARED_GAME_VERSION },
      appMessages: PLAYER_REQUESTS,
      // A device the host banned from this game, saved with it, is turned away
      // before it connects.
      isBanned: (device) => gameHost?.isBanned(device) ?? false,
      // Who may come in is the game's to say: a player whose device holds a
      // seat always may (host/seats.js hasRoom).
      roomFor: (device) => gameHost?.roomFor(device) ?? false,
      openSeats: () => gameHost?.openSeats() ?? 0,
      // A player of the game is let through however many others ask to join.
      knows: (device) => gameHost?.isMember(device) ?? false,
      // A connection closing after "stop" still reports its leaving.
      onJoin: (player) => gameHost?.join(player),
      onLeave: (player) => gameHost?.leave(player),
      onMessage: (player, message) => gameHost?.receive(player, message),
      onStatus: (status) => {
        relays = status?.relays ?? status ?? null;
        people = {
          joining: list(status?.joining).map(clean).filter(Boolean).slice(0, 64),
          unreachable: list(status?.unreachable).map(clean).filter(Boolean).slice(0, 64),
          clockRefused: status?.clockRefused === true,
        };
        report();
      },
      // Who asked to join, who was answered and who never got through: this
      // window's log is sent to the host's screen, whose diagnostics log is
      // the one a report is made from.
      log: (text) => logDebugEvent("shared game", text),
    });
    // From here this window is the game's host: the engine reads who people
    // play from the game (runtime/humanPolities.js), and nowhere else does.
    setHostingSharedGame(true, { host });
    // And every change it makes is applied in the host's one order.
    const hosting = gameHost;
    writeInOrder = (label, write) => hosting.write(label, write);
    const rulesChanged = () => hosting.control.setRules(readRules());
    window.addEventListener("storage", rulesChanged);
    forgetRules = () => window.removeEventListener("storage", rulesChanged);
    gameHost.start();
    session.start();
    // What of the game's start could not be done, said to the host.
    failure = startProblems.join(" ");
    report();
    void probeNetwork().then((kind) => {
      network = kind;
      logDebugEvent("shared game", `this computer's network, by its own candidates: ${kind}`);
      report();
    });
  };

  const control = async (action, args) => {
    if (action === "open") return open(args ?? {});
    if (!gameHost) return undefined;
    switch (action) {
      case "start": return gameHost.control.start();
      case "pause": return gameHost.control.pause();
      case "resume": return gameHost.control.resume();
      case "resolveNow": return gameHost.control.resolveNow();
      // Who answers for the AI's governments from here on (host/settings.js `replies`).
      case "replies": return gameHost.control.setReplies(clean(args?.mode));
      // And how many answers of the host's AI each player has a round with their own (`hostAnswers`).
      case "hostAnswers": return gameHost.control.setHostAnswers(Number(args?.count));
      // The host pays the round being planned itself, and runs it (settings.payment "cycle").
      case "payRound": return gameHost.control.payRound();
      // The Game Master's command (host/gameMaster.js): one at a time.
      case "gm": {
        if (gameMasterBusy) return undefined;
        gameMasterBusy = true;
        report();
        try {
          return await gameHost.control.gameMaster(String(args?.command ?? ""));
        } finally {
          gameMasterBusy = false;
          report();
        }
      }
      case "kick": {
        // The country is taken back; with `ban` its player's device is kept
        // out of this game for good (saved with it), and sent away now.
        const ban = args?.ban === true;
        const device = gameHost.control.kick(clean(args?.country), { ban });
        const player = session?.players().find((entry) => entry.device === device);
        if (player && ban) session.kick(player.id, { ban: true });
        return undefined;
      }
      // A player's change of country, allowed or refused (the owner's decision 12).
      case "seat": return gameHost.control.seat({ op: clean(args?.op), from: clean(args?.from) });
      case "cancelRound": return gameHost?.control.cancelRound();
      case "rotate": {
        const next = rotateInvite(campaign, identity);
        token = next.token;
        session?.rotate(next);
        return report();
      }
      case "stop": {
        // No request is taken from here on, and a connection closing late
        // changes nothing; then the save is single player again, before this
        // window goes.
        const stopping = gameHost;
        gameHost = null;
        forgetRules();
        session?.stop();
        session = null;
        await stopping.stop();
        writeInOrder = (label, write) => write();
        setHostingSharedGame(false);
        setWorldLanguage("");
        setHostReadsFigures(true);
        report();
        loopback.close();
        await fetch("/api/multiplayer/engine/close", { method: "POST" }).catch(() => {});
        return undefined;
      }
      default:
        return undefined;
    }
  };

  report();
};

boot().catch((error) => {
  console.error("[shared game] the engine window could not start:", error);
});
