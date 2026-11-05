import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// A player's log (2026-10-12): "This time skip used 2 requests." and nothing
// to say why. The reason a first answer was turned down was written only at
// the detailed level. gameplay.js does not load under bare node, so the task
// runner is read as source.
const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const task = gameplay.slice(gameplay.indexOf("const runJsonTask = async"));

const lineAt = (needle) => {
  const at = task.indexOf(needle);
  assert.notEqual(at, -1, `not found: ${needle}`);
  return task.slice(at, at + 900);
};

test("a first answer that could not be used is said in every log, with the reason", () => {
  const line = lineAt("the first answer could not be used (${validation.error}); asking once more.");
  assert.match(line, /\{ problem: true \}/);
  // What the answer was, in a line: how long, where it was read from, whether
  // the schema passed, and how it opens.
  for (const field of ["answerChars", "readFrom", "passedTheSchema", "opens"]) assert.match(line, new RegExp(field));
  // It stands where the second request is decided, and nowhere a retry is not made.
  const before = task.slice(0, task.indexOf("the first answer could not be used"));
  assert.match(before.slice(-400), /if \(outputAttempt === 1 && !controller\.signal\.aborted\) \{/);
});

test("a first request the provider refused is said in every log too", () => {
  const line = lineAt("the first request got no answer (the provider refused it); asking once more.");
  assert.match(line, /\{ problem: true \}/);
  assert.match(line, /provider: error\.providerRefusal\.detail/);
});
