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
