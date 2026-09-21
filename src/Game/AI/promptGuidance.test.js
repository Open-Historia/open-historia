/*! Open Historia — guidance segments of the system prompts © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The prompts an author edits are a few guidance passages inside a fixed
// technical template. These tests pin what makes that safe: every passage is
// found by unique, ordered anchors in the shipped text; an unedited pack
// renders the shipped prompt byte for byte; an edit replaces its own passage
// and nothing else; a pack in the old whole-prompt shape is ignored.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import {
  PROMPT_GUIDANCE,
  PROMPT_MODEL_VERSION,
  buildGuidanceDefaults,
  composePrompt,
  guidanceSegmentsFor,
  hasGuidance,
  locateSegment,
  materializePackGuidance,
  normalizePackGuidance,
  normalizeSectionGuidance,
} from "./promptGuidance.js";

const ROOT_KEYS = ["advisor", "leader"];
const SECTION_KEYS = [...ROOT_KEYS, ...Object.keys(PROMPT_GUIDANCE.tasks)];
const defaultTextOf = (key) => (ROOT_KEYS.includes(key) ? defaultPrompts[key] : defaultPrompts.tasks[key]);
const GUIDANCE_DEFAULTS = buildGuidanceDefaults(defaultPrompts);
const guidanceDefaultsOf = (key) => (ROOT_KEYS.includes(key) ? GUIDANCE_DEFAULTS[key] : GUIDANCE_DEFAULTS.tasks[key]);

test("every guidance section is a prompt that ships", () => {
  for (const key of Object.keys(PROMPT_GUIDANCE.tasks)) {
    assert.equal(typeof defaultPrompts.tasks[key], "string", `${key} is not a bundled task`);
  }
  assert.ok(hasGuidance("advisor"));
  assert.ok(hasGuidance("jumpForward"));
  assert.ok(!hasGuidance("timelineCurator"), "the curator is technical end to end");
  assert.ok(!hasGuidance("gameMaster"), "the GM contract is native");
  assert.deepEqual(guidanceSegmentsFor("nope"), []);
});

test("every segment's anchors are found once, in order, without overlap", () => {
  for (const key of SECTION_KEYS) {
    const text = defaultTextOf(key);
    const ids = new Set();
    let cursor = 0;
    for (const segment of guidanceSegmentsFor(key)) {
      assert.ok(!ids.has(segment.id), `${key}: segment id ${segment.id} repeats`);
      ids.add(segment.id);
      const found = locateSegment(text, segment, cursor);
      assert.ok(found, `${key}.${segment.id}: anchors not found after offset ${cursor}`);
      assert.ok(found.text.startsWith(segment.start) && found.text.endsWith(segment.end), `${key}.${segment.id}`);
      assert.ok(found.text.length >= segment.start.length, `${key}.${segment.id}: end anchor precedes the start`);
      assert.equal(text.indexOf(segment.start, found.start + 1), -1, `${key}.${segment.id}: the start anchor repeats later`);
      cursor = found.end;
    }
    assert.deepEqual(Object.keys(guidanceDefaultsOf(key)), [...ids], `${key}: defaults cover every segment`);
  }
});

test("no passage carries the technical layer", () => {
  for (const key of SECTION_KEYS) {
    for (const [id, text] of Object.entries(guidanceDefaultsOf(key))) {
      assert.ok(!text.includes("```"), `${key}.${id} carries a code block`);
      assert.ok(!/\{\s*"/.test(text), `${key}.${id} carries a JSON contract`);
    }
  }
});

test("an unedited pack composes the shipped prompt byte for byte", () => {
  for (const key of SECTION_KEYS) {
    const text = defaultTextOf(key);
    assert.equal(composePrompt(key, text, {}), text, `${key}: no guidance`);
    assert.equal(composePrompt(key, text, guidanceDefaultsOf(key)), text, `${key}: default guidance`);
    assert.equal(composePrompt(key, text, null), text, `${key}: null guidance`);
  }
});

test("an edit replaces its own passage and nothing else", () => {
  const key = "jumpForward";
  const text = defaultTextOf(key);
  const segment = guidanceSegmentsFor(key).find((entry) => entry.id === "difficulty");
  const found = locateSegment(text, segment);
  const edit = "Difficulty is a suggestion for ${PLAYER_POLITY}.";
  const out = composePrompt(key, text, { difficulty: `  ${edit}\n` });
  assert.equal(out, text.slice(0, found.start) + edit + text.slice(found.end));
  for (const other of guidanceSegmentsFor(key)) {
    if (other.id === segment.id) continue;
    assert.ok(out.includes(locateSegment(text, other).text), `${other.id} survived`);
  }
  assert.ok(out.includes("${PLAYER_POLITY}"), "placeholders in guidance are kept for rendering");
});

test("two edits land on their own passages even when one contains another's anchor", () => {
  const key = "advisor";
  const text = defaultTextOf(key);
  const [role, guidelines] = guidanceSegmentsFor(key);
  const out = composePrompt(key, text, {
    [role.id]: `Role text that quotes "${guidelines.start}" for fun.`,
    [guidelines.id]: "Guidelines text.",
  });
  assert.ok(out.startsWith(`Role text that quotes "${guidelines.start}" for fun.`));
  assert.equal(out.split("Guidelines text.").length, 2);
  assert.ok(!out.includes(locateSegment(text, guidelines).text), "the default guidelines were replaced");
});

test("a pack in the old whole-prompt shape carries nothing", () => {
  const empty = { advisor: {}, leader: {}, tasks: {} };
  assert.deepEqual(
    normalizePackGuidance(
      { advisor: "hacked", leader: "hacked", tasks: { jumpForward: "hacked" }, jumpForward: "hacked", helpers: { PLAYER_POLITY: "x" } },
      GUIDANCE_DEFAULTS,
    ),
    empty,
  );
  assert.deepEqual(normalizePackGuidance({ promptModel: 1, guidance: { advisor: { role: "x" } } }, GUIDANCE_DEFAULTS), empty);
  assert.deepEqual(normalizePackGuidance({ promptModel: PROMPT_MODEL_VERSION, guidance: "nope" }, GUIDANCE_DEFAULTS), empty);
  assert.deepEqual(normalizePackGuidance(null, GUIDANCE_DEFAULTS), empty);
  assert.deepEqual(normalizePackGuidance([], GUIDANCE_DEFAULTS), empty);
});

test("only real edits are kept", () => {
  const guidance = normalizePackGuidance(
    {
      promptModel: PROMPT_MODEL_VERSION,
      guidance: {
        advisor: {
          role: "   ",
          reminders: `  ${GUIDANCE_DEFAULTS.advisor.reminders}  `,
          guidelines: " Be blunt. ",
          bogus: "x",
          tone: 12,
        },
        leader: [],
        tasks: {
          jumpForward: { quality: "Short headlines." },
          timelineCurator: { anything: "x" },
          nope: { a: "b" },
        },
      },
    },
    GUIDANCE_DEFAULTS,
  );
  assert.deepEqual(guidance, { advisor: { guidelines: "Be blunt." }, leader: {}, tasks: { jumpForward: { quality: "Short headlines." } } });
  assert.deepEqual(normalizeSectionGuidance("advisor", { role: "x" }), { role: "x" });
  assert.deepEqual(normalizeSectionGuidance("advisor", { role: GUIDANCE_DEFAULTS.advisor.role }), { role: GUIDANCE_DEFAULTS.advisor.role }, "without defaults nothing is folded");
});

test("the Prompts tab has a section for every guided prompt", () => {
  const source = readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8");
  for (const key of SECTION_KEYS) {
    assert.ok(source.includes(`key: "${key}"`), `${key} has no PROMPT_SECTION_DEFINITIONS entry`);
  }
});

test("when the defaults change, an edited passage stays and everything else follows the new default", () => {
  const key = "advisor";
  const original = defaultTextOf(key);
  const [, guidelines, reminders] = guidanceSegmentsFor(key);
  // A later release: a reworded reminders passage (its anchors kept, as
  // promptGuidance.js requires) and a new technical block after the guidance.
  const oldReminders = locateSegment(original, reminders).text;
  const newReminders = `${reminders.start} Revised for the new release. ${oldReminders.slice(reminders.start.length)}`;
  const contract = "[Output contract v2]\nReturn one JSON object.";
  const updated = `${original.replace(oldReminders, newReminders)}\n\n${contract}`;
  const stored = normalizePackGuidance({ promptModel: PROMPT_MODEL_VERSION, guidance: { advisor: { guidelines: "Be blunt." } } }, GUIDANCE_DEFAULTS);
  const out = composePrompt(key, updated, stored.advisor);
  assert.ok(out.endsWith(contract), "new technical text arrives");
  assert.ok(out.includes(newReminders), "an unedited passage takes its new default");
  assert.ok(out.includes("Be blunt."), "the edited passage keeps the author's text");
  assert.ok(!out.includes(locateSegment(original, guidelines).text), "the edited passage's old default is gone");
  assert.equal(composePrompt(key, updated, {}), updated, "nothing edited: the whole new prompt");
});

test("Export all prompts materializes every editable default passage", () => {
  const guidance = materializePackGuidance({}, GUIDANCE_DEFAULTS);
  assert.deepEqual(guidance.advisor, GUIDANCE_DEFAULTS.advisor);
  assert.deepEqual(guidance.leader, GUIDANCE_DEFAULTS.leader);
  assert.deepEqual(guidance.tasks, GUIDANCE_DEFAULTS.tasks);

  for (const key of SECTION_KEYS) {
    const bucket = ROOT_KEYS.includes(key) ? guidance[key] : guidance.tasks[key];
    assert.deepEqual(Object.keys(bucket), guidanceSegmentsFor(key).map((segment) => segment.id), `${key}: every editable passage exported`);
    assert.ok(Object.values(bucket).every((text) => typeof text === "string" && text.trim()), `${key}: no empty exported passage`);
  }
});

test("a materialized transfer folds current defaults back to sparse overrides on import", () => {
  const guidance = materializePackGuidance(
    {
      promptModel: PROMPT_MODEL_VERSION,
      guidance: { advisor: { guidelines: "Be concise and specific." } },
    },
    GUIDANCE_DEFAULTS,
  );

  assert.equal(guidance.advisor.guidelines, "Be concise and specific.");
  assert.equal(guidance.advisor.role, GUIDANCE_DEFAULTS.advisor.role);

  const imported = normalizePackGuidance(
    { promptModel: PROMPT_MODEL_VERSION, guidance },
    GUIDANCE_DEFAULTS,
  );
  assert.deepEqual(imported, {
    advisor: { guidelines: "Be concise and specific." },
    leader: {},
    tasks: {},
  });
});

test("edits stored under a renamed task's old key are the new task's", () => {
  const [first] = guidanceSegmentsFor("interactiveCreation");
  const packWith = (tasks) => ({ promptModel: PROMPT_MODEL_VERSION, guidance: { tasks } });
  const before = normalizePackGuidance(packWith({ catalystCreation: { [first.id]: "An edit made before the rename." } }), GUIDANCE_DEFAULTS);
  assert.deepEqual(before.tasks, { interactiveCreation: { [first.id]: "An edit made before the rename." } }, "kept under the new key only");
  const both = normalizePackGuidance(packWith({ catalystCreation: { [first.id]: "Old." }, interactiveCreation: { [first.id]: "New." } }), GUIDANCE_DEFAULTS);
  assert.deepEqual(both.tasks.interactiveCreation, { [first.id]: "New." }, "the new key wins");
});
