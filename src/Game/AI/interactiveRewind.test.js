/*! Open Historia — interactive event rewind tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/interactiveRewind.test.js
//
// Runs without node_modules: interactiveRewind.js imports nothing.
//
// The invariant: a beat taken back leaves the scene exactly as it stood when
// that beat was about to be chosen — the beats before it, the text above the
// choices, and the same choices — and survives a save.

import test from "node:test";
import assert from "node:assert/strict";

import { canRewindInteractiveTo, interactiveChoiceTexts, isSceneInProgress, openInteractive, recordInteractiveBeat, rewindInteractive } from "./interactiveRewind.js";

const scene = () => {
  let interactive = openInteractive({
    title: "The Ems Dispatch",
    premise: "A telegram that could start a war.",
    opening: "The King's telegram lies on Bismarck's desk.",
    choices: ["Publish it as written", "Edit it before release", "Burn it"],
  });
  interactive = recordInteractiveBeat(interactive, {
    choice: "Edit it before release",
    summary: "The edited dispatch reads like an insult; Paris erupts.",
    nextChoices: ["Mobilise", "Offer talks"],
  });
  interactive = recordInteractiveBeat(interactive, {
    choice: "Mobilise",
    summary: "The reserves are called up across the North German Confederation.",
    nextChoices: ["Strike first", "Wait for France to declare"],
  });
  return interactive;
};

test("each beat keeps what the player was shown when they chose it", () => {
  const interactive = scene();
  assert.equal(interactive.firstOpening, "The King's telegram lies on Bismarck's desk.");
  assert.deepEqual(interactive.history.map((beat) => [beat.choice, beat.before, beat.offered]), [
    ["Edit it before release", "The King's telegram lies on Bismarck's desk.", ["Publish it as written", "Edit it before release", "Burn it"]],
    ["Mobilise", "The edited dispatch reads like an insult; Paris erupts.", ["Mobilise", "Offer talks"]],
  ]);
  assert.equal(interactive.opening, "The reserves are called up across the North German Confederation.");
});

test("taking back a beat restores the scene as it stood at that beat", () => {
  const back = rewindInteractive(scene(), 1);
  assert.equal(back.history.length, 1);
  assert.equal(back.opening, "The edited dispatch reads like an insult; Paris erupts.");
  assert.deepEqual(back.choices, ["Mobilise", "Offer talks"]);
  const start = rewindInteractive(scene(), 0);
  assert.equal(start.history.length, 0);
  assert.equal(start.opening, "The King's telegram lies on Bismarck's desk.");
  assert.deepEqual(start.choices, ["Publish it as written", "Edit it before release", "Burn it"]);
  const retaken = recordInteractiveBeat(start, { choice: "Burn it", summary: "The telegram is ash; the crisis passes quietly.", nextChoices: [] });
  assert.deepEqual(retaken.history.map((beat) => beat.choice), ["Burn it"], "a new beat takes its place");
});

test("it survives a save, whatever shape the choices were normalized into", () => {
  const saved = JSON.parse(JSON.stringify(scene()));
  saved.choices = saved.choices.map((text, index) => ({ id: `c${index}`, text, result: "" }));
  saved.history[1].offered = saved.history[1].offered.map((text) => ({ text }));
  const back = rewindInteractive({ ...saved, history: saved.history.map((beat) => ({ ...beat, offered: interactiveChoiceTexts(beat.offered) })) }, 1);
  assert.deepEqual(back.choices, ["Mobilise", "Offer talks"]);
  assert.deepEqual(interactiveChoiceTexts([{ id: "x", text: " Strike  first " }, "Wait", {}, null]), ["Strike first", "Wait"]);
});

test("a scene is in progress once the player starts it or plays a beat, never because a skip left one behind", () => {
  const proposed = openInteractive({ title: "Left by a skip", opening: "Now.", choices: ["A", "B"] });
  assert.equal(isSceneInProgress(proposed), false, "the player never saw it");
  assert.equal(isSceneInProgress({ ...proposed, origin: "player" }), true, "taken up by the player");
  assert.equal(isSceneInProgress(recordInteractiveBeat(proposed, { choice: "A", summary: "Then.", nextChoices: ["C"] })), true, "a beat played");
  assert.equal(isSceneInProgress(null), false);
});

test("a beat recorded before beats kept their screen cannot be returned to, and nothing else is invented", () => {
  const legacy = { title: "Old scene", opening: "Now.", choices: ["A"], history: [{ choice: "B", summary: "Then." }] };
  assert.equal(canRewindInteractiveTo(legacy, 0), false);
  assert.equal(rewindInteractive(legacy, 0), null);
  const mixed = recordInteractiveBeat(legacy, { choice: "A", summary: "Later.", nextChoices: ["C"] });
  assert.equal(canRewindInteractiveTo(mixed, 1), true, "every beat after it can");
  assert.equal(rewindInteractive(mixed, 1).opening, "Now.");
  assert.equal(rewindInteractive(scene(), 5), null);
  assert.equal(rewindInteractive(scene(), -1), null);
  assert.equal(rewindInteractive(null, 0), null);
});
