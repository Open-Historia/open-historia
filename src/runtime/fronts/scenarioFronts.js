/*! Open Historia — fronts a scenario begins with © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario can begin with its fronts in place: the Western Front in a game
// that opens in 1916, a fortified border in a cold war. Its author lists them
// (the Workshop's Fronts tab, GameUI/ScenarioFrontsPanel.jsx) and they are kept
// with the scenario's world as `scenarioFronts`:
//
//   { name, sides: [[names], [names]], war, troops: [n, n], stance: [word, word],
//     generals: [[names], [names]], forms?: [form, form] }
//
//   war       true: the two sides are at war there from the first day (a war
//             between them is written into the ledger if there is none);
//             false: a border the two have fortified, at peace
//   troops    how many formations each side begins with; 0 leaves it to the
//             game, which counts them by the sides' size and the line's length
//   stance    what each side's troops are told from the first day
//   generals  what each side's generals are called, in the order of their
//             commands (the northernmost or westernmost body first)
//   forms     how each side's troops stand there (swarms.js): "front" along
//             the line, "swarm" in swarms behind it, each under a general of its
//             own; "" (or none at all) as the scenario's wars are fought
//             (runtime/warSettings.js warfare)
//
// The line itself is not drawn by the author: it runs where the two sides'
// ground meets on the scenario's map, which is where the engine opens a
// battlefield anyway. When a game made from the scenario is first opened the
// engine builds the battlefields (AI/frontScenario.js), with no request to any
// model, and the list is then cleared from the game's world: it has been used.
//
// Pure, and runs in bare node.

import { nameGenerals } from "./command.js";
import { DEPLOY_FORMS } from "./swarms.js";
import {
  BATTLEFIELD_NAME_MAX,
  GENERAL_NAME_MAX,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  MAX_COMMANDS,
  MAX_SIDE_MEMBERS,
  MAX_TROOPS_PER_SIDE,
  SCENARIO_MARK,
} from "./constants.js";

export const MAX_SCENARIO_FRONTS = 8;
// What a side may be told from the first day. An attack is for a front where
// there is a war; a border at peace is held or dug in on.
export const SCENARIO_STANCES = Object.freeze(["hold", "dig in", "advance"]);
export const SCENARIO_FRONTS_EVENT = "scenario-fronts";

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const SIDES = [HOLDER_SIDE_A, HOLDER_SIDE_B];

const members = (value, taken) => {
  const names = [];
  for (const raw of list(value)) {
    const name = clean(raw, 120);
    if (!name || taken.has(fold(name)) || names.some((other) => fold(other) === fold(name))) continue;
    names.push(name);
    if (names.length >= MAX_SIDE_MEMBERS) break;
  }
  return names;
};

// One front, checked; null for one that names nobody on a side.
//   draft   true while it is being written: a front with a side still empty is
//           kept, so the author does not lose the row he is filling in
const normalizeFront = (raw, { draft = false } = {}) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const war = raw.war !== false;
  const sideA = members(raw.sides?.[0], new Set());
  const sideB = members(raw.sides?.[1], new Set(sideA.map(fold)));
  // A border at peace is between two countries, one a side.
  const sides = war ? [sideA, sideB] : [sideA.slice(0, 1), sideB.slice(0, 1)];
  if (!draft && (sides[0].length === 0 || sides[1].length === 0)) return null;
  const stance = SIDES.map((side) => {
    const word = fold(raw.stance?.[side]);
    if (!SCENARIO_STANCES.includes(word)) return "hold";
    return !war && word === "advance" ? "hold" : word;
  });
  const forms = SIDES.map((side) => (DEPLOY_FORMS.includes(fold(raw.forms?.[side])) ? fold(raw.forms[side]) : ""));
  return {
    name: clean(raw.name, BATTLEFIELD_NAME_MAX),
    sides,
    war,
    troops: SIDES.map((side) => Math.max(0, Math.min(MAX_TROOPS_PER_SIDE, Math.round(Number(raw.troops?.[side]) || 0)))),
    stance,
    generals: SIDES.map((side) => list(raw.generals?.[side]).slice(0, MAX_COMMANDS).map((name) => clean(name, GENERAL_NAME_MAX))),
    // (Kept only where a side is laid out otherwise than the scenario's wars are fought.)
    ...(forms.some(Boolean) ? { forms } : {}),
  };
};

export const normalizeScenarioFronts = (value, options) => {
  const fronts = [];
  for (const raw of list(value)) {
    const front = normalizeFront(raw, options);
    if (front) fronts.push(front);
    if (fronts.length >= MAX_SCENARIO_FRONTS) break;
  }
  return fronts;
};

// An empty front, as the Workshop adds one.
export const blankScenarioFront = () => ({ name: "", sides: [[], []], war: true, troops: [0, 0], stance: ["hold", "hold"], generals: [[], []] });

// ---- at the first opening of a game ---------------------------------------------------

const opposed = (war, front) => {
  const a = list(war?.sideA).map(fold);
  const b = list(war?.sideB).map(fold);
  const left = front.sides[0].map(fold);
  const right = front.sides[1].map(fold);
  const across = (one, two) => left.some((name) => one.includes(name)) && right.some((name) => two.includes(name));
  return across(a, b) || across(b, a);
};

// The wars a scenario's fronts are fought in that the ledger does not hold
// yet, as ledger entries: one a front that is at war with no war under way
// between its sides. `wars` is the ledger as it stands, `date` the game's.
export const scenarioFrontWars = (fronts, wars, date) => {
  const added = [];
  const ledger = list(wars).filter((war) => clean(war?.status).toLowerCase() !== "ended");
  fronts.forEach((front, index) => {
    if (!front.war || [...ledger, ...added].some((war) => opposed(war, front))) return;
    added.push({
      id: `war-scenario-front-${index + 1}`,
      title: front.name,
      status: "active",
      sideA: front.sides[0].slice(),
      sideB: front.sides[1].slice(),
      startedDate: clean(date, 40),
      endedDate: "",
      lastUpdatedDate: clean(date, 40),
      cause: "",
      note: "",
      sourceEventIds: [],
      storylineIds: [],
      createdRound: 1,
      updatedRound: 1,
    });
  });
  return added;
};

// What each side of each front is told on the first day, as front orders
// resting on one event of that day (frontTurn.js planFrontMoments). An order
// names its border: between two at war that is every battlefield they share,
// and between two at peace it opens the fortified border.
export const scenarioFrontOrders = (fronts) => {
  const orders = [];
  fronts.forEach((front, index) => {
    const border = `border: ${front.sides[0][0]} / ${front.sides[1][0]}`;
    for (const side of SIDES) {
      // Every side is told, one that holds as much as one that digs in or
      // attacks: what it is told is what its author made the front, and it
      // stands as that (SCENARIO_MARK) until an event changes it. A side left
      // with no order at all was the story's, and its own staff's, to send
      // forward the first day.
      orders.push({
        mark: SCENARIO_MARK,
        id: `scenario-front-${index}-${side}`,
        battlefield: border,
        side: front.sides[side][0],
        order: front.stance[side],
        sector: "all",
        objective: "",
        result: "",
        effort: "",
        eventIds: [SCENARIO_FRONTS_EVENT],
        eventIndexes: [],
      });
    }
  });
  return orders;
};

// How many troops each side of a battle begins with where a scenario says, as
// the engine asks while it raises them (battle.js raiseTroops): [a, b] in the
// battle's own order of sides, 0 for a side the scenario leaves to the game;
// null for a battle no front speaks of.
export const authoredTroops = (fronts, sides) => {
  const left = list(sides?.[0]).map(fold);
  const right = list(sides?.[1]).map(fold);
  for (const front of list(fronts)) {
    const a = front.sides[0].map(fold);
    const b = front.sides[1].map(fold);
    const same = (one, two) => one.some((name) => two.includes(name));
    if (same(a, left) && same(b, right)) return front.troops.slice();
    if (same(a, right) && same(b, left)) return [front.troops[1], front.troops[0]];
  }
  return null;
};

// How each side of a battle stands where a scenario says (swarms.js), as the
// engine asks while it raises its troops (battle.js raiseTroops): [a, b] in the
// battle's own order of sides, each "front", "swarm" or "" for a side the
// scenario leaves to how its wars are fought; null for a battle no front speaks of.
export const authoredForms = (fronts, sides) => {
  const left = list(sides?.[0]).map(fold);
  const right = list(sides?.[1]).map(fold);
  const formsOf = (front) => (Array.isArray(front.forms) ? front.forms : ["", ""]);
  for (const front of list(fronts)) {
    const a = front.sides[0].map(fold);
    const b = front.sides[1].map(fold);
    const same = (one, two) => one.some((name) => two.includes(name));
    if (same(a, left) && same(b, right)) return formsOf(front).slice();
    if (same(a, right) && same(b, left)) return [formsOf(front)[1], formsOf(front)[0]];
  }
  return null;
};

// What a battle between two sides is to be called where a scenario says: the
// name its author gave the front, as the engine asks when it opens one for a
// war (engine.js nameFor). "" for a battle no front speaks of, and for a
// border at peace, which keeps the name the engine knows it by.
export const authoredName = (fronts, sides) => {
  const left = list(sides?.[0]).map(fold);
  const right = list(sides?.[1]).map(fold);
  const same = (one, two) => one.some((name) => two.includes(name));
  for (const front of list(fronts)) {
    if (!front.war || !front.name) continue;
    const a = front.sides[0].map(fold);
    const b = front.sides[1].map(fold);
    if ((same(a, left) && same(b, right)) || (same(a, right) && same(b, left))) return front.name;
  }
  return "";
};

// The battlefields the engine opened with their generals named as their
// fronts' author named them.
export const withScenarioGenerals = (battlefields, fronts) => list(battlefields).map((record) => {
  if (!record || !Array.isArray(record.sides) || record.status === "closed") return record;
  const left = record.sides[0].map(fold);
  const right = record.sides[1].map(fold);
  const same = (one, two) => one.some((name) => two.includes(name));
  let next = record;
  for (const front of fronts) {
    const a = front.sides[0].map(fold);
    const b = front.sides[1].map(fold);
    const straight = same(a, left) && same(b, right);
    const turned = same(a, right) && same(b, left);
    if (!straight && !turned) continue;
    for (const side of SIDES) {
      const names = front.generals[straight ? side : 1 - side];
      if (names.some(Boolean)) next = nameGenerals(next, side, names);
    }
  }
  return next;
});
