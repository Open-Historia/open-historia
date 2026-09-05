// The map's readiness, for the loading screen a game opens under
// (GameUI/gameLoadingScreen.jsx). Three signals:
//   - a game is being opened (library.js, before the request that activates
//     it), so the screen can come up at once rather than when the new UI
//     mounts a round trip later;
//   - the polity layers are in place — Nations.jsx marks it once the boundary
//     worker's derivation has been committed to the map (or failed), and at
//     once on a stock map, which has none to wait for;
//   - the map went idle (World.jsx). An idle AFTER the polities landed means the
//     layers, labels and tiles have actually been drawn.
// Every mark is stamped with the game it was made for (library.js keeps the
// active game id here from setLibraryState, before the new UI mounts), so a
// mark left by the previous game never passes for the next one's — and the
// endpoint token, which rotates when a game is activated, plays no part. The
// marks live on window as well as being dispatched: the screen mounts with the
// game's UI, which on a small map can be after the polities were already in.
export const GAME_OPENING_EVENT = "oh:game-opening";
export const MAP_POLITIES_READY_EVENT = "oh:map-polities-ready";
export const MAP_IDLE_EVENT = "oh:map-idle";

// An idle this soon after the mark can still be the one from before the layers
// were added; the next one is the drawn map.
const SETTLE_MARGIN_MS = 150;

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

const store = () => {
  if (typeof window === "undefined") return {};
  if (!window.__OH_MAP_READINESS__) window.__OH_MAP_READINESS__ = {};
  return window.__OH_MAP_READINESS__;
};

export const setReadinessGame = (gameId) => {
  store().gameId = String(gameId ?? "");
};

export const announceGameOpening = (gameId) => {
  if (typeof window === "undefined") return;
  store().opening = { gameId: String(gameId ?? ""), at: now() };
  window.dispatchEvent(new CustomEvent(GAME_OPENING_EVENT, { detail: store().opening }));
};

export const markPolitiesReady = (url = "", { failed = false } = {}) => {
  if (typeof window === "undefined") return;
  const record = { gameId: store().gameId ?? "", url: String(url ?? ""), at: now(), failed };
  store().polities = record;
  window.dispatchEvent(new CustomEvent(MAP_POLITIES_READY_EVENT, { detail: record }));
};

const currentRecord = () => {
  const record = store().polities;
  return record && record.gameId === (store().gameId ?? "") ? record : null;
};

export const politiesReady = () => Boolean(currentRecord());

// Ready AND drawn: the map has gone idle since the layers landed.
export const politiesSettled = () => {
  const record = currentRecord();
  const idleAt = store().idleAt ?? 0;
  return Boolean(record && idleAt > record.at + SETTLE_MARGIN_MS);
};

export const markMapIdle = () => {
  if (typeof window === "undefined") return;
  store().idleAt = now();
  window.dispatchEvent(new CustomEvent(MAP_IDLE_EVENT, { detail: { at: store().idleAt } }));
};
