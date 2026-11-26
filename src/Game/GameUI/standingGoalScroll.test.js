// Run: node --test src/Game/GameUI/standingGoalScroll.test.js
//
// A player's report, 2026-11-26: "Goal summary gets cut off when its too long.
// Fix: make it scrollable". The standing goal was clamped to three lines
// (-webkit-line-clamp) with the rest hidden, and its progress reading could run
// past the card. Both now sit in a box that scrolls past a few lines
// (actions.jsx GOAL_SCROLL_STYLE), on a desktop and a phone alike. The goal is
// shown in one place only, the Actions panel's Standing goal card.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./actions.jsx", import.meta.url), "utf8");
const block = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

test("the goal and its reading scroll, never clamped or cut off", () => {
  const card = block("const StandingGoal = ", "const ACTIONS_TABS");
  const progress = block("const GoalProgress = ", "const StandingGoal = ");
  assert.doesNotMatch(card, /WebkitLineClamp/);
  assert.match(card, /data-goal-scroll="goal" style=\{\{ \.\.\.GOAL_SCROLL_STYLE/);
  assert.match(progress, /data-goal-scroll="summary" style=\{\{ \.\.\.GOAL_SCROLL_STYLE/);
  const style = block("const GOAL_SCROLL_STYLE", "});");
  assert.match(style, /overflowY: "auto"/);
  assert.match(style, /maxHeight: "min\(/, "a height that holds on a phone's short screen too");
  assert.match(style, /overscrollBehavior: "contain"/);
  assert.match(style, /overflowWrap: "anywhere"/, "a long word wraps rather than widening the panel");
});

test("the scrollbar is the game's own: no colour of its own, so the theme's applies", () => {
  const style = block("const GOAL_SCROLL_STYLE", "});");
  assert.doesNotMatch(style, /scrollbarColor|scrollbarWidth|gradient/i);
});
