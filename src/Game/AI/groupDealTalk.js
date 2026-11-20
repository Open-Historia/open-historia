/*! Open Historia — what the AI is told of deals with groups © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The words of group diplomacy (Game/AI/groupDeals.js carries the deals out):
// a group's line of standing for the time skip's [Groups] block, the rule that
// teaches the skip the deal types, and, in a chat, what a group's leadership is
// told it is and how it says what it decides of a deal (a hidden DEAL line,
// runtime/diplomaticEnvelope.js). Light on purpose: the leader prompt
// (main.jsx) loads it with the first chat.

import { findGroupKey, normalizeGroupAreas, normalizeGroups } from "../../runtime/groups.js";
import { relationBandForScore } from "../../runtime/diplomaticStance.js";
import {
  GROUP_DEAL_TYPES,
  dealsBetween,
  isDirectedGroupDeal,
  isGroupDealType,
  isUnilateralGroupDeal,
  relationBetween,
} from "../../runtime/groupParties.js";

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const figure = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

// ---- what the AI is told --------------------------------------------------------------------------

// A deal in a line: its type, who gives where it has a direction, its title.
export const describeDeal = (agreement) => {
  const parties = list(agreement?.parties).map((party) => clean(party));
  const who = isDirectedGroupDeal(agreement?.type) && parties.length >= 2
    ? `${parties[0]} → ${parties[1]}`
    : parties.join(" / ");
  const title = clean(agreement?.title, 80);
  const status = fold(agreement?.status || "active") === "suspended" ? ", suspended" : "";
  return `${agreement?.type} (${who}${status})${title && title !== clean(agreement?.id) ? ` "${title}"` : ""}`;
};

// One short line of a group's standing with the world, for the [Groups] block: its strongest
// relations and its deals in force. "" when it has neither.
export const describeGroupStanding = (world, group, { maxRelations = 3, maxDeals = 4 } = {}) => {
  const key = clean(group);
  if (!key) return "";
  const relations = list(world?.relations)
    .filter((row) => fold(row?.a) === fold(key) || fold(row?.b) === fold(key))
    .sort((p, q) => Math.abs(figure(q?.score)) - Math.abs(figure(p?.score)))
    .slice(0, maxRelations)
    .map((row) => `${fold(row.a) === fold(key) ? clean(row.b) : clean(row.a)} ${relationBandForScore(row.score)} ${Math.round(figure(row.score))}`);
  const deals = list(world?.agreements)
    .filter((agreement) => ["active", "suspended"].includes(fold(agreement?.status || "active")) && list(agreement?.parties).some((party) => fold(party) === fold(key)))
    .slice(0, maxDeals)
    .map(describeDeal);
  return [
    relations.length ? `relations: ${relations.join(", ")}` : "",
    deals.length ? `deals: ${deals.join("; ")}` : "",
  ].filter(Boolean).join("; ");
};

// What a skip is told of deals with groups, after the groups' own rule: compact, the types
// and their direction, and that the game carries each one out.
export const GROUP_DIPLOMACY_RULE = `A group is a party to relations and agreements like a country, written by its exact name ("group: Name" where a country has the same name). Deals with a group are agreementUpdates of type ${GROUP_DEAL_TYPES.join(", ")}; for protection, sponsorship, amnesty, recognition and crackdown the first party gives (pays, sponsors, grants, recognises, cracks down). The game carries them out: payments, a group's strength, truces and amnesties in wars, a crackdown retaking its area. Honour or break them in the story (end, with the event); a group may write to the player through diplomaticOutreach, by its exact name.`;

// ---- a leader of a group, in a chat -------------------------------------------------------------

export const DEAL_LINE = "DEAL";
const DEAL_VERDICTS = new Set(["sign", "decline", "offer", "end"]);
const GIVER_WORDS = new Set(["us", "you"]);

// What a group's leader is told of the deals between it and the player, and how to say what it
// decides: a hidden DEAL line its reply ends with (runtime/diplomaticEnvelope.js). "" when the
// speaker is no group.
export const describeDealTalk = ({ world = {}, speaker = "", player = "", openOffer = null } = {}) => {
  const group = findGroupKey(record(world?.groups), speaker);
  if (!group || !clean(player)) return "";
  const lines = ["[Deals]"];
  const inForce = dealsBetween(world, group, player);
  lines.push(inForce.length
    ? `In force between ${group} and ${player}: ${inForce.map(describeDeal).join("; ")}.`
    : `No deal is in force between ${group} and ${player}.`);
  if (openOffer && fold(openOffer.to) === fold(group) && openOffer.status === "open") {
    const giver = openOffer.giverIsTo ? group : clean(openOffer.from);
    const direction = isDirectedGroupDeal(openOffer.type) ? ` (${giver} gives)` : "";
    lines.push(`${player} has put a deal to ${group}: ${openOffer.type}${direction}${clean(openOffer.title) ? `, "${clean(openOffer.title)}"` : ""}${clean(openOffer.terms) ? `; terms: ${clean(openOffer.terms, 600)}` : ""}. ${group} answers it now, as its own interests and nature say.`);
  } else if (openOffer && fold(openOffer.from) === fold(group) && openOffer.status === "open") {
    lines.push(`${group} has put a deal to ${player} (${openOffer.type}) and waits for ${player}'s answer, which ${player} gives with the offer's own buttons.`);
  }
  lines.push(`When ${group} decides something of a deal in this reply, end the reply with one hidden line: ${DEAL_LINE}:sign or ${DEAL_LINE}:decline (the deal ${player} put), ${DEAL_LINE}:offer <type>|<us or you>|<title>|<terms> to put one of its own (type one of ${GROUP_DEAL_TYPES.filter((type) => !isUnilateralGroupDeal(type)).join(", ")}; us or you: who gives, for ${["protection", "sponsorship", "amnesty", "recognition"].join(", ")}), or ${DEAL_LINE}:end <type> to break one in force. The word after the colon is one of those four, written so whatever language the reply is in. Leave the line out when it decides nothing. The reply and the line must agree: the game carries out the line alone.`);
  return lines.join("\n");
};

// What a DEAL line says: { verdict, type?, giver?, title?, terms? }, or null when it is
// none of the four the game reads (the closed set, its case aside).
export const readDealLine = (line) => {
  const text = clean(line, 2000);
  if (!text) return null;
  const [head, ...rest] = text.split(/\s+/);
  const verdict = fold(head);
  if (!DEAL_VERDICTS.has(verdict)) return null;
  if (verdict === "sign" || verdict === "decline") return { verdict };
  const body = rest.join(" ");
  if (verdict === "end") {
    const type = fold(body).replace(/[ -]+/g, "_");
    return isGroupDealType(type) ? { verdict, type } : null;
  }
  const [rawType, rawGiver, title = "", ...terms] = body.split("|").map((part) => part.trim());
  const type = fold(rawType).replace(/[ -]+/g, "_");
  if (!isGroupDealType(type) || isUnilateralGroupDeal(type)) return null;
  const giver = fold(rawGiver);
  return {
    verdict,
    type,
    giver: GIVER_WORDS.has(giver) ? giver : "us",
    title: clean(title, 120),
    terms: terms.join("|").trim().slice(0, 1200),
  };
};

// What a group's leader is told it is, in a chat: a group, not a government, in its own voice.
// "" when the speaker is no group.
export const describeGroupLeaderBrief = ({ world = {}, speaker = "", player = "", regionName = () => "" } = {}) => {
  const groups = normalizeGroups(world?.groups);
  const key = findGroupKey(groups, speaker);
  if (!key) return "";
  const group = groups[key];
  const areas = normalizeGroupAreas(world?.groupAreas, groups);
  const regions = Object.entries(areas).filter(([, name]) => name === key).map(([regionId]) => regionId);
  const named = regions.map((regionId) => regionName(regionId)).filter(Boolean).slice(0, 12);
  const area = regions.length
    ? `It controls ${regions.length} region${regions.length === 1 ? "" : "s"}${named.length ? `: ${named.join(", ")}${regions.length > named.length ? `, +${regions.length - named.length} more` : ""}` : ""}.`
    : "It controls no area on the map.";
  const relation = relationBetween(world, key, player);
  const standing = relation
    ? `Its relation with ${player}: ${relationBandForScore(relation.score)} (${Math.round(figure(relation.score))} of -100 to 100).`
    : `It has no recorded relation with ${player} yet.`;
  return [
    `[You Speak for a Group, Not a Government]`,
    `${key} is a group, not a state${group.description ? `: ${group.description.replace(/\n+/g, " ")}` : "."}`,
    `${area} Every region it holds stays its country's.`,
    standing,
    `Where the instructions above speak of a government, a leader or a country, read ${key}'s leadership. Answer in ${key}'s own voice, the way such a group speaks given what it is, wants and fears; never as a state's diplomat unless that is what it is. It cannot sign for a country, and it bargains with what it has: its fighters, its ground, its trade, its silence.`,
  ].join("\n");
};
