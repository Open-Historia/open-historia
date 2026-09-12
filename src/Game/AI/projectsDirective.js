/*! Open Historia — the jump's read-only view of the Projects & Operations board © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Import-free on purpose: runs under node --test without a build.
//
// The board is bookkeeping kept by its own pass after the jump
// (gameplay.js generateProjectOps), which is why projectOps left the jump's
// output contract. But that pass can only record what the events say, and the
// jump used to see nothing of the board at all: an order to "move forward
// with Project Westbird" reached it as a bare name, the model guessed what a
// Westbird might be (an aerospace test flight, for what the board describes as
// an agent-recruitment drive), and the pass then — rightly — refused to advance
// recruitment on the strength of a missile trial. This block hands the jump
// the board as CONTEXT, never as something it edits, so its events move the
// efforts the way the board describes them.
//
// Appended at call time rather than written into defaultPrompts.json because
// every game carries its own frozen copy of the task prompts; a directive
// added here is the only way it reaches campaigns that already exist.

export const JUMP_PROJECTS_DIRECTIVE_HEADER = "[Projects & Operations]";

// buildProjectsSummaryText's wording for an empty board; nothing to narrate.
const EMPTY_BOARD_PREFIX = "No projects";

// What HIGH PRIORITY asks for, in one place: the jump, the game master and the
// board pass all say it. It used to be "must not sit on that list two jumps
// running — it either moves or it stalls", and a rule that forbids an honest
// "nothing happened" is a rule that produces invented progress, which is the one
// thing the board exists to prevent. The player's dial buys attention, not motion.
// The phrase the rule and the updated board-pass template share, so the board
// pass's call-time copy is skipped for a campaign whose template already says it.
export const HIGH_PRIORITY_ASSESSMENT_MARKER = "HIGH PRIORITY gets an explicit assessment every jump";

export const HIGH_PRIORITY_ASSESSMENT_RULE =
  "An entry marked HIGH PRIORITY gets an explicit assessment every jump: say what happened to it - it advanced, "
  + "stalled for a named reason, reached or missed a checkpoint, or ended - or say \"no material change this period, "
  + "because...\" and name why. That last answer is honest and valid; inventing progress to satisfy the priority is not.";

// The line between the board and the world director's storylines. A Project or
// Operation is one polity's deliberate effort and lives on the board; a storyline
// is a situation nobody controls. One can cause the other, but a thing is never
// both: two records of one Project drift apart.
const BOARD_ENTRY_NOT_STORYLINE =
  "These entries are recorded on this board, never as a storyline: write no storylineUpdates record for one. "
  + "A situation one causes - a rival's reaction, a standoff - can be a storyline; the entry itself is not.";

export const buildJumpProjectsDirective = (projectsSummary) => {
  const board = String(projectsSummary ?? "").trim();
  if (!board || board.startsWith(EMPTY_BOARD_PREFIX)) return "";
  return [
    JUMP_PROJECTS_DIRECTIVE_HEADER,
    "The player keeps a board of long-running efforts - research and industrial programmes, construction projects, "
      + "military and covert operations, sustained political campaigns. The board as it stands:",
    board,
    "You do not return projectOps: a separate pass after this jump records the board from the events you write. "
      + "What you decide is what HAPPENS to these efforts. An effort the player's orders name, "
      + "or one on the \"Needs a decision this jump\" list advances, stalls for a named reason, reaches or misses its "
      + "next checkpoint, or ends - and an event says which, in terms of what the effort actually IS according to its "
      + "summary: a recruitment drive is not a missile test, and a shipyard is not a treaty. "
      + HIGH_PRIORITY_ASSESSMENT_RULE + " "
      + "Write what happens to an entry as an event however routine it is: the timeline decides what the player is "
      + "shown, and the board reads every event either way. Entries marked THEIRS "
      + "belong to another power: report what the player's services observed of them, never narrate them from "
      + "inside. Name each effort exactly as the board names it, so the pass can find it. "
      + BOARD_ENTRY_NOT_STORYLINE,
  ].join("\n");
};

// The board pass's own call-time directive. Its rules live in its template
// (defaultPrompts.json tasks.projects), but every campaign keeps a frozen copy of
// that template, so a rule that must reach existing games is appended here, and
// it has to say it supersedes the old wording the frozen copy still carries.
export const buildBoardPassDirective = () => [
  "[HIGH PRIORITY]",
  "This replaces any earlier instruction that a HIGH PRIORITY project must move or stall every jump. "
    + HIGH_PRIORITY_ASSESSMENT_RULE
    + " For an assessment with no material change, use op update with a lastUpdate saying so, and leave progress where it is.",
].join("\n");
