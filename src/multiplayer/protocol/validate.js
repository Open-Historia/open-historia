/*! Open Historia — strict message validation for multiplayer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Nothing another machine sends is trusted: not its shape, not its sizes, not
// its keys. Every message is parsed with safeParse and then checked against a
// schema that says exactly what may be there. Objects are closed (a key the
// schema does not name makes the message invalid), strings, numbers and lists
// are bounded, and what comes out is a fresh copy holding only what was
// checked, so nothing unvalidated can ride along into the game's state. An
// invalid message is dropped by the caller; the reason is for the log only.
//
// Schema nodes are plain objects:
//   { type: "string", max, min?, pattern?, enum? }
//   { type: "integer", min, max }        whole numbers only
//   { type: "number", min, max }         finite only
//   { type: "boolean" }
//   { type: "literal", value }
//   { type: "array", items, max, min? }
//   { type: "object", props: {…}, optional?: [names] }
//   { type: "record", keys: <string node>, values, max }
//   { type: "union", tag: "t", variants: { name: <object node> } }
//   { type: "json", maxDepth }           any JSON value, copied (see below)
// and any node may add nullable: true.
//
// "json" is for what only the host sends: a player's view of the world is a
// large document the game's own normalizers check when it is read, and writing
// a closed schema for all of it would duplicate them. It is still a fresh copy
// of plain JSON, bounded in depth, with no prototype keys: never trusted blind.
//
// Import-free, so node tests and every runtime use the same checks.

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

class Invalid extends Error {}
const invalid = (path, reason) => {
  throw new Invalid(`${path || "$"}: ${reason}`);
};

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const checkString = (node, value, path) => {
  if (typeof value !== "string") invalid(path, "expected a string");
  if (value.length > node.max) invalid(path, `longer than ${node.max}`);
  if (value.length < (node.min ?? 0)) invalid(path, `shorter than ${node.min}`);
  if (node.pattern && !node.pattern.test(value)) invalid(path, "does not match its pattern");
  if (node.enum && !node.enum.includes(value)) invalid(path, "not an allowed value");
  return value;
};

// A deep copy of plain JSON: strings, finite numbers, booleans, null, lists
// and plain objects, nothing else, no prototype keys, no deeper than asked.
const copyJson = (value, path, maxDepth, depth) => {
  if (depth > maxDepth) invalid(path, `nested deeper than ${maxDepth}`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(path, "not a finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => copyJson(item, `${path}[${index}]`, maxDepth, depth + 1));
  if (!isPlainObject(value)) invalid(path, "not plain JSON");
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) invalid(path, "forbidden key");
    out[key] = copyJson(item, path, maxDepth, depth + 1);
  }
  return out;
};

const check = (node, value, path) => {
  if (value === null && node.nullable) return null;
  switch (node.type) {
    case "string":
      return checkString(node, value, path);
    case "integer":
      if (!Number.isInteger(value)) invalid(path, "expected a whole number");
      if (value < node.min || value > node.max) invalid(path, `outside ${node.min}..${node.max}`);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "expected a finite number");
      if (value < node.min || value > node.max) invalid(path, `outside ${node.min}..${node.max}`);
      return value;
    case "boolean":
      if (typeof value !== "boolean") invalid(path, "expected true or false");
      return value;
    case "literal":
      if (value !== node.value) invalid(path, `expected ${JSON.stringify(node.value)}`);
      return value;
    case "array": {
      if (!Array.isArray(value)) invalid(path, "expected a list");
      if (value.length > node.max) invalid(path, `more than ${node.max} items`);
      if (value.length < (node.min ?? 0)) invalid(path, `fewer than ${node.min} items`);
      return value.map((item, index) => check(node.items, item, `${path}[${index}]`));
    }
    case "object": {
      if (!isPlainObject(value)) invalid(path, "expected an object");
      const optional = new Set(node.optional ?? []);
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(node.props, key)) invalid(path, `unexpected key "${key.slice(0, 40)}"`);
      }
      const out = {};
      for (const [key, child] of Object.entries(node.props)) {
        if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
          if (optional.has(key)) continue;
          invalid(`${path}.${key}`, "missing");
        }
        out[key] = check(child, value[key], `${path}.${key}`);
      }
      return out;
    }
    case "record": {
      if (!isPlainObject(value)) invalid(path, "expected an object");
      const entries = Object.entries(value);
      if (entries.length > node.max) invalid(path, `more than ${node.max} entries`);
      // Keyed by what another machine chose, so it cannot inherit anything.
      const out = Object.create(null);
      for (const [key, item] of entries) {
        if (FORBIDDEN_KEYS.has(key)) invalid(path, "forbidden key");
        checkString(node.keys, key, `${path}{key}`);
        out[key] = check(node.values, item, `${path}.${key.slice(0, 40)}`);
      }
      return out;
    }
    case "union": {
      if (!isPlainObject(value)) invalid(path, "expected an object");
      const tag = value[node.tag];
      if (typeof tag !== "string" || !Object.prototype.hasOwnProperty.call(node.variants, tag)) {
        invalid(`${path}.${node.tag}`, "unknown kind");
      }
      return check(node.variants[tag], value, path);
    }
    case "json":
      return copyJson(value, path, node.maxDepth ?? 64, 0);
    default:
      throw new TypeError(`Unknown schema node type "${node?.type}".`);
  }
};

// { ok: true, value } with a checked copy, or { ok: false, error }.
export const validate = (schema, value) => {
  try {
    return { ok: true, value: check(schema, value, "$") };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
};

// Nesting depth of JSON text, counted before JSON.parse ever sees it: deep
// enough nesting throws (or stalls) a parser, and no message needs much.
const nestingDepth = (text, limit) => {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index);
    if (inString) {
      if (char === 92) index += 1; // backslash: skip what it escapes
      else if (char === 34) inString = false;
      continue;
    }
    if (char === 34) inString = true;
    else if (char === 123 || char === 91) {
      depth += 1;
      if (depth > deepest) deepest = depth;
      if (deepest > limit) return deepest;
    } else if (char === 125 || char === 93) depth -= 1;
  }
  return deepest;
};

// JSON from another machine: bounded in size and depth, and refusing the keys
// that reach an object's prototype (__proto__, constructor, prototype) outright
// rather than trusting every later merge to be careful with them.
export const safeParse = (text, { maxLength = 64 * 1024, maxDepth = 32 } = {}) => {
  if (typeof text !== "string") return { ok: false, error: "not text" };
  if (text.length > maxLength) return { ok: false, error: `longer than ${maxLength}` };
  if (nestingDepth(text, maxDepth) > maxDepth) return { ok: false, error: `nested deeper than ${maxDepth}` };
  try {
    return {
      ok: true,
      value: JSON.parse(text, (key, value) => {
        if (FORBIDDEN_KEYS.has(key)) throw new Invalid(`forbidden key "${key}"`);
        return value;
      }),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Invalid ? error.message : "not JSON" };
  }
};

// Shorthands for writing schemas.
export const str = (max, extra = {}) => ({ type: "string", max, ...extra });
export const int = (min, max, extra = {}) => ({ type: "integer", min, max, ...extra });
export const num = (min, max, extra = {}) => ({ type: "number", min, max, ...extra });
export const bool = (extra = {}) => ({ type: "boolean", ...extra });
export const literal = (value) => ({ type: "literal", value });
export const list = (items, max, extra = {}) => ({ type: "array", items, max, ...extra });
export const obj = (props, optional = []) => ({ type: "object", props, optional });
export const record = (keys, values, max) => ({ type: "record", keys, values, max });
export const union = (tag, variants) => ({ type: "union", tag, variants });
export const json = (maxDepth = 64, extra = {}) => ({ type: "json", maxDepth, ...extra });

// Common value shapes on the wire.
export const HEX_ID = (bytes) => str(bytes * 2, { min: bytes * 2, pattern: /^[0-9a-f]+$/ });
export const B64URL = (bytes) => {
  const length = Math.ceil((bytes * 4) / 3);
  return str(length, { min: length, pattern: /^[A-Za-z0-9_-]+$/ });
};
// A name a person typed: no control characters (C0 or C1), bounded.
export const NAME = (max) => str(max, { min: 1, pattern: /^\P{Cc}+$/u });
