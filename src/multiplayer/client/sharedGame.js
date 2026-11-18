/*! Open Historia — this page's shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// At most one shared game per page, hosted or joined:
//
//   hosting (desktop): the page asks the app to open the hidden engine window
//     (host/engineMain.js), opens the active game in it with the host's
//     settings, and from then on plays it over the loopback like any player;
//   joining: the page opens a WebRTC session with an invite token, makes (or
//     reuses) a local game of the host's scenario to draw the map from, and
//     plays the host's game through it.
//
// Either way the page then reads only its view (client/remoteRuntime.js) and
// sends requests (client/gameClient.js); it never writes the game. What the
// game's own screens save is read for the few things that are the player's own
// to change (client/seatWrites.js): those are asked of the host or kept on this
// device, and the rest of the save changes nothing.
//
// The signaling relays are signaling/relays.js's (a local one for tests).

import { useSyncExternalStore } from "react";
import { JSON_URLS, publishJsonWriteBatch } from "../../runtime/assets.js";
import { activateGame, createGame, getLibraryState, libraryStandIns, refreshLibraryCatalog, setSharedGameEntry } from "../../runtime/library.js";
import { closeStandIn, holdStandIn, standInMark } from "../../runtime/standInGames.js";
import { normalizeActions, normalizeChats, normalizeEvents, normalizeGameData, normalizeWorldState } from "../../runtime/gameState.js";
import { unseenEvents } from "../../runtime/unseenEvents.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { GENERATION_COMPLETE_EVENT, adoptStoredAiRecord } from "../../Game/AI/telemetry.js";
import { UNROUTED_NOTICE, planGameWrite, planWorldWrite, revealedTurnOf, suggestionsOutlived, unroutedChanges, unroutedRefusal } from "./seatWrites.js";
import { createGameClient } from "./gameClient.js";
import { remoteRuntimeActive, startRemoteRuntime, stopRemoteRuntime } from "./remoteRuntime.js";
import { setSharedAdvisorRefusal, setSharedGamePeople, setSharedGameRole, setSharedGameSettings, setSharedNotices, setSharedRequester, setSharedRequestsHeld, setSharedRoundBase, setSharedRoundDays, SHARED_ROUND_LANDED } from "./sharedGameBridge.js";
import { roundBaseOf } from "./roundBase.js";
import { createRoundPayer } from "./roundPayer.js";
import { createLoopbackScreenSide } from "../transport/loopback.js";
import { createClientSession } from "../session/client.js";
import { PLAYER_MESSAGE_MAX_CHARS } from "../protocol/codec.js";
import { probeNetwork } from "../transport/peer.js";
import { hostingHere, joinFailure, scenarioDiffers, scenarioMissing, scenarioUnchecked, unreadableFromHost } from "./joinProgress.js";
import { chooseStandInScenario } from "./standIn.js";
import { setSharedGameFeatures } from "../../runtime/gameFeatures.js";
import { setWorldLanguage } from "../../runtime/i18n.js";
import { relayChannelFactory, usesCustomRelays } from "../signaling/relays.js";
import { describeClock, offsetClock, readSignalingClock } from "./clock.js";
import { loadDeviceIdentity } from "../identity.js";
import { parseInvite } from "../invite.js";
import { HOST_MESSAGES, SHARED_GAME_VERSION } from "../game/messages.js";
import { advisorChangesOf } from "../game/advisorChanges.js";

const IDLE = Object.freeze({
  mode: "off", // off | opening | lobby | playing | ended
  role: "", // host | guest
  token: "",
  lobby: null,
  round: null,
  notices: [],
  connection: "", // the session's state, or "loopback"
  // What a guest's session knows while it joins (session/client.js onState):
  // { heard, failures }. The lobby says which step it is on (joinProgress.js).
  detail: null,
  // What this device can tell about its own network (transport/peer.js
  // probeNetwork): "" | open | symmetric | blocked | unknown.
  network: "",
  engine: null, // the host's engine status (hosting only)
  // A guest's local game of the host's scenario, which the map is drawn from:
  // "" | preparing | ready. Countries are offered only once it is ready, so
  // the page never shows its own game where the shared one should be.
  standIn: "",
  // The game's date as this page's view has it (the round bar, ui/SharedGameOverlay.jsx).
  date: "",
  // When the player last opened the host's notices (under Players): those
  // since are marked new.
  noticesReadAt: 0,
  error: "",
});

let state = IDLE;
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener(state);
};

export const getSharedGame = () => state;
export const subscribeSharedGame = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useSharedGame = () => useSyncExternalStore(subscribeSharedGame, getSharedGame, getSharedGame);
export const sharedGameActive = () => state.mode !== "off" && state.mode !== "ended";

let current = null; // { client, runtime, gameId, session?, screen?, pendingViews: [] }

// How long the host's screen waits for its engine window to open the game.
const ENGINE_START_MS = 120_000;
// This tab hosts a shared game: kept for the tab alone (sessionStorage), so a
// reload comes back to it as the host's screen (resumeHosting), and another
// tab or window of the same app does not.
const HOSTING_KEY = "oh:mp:hosting";
const rememberHosting = (name) => {
  try {
    sessionStorage.setItem(HOSTING_KEY, JSON.stringify({ name: String(name || "Host").slice(0, 40) }));
  } catch {
    // a reload then finds the game single player, refused by the server
  }
};
const forgetHosting = () => {
  try {
    sessionStorage.removeItem(HOSTING_KEY);
  } catch {
    // nothing kept
  }
};
const hostingRemembered = () => {
  try {
    return JSON.parse(sessionStorage.getItem(HOSTING_KEY) || "null");
  } catch {
    return null;
  }
};

const deviceIdentity = () => loadDeviceIdentity(localStorage);

// The page's caches take each view the way they take a finished turn.
const beginRuntime = (onWrite) => startRemoteRuntime({
  publish: (entries) => publishJsonWriteBatch(entries),
  urlFor: (key) => JSON_URLS[key] || "",
  onWrite,
});

// What the round bar says: the host's notices (client/gameClient.js) and this
// page's own, in the order they were said. Every screen that shows one where it
// was asked for (a conversation, client/threadNotes.js) reads them too.
const noticesNow = () => {
  const notices = [...(current?.hostNotices ?? []), ...(current?.ownNotices ?? [])]
    .sort((left, right) => (left.at || 0) - (right.at || 0))
    .slice(-20);
  setSharedNotices(notices);
  return notices;
};

// The player opened the host's notices: none is new any more.
export const markNoticesRead = () => {
  const newest = state.notices.at(-1)?.at || 0;
  if (newest > state.noticesReadAt) set({ noticesReadAt: newest });
};

// This page's own word to its player. The same thing twice in a row is said once.
const notify = (text, level = "warn") => {
  if (!current) return;
  const own = current.ownNotices ?? [];
  const last = own.at(-1);
  if (last?.text === text && Date.now() - (last.at || 0) < 20_000) return;
  current.ownNotices = [...own, { level, text, at: Date.now() }].slice(-20);
  set({ notices: noticesNow() });
};

// The player's own Projects board, asked of the host. The page shows it at
// once; the host's next view of the world then carries it, or the host's
// reason for refusing puts the board back as it was.

// A document in the shape the page's own writers save it in, which is the
// shape their caches expect back (runtime/assets.js writeJson).
const asThePageSavesIt = (key, value) => {
  if (key === "world") return normalizeWorldState(value);
  if (key === "chat") return normalizeChats(value);
  if (key === "actions") return normalizeActions(value);
  if (key === "events") return normalizeEvents(value);
  if (key === "game") return normalizeGameData(value);
  return value;
};

// One of the game's screens saved a document (client/remoteRuntime.js).
const ownWrite = ({ key, wanted, held }) => {
  const owner = current;
  if (!owner?.runtime) return undefined;
  // What the page holds and what it saves, both in the shape the page's own
  // writers save in. The view is the host's projection, which leaves the
  // engine's own fields out; a save may be normalized (the game's writers) or
  // not. Compared as they came, the defaults one side fills in (a pulse count
  // of 0, empty ledgers) read as changes nobody made, and a list the
  // normalizer rounds out read as one the player changed.
  const before = asThePageSavesIt(key, held);
  const after = asThePageSavesIt(key, wanted);
  // The advisor's conversation is the host's to keep with this seat
  // (runtime/seatAdvisors.js): what the save changed is asked of the host
  // (game/advisorChanges.js), and shown here at once until the host's next view
  // of it; a refusal puts it back, and is said.
  if (key === "advisor") {
    const changes = advisorChangesOf(before, after);
    if (!changes) return before;
    owner.runtime.overlay("advisor", after);
    void sharedRequest("advisor", changes).then((answer) => {
      if (current !== owner) return;
      // Said in the advisor, where the player wrote (sharedGameBridge.js
      // sharedAdvisorRefusal), until a change of it is kept again.
      if (answer?.ok) {
        setSharedAdvisorRefusal("");
        return;
      }
      owner.runtime.dropOverlay("advisor");
      logDebugEvent("shared game", `the host did not keep a change to the advisor's conversation: ${answer?.error || "no answer"}`, undefined, { problem: true });
      setSharedAdvisorRefusal(answer?.error || "The host did not answer.");
    });
    return after;
  }
  // A change no door takes is said, not passed for saved (seatWrites.js
  // unroutedChanges): on the round bar and in the diagnostics log, and the save
  // is refused, in every build, so the screen that made it fails where its
  // player acted instead of going on as though it were kept.
  const unrouted = unroutedChanges(key, before, after);
  if (unrouted.length) {
    logDebugEvent("shared game", `a change only this screen made, which the host never heard: ${key}: ${unrouted.slice(0, 8).join(", ")}`, undefined, { problem: true });
    notify(UNROUTED_NOTICE);
  }
  if (key === "world") {
    const plan = planWorldWrite(before, after);
    if (Object.keys(plan.device).length) {
      owner.suggestedInRound = Number(owner.round);
      owner.runtime.patch("world", plan.device, { quiet: true });
    }

  }
  // How this screen shows the game (the GDP display currency): this device's own.
  if (key === "game") {
    const plan = planGameWrite(before, after);
    if (Object.keys(plan.device).length) owner.runtime.patch("game", plan.device, { quiet: true });
  }
  if (unrouted.length) {
    console.error(`[shared game] a save no door takes: ${key}: ${unrouted.join(", ")}`);
    throw unroutedRefusal(key, unrouted);
  }
  return asThePageSavesIt(key, owner.runtime.held(key));
};

// What the page did with a view, said to the host (game/messages.js "viewed"):
// one it applied need not be sent again; one it could not apply is answered
// with the whole view. A repeat of a view already shown needs no word.
const reportView = (owner, view, verdict) => {
  if (verdict.reason === "repeat" || verdict.reason === "ended") return;
  if (!verdict.ok) logDebugEvent("shared game", `a view from the host could not be shown (${verdict.reason}${verdict.key ? `: ${verdict.key}` : ""}); asked for the whole view again`, undefined, { problem: true });
  owner.client?.notify({ t: "viewed", epoch: String(view?.epoch || "0"), rev: Number(view?.rev) || 0, ok: Boolean(verdict.ok) });
};

// A view reaches the page's documents, and its game document the library's
// entry for the game it is shown in (library.js setSharedGameEntry): the menu
// bar and the loading screen name the player's country and the host's date.
// Nothing of it is acted on before it is known to be shown: a view that does
// not follow the one held, or does not add up, changes nothing here.
const applyToRuntime = (view) => {
  const owner = current;
  const verdict = owner.runtime.check(view);
  if (!verdict.ok) {
    reportView(owner, view, verdict);
    return false;
  }
  const game = view?.docs?.game;
  const world = view?.docs?.world;
  const arriving = Boolean(world && typeof world === "object");
  // The AI's suggestions were for the round they were asked in.
  if (game && typeof game === "object") {
    if (suggestionsOutlived(owner.suggestedInRound, game.round)) {
      owner.suggestedInRound = undefined;
      owner.runtime.patch("world", { actionSuggestions: undefined }, { quiet: arriving });
    }
    owner.round = Number(game.round);
  }
  let landed = null;
  if (arriving) {
    // A round the host resolved lands here as a new newest turn. It is shown
    // one event at a time, as a time skip this page ran itself is, so it is
    // marked before any screen can read it (runtime/unseenEvents.js). The turn
    // a player finds when they join was not theirs to watch: it is shown whole.
    const turn = revealedTurnOf(world);
    if (turn && owner.turnKey !== undefined && turn.key !== owner.turnKey) {
      unseenEvents.markTurnUnseen(turn.eventIds);
      landed = turn;
      // And the world as this page held it before the round, which the Events
      // panel stages the round's events on (client/roundBase.js), read before
      // the landing view replaces it.
      setSharedRoundBase(roundBaseOf({ heldWorld: owner.runtime.held("world"), heldGame: owner.runtime.held("game"), world }));
      // Whatever the AI suggested was for the round that has just ended.
      owner.suggestedInRound = undefined;
      owner.runtime.patch("world", { actionSuggestions: undefined }, { quiet: true });
    }
    owner.turnKey = turn?.key ?? owner.turnKey ?? "";
  }
  const outcome = owner.runtime.apply(view);
  reportView(owner, view, outcome);
  const applied = outcome.ok;
  if (applied && owner.gameId && game && typeof game === "object") {
    setSharedGameEntry({ gameId: owner.gameId, country: game.country, currentDate: game.gameDate });
  }
  // The game's date, which the round bar names with the date the round lands on.
  if (applied && game && typeof game === "object" && String(game.gameDate ?? "") !== state.date) set({ date: String(game.gameDate ?? "") });
  // The Events panel opens on the round (GameUI/time.jsx).
  if (applied && landed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SHARED_ROUND_LANDED, { detail: { round: landed.round, events: landed.eventIds.length } }));
  }
  return applied;
};

// `maxMessageChars`: the most a message may be where it is read (a guest's: the
// host's session, protocol/codec.js PLAYER_MESSAGE_MAX_CHARS).
const makeClient = (send, { maxMessageChars = Infinity } = {}) => createGameClient({
  send,
  maxMessageChars,
  log: (line) => logDebugEvent("shared game", line, undefined, { problem: true }),
  applyView: (view) => {
    if (!current) return false;
    if (!current.runtime) {
      current.pendingViews.push(view);
      return true;
    }
    return applyToRuntime(view);
  },
  onChange: ({ lobby, round, notices }) => {
    if (current) current.hostNotices = notices;
    // The host's feature switches are the game's on this screen too.
    if (lobby?.features) setSharedGameFeatures(lobby.features);
    // The language the host's world is written in, for every request this page makes (runtime/i18n.js).
    if (lobby?.settings) setWorldLanguage(lobby.settings.language);
    // And the rules of the game every screen says (who pays for what, the Game Master).
    if (lobby?.settings) setSharedGameSettings(lobby.settings);
    // And who plays which country: a seat a person's device holds (game/messages.js SEAT `held`), not one they watch.
    if (lobby) setSharedGamePeople((Array.isArray(lobby.seats) ? lobby.seats : []).filter((seat) => seat?.held === true && seat?.status !== "watching").map((seat) => seat.country));
    // And how far each round moves the world, which the Timeline panel shows in place of its skips.
    if (lobby?.settings) setSharedRoundDays(lobby.settings.daysPerRound);
    set({
      lobby,
      round,
      notices: current ? noticesNow() : notices,
      mode: state.mode === "opening" ? "lobby" : lobby?.started && state.mode === "lobby" ? "playing" : state.mode,
    });
    // Whether this device can take its turn to pay, to a host whose players take turns.
    void statePayProfile();
  },
  // A request of the round this device is to pay for, in its turn.
  onPay: (message) => roundPayer.receive(message),
  // What of this page's requests waits for the round being resolved, for the screens that asked.
  onHeld: (kinds) => setSharedRequestsHeld(kinds),
});

const startViews = () => {
  if (!current || current.runtime) return;
  current.runtime = beginRuntime(ownWrite);
  for (const view of current.pendingViews.splice(0)) applyToRuntime(view);
};

// --- Hosting (desktop) ---------------------------------------------------------

// `resuming`: this page comes back to a game its engine window already runs
// (resumeHosting). Whatever goes wrong then leaves that game running: only a
// first opening is undone, since nothing else holds the engine window open.
export const hostSharedGame = async ({ settings, name, resuming = false } = {}) => {
  if (sharedGameActive()) throw new Error("A shared game is already open.");
  const probe = await fetch("/api/multiplayer/engine").then((response) => response.json()).catch(() => ({ supported: false }));
  // On the development server only, a developer may open /engine.html in
  // another tab of the same origin and host from this one, without the desktop
  // app; it answers on the same loopback.
  const devEngine = !probe?.supported && Boolean(import.meta.env?.DEV);
  if (!probe?.supported && !devEngine) throw new Error("Hosting a shared game needs the desktop app.");
  set({ ...IDLE, mode: "opening", role: "host", connection: "loopback" });
  setSharedGameRole("host");
  const identity = deviceIdentity();
  current = { pendingViews: [], runtime: null, gameId: String(getLibraryState().activeGameId || "") };
  const screen = createLoopbackScreenSide({
    onMessage: (message) => current?.client.receive(message),
    onStatus: (engine) => {
      set({ engine, token: engine?.token || state.token, error: engine?.error || "" });
      if (engine?.open && !current?.greeted) {
        current.greeted = true;
        screen.hello(identity.id, name || "Host");
      }
    },
    // The engine makes the game's AI calls. Each one it finishes is announced
    // here as this window's own are, so the AI debug console shows it: an open
    // console takes the record the engine stored into its own copy first. The
    // record is stored just after the call ends, so it is looked for a moment
    // later, and once more if it was not there yet. What the engine logs goes
    // in this window's diagnostics log.
    onAi: (detail) => {
      const announce = () => window.dispatchEvent(new CustomEvent(GENERATION_COMPLETE_EVENT, { detail }));
      setTimeout(() => {
        void adoptStoredAiRecord(detail.recordId).then((taken) => {
          announce();
          if (!taken) setTimeout(() => void adoptStoredAiRecord(detail.recordId).then((late) => { if (late) announce(); }), 3000);
        });
      }, 600);
    },
    onLog: (entries) => {
      for (const entry of entries) logDebugEvent(entry.category, `(host's engine) ${entry.message}`, entry.detail || undefined, { problem: entry.problem });
    },
    // The engine window crashed or froze: said, and Leave closes it, since it
    // cannot close itself.
    onGone: () => {
      if (!current || current.screen !== screen) return;
      current.engineGone = true;
      logDebugEvent("shared game", "the shared game's engine window stopped answering", undefined, { problem: true });
      set({ mode: "ended", error: "The shared game's window stopped answering. Leave to play your game on your own again." });
    },
  });
  current.screen = screen;
  current.client = makeClient((message) => screen.request(message));
  // A page that goes (reloaded, its window closed) says so as it goes: the
  // round waits for the host's screen at once, and goes on when the page is
  // back (resumeHosting), rather than running on until the engine notices the
  // silence (transport/loopback.js GONE_MS).
  const goodbye = () => screen.bye();
  window.addEventListener("pagehide", goodbye);
  current.forgetGoodbye = () => window.removeEventListener("pagehide", goodbye);
  if (!devEngine) {
    const opened = await fetch("/api/multiplayer/engine/open", { method: "POST" }).then((response) => response.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (!opened?.open) {
      await leaveSharedGame({ stopHosting: !resuming });
      throw new Error(opened?.error || "The engine window did not open.");
    }
  }
  // The engine page takes a moment to boot and to read the game, and a good
  // deal longer on a machine busy with something else: ask until it answers.
  // A game whose start the engine is finishing first (host/gameStart.js: its
  // backstory may be a request to the host's AI) is waited for while it says
  // so, however long the AI takes.
  const giveUpAt = Date.now() + ENGINE_START_MS;
  while ((Date.now() < giveUpAt || state.engine?.preparing === true) && !state.engine?.open && state.mode === "opening") {
    screen.control("open", { settings, name: name || "Host" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (state.engine?.error) break;
  }
  if (!state.engine?.open) {
    const reason = state.engine?.error
      || (devEngine ? "No engine answered: open /engine.html in another tab first." : "The engine window did not start.");
    await leaveSharedGame({ stopHosting: !resuming });
    throw new Error(reason);
  }
  // The host's own campaign is the page's active game already: its view
  // replaces the documents from here on.
  startViews();
  rememberHosting(name);
  return state.token;
};

// A page that was this tab's host's screen before it reloaded comes back to
// its shared game as the host's screen, while the engine window still runs it.
// Before, it came back as an ordinary single-player page writing the shared
// game beside its engine (the server now refuses that: server/oneWriter.js).
export const resumeHosting = async () => {
  const kept = hostingRemembered();
  if (!kept || sharedGameActive()) return false;
  const probe = await fetch("/api/multiplayer/engine").then((response) => response.json()).catch(() => null);
  if (!probe?.open) {
    forgetHosting();
    return false;
  }
  logDebugEvent("shared game", "this page was the host's screen before it reloaded: back to the shared game");
  // The library first: the game shown in the menu bar is the hosted one.
  await refreshLibraryCatalog({ force: true }).catch(() => {});
  // Tried again while the engine window still runs the game: it may be busy a
  // while (a round being resolved on a slow machine), and the game is never
  // ended for it. The host's Stop ends it.
  for (;;) {
    try {
      await hostSharedGame({ name: kept.name || "Host", resuming: true });
      return true;
    } catch (error) {
      logDebugEvent("shared game", `could not come back to the shared game yet: ${String(error?.message || error)}`, undefined, { problem: true });
    }
    const still = await fetch("/api/multiplayer/engine").then((response) => response.json()).catch(() => null);
    if (!still?.open || !hostingRemembered()) {
      forgetHosting();
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
};

// The host's controls (hosting only).
export const hostControl = (action, args = null) => current?.screen?.control(action, args);

// --- Joining ---------------------------------------------------------------------

// The host's scenario must be in this library, with the host's map: the game is
// drawn on it (client/standIn.js chooses the copy).
const prepareStandIn = async (owner, lobby) => {
  await refreshLibraryCatalog({ force: true }).catch(() => {});
  const library = getLibraryState();
  const hostName = String(lobby?.scenario?.name || "").trim();
  // The copy whose map is the host's (client/standIn.js), by the checksum the
  // host states (server/scenarioFingerprint.js), whatever it is called here.
  const { scenario, differs, unchecked } = await chooseStandInScenario({
    scenarios: library.scenarios ?? [],
    host: lobby?.scenario ?? {},
    fingerprintOf: (id) => fetch(`/api/scenarios/${encodeURIComponent(id)}/fingerprint`)
      .then((response) => (response.ok ? response.json() : null))
      .then((answer) => String(answer?.fingerprint || "")),
  });
  if (!scenario) {
    logDebugEvent("shared game", differs
      ? `this library's copy of the host's scenario has another map: "${hostName}"`
      : `the host's scenario is not in this library: "${hostName}" (${String(lobby?.scenario?.id || "no id")})`, undefined, { problem: true });
    if (unchecked) throw new Error(scenarioUnchecked(hostName));
    throw new Error(differs ? scenarioDiffers(hostName) : scenarioMissing(hostName));
  }
  const scenarioId = String(scenario.id);
  // A stand-in of its own for this sitting (runtime/standInGames.js): its record
  // says it is one, and which game was open before it, to go back to when the
  // shared game closes. It is never listed, kept or hosted; one an earlier page
  // left behind was closed when the app started.
  // Made with a known id, so its entry has no country from the first moment it
  // is in the library: for a guest with no games of their own the new one is
  // the library's game straight away.
  const wanted = `shared-game-${[...crypto.getRandomValues(new Uint8Array(6))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (current !== owner) return false;
  // Held from before it exists, so no start of the app elsewhere takes it for one left behind.
  owner.releaseStandIn = holdStandIn(wanted);
  setSharedGameEntry({ gameId: wanted, country: "" });
  const created = await createGame({
    id: wanted,
    scenarioId,
    // Its record says it is a stand-in (standInMark); the name is only what the
    // menu bar and the loading screen show. The lobby's name is taken as the
    // host gave it: it was matched against the English words "Shared game:"
    // to drop them (a game hosted from a copy kept from before stand-ins said
    // what they are), which is no way to decide anything (the review of
    // 2026-11-18, door 8).
    name: `Shared game: ${String(lobby?.settings?.name || "").trim().slice(0, 60) || "with friends"}`,
    gamePatch: { country: String(lobby?.countries?.[0] || ""), ...standInMark({ returnTo: String(library.activeGameId || "") }) },
  }, { forSharedGame: true });
  const gameId = String(created?.id || created?.game?.id || "");
  if (!gameId) throw new Error("Could not make a local game to show the shared one in.");
  owner.gameId = gameId;
  // Left meanwhile: closed again, and nothing to open.
  if (current !== owner) {
    await closeStandInOf(owner);
    return false;
  }
  // No country until one is taken: the stand-in's own is only a placeholder,
  // and it must not be what the loading screen names.
  setSharedGameEntry({ gameId, country: "" });
  await activateGame(gameId, { forSharedGame: true });
  return current === owner;
};

// The page's stand-in, closed with its shared game: the game open before it is
// the active one again, the stand-in is deleted, and its lock let go.
const closeStandInOf = async (owner) => {
  if (!owner?.gameId) {
    owner?.releaseStandIn?.();
    return;
  }
  const gameId = owner.gameId;
  owner.gameId = "";
  await refreshLibraryCatalog({ force: true }).catch(() => {});
  const entry = libraryStandIns().find((standIn) => standIn.id === gameId);
  if (entry) await closeStandIn(entry);
  owner.releaseStandIn?.();
};

// A join that is still asking its own server whether it may begin.
let joinStarting = false;

export const joinSharedGame = async ({ token, name } = {}) => {
  if (sharedGameActive() || joinStarting) throw new Error("A shared game is already open.");
  const invite = parseInvite(String(token ?? "").trim()); // throws a readable InviteError
  // A page served by a computer that is hosting cannot join: the game it
  // would open to draw the map from would take the place of the hosted one
  // (the server refuses that too: server.js HOSTING_HOLDS_THE_GAME). A second
  // window on a host's own computer did exactly this, and every save the host
  // made afterwards was refused. Anywhere with no desktop app behind the page
  // (the website, a phone) there is nothing to ask, and nothing is hosted.
  joinStarting = true;
  let clock = { offsetMs: 0, source: "" };
  try {
    const here = await fetch("/api/multiplayer/engine").then((response) => response.json()).catch(() => null);
    if (here?.open) {
      logDebugEvent("shared game", "not joining: this computer is hosting a shared game", undefined, { problem: true });
      throw new Error(hostingHere());
    }
    // The relays' time, which every signaling message is stamped by
    // (client/clock.js): a computer whose clock was an hour behind had every
    // message refused, and was told no host was found.
    clock = await readSignalingClock({ customRelays: usesCustomRelays() });
    if (clock.offsetMs) logDebugEvent("shared game", describeClock(clock));
  } finally {
    joinStarting = false;
  }
  if (sharedGameActive()) throw new Error("A shared game is already open.");
  set({ ...IDLE, mode: "opening", role: "guest", token: invite.token });
  setSharedGameRole("guest");
  current = { pendingViews: [], runtime: null, gameId: "", preparing: null };
  const joining = current;
  logDebugEvent("shared game", "joining a shared game with an invite code");
  // What this device's own network is, for the words a failure is told in.
  void probeNetwork().then((network) => {
    logDebugEvent("shared game", `this device's network, by its own candidates: ${network}`);
    if (current === joining) set({ network });
  });
  const session = createClientSession({
    token: invite.token,
    device: deviceIdentity(),
    name: String(name || "Player").slice(0, 40),
    version: SHARED_GAME_VERSION,
    appMessages: HOST_MESSAGES,
    channelFactory: relayChannelFactory,
    now: offsetClock(clock.offsetMs),
    // Every step of the joining goes in the diagnostics log: which of them
    // never came is the whole of what a report of "it will not connect" needs.
    log: (text) => logDebugEvent("shared game", text),
    onState: (connection, detail = {}) => {
      if (current !== joining) return;
      const back = connection === "connected" && state.connection === "reconnecting";
      set({ connection, detail: { heard: Boolean(detail.heard), failures: Number(detail.failures) || 0, clock: Boolean(detail.clock) } });
      // Back after a drop: what was asked and not yet answered goes again, with
      // its own id, and the host answers it once.
      if (back) {
        const again = current.client?.resend() ?? 0;
        if (again) logDebugEvent("shared game", `reconnected: ${again} request(s) not yet answered were sent again`);
        // A host that restarted has forgotten what this device said of paying: said again.
        statedPay = { owner: null, key: "", round: -1 };
        void statePayProfile();
      }
      if (!["rejected", "lost", "invalid"].includes(connection)) return;
      logDebugEvent("shared game", `joining ended: ${connection} (${detail.reason || detail.message || "no reason given"})`, undefined, { problem: true });
      set({ mode: "ended", error: joinFailure({ connection, reason: detail.reason, message: detail.message, network: state.network }) });
    },
    // Dropped by the session, and said here: a lobby that cannot be read
    // would otherwise look like a host that was never found.
    onProblem: () => {
      if (current === joining && !state.lobby) set({ error: unreadableFromHost() });
    },
    onMessage: (message) => {
      current?.client.receive(message);
      if (message.t === "lobby" && current && !current.preparing) {
        const owner = current;
        set({ standIn: "preparing" });
        owner.preparing = prepareStandIn(owner, message)
          .then((ready) => {
            if (!ready || current !== owner) return;
            startViews();
            set({ standIn: "ready" });
          })
          .catch((error) => {
            if (current === owner) set({ standIn: "", error: String(error?.message || error) });
          });
      }
    },
  });
  current.session = session;
  current.client = makeClient((message) => session.send(message), { maxMessageChars: PLAYER_MESSAGE_MAX_CHARS });
  session.connect();
};

// --- Playing ---------------------------------------------------------------------

export const sharedRequest = (t, fields = {}) => (current?.client
  ? current.client.request(t, fields)
  : Promise.resolve({ ok: false, error: "Not in a shared game." }));
// The game's own panels reach the host through the bridge.
setSharedRequester(sharedRequest);

// With the host's setting that players take turns to pay (host/settings.js
// payment "cycle"): this device's turn, made on its own AI (client/roundPayer.js).
// The game's AI is loaded only when a request comes.
const roundPayer = createRoundPayer({
  ask: async (call, options) => (await import("../../Game/AI/main.jsx")).carryRoundRequest(call, options),
  answer: (fields) => sharedRequest("paid", fields),
  lookup: (fields) => sharedRequest("payLookup", fields),
  alive: (message) => current?.client?.notify(message),
  cycle: () => state.lobby?.settings?.payment === "cycle",
  log: (text) => logDebugEvent("shared game", text, undefined, { problem: true }),
});

// What this device states about paying for a round, with no key
// (Game/AI/main.jsx roundPayProfile): whether its AI can answer one now, and
// its own settings that decide what a round spends on its key. Only a device
// that has said it can is given its turn (host/roundPayers.js). Said in a game
// whose players take turns, once a round (a free allowance can be spent by
// the last), whenever it changes, and again after a reconnect.
let statedPay = { owner: null, key: "", round: -1 };
const statePayProfile = async () => {
  const owner = current;
  if (!owner?.client || state.role !== "guest" || state.lobby?.settings?.payment !== "cycle") return;
  let profile;
  try {
    profile = (await import("../../Game/AI/main.jsx")).roundPayProfile();
  } catch (error) {
    logDebugEvent("shared game", `this device's AI could not be read for its turn to pay: ${String(error?.message || error)}`, undefined, { problem: true });
    return;
  }
  if (current !== owner) return;
  const key = JSON.stringify(profile);
  const round = Number(state.round?.round) || 0;
  if (statedPay.owner === owner && statedPay.key === key && statedPay.round === round) return;
  statedPay = { owner, key, round };
  void sharedRequest("canPay", profile);
};
if (typeof window !== "undefined") {
  for (const name of ["ai:request-budget", "mapSettings:updated", "ai:fallback-changed", "ai:fallback-switch"]) {
    window.addEventListener(name, () => void statePayProfile());
  }
}

export const sharedRemainingMs = () => current?.client?.remainingMs() ?? 0;

export const leaveSharedGame = async ({ stopHosting = true } = {}) => {
  const leaving = current;
  // An engine window that never answered this page, or stopped answering it,
  // cannot be trusted to close itself when it is told to stop.
  const unanswered = Boolean(leaving?.screen) && (leaving.engineGone || !state.engine?.open);
  current = null;
  roundPayer.close();
  if (remoteRuntimeActive()) stopRemoteRuntime();
  leaving?.client?.close();
  if (leaving?.screen) {
    leaving.forgetGoodbye?.();
    leaving.screen.bye();
    if (stopHosting) leaving.screen.control("stop");
    leaving.screen.close();
    if (stopHosting) forgetHosting();
    // An engine window that stopped answering cannot close itself: closed here,
    // so the game is this page's to write again. One that answers closes
    // itself once it has stopped (host/engineMain.js "stop").
    if (stopHosting && unanswered) await fetch("/api/multiplayer/engine/close", { method: "POST" }).catch(() => {});
  }
  leaving?.session?.leave();
  set({ ...IDLE });
  setSharedGameRole("");
  setSharedGamePeople([]);
  setSharedNotices([]);
  setSharedRoundBase(null);
  setSharedRoundDays(0);
  setSharedGameSettings(null);
  setSharedRequestsHeld([]);
  setSharedAdvisorRefusal("");
  // This device's own features again, and its own language.
  setSharedGameFeatures(null);
  setWorldLanguage("");
  // Back to this device's own documents, and the library's own entry.
  setSharedGameEntry(null);
  // A guest's stand-in goes with its shared game, and the game open before it
  // is the library's again (runtime/standInGames.js). The host's game is its own.
  if (leaving && !leaving.screen) await closeStandInOf(leaving);
  await refreshLibraryCatalog({ force: true }).catch(() => {});
};
