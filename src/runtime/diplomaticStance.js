/*! Open Historia — Diplomatic Stance Resolver © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Where every country stands with one country, the FOCUS (the player's, or any
// the player clicks on the diplomatic map's Relations view), read from the
// world's own records only:
//
//   world.wars        active and ceasefire wars, by side
//   world.puppets     who answers to whom, as the PLAYER may see it (a covert
//                     arrangement the player has not learned of is not drawn,
//                     runtime/puppets.js livePuppetsFor)
//   world.agreements  every type, in force, a group's deals among them
//                     (runtime/groupParties.js): a group is a party like a
//                     country, and its area is drawn by its standing too
//   institutions      a shared security alliance or defence pact, a political
//                     or economic union (full members only)
//   world.relations   the bilateral climate, banded by its score exactly as
//                     the game bands it (AI/nativeDiplomaticDirector.js
//                     relationStatusForScore, pinned by the tests)
//
// A pair with several ties is drawn as the strongest, in RELATION_PRECEDENCE
// order: a war outranks an old trade deal, any treaty outranks the climate.
// A pair with no record of any kind is "unknown", which is not "neutral": the
// game treats an untracked pair as unknown, not as a score of zero.
//
// Pure: no IO. The map, the legend and the tests call it.

import { ownerIdentityKey, toCountryName } from "./ownerNames.js";
import { livePuppetsFor } from "./puppets.js";

// Drawn from the strongest down; the legend lists the categories in this order.
export const RELATION_PRECEDENCE = Object.freeze([
  "self",
  "overlord",
  "puppet",
  "war",
  "crackdown",
  "ceasefire",
  "alliance",
  "guarantee",
  "nonAggression",
  "peace",
  "access",
  "friendly",
  "trade",
  "agreement",
  // The climate, when no treaty says more ("friendly" here is a friendly score,
  // above it a treaty of friendship).
  "cordial",
  "neutral",
  "cautious",
  "strained",
  "hostile",
  "rival",
  "unknown",
]);
// The climate's bands, best first: below every treaty whatever the band.
export const CLIMATE_BANDS = Object.freeze(["friendly", "cordial", "neutral", "cautious", "strained", "hostile", "rival"]);

// Which category each agreement type draws as, a group's deals among them.
export const AGREEMENT_CATEGORY = Object.freeze({
  alliance: "alliance",
  mutual_defense: "alliance",
  military_cooperation: "alliance",
  guarantee: "guarantee",
  non_aggression: "nonAggression",
  neutrality: "nonAggression",
  peace_settlement: "peace",
  military_access: "access",
  friendship_consultation: "friendly",
  trade_economic: "trade",
  other: "agreement",
  truce: "nonAggression",
  protection: "agreement",
  sponsorship: "friendly",
  safe_passage: "access",
  smuggling: "trade",
  amnesty: "peace",
  hostage_exchange: "agreement",
  recognition: "friendly",
  crackdown: "crackdown",
});

// Which institutions bind their members as a treaty would.
export const INSTITUTION_KIND_CATEGORY = Object.freeze({
  security_alliance: "alliance",
  defense_pact: "alliance",
  political_union: "friendly",
  economic_union: "trade",
});

// The climate bands, from the score: the game's own thresholds.
export const relationBandForScore = (score) => {
  const numeric = Math.max(-100, Math.min(100, Math.round(Number(score) || 0)));
  if (numeric >= 55) return "friendly";
  if (numeric >= 20) return "cordial";
  if (numeric >= -10) return "neutral";
  if (numeric >= -30) return "cautious";
  if (numeric >= -60) return "strained";
  if (numeric > -90) return "hostile";
  return "rival";
};
const RELATION_BANDS = new Set(CLIMATE_BANDS);

// A relation row's band: its score where it has one, else the band it names.
export const relationBandOf = (relation) => {
  const raw = relation?.score;
  if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw))) return relationBandForScore(raw);
  const status = String(relation?.status || "").trim().toLowerCase();
  return RELATION_BANDS.has(status) ? status : "";
};

const RANK = new Map(RELATION_PRECEDENCE.map((category, index) => [category, index]));
const CLIMATE_BASE = RANK.get("agreement") + 1;
// How strong a tie is: a treaty by its category, the climate below them all.
export const relationRank = (category, why = null) => (why?.kind === "relation"
  ? CLIMATE_BASE + Math.max(0, CLIMATE_BANDS.indexOf(category))
  : RANK.get(category) ?? RANK.get("unknown"));

export const diplomaticKeyOf = (name) => ownerIdentityKey(toCountryName(name));
const keysOf = (names) => (Array.isArray(names) ? names : []).map(diplomaticKeyOf).filter(Boolean);
const lower = (value) => String(value ?? "").trim().toLowerCase();
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// The institutions as the map store keeps them (useWorldState.js): those still
// standing, each with its members' standing.
const standingInstitutions = (institutions) => (Array.isArray(institutions) ? institutions : [])
  .filter((institution) => institution && lower(institution.status) !== "dissolved");

/**
 * @returns {null | { focusKey, focusName, byKey: Map<key, { category, why }> }}
 *   `why` says what made the category: { kind: "war"|"ceasefire"|"ally-in-war", war }
 *   | { kind: "agreement", type, title } | { kind: "institution", institution, institutionKind }
 *   | { kind: "puppet"|"overlord", puppetKind } | { kind: "relation", band, score }.
 */
export function buildDiplomaticStanceMap({
  focusCountry = "",
  playerCountry = "",
  wars = [],
  agreements = [],
  relations = [],
  puppets = [],
  institutions = [],
} = {}) {
  const focusName = clean(focusCountry || playerCountry);
  const focusKey = diplomaticKeyOf(focusName);
  if (!focusKey) return null;

  const byKey = new Map([[focusKey, { category: "self", why: null }]]);
  const ranks = new Map();
  // A stronger tie replaces a weaker one; an equal one keeps the first found.
  const offer = (key, category, why) => {
    if (!key || key === focusKey) return;
    const rank = relationRank(category, why);
    if (ranks.has(key) && ranks.get(key) <= rank) return;
    ranks.set(key, rank);
    byKey.set(key, { category, why });
  };

  // Who answers to whom, as the player has seen it.
  const viewer = clean(playerCountry || focusName);
  for (const row of livePuppetsFor({ puppets: Array.isArray(puppets) ? puppets : [] }, viewer)) {
    const overlord = diplomaticKeyOf(row.overlord);
    const puppet = diplomaticKeyOf(row.puppet);
    if (puppet === focusKey) offer(overlord, "overlord", { kind: "overlord", puppetKind: row.kind });
    if (overlord === focusKey) offer(puppet, "puppet", { kind: "puppet", puppetKind: row.kind });
  }

  for (const war of Array.isArray(wars) ? wars : []) {
    const status = lower(war?.status);
    if (status !== "active" && status !== "ceasefire") continue;
    const sideA = keysOf(war?.sideA);
    const sideB = keysOf(war?.sideB);
    const onA = sideA.includes(focusKey);
    if (!onA && !sideB.includes(focusKey)) continue;
    const ref = { id: clean(war?.id), title: clean(war?.title) };
    for (const key of onA ? sideB : sideA) offer(key, status === "active" ? "war" : "ceasefire", { kind: status, war: ref });
    if (status === "active") for (const key of onA ? sideA : sideB) offer(key, "alliance", { kind: "ally-in-war", war: ref });
  }

  for (const agreement of Array.isArray(agreements) ? agreements : []) {
    if (lower(agreement?.status || "active") !== "active") continue;
    const parties = keysOf(agreement?.parties);
    if (!parties.includes(focusKey)) continue;
    const type = lower(agreement?.type);
    const category = AGREEMENT_CATEGORY[type] || "agreement";
    const why = {
      kind: "agreement",
      type: AGREEMENT_CATEGORY[type] ? type : "other",
      title: clean(agreement?.title),
      // Who stands behind whom in a guarantee, and who may cross whose land.
      ...(type === "guarantee" ? { guarantor: clean(agreement?.guarantor), beneficiary: clean(agreement?.beneficiary) } : {}),
      ...(type === "military_access" && agreement?.reciprocalAccess !== true ? { grantor: clean(agreement?.grantor), grantee: clean(agreement?.grantee) } : {}),
    };
    for (const key of parties) offer(key, category, why);
  }

  for (const institution of standingInstitutions(institutions)) {
    const category = INSTITUTION_KIND_CATEGORY[lower(institution.kind)];
    if (!category) continue;
    const full = (Array.isArray(institution.members) ? institution.members : [])
      .filter((member) => lower(member?.status || "member") === "member")
      .map((member) => diplomaticKeyOf(member?.polity))
      .filter(Boolean);
    if (!full.includes(focusKey)) continue;
    const why = { kind: "institution", institution: clean(institution.shortName || institution.name), institutionKind: lower(institution.kind) };
    for (const key of full) offer(key, category, why);
  }

  for (const relation of Array.isArray(relations) ? relations : []) {
    const a = diplomaticKeyOf(relation?.a);
    const b = diplomaticKeyOf(relation?.b);
    if (a !== focusKey && b !== focusKey) continue;
    const band = relationBandOf(relation);
    if (!band) continue;
    const score = Number(relation?.score);
    offer(a === focusKey ? b : a, band, { kind: "relation", band, score: Number.isFinite(score) ? Math.round(score) : null });
  }

  return { focusKey, focusName, byKey };
}

// One country's standing with the focus: its category and why.
export const stanceOf = (owner, stanceData) => {
  if (!stanceData) return { category: "unknown", why: null };
  const key = diplomaticKeyOf(owner);
  return (key && stanceData.byKey.get(key)) || { category: "unknown", why: null };
};
