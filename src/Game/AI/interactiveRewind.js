/*! Open Historia — taking back a beat of an interactive event © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/interactiveRewind.test.js
//
// An interactive event is played as a short run of beats: the player picks (or
// writes) a choice, the scene answers with what happened and the next choices,
// until it resolves into one event on the record. Until it resolves, nothing but the
// scene itself has changed — no border, no ledger — so any beat can be taken
// back and chosen differently at no cost beyond the beat itself (D6).
//
// What made that impossible was the record: each beat kept only the choice and
// its summary, and the scene's `opening` was overwritten by every summary, so
// what the player had been shown at a beat — the text above the choices, and the
// choices — was gone the moment they chose. Each beat now keeps both, and the
// scene keeps its first opening. A beat recorded before this has neither and
// cannot be returned to; every beat after it can.
//
// Import-free: gameplay.js records and rewinds, the save normalizer keeps the
// extra fields as it keeps any, and all of it is tested under bare node.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => (Array.isArray(value) ? value : []);

// Choices are stored as strings when new and as { id, text, result } objects
// once a save has been normalized; a beat keeps their words.
export const interactiveChoiceTexts = (choices) => array(choices)
  .map((entry) => (typeof entry === "string" ? clean(entry) : clean(entry?.text || entry?.title || entry?.label)))
  .filter(Boolean);

// The scene as it opens, with its first opening kept for a rewind to the start.
export const openInteractive = ({ title = "", premise = "", opening = "", choices = [] } = {}) => ({
  title: clean(title),
  premise: clean(premise),
  opening: clean(opening),
  firstOpening: clean(opening),
  choices: interactiveChoiceTexts(choices).slice(0, 5),
  history: [],
});

// The scene after one beat: the beat keeps what was on screen when it was
// chosen (`before`, `offered`), then the scene moves on.
export const recordInteractiveBeat = (interactive, { choice, summary, nextChoices = [] } = {}) => {
  const scene = interactive && typeof interactive === "object" ? interactive : {};
  const beat = {
    choice: clean(choice),
    summary: clean(summary),
    before: clean(scene.opening),
    offered: interactiveChoiceTexts(scene.choices),
  };
  return {
    ...scene,
    firstOpening: clean(scene.firstOpening) || (array(scene.history).length === 0 ? clean(scene.opening) : ""),
    choices: interactiveChoiceTexts(nextChoices).slice(0, 5),
    history: [...array(scene.history), beat],
    opening: beat.summary || clean(scene.opening),
  };
};

// Whether a scene is one the player is in the middle of: one they took up, or
// one they have played a beat of. A scene a time skip proposed before skips
// stopped proposing them is neither — the player never saw it — and the next
// skip clears it like any leftover.
export const isSceneInProgress = (interactive) => Boolean(interactive && typeof interactive === "object")
  && (interactive.origin === "player" || array(interactive.history).length > 0);

// Whether beat `index` can be taken back: it exists, and it was recorded with
// what the player was shown when they chose it.
export const canRewindInteractiveTo = (interactive, index) => {
  const beat = array(interactive?.history)[index];
  return Boolean(beat && typeof beat.before === "string" && Array.isArray(beat.offered) && beat.offered.length > 0);
};

// The scene exactly as it stood when beat `index` was about to be chosen: the
// beats before it, the text that was above the choices, and the choices. Null
// when that beat cannot be returned to.
export const rewindInteractive = (interactive, index) => {
  if (!Number.isInteger(index) || index < 0 || !canRewindInteractiveTo(interactive, index)) return null;
  const beat = interactive.history[index];
  return {
    ...interactive,
    choices: [...beat.offered],
    history: interactive.history.slice(0, index),
    opening: beat.before || clean(interactive.firstOpening) || clean(interactive.opening),
  };
};
