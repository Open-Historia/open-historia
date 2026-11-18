/*! Open Historia — the world a player held before a shared round landed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/multiplayer/client/roundBase.test.js
//
// Single player reads a time skip's events one at a time on the map: the
// Events panel replays them on the world as the skip found it, through a
// visual override, until the last is read (GameUI/time.jsx, the staged
// reveal). It takes that world from the turn's restore point, or from the
// world it held while it ran the skip itself. A shared game's page has
// neither: the restore points are the host's (client/remoteRuntime.js), and the
// host ran the skip. So the whole round's borders and units were on the map
// before its first event was read, for every player (the gap audit of
// 2026-11-18).
//
// But a player's page held the world as it stood before the round: its view
// of it, the one the round's landing replaces. That is exactly the world the
// round's events are to be replayed on, as this player may see it, so it is
// kept when the round lands and the same staged reveal runs on it. Nothing is
// sent for it and nothing is asked: each player reads at their own pace, and
// says when they have read the round through ("revealed").
//
// It is the base only when it is the world of the round that landed: the
// world the page held is dated the day the turn began (a page that missed a
// round, back after a drop, holds an older one, and reads the round whole, as
// single player does without a restore point).
//
// Plain data, so it runs under bare node.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// { world, from, round } for the round `world` (the view that landed) carries
// as its newest turn, from the world and game the page held before it; null
// when they are not that round's.
export const roundBaseOf = ({ heldWorld, heldGame, world } = {}) => {
  const turn = Array.isArray(world?.simulationHistory) ? world.simulationHistory[0] : null;
  const from = clean(turn?.fromDate);
  if (!isRecord(heldWorld) || !from || clean(heldGame?.gameDate) !== from) return null;
  return { world: heldWorld, from, round: Number(turn?.round) || 0 };
};

// The base for the Events panel's newest turn record (time.jsx buildTurnRecord:
// `fromDate`, `round`), or null when it is another round's.
export const baseForRecord = (base, record) => (base && record
  && clean(record.fromDate) === base.from
  && (Number(record.round) || 0) === base.round
  ? base.world
  : null);
