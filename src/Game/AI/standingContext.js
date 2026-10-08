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

import { buildCompactEconomicContext, normalizeCountryStatSheet, normalizeCountryStatsHistory } from "../../runtime/countryStats.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { normalizeWorldState } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
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
  // A cleared (null) entry is no rating: Number(null) would read it as 0.
  const evolved = Number(asObject(world?.internationalReputation)[name] ?? NaN);
  if (Number.isFinite(evolved)) return clampPercent(evolved);
  const sheet = Number(asObject(asObject(world?.countryStats)[name]).indices?.internationalReputation ?? NaN);
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

// ---- The Stats sheet ---------------------------------------------------------

const compactNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const abs = Math.abs(number);
  if (abs >= 1e12) return `${Math.round((number / 1e12) * 10) / 10}T`;
  if (abs >= 1e9) return `${Math.round((number / 1e9) * 10) / 10}B`;
  if (abs >= 1e6) return `${Math.round((number / 1e6) * 10) / 10}M`;
  if (abs >= 1e3) return `${Math.round((number / 1e3) * 10) / 10}K`;
  return `${Math.round(number * 10) / 10}`;
};
const field = (label, value, format = (number) => `${number}`) =>
  (Number.isFinite(Number(value)) && value !== null && value !== "" ? `${label} ${format(Number(value))}` : "");

// One line of what a country's own sheet says, or "" when it has none:
// buildCompactEconomicContext (the economy and the autonomy indices, as the
// intelligence assessment reads it) and what that leaves out — population,
// stability, the security and sovereignty indices, and a scenario's own stats.
export const describeStatSheet = (sheetInput, name = "") => {
  const sheet = normalizeCountryStatSheet(sheetInput);
  if (!sheet) return "";
  const economic = asText(buildCompactEconomicContext(sheet));
  const custom = Object.entries(asObject(sheet.customStats)).slice(0, 16).map(([key, value]) => `${key} ${value}`);
  const rest = [
    field("population", sheet.population?.total, compactNumber),
    field("stability", sheet.stability, (number) => `${number}/100`),
    field("sovereignty", sheet.indices?.sovereignty, (number) => `${number}/100`),
    field("internal security", sheet.indices?.internalSecurity, (number) => `${number}/100`),
    asText(sheet.government) ? `government ${asText(sheet.government)}` : "",
    asText(sheet.leader) ? `leader ${asText(sheet.leader)}` : "",
    ...custom,
  ].filter(Boolean);
  if (!economic && !rest.length) return "";
  const prefix = asText(name) ? `${asText(name)}: ` : "";
  return `${prefix}${[rest.join("; "), economic].filter(Boolean).join(". ")}`;
};

// The last few samples of a country's Stats history, one dated line each, so a
// chart of change over time plots real points.
export const STAT_HISTORY_ROWS = 6;
export const describeStatHistory = (world, name, limit = STAT_HISTORY_ROWS) => {
  // This country's series only: the advisor asks on every message, and the
  // other polities' histories are not needed to read one.
  const key = asText(name);
  const samples = normalizeCountryStatsHistory({ [key]: asObject(world?.countryStatsHistory)[key] })[key] ?? [];
  return samples.slice(-Math.max(0, limit)).map((sample) => {
    const values = [
      field("GDP-eq", sample.gdp, (number) => `€${compactNumber(number)}`),
      field("growth", sample.gdpGrowth, (number) => `${number}%`),
      field("inflation", sample.inflation, (number) => `${number}%`),
      field("unemployment", sample.unemployment, (number) => `${number}%`),
      field("debt", sample.publicDebt, (number) => `${number}% GDP`),
      field("stability", sample.stability, (number) => `${number}/100`),
      field("population", sample.population, compactNumber),
      field("reputation", sample.internationalReputation, (number) => `${number}/100`),
    ].filter(Boolean);
    return values.length ? `- ${formatGameDateReadable(sample.date) || sample.date}: ${values.join("; ")}` : "";
  }).filter(Boolean);
};

// The advisor's [Our Country's Figures]: the government's own Stats sheet, the
// last few rows of its history, and its reputation and intelligence rating. The
// numbers the player sees in the Stats panel, so a figure the advisor quotes or
// charts is never one that contradicts it.
//
// `statistics` is the sheet in full, the [Official National Statistics] block
// (runtime/countryStats.js describeCountryStatsForAdvisor): a scenario's own
// stats under their own labels and units, the capital, GDP per capita, the
// sector shares and the recorded trend, with its own instruction to quote them.
// The advisor's prompt builds it, because it has to load the scenario's sheet
// definition. Given it, the block carries that in place of the one-line sheet
// and the history rows, so the figures stand in the prompt once.
export const describeOurFigures = (world, player, { statistics = "" } = {}) => {
  const name = asText(player);
  if (!name) return "";
  const official = String(statistics ?? "").trim();
  if (official) {
    return [
      "[Our Country's Figures]",
      describeReputationStanding(world, name),
      describeIntelligenceStanding(world, name),
      official,
    ].filter(Boolean).join("\n");
  }
  const sheet = describeStatSheet(asObject(world?.countryStats)[name], name);
  const history = describeStatHistory(world, name);
  return [
    "[Our Country's Figures]",
    sheet
      ? "The government's own Stats sheet, the figures the player sees in the Stats panel. Quote them and chart them as they are; never contradict them. Estimate only a figure that is not here, and say it is an estimate."
      : `No Stats sheet has been drawn up for ${name} yet. Estimate figures from the record, and say they are estimates.`,
    ...(sheet ? [sheet] : []),
    ...(history.length ? ["Recorded over time (use these points for a chart of change):", ...history] : []),
    describeReputationStanding(world, name),
    describeIntelligenceStanding(world, name),
  ].filter(Boolean).join("\n");
};

// A leader's [Standing]: the player's reputation and the speaker's own, and
// the speaker's own government's figures. Reputation is how far a government's
// word is taken; a leader that never saw it bargained as though aid and kept
// treaties counted for nothing. Its own sheet only: another country's figures
// are intelligence. With several speakers in one request (the group-chat
// batch) each one's reputation is listed and no sheet is: one government's
// figures must not reach another through a shared prompt.
export const describeLeaderStanding = (world, { player = "", speakers = [] } = {}) => {
  const voices = [...new Set((Array.isArray(speakers) ? speakers : [speakers]).map(asText).filter(Boolean))];
  const them = asText(player);
  if (!voices.length) return "";
  const line = (name) => {
    const value = reputationOf(world, name);
    return `${name}: international reputation ${value}/100 (${reputationBand(value)}).`;
  };
  const sheet = voices.length === 1 ? describeStatSheet(asObject(world?.countryStats)[voices[0]], voices[0]) : "";
  return [
    "[Standing]",
    ...(them && !voices.includes(them) ? [line(them)] : []),
    ...voices.map(line),
    "Reputation is how far the world takes a government at its word: aggression, atrocities and broken treaties lower it; aid and kept promises raise it. Let it weigh how much you trust an offer and what guarantees you ask for.",
    ...(sheet ? [`Your government's own figures: ${sheet}`] : []),
  ].join("\n");
};

// ---- Occupied and contested regions ----------------------------------------------

// The regions whose lawful owner (sovereign), holder on the ground
// (controller) and claimants are not simply one country, from the world's
// override ledgers and the region catalog's base owners.
export const territorialControlRows = (world, catalog = []) => {
  const byId = new Map((Array.isArray(catalog) ? catalog : []).map((region) => [region?.id, region]));
  const ownership = asObject(world?.regionOwnershipOverrides);
  const sovereignty = asObject(world?.regionSovereigntyOverrides);
  const claims = asObject(world?.regionClaimants);
  const ids = new Set([...Object.keys(ownership), ...Object.keys(sovereignty), ...Object.keys(claims)]);
  const rows = [];
  for (const regionId of ids) {
    const region = byId.get(regionId);
    const baseOwner = asText(region?.country || toCountryName(region?.countryCode) || "");
    const controller = asText(ownership[regionId]) || baseOwner;
    const sovereign = asText(sovereignty[regionId]) || controller || baseOwner;
    const claimants = (Array.isArray(claims[regionId]) ? claims[regionId] : []).map(asText).filter(Boolean);
    if (!claimants.length && controller.toLowerCase() === sovereign.toLowerCase()) continue;
    rows.push({ regionId, name: asText(region?.name) || regionId, sovereign, controller, claimants });
  }
  return rows;
};

// The rows in which any of `polities` is sovereign, controller or claimant.
export const territorialRowsInvolving = (rows, polities = []) => {
  const names = new Set(polities.map(asText).filter(Boolean));
  return rows.filter((row) => names.has(row.sovereign) || names.has(row.controller) || row.claimants.some((name) => names.has(name)));
};

export const NO_TERRITORIAL_ROWS = "No active occupation/control-vs-sovereignty differences or contested regions are currently recorded.";

export const describeTerritorialRows = (rows, { maxRows = 80, viaLookups = false, empty = NO_TERRITORIAL_ROWS } = {}) => {
  if (!rows.length) return empty;
  const lines = rows.slice(0, maxRows).map((row) =>
    `- ${row.name} (${row.regionId}): sovereign ${row.sovereign || "unknown"}; `
    + `controller ${row.controller || "unknown"}`
    + (row.claimants.length ? `; active claimants/contenders ${row.claimants.join(", ")}` : ""));
  return lines.join("\n") + (rows.length > maxRows
    ? `\n(+${rows.length - maxRows} more non-normal territorial states omitted${viaLookups ? "; contested_regions lists them all" : ""})`
    : "");
};

// The advisor's and a leader's [Occupied and Contested Regions]: the rows that
// involve the given polities, bounded. "" when there are none, so a world at
// peace pays nothing.
export const CONVERSATION_TERRITORIAL_ROWS = 24;
export const describeTerritoryFor = (world, catalog, polities) => {
  const rows = territorialRowsInvolving(territorialControlRows(world, catalog), polities);
  if (!rows.length) return "";
  return [
    "[Occupied and Contested Regions]",
    "Where the lawful owner (sovereign) and the holder on the ground (controller) differ, or others press a claim. Occupation is not annexation: a region held but not ceded still belongs to its sovereign.",
    describeTerritorialRows(rows, { maxRows: CONVERSATION_TERRITORIAL_ROWS }),
  ].join("\n");
};

// Does the world record any change of control, sovereignty or claim at all?
// A fresh game does not, and then nothing below needs the region catalog.
export const hasTerritorialRecords = (world) =>
  [world?.regionOwnershipOverrides, world?.regionSovereigntyOverrides, world?.regionClaimants]
    .some((ledger) => Object.keys(asObject(ledger)).length > 0);

// describeTerritoryFor from the world as it is stored, which is how the
// advisor, a leader and the group-chat batch hold it. The ledgers' owners are
// folded on read (gameState.js normalizeWorldState): an older save can file a
// region under a GADM code or a polity's era display name, and the rows are
// matched to the conversation's polities by exact name, so they are read
// through the same normalisation the jump's rows are. `loadCatalog` is asked
// only when there is something to describe.
export const describeTerritoryForConversation = async (world, loadCatalog, polities) => {
  if (!hasTerritorialRecords(world)) return "";
  const catalog = await Promise.resolve().then(loadCatalog).catch(() => []);
  return describeTerritoryFor(normalizeWorldState(world), catalog, polities);
};
