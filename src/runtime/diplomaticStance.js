/*! Open Historia — Diplomatic Stance Resolver © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { ownerIdentityKey, toCountryName } from "./ownerNames.js";

export const NEUTRAL_LAND_COLOR = "rgb(88, 98, 110)";

export const DIPLO_COLORS = Object.freeze({
  player: "rgb(37, 99, 235)",
  puppet: "rgb(20, 184, 166)",
  ally: "rgb(56, 189, 248)",
  enemy: "rgb(239, 68, 68)",
  hostile: "rgb(249, 115, 22)",
  friendly: "rgb(34, 197, 94)",
  neutral: "rgb(100, 116, 139)",
});

const ALLIANCE_AGREEMENT_TYPES = new Set(["alliance", "mutual_defense", "military_cooperation"]);
const FRIENDLY_AGREEMENT_TYPES = new Set(["trade_economic", "friendship_consultation"]);

const FRIENDLY_RELATION_STATUSES = new Set(["friendly", "cordial"]);
const HOSTILE_RELATION_STATUSES = new Set(["hostile", "rival"]);

const keyOf = (name) => ownerIdentityKey(toCountryName(name));
const keysOf = (names) => (Array.isArray(names) ? names : []).map(keyOf).filter(Boolean);

export function buildDiplomaticStanceMap({ playerCountry = "", wars = [], agreements = [], relations = [], puppets = [] } = {}) {
  const playerKey = keyOf(playerCountry);
  if (!playerKey) return null;

  const stanceMap = new Map([[playerKey, "player"]]);
  const mark = (key, stance) => {
    if (key && key !== playerKey && !stanceMap.has(key)) stanceMap.set(key, stance);
  };

  for (const row of Array.isArray(puppets) ? puppets : []) {
    if (String(row?.status || "active").toLowerCase() !== "active") continue;
    if (keyOf(row?.overlord) === playerKey) mark(keyOf(row?.puppet), "puppet");
  }

  for (const war of Array.isArray(wars) ? wars : []) {
    if (!["active", "ceasefire"].includes(String(war?.status || "").toLowerCase())) continue;
    const sideA = keysOf(war?.sideA);
    const sideB = keysOf(war?.sideB);
    const playerOnA = sideA.includes(playerKey);
    if (!playerOnA && !sideB.includes(playerKey)) continue;
    for (const key of playerOnA ? sideB : sideA) {
      if (key !== playerKey && stanceMap.get(key) !== "puppet") stanceMap.set(key, "enemy");
    }
    for (const key of playerOnA ? sideA : sideB) mark(key, "ally");
  }

  const inForce = (Array.isArray(agreements) ? agreements : [])
    .filter((agreement) => String(agreement?.status || "active").toLowerCase() === "active")
    .map((agreement) => ({ type: String(agreement?.type || "").toLowerCase(), parties: keysOf(agreement?.parties) }))
    .filter(({ parties }) => parties.includes(playerKey));
  for (const { type, parties } of inForce) {
    if (ALLIANCE_AGREEMENT_TYPES.has(type)) for (const key of parties) mark(key, "ally");
  }
  for (const { type, parties } of inForce) {
    if (FRIENDLY_AGREEMENT_TYPES.has(type)) for (const key of parties) mark(key, "friendly");
  }

  for (const relation of Array.isArray(relations) ? relations : []) {
    const a = keyOf(relation?.a);
    const b = keyOf(relation?.b);
    if (a !== playerKey && b !== playerKey) continue;
    const status = String(relation?.status || "").toLowerCase();
    const other = a === playerKey ? b : a;
    if (FRIENDLY_RELATION_STATUSES.has(status)) mark(other, "friendly");
    else if (HOSTILE_RELATION_STATUSES.has(status)) mark(other, "hostile");
  }

  return { playerKey, stanceMap };
}

export function getDiplomaticOwnerColor(owner, stanceData) {
  if (!owner || !stanceData) return NEUTRAL_LAND_COLOR;
  const key = keyOf(owner);
  if (!key) return NEUTRAL_LAND_COLOR;
  return DIPLO_COLORS[stanceData.stanceMap.get(key) || "neutral"] || DIPLO_COLORS.neutral;
}
