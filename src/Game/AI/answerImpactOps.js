/*! Open Historia — an event's operations, read one at a time © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An event's impacts are lists of operations: a structure built, a project set
// back, a unit moved. Each is one thing the event does, and each stands or falls
// on its own. A schema check is all or nothing, so before this one malformed op
// in one event failed the whole answer: a Game Master transaction (which had no
// salvage at all, "half a transaction is not a smaller transaction") was lost
// whole over a project op written to the old contract, and the player got
// nothing (2026-11-19, four reports).
//
// Two doors, used by the task runner (gameplay.js runJsonTask) for every task
// whose answer has events, and by the tests that feed it real answers:
//   settleMarkerOps    a structure's op as the engine reads it, before the schema
//                      sees it; an op word that is none of the five is left out.
//   salvageTaskAnswer  what schema salvage may cut from a task's answer. For the
//                      Game Master: ONE operation inside an event's impacts, whole,
//                      and nothing else. Its events, ledgers and patches are the
//                      transaction and stay all or nothing, as before.
//
// Nothing is read from the words of an op (the owner, 2026-11-13: no keywording
// anywhere): an op is kept as written, moved one level when it is the same object
// written one level off, or left out and said.

import { MARKER_OPS, markerOpKind } from "../../runtime/markerOps.js";
import { withSaidFamily } from "../../runtime/markerFamily.js";
import { salvageBySchema } from "./schemaSalvage.js";

const text = (value) => (typeof value === "string" ? value.trim() : "");
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

// A structure's op, as the engine reads it (gameState.js normalizeMarkerOp): the
// op one of the five (runtime/markerOps.js), case and spaces aside, or a build by
// its shape (no op word, a structure under `marker`); a build written flat has
// the structure's own fields lifted under `marker`. A structure built is drawn as
// the family the answer said, or as a landmark (runtime/markerFamily.js
// withSaidFamily), never by its kind's words. Any other op word is left out and
// returned, so the receipt says it as schema salvage says what it cuts: asking
// again for it would be a second request.
// `payload` is changed in place (the caller's fresh parse); returns what was left out.
export const settleMarkerOps = (payload) => {
  const leftOut = [];
  for (const [eventIndex, event] of (Array.isArray(payload?.events) ? payload.events : []).entries()) {
    const ops = event?.impacts?.markerOps;
    if (!Array.isArray(ops)) continue;
    const kept = [];
    for (const [opIndex, op] of ops.entries()) {
      if (!isRecord(op)) {
        kept.push(op);
        continue;
      }
      const written = text(op.op);
      const kind = markerOpKind(written) || (!written && isRecord(op.marker) ? "build" : "");
      if (!kind) {
        const path = `$.events[${eventIndex}].impacts.markerOps[${opIndex}]`;
        const title = text(event?.title);
        leftOut.push({
          kind: "item",
          path,
          error: `${path}.op must be one of ${MARKER_OPS.map((entry) => JSON.stringify(entry)).join(", ")}; ${JSON.stringify(written)} is none of them.`,
          ...(title ? { label: `"${title}"` } : {}),
        });
        continue;
      }
      if (kind !== "build" || op.marker) {
        kept.push(kind === "build" ? { ...op, op: kind, marker: withSaidFamily(op.marker) } : { ...op, op: kind });
        continue;
      }
      const { op: _op, note, ...marker } = op;
      kept.push({ op: "build", marker: withSaidFamily(marker), ...(note == null ? {} : { note }) });
    }
    event.impacts.markerOps = kept;
  }
  return leftOut;
};

// The one operation a schema fault sits in, as the path of that list item:
// $.events[i].impacts.<family>[j]. Null for a fault anywhere else.
export const impactOperationPath = (segments) => (
  Array.isArray(segments)
  && segments.length >= 5
  && segments[0] === "events" && Number.isInteger(segments[1])
  && segments[2] === "impacts" && typeof segments[3] === "string"
  && Number.isInteger(segments[4])
    ? segments.slice(0, 5)
    : null
);

// Schema salvage for one task's answer (schemaSalvage.js): what it may cut, and
// how a cut is named. `value` is repaired in place and returned.
//   gameMaster      an operation inside an event's impacts, whole. Not a field
//                   of it: an op without its field is another op than the one
//                   written. Anything else stays a failed transaction.
//   pregameHistory  never its canonical updates (the campaign's starting state).
//   every other     the smallest thing at the fault, as always.
export const salvageTaskAnswer = (taskKey, value, validate) => salvageBySchema(value, validate, {
  protectedPathPrefixes: taskKey === "pregameHistory" ? ["$.canonicalUpdates"] : [],
  ...(taskKey === "gameMaster" ? { confineTo: impactOperationPath } : {}),
  describe: (candidate, path) => (path[0] === "events" && typeof path[1] === "number"
    ? `"${text(candidate?.events?.[path[1]]?.title) || `event ${path[1] + 1}`}"`
    : ""),
});
