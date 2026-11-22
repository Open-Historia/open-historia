/*! Open Historia — what kind of process a storyline is © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A storyline's kind (Game/AI/nativeWorldDirector.js) is one word of this
// list, chosen by the model from it in the skip's storyline records, the motion
// repair, the Game Master and Round Zero alike. It used to be free text, read
// by English word lists ("crisis", "uprising", "banking") to tell a crisis
// from anything else, so a kind written in another language was never a
// crisis. "dont do keywording its super unreliable" (the owner, 2026-11-06).
//
// A kind outside the list, a save's free text among them, is the neutral kind:
// matched by its exact value only (case aside), never by the words in it.
//
// Import-free, like runtime/eventTags.js: the save normalizer, the AI schemas
// and the director read the vocabulary from here.

export const STORYLINE_KINDS = Object.freeze([
  "war",
  "crisis",
  "unrest",
  "diplomacy",
  "politics",
  "economy",
  "world",
]);

// What a kind that names none of the others is, and what a storyline is when
// nobody said.
export const NEUTRAL_STORYLINE_KIND = "world";

// The kinds Round Zero may give a process: every kind but war, which is the
// war ledger's own record.
export const PROCESS_STORYLINE_KINDS = Object.freeze(STORYLINE_KINDS.filter((kind) => kind !== "war"));

// Processes that can turn into war: the conflict risk counts their pressure.
export const CONFLICT_STORYLINE_KINDS = Object.freeze(["war", "crisis", "unrest"]);

// A new process the crisis lane looks for (Game/AI/nativeWorldIntegrity.js):
// a crisis or unrest, not a war (the war ledger opens those).
export const CRISIS_STORYLINE_KINDS = Object.freeze(["crisis", "unrest"]);

// The kinds as the skip's storyline records are told them, one line.
export const STORYLINE_KIND_LIST_TEXT = STORYLINE_KINDS.join(", ");

// The kind a value names, or `fallback` when it names none of them.
export const storylineKindOf = (value, fallback = NEUTRAL_STORYLINE_KIND) => {
  const kind = String(value ?? "").trim().toLowerCase();
  return STORYLINE_KINDS.includes(kind) ? kind : fallback;
};
