/*! Open Historia — the keys renamed tasks had before © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A task's key is stored beside the player's settings (a task's own pick of
// model, providerConfig.js) and in a scenario's or a game's prompt edits
// (promptGuidance.js), so renaming a task leaves its old key in both. Each
// reader looks the new key up first and the old one after it; a write goes to
// the new key only.
//
// The interactive-event tasks were the catalyst tasks until 18 September 2026.
export const FORMER_TASK_KEYS = Object.freeze({
  interactiveCreation: "catalystCreation",
  interactiveExecutor: "catalystExecutor",
  interactiveSummary: "catalystSummary",
});

// The value stored under a task's key, or under the key it had before.
export const readUnderTaskKey = (record, taskKey) => {
  if (!record || typeof record !== "object") return undefined;
  if (record[taskKey] !== undefined) return record[taskKey];
  const former = FORMER_TASK_KEYS[taskKey];
  return former ? record[former] : undefined;
};
