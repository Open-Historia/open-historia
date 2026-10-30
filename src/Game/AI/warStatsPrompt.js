/*! Open Historia — what a country at war knows of its own war, for diplomacy © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "when a country is at war, they should know their war stats and act
// accordingly in diplomacy (maybe they ask for help if they have low supplys,
// maybe they offer you a peace treaty if they are weary and dont want to
// continue fighting, its up to the ai but the ai has the stats to inform them)"
// (the owner, 2026-10-30).
//
// Every prompt in which a country at war speaks or decides its diplomacy is
// given this block for that country: the time skip (peacePrompt.js), the
// pulse between rounds (gameplay.js maybeSendIdleDiplomacy), a leader's reply
// in a one-on-one chat (main.jsx buildDiplomaticSystemPrompt) and a group
// chat's turn (gameplay.js runChatActionBatch). For each of its wars:
//
//   who is with it and against it, and who is bound to defend it
//   the ground: how many of the enemy's regions it holds, and of its own the enemy holds
//   how weary it is, and the enemy's first country
//   each battlefield: the formations of each side there, how strong, their
//                     reserves, those still mustering, and which way the line went
//   its supplies (war resources), a blockade laid on it, reparations it pays or is paid
//   calls to arms it made or is asked to answer, offers of peace on the table
//   what the game reckons peace on the old borders, or as the ground lies, is
//                     worth to it against fighting on (peaceTerms.js wouldAccept)
//
// The figures inform; they decide nothing. What the country does with them is
// the model's, as the block itself says. Every name is a name, never an id.
//
// Pure, and loads in plain Node.

import { describeBonds, normalizeCallsToArms } from "../../runtime/alliances.js";
import { isOpenBattlefield, normalizeBattlefields } from "../../runtime/fronts/record.js";
import { normalizeBlockades } from "../../runtime/naval/blockade.js";
import { TERRITORY_AS_HELD, TERRITORY_RESTORED, describeReparation, describeTerms, normalizePeaceOffers, normalizeReparations, openOfferBetween, standingOf, warBetween, wouldAccept } from "../../runtime/peaceTerms.js";
import { RESOURCES_SHORT_FROM, resourcesOf } from "../../runtime/warResources.js";
import { wearinessOf, wearinessWord } from "../../runtime/warWeariness.js";
import { groundReader } from "./warAndPeace.js";

export const WAR_STATS_HEADING = "[War Situation]";
// The same, for a leader told of its own country's wars only.
export const OWN_WARS_HEADING = "[Your Country's Wars]";
export const WAR_STATS_MAX = 3200;
// The most wars told of one country, and battlefields of one war.
export const WARS_TOLD_MOST = 3;
export const FIELDS_TOLD_MOST = 3;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const settleable = (war) => ["active", "ceasefire"].includes(fold(war?.status || "active"));
const sidesOf = (war) => [list(war?.sideA).map(clean).filter(Boolean), list(war?.sideB).map(clean).filter(Boolean)];
const joined = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

// What the block tells a model to do with it.
export const WAR_STATS_RULE = "These are the facts of each country's wars as the game keeps them, and its government knows them. Let them shape what it says and does in diplomacy, as its own interests and character would: supplies running short, thin reserves or a blockade are reasons to ask its allies or others for help; heavy weariness and ground lost are reasons to seek peace or a ceasefire; a war going its way is a reason to ask more or turn terms down. Nothing here obliges it to anything: what it does is its own decision.";

// The wars a country is in and still fighting.
export const warsOf = (world, country) => list(world?.wars).filter((war) => settleable(war) && sidesOf(war).some((members) => members.some((member) => fold(member) === fold(country))));

// Whether a country is in a war still being fought.
export const isAtWar = (world, country) => warsOf(world, country).length > 0;

// How many regions of whose each holds in one war: { taken, lost } for a country,
// counted from the regions held by one country and lawfully another's.
const regionsCount = (world, war, country) => {
  const sides = sidesOf(war).map((members) => new Set(members.map(fold)));
  const mine = sides[0].has(fold(country)) ? 0 : 1;
  const ownership = record(world?.regionOwnershipOverrides);
  let taken = 0;
  let lost = 0;
  for (const [regionId, sovereign] of Object.entries(record(world?.regionSovereigntyOverrides))) {
    const holder = fold(ownership[regionId]);
    const lawful = fold(sovereign);
    if (!holder || !lawful || holder === lawful) continue;
    if (holder === fold(country) && sides[1 - mine].has(lawful)) taken += 1;
    if (lawful === fold(country) && sides[1 - mine].has(holder)) lost += 1;
  }
  return { taken, lost };
};

// One battlefield as a country at war on it sees it: its side and the enemy's.
const fieldLine = (field, country) => {
  const side = field.sides.findIndex((members) => list(members).some((member) => fold(member) === fold(country)));
  if (side < 0) return "";
  const strength = list(field.brief?.strength);
  const say = (entry) => (entry
    ? `${Number(entry.n) || 0} formations at ${Number(entry.pct) || 0}%, reserves ${clean(entry.reserves) || "unknown"}${Number(entry.mustering) > 0 ? `, ${entry.mustering} more mustering` : ""}${Number(entry.tired) > 0 ? `, ${entry.tired} exhausted` : ""}`
    : "");
  const ours = strength[side];
  const theirs = strength[1 - side];
  const parts = [];
  if (ours || theirs) parts.push(`its side ${say(ours) || "unknown"}; the enemy ${say(theirs) || "unknown"}`);
  const power = (entry) => (Number(entry?.n) || 0) * (Number(entry?.pct) || 0);
  if (ours && theirs && power(theirs) > 0 && power(ours) > 0) {
    const ratio = power(ours) / power(theirs);
    if (ratio >= 1.5) parts.push("it is much the stronger there");
    else if (ratio <= 1 / 1.5) parts.push("the enemy is much the stronger there");
  }
  // Which way the line went in the last fighting: sector depths are side A's gain.
  const moved = list(field.brief?.sectors).reduce((sum, sector) => sum + (Number(sector?.moved) || 0), 0) * (side === 0 ? 1 : -1);
  if (moved >= 1) parts.push("the line has been moving its way");
  else if (moved <= -1) parts.push("the line has been moving against it");
  const took = list(field.brief?.cities?.[side]).slice(0, 3);
  const gave = list(field.brief?.cities?.[1 - side]).slice(0, 3);
  if (took.length) parts.push(`it took ${took.map((name) => `city: ${clean(name)}`).join(", ")}`);
  if (gave.length) parts.push(`it lost ${gave.map((name) => `city: ${clean(name)}`).join(", ")}`);
  return parts.length ? `${field.name}: ${parts.join("; ")}` : "";
};

// What the game reckons two terms worth to a country against fighting on: told, never applied.
const reckoning = (world, war, country, held) => {
  const ground = groundReader(world, held)(war.id, country);
  const standing = standingOf(ground);
  const weariness = wearinessOf(world?.warWeariness, country);
  const suits = (territory) => wouldAccept({ terms: { territory }, country, standing, weariness });
  const restored = suits(TERRITORY_RESTORED);
  const asHeld = suits(TERRITORY_AS_HELD);
  if (restored && asHeld) return "by the game's reckoning, peace on the old borders or as the ground now lies would both serve it better than fighting on";
  if (restored) return "by the game's reckoning, peace on the old borders would serve it better than fighting on; peace as the ground now lies would not";
  if (asHeld) return "by the game's reckoning, peace as the ground now lies would serve it better than fighting on; the old borders would not";
  return "by the game's reckoning, it has more to gain by fighting on than from a peace on the old borders or as the ground lies, unless it is paid";
};

// One country's wars, in lines; [] for a country at peace.
//   held      how many regions each country holds (warAndPeace.js regionHoldingsFromWorld, or the map's count), or null
export const describeWarStats = (world, country, { held = null } = {}) => {
  const name = clean(country);
  const wars = warsOf(world, name);
  if (!name || wars.length === 0) return [];
  const lines = [`${name}:`];
  const weary = Math.round(wearinessOf(world?.warWeariness, name));
  const fields = normalizeBattlefields(world?.battlefields).filter(isOpenBattlefield);
  for (const war of wars.slice(0, WARS_TOLD_MOST)) {
    const sides = sidesOf(war);
    const mine = sides[0].some((member) => fold(member) === fold(name)) ? 0 : 1;
    const friends = sides[mine].filter((member) => fold(member) !== fold(name));
    const enemies = sides[1 - mine];
    const enemy = enemies[0] ?? "";
    const enemyWeary = enemy ? Math.round(wearinessOf(world?.warWeariness, enemy)) : 0;
    const count = regionsCount(world, war, name);
    const title = clean(war.title) || `the war with ${enemy}`;
    const parts = [
      `against ${joined(enemies) || "an enemy"}${friends.length ? `, beside ${joined(friends)}` : ", alone"}${fold(war.status) === "ceasefire" ? ", under a ceasefire" : ""}`,
      `it holds ${count.taken} of the enemy's regions and the enemy holds ${count.lost} of its own`,
      `weariness ${weary}${wearinessWord(weary) ? ` (${wearinessWord(weary)})` : ""}${enemy ? `, ${enemy}'s ${enemyWeary}${wearinessWord(enemyWeary) ? ` (${wearinessWord(enemyWeary)})` : ""}` : ""}`,
    ];
    lines.push(`- ${title}: ${parts.join("; ")}.`);
    const own = fields.filter((field) => (field.warId && field.warId === clean(war.id)) || field.sides.some((members) => list(members).some((member) => fold(member) === fold(name))) && field.sides.some((members) => list(members).some((member) => fold(member) === fold(enemy))));
    for (const field of own.slice(0, FIELDS_TOLD_MOST)) {
      const line = fieldLine(field, name);
      if (line) lines.push(`  - ${line}.`);
    }
    if (enemy) lines.push(`  - ${reckoning(world, war, name, held)}.`);
  }
  if (wars.length > WARS_TOLD_MOST) lines.push(`- and ${wars.length - WARS_TOLD_MOST} more wars.`);
  const supplies = Math.round(resourcesOf(world?.warResources, name));
  if (supplies < 100) lines.push(`- Supplies (fuel, munitions, pay): ${supplies} of 100${supplies < RESOURCES_SHORT_FROM ? ", short: its armies are fighting worse for it" : ""}.`);
  const blockade = normalizeBlockades(world?.blockades).find((entry) => fold(entry.country) === fold(name));
  if (blockade) lines.push(`- Blockaded${blockade.by.length ? ` by ${joined(blockade.by)}` : ""} for ${blockade.days} days, at ${Math.round(blockade.pressure * 100)}% pressure: trade and supplies by sea are cut.`);
  const blockading = normalizeBlockades(world?.blockades).filter((entry) => entry.by.some((by) => fold(by) === fold(name))).map((entry) => entry.country);
  if (blockading.length) lines.push(`- Its fleets blockade ${joined(blockading)}.`);
  for (const entry of normalizeReparations(world?.reparations).filter((row) => fold(row.payer) === fold(name) || fold(row.receiver) === fold(name)).slice(0, 3)) lines.push(`- ${describeReparation(entry)}.`);
  const bonds = describeBonds(world, [name], { most: 1 });
  if (bonds.length) lines.push(`- ${bonds[0]}.`);
  for (const call of normalizeCallsToArms(world?.callsToArms).filter((entry) => entry.status === "open")) {
    if (fold(call.defender) === fold(name)) lines.push(`- It has called on ${call.ally} to defend it; no answer yet.`);
    else if (fold(call.ally) === fold(name)) lines.push(`- ${call.defender} has called on it to come to its defence.`);
  }
  for (const offer of normalizePeaceOffers(world?.peaceOffers).filter((entry) => entry.status === "open")) {
    if (fold(offer.from) === fold(name)) lines.push(`- It has offered ${offer.to} peace (${describeTerms(offer.terms)}); no answer yet.`);
    else if (fold(offer.to) === fold(name)) lines.push(`- ${offer.from} has offered it peace: ${describeTerms(offer.terms)}.`);
  }
  return lines;
};

// The block for several countries, those first that matter most; "" when none is at war.
//   countries   whose wars to tell, in order
//   held        as describeWarStats
//   max         the most characters
export const buildWarStatsBlock = ({ world = {}, countries = [], held = null, max = WAR_STATS_MAX, heading = WAR_STATS_HEADING } = {}) => {
  const seen = new Set();
  const told = [];
  let length = heading.length + WAR_STATS_RULE.length + 2;
  let left = 0;
  for (const country of list(countries)) {
    const key = fold(country);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const lines = describeWarStats(world, country, { held });
    if (lines.length === 0) continue;
    const text = lines.join("\n");
    if (length + text.length + 1 > max) {
      left += 1;
      continue;
    }
    told.push(text);
    length += text.length + 1;
  }
  if (told.length === 0) return "";
  return [heading, WAR_STATS_RULE, ...told, ...(left > 0 ? [`(${left} more ${left === 1 ? "country" : "countries"} at war not told for room.)`] : [])].join("\n");
};

// ---- peace in a chat ------------------------------------------------------------------------

export const PEACE_TALK_HEADING = "[Peace]";
// The hidden line a one-on-one leader's reply ends with (runtime/diplomaticEnvelope.js),
// and the field a group chat's answer carries (gameplaySchemas.js CHAT_ACTIONS_SCHEMA).
export const PEACE_LINE = "PEACE";
export const PEACE_ANSWERS_FIELD = "peaceAnswers";
const TERMS_FORM = "terms as \"as held; Borduria pays 2% for 5 years\" (each side keeps the ground it holds) or \"restored; none\" (the old borders, nobody pays)";

// What a leader nobody plays, at war with a person, is told of peace between
// them in a chat: the terms the person put to it, or the offer it made, or
// that it may offer peace itself; and how to say what it decides, which the
// game then carries out (warAndPeace.js answerPeaceProposal). "" when the two
// are not at war.
//   speaker   the leader's country
//   player    the person's
//   form      "line": a one-on-one reply's hidden PEACE line; "field": a group
//             chat's peaceAnswers field
export const describePeaceTalk = ({ world = {}, speaker = "", player = "", form = "line" } = {}) => {
  const war = warBetween(world?.wars, speaker, player);
  if (!war || !clean(speaker) || !clean(player)) return "";
  const open = openOfferBetween(world?.peaceOffers, speaker, player);
  const lines = [];
  if (open && fold(open.from) === fold(player)) {
    const ground = groundReader(world)(war.id, speaker);
    const suits = wouldAccept({ terms: open.terms, country: speaker, standing: standingOf(ground), weariness: wearinessOf(world?.warWeariness, speaker) });
    lines.push(`${player} has put these terms of peace to ${speaker}: ${describeTerms(open.terms)}. ${speaker} answers them now: it accepts them, declines them, or counters with terms of its own. By the game's reckoning these terms would serve ${speaker} ${suits ? "better" : "worse"} than fighting on; the decision is still its own.`);
  } else if (open) {
    lines.push(`${speaker} has offered ${player} peace (${describeTerms(open.terms)}), and waits for ${player}'s answer, which ${player} gives with the offer's own buttons. ${speaker} may also withdraw it by offering other terms.`);
  } else {
    lines.push(`${speaker} is at war with ${player}. It may offer ${player} peace in this answer if it wants to, on terms of its own; nothing obliges it to.`);
  }
  if (form === "field") {
    lines.push(`Say what a government decides of peace with ${player} in ${PEACE_ANSWERS_FIELD}, a line each: country | accept, decline, counter <terms> or offer <terms>, the ${TERMS_FORM}. Write no line for a government that decides nothing of peace now. What it says and its line must agree: the game makes the peace, or puts its offer before ${player}, from the line alone.`);
  } else {
    lines.push(`When ${speaker} decides something of peace in this reply, end the reply with one more hidden line: ${PEACE_LINE}:accept, ${PEACE_LINE}:decline, ${PEACE_LINE}:counter <terms> or ${PEACE_LINE}:offer <terms>, the ${TERMS_FORM}. Leave the line out when it decides nothing of peace. What the reply says and the line must agree: the game makes the peace, or puts the offer before ${player}, from the line alone.`);
  }
  return [PEACE_TALK_HEADING, ...lines].join("\n");
};
