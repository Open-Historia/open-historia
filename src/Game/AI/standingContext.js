/*! Open Historia — what a prompt is told of a country's standing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/standingContext.test.js
//
// The numbers the game keeps about a country, as the prompts read them:
// international reputation (world.internationalReputation), the intelligence
// rating (world.intelligence), the Stats sheet and its history
// (world.countryStats, world.countryStatsHistory), and the regions whose
// lawful owner, holder and claimants differ (world.regionOwnershipOverrides,
// regionSovereigntyOverrides, regionClaimants).
//
// The time skip and the suggestion tasks read them through gameplay.js
// buildTemplateVariables; the advisor and the leaders (main.jsx) are built
// without it, and so never saw them — an advisor asked "how is our economy
// doing?" invented figures that contradicted the Stats panel beside it, and a
// leader judged the player without knowing the player's reputation. One module
// for both, so the two sides cannot drift.
//
// Plain data in, text out: the caller hands in the world as the audience has
// seen it (viewAsSeen) and, for territory, the region catalog. Polity names are
// exact keys, never folded.

import { intelligenceOf } from "../../runtime/spycraft.js";

const asText = (value) => String(value ?? "").trim();
const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value)));

// ---- Reputation --------------------------------------------------------------

export const reputationBand = (value) => (value >= 70 ? "well-regarded" : value >= 40 ? "mixed" : "poor");

// A polity's recorded reputation, 0-100, or null: the value the AI evolves
// each turn, else the one on its Stats sheet.
export const recordedReputation = (world, polity) => {
  const name = asText(polity);
  if (!name) return null;
  const evolved = Number(asObject(world?.internationalReputation)[name]);
  if (Number.isFinite(evolved)) return clampPercent(evolved);
  const sheet = Number(asObject(asObject(world?.countryStats)[name]).indices?.internationalReputation);
  return Number.isFinite(sheet) ? clampPercent(sheet) : null;
};

// Never "unknown": a polity nobody has rated stands at a neutral 50.
export const reputationOf = (world, polity, fallback = null) => {
  const recorded = recordedReputation(world, polity);
  if (recorded !== null) return recorded;
  const other = fallback === null || fallback === undefined || fallback === "" ? NaN : Number(fallback);
  return Number.isFinite(other) ? clampPercent(other) : 50;
};

// The reputations the AI has actually moved, the most extreme first: every
// other polity is a neutral 50 by definition, and listing two hundred of those
// would bury the few that carry a judgement.
export const OTHER_REPUTATIONS_LISTED = 10;
export const otherRecordedReputations = (world, exclude = [], limit = OTHER_REPUTATIONS_LISTED) => {
  const skip = new Set(exclude.map(asText).filter(Boolean));
  return Object.entries(asObject(world?.internationalReputation))
    .map(([name, value]) => [asText(name), Number(value)])
    .filter(([name, value]) => name && !skip.has(name) && Number.isFinite(value) && clampPercent(value) !== 50)
    .map(([name, value]) => [name, clampPercent(value)])
    .sort((left, right) => Math.abs(right[1] - 50) - Math.abs(left[1] - 50) || left[0].localeCompare(right[0]))
    .slice(0, Math.max(0, limit));
};

// The player's reputation line, then the other polities whose reputation has
// been recorded: the skip and the suggestion tasks write absolute values on
// polityChanges.reputation for any polity, and were never shown another's
// current value to move from.
export const describeReputationStanding = (world, player, { fallback = null } = {}) => {
  const name = asText(player);
  if (!name) return "No player polity is currently set.";
  const value = reputationOf(world, name, fallback);
  const lines = [`International reputation: ${value}/100 (${reputationBand(value)}).`];
  const others = otherRecordedReputations(world, [name]);
  if (others.length) {
    lines.push(`Other recorded reputations: ${others.map(([other, score]) => `${other} ${score}/100`).join(", ")}. Every polity not listed stands at 50.`);
  }
  return lines.join("\n");
};

// ---- Intelligence ------------------------------------------------------------

export const intelligenceBand = (value) => (value >= 75 ? "formidable" : value >= 55 ? "capable" : value >= 35 ? "ordinary" : "weak");

// The player's service, then the other services the AI has actually rated.
// Unrated is "ordinary", not "none": every polity runs a service whether or not
// the AI has ever put a number on it (spycraft.js DEFAULT_INTELLIGENCE).
export const describeIntelligenceStanding = (world, player) => {
  const name = asText(player);
  if (!name) return "";
  const rating = intelligenceOf(world, name);
  const lines = [`${name}'s intelligence service: ${rating}/100 (${intelligenceBand(rating)}).`];
  const rated = Object.entries(asObject(world?.intelligence))
    .map(([code, value]) => [asText(code), Number(value)])
    .filter(([code, value]) => code && code !== name && Number.isFinite(value))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8);
  if (rated.length > 0) {
    lines.push(`Other rated services: ${rated.map(([code, value]) => `${code} ${Math.round(value)}/100`).join(", ")}.`);
  }
  return lines.join("\n");
};
