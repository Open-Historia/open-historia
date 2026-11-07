/*! Open Historia — the length limit on edited prompt passages: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The owner, 2026-11-07: "add a character limit to prompts so they can at
// most be 20% larger than the built in defaults". Pinned here: the limit of
// every passage, how a passage is counted, that every built-in default (in
// every shipped language) is within it and stays within it as the defaults
// grow, that an over-limit passage from a pack is left out whole and named,
// the final guard where a template is rendered, the one-time notice, the
// Prompts tab's behaviour and the suggestions' review.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import { TRANSLATED_GUIDANCE_LENGTHS } from "./guidanceLengths.js";
import {
  PROMPT_GUIDANCE,
  PROMPT_LENGTH_ALLOWANCE_PERCENT,
  PROMPT_MODEL_VERSION,
  buildGuidanceDefaults,
  composePrompt,
  guidanceCharLimit,
  guidanceFingerprint,
  normalizePackGuidance,
  overLimitPackGuidance,
  promptCharCount,
} from "./promptGuidance.js";

// gameplayPrompts.js imports defaultPrompts.json the way Vite does, without an
// import attribute; node needs one.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) return nextLoad(url, { ...context, importAttributes: { type: "json" } });
    return nextLoad(url, context);
  },
});
const gameplayPrompts = await import("./gameplayPrompts.js");
const notice = await import("../../runtime/promptLimitNotice.js");
const { buildDetailSave, promptChangeOverLimit } = await import("../../runtime/suggestionApply.js");

const ROOT_KEYS = ["advisor", "leader"];
const SECTION_KEYS = [...ROOT_KEYS, ...Object.keys(PROMPT_GUIDANCE.tasks)];
const GUIDANCE_DEFAULTS = buildGuidanceDefaults(defaultPrompts);
const sectionDefaults = (key) => (ROOT_KEYS.includes(key) ? GUIDANCE_DEFAULTS[key] : GUIDANCE_DEFAULTS.tasks[key]);
const packWith = (sectionKey, segmentId, text) => ({
  promptModel: PROMPT_MODEL_VERSION,
  guidance: ROOT_KEYS.includes(sectionKey)
    ? { [sectionKey]: { [segmentId]: text } }
    : { tasks: { [sectionKey]: { [segmentId]: text } } },
});
const PACKS_DIR = new URL("../../../public/lang/prompts/", import.meta.url);
const PACKS = readdirSync(PACKS_DIR)
  .filter((name) => /^[a-z]{2,3}\.json$/.test(name))
  .map((name) => [name, JSON.parse(readFileSync(new URL(name, PACKS_DIR), "utf8"))]);
// A passage this long, made of a sentence repeated, with no part cut.
const longText = (length) => `${"Keep the tone of a saga. ".repeat(Math.ceil(length / 25)).slice(0, length - 1)}.`;

test("the limit is 20% over the longest built-in version of each passage, rounded up", () => {
  assert.equal(PROMPT_LENGTH_ALLOWANCE_PERCENT, 20);
  for (const key of SECTION_KEYS) {
    for (const [id, passage] of Object.entries(sectionDefaults(key))) {
      let longest = promptCharCount(passage);
      for (const [, pack] of PACKS) if (typeof pack[passage] === "string") longest = Math.max(longest, promptCharCount(pack[passage]));
      assert.equal(guidanceCharLimit(passage), Math.ceil(longest * 1.2 - 1e-9), `${key}.${id}`);
      assert.ok(guidanceCharLimit(passage) >= Math.ceil(promptCharCount(passage) * 1.2 - 1e-9), `${key}.${id}: at least 120% of the English`);
      assert.equal(gameplayPrompts.guidanceLimitFor(key, id), guidanceCharLimit(passage), `${key}.${id} by key`);
    }
  }
  // Exact for a passage no translation makes longer: 120% of the English.
  const reminders = GUIDANCE_DEFAULTS.advisor.reminders;
  if (!TRANSLATED_GUIDANCE_LENGTHS.has(guidanceFingerprint(reminders))) {
    assert.equal(guidanceCharLimit(reminders), Math.ceil((promptCharCount(reminders) * 120) / 100));
  }
});

test("a passage is counted as typed: line breaks as one, the ends trimmed, placeholders as written", () => {
  assert.equal(promptCharCount("  abc\r\ndef \n"), 7);
  assert.equal(promptCharCount("a\rb"), 3);
  assert.equal(promptCharCount("${PLAYER_POLITY}"), 16, "a placeholder counts its own characters");
  assert.equal(promptCharCount(null), 0);
  // The default's own placeholders count the same way, so the allowance is
  // the same whether an author keeps them or not.
  const role = GUIDANCE_DEFAULTS.tasks.jumpForward.role;
  assert.ok(role.includes("${PLAYER_POLITY}"));
  assert.equal(promptCharCount(role), role.trim().length);
});

test("every built-in default passes, in English and in every shipped translation", () => {
  for (const key of SECTION_KEYS) {
    for (const [id, passage] of Object.entries(sectionDefaults(key))) {
      assert.ok(promptCharCount(passage) <= guidanceCharLimit(passage), `${key}.${id}`);
      for (const [file, pack] of PACKS) {
        if (typeof pack[passage] !== "string") continue;
        assert.ok(promptCharCount(pack[passage]) <= guidanceCharLimit(passage), `${file} ${key}.${id}`);
      }
    }
  }
  // And the editor's own check finds nothing in an unedited pack, nor in a
  // pack whose every passage is the English or a translated default.
  assert.deepEqual(gameplayPrompts.overLimitEdits(GUIDANCE_DEFAULTS), []);
  assert.deepEqual(gameplayPrompts.normalizePromptPack({}).overLimit, []);
});

test("the limit is relative: a longer default carries a longer limit", () => {
  const passage = GUIDANCE_DEFAULTS.leader.tone;
  const grown = `${passage} ${passage}`;
  assert.ok(guidanceCharLimit(grown) > guidanceCharLimit(passage));
  assert.ok(promptCharCount(grown) <= guidanceCharLimit(grown), "a default that grows still passes");
  // A whole prompt whose default grew: its unedited composition is unchanged and within its limit.
  const template = defaultPrompts.leader.replace(passage, grown);
  assert.equal(composePrompt("leader", template, { tone: grown }), template);
});

test("a passage with no built-in default has a limit of nothing", () => {
  assert.equal(guidanceCharLimit(undefined), 0);
  assert.equal(guidanceCharLimit("   "), 0);
  // An unknown segment never reaches a pack (normalizeSectionGuidance), and
  // one whose default cannot be found in its prompt cannot be written.
  const missing = overLimitPackGuidance(packWith("leader", "tone", "Short."), { ...GUIDANCE_DEFAULTS, leader: {} });
  assert.deepEqual(missing.map((entry) => [entry.segmentId, entry.limit]), [["tone", 0]]);
});

test("a stored passage over its limit is left out whole, and named; one at the limit is kept", () => {
  const passage = GUIDANCE_DEFAULTS.tasks.jumpForward.scope;
  const limit = guidanceCharLimit(passage);
  const atLimit = longText(limit);
  const over = longText(limit + 1);
  assert.equal(promptCharCount(atLimit), limit);
  assert.equal(promptCharCount(over), limit + 1);

  const kept = normalizePackGuidance(packWith("jumpForward", "scope", atLimit), GUIDANCE_DEFAULTS);
  assert.equal(kept.tasks.jumpForward.scope, atLimit);

  const dropped = normalizePackGuidance(packWith("jumpForward", "scope", over), GUIDANCE_DEFAULTS);
  assert.deepEqual(dropped.tasks, {}, "not cut to fit: left out");
  const named = overLimitPackGuidance(packWith("jumpForward", "scope", over), GUIDANCE_DEFAULTS);
  assert.deepEqual(named, [{ sectionKey: "jumpForward", segmentId: "scope", text: over, length: limit + 1, limit }]);

  // Without the defaults (a suggestion's diff, which shows what was written) nothing is judged.
  assert.equal(normalizePackGuidance(packWith("jumpForward", "scope", over)).tasks.jumpForward.scope, over);

  // Whitespace at the ends and CRLF line breaks do not count against it.
  const padded = `\r\n  ${atLimit.replace(/\. /g, ".\r\n")}  \r\n`;
  assert.equal(normalizePackGuidance(packWith("jumpForward", "scope", padded), GUIDANCE_DEFAULTS).tasks.jumpForward.scope, padded.trim());
});

test("loading a pack: the runtime prompt runs the default in place of an over-limit passage", () => {
  const passage = GUIDANCE_DEFAULTS.advisor.reminders;
  const over = longText(guidanceCharLimit(passage) + 40);
  const pack = gameplayPrompts.normalizePromptPack(packWith("advisor", "reminders", over));
  assert.equal(pack.advisor, defaultPrompts.advisor, "the shipped prompt, byte for byte");
  assert.deepEqual(pack.guidance.advisor, {});
  assert.equal(pack.overLimit.length, 1);
  assert.equal(pack.overLimit[0].sectionLabel, "Advisor Chat");
  assert.equal(pack.overLimit[0].segmentLabel, "Final reminders");
  // Saving it again writes the edits that count: the over-limit one is not among them.
  assert.deepEqual(gameplayPrompts.serializePromptPack(packWith("advisor", "reminders", over)).guidance.advisor, {});
  // An edit within its limit composes as before.
  const fine = longText(guidanceCharLimit(passage) - 5);
  assert.ok(gameplayPrompts.normalizePromptPack(packWith("advisor", "reminders", fine)).advisor.includes(fine));
});

test("composition is the last word: an over-limit passage never enters a prompt, a translation always does", () => {
  const passage = GUIDANCE_DEFAULTS.tasks.warRoom.voices;
  const over = longText(guidanceCharLimit(passage) + 1);
  assert.equal(composePrompt("warRoom", defaultPrompts.tasks.warRoom, { voices: over }), defaultPrompts.tasks.warRoom);
  const within = longText(guidanceCharLimit(passage));
  assert.ok(composePrompt("warRoom", defaultPrompts.tasks.warRoom, { voices: within }).includes(within));
  // Every shipped translation composes in, the longest included.
  for (const [file, pack] of PACKS) {
    for (const key of SECTION_KEYS) {
      const defaults = sectionDefaults(key);
      const translated = Object.fromEntries(Object.entries(defaults).filter(([, text]) => typeof pack[text] === "string").map(([id, text]) => [id, pack[text]]));
      const template = ROOT_KEYS.includes(key) ? defaultPrompts[key] : defaultPrompts.tasks[key];
      const composed = composePrompt(key, template, translated);
      for (const text of Object.values(translated)) assert.ok(composed.includes(text.trim()), `${file} ${key}`);
    }
  }
});

test("the final guard where a template is rendered", () => {
  for (const key of SECTION_KEYS) {
    const template = ROOT_KEYS.includes(key) ? defaultPrompts[key] : defaultPrompts.tasks[key];
    assert.ok(gameplayPrompts.promptTemplateLimit(key) >= promptCharCount(template), key);
    assert.equal(gameplayPrompts.guardPromptTemplate(key, template), template, `${key}: the default passes`);
  }
  // Every passage at its limit at once still passes.
  const full = Object.fromEntries(Object.entries(GUIDANCE_DEFAULTS.tasks.jumpForward).map(([id, text]) => [id, longText(guidanceCharLimit(text))]));
  const longest = gameplayPrompts.normalizePromptPack({ promptModel: PROMPT_MODEL_VERSION, guidance: { tasks: { jumpForward: full } } }).tasks.jumpForward;
  assert.equal(gameplayPrompts.guardPromptTemplate("jumpForward", longest), longest);
  // A template that came some other way, longer than any pack can compose: the default goes out.
  const warn = console.warn;
  console.warn = () => {};
  try {
    const bloated = `${defaultPrompts.tasks.jumpForward}\n${"x".repeat(gameplayPrompts.promptTemplateLimit("jumpForward"))}`;
    assert.equal(gameplayPrompts.guardPromptTemplate("jumpForward", bloated), defaultPrompts.tasks.jumpForward);
    // A technical prompt with no passages can only be its default length.
    assert.equal(gameplayPrompts.promptTemplateLimit("timelineCurator"), promptCharCount(defaultPrompts.tasks.timelineCurator));
    assert.equal(gameplayPrompts.guardPromptTemplate("timelineCurator", `${defaultPrompts.tasks.timelineCurator} More.`), defaultPrompts.tasks.timelineCurator);
  } finally {
    console.warn = warn;
  }
  // The guard sits where the templates are rendered.
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("./gameplay.js"), /guardPromptTemplate\(taskKey, prompts\.tasks\[taskKey\]\)/);
  assert.match(read("./main.jsx"), /renderConversationTemplate\(guardPromptTemplate\("advisor", promptPack\.advisor\)/);
  assert.match(read("./main.jsx"), /renderConversationTemplate\(guardPromptTemplate\("leader", promptPack\.leader\)/);
});

test("the Prompts tab keeps an over-limit passage in the form, counts it, and holds Save", () => {
  const passage = GUIDANCE_DEFAULTS.leader.reply;
  const limit = guidanceCharLimit(passage);
  const over = longText(limit + 12);
  const editable = gameplayPrompts.editablePromptPack(packWith("leader", "reply", over));
  assert.equal(editable.guidance.leader.reply, over, "the author's text, to shorten");
  assert.equal(editable.leader, defaultPrompts.leader, "never composed");
  assert.deepEqual(gameplayPrompts.overLimitEdits(editable.guidance), [{ sectionKey: "leader", segmentId: "reply", length: limit + 12, limit }]);
  // Shortened back to the limit, it is an edit like any other.
  const shortened = { ...editable.guidance, leader: { reply: longText(limit) } };
  assert.deepEqual(gameplayPrompts.overLimitEdits(shortened), []);
  // As typed in the textarea: counted after trimming.
  assert.deepEqual(gameplayPrompts.overLimitEdits({ leader: { reply: `${longText(limit)}\n\n   ` } }), []);

  const source = readFileSync(new URL("../GameUI/libraryBar.jsx", import.meta.url), "utf8");
  assert.match(source, /\{`\$\{count\} \/ \$\{limit\} characters`\}/, "the live counter");
  assert.match(source, /disabled=\{promptsTooLong\}/, "Save is held");
  assert.match(source, /if \(promptsOverLimit\(editorState\.prompts\)\) \{\s*setEditorError\(PROMPT_TOO_LONG_TEXT\);\s*return;/, "and refused if pressed some other way");
  assert.match(source, /const prompts = editablePromptPack\(details\?\.data\?\.prompts \?\? \{\}\);/);
  assert.doesNotMatch(source, /maxLength=/, "typing and pasting are never cut");
});

test("an imported prompt pack: over-limit passages are named and kept out of the game", () => {
  const passage = GUIDANCE_DEFAULTS.tasks.interactiveSummary.style;
  const over = longText(guidanceCharLimit(passage) * 2);
  const file = { schema: "open-historia-prompt-pack", version: 2, prompts: packWith("interactiveSummary", "style", over) };
  const pack = gameplayPrompts.normalizePromptPack(file.prompts);
  assert.equal(pack.tasks.interactiveSummary, defaultPrompts.tasks.interactiveSummary);
  assert.deepEqual(pack.overLimit.map((entry) => entry.segmentId), ["style"]);
  assert.equal(gameplayPrompts.editablePromptPack(file.prompts).guidance.tasks.interactiveSummary.style, over);
  // An export written from it carries the default, never half the passage.
  assert.equal(gameplayPrompts.materializePromptPack(file.prompts).guidance.tasks.interactiveSummary.style, passage);
});

test("the notice: each left-out passage is told of once on this device", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  notice.resetPromptLimitNotice();
  const entry = { sectionKey: "jumpForward", sectionLabel: "Time Skip", segmentId: "scope", segmentLabel: "What to simulate", text: "A long passage.", length: 999, limit: 900 };
  assert.equal(notice.notePromptsOverLimit([entry], { storage }).length, 1);
  assert.equal(notice.notePromptsOverLimit([entry], { storage }).length, 1, "once while it waits");
  notice.markPromptLimitNoticeSeen({ storage });
  assert.deepEqual(notice.pendingPromptLimitNotice(), []);
  assert.equal(notice.notePromptsOverLimit([entry], { storage }).length, 0, "not again once shown");
  assert.equal(notice.notePromptsOverLimit([{ ...entry, text: "Another long passage." }], { storage }).length, 1, "a different text is told of");
  notice.resetPromptLimitNotice();
  assert.deepEqual(notice.notePromptsOverLimit([], { storage }), []);
  // The game's loaders hand it what they left out.
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("./gameplay.js"), /notePromptsOverLimit\(pack\.overLimit\)/);
  assert.match(read("./main.jsx"), /notePromptsOverLimit\(promptPack\.overLimit\)/);
  assert.match(read("../GameUI/main.jsx"), /<PromptLimitNotice \/>/);
});

test("a suggested prompt passage over the limit is not accepted", () => {
  const passage = GUIDANCE_DEFAULTS.tasks.placeFeed.voices;
  const limit = guidanceCharLimit(passage);
  const change = (text) => ({ id: "c1", area: "details", kind: "field", path: ["prompts", "tasks", "placeFeed", "voices"], from: "", to: text });
  assert.deepEqual(promptChangeOverLimit(change(longText(limit + 3)), GUIDANCE_DEFAULTS), { length: limit + 3, limit });
  assert.equal(promptChangeOverLimit(change(longText(limit)), GUIDANCE_DEFAULTS), null);
  assert.equal(promptChangeOverLimit(change(""), GUIDANCE_DEFAULTS), null, "clearing back to the default");
  const rootChange = { id: "c2", area: "details", kind: "field", path: ["prompts", "leader", "tone"], from: "", to: longText(guidanceCharLimit(GUIDANCE_DEFAULTS.leader.tone) + 1) };
  assert.ok(promptChangeOverLimit(rootChange, GUIDANCE_DEFAULTS));
  const details = { scenario: {}, data: { prompts: {} } };
  assert.equal(buildDetailSave([change(longText(limit + 3))], details, { guidanceDefaults: GUIDANCE_DEFAULTS }).patch.prompts, undefined);
  assert.equal(buildDetailSave([change(longText(limit))], details, { guidanceDefaults: GUIDANCE_DEFAULTS }).patch.prompts.guidance.tasks.placeFeed.voices, longText(limit));
});

test("the translated lengths are current, and merge without losing a line", () => {
  const expected = new Map();
  const walk = (node) => {
    if (typeof node === "string") {
      let longest = 0;
      for (const [, pack] of PACKS) if (typeof pack[node] === "string" && pack[node].trim()) longest = Math.max(longest, promptCharCount(pack[node]));
      if (longest > promptCharCount(node)) expected.set(guidanceFingerprint(node), longest);
    } else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(GUIDANCE_DEFAULTS);
  assert.deepEqual(
    [...TRANSLATED_GUIDANCE_LENGTHS].sort(),
    [...expected].sort(),
    "stale: run node scripts/prompts/record-shipped-guidance.mjs",
  );
  const list = readFileSync(new URL("./guidanceLengths.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const body = list.slice(list.indexOf("const LENGTHS = [\n") + "const LENGTHS = [\n".length, list.indexOf("\n];"));
  assert.deepEqual(body.split("\n").filter((line) => line.trim() && !/^ {2}\["[0-9a-z]+", \d+\],$/.test(line)), [], "one entry per line");
  const attributes = readFileSync(new URL("../../../.gitattributes", import.meta.url), "utf8");
  assert.match(attributes, /^src\/Game\/AI\/guidanceLengths\.js\s+merge=union\s*$/m);
});
