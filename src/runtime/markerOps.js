/*! Open Historia — what an event may do to a structure © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The five operations on a structure on the map, one closed set for the three
// places that read one: the answer's shape before validation (gameplay.js
// runJsonTask, gameplaySchemas.js normalizeMarkerOperationShape), the schema
// itself (gameplaySchemas.js markerOpSchema, one branch per op) and the engine
// that applies them (gameState.js normalizeMarkerOp).
//
//   build       a structure that did not exist before
//   update      a change to one: its owner, its note, its lifecycle status
//               (a ruin is an update to status "destroyed", never a removal)
//   remove      one that should never have been on the map
//   rename      a new name, the old kept as an alias
//   population  a city's new population
//
// An op is one of these words as the schema writes them, case and spaces aside.
// Any other word is no op, in English or in any other language: "found",
// "destroy", "modify", "create", "delete" were once read as the op they seemed
// to mean, and the same verbs in every other language never were (the owner,
// 2026-11-13: no keywording anywhere).
//
// DELIBERATELY IMPORT-FREE: the engine, the schema and the task runner all read it.

export const MARKER_OPS = Object.freeze(["build", "update", "remove", "rename", "population"]);

// The op a written value is, or "" when it is none of the five.
export const markerOpKind = (value) => {
  const word = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MARKER_OPS.includes(word) ? word : "";
};
