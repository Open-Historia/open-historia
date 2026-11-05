/*! Open Historia — war at sea: the battles the world keeps © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// world.seaBattles: the sea battles of the last turns (runtime/naval/engine.js),
// kept for the map to mark and for whoever reads the game to see what was
// fought. They decide nothing: what a battle did to the fleets is already on
// the fleets. As a missile's flight is kept (runtime/strikes.js), a battle is
// kept for SEA_BATTLE_ROUNDS_KEPT turns and then let go.
//
//   { id, date, round, place, lng, lat, warId, sides: [[names], [names]],
//     fleets: [[{ name, owner, before, after, sunk?, broke? }], [...]], winner }
//
// `winner` is 0 or 1 for the side that had the better of it, -1 when neither did.
//
// Pure, and loads in plain Node.

export const SEA_BATTLES_KEPT_MOST = 24;
export const SEA_BATTLE_ROUNDS_KEPT = 2;
// world.naviesRaised: when each country was last given a navy by the game, or
// lost the last of one ({ country, date }). The engine reads it so that a navy
// sunk is not handed back the turn after (engine.js NAVY_REBUILD_DAYS).
export const NAVIES_RAISED_KEPT_MOST = 120;

const clean = (value, most = 160) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const list = (value) => (Array.isArray(value) ? value : []);

const normalizeFleet = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const name = clean(raw.name, 120);
  const owner = clean(raw.owner, 120);
  if (!name || !owner) return null;
  const figure = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return { name, owner, before: figure(raw.before), after: figure(raw.after), ...(raw.sunk === true ? { sunk: true } : {}), ...(raw.broke === true ? { broke: true } : {}) };
};

export const normalizeSeaBattle = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const lng = Number(raw.lng);
  const lat = Number(raw.lat);
  const id = clean(raw.id, 80);
  if (!id || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const fleets = [0, 1].map((side) => list(raw.fleets?.[side]).map(normalizeFleet).filter(Boolean).slice(0, 12));
  if (fleets[0].length === 0 || fleets[1].length === 0) return null;
  return {
    id,
    date: clean(raw.date, 40),
    round: Math.max(0, Math.trunc(Number(raw.round) || 0)),
    place: clean(raw.place, 120) || "at sea",
    lng,
    lat,
    warId: clean(raw.warId, 120),
    sides: [0, 1].map((side) => list(raw.sides?.[side]).map((name) => clean(name, 120)).filter(Boolean).slice(0, 12)),
    fleets,
    winner: raw.winner === 0 || raw.winner === 1 ? raw.winner : -1,
  };
};

export const normalizeNaviesRaised = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const country = clean(raw?.country, 120);
    const date = clean(raw?.date, 40);
    if (!country || !date) continue;
    kept.delete(country.toLowerCase());
    kept.set(country.toLowerCase(), { country, date });
  }
  return [...kept.values()].slice(-NAVIES_RAISED_KEPT_MOST);
};

export const normalizeSeaBattles = (value) => list(value).map(normalizeSeaBattle).filter(Boolean).slice(-SEA_BATTLES_KEPT_MOST);

// The world's battles with a turn's added and the old ones let go.
//   battles   what the turn's run fought (engine.js runNaval)
//   round     the round the turn makes it
export const withTurnSeaBattles = (kept, battles, round) => {
  const now = Math.max(0, Math.trunc(Number(round) || 0));
  const fresh = list(battles).map((battle) => normalizeSeaBattle({ ...battle, round: now })).filter(Boolean);
  const ids = new Set(fresh.map((battle) => battle.id));
  const older = normalizeSeaBattles(kept).filter((battle) => !ids.has(battle.id) && now - battle.round < SEA_BATTLE_ROUNDS_KEPT && battle.round <= now);
  return [...older, ...fresh].slice(-SEA_BATTLES_KEPT_MOST);
};
