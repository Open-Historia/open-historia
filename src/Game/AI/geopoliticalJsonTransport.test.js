import assert from "node:assert/strict";
import test from "node:test";
import { parseGeopoliticalArrayText } from "./geopoliticalJsonTransport.js";

test("geopolitical transport returns a well-formed JSON array unchanged", () => {
  assert.deepEqual(parseGeopoliticalArrayText('[{"polityKey":"A","strategicWeight":80}]'), [
    { polityKey: "A", strategicWeight: 80 },
  ]);
});

test("geopolitical transport salvages a complete array followed by provider commentary", () => {
  const raw = '[{"polityKey":"A","strategicWeight":80},{"polityKey":"B","strategicWeight":45}] Done.';
  assert.equal(parseGeopoliticalArrayText(raw).length, 2);
});

test("geopolitical transport salvages fenced arrays", () => {
  const raw = '```json\n[{"polityKey":"A","note":"regional [anchor]"}]\n```';
  assert.deepEqual(parseGeopoliticalArrayText(raw), [{ polityKey: "A", note: "regional [anchor]" }]);
});

test("geopolitical transport is string-aware while finding the first intact array", () => {
  const raw = 'Calibration follows: [{"polityKey":"A","note":"Use [sea] access and \\\"quoted\\\" leverage"}] trailing prose';
  assert.deepEqual(parseGeopoliticalArrayText(raw), [
    { polityKey: "A", note: 'Use [sea] access and "quoted" leverage' },
  ]);
});

test("geopolitical transport uses the first intact array when a provider appends another JSON value", () => {
  const raw = '[{"polityKey":"A"}] {"comment":"extra"} [{"polityKey":"B"}]';
  assert.deepEqual(parseGeopoliticalArrayText(raw), [{ polityKey: "A" }]);
});

test("geopolitical transport rejects objects when an array is required", () => {
  assert.throws(() => parseGeopoliticalArrayText('{"polityKey":"A"}'), /one complete JSON array/);
});

test("geopolitical transport never closes or accepts a truncated array", () => {
  assert.throws(
    () => parseGeopoliticalArrayText('[{"polityKey":"A"},{"polityKey":"B"}'),
    /one complete JSON array/,
  );
});

test("geopolitical transport can salvage a singleton object only when explicitly allowed", () => {
  assert.deepEqual(
    parseGeopoliticalArrayText('{"polityKey":"Western Sahara","strategicWeight":12}', { allowSingletonObject: true }),
    [{ polityKey: "Western Sahara", strategicWeight: 12 }],
  );
});

test("geopolitical transport accepts a provider-returned object value for an explicit singleton request", () => {
  assert.deepEqual(
    parseGeopoliticalArrayText({ polityKey: "Western Sahara", strategicWeight: 12 }, { allowSingletonObject: true }),
    [{ polityKey: "Western Sahara", strategicWeight: 12 }],
  );
});

test("geopolitical transport salvages a singleton object followed by provider commentary", () => {
  assert.deepEqual(
    parseGeopoliticalArrayText('{"polityKey":"Western Sahara","strategicWeight":12} Done.', { allowSingletonObject: true }),
    [{ polityKey: "Western Sahara", strategicWeight: 12 }],
  );
});

test("singleton-object salvage never accepts an object embedded in a truncated array", () => {
  assert.throws(
    () => parseGeopoliticalArrayText('[{"polityKey":"Western Sahara","strategicWeight":12}', { allowSingletonObject: true }),
    /one complete JSON array/,
  );
});
