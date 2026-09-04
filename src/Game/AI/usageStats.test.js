// Runs in a BARE CHECKOUT: usageStats.js is import-free on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import { createFirstByteTimer, normalizeUsage } from "./usageStats.js";

test("Gemini's usageMetadata is read, and thinking tokens count as output", () => {
  // A reasoning model spends most of its output budget on thoughts, which are
  // billed as output but reported separately. Leaving them out would make a
  // thinking call look cheaper than a non-thinking one.
  assert.deepEqual(
    normalizeUsage({
      usageMetadata: {
        promptTokenCount: 48000,
        candidatesTokenCount: 3200,
        thoughtsTokenCount: 5100,
        totalTokenCount: 56300,
      },
    }),
    { promptTokens: 48000, outputTokens: 8300, totalTokens: 56300, thinkingTokens: 5100 },
  );

  // No thinking: no thinkingTokens key at all, rather than a zero.
  assert.deepEqual(
    normalizeUsage({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 } }),
    { promptTokens: 100, outputTokens: 20, totalTokens: 120 },
  );
});

test("Anthropic's cache reads and writes are part of what the prompt cost", () => {
  // input_tokens EXCLUDES both cache figures, so the honest prompt cost is the
  // sum. This is the number Phase 5 has to move.
  assert.deepEqual(
    normalizeUsage({
      usage: {
        input_tokens: 1200,
        output_tokens: 900,
        cache_read_input_tokens: 40000,
        cache_creation_input_tokens: 0,
      },
    }),
    { promptTokens: 41200, outputTokens: 900, totalTokens: 42100, cachedTokens: 40000 },
  );

  assert.deepEqual(
    normalizeUsage({ usage: { input_tokens: 500, output_tokens: 60 } }),
    { promptTokens: 500, outputTokens: 60, totalTokens: 560 },
  );
});

test("the OpenAI shape is read, including a gateway that omits total_tokens", () => {
  assert.deepEqual(
    normalizeUsage({ usage: { prompt_tokens: 30000, completion_tokens: 2000, total_tokens: 32000 } }),
    { promptTokens: 30000, outputTokens: 2000, totalTokens: 32000 },
  );

  // llama.cpp and friends often send only the two counts.
  assert.deepEqual(
    normalizeUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    { promptTokens: 10, outputTokens: 5, totalTokens: 15 },
  );

  assert.deepEqual(
    normalizeUsage({
      usage: { prompt_tokens: 8000, completion_tokens: 100, total_tokens: 8100, prompt_tokens_details: { cached_tokens: 7680 } },
    }),
    { promptTokens: 8000, outputTokens: 100, totalTokens: 8100, cachedTokens: 7680 },
  );
});

// A row of zeroes reads like a measurement. Nothing reported must stay nothing.
test("a provider that reported nothing yields null, not a row of zeroes", () => {
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage(undefined), null);
  assert.equal(normalizeUsage({}), null);
  assert.equal(normalizeUsage({ usage: {} }), null);
  assert.equal(normalizeUsage({ usageMetadata: {} }), null);
  assert.equal(normalizeUsage("not an object"), null);
  assert.equal(normalizeUsage({ choices: [] }), null);
});

test("the first-byte timer records the first chunk and still forwards activity", () => {
  let forwarded = 0;
  const timer = createFirstByteTimer(() => { forwarded += 1; });

  // Nothing has arrived: not "instant", but unknown.
  assert.equal(timer.firstByteMs, null);

  timer.note();
  const first = timer.firstByteMs;
  assert.equal(typeof first, "number");
  assert.ok(first >= 0);
  assert.equal(forwarded, 1);

  // Later chunks keep feeding the idle watchdog but must not move TTFB.
  timer.note();
  timer.note();
  assert.equal(timer.firstByteMs, first);
  assert.equal(forwarded, 3);
});

test("the first-byte timer works with no wrapped callback", () => {
  const timer = createFirstByteTimer(undefined);
  assert.doesNotThrow(() => timer.note());
  assert.equal(typeof timer.firstByteMs, "number");
});
