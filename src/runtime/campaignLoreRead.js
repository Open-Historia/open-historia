/*! Open Historia - native campaign lore snapshot intake. AGPL-3.0-or-later. */
import { JSON_URLS, readJson } from "./assets.js";
import { getLibraryState } from "./library.js";
import { unseenEvents } from "./unseenEvents.js";
import { isSharedMultiplayerSession } from "../multiplayer/client/sharedGameBridge.js";
import { isSimulationBusy } from "../Game/AI/simulationStatus.js";
import { buildCampaignLore } from "./campaignLore.js";

const epochOf = (game) => JSON.stringify([game?.country, game?.gameDate, game?.round, game?.startDate]);
const captureKeys = (options) => [
  "game",
  "world",
  "events",
  ...(options.actions ? ["actions"] : []),
  ...(options.conversations ? ["chat", "advisor"] : []),
];
const staleError = () => new Error("Campaign changed while reading its record. Reopen Campaign Lore and try again.");
const INVALIDATORS = ["oh:active-game-changed", "oh:rolled-back", "oh:runtime-json-updated", "oh:unseen-events-changed"];

// Read by captured asset URLs, never by re-resolving an active save mid-read.
// Do not silently turn a missing/failed read into a fabricated empty history.
export const captureCampaignLore = async (options = {}, {
  library = getLibraryState,
  endpoints = JSON_URLS,
  read = readJson,
  shared = isSharedMultiplayerSession,
  busy = isSimulationBusy,
  unseen = (world) => unseenEvents.unseenFor(world),
  target = typeof window !== "undefined" ? window : null,
} = {}) => {
  const state = library();
  const activeId = state?.activeGameId;
  if (!activeId || state?.activeGame?.id !== activeId || shared()) {
    throw new Error("Campaign Lore is available in an active single-player campaign.");
  }
  if (busy()) {
    throw new Error("Finish the current simulation before exporting campaign history.");
  }

  const keys = captureKeys(options);
  const urls = Object.fromEntries(keys.map((key) => [key, endpoints[key]]));
  if (Object.values(urls).some((url) => !url)) throw staleError();

  let changed = false;
  const invalidate = () => { changed = true; };
  for (const eventName of INVALIDATORS) target?.addEventListener(eventName, invalidate);

  const assertConsistent = () => {
    if (changed || busy() || shared() || library()?.activeGameId !== activeId || keys.some((key) => endpoints[key] !== urls[key])) {
      throw staleError();
    }
  };

  const fetchKey = async (key) => {
    try {
      return await read(urls[key], { force: true, cache: false });
    } catch (error) {
      if ((key === "chat" || key === "advisor") && error?.status === 404) return [];
      throw error;
    }
  };

  try {
    const before = await fetchKey("game");
    assertConsistent();
    const pairs = await Promise.all(keys.filter((key) => key !== "game").map(async (key) => [key, await fetchKey(key)]));
    const data = Object.fromEntries(pairs);
    assertConsistent();
    const game = await fetchKey("game");
    assertConsistent();

    if (!game || typeof game !== "object" || !game.country || !game.gameDate || epochOf(before) !== epochOf(game)) {
      throw staleError();
    }
    if (
      !data.world || typeof data.world !== "object" || Array.isArray(data.world)
      || !data.events || typeof data.events !== "object"
      || keys.some((key) => ["actions", "chat", "advisor"].includes(key) && !Array.isArray(data[key]))
    ) {
      throw new Error("The campaign history could not be read.");
    }
    if (unseen(data.world).size) {
      throw new Error("Finish revealing the current turn's events before exporting campaign history.");
    }

    return buildCampaignLore({
      metadata: { name: state.activeGame.name, scenario: state.runtimeScenario?.name },
      game,
      world: data.world,
      events: data.events,
      actions: data.actions,
      chats: data.chat,
      advisor: data.advisor,
    }, options);
  } finally {
    for (const eventName of INVALIDATORS) target?.removeEventListener(eventName, invalidate);
  }
};
