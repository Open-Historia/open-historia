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
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import {
  mutateActionsState,
  mutateChatsState,
  mutateGameData,
  mutateWorldState,
  readChatsState,
  readGameStateBundle,
} from "../../runtime/gameState.js";
import { projectChatThread } from "../../runtime/chatThreads.js";
import { runChatActionBatch, simulateTimelineJump } from "../../Game/AI/gameplay.js";
import { createLoopbackEngineSide } from "../transport/loopback.js";
import { createHostSession } from "../session/host.js";
import { createInvite, parseInvite } from "../invite.js";
import { loadDeviceIdentity } from "../identity.js";
import { PLAYER_REQUESTS, SHARED_GAME_VERSION } from "../game/messages.js";
import { relayChannelFactory } from "../signaling/relays.js";
import { createGameHost } from "./gameHost.js";
import { normalizeSettings } from "./settings.js";

const SCREEN = "host-screen";
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// The game's own documents, through the game's own readers and its queued
// writers (gameState.js mutate*), so a request never races a turn.
const store = {
  read: async () => {
    const [bundle, intercepts, colors, flags] = await Promise.all([
      readGameStateBundle({ force: true }),
      readJson(JSON_URLS.intercepts, { defaultValue: {}, force: true }),
      readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
      readJson(JSON_URLS.flags, { defaultValue: {}, force: true }),
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
    };
  },
  updateActions: (fn) => mutateActionsState(fn),
  updateChats: (fn) => mutateChatsState(fn),
  updateWorld: (fn) => mutateWorldState(fn),
  updateGame: (fn) => mutateGameData(fn),
};

// The polities a player may take: every one that holds land on the map.
const choosableCountries = (world, game) => {
  const owners = new Set([clean(game?.country)]);
  for (const owner of Object.values(world?.regionOwnershipOverrides ?? {})) if (clean(owner)) owners.add(clean(owner));
  for (const [key, entry] of Object.entries(world?.polityOverrides ?? {})) {
    if (clean(entry?.status || "active").toLowerCase() === "active") owners.add(clean(entry?.name || entry?.code || key));
  }
  return [...owners].filter(Boolean).sort((a, b) => a.localeCompare(b)).slice(0, 600);
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

// The AI governments of a thread answer a person's message, as the chat panel's
// own turn does, with that person as the player; the thread is then saved the
// way the panel saves it.
const replyTo = async ({ chatId, seat }) => {
  const chats = await readChatsState({ force: true });
  const chat = list(chats).find((entry) => clean(entry?.id) === clean(chatId));
  if (!chat) return;
  const lastLine = [...list(chat.messages)].reverse().find((message) => clean(message?.speaker || message?.code) === clean(seat));
  const outcome = await runChatActionBatch({ chat, playerMessage: clean(lastLine?.text), playerCountry: seat, useCanonicalState: true });
  if (!outcome || outcome.committed || !Array.isArray(outcome.events)) return;
  const projected = projectChatThread(outcome.events);
  await mutateChatsState((current) => list(current).map((entry) => (clean(entry?.id) === clean(chatId)
    ? {
      ...entry,
      events: outcome.events,
      countries: projected.countries ?? entry.countries,
      title: projected.title || entry.title,
      polls: projected.polls ?? entry.polls,
      demands: projected.demands ?? entry.demands,
    }
    : entry)));
};

const boot = async () => {
  await refreshLibraryCatalog({ force: true });
  const identity = loadDeviceIdentity(localStorage);
  let gameHost = null;
  let session = null;
  let token = "";
  let campaign = "";
  let relays = null;
  let hostStatus = null;
  let failure = "";

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

  // Plain JSON only: the screen checks it, and refuses a status with anything
  // else in it (an undefined field included).
  const report = () => {
    const { settings: _settings, ...round } = hostStatus?.round ?? {};
    loopback.status({
      open: Boolean(gameHost),
      token,
      campaign,
      relays: relays ?? null,
      error: failure || null,
      lobby: hostStatus?.lobby ?? null,
      round: hostStatus?.round ? round : null,
      players: gameHost?.status().players ?? [],
    });
  };

  const open = async ({ settings: input, name } = {}) => {
    if (gameHost) return report();
    const checked = normalizeSettings(input ?? {});
    if (!checked.ok) throw new Error(checked.error);
    const settings = checked.settings;
    const docs = await store.read();
    const host = clean(docs.game?.country);
    if (!host) throw new Error("Open a game with a country before sharing it.");
    // The game and its scenario, as the library knows them: a player must open
    // the same scenario to see the same map.
    const library = getLibraryState();
    const entry = list(library.games).find((game) => game?.id === library.activeGameId) ?? null;
    const scenario = list(library.scenarios).find((candidate) => candidate?.id === entry?.scenarioId) ?? null;
    campaign = clean(library.activeGameId) || clean(host);
    const invite = loadInvite(campaign, identity);
    token = invite.token;
    gameHost = createGameHost({
      transport: {
        send: (playerId, message) => (playerId === SCREEN ? loopback.send(message) : session?.send(playerId, message)),
      },
      settings,
      hostSeat: { device: identity.id, name: clean(name) || "Host", country: host },
      scenario: { id: clean(entry?.scenarioId).slice(0, 120), name: clean(scenario?.name || entry?.name || "Open Historia").slice(0, 120), hash: "" },
      countries: choosableCountries(docs.world, docs.game),
      store,
      resolveRound: async ({ daysPerRound }) => {
        await simulateTimelineJump({ days: daysPerRound });
      },
      replyTo,
      onStatus: (status) => {
        hostStatus = status;
        report();
      },
      log: (level, text, detail) => console[level === "warn" ? "warn" : "info"](`[shared game] ${text}`, detail ?? ""),
    });
    session = createHostSession({
      invite,
      host: identity,
      channelFactory: relayChannelFactory,
      room: { name: settings.name, seats: settings.seats, version: SHARED_GAME_VERSION },
      appMessages: PLAYER_REQUESTS,
      // A connection closing after "stop" still reports its leaving.
      onJoin: (player) => gameHost?.join(player),
      onLeave: (player) => gameHost?.leave(player),
      onMessage: (player, message) => gameHost?.receive(player, message),
      onStatus: (status) => {
        relays = status?.relays ?? status ?? null;
        report();
      },
    });
    gameHost.start();
    session.start();
    report();
  };

  const control = async (action, args) => {
    if (action === "open") return open(args ?? {});
    if (!gameHost) return undefined;
    switch (action) {
      case "start": return gameHost.control.start();
      case "pause": return gameHost.control.pause();
      case "resume": return gameHost.control.resume();
      case "resolveNow": return gameHost.control.resolveNow();
      case "kick": {
        const device = gameHost.control.kick(clean(args?.country));
        const player = session?.players().find((entry) => entry.device === device);
        if (player && args?.ban) session.kick(player.id, { ban: true });
        return undefined;
      }
      case "rotate": {
        const next = rotateInvite(campaign, identity);
        token = next.token;
        session?.rotate(next);
        return report();
      }
      case "stop": {
        session?.stop();
        gameHost.stop();
        gameHost = null;
        session = null;
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
