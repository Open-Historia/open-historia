/*! Open Historia — interface string extraction tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/i18nExtraction.test.js
//
// The shipped language packs are only as complete as the catalog they
// translate, and the catalog is read out of the source (scripts/i18n/
// extractStrings.mjs). These pin that it reads strings the way the game renders
// them, so the translator (translator.js, phraseBook.js) finds them again.

import test from "node:test";
import assert from "node:assert/strict";

import { cleanJsxText, extractFromSource } from "../../scripts/i18n/extractStrings.mjs";

const extract = (code) => {
  const result = extractFromSource(code, "src/Game/GameUI/probe.jsx", {});
  assert.equal(result.error, undefined);
  return { exact: [...result.exact.keys()], patterns: [...result.patterns.keys()] };
};

test("JSX text is read with React's whitespace rules", () => {
  assert.equal(cleanJsxText("\n   Hello   world\n   again  \n"), "Hello   world again");
  const { exact } = extract("export const A = () => <h2>\n    Save the\n    game\n  </h2>;");
  assert.deepEqual(exact, ["Save the game"]);
});

test("text around values is one pattern, and each piece on its own", () => {
  const { exact, patterns } = extract("export const A = ({ count }) => <p>Found {count} regions</p>;");
  assert.deepEqual(patterns, ["Found {{count}} regions"]);
  assert.deepEqual(exact, ["Found", "regions"], "a piece is what the DOM holds when the run is broken by an element");
});

test("a choice of strings becomes each variant, never a suffix slot", () => {
  const glued = extract("export const A = ({ n }) => <span>{n} game{n === 1 ? \"\" : \"s\"} saved</span>;");
  assert.deepEqual(glued.patterns.sort(), ["{{n}} game saved", "{{n}} games saved"]);
  const spaced = extract("export const A = ({ n }) => <span>{n} {n === 1 ? \"event\" : \"events\"}</span>;");
  assert.deepEqual(spaced.patterns.sort(), ["{{n}} event", "{{n}} events"]);
  const template = extract("export const A = ({ n }) => <b title={`${n} unit${n === 1 ? \"\" : \"s\"} left`}>x</b>;");
  assert.deepEqual(template.patterns.sort(), ["{{n}} unit left", "{{n}} units left"]);
  const optional = extract("export const A = ({ n, many }) => <i>{n} region{many && \"s\"} claimed</i>;");
  assert.deepEqual(optional.patterns.sort(), ["{{n}} region claimed", "{{n}} regions claimed"]);
});

test("a branch that is a template of its own expands too", () => {
  const { patterns, exact } = extract("export const A = ({ n }) => <b title={`Agenda${n ? ` (${n})` : \"\"}`}>x</b>;");
  assert.deepEqual(patterns, ["Agenda ({{n}})"]);
  assert.deepEqual(exact, ["Agenda"]);
});

test("constants named for display text are read, wherever they are", () => {
  const result = extractFromSource(
    "export const MODE_LABELS = { auto: \"Automatic (recommended)\", tool: \"Tool calling\" };\n" +
    "export const MODE_INTRO = \"How the game asks your AI \" + \"for answers it can read.\";\n" +
    "export const MODE_KEYS = [\"auto\", \"tool\"];\n" +
    "const GENERATED_OP_NOTES = { a: \"party fields MUST be nested under party\" };",
    "src/Game/AI/structuredMode.js",
    { jsx: false, catchAll: false },
  );
  assert.deepEqual([...result.exact.keys()].sort(), ["Automatic (recommended)", "How the game asks your AI for answers it can read.", "Tool calling"]);
});

test("a message module's returned and thrown prose is read", () => {
  const code = "export const why = (m) => { if (!m) throw new Error(`No model in your list can answer. Fix it in Settings.`); return `${m.label} is busy right now.`; };\n" +
    "export const code = () => { return \"rate_limit\"; };";
  const withMessages = extractFromSource(code, "src/Game/AI/fallbackRunner.js", { jsx: false, catchAll: false, messages: true });
  assert.deepEqual([...withMessages.exact.keys()], ["No model in your list can answer. Fix it in Settings."]);
  assert.deepEqual([...withMessages.patterns.keys()], ["{{label}} is busy right now."]);
  const without = extractFromSource(code, "src/Game/AI/gameplay.js", { jsx: false, catchAll: false });
  assert.equal(without.exact.size + without.patterns.size, 0, "other AI modules are prompts and parsers");
});

test("the attributes the translator touches are read, templates as patterns", () => {
  const { exact, patterns } = extract(
    "export const A = ({ name }) => <button title=\"Close the panel\" aria-label={`Close ${name}`} className=\"oh-tap close-button\">✕</button>;",
  );
  assert.deepEqual(exact, ["Close the panel"]);
  assert.deepEqual(patterns, ["Close {{name}}"]);
});

test("text marked data-no-translate is skipped, as the runtime skips it", () => {
  const { exact } = extract("export const A = ({ name }) => <div><span data-no-translate>Secret words here</span><span>Visible words</span></div>;");
  assert.deepEqual(exact, ["Visible words"]);
});

test("a conditional opt-out, and an opted-out element's handlers, still yield text", () => {
  const { exact, patterns } = extract(
    "export const A = ({ isPlayer, v }) => <div>\n" +
    "  <div data-no-translate={isPlayer ? \"\" : undefined}>The chart could not be drawn: {v}.</div>\n" +
    "  <input data-no-translate title=\"Its own title\" onBlur={() => setStatus(`Daily limit set to ${v}.`)} />\n" +
    "</div>;",
  );
  assert.deepEqual(exact, ["The chart could not be drawn:"]);
  assert.deepEqual(patterns.sort(), ["Daily limit set to {{v}}.", "The chart could not be drawn: {{v}}."]);
});

test("technical strings are not interface text", () => {
  const { exact, patterns } = extract(
    "export const A = () => <div className=\"oh-tap row\" style={{ color: \"dark red\" }} onClick={() => fetch(\"/api/games\")}>Real label</div>;",
  );
  assert.deepEqual(exact, ["Real label"]);
  assert.deepEqual(patterns, []);
});

test("tab lists and status messages are read", () => {
  const { exact, patterns } = extract(
    "const TABS = [[\"map\", \"World map\"], [\"stats\", \"Statistics\"]];\n" +
    "export const A = ({ file }) => { setStatus(`Saved ${file}.`); return null; };",
  );
  assert.deepEqual(exact.sort(), ["Statistics", "World map"]);
  assert.deepEqual(patterns, ["Saved {{file}}."]);
});
