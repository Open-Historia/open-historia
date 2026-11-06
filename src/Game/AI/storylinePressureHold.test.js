/*! Open Historia — a storyline's pressure is the time skip's to set, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/storylinePressureHold.test.js
//
// A player's report, 2026-11-06 (1836, France): every time skip, with every model, fell back to the canned events:
// "Storyline storyline-fr-franchise-1836 lowers pressure by 47 point(s), but its linked event(s) contain
// escalation/failure cues and no concrete de-escalatory outcome." The franchise and rente reforms passed over a small
// conservative bloc that rejected them. The check read the events for words ("reject", "threat", "strike"…), and "so
// it keywords? thats the issue, dont do keywording its super unreliable" (the owner, 2026-11-06): it is gone, and the
// pressure the skip gives a storyline stands, whatever words its events use.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { decodeWorldStorylineUpdates, validateWorldStorylinePayload } from "./nativeWorldDirector.js";

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

test("a crisis storyline's pressure falls as the skip says, whatever words its events use", () => {
  for (const event of [
    { title: "Chamber passes the franchise bill", description: "Despite a conservative bloc that rejects the measure and threatens to walk out, the bill is passed by 214 votes to 151." },
    { title: "Franchise talks fail", description: "Talks between the ministry and the conservative bloc collapse; the bloc renews its threats." },
  ]) {
    const candidate = answer(event);
    assert.equal(validateWorldStorylinePayload(candidate, scope), "", event.title);
    assert.equal(decodeWorldStorylineUpdates(candidate.storylineUpdates)[0].pressure, 23, "and nothing changes it");
  }
});

test("no word list judges a storyline's pressure, and the time skip has no pressure repair", () => {
  const director = fs.readFileSync(new URL("./nativeWorldDirector.js", import.meta.url), "utf8");
  assert.doesNotMatch(director, /STORYLINE_DEESCALATION_RE|unjustifiedPressureDrop|escalation\/failure cues/);
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.doesNotMatch(gameplay, /holdUnjustifiedPressureDrops/);
});
