/*! Open Historia — what the AI is told of deals with groups © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The words of group diplomacy: a group's line of standing for the time skip's
// [Groups] block, the rule that teaches the skip the deal types, and, in a
// chat, what a group's leadership is told it is. (What any treaty does is its
// effects, Game/AI/agreementEngine.js; how one is made in a chat, treatyTalk.js.)
// Light on purpose: the leader prompt (main.jsx) loads it with the first chat.

import { findGroupKey, normalizeGroupAreas, normalizeGroups } from "../../runtime/groups.js";
import { relationBandForScore } from "../../runtime/diplomaticStance.js";
import { GROUP_DEAL_TYPES, isDirectedGroupDeal, relationBetween } from "../../runtime/groupParties.js";

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
// and their direction. What a deal does is its effects, as for every agreement.
export const GROUP_DIPLOMACY_RULE = `A group is a party to relations and agreements like a country, written by its exact name ("group: Name" where a country has the same name). Deals with a group are agreementUpdates of type ${GROUP_DEAL_TYPES.join(", ")} (or any other type that fits); for protection, sponsorship, amnesty, recognition and crackdown the first party gives (pays, sponsors, grants, recognises, cracks down). Like every agreement each carries its effects (above). Honour or break them in the story; a group may write to the player through diplomaticOutreach, by its exact name.`;

// ---- a leader of a group, in a chat -------------------------------------------------------------

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
