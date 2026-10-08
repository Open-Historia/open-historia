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
import { activateGame, createGame, getLibraryState, refreshLibraryCatalog, setSharedGameEntry } from "../../runtime/library.js";
import { normalizeActions, normalizeChats, normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { unseenEvents } from "../../runtime/unseenEvents.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { GENERATION_COMPLETE_EVENT, adoptStoredAiRecord } from "../../Game/AI/telemetry.js";
import { planWorldWrite, revealedTurnOf, suggestionsOutlived } from "./seatWrites.js";
import { createGameClient } from "./gameClient.js";
import { remoteRuntimeActive, startRemoteRuntime, stopRemoteRuntime } from "./remoteRuntime.js";
import { SHARED_ROUND_LANDED, setSharedGameRole, setSharedRequester } from "./sharedGameBridge.js";
import { createLoopbackScreenSide } from "../transport/loopback.js";
import { createClientSession } from "../session/client.js";
import { probeNetwork } from "../transport/peer.js";
import { joinFailure, scenarioMissing, unreadableFromHost } from "./joinProgress.js";
import { relayChannelFactory } from "../signaling/relays.js";
import { loadDeviceIdentity } from "../identity.js";
import { parseInvite } from "../invite.js";
import { HOST_MESSAGES, SHARED_GAME_VERSION } from "../game/messages.js";

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

const deviceIdentity = () => loadDeviceIdentity(localStorage);

// The page's caches take each view the way they take a finished turn.
const beginRuntime = (onWrite) => startRemoteRuntime({
  publish: (entries) => publishJsonWriteBatch(entries),
  urlFor: (key) => JSON_URLS[key] || "",
  onWrite,
});

// What the round bar says: the host's notices (client/gameClient.js) and this
// page's own, in the order they were said.
const noticesNow = () => [...(current?.hostNotices ?? []), ...(current?.ownNotices ?? [])]
  .sort((left, right) => (left.at || 0) - (right.at || 0))
  .slice(-20);

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
const sendBoard = (owner, projects) => {
  owner.boardWrites = (owner.boardWrites ?? 0) + 1;
  const mine = owner.boardWrites;
  owner.boardKept = false;
  owner.runtime.patch("world", { projects }, { quiet: true });
  void owner.client.request("board", { projects }).then((answer) => {
    // A later change to the board has taken this one's place.
    if (current !== owner || owner.boardWrites !== mine) return;
    if (answer.ok) {
      owner.boardKept = true;
      return;
    }
    owner.runtime.patch("world", { projects: undefined });
    notify(`The Projects board was not changed: ${answer.error || "the host did not answer."}`);
  });
};

// A document in the shape the page's own writers save it in, which is the
// shape their caches expect back (runtime/assets.js writeJson).
const asThePageSavesIt = (key, value) => {
  if (key === "world") return normalizeWorldState(value);
  if (key === "chat") return normalizeChats(value);
  if (key === "actions") return normalizeActions(value);
  if (key === "events") return normalizeEvents(value);
  return value;
};

// One of the game's screens saved a document (client/remoteRuntime.js).
const ownWrite = ({ key, wanted, held }) => {
  const owner = current;
  if (!owner?.runtime) return undefined;
  if (key === "world") {
    const plan = planWorldWrite(held, wanted);
    if (Object.keys(plan.device).length) {
      owner.suggestedInRound = Number(owner.round);
      owner.runtime.patch("world", plan.device, { quiet: true });
    }
    if (plan.board) sendBoard(owner, plan.board);
  }
  return asThePageSavesIt(key, owner.runtime.held(key));
};

// A view reaches the page's documents, and its game document the library's
// entry for the game it is shown in (library.js setSharedGameEntry): the menu
// bar and the loading screen name the player's country and the host's date.
const applyToRuntime = (view) => {
  const owner = current;
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
    // The host has kept the board it was asked to: its own copy is the one shown.
    if (owner.boardKept) {
      owner.boardKept = false;
      owner.runtime.patch("world", { projects: undefined }, { quiet: true });
    }
    // A round the host resolved lands here as a new newest turn. It is shown
    // one event at a time, as a time skip this page ran itself is, so it is
    // marked before any screen can read it (runtime/unseenEvents.js). The turn
    // a player finds when they join was not theirs to watch: it is shown whole.
    const turn = revealedTurnOf(world);
    if (turn && owner.turnKey !== undefined && turn.key !== owner.turnKey) {
      unseenEvents.markTurnUnseen(turn.eventIds);
      landed = turn;
      // Whatever the AI suggested was for the round that has just ended.
      owner.suggestedInRound = undefined;
      owner.runtime.patch("world", { actionSuggestions: undefined }, { quiet: true });
    }
    owner.turnKey = turn?.key ?? owner.turnKey ?? "";
  }
  const applied = owner.runtime.apply(view);
  if (applied && owner.gameId && game && typeof game === "object") {
    setSharedGameEntry({ gameId: owner.gameId, country: game.country, currentDate: game.gameDate });
  }
  // The Events panel opens on the round (GameUI/time.jsx).
  if (applied && landed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SHARED_ROUND_LANDED, { detail: { round: landed.round, events: landed.eventIds.length } }));
  }
  return applied;
};

const makeClient = (send) => createGameClient({
  send,
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
    set({
      lobby,
      round,
      notices: current ? noticesNow() : notices,
      mode: state.mode === "opening" ? "lobby" : lobby?.started && state.mode === "lobby" ? "playing" : state.mode,
    });
  },
});

const startViews = () => {
  if (!current || current.runtime) return;
  current.runtime = beginRuntime(ownWrite);
  for (const view of current.pendingViews.splice(0)) applyToRuntime(view);
};

// --- Hosting (desktop) ---------------------------------------------------------

export const hostSharedGame = async ({ settings, name } = {}) => {
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
  });
  current.screen = screen;
  current.client = makeClient((message) => screen.request(message));
  if (!devEngine) {
    const opened = await fetch("/api/multiplayer/engine/open", { method: "POST" }).then((response) => response.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (!opened?.open) {
      await leaveSharedGame();
      throw new Error(opened?.error || "The engine window did not open.");
    }
  }
  // The engine page takes a moment to boot and to read the game, and a good
  // deal longer on a machine busy with something else: ask until it answers.
  const giveUpAt = Date.now() + ENGINE_START_MS;
  while (Date.now() < giveUpAt && !state.engine?.open && state.mode === "opening") {
    screen.control("open", { settings, name: name || "Host" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (state.engine?.error) break;
  }
  if (!state.engine?.open) {
    const reason = state.engine?.error
      || (devEngine ? "No engine answered: open /engine.html in another tab first." : "The engine window did not start.");
    await leaveSharedGame();
    throw new Error(reason);
  }
  // The host's own campaign is the page's active game already: its view
  // replaces the documents from here on.
  startViews();
  return state.token;
};

// The host's controls (hosting only).
export const hostControl = (action, args = null) => current?.screen?.control(action, args);

// --- Joining ---------------------------------------------------------------------

// The host's scenario must be in this library: the map is drawn from it. It is
// looked for by its id, and then by its name: a scenario the host made or
// changed has an id of its own on every device it was copied to, and the one
// scenario here with the host's name is that scenario.
const sameName = (left, right) => String(left ?? "").trim().toLocaleLowerCase() === String(right ?? "").trim().toLocaleLowerCase();
const prepareStandIn = async (owner, lobby, roomId) => {
  await refreshLibraryCatalog({ force: true }).catch(() => {});
  const library = getLibraryState();
  const scenarios = library.scenarios ?? [];
  const hostName = String(lobby?.scenario?.name || "").trim();
  let scenario = scenarios.find((entry) => entry?.id && entry.id === String(lobby?.scenario?.id || ""));
  if (!scenario && hostName) {
    const named = scenarios.filter((entry) => sameName(entry?.name, hostName));
    if (named.length === 1) [scenario] = named;
  }
  if (!scenario) {
    logDebugEvent("shared game", `the host's scenario is not in this library: "${hostName}" (${String(lobby?.scenario?.id || "no id")})`, undefined, { problem: true });
    throw new Error(scenarioMissing(hostName));
  }
  const scenarioId = String(scenario.id);
  const key = `oh:mp:standin:${roomId}`;
  let gameId = "";
  try {
    gameId = localStorage.getItem(key) || "";
  } catch {
    gameId = "";
  }
  if (!gameId || !(library.games ?? []).some((game) => game?.id === gameId)) {
    // Made with a known id, so its entry has no country from the first moment
    // it is in the library: for a guest with no games of their own the new one
    // is the library's game straight away.
    const wanted = `shared-game-${[...crypto.getRandomValues(new Uint8Array(6))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (current !== owner) return false;
    setSharedGameEntry({ gameId: wanted, country: "" });
    const created = await createGame({
      id: wanted,
      scenarioId,
      name: `Shared game: ${String(lobby?.settings?.name || "with friends").slice(0, 60)}`,
      gamePatch: { country: String(lobby?.countries?.[0] || "") },
    });
    gameId = String(created?.id || created?.game?.id || "");
    try {
      if (gameId) localStorage.setItem(key, gameId);
    } catch {
      // it is made again next time
    }
  }
  if (!gameId) throw new Error("Could not make a local game to show the shared one in.");
  // Left meanwhile: nothing to open.
  if (current !== owner) return false;
  // No country until one is taken: the stand-in's own is only a placeholder,
  // and it must not be what the loading screen names.
  owner.gameId = gameId;
  setSharedGameEntry({ gameId, country: "" });
  await activateGame(gameId);
  return current === owner;
};

export const joinSharedGame = async ({ token, name } = {}) => {
  if (sharedGameActive()) throw new Error("A shared game is already open.");
  const invite = parseInvite(String(token ?? "").trim()); // throws a readable InviteError
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
    // Every step of the joining goes in the diagnostics log: which of them
    // never came is the whole of what a report of "it will not connect" needs.
    log: (text) => logDebugEvent("shared game", text),
    onState: (connection, detail = {}) => {
      if (current !== joining) return;
      set({ connection, detail: { heard: Boolean(detail.heard), failures: Number(detail.failures) || 0 } });
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
        owner.preparing = prepareStandIn(owner, message, invite.roomId)
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
  current.client = makeClient((message) => session.send(message));
  session.connect();
};

// --- Playing ---------------------------------------------------------------------

export const sharedRequest = (t, fields = {}, options = {}) => (current?.client
  ? current.client.request(t, fields, options)
  : Promise.resolve({ ok: false, error: "Not in a shared game." }));
// The game's own panels reach the host through the bridge.
setSharedRequester(sharedRequest);

export const sharedRemainingMs = () => current?.client?.remainingMs() ?? 0;

export const leaveSharedGame = async ({ stopHosting = true } = {}) => {
  const leaving = current;
  current = null;
  if (remoteRuntimeActive()) stopRemoteRuntime();
  leaving?.client?.close();
  if (leaving?.screen) {
    leaving.screen.bye();
    if (stopHosting) leaving.screen.control("stop");
    leaving.screen.close();
  }
  leaving?.session?.leave();
  set({ ...IDLE });
  setSharedGameRole("");
  // Back to this device's own documents, and the library's own entry.
  setSharedGameEntry(null);
  await refreshLibraryCatalog({ force: true }).catch(() => {});
};
