/*! Open Historia — strict multiplayer validation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/protocol/validate.test.js
//
// What another machine sends is hostile until checked. These throw at the
// validator and the parser what a modified client could: extra keys, the keys
// that reach a prototype, huge lists, deep nesting, wrong kinds, out-of-range
// numbers, and make sure every one is refused and nothing leaks through.

import test from "node:test";
import assert from "node:assert/strict";
import { B64URL, HEX_ID, NAME, bool, int, json, list, literal, obj, record, safeParse, str, union, validate } from "./validate.js";

const hello = obj({
  t: literal("hello"),
  name: NAME(40),
  session: HEX_ID(16),
  device: B64URL(32),
  ready: bool(),
  seats: int(0, 64),
  tags: list(str(20), 4),
  note: str(100, { nullable: true }),
}, ["tags", "note"]);

const good = {
  t: "hello",
  name: "Arkniem",
  session: "0123456789abcdef0123456789abcdef",
  device: "A".repeat(43),
  ready: true,
  seats: 8,
};

test("a well-formed message passes, and comes out as a fresh copy", () => {
  const result = validate(hello, good);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, good);
  assert.notEqual(result.value, good);
});

test("closed objects: an extra key refuses the whole message", () => {
  const result = validate(hello, { ...good, isHost: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /unexpected key "isHost"/);
});

test("missing, mistyped and out-of-range values are refused", () => {
  for (const [bad, pattern] of [
    [{ ...good, name: undefined }, /\.name: missing/],
    [{ ...good, seats: 65 }, /outside 0\.\.64/],
    [{ ...good, seats: 2.5 }, /whole number/],
    [{ ...good, ready: "yes" }, /true or false/],
    [{ ...good, session: "XYZ" }, /shorter than|pattern/],
    [{ ...good, name: "bad\u0007name" }, /pattern/],
    [{ ...good, name: "x".repeat(41) }, /longer than 40/],
    [{ ...good, tags: Array(5).fill("a") }, /more than 4 items/],
    [{ ...good, t: "welcome" }, /expected "hello"/],
    [{ ...good, seats: Number.NaN }, /whole number/],
  ]) {
    const result = validate(hello, bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.match(result.error, pattern);
  }
});

test("nullable and optional behave as declared", () => {
  assert.equal(validate(hello, { ...good, note: null }).ok, true);
  assert.equal(validate(hello, { ...good, tags: ["x"] }).ok, true);
  assert.equal(validate(obj({ a: str(3) }), { a: null }).ok, false);
});

test("a union picks its variant by tag and refuses unknown kinds", () => {
  const message = union("t", {
    ping: obj({ t: literal("ping"), n: int(0, 1e9) }),
    hello,
  });
  assert.equal(validate(message, { t: "ping", n: 3 }).ok, true);
  assert.equal(validate(message, good).ok, true);
  const unknown = validate(message, { t: "admin", n: 1 });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /unknown kind/);
  assert.equal(validate(message, { t: "toString" }).ok, false);
  assert.equal(validate(message, { t: "__proto__" }).ok, false);
});

test("records are keyed by bounded strings, never by prototype keys, and inherit nothing", () => {
  const scores = record(str(20, { min: 1 }), int(0, 100), 3);
  const ok = validate(scores, { France: 3, Spain: 4 });
  assert.equal(ok.ok, true);
  assert.equal(Object.getPrototypeOf(ok.value), null);
  assert.equal(validate(scores, { a: 1, b: 2, c: 3, d: 4 }).ok, false);
  assert.equal(validate(scores, JSON.parse('{"constructor": 1}')).ok, false);
});

test("safeParse refuses the keys that reach a prototype, anywhere in the text", () => {
  for (const text of [
    '{"__proto__": {"isAdmin": true}}',
    '{"a": [{"b": {"constructor": {"prototype": {"x": 1}}}}]}',
    '{"prototype": 1}',
  ]) {
    const result = safeParse(text);
    assert.equal(result.ok, false, text);
    assert.match(result.error, /forbidden key/);
  }
  assert.equal({}.isAdmin, undefined);
});

test("safeParse refuses oversize and deeply nested text before parsing it", () => {
  assert.match(safeParse("x".repeat(70_000)).error, /longer than/);
  assert.match(safeParse(`${"[".repeat(40)}${"]".repeat(40)}`).error, /nested deeper/);
  // Brackets inside strings are not nesting.
  assert.equal(safeParse(JSON.stringify({ text: "[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[" })).ok, true);
  assert.equal(safeParse('{"a": "\\"[[[["}').ok, true);
  assert.equal(safeParse("{not json").ok, false);
  assert.equal(safeParse(42).ok, false);
});

test("json copies plain JSON, bounded, and refuses anything else", () => {
  const view = obj({ t: literal("view"), docs: json(6) });
  const docs = { world: { units: [{ id: "u1", lng: 1.5 }], notes: null }, events: [] };
  const result = validate(view, { t: "view", docs });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.docs, docs);
  assert.notEqual(result.value.docs.world, docs.world);
  assert.equal(validate(view, { t: "view", docs: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } }).ok, false);
  assert.equal(validate(view, { t: "view", docs: JSON.parse('{"x":{"__proto__":{"y":1}}}') }).ok, false);
  assert.equal(validate(view, { t: "view", docs: { f: () => 1 } }).ok, false);
  assert.equal(validate(view, { t: "view", docs: { n: Infinity } }).ok, false);
  assert.equal(validate(view, { t: "view", docs: new Date() }).ok, false);
});

test("a hostile payload fuzz never throws and never passes", () => {
  const hostile = [
    null, 0, "", [], {}, "__proto__", { t: null }, { t: ["hello"] }, { t: "hello", ...{ ["__proto__"]: 1 } },
    Object.create({ t: "hello" }), new Map([["t", "hello"]]), { t: "hello", name: { toString: () => "x" } },
    { ...good, device: "A".repeat(44) }, { ...good, session: "0".repeat(1e6) },
  ];
  for (const value of hostile) {
    let result;
    assert.doesNotThrow(() => { result = validate(hello, value); });
    assert.equal(result.ok, false, String(value));
  }
});
