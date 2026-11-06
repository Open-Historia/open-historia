/*! Open Historia — a storyline's pressure drop its events do not bear out is held, not a lost skip, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/storylinePressureHold.test.js
//
// A player's report, 2026-11-06 (1836, France): every time skip, with every model, fell back to the canned events:
// "Storyline storyline-fr-franchise-1836 lowers pressure by 47 point(s), but its linked event(s) contain
// escalation/failure cues and no concrete de-escalatory outcome." The franchise and rente reforms passed over a small
// conservative bloc that rejected them.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { decodeWorldStorylineUpdates, holdUnjustifiedPressureDrops, unjustifiedPressureDrop, validateWorldStorylinePayload } from "./nativeWorldDirector.js";

const franchise = {
  id: "storyline-fr-franchise-1836",
  kind: "reform",
  title: "The franchise question",
  participants: ["Kingdom of France"],
  status: "active",
  pressure: 70,
  momentum: 40,
  startedDate: "1836-01-01",
  accountedThroughDate: "1836-04-30",
  lastUpdatedDate: "1836-04-30",
  lastVisibleEventDate: "1836-04-20",
  nextReviewDate: "1836-06-01",
  state: "The Chamber is divided on widening the franchise.",
};

const scope = {
  existingStorylines: [franchise],
  selectedStorylines: [franchise],
  deferredStorylines: [],
  originDate: "1836-04-30",
  stopDate: "1836-07-29",
  enforceAntiStasis: false,
  enforceSelectedCoverage: false,
};

const answer = (event) => ({
  events: [{ date: "1836-06-12", ...event }],
  storylineUpdates: [{ ...franchise, pressure: 23, eventIndexes: [0], state: "The franchise bill has passed; the conservatives fume." }],
});

test("a reform that passes over a bloc that rejects it eases the crisis: it is not refused", () => {
  const candidate = answer({
    title: "Chamber passes the franchise bill",
    description: "Despite a conservative bloc that rejects the measure and threatens to walk out, the bill is passed by 214 votes to 151.",
  });
  assert.equal(validateWorldStorylinePayload(candidate, scope), "");
  assert.equal(holdUnjustifiedPressureDrops(candidate, scope).length, 0, "nothing to hold");
});

test("a drop the events do not bear out keeps the old pressure, and the rest of the answer stands", () => {
  const candidate = answer({
    title: "Franchise talks fail",
    description: "Talks between the ministry and the conservative bloc collapse; the bloc renews its threats.",
  });
  assert.match(validateWorldStorylinePayload(structuredClone(candidate), scope), /lowers pressure by 47 point\(s\)/, "refused as it was, without the repair");
  assert.deepEqual(holdUnjustifiedPressureDrops(candidate, scope), ["storyline-fr-franchise-1836"]);
  const [update] = decodeWorldStorylineUpdates(candidate.storylineUpdates);
  assert.equal(update.pressure, 70, "the old pressure");
  assert.equal(update.state, "The franchise bill has passed; the conservatives fume.", "the model's account of the state stands");
  assert.equal(validateWorldStorylinePayload(candidate, scope), "", "and the answer passes");
});

test("a quiet storyline easing is no crisis's business, and a rising pressure is never held", () => {
  const quiet = { ...franchise, pressure: 30 };
  const candidate = { events: [{ title: "Talks fail", description: "Talks collapse." }], storylineUpdates: [{ ...quiet, pressure: 10, eventIndexes: [0] }] };
  assert.equal(unjustifiedPressureDrop(candidate.storylineUpdates[0], quiet, candidate), 0);
  const rising = { events: [{ title: "Talks fail", description: "Talks collapse." }], storylineUpdates: [{ ...franchise, pressure: 90, eventIndexes: [0] }] };
  assert.equal(holdUnjustifiedPressureDrops(rising, scope).length, 0);
});

test("the time skip holds the drop before it judges the segment, and the local repair before it judges the record", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const segment = source.indexOf("const heldPressure = holdUnjustifiedPressureDrops(candidate, {");
  assert.ok(segment > 0 && segment < source.indexOf("const storylineError = validateWorldStorylinePayload(candidate, {", segment));
  const local = source.indexOf("holdUnjustifiedPressureDrops(validationCandidate,");
  assert.ok(local > 0 && local < source.indexOf("const storylineError = validateWorldStorylinePayload(validationCandidate, {", local));
});
