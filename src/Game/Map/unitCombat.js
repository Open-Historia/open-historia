/*! Open Historia — unit combat resolution © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Deterministic, reproducible unit combat.
//
// A seeded PRNG (xmur3 hash -> mulberry32) derives outcomes from
// (attacker.id, defender.id, round) so the same clash always yields the same
// result and the AI can re-derive it when it adjudicates a jump.

const xmur3 = (str) => {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
};

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Rock-paper-scissors-style multiplier for attacker type vs defender type.
const ADVANTAGE = {
  armor: { infantry: 1.5, artillery: 1.3, garrison: 1.2, armor: 1.0, air: 0.7, naval: 0.5 },
  infantry: { artillery: 1.4, garrison: 1.1, infantry: 1.0, armor: 0.7, air: 0.6, naval: 0.5 },
  artillery: { garrison: 1.5, infantry: 1.2, armor: 1.0, artillery: 1.0, naval: 0.8, air: 0.5 },
  air: { naval: 1.5, armor: 1.4, artillery: 1.3, infantry: 1.2, garrison: 1.1, air: 1.0 },
  naval: { armor: 1.3, garrison: 1.2, infantry: 1.1, naval: 1.0, artillery: 1.0, air: 0.7 },
  garrison: { infantry: 1.2, garrison: 1.0, armor: 0.8, artillery: 0.7, naval: 0.7, air: 0.6 },
};

const advantage = (a, b) => ADVANTAGE[a]?.[b] ?? 1.0;

// ---- reach & feasibility -------------------------------------------------
// Units can't act across the planet at will: attacks resolve instantly only
// inside an era- and type-appropriate engagement range, and movement orders
// beyond a leash become multi-turn orders for the AI instead of teleports.

const EARTH_RADIUS_KM = 6371;

export const distanceKm = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad((b.lat ?? 0) - (a.lat ?? 0));
  const dLng = toRad((b.lng ?? 0) - (a.lng ?? 0));
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat ?? 0)) * Math.cos(toRad(b.lat ?? 0)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
};

// Immediate engagement range: how far a unit can strike RIGHT NOW.
const ENGAGEMENT_RANGE_KM = {
  garrison: 60,
  infantry: 100,
  artillery: 200,
  armor: 150,
  naval: 500,
  air: 1200,
};

// One-order movement leash: how far a single move order may relocate a unit
// before it has to become a multi-turn campaign the AI advances realistically.
const MOVE_LEASH_KM = {
  garrison: 200,
  infantry: 800,
  artillery: 800,
  armor: 1000,
  naval: 4000,
  air: 3000,
};

// Logistics scale with the era: a 1200 BC army does not operate like 1944.
export const eraReachFactor = (gameDate) => {
  const match = /(-?\d{3,4})/.exec(String(gameDate ?? ""));
  const bce = /BC|BCE/i.test(String(gameDate ?? ""));
  const year = match ? Number(match[1]) * (bce ? -1 : 1) : 2000;
  if (year < 1500) return 0.5;
  if (year < 1850) return 0.7;
  if (year < 1945) return 1;
  return 1.15;
};

export const engagementRangeKm = (type, gameDate) =>
  Math.round((ENGAGEMENT_RANGE_KM[type] ?? 100) * eraReachFactor(gameDate));

export const moveLeashKm = (type, gameDate) =>
  Math.round((MOVE_LEASH_KM[type] ?? 800) * eraReachFactor(gameDate));

export const resolveClash = (attacker, defender, round = 1) => {
  const rand = mulberry32(xmur3(`${attacker.id}|${defender.id}|${round}`)());
  const aPower = attacker.strength * advantage(attacker.type, defender.type) * (0.85 + 0.3 * rand());
  const dPower = defender.strength * advantage(defender.type, attacker.type) * (0.85 + 0.3 * rand()) * 1.1; // defender's-ground bonus
  const total = aPower + dPower || 1;
  const attackerWins = aPower >= dPower;
  const decisiveness = Math.abs(aPower - dPower) / total; // 0 = even, 1 = rout

  const attackerLoss = attackerWins ? 0.1 + 0.25 * (1 - decisiveness) : 0.35 + 0.45 * decisiveness;
  const defenderLoss = attackerWins ? 0.35 + 0.45 * decisiveness : 0.1 + 0.25 * (1 - decisiveness);

  const attackerStrength = Math.max(0, Math.round(attacker.strength * (1 - attackerLoss)));
  const defenderStrength = Math.max(0, Math.round(defender.strength * (1 - defenderLoss)));

  return {
    attackerStrength,
    defenderStrength,
    attackerWins,
    captured: defenderStrength <= 0 && attackerStrength > 0,
  };
};
