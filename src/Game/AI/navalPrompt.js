/*! Open Historia — what a time skip is told of the war at sea © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war at sea is decided by an engine (runtime/naval/engine.js), as the war
// on land is, and the skip is told of it the same way: the rules (how fleets
// are ordered, and what the game does with them), the fleets of the countries
// at war, and the battles of the period, which is fought BEFORE the story is
// asked for (frontApply.js forecastTurnFronts) so that the story tells what
// happened and does not make up losses of its own.
//
// It stands after the [Fronts] block in the skip's live records, and is there
// only while there is a war with a fleet in it. Every name carries no id.
//
// Pure, and loads in plain Node.

import { BLOCKADE_BITES_DAYS, normalizeBlockades } from "../../runtime/naval/blockade.js";
import { NAVAL_REACH_KM } from "../../runtime/naval/engine.js";
import { eraOf } from "../../runtime/unitMotion.js";

export const SEAS_BLOCK_HEADING = "[Seas]";
export const SEAS_BLOCK_MAX = 3400;
export const SEA_FLEETS_TOLD_MOST = 14;
export const SEA_BATTLES_TOLD_MOST = 10;
export const BLOCKADES_TOLD_MOST = 8;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// A battle in a line: who had the better of whom, and what became of each fleet.
export const describeSeaBattle = (battle) => {
  const side = (index) => {
    const fleets = list(battle?.fleets?.[index]);
    const who = [...new Set(fleets.map((fleet) => clean(fleet.owner)))].join(" and ");
    const told = fleets.map((fleet) => `${clean(fleet.name)} ${fleet.before}% to ${fleet.after}%${fleet.sunk ? ", destroyed" : fleet.broke ? ", broke off" : ""}`).join("; ");
    return { who, told };
  };
  const one = side(0);
  const two = side(1);
  const verb = battle?.winner === 0 ? `${one.who} had the better of ${two.who}` : battle?.winner === 1 ? `${two.who} had the better of ${one.who}` : `${one.who} and ${two.who} fought with neither the better of it`;
  return `${clean(battle?.date)} ${clean(battle?.place) || "at sea"}: ${verb} (${one.told}; ${two.told}).`;
};

// A blockade in a line: who is blockaded by whom, how much of its trade by sea
// is cut, and how long it has stood.
//   days   how many days it has stood in all
export const describeBlockade = (blockade, days) => {
  const by = list(blockade?.by).map(clean).filter(Boolean).join(" and ");
  const cut = Math.round((Number(blockade?.pressure) || 0) * 100);
  const stood = Math.max(0, Math.round(Number(days) || 0));
  const biting = stood >= BLOCKADE_BITES_DAYS ? "its armies are short of everything that came by sea" : "its armies are beginning to go short";
  return `${clean(blockade?.country)} is blockaded${by ? ` by ${by}` : ""}: about ${cut}% of its trade is cut${stood > 0 ? `, day ${stood} of the blockade` : ""}; ${biting}.`;
};

// The fleets of the countries at war, from the world's formations: for a turn
// with no period fought beforehand.
const fleetsAtWar = (units, wars) => {
  const fighting = new Set();
  for (const war of list(wars)) {
    if (fold(war?.status || "active") !== "active") continue;
    for (const name of [...list(war.sideA), ...list(war.sideB)]) fighting.add(fold(name));
  }
  return list(units)
    .filter((unit) => unit && fold(unit.type) === "naval" && !clean(unit.committedTo) && Number(unit.strength) > 0 && fighting.has(fold(unit.ownerCode)))
    .map((unit) => ({ name: clean(unit.name), owner: clean(unit.ownerCode), strength: Math.round(Number(unit.strength)), posture: fold(unit.posture) || "patrol", place: "" }));
};

// The block; "" when there is no war with a fleet in it.
//   sea       what the period's run at sea came to ({ battles, fleets, commissioned }), or null
//   units     world.units
//   wars      world.wars
//   players   the countries people play
//   date      the game's date, for how far a fleet reaches
//   blockades world.blockades as the period begins: what stood before it
//   era         the era the scenario set (runtime/warSettings.js), or null to read it off the date
export const buildSeasBlock = ({ sea = null, units = [], wars = [], players = [], date = "", blockades = [], max = SEAS_BLOCK_MAX, era = null } = {}) => {
  const fought = Boolean(sea);
  const fleets = fought ? list(sea.fleets) : fleetsAtWar(units, wars);
  const battles = fought ? list(sea.battles) : [];
  // The blockades to tell of: the period's own where it was fought, each with
  // the days it stood before; else those standing as the turn begins.
  const standing = normalizeBlockades(blockades);
  const before = new Map(standing.map((record) => [fold(record.country), record.days]));
  const laid = fought
    ? list(sea.blockades).filter((entry) => clean(entry?.country)).map((entry) => ({ entry, days: (before.get(fold(entry.country)) ?? 0) + (Number(entry.days) || 0) }))
    : standing.map((entry) => ({ entry, days: entry.days }));
  if (fleets.length === 0 && battles.length === 0 && laid.length === 0) return "";
  const human = list(players).map(clean).filter(Boolean);
  const reach = NAVAL_REACH_KM[eraOf(date, era)];
  const rules = [
    SEAS_BLOCK_HEADING,
    "War at sea is decided by the game, as war on land is. A fleet is a formation of type naval: you move it with unitOps as before, and where it is and the posture it keeps are its orders. "
    + "assaulting: it seeks battle, and closes with the nearest hostile fleet it can reach. blockade: it closes an enemy's coast and fights whoever comes. patrol: it fights what it meets. holding: it keeps to its own waters, where it is seldom brought to battle. withdrawing: it avoids battle and makes for its own coast. "
    + `Fleets of countries at war that come within about ${reach} km of each other fight, and the game works out the battle: what each lost, which were destroyed, which broke off. A country at war that has a coast and no fleet is given one by the game; a navy that is destroyed is not replaced for years.`,
    `A fleet in the blockade posture within about ${reach} km of a coast of a country it is at war with blockades it. The game works out how much of that country's trade is cut (by how much of its coast is closed, how strong the fleets are, and how much it can still trade over land), takes the cost off its economy itself, and leaves its armies short: slower to recover, with fewer reserves, the more so the longer it stands. It is lifted by driving the blockading fleets off. Tell what a blockade does to the people who live under it (shortages, prices, unrest) and move that country's other figures as the story warrants; do not change that country's GDP for it yourself.`,
    fought
      ? "It has ALREADY fought this period's battles, below: tell each as it happened, on its date, and write no unitOps that change those fleets' strength, destroy them or bring them back. To have fleets fight next period, move them to where the enemy is, in the posture that fits."
      : "It fights them when this period has been written: say only that fleets were sent, and their battles are told to you next period.",
    human.length > 0 ? `${human.join(", ")} ${human.length === 1 ? "is" : "are each"} played by a person: move ${human.length === 1 ? "its" : "their"} fleets only as an action of this turn orders.` : "",
  ].filter(Boolean);
  const lines = [...rules];
  const room = () => max - lines.join("\n").length;
  if (battles.length > 0) {
    lines.push("Sea battles of this period:");
    let told = 0;
    for (const battle of battles.slice(0, SEA_BATTLES_TOLD_MOST)) {
      const line = `- ${describeSeaBattle(battle)}`;
      if (line.length + 1 > room()) break;
      lines.push(line);
      told += 1;
    }
    if (battles.length > told) lines.push(`(${battles.length - told} more were fought.)`);
  }
  if (laid.length > 0 && room() > 160) {
    lines.push(fought ? "Blockades of this period:" : "Blockades standing:");
    for (const { entry, days } of laid.slice(0, BLOCKADES_TOLD_MOST)) {
      const line = `- ${describeBlockade(entry, days)}`;
      if (line.length + 1 > room()) break;
      lines.push(line);
    }
  }
  for (const fleet of list(sea?.commissioned)) {
    const line = `- ${clean(fleet.ownerCode)} had no fleet and the game commissioned ${clean(fleet.name)} in its home waters.`;
    if (line.length + 1 <= room()) lines.push(line);
  }
  if (fleets.length > 0 && room() > 120) {
    lines.push(fought ? "The fleets of the countries at war, as the period leaves them:" : "The fleets of the countries at war:");
    for (const fleet of fleets.slice(0, SEA_FLEETS_TOLD_MOST)) {
      const line = `- ${clean(fleet.name)} (${clean(fleet.owner)}): ${Math.round(Number(fleet.strength) || 0)}% strength, ${clean(fleet.posture) || "patrol"}${clean(fleet.place) ? `, ${clean(fleet.place)}` : ""}`;
      if (line.length + 1 > room()) break;
      lines.push(line);
    }
  }
  return lines.join("\n");
};
