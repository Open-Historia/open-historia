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

// ---- The folded skip: the jump keeps the board itself ---------------------------
// While requests are being saved a skip is one request (requestBudget.js), so no
// pass reads its events afterwards: each event carries the board ops it caused
// in its own impacts.projectOps (gameplaySchemas.js foldJumpTool), and the
// engine applies them through the board's own machinery (gameplay.js
// foldedTurnReview). The rules are the board pass's (defaultPrompts.json
// tasks.projects), said here because this is the only prompt such a skip has.
//
// The split this reverses was made because the board crowded the events out: a
// run narrated stalled programmes for minutes and never reached the period. So
// the board stays bookkeeping here too. An op rides on an event that happened
// anyway, routine progress needs no event of its own, and the proportion rule
// is the one the board pass always had.
const FOLDED_BOARD_OPS = [
  "YOU keep this board in step, in the same events: nothing reads them afterwards to do it for you. An event that starts, "
    + "advances, sets back, completes or ends one of these efforts carries the op that records it in its own impacts.projectOps:",
  "• {\"op\":\"update\",\"projectId\":\"<exact id>\",\"name\":\"<exact name>\",\"progress\":58,\"status\":\"active | stalled | paused\","
    + "\"lastUpdate\":\"<one present-tense sentence on what just changed>\"} when progress moved or the status changed;",
  "• {\"op\":\"milestone\",\"projectId\":\"\",\"name\":\"\",\"milestone\":{\"title\":\"<the checkpoint>\",\"date\":\"YYYY-MM-DD\","
    + "\"status\":\"done | missed | slipped\"}} when a checkpoint was reached, missed or pushed back;",
  "• {\"op\":\"complete | cancel | fail\",\"projectId\":\"\",\"name\":\"\",\"note\":\"<how it ended>\"} when it is over: it stays on the board, under Closed;",
  "• {\"op\":\"create\",\"name\":\"<a new name>\",\"kind\":\"project | operation\",\"summary\":\"<what it is and what it is for>\","
    + "\"status\":\"active\",\"targetDate\":\"YYYY-MM-DD\",\"milestones\":[{\"title\":\"\",\"date\":\"YYYY-MM-DD\"}],\"tags\":[\"\"]} "
    + "when an event starts a new multi-round effort, with ownerCode (a country's full name) only for a foreign power's programme the player's services have learned of.",
  "Copy ids and names exactly as the board writes them: an op naming something that is not there is dropped. A date you set is never earlier than this period's own dates, "
    + "and a running entry with no checkpoints gets two or three dated milestones on its way to its target date; a standing effort with no end gets none.",
].join("\n");

const FOLDED_BOARD_PROPORTION =
  "Be proportionate, which is the rule that matters most here. The period comes first: write its events as you would with no board at all, "
  + "and put an op only on an event that really moved an effort. Most events carry none, and no ops at all is a correct answer for a quiet period. "
  + "Routine progress needs no event of its own: its op rides on the event closest to it in subject, and an effort gets an event to itself only when "
  + "what happened to it is news. A progress figure rises only by what the event itself justifies; inventing progress is worse than reporting none. "
  + "Never open an entry for something a government simply decides and does (a rename, a proclamation, a reshuffle) or for a transfer the other side "
  + "has already agreed to: the event enacts those outright.";

// `folded`: the skip keeps the board itself (above). `doubted`: the entries a
// fresh agent can now settle, as describeDoubtedForPrompt writes them.
export const buildJumpProjectsDirective = (projectsSummary, { folded = false, doubted = "" } = {}) => {
  const board = String(projectsSummary ?? "").trim();
  if (!board || board.startsWith(EMPTY_BOARD_PREFIX)) return "";
  if (folded) {
    const settle = String(doubted ?? "").trim();
    return [
      JUMP_PROJECTS_DIRECTIVE_HEADER,
      "The player keeps a board of long-running efforts - research and industrial programmes, construction projects, "
        + "military and covert operations, sustained political campaigns. The board as it stands:",
      board,
      FOLDED_BOARD_OPS,
      "What you decide is what HAPPENS to these efforts, in terms of what each one actually IS according to its summary: "
        + "a recruitment drive is not a missile test, and a shipyard is not a treaty. An effort the player's orders name, "
        + "and every entry on the \"Needs a decision this jump\" list, gets an op this jump saying which of four things happened: "
        + "it advanced (update, with a real progress figure), it is stuck (update with status stalled and a lastUpdate NAMING the blocker), "
        + "it reached or missed a checkpoint (milestone), or it is over (complete, cancel or fail). "
        + HIGH_PRIORITY_ASSESSMENT_RULE + " For an assessment with no material change, use op update with a lastUpdate saying so, and leave progress where it is. "
        + "Entries marked THEIRS belong to another power: they move because their owner moved them and the player's services observed as much, "
        + "never because the player wished them stopped, and are reported from outside, never narrated from inside.",
      FOLDED_BOARD_PROPORTION,
      BOARD_ENTRY_NOT_STORYLINE,
      ...(settle ? [`These doubted entries can now be settled, because a fresh agent is in place:\n${settle}`] : []),
    ].join("\n");
  }
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
