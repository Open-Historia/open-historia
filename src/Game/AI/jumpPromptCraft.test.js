/*! Open Historia — what the jump is told about voice, orders and the world © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/jumpPromptCraft.test.js
//
// Runs without node_modules.
//
// Four passages both jump templates carry. Three are guidance an author may
// rewrite — how an event is written, what an order can do, how the world answers —
// and one is not: the order of authority between the current map, the game's
// events and the world before round 1 is a rule the engine depends on, and a
// scenario that edited it away would go back to calling a polity an ally because
// it was one in 1914. These hold where each passage sits, which of them can be
// edited, and that none of them costs the prompt cache anything.

import test from "node:test";
import assert from "node:assert/strict";
import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import { PROMPT_GUIDANCE, locateSegment } from "./promptGuidance.js";
import { STATIC_PROMPT_KEYS } from "./promptLayout.js";

const JUMP_TASKS = ["jumpForward", "autoJumpForward"];
const EDITABLE = { orders: "[What an Order Can Do]", reactions: "[The World Answers Back]", voice: "[Event Voice]" };
const TECHNICAL = "[What Is True Now]";

const template = (task) => defaultPrompts.tasks[task];
const once = (text, needle) => text.split(needle).length - 1 === 1;

test("both jump templates carry all four passages, once each", () => {
  for (const task of JUMP_TASKS) {
    for (const header of [...Object.values(EDITABLE), TECHNICAL]) {
      assert.ok(once(template(task), header), `${task}: ${header}`);
    }
  }
});

test("each passage sits beside the section it extends", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    const at = (needle) => text.indexOf(needle);
    // Never acting for the player, then what the player's own orders can do.
    assert.ok(at("[Player Agency — critical]") < at(EDITABLE.orders), task);
    assert.ok(at(EDITABLE.orders) < at("[The World Before Round 1]"), task);
    // The lore, then how much it counts for.
    assert.ok(at("[The World Before Round 1]") < at(TECHNICAL), task);
    assert.ok(at(TECHNICAL) < at("[What to Simulate]"), task);
    // What to simulate, then who else is simulating.
    assert.ok(at("[What to Simulate]") < at(EDITABLE.reactions), task);
    // What an event contains, then how it is written.
    assert.ok(at("[Event Quality]") < at(EDITABLE.voice), task);
  }
});

test("the three guidance passages are editable, on both tasks, under the same ids", () => {
  for (const task of JUMP_TASKS) {
    const segments = PROMPT_GUIDANCE.tasks[task];
    for (const [id, header] of Object.entries(EDITABLE)) {
      const segment = segments.find((entry) => entry.id === id);
      assert.ok(segment, `${task} has no "${id}" segment`);
      assert.equal(segment.start, header);
      const located = locateSegment(template(task), segment);
      assert.ok(located && located.end > located.start, `${task}.${id} is not located`);
    }
  }
});

test("the order of authority is not something a scenario can edit away", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    const at = text.indexOf(TECHNICAL);
    for (const segment of PROMPT_GUIDANCE.tasks[task]) {
      const located = locateSegment(text, segment);
      assert.ok(located, `${task}.${segment.id}`);
      assert.ok(at < located.start || at >= located.end, `${task}.${segment.id} covers ${TECHNICAL}`);
    }
    // And it says the three things it exists to say.
    const end = text.indexOf("\n[", at + 1);
    const passage = text.slice(at, end);
    assert.match(passage, /current map/);
    assert.match(passage, /never evidence of who holds what today/);
    assert.match(passage, /because it was one when the game began/);
  }
});

test("none of the passages costs the prompt cache anything", () => {
  const placeholder = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  for (const task of JUMP_TASKS) {
    const text = template(task);
    let firstDynamic = text.length;
    for (const match of text.matchAll(placeholder)) {
      if (!STATIC_PROMPT_KEYS.has(match[1])) { firstDynamic = match.index; break; }
    }
    for (const header of [...Object.values(EDITABLE), TECHNICAL]) {
      const at = text.indexOf(header);
      const end = text.indexOf("\n[", at + 1);
      assert.ok(end < firstDynamic, `${task}: ${header} reaches past the cacheable prefix`);
      for (const match of text.slice(at, end).matchAll(placeholder)) {
        assert.ok(STATIC_PROMPT_KEYS.has(match[1]), `${task}: ${header} uses the per-turn variable \${${match[1]}}`);
      }
    }
  }
});

test("the voice passage states its five rules, the orders passage five, the reactions six", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    const section = (header) => { const at = text.indexOf(header); return text.slice(at, text.indexOf("\n[", at + 1)); };
    assert.equal((section(EDITABLE.voice).match(/^ {2}• /gm) ?? []).length, 5, `${task} voice`);
    assert.equal((section(EDITABLE.orders).match(/^ {2}• /gm) ?? []).length, 5, `${task} orders`);
    // Six since the world was told to act first: the two rules that make a
    // rival move on its own, and make both sides of a fight fight.
    assert.equal((section(EDITABLE.reactions).match(/^ {2}• /gm) ?? []).length, 6, `${task} reactions`);
  }
});

// The world used to answer and never ask. Every rule about conflict was framed
// as a reply to something the player had already done, so a campaign could run
// for years with nobody ever wanting anything from the player — which is what a
// player reported, and what two of their saves showed: 42 events, no wars, no
// territory changes, no relation changes. These two rules are the other half.
test("the world is told it may move first, and that both sides of a fight fight", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    assert.ok(once(text, "THE PRESSURE DOES NOT HAVE TO START WITH THE PLAYER"), `${task}: initiative`);
    assert.ok(once(text, "WHEN THERE IS A FIGHT, BOTH SIDES FIGHT"), `${task}: both sides`);
    // Both rules sit inside the passage about how the world answers, which is
    // the one an author may rewrite — deliberately, so a scenario CAN choose a
    // gentler world.
    const section = text.slice(text.indexOf(EDITABLE.reactions), text.indexOf("\n[", text.indexOf(EDITABLE.reactions) + 1));
    assert.ok(section.includes("THE PRESSURE DOES NOT HAVE TO START WITH THE PLAYER"), `${task}: initiative is part of the editable passage`);
    assert.ok(section.includes("WHEN THERE IS A FIGHT, BOTH SIDES FIGHT"), `${task}: both sides is part of the editable passage`);
    // And the licence to diverge is no longer reaction-only.
    if (task === "jumpForward") assert.ok(text.includes("of their own accord where their interests point that way"), "jumpForward: divergence is not reaction-only");
  }
});

// "Do not manufacture aggression" was meant to forbid a rivalry nobody in the
// campaign had a reason for. Sitting in a prompt this long, beside the player's
// name, it read instead as "do not attack the player" — so the rule now names
// what it is actually about, and says the player is one polity in the pair like
// any other.
test("the ban is on inventing a rivalry, not on hostility", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    assert.ok(once(text, "What is forbidden is INVENTING A RIVALRY"), `${task}: the ban names itself`);
    assert.ok(text.includes("covers every pair of polities on the map"), `${task}: it is not about the player`);
    assert.ok(
      text.includes("never was, a ban") || text.includes("never been a rule against writing the hostility"),
      `${task}: and says what it is not`,
    );
  }
});

// Events used to be written to a word budget — 25-30 words for most of them,
// "stick to these lengths strictly" — so a battle, a treaty and a cabinet
// reshuffle all came out the same size and none of them said who, where or with
// what. The budget is now in sentences, and it has to be filled with facts.
test("event descriptions are sized by what happened, not by a word count", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    assert.ok(!text.includes("25–30 words"), `${task}: the old word budget is gone`);
    assert.ok(!text.includes("keep descriptions short and concise"), `${task}: and so is the instruction to keep them short`);
    assert.ok(text.includes("who did it, where, with what, against whom"), `${task}: says what a description must answer`);
    // A description that long has to be readable: bold on the names and points
    // that matter, and paragraphs that stop before they become a wall.
    assert.ok(text.includes("Use formatting like bold to highlight important parts"), `${task}: formatting`);
    assert.ok(text.includes("never be more than 4 lines max"), `${task}: paragraph ceiling`);
    assert.ok(text.includes("Length comes from FACTS, never from commentary"), `${task}: detail is facts, not padding`);
    // The map and the prose are one record: an impact that moves the map has to
    // be in the words too, or the timeline and the map disagree.
    assert.ok(text.includes("so the timeline and the map never tell different stories"), `${task}: impacts are narrated`);
    // And the test an author can apply without counting anything.
    assert.ok(text.includes("swapping in other countries would leave it true"), `${task}: the generic-description test`);
  }
});
