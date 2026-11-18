/*! Open Historia — a country's military figures, as a turn's model is shown them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "i spent a decade as ukraine to prepare against russia AND SHIT DONT MOVE ...
// i trippled the size of the army, built new jets, spent 10% of gdp and i
// trained my units for 10 years AND IT DIDNT MOVE" (a player, 2026-10-17).
//
// A turn could move a country's military figures (polityChanges[].military,
// runtime/militaryStats.js), but the model was never shown them nor told when
// to: as with the intelligence rating before it, nothing ever moved. This is
// what it is shown, where the scenario weighs countries' figures at all
// (warSettings.js): the player's country's, and those of every country at war
// with it, each as the Stats panel's Military card counts it (militaryPower.js
// militaryProfile), with the rule for changing them.

import { militaryProfile } from "./militaryPower.js";
import { warSettingsOf } from "./warSettings.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// Every country at war with `name` in the world's ledger, by its exact name.
const enemiesOf = (world, name) => {
  const wanted = fold(name);
  const found = [];
  for (const war of list(world?.wars)) {
    if (fold(war?.status || "active") === "ended") continue;
    const sides = [list(war.sideA).map(clean), list(war.sideB).map(clean)];
    const at = sides.findIndex((members) => members.some((member) => fold(member) === wanted));
    if (at < 0) continue;
    for (const member of sides[1 - at]) if (member && !found.some((other) => fold(other) === fold(member))) found.push(member);
  }
  return found;
};

const line = (world, name, own) => {
  const { figures } = militaryProfile(world, name);
  return `- ${name}${own ? ` (${own})` : ""}: troop quality ${Math.round(figures.quality)}, technology ${Math.round(figures.technology)}, spending ${Math.round(figures.spending)}, manpower ${figures.manpowerShare}% of its people, land ${Math.round(figures.land)}, sea ${Math.round(figures.sea)}, air ${Math.round(figures.air)}`;
};

// The lines, or "" where the scenario does not weigh countries' figures or there is no player.
//   most    how many of the player's enemies are listed at most
//   people  a shared game's world task: every polity people play, `player`
//           among them. Each is listed as a player's, and then their enemies,
//           one of each player's in turn, `most` in all: only the host's and
//           the host's enemies were, so a guest who rearmed for years was
//           never shown a figure to move (the review of 2026-11-18). One
//           person is single player's, told exactly as before.
export const describeMilitaryStanding = (world, player, { most = 6, people = [] } = {}) => {
  const name = clean(player);
  if (!name || warSettingsOf(world).mechanics.military !== true) return "";
  const players = [name];
  for (const other of list(people).map(clean)) if (other && !players.some((known) => fold(known) === fold(other))) players.push(other);
  if (players.length === 1) return [line(world, name, "the player's"), ...enemiesOf(world, name).slice(0, most).map((enemy) => line(world, enemy, ""))].join("\n");
  const listed = [...players];
  const enemies = [];
  const each = players.map((polity) => enemiesOf(world, polity));
  for (let index = 0; enemies.length < most && each.some((rows) => index < rows.length); index += 1) {
    for (const rows of each) {
      const enemy = rows[index];
      if (!enemy || enemies.length >= most || listed.some((known) => fold(known) === fold(enemy))) continue;
      listed.push(enemy);
      enemies.push(enemy);
    }
  }
  return [...players.map((polity) => line(world, polity, "a player's")), ...enemies.map((enemy) => line(world, enemy, ""))].join("\n");
};

// What the model is told of them, under the lines.
export const MILITARY_CHANGE_RULE = "Each figure is 0-100 against the rest of the world (50 the middle), and manpower is the share of its people it could call up in a war (every man fit to serve, not the army it keeps). They move only through what happens: when this period's events change how a polity fights, write the CHANGE on its impacts.polityChanges entry as military: { quality, technology, spending, manpower, land, sea, air }, only the figures that moved, each -40 to 40 (manpower in points of that share). Training and exercises raise quality; modernising, research and new weapons raise technology; a bigger defence budget raises spending; conscription, mobilisation or a larger standing army raise manpower and land; new warships raise sea; new aircraft raise air. Heavy losses, purges, cuts, demobilisation, sanctions on parts and neglect lower them. Size each change to what the period actually delivered: a month moves a figure a point or two, a year of real effort several, a decade of determined rearmament twenty or more. An order only just given moves nothing yet.";
