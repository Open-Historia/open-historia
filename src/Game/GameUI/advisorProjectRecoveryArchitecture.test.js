/*! Open Historia - Advisor project-recovery UI contract (AGPL-3.0-or-later). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./advisor.jsx", import.meta.url), "utf8");

test("the Projects recovery composer request is scoped to failed operations, not general history", () => {
  const match = source.match(/const RETRY_PROJECTS_TEXT = "([^"]+)";/);
  assert.ok(match, "the retry prompt must be a localized static string");
  const request = match[1];
  assert.match(request, /specific Project operations missing/i);
  assert.match(request, /malformed or incomplete/i);
  assert.match(request, /not a request to backfill history/i);
  assert.match(request, /Skip entries already on the board/i);
  assert.match(request, /cannot identify exactly what was missed, tell me and add nothing/i);
  assert.doesNotMatch(request, /last reply was cut off|genuinely appear in our history/i);
  assert.match(source, /setInput\(uiString\(RETRY_PROJECTS_TEXT\)\)/);
});

test("only the newest problematic Advisor reply may invite another Projects recovery request", () => {
  // Silent group markers stay hidden. A synthetic all-pass status is visible,
  // but cannot steal the newest recoverable-reply index.
  assert.match(source, /msg\.silent === true \? \[\] : \[\{ msg, i \}\]/);
  assert.match(source, /silentTurnEnds\.has\(i\)/);
  assert.match(source, /const visibleLastIndex = visibleRows\.findLast\(\(\{ msg \}\) => msg\.role !== "group-pass"\)\?\.i/);
  assert.match(
    source,
    /onRetryProjects=\{i === visibleLastIndex && msg\.projectsProblem \? onRetryProjects : undefined\}/,
  );
  assert.match(source, /\{onRetry && \(/, "no retry control when handler is absent");
  assert.match(source, /Retry missing entries/);
  assert.match(source, /React\.memo\(/, "preserve memoized Advisor message rows");
});
