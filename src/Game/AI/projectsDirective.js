/*! Open Historia — what a time skip is told of the Projects & Operations board © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Light on purpose: runs under node --test without a build (its one import,
// runtime/statPaths.js, is pure).
//
// The engine runs every project (runtime/projectEngine.js): each day its
// owner's budget pays for it and the work moves at the pace its plan, its
// funding and its owner's economy allow. A time skip's period is run BEFORE its
// prompt is written, and what the engine decided (checkpoints, completions and
// what they do, stalls) is listed for the model to tell. So the model never
// moves a project's progress, and a project that simply goes on needs no op.
// What is left to it is what only a story can say: a country nobody plays
// starting a programme (with its plan), an event that sets one back or brings it
// on, an ending, and a line on what an event did to one.
//
// Appended at call time rather than written into defaultPrompts.json because
// every game carries its own frozen copy of the task prompts; a directive added
// here is the only way it reaches campaigns that already exist.

import { STAT_PATH_GRAMMAR } from "../../runtime/statPaths.js";

export const JUMP_PROJECTS_DIRECTIVE_HEADER = "[Projects & Operations]";

// buildProjectsSummaryText's wording for an empty board.
const EMPTY_BOARD_PREFIX = "No projects";

// The line between the board and the world director's storylines. A Project or
// Operation is one polity's deliberate effort and lives on the board; a storyline
// is a situation nobody controls. One can cause the other, but a thing is never
// both: two records of one Project drift apart.
const BOARD_ENTRY_NOT_STORYLINE =
  "These entries are recorded on this board, never as a storyline: write no storylineUpdates record for one. "
  + "A situation one causes - a rival's reaction, a standoff - can be a storyline; the entry itself is not.";

// What an effect may be: numbers on the game's own systems, each capped by the
// engine (projectEngine.js normalizeProjectEffect).
// Which figures is the model's to choose, all of them; the engine holds only
// each change's size, by the kind of figure (runtime/statPaths.js).
export const PROJECT_EFFECTS_RULE =
  "Effects are numbers on the game's own systems, and the engine caps the size of each: "
  + `stat (the owner's figure unless country names another; ANY figure of the sheet, by its path: ${STAT_PATH_GRAMMAR}, as its figures are listed; `
  + "change in points on a 0-100 scale, in per cent for economy.gdp and population.total, in percentage points for the economy's rates, a share of the value for a large custom figure); "
  + "relation (country, change in points); structure (name, kind, lng, lat); unitType (name, base, attack/toughness/speed against an ordinary unit's 1); "
  + "territory (region by its map name, country, claim). Give it every effect it would really have, on whichever figures those are, not only the most obvious one: "
  + "a sustainability programme may move energy autonomy, the economy, stability and reputation alike; a research programme technology and the economy; "
  + "a campaign of influence a relation and reputation; a naval base a structure and the sea arm. A programme that runs on (ongoing) "
  + "may have yields too: a small stat or relation change every month it is paid for.";

// How the board is kept, which no turn changes: a time skip states it once,
// among its standing rules in the cached opening (gameplay.js
// buildJumpStaticRules), under JUMP_PROJECTS_RULES_HEADING, and its live
// [Projects & Operations] block points at it (`rulesAbove`).
//   folded   the skip's events carry their own board ops (impacts.projectOps);
//            not folded, the skip returns none and the board only runs.
export const JUMP_PROJECTS_RULES_HEADING = "[How the Board Is Kept]";
export const buildJumpProjectsRules = ({ folded = false } = {}) => (folded
  ? [
    "The engine runs every project on the board by itself: each day its owner's budget pays its monthly cost, and the work moves at the pace "
      + "its plan, its funding and its owner's economy and stability allow. Its checkpoints, its completion and what it then does to the world "
      + "are the engine's, decided before this period was written and listed under \"Decided this period\" in [Projects & Operations]. "
      + "You never move a project's progress, and a project that simply goes on needs no op and no event.",
    "What you do with the board, in an event's impacts.projectOps:",
    "• Tell what was decided. Every line under \"Decided this period\" happens on its date, as written: tell it in an event dated that day "
      + "that names the project exactly (a checkpoint may share an event with other news; a completion is news of its own), and give that event "
      + "{\"op\":\"update\",\"name\":\"<the name exactly>\",\"lastUpdate\":\"<one sentence>\"}. Never tell it otherwise, earlier, or as failing.",
    "• Open a project for a country nobody plays when an event shows its government starting a sustained effort that takes months or years: "
      + "{\"op\":\"create\",\"name\":\"<a new name>\",\"kind\":\"project | operation\",\"ownerCode\":\"<its full name>\",\"summary\":\"<what it is for>\","
      + "\"secrecy\":\"public | restricted | covert\",\"plan\":{\"durationDays\":<days of work>,\"monthlyCost\":<in its GDP's currency, well within its project budget>,"
      + "\"milestones\":[{\"title\":\"\",\"atProgress\":<1-99>}],\"effects\":[<what it does when done>]}}. A country runs three at most; open one only "
      + "when it is news, never as a matter of routine. The countries people play open their own projects themselves: never open one for them.",
    "• Set one back or bring it on when an event causes it, never as routine: {\"op\":\"setback\",\"name\":\"\",\"days\":<1-180>,\"overrun\":<0-50, per cent>,"
      + "\"lastUpdate\":\"\"} or {\"op\":\"boost\",\"name\":\"\",\"days\":<1-90>,\"lastUpdate\":\"\"}; the event says why (a strike, a fire, sabotage, "
      + "a breakthrough, a windfall). It takes hold from the next period.",
    "• End one only when an event ends it: {\"op\":\"cancel | fail\",\"name\":\"\",\"lastUpdate\":\"<how it ended>\"}. Never a project decided as "
      + "completing this period, and never another government's project because a player wished it.",
    "• A programme that exists only in material PLANTED on a service through its turned agent is no country's work, only what that service "
      + "believes: open it, if at all, as a create with \"believedBy\":\"<that service's country>\" and the plan it is led to believe. "
      + "Nothing runs it, and an entry the board marks as such is told as nothing happening. A doubted entry is the game's to settle.",
    PROJECT_EFFECTS_RULE,
    "A project whose owner is another country moves because its owner moves it. Tell it from outside, and of a covert one only what "
      + "the player's services could learn. Name each project exactly as the board names it: an op naming nothing on the board is dropped. "
      + BOARD_ENTRY_NOT_STORYLINE,
  ].join("\n")
  // Not folded: a skip asked the old way, after a provider refused the folded
  // one, or one whose function had no room for the board's ops
  // (gameplay.js fitSkipRiders). The engine still runs the board.
  : [
    "The engine runs every project on the board by itself, and what it decided for this period is listed under \"Decided this period\" in "
      + "[Projects & Operations]: every line happens on its date, as written. Tell each in an event dated that day that names the project exactly, "
      + "and never tell it otherwise. You return no projectOps this time: nothing you write opens, sets back or ends a project. "
      + "A project whose owner is another country is told from outside. "
      + BOARD_ENTRY_NOT_STORYLINE,
  ].join("\n"));

// The skip's live block: the board as it stands, and what the engine decided for
// the period (`forecast`, projectEngine.js describeOutcomes). Shown on every
// folded skip, an empty board included: that is where the countries nobody
// plays open their first projects. `players`: the countries people play, never
// to be opened for. (The doubted entries a fresh agent could settle were listed
// for the model to settle; the engine settles them now, for every service:
// runtime/agentBoards.js.)
export const buildJumpProjectsDirective = (projectsSummary, { folded = false, rulesAbove = false, forecast = "", players = [] } = {}) => {
  const board = String(projectsSummary ?? "").trim();
  const empty = !board || board.startsWith(EMPTY_BOARD_PREFIX);
  const decided = String(forecast ?? "").trim();
  if (empty && !folded && !decided) return "";
  const played = (Array.isArray(players) ? players : []).map((name) => String(name ?? "").trim()).filter(Boolean);
  return [
    JUMP_PROJECTS_DIRECTIVE_HEADER,
    rulesAbove ? `Kept as ${JUMP_PROJECTS_RULES_HEADING} above says.` : buildJumpProjectsRules({ folded }),
    empty
      ? "The board is empty."
      : `The board (name · owner · progress · expected finish · cost a month · funding · status):\n${board}`,
    `Decided this period (the engine's; tell each on its date):\n${decided || "Nothing: no checkpoint, completion or stall falls in this period."}`,
    ...(folded && played.length ? [`Played by people, so never opened by you: ${played.join(", ")}.`] : []),
  ].join("\n");
};
