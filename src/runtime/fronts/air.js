/*! Open Historia — battlefields and fronts: air wings over the battlefield © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "air"). "Air units don't take part in
// front-line fighting currently: make them part of the actual battlefields."
//
// An AIR WING (world.units of type "air") of a country fighting on a
// battlefield takes part in it while its base lies within its era's reach of
// the battlefield (AIR_REACH_KM, from its middle): each wing over one
// battlefield a day, the nearest, and none of a country with no air arm
// (military.js: air 0). Its weight is its strength, and what its country's
// air arm is worth (airWorth).
//
// Each morning (dawn.js) the two sides' wings contest the sky. The side with
// the more holds it, by SUPERIORITY s = (A - B) / (A + B), and what it holds
// it with is the more for there being few troops below to cover (density d,
// to AIR_PER_TROOP of its weight a troop):
//
//   close support   the side that holds the sky attacks and defends harder: 1 + AIR_SUPPORT s d
//   interdiction    the other's columns are slowed: 1 - AIR_INTERDICT s d
//
// What a side's wings are SENT TO DO over a battlefield is its commander's
// (battle.airMission, AIR_MISSIONS: a staff of a run's own says so, engine.js;
// the engine's own staff never does): "make it also be able to control and
// understand ... plane attacks" (the owner, 2026-10-14).
//
//   support         as above (and what a side does that nobody has told)
//   strike          its wings go for the other side's troops themselves: the
//                   side that holds the sky so strikes each of them for
//                   AIR_STRIKE s d of its strength a day (dug in, the share of
//                   a day's losses its works let through), and gives up close
//                   support for it; striking wears its wings AIR_STRIKE_WEAR
//                   times as much
//   grounded        they stay on the ground: no wear, and the sky the other's
//
// AIR ARMS. A game's map seldom carries a country's aircraft as units ("where
// is the implementation of air units and stuff in war? im not getting any",
// the owner, 2026-10-15, of a war in which neither side had a wing on the
// map). So in a game's run (input.airArms) a country at war that has no wing
// of its own on the map flies its air arm over each battlefield it fights on:
// a wing for every AIR_ARM_TROOPS of its troops there (rounded up), at what
// its air arm is worth, as any wing. They wear as any wing over the run, and
// are whole again the next: they are no units of the world's.
//
// What the day's weather lets fly (weather.js "air": 0 in a storm, a
// blizzard or fog) is what flies. Every evening each wing that flew is worn:
// the side that lost the sky the more (AIR_LOSS), and a wing worn to nothing
// is gone. What became of the wings is handed back with the run, once a wing
// (engine.js snapshot: unitChanges).
//
// Only + - * / and comparisons (sqrt for a distance).

import { airWorth } from "./military.js";
import { isLive } from "./troops.js";
import { kmBetween, measureOptions } from "./worldGrid.js";

// How far a wing reaches from its base, by era (before 1500, 1500-1849, 1850-1944, from 1945): none before there were any.
export const AIR_REACH_KM = Object.freeze([0, 0, 500, 900]);
export const AIR_SUPPORT = 0.25;
export const AIR_INTERDICT = 0.2;
// The weight of air a troop takes to cover, and what a day of contesting the sky costs a wing at most.
export const AIR_PER_TROOP = 8;
export const AIR_LOSS = 2;
export const AIR_MISSIONS = Object.freeze(["support", "strike", "grounded"]);
export const AIR_STRIKE = 1.5;
export const AIR_STRIKE_WEAR = 1.5;
// A country's air arm, where it has no wings on the map: a wing for so many of its troops on a battlefield.
export const AIR_ARM_TROOPS = 6;
const AIR_ARM_MARK = "air arm|";

// What a side's wings are sent to do over a battle: "support" unless told otherwise.
export const airMissionOf = (battle, side) => {
  const mission = battle?.airMission?.[side];
  return AIR_MISSIONS.includes(mission) ? mission : "support";
};

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Which battle each wing is over today: once a day for the whole run, the nearest active battle within reach on which its country fights.
const assignWings = (run, day) => {
  if (run.airDay === day) return;
  run.airDay = day;
  run.airOver = new Map();
  const reach = AIR_REACH_KM[run.era] ?? 0;
  if (!(reach > 0)) return;
  run.wings = run.wings ?? new Map();
  const measure = measureOptions(run.input?.map);
  const units = (Array.isArray(run.input?.units) ? run.input.units : []).filter((unit) => fold(unit?.type) === "air" && Number(unit.strength) > 0 && Number.isFinite(Number(unit.lng)) && Number.isFinite(Number(unit.lat)));
  units.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  for (const unit of units) {
    const id = String(unit.id);
    if (!run.wings.has(id)) run.wings.set(id, { id, owner: String(unit.ownerCode ?? unit.owner ?? ""), strength: Math.min(100, Number(unit.strength)), began: Math.min(100, Number(unit.strength)), lng: Number(unit.lng), lat: Number(unit.lat) });
    const wing = run.wings.get(id);
    if (!(wing.strength > 0) || airWorth(run.militaryOf(wing.owner)) === 0) continue;
    let best = null;
    for (const battle of run.battles) {
      if (battle.status !== "active") continue;
      const side = [0, 1].find((index) => battle.sides[index].some((member, at) => !battle.gone[index].has(at) && fold(member) === fold(wing.owner)));
      if (side === undefined) continue;
      const [lng, lat] = battle.place.toLngLat(battle.field.cols / 2, battle.field.rows / 2);
      const km = kmBetween(wing.lng, wing.lat, lng, lat, measure);
      if (km <= reach && (!best || km < best.km)) best = { battle, side, km };
    }
    if (!best) continue;
    if (!run.airOver.has(best.battle)) run.airOver.set(best.battle, [[], []]);
    run.airOver.get(best.battle)[best.side].push(wing);
  }
  if (run.input?.airArms !== true) return;
  // The air arms of the countries with no wings of their own.
  const winged = new Set(units.map((unit) => fold(unit.ownerCode ?? unit.owner)));
  for (const battle of run.battles) {
    if (battle.status !== "active") continue;
    for (const side of [0, 1]) {
      battle.sides[side].forEach((member, at) => {
        if (battle.gone[side].has(at) || winged.has(fold(member)) || airWorth(run.militaryOf(member)) === 0) return;
        let troops = 0;
        for (const troop of battle.troops[side]) if (isLive(troop) && troop.owner === at) troops += 1;
        const count = Math.ceil(troops / AIR_ARM_TROOPS);
        for (let index = 0; index < count; index += 1) {
          const id = `${AIR_ARM_MARK}${battle.name}|${member}|${index}`;
          if (!run.wings.has(id)) run.wings.set(id, { id, owner: member, strength: 100, began: 100, arm: true });
          const wing = run.wings.get(id);
          if (!(wing.strength > 0)) continue;
          if (!run.airOver.has(battle)) run.airOver.set(battle, [[], []]);
          run.airOver.get(battle)[side].push(wing);
        }
      });
    }
  }
};

// The morning: what the sky over a battle does to each side today.
// { punch: [a, b], guard: [a, b], legs: [a, b], flying: [a, b] }, or null when nobody flies.
export const skyOfWings = (run, battle, day) => {
  assignWings(run, day);
  const wings = run.airOver?.get(battle);
  battle.wings = null;
  if (!wings) return null;
  const flies = battle.sky ? battle.sky.effects.air : 1;
  if (!(flies > 0)) return null;
  // (Wings kept grounded do not fly.)
  const weight = wings.map((list, side) => (airMissionOf(battle, side) === "grounded" ? 0
    : list.reduce((sum, wing) => sum + (wing.strength > 0 ? wing.strength * airWorth(run.militaryOf(wing.owner)) : 0), 0) * flies));
  const total = weight[0] + weight[1];
  if (!(total > 0)) return null;
  const holds = weight[0] >= weight[1] ? 0 : 1;
  const superiority = (weight[holds] - weight[1 - holds]) / total;
  let troops = 0;
  for (const troop of battle.troops[holds]) if (isLive(troop)) troops += 1;
  const density = troops > 0 ? Math.min(1, weight[holds] / (AIR_PER_TROOP * troops)) : 1;
  const edge = superiority * density;
  const punch = [1, 1];
  const guard = [1, 1];
  const legs = [1, 1];
  // Striking, the side that holds the sky goes for the other's troops (airStrikes at dusk) and gives up close support.
  const striking = airMissionOf(battle, holds) === "strike";
  if (!striking) {
    punch[holds] = 1 + AIR_SUPPORT * edge;
    guard[holds] = 1 + AIR_SUPPORT * edge;
  }
  legs[1 - holds] = 1 - AIR_INTERDICT * edge;
  battle.wings = { holds, weight, superiority, flying: wings.map((list, side) => (airMissionOf(battle, side) === "grounded" ? [] : list)), ...(striking ? { strike: edge } : {}) };
  return { punch, guard, legs };
};

// The evening: what a side's wings sent to strike did to the other's troops, as part of their day's losses (combat.js
// closeDay, where works take their share off).
export const airStrikes = (battle) => {
  const strike = battle.wings?.strike;
  if (!(strike > 0)) return;
  for (const troop of battle.troops[1 - battle.wings.holds]) {
    if (!isLive(troop)) continue;
    troop.loss += (troop.strength / 100) * AIR_STRIKE * strike;
  }
};

// The evening: every wing that flew over a battle is worn, the side that lost the sky the more.
export const wearWings = (run, battle) => {
  const sky = battle.wings;
  if (!sky) return;
  const total = sky.weight[0] + sky.weight[1];
  for (const side of [0, 1]) {
    const lost = total > 0 ? sky.weight[1 - side] / total : 0;
    const wear = sky.strike > 0 && sky.holds === side ? AIR_STRIKE_WEAR : 1;
    for (const wing of sky.flying[side]) {
      if (!(wing.strength > 0)) continue;
      wing.strength = Math.max(0, wing.strength - AIR_LOSS * (0.25 + lost) * wear);
      wing.changed = true;
    }
  }
};

// What became of the wings in the run, once a wing: their strength, or gone. (Not of an air arm's: no unit of the world's.)
export const wingChanges = (run) => (run.wings ? [...run.wings.values()].filter((wing) => wing.changed && !wing.arm).map((wing) => (wing.strength >= 1
  ? { unitId: wing.id, committedTo: "", strength: Math.round(wing.strength) }
  : { unitId: wing.id, committedTo: "", remove: true })) : []);

// For the story: who held the sky over a battle, and with how many wings a side.
// (With what each side's wings were sent to do, for the map that draws them: Game/Map/AirLayers.jsx.)
export const skyHeld = (battle) => (battle.wings ? { holds: battle.wings.holds, wings: battle.wings.flying.map((list) => list.length), superiority: Math.round(battle.wings.superiority * 100) / 100, missions: [airMissionOf(battle, 0), airMissionOf(battle, 1)], ...(battle.wings.strike > 0 ? { strike: true } : {}) } : null);
