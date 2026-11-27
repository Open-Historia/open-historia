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
import { normalizeWarOutcome, outcomeSideOf, sideLabel } from "../../runtime/warEndings.js";
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

// The polities people play, each once, `player` first: a shared game's world
// task is told of every one of them (rule 9 of a shared game: what the
// simulation gives "the player" it gives each seat). One name, or none, is
// single player's, told exactly as it always was.
const peopleWith = (player, people) => {
  const names = [];
  for (const value of [player, ...(Array.isArray(people) ? people : [])]) {
    const name = asText(value);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
};

// The player's reputation line, then the other polities whose reputation has
// been recorded: the skip and the suggestion tasks write absolute values on
// polityChanges.reputation for any polity, and were never shown another's
// current value to move from. With several people (`people`, a shared game's
// world task) each player's is told by name: only the host's was, unnamed,
// so a guest's standing moved only if it was already among the recorded ten.
export const describeReputationStanding = (world, player, { fallback = null, people = [] } = {}) => {
  const name = asText(player);
  if (!name) return "No player polity is currently set.";
  const players = peopleWith(name, people);
  if (players.length > 1) {
    const own = players.map((polity) => {
      const value = reputationOf(world, polity, polity === name ? fallback : null);
      return `${polity} ${value}/100 (${reputationBand(value)})`;
    });
    const others = otherRecordedReputations(world, players);
    return [
      `International reputation of the players' polities: ${own.join(", ")}.`,
      ...(others.length ? [`Other recorded reputations: ${others.map(([other, score]) => `${other} ${score}/100`).join(", ")}. Every polity not listed stands at 50.`] : []),
    ].join("\n");
  }
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
// the AI has ever put a number on it (spycraft.js DEFAULT_INTELLIGENCE). With
// several people (`people`) every player's service is told, each by name: a
// guest who built a spy academy for years was shown no rating to move, unless
// theirs was already among the eight rated.
export const describeIntelligenceStanding = (world, player, { people = [] } = {}) => {
  const name = asText(player);
  if (!name) return "";
  const players = peopleWith(name, people);
  const lines = players.map((polity) => {
    const rating = intelligenceOf(world, polity);
    return `${polity}'s intelligence service: ${rating}/100 (${intelligenceBand(rating)}).`;
  });
  const rated = Object.entries(asObject(world?.intelligence))
    .map(([code, value]) => [asText(code), Number(value)])
    .filter(([code, value]) => code && !players.includes(code) && Number.isFinite(value))
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
      field("GDP-eq", sample.gdp, (number) => `$${compactNumber(number)}`),
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

// Issue #1000 (a 1947 save): Germany had surrendered and its wars were ended in the war ledger, but 18 regions of
// Poland were still held by the German Reich, so the map showed Poland German. Nothing ends an occupation when its
// war ends: only an event's control op or a transfer does, and the time skip was never told the war behind it was
// over. These are the occupations whose controller and sovereign face each other in no war still active or in
// ceasefire, and that are not between a puppet and its overlord: each is for the next time skip to settle. Who keeps
// the land is the story's to say (a surrender, a treaty, an annexation), so nothing is handed back here.
const SETTLING_WAR_STATUSES = new Set(["active", "ceasefire"]);
export const occupationsAfterTheirWar = (rows, world) => {
  const fold = (value) => asText(value).toLowerCase();
  const wars = (Array.isArray(world?.wars) ? world.wars : [])
    .filter((war) => SETTLING_WAR_STATUSES.has(fold(war?.status) || "active"))
    .map((war) => [new Set((war?.sideA ?? []).map(fold)), new Set((war?.sideB ?? []).map(fold))]);
  const atWar = (a, b) => wars.some(([sideA, sideB]) => (sideA.has(a) && sideB.has(b)) || (sideA.has(b) && sideB.has(a)));
  const tied = new Set((Array.isArray(world?.puppets) ? world.puppets : [])
    .filter((entry) => fold(entry?.status || "active") === "active")
    .flatMap((entry) => [`${fold(entry?.overlord)}|${fold(entry?.puppet)}`, `${fold(entry?.puppet)}|${fold(entry?.overlord)}`]));
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const controller = fold(row?.controller);
    const sovereign = fold(row?.sovereign);
    return controller && sovereign && controller !== sovereign
      && !atWar(controller, sovereign) && !tied.has(`${controller}|${sovereign}`);
  });
};

// The war that brought an occupation, as the war ledger tells it: the latest ended war with the occupier and the
// sovereign on opposite sides, { id, title, ended, note, outcome }, or null. A live skip (issue #1000,
// gemini-3.5-flash-lite) given only "German Reich holds 17 regions of Poland" handed them to the German Reich, which
// had surrendered; the war's outcome (runtime/warEndings.js) is what settles it.
export const occupationWar = (world, controller, sovereign) => {
  const fold = (value) => asText(value).toLowerCase();
  const a = fold(controller);
  const b = fold(sovereign);
  const war = (Array.isArray(world?.wars) ? world.wars : [])
    .filter((entry) => fold(entry?.status) === "ended")
    .filter((entry) => {
      const sideA = (entry?.sideA ?? []).map(fold);
      const sideB = (entry?.sideB ?? []).map(fold);
      return (sideA.includes(a) && sideB.includes(b)) || (sideA.includes(b) && sideB.includes(a));
    })
    .sort((x, y) => asText(y?.endedDate).localeCompare(asText(x?.endedDate)))[0];
  if (!war) return null;
  return {
    id: asText(war.id),
    title: asText(war.title),
    ended: asText(war.endedDate),
    note: asText(war.note).slice(0, 200),
    outcome: normalizeWarOutcome(war.outcome),
  };
};
const describeOccupationWar = (war) => (war
  ? `Their war${war.title ? ` (${war.title})` : ""} ended${war.ended ? ` ${war.ended}` : ""}${war.note ? `: ${war.note}` : ""}`
  : "");

// What a war's recorded outcome says of an occupation it left: "returned" when the occupier lost, "kept" when the
// sovereign did, "" when it says neither (no outcome, or nobody lost).
export const occupationRuling = (war, controller, sovereign) => {
  if (!war) return "";
  if (outcomeSideOf(war, controller) === "lost") return "returned";
  if (outcomeSideOf(war, sovereign) === "lost") return "kept";
  return "";
};

// Those rows by occupier and sovereign, the largest first: [{ key, controller, sovereign, rows, war, ruling }].
// An occupation is settled one of three ways:
//   - its war has a recorded outcome with a loser: `ruling` says how, and the game settles it (gameplay.js);
//   - its war is one the skip is asked the outcome of (`awaiting`: war ids, runtime/warEndings.js
//     warsAwaitingOutcome): it follows from that answer, so it is not asked again;
//   - otherwise the skip is asked, and `key` ("o1", "o2"…) is what it answers in occupationSettlements.
// The block, the tool and the reading all take the keys from here, from the same world. At most
// OCCUPATION_GROUPS_MOST groups are asked (the rest wait for a later skip); the others have key "".
export const OCCUPATION_GROUPS_MOST = 12;
export const occupationGroups = (rows, world = null, { awaiting = null } = {}) => {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = `${asText(row.controller).toLowerCase()}\u0001${asText(row.sovereign).toLowerCase()}`;
    const group = groups.get(id) ?? { controller: row.controller, sovereign: row.sovereign, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  const waiting = awaiting instanceof Set ? awaiting : new Set(Array.isArray(awaiting) ? awaiting : []);
  let asked = 0;
  return [...groups.values()]
    .sort((a, b) => b.rows.length - a.rows.length || `${a.controller}|${a.sovereign}`.localeCompare(`${b.controller}|${b.sovereign}`))
    .map((group) => {
      const war = occupationWar(world, group.controller, group.sovereign);
      const ruling = occupationRuling(war, group.controller, group.sovereign);
      const ask = !ruling && !(war && waiting.has(war.id)) && asked < OCCUPATION_GROUPS_MOST;
      if (ask) asked += 1;
      return { key: ask ? `o${asked}` : "", ...group, war, ruling };
    });
};

// The block for the time skip: each group it is asked about, under its key, with the regions, every region by the
// name it is written with (`regionName`, nameRefs.js regionNamer: "region: X" where needed). Empty when there is none.
export const OCCUPATIONS_AFTER_WAR_MOST = 60;
export const describeOccupationsAfterTheirWar = (rows, { regionName = null, most = OCCUPATIONS_AFTER_WAR_MOST, world = null, awaiting = null } = {}) => {
  const groups = occupationGroups(rows, world, { awaiting }).filter((group) => group.key).map((group) => ({
    ...group,
    names: group.rows.map((row) => (regionName ? regionName(row.regionId, row.name) : "") || row.name),
  }));
  if (!groups.length) return "";
  let room = most;
  const lines = groups.map((group) => {
    const shown = group.names.slice(0, Math.max(0, room));
    room -= shown.length;
    const rest = group.names.length - shown.length;
    return `- ${group.key}: ${group.controller} holds ${group.names.length === 1 ? "a region" : `${group.names.length} regions`} of ${group.sovereign}: ${shown.join(", ") || "(listed above)"}${rest > 0 ? ` (+${rest} more)` : ""}${group.war ? `. ${describeOccupationWar(group.war)}` : ""}`;
  });
  return [
    "[Occupations Outliving Their War]",
    "These regions are held by a power no longer at war with their sovereign, and nothing has settled the land since. In occupationSettlements, answer each key below as the story has it: 'returned' where the occupier withdrew or was driven out and the sovereign holds the land again, 'kept' where a treaty or annexation made it the occupier's own. Tell it in an event where it matters to the story.",
    ...lines,
  ].join("\n");
};

// The ended wars the skip is asked the outcome of (runtime/warEndings.js warsAwaitingOutcome), as its block:
// each under its key, its sides, when it ended and how the ledger noted it. Empty when there is none.
export const describeWarsAwaitingOutcome = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  return [
    "[Wars Ended Without an Outcome]",
    "These wars have ended, and the game does not yet know how. In warEndings, answer each key below as the story has it: which side had surrendered or been defeated when the war ended, whatever happened earlier in it; whether the defeated state's government was dissolved; and if it was, in landTo, the full names of the powers that took over its land, which the game divides among them by where each stands. The land a defeated occupier still holds goes back to its sovereign, and a defeated sovereign's land its occupier keeps; a dissolved state leaves the map, its armies with it.",
    ...entries.map((entry) => `- ${entry.key}: ${entry.title || "a war"}: ${sideLabel(entry.sideA)} against ${sideLabel(entry.sideB)}, ended${entry.ended ? ` ${entry.ended}` : ""}${entry.note ? `: ${entry.note}` : ""}`),
  ].join("\n");
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
    `- ${row.name}: sovereign ${row.sovereign || "unknown"}; `
    + `controller ${row.controller || "unknown"}`
    + (row.claimants.length ? `; active claimants/contenders ${row.claimants.join(", ")}` : ""));
  return lines.join("\n") + (rows.length > maxRows
    ? `\n(+${rows.length - maxRows} more non-normal territorial states omitted${viaLookups ? "; contested_regions lists them all" : ""})`
    : "");
};

// A time skip's [Occupied and Contested Regions]: the same rows, those with the
// same sovereign, controller and claimants in one line. The lines that involve a
// power in view (`inView`, lower-case names: promptFocus.js) come first and name
// every region; the rest name the first few and count the others, so every
// region the untiered list showed is still at least counted, under who holds it.
export const TERRITORIAL_BRIEF_NAMES = 6;
export const describeTerritorialRowsGrouped = (rows, { inView = new Set(), maxNames = 240, maxBriefLines = 40, viaLookups = false, empty = NO_TERRITORIAL_ROWS } = {}) => {
  if (!rows.length) return empty;
  const fold = (value) => asText(value).toLowerCase();
  const groups = new Map();
  for (const row of rows) {
    const claimants = [...row.claimants].sort((a, b) => a.localeCompare(b));
    const key = [fold(row.sovereign), fold(row.controller), ...claimants.map(fold)].join("|");
    const group = groups.get(key) ?? { sovereign: row.sovereign, controller: row.controller, claimants, names: [] };
    group.names.push(row.name);
    groups.set(key, group);
  }
  const involves = (group) => [group.sovereign, group.controller, ...group.claimants].some((name) => inView.has(fold(name)));
  const ordered = [...groups.values()]
    .map((group, index) => ({ group, index, viewed: involves(group) }))
    .sort((a, b) => Number(b.viewed) - Number(a.viewed) || b.group.names.length - a.group.names.length || a.index - b.index);
  let room = maxNames;
  let unnamed = 0;
  let briefLines = 0;
  let skipped = 0;
  const lines = [];
  for (const { group, viewed } of ordered) {
    if (!viewed && briefLines >= maxBriefLines) {
      skipped += group.names.length;
      continue;
    }
    if (!viewed) briefLines += 1;
    const want = viewed ? group.names.length : Math.min(TERRITORIAL_BRIEF_NAMES, group.names.length);
    const shown = group.names.slice(0, Math.max(0, Math.min(want, room)));
    room -= shown.length;
    const more = group.names.length - shown.length;
    unnamed += more;
    const who = fold(group.sovereign) === fold(group.controller)
      ? `sovereign and controller ${group.sovereign || "unknown"}`
      : `sovereign ${group.sovereign || "unknown"}, controller ${group.controller || "unknown"}`;
    const claims = group.claimants.length ? `, claimed by ${group.claimants.join(", ")}` : "";
    lines.push(`- ${who}${claims} (${group.names.length} region${group.names.length === 1 ? "" : "s"}): ${shown.join(", ")}${more > 0 ? `${shown.length ? ", " : ""}(+${more} more)` : ""}`);
  }
  return lines.join("\n")
    + (skipped > 0 ? `\n(+${skipped} more non-normal territorial states among powers not in play omitted${viaLookups ? "; contested_regions lists them all" : ""})` : "")
    + (unnamed > 0 && !skipped && viaLookups ? "\n(contested_regions lists every region)" : "");
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
