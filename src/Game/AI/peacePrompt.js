/*! Open Historia — what a time skip is told of war weariness, peace and alliances © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game itself keeps how weary of war each country is, brings a defender's
// allies into its war, carries out peace on terms and collects reparations
// (warAndPeace.js). The skip is told what the game has done and will do, so
// that the story tells it and does not do it a second time or the other way.
//
// Whether a country wants peace is the skip's to decide, not the game's ("it
// should not be fully deterministic anymore", the owner, 2026-10-30): it is
// told how to offer a player peace (a letter of diplomaticOutreach carrying
// peaceOffer) and how to say two countries nobody plays made peace (a line of
// peaceTreaties), and every country at war's own figures to judge by
// (warStatsPrompt.js).
//
// It stands after the [Fronts] and [Seas] blocks in the skip's live records.
// In a world at peace with no alliance in it, it is nothing. Every name
// carries no id.
//
// Pure, and loads in plain Node.

import { describeBonds } from "../../runtime/alliances.js";
import { REPARATIONS_SHARE_CAP, REPARATIONS_YEARS_CAP, describeReparation, describeTerms, normalizePeaceOffers, normalizePeaceTreaties, normalizeReparations } from "../../runtime/peaceTerms.js";
import { normalizeWarWeariness, wearinessWord } from "../../runtime/warWeariness.js";
import { normalizeCallsToArms } from "../../runtime/alliances.js";
import { WAR_STATS_MAX, buildWarStatsBlock } from "./warStatsPrompt.js";

export const PEACE_BLOCK_HEADING = "[War Weariness, Peace and Alliances]";
export const PEACE_BLOCK_MAX = 2600 + WAR_STATS_MAX;
export const WEARY_TOLD_FROM = 20;
// How many turns back an offer turned down is still told.
export const DECLINED_TOLD_ROUNDS = 3;
// The skip's answer field for the peaces two countries nobody plays made (gameplaySchemas.js).
export const PEACE_TREATIES_FIELD = "peaceTreaties";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

const ALLIANCE_RULE = "Alliances bind, and the game acts on them. When a war begins, the country it was begun against is joined, as the period ends and by the game itself, by those bound to defend it: the other parties of an active alliance or mutual defence agreement, the guarantor of a guarantee, and the full members of a security alliance or defence pact it belongs to. Write no join for them. An ally that will not come breaks the treaty: tell that in an event and end or suspend the agreement in the same answer, and the game takes it off the breaker's reputation. A country a person plays is asked by the game and answers for itself.";
const WEARY_RULE = "The game keeps how weary of its war each country is, from 0 (fresh) to 100 (spent): it rises with time, the men called up, ground lost and a blockade. Tell it at home, the more the higher: shortages, strikes, desertion, a government pressed to end the war. Its armies recover more slowly for it; the game does that.";
const PEACE_RULE = [
  `A war can end on terms: who keeps the ground ("as held": each side keeps what it holds; "restored": the old borders) and whether one side pays the other reparations, a share of its economy a year (at most ${Math.round(REPARATIONS_SHARE_CAP * 100)}%) for some years (at most ${REPARATIONS_YEARS_CAP}). The game carries out a peace on terms, but never decides one: whether a country wants peace, when, and on what terms is yours to judge, from its figures under [War Situation] and its own interests and character. A weary or losing country may still fight on, and a strong one may still want peace.`,
  "A country nobody plays that offers a player peace does it in a letter: an entry of diplomaticOutreach from that country to the player, its leader's own words in openingMessage, with peaceOffer holding the terms (territory; reparationsPayer empty when nobody pays, else the payer with reparationsPercent and reparationsYears). The player accepts or declines it in that chat. Write no event that the peace was made: it is made when the player accepts.",
  `Two countries nobody plays that make peace in this period: a line in ${PEACE_TREATIES_FIELD} for each, offering country | accepting country | terms, the terms as "as held; Borduria pays 2% for 5 years" or "restored; none", and an event that tells it. The game ends the war on those terms, so write no warUpdates end for it.`,
  "A war a player fights ends only by a peace that player makes or accepts: never end it yourself, nor write a ceasefire in it, nor take a player's country out of it, and tell no peace, armistice or surrender in it. To bring a player to peace, a country offers it in a letter. When an event of yours ends a war between countries nobody plays any other way, say its terms in the event.",
].join(" ");

// The block; "" when the world gives it nothing to say.
//   world     the world as the skip begins
//   game      the game (its round says which peaces are new)
//   players   the countries people play
export const buildPeaceBlock = ({ world = {}, game = {}, players = [], max = PEACE_BLOCK_MAX } = {}) => {
  const round = Math.max(0, Math.round(Number(game?.round) || 0));
  const wars = list(world?.wars).filter((war) => fold(war?.status || "active") === "active");
  const fighting = [...new Set(wars.flatMap((war) => [...list(war.sideA), ...list(war.sideB)]).map(clean).filter(Boolean))];
  const human = list(players).map(clean).filter(Boolean);
  const bonds = describeBonds(world, [...fighting, ...human], { most: 8 });
  // (A peace made since the last period was told: at the end of the last turn, or by a player's answer since.)
  const treaties = normalizePeaceTreaties(world?.peaceTreaties).filter((treaty) => treaty.round >= round);
  const offers = normalizePeaceOffers(world?.peaceOffers).filter((offer) => offer.status === "open");
  const calls = normalizeCallsToArms(world?.callsToArms).filter((call) => call.status === "open");
  // (Turned down lately: a country that offered may want to know before it offers again.)
  const declined = normalizePeaceOffers(world?.peaceOffers).filter((offer) => offer.status === "declined" && round - (offer.answeredRound ?? offer.round) <= DECLINED_TOLD_ROUNDS);
  const owed = normalizeReparations(world?.reparations);
  const weary = normalizeWarWeariness(world?.warWeariness).filter((entry) => entry.value >= WEARY_TOLD_FROM).sort((a, b) => b.value - a.value || a.country.localeCompare(b.country));
  if (wars.length === 0 && bonds.length === 0 && treaties.length === 0 && owed.length === 0 && weary.length === 0) return "";
  // Every country at war, the players' enemies and the players first: their
  // figures, for the skip to judge their diplomacy by.
  const enemiesOfPlayers = wars.flatMap((war) => {
    const sides = [list(war.sideA), list(war.sideB)].map((members) => members.map(clean).filter(Boolean));
    return sides.flatMap((members, index) => (members.some((member) => human.some((name) => fold(name) === fold(member))) ? sides[1 - index] : []));
  });
  const situation = buildWarStatsBlock({ world, countries: [...human, ...enemiesOfPlayers, ...fighting], max: WAR_STATS_MAX });

  const lines = [PEACE_BLOCK_HEADING];
  if (bonds.length > 0 || wars.length > 0) lines.push(ALLIANCE_RULE);
  if (wars.length > 0 || weary.length > 0) lines.push(WEARY_RULE);
  if (wars.length > 0 || treaties.length > 0) lines.push(PEACE_RULE);
  const room = () => max - lines.join("\n").length;
  const section = (title, rows) => {
    if (rows.length === 0 || room() < title.length + 40) return;
    lines.push(title);
    for (const row of rows) {
      const line = `- ${row}`;
      if (line.length + 1 > room()) break;
      lines.push(line);
    }
  };
  section("Peace made by the game or a player since the last period (the war is already ended in the ledger: tell each early in this answer as an event, write no warUpdates for it, and tell no fighting in that war after it):", treaties.map((treaty) => `${treaty.title || treaty.warId}: ${treaty.from} and ${treaty.to} made peace on ${treaty.date}; ${describeTerms(treaty.terms)}.`));
  section("Offers of peace that wait for an answer (the answer is theirs: write none, and the war goes on meanwhile):", offers.map((offer) => `${offer.from} has offered ${offer.to} peace: ${describeTerms(offer.terms)}.`));
  section("Offers of peace turned down lately:", declined.map((offer) => `${offer.to} turned down ${offer.from}'s offer of peace (${describeTerms(offer.terms)}).`));
  section("Calls to arms that wait for a player's answer (theirs to give):", calls.map((call) => `${call.ally} is called on to defend ${call.defender} against ${call.attackers.join(" and ") || "its attacker"}${call.via.title ? `, under ${call.via.title}` : ""}.`));
  section("Reparations being paid (the game moves the money; tell what paying them does to the country):", owed.map((entry) => `${describeReparation(entry)}.`));
  section("Bound to defend:", bonds.map((line) => `${line}.`));
  // (Countries at war have theirs in the situation below; the rest are told here.)
  const toldBelow = new Set(situation ? fighting.map(fold) : []);
  section("War weariness:", weary.filter((entry) => !toldBelow.has(fold(entry.country))).slice(0, 12).map((entry) => `${entry.country} ${Math.round(entry.value)}, ${wearinessWord(entry.value)}`));
  if (situation && situation.length + 1 <= room()) lines.push(situation);
  return lines.join("\n");
};
