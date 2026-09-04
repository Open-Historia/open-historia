/*! Open Historia — the jump's read-only view of the Projects & Operations board © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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

export const buildJumpProjectsDirective = (projectsSummary) => {
  const board = String(projectsSummary ?? "").trim();
  if (!board || board.startsWith(EMPTY_BOARD_PREFIX)) return "";
  return [
    JUMP_PROJECTS_DIRECTIVE_HEADER,
    "The player keeps a board of long-running efforts - research and industrial programmes, construction projects, "
      + "military and covert operations, sustained political campaigns. The board as it stands:",
    board,
    "You do not return projectOps: a separate pass after this jump records the board from the events you write. "
      + "What you decide is what HAPPENS to these efforts. An effort the player's orders name, one marked HIGH PRIORITY, "
      + "or one on the \"Needs a decision this jump\" list advances, stalls for a named reason, reaches or misses its "
      + "next checkpoint, or ends - and an event says which, in terms of what the effort actually IS according to its "
      + "summary: a recruitment drive is not a missile test, and a shipyard is not a treaty. Entries marked THEIRS "
      + "belong to another power: report what the player's services observed of them, never narrate them from "
      + "inside. Name each effort exactly as the board names it, so the pass can find it.",
  ].join("\n");
};
