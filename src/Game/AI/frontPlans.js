/*! Open Historia — plans on the battlefields: the Board's operations and what agents carry off © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Where three features meet on a battlefield (runtime/fronts/plans.js):
//
//   PROJECTS    an Operation on a player's Board that sends troops at a place
//               is a planned movement in the war room, and when it is under
//               way its troops are sent at the next turn (turnPlanned);
//   ESPIONAGE   an agent alive in a country of the other side sends that
//               side's planned movements; an agent that was turned sends the
//               diversions drawn for it. What a person's side knows is shown
//               in his war room (warRoomIntel); what a side nobody plays
//               knows, it prepares for (turnPlanned digs its troops in along
//               the way) and the simulator is told (stolenPlansBlock);
//   THE BOARD   its entries on other countries' operations are what the
//               player's services believe, and are drawn as that.
//
// Pure: the callers hand over the world, the game and the map's cities
// (frontApply.js reads them).

import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "../../runtime/fronts/constants.js";
import { describePlans, hasDoubleAgent, knownPlans, plansOf, withOperationOrders, withWatch } from "../../runtime/fronts/plans.js";
import { normalizeBattlefield } from "../../runtime/fronts/record.js";
import { humanCountriesOf } from "../../runtime/humanPolities.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Every Board of the game as one list, each entry with its owner written out:
// an entry with none is its Board's own country's (the host's, or a seat's).
export const boardsOf = (world, game) => {
  const entries = [];
  const host = clean(game?.country);
  for (const entry of asArray(world?.projects)) if (isRecord(entry)) entries.push(clean(entry.ownerCode) ? entry : { ...entry, ownerCode: host });
  const seats = isRecord(world?.seatBoards) ? world.seatBoards : {};
  for (const [country, board] of Object.entries(seats)) {
    if (fold(country) === fold(host)) continue;
    for (const entry of asArray(board)) {
      // A seat's Board holds its own entries and what it knows of others'; the
      // host's list already has the latter where they are the host's own.
      if (isRecord(entry) && !clean(entry.ownerCode)) entries.push({ ...entry, ownerCode: clean(country) });
    }
  }
  return entries;
};

const sidesOf = (record, people) => [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => asArray(record.sides?.[side]).some((member) => people.includes(fold(member))));

// The world as a turn's run of the front engine is to find it: on every open
// battlefield, the operations of the people playing sent or stood down, and
// every side nobody plays dug in against what its agents have shown it.
// Returns the same world when nothing is to be changed.
//   espionage   false when the feature is off: nobody has agents
export const turnPlanned = ({ world, game, cities = [], espionage = true } = {}) => {
  const rows = asArray(world?.battlefields);
  if (rows.length === 0) return world;
  const people = humanCountriesOf(game).map(fold);
  const projects = boardsOf(world, game);
  const spies = espionage ? asArray(world?.spies) : [];
  const since = clean(game?.gameDate || game?.startDate);
  let changed = false;
  const battlefields = rows.map((row) => {
    // Where a war is being fought: a front frozen by a ceasefire moves nobody.
    if (row?.status !== "active") return row;
    const record = normalizeBattlefield(row);
    if (!record || !record.frame) return row;
    const played = sidesOf(record, people);
    let next = withOperationOrders(record, {
      sides: [HOLDER_SIDE_A, HOLDER_SIDE_B].filter((side) => played[side]),
      projects,
      cities,
      people,
      since,
    });
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      if (played[side]) continue;
      const known = played[1 - side] ? knownPlans({ record: next, side, spies, projects, cities, people, played: people }).plans : [];
      next = withWatch(next, side, known, { since });
    }
    if (next === record) return row;
    changed = true;
    return next;
  });
  return changed ? { ...world, battlefields } : world;
};

// What the simulator is told of the plans agents have carried off, as a block
// of a time skip's live records; "" when no side nobody plays knows anything,
// so that a game without such agents has the prompt it had.
export const stolenPlansBlock = ({ world, game, cities = [], espionage = true } = {}) => {
  if (!espionage) return "";
  const people = humanCountriesOf(game).map(fold);
  const projects = boardsOf(world, game);
  const spies = asArray(world?.spies);
  if (spies.length === 0) return "";
  const lines = [];
  for (const row of asArray(world?.battlefields)) {
    if (row?.status !== "active") continue;
    const record = normalizeBattlefield(row);
    if (!record || !record.frame) continue;
    const played = sidesOf(record, people);
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      if (played[side] || !played[1 - side]) continue;
      const other = 1 - side;
      const lead = record.sides[side][0];
      const them = record.sides[other][0];
      const mine = record.sides[side].map(fold);
      const theirs = record.sides[other].map(fold);
      const agents = spies.filter((spy) => mine.includes(fold(spy?.owner)) && theirs.includes(fold(spy?.target)));
      const told = (status) => {
        const plans = knownPlans({ record, side, spies: agents.filter((spy) => spy.status === status), projects, cities, people, played: people }).plans;
        return describePlans(record, plans.filter((plan) => plan.ways.length > 0), { cities, most: 3 });
      };
      const truth = agents.some((spy) => spy.status === "active") ? told("active") : [];
      const planted = agents.some((spy) => spy.status === "turned") ? told("turned") : [];
      if (truth.length > 0) lines.push(`- ${record.name}: ${lead} knows from its agent that ${them} plans ${truth.join("; ")}. It prepares for that, and may strike first.`);
      if (planted.length > 0) lines.push(`- ${record.name}: ${lead} has been shown by its agent, which ${them} has turned, that ${them} plans ${planted.join("; ")}. This is FALSE and ${lead} believes it: it prepares for that and is caught out where the real blow falls.`);
    }
  }
  if (lines.length === 0) return "";
  return [
    "[What Agents Report of the Fronts]",
    "Known to you, not to the player. A side that has learnt of a movement against it has dug troops in on the way; let the story follow from that. An event tells what a side did, never that it had an agent's report: the player has not caught that agent. Where a line says the agent was turned, the player planted the report himself, and an event may tell that the side was misled.",
    ...lines.slice(0, 6),
  ].join("\n");
};

// What the player's war room is shown of the other side on one battlefield:
//   plans     its planned movements as the player's agents and Board have them,
//             with nothing to say which is true (plans.js knownPlans)
//   sources   whose agents, inside whom
//   lines     the same in words, for the generals (warRoomContext.js)
//   double    whether the player has turned an agent of the other side: only
//             then is there anybody to show a diversion to
export const warRoomIntel = ({ world, game, record, side, cities = [], espionage = true } = {}) => {
  if (!record || (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B)) return { plans: [], sources: [], lines: [], double: false };
  const people = humanCountriesOf(game).map(fold);
  const projects = boardsOf(world, game);
  const spies = espionage ? asArray(world?.spies) : [];
  const player = clean(game?.country);
  const known = knownPlans({ record, side, spies, projects, cities, player, people, played: people });
  const lead = record.sides[1 - side]?.[0] ?? "";
  const lines = describePlans(record, known.plans, { cities }).map((line) => `${lead}: ${line}`);
  return { ...known, lines, double: hasDoubleAgent({ record, side, spies }) };
};

// The player's own planned movements on a battlefield, for the war room's map.
export const warRoomPlans = ({ world, game, record, side, cities = [] } = {}) => plansOf(record, side, {
  projects: boardsOf(world, game),
  cities,
  player: clean(game?.country),
  people: humanCountriesOf(game).map(fold),
});
