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
// sends requests (client/gameClient.js); it never writes the game.
//
// The signaling relays are signaling/relays.js's (a local one for tests).

import { useSyncExternalStore } from "react";
import { JSON_URLS, publishJsonWriteBatch } from "../../runtime/assets.js";
import { activateGame, createGame, getLibraryState, refreshLibraryCatalog, setSharedGameEntry } from "../../runtime/library.js";
import { createGameClient } from "./gameClient.js";
import { remoteRuntimeActive, startRemoteRuntime, stopRemoteRuntime } from "./remoteRuntime.js";
import { setSharedGameRole, setSharedRequester } from "./sharedGameBridge.js";
import { createLoopbackScreenSide } from "../transport/loopback.js";
import { createClientSession } from "../session/client.js";
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

const deviceIdentity = () => loadDeviceIdentity(localStorage);

// The page's caches take each view the way they take a finished turn.
const beginRuntime = (onRefusedWrite) => startRemoteRuntime({
  publish: (entries) => publishJsonWriteBatch(entries),
  urlFor: (key) => JSON_URLS[key] || "",
  onRefusedWrite,
});

const refusedWrite = (key) => set({
  notices: [...state.notices, { level: "warn", text: `That change (${key}) is made by the host in a shared game, and this one cannot be requested yet.`, at: Date.now() }].slice(-20),
});

// A view reaches the page's documents, and its game document the library's
// entry for the game it is shown in (library.js setSharedGameEntry): the menu
// bar and the loading screen name the player's country and the host's date.
const applyToRuntime = (view) => {
  const applied = current.runtime.apply(view);
  const game = view?.docs?.game;
  if (applied && current.gameId && game && typeof game === "object") {
    setSharedGameEntry({ gameId: current.gameId, country: game.country, currentDate: game.gameDate });
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
  onChange: ({ lobby, round, notices }) => set({
    lobby,
    round,
    notices,
    mode: state.mode === "opening" ? "lobby" : lobby?.started && state.mode === "lobby" ? "playing" : state.mode,
  }),
});

const startViews = () => {
  if (!current || current.runtime) return;
  current.runtime = beginRuntime(refusedWrite);
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
  // The engine page takes a moment to boot; ask until it answers.
  for (let attempt = 0; attempt < 40 && !state.engine?.open && state.mode === "opening"; attempt += 1) {
    screen.control("open", { settings, name: name || "Host" });
    await new Promise((resolve) => setTimeout(resolve, 500));
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

// The host's scenario must be in this library: the map is drawn from it.
const prepareStandIn = async (owner, lobby, roomId) => {
  await refreshLibraryCatalog({ force: true }).catch(() => {});
  const library = getLibraryState();
  const scenarioId = String(lobby?.scenario?.id || "");
  const scenario = (library.scenarios ?? []).find((entry) => entry?.id === scenarioId);
  if (!scenario) {
    throw new Error(`This game is played on "${lobby?.scenario?.name || scenarioId || "a scenario"}", which is not in your library. Add it from the Community tab, then join again.`);
  }
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
  const session = createClientSession({
    token: invite.token,
    device: deviceIdentity(),
    name: String(name || "Player").slice(0, 40),
    version: SHARED_GAME_VERSION,
    appMessages: HOST_MESSAGES,
    channelFactory: relayChannelFactory,
    onState: (connection) => {
      set({ connection });
      if (["rejected", "lost", "invalid"].includes(connection)) set({ mode: "ended", error: connectionError(connection) });
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

const connectionError = (connection) => ({
  rejected: "The host turned this device away.",
  lost: "The connection to the host was lost.",
  invalid: "That invite code is not valid.",
}[connection] || "");

// --- Playing ---------------------------------------------------------------------

export const sharedRequest = (t, fields = {}) => (current?.client
  ? current.client.request(t, fields)
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
