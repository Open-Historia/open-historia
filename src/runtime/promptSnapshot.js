/*! Open Historia — what the last time skip's prompt read, kept in the save © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// world.promptSnapshot and world.promptReference, as the save keeps them. A time
// skip stores both when it is written (Game/AI/gameplay.js applySimulationResult)
// and the next one reads them (Game/AI/promptFocus.js, promptContext.js):
//   promptSnapshot   { v, round, date, powers: { <lower-case name>: [regions,
//                    lineHash, tagsHash, loreHash] } }: what changed since.
//   promptReference  { round, notes: { <lower-case name>: { name, note } } }:
//                    the polity lore the skip's cached opening carries.
// Neither is ever shown to the player, and neither is needed: a save without
// them reads nothing as unchanged and carries the lore as it stands.
// Import-free: the world normaliser and the prompt builders both read it.

const norm = (value) => String(value ?? "").trim();
const count = (value) => Math.max(0, Math.trunc(Number(value) || 0));

export const PROMPT_SNAPSHOT_VERSION = 1;

export const normalizePromptSnapshot = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Number(value.v) !== PROMPT_SNAPSHOT_VERSION) return null;
  const powers = {};
  for (const [key, entry] of Object.entries(value.powers && typeof value.powers === "object" ? value.powers : {})) {
    const name = norm(key).toLowerCase();
    if (!name || !Array.isArray(entry) || entry.length < 4) continue;
    powers[name] = [count(entry[0]), norm(entry[1]), norm(entry[2]), norm(entry[3])];
  }
  return { v: PROMPT_SNAPSHOT_VERSION, round: count(value.round), date: norm(value.date), powers };
};

export const normalizePromptReference = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const notes = {};
  for (const [key, entry] of Object.entries(value.notes && typeof value.notes === "object" ? value.notes : {})) {
    const name = norm(entry?.name);
    const note = norm(entry?.note);
    if (!norm(key) || !name || !note) continue;
    notes[norm(key).toLowerCase()] = { name, note };
  }
  return { round: count(value.round), notes };
};
