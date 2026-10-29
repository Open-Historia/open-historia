import fs from "node:fs";
import path from "node:path";

const OUT = process.env.GOLDEN_OUT;
const FIRST = 30;
const PER_PROCESS = 150;
const NODES_MOST = 400000;
const CALLS_MOST = 4000;
const RESULT_CALLS_MOST = 60;
const CASE_BYTES_MOST = 270000;
const PROCESS_BYTES_MOST = 1500000;
const TOO_BIG = Symbol("too big");
const made = new WeakMap();
const methodsWrapped = new WeakSet();
const store = new Map();
let busy = 0;

const TYPED = [
  ["U8", Uint8Array], ["U8C", Uint8ClampedArray], ["I8", Int8Array], ["U16", Uint16Array], ["I16", Int16Array],
  ["U32", Uint32Array], ["I32", Int32Array], ["F32", Float32Array], ["F64", Float64Array],
];

const lone = (text) => {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(at + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        at += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
};

const number = (value) => {
  if (Number.isNaN(value)) return { $: "NaN" };
  if (value === Infinity) return { $: "Inf" };
  if (value === -Infinity) return { $: "-Inf" };
  if (Object.is(value, -0)) return { $: "-0" };
  return value;
};

const packTyped = (tag, value) => {
  if (value.length < 48) return { $: tag, v: Array.from(value, number) };
  const runs = [];
  for (let at = 0; at < value.length && runs.length <= value.length / 2; ) {
    let end = at + 1;
    while (end < value.length && Object.is(value[end], value[at])) end += 1;
    runs.push(number(value[at]), end - at);
    at = end;
  }
  if (runs.length <= value.length / 2) return { $: tag, r: runs };
  return { $: tag, b: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
};

const encoder = (hooks) => {
  let nodes = 0;
  const stack = new Set();
  const enc = (value, where) => {
    nodes += 1;
    if (nodes > NODES_MOST) throw TOO_BIG;
    switch (typeof value) {
      case "undefined": return { $: "u" };
      case "number": return number(value);
      case "boolean": return value;
      case "string": return lone(value) ? { $: "S16", v: Array.from({ length: value.length }, (_, at) => value.charCodeAt(at)) } : value;
      case "function": return hooks?.fn ? hooks.fn(value, where) : { $: "fn" };
      case "bigint":
      case "symbol": throw TOO_BIG;
      default: break;
    }
    if (value === null) return null;
    if (stack.has(value)) return { $: "cyc" };
    if (ArrayBuffer.isView(value)) {
      const kind = TYPED.find(([, Type]) => value instanceof Type);
      if (!kind) throw TOO_BIG;
      nodes += value.length;
      if (nodes > NODES_MOST) throw TOO_BIG;
      return packTyped(kind[0], value);
    }
    stack.add(value);
    try {
      if (Array.isArray(value)) {
        const list = [];
        for (let at = 0; at < value.length; at += 1) list.push(enc(value[at], where === null ? null : [...where, at]));
        return list;
      }
      if (value instanceof Map) return { $: "Map", v: [...value].map(([key, item]) => [enc(key, null), enc(item, null)]) };
      if (value instanceof Set) return { $: "Set", v: [...value].map((item) => enc(item, null)) };
      const out = {};
      for (const key of Object.keys(value)) out[key] = enc(value[key], where === null ? null : [...where, key]);
      const by = made.get(value);
      if (by) return { $: "made", by: by.name, a: by.args, v: out };
      if (Object.hasOwn(out, "$")) return { $: "O", v: out };
      return out;
    } finally {
      stack.delete(value);
    }
  };
  return (value, where = null) => enc(value, where);
};

export const encode = (value) => encoder(null)(value);

const entryOf = (key) => {
  let entry = store.get(key);
  if (!entry) {
    entry = { calls: 0, next: 0, bytes: 0, cases: [] };
    store.set(key, entry);
  }
  return entry;
};

const patchCallbacks = (args, sink) => {
  const undo = [];
  const visit = (value, where, depth) => {
    if (!value || typeof value !== "object" || depth > 2 || ArrayBuffer.isView(value) || made.has(value)) return;
    if (Array.isArray(value) || value instanceof Map || value instanceof Set) return;
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item && typeof item === "object" && depth < 1) visit(item, [...where, key], depth + 1);
      if (typeof item !== "function") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.writable || !descriptor.configurable || Object.isFrozen(value)) continue;
      const name = [...where, key].join(".");
      const calls = [];
      sink[name] = calls;
      const original = item;
      value[key] = function recorded(...inner) {
        const result = original.apply(this, inner);
        if (calls.length < CALLS_MOST) {
          try {
            calls.push([encode(inner), encode(result)]);
          } catch {
            calls.length = CALLS_MOST;
          }
        } else calls.overflow = true;
        return result;
      };
      undo.push(() => {
        value[key] = original;
      });
    }
  };
  args.forEach((value, at) => visit(value, [at], 0));
  return () => undo.forEach((step) => step());
};

const wrapCallbackArgs = (args, sink) => args.map((value, at) => {
  if (typeof value !== "function") return value;
  const calls = [];
  sink[String(at)] = calls;
  return function recorded(...inner) {
    const result = value.apply(this, inner);
    if (calls.length < CALLS_MOST) {
      try {
        calls.push([encode(inner), encode(result)]);
      } catch {
        calls.length = CALLS_MOST;
      }
    } else calls.overflow = true;
    return result;
  };
});

const picked = (value, spec, enc) => {
  if (spec === 1 || !value || typeof value !== "object" || ArrayBuffer.isView(value)) return enc(value);
  if (Array.isArray(value)) return spec["*"] ? value.map((item) => picked(item, spec["*"], enc)) : enc(value);
  if (value instanceof Map) return spec["*"] ? { $: "Map", v: [...value].map(([key, item]) => [enc(key), picked(item, spec["*"], enc)]) } : enc(value);
  if (value instanceof Set) return enc(value);
  const out = {};
  for (const key of Object.keys(spec)) if (key !== "*" && Object.hasOwn(value, key)) out[key] = picked(value[key], spec[key], enc);
  return out;
};

const encodeArgs = (args, picks) => {
  if (!picks) return encode(args);
  const enc = encoder(null);
  return args.map((value, at) => (picks[at] ? picked(value, picks[at], enc) : enc(value)));
};

export const wrap = (moduleName, name, fn, factories, picks = null) => {
  if (typeof fn !== "function") return fn;
  const key = `${moduleName}.${name}`;
  const factory = factories.includes(name);
  const wrapped = function golden(...args) {
    const entry = entryOf(key);
    entry.calls += 1;
    const take = busy === 0 && entry.cases.length < PER_PROCESS && entry.bytes < PROCESS_BYTES_MOST && entry.calls > entry.next;
    if (!take) {
      const result = fn.apply(this, args);
      if (factory && result && typeof result === "object" && !made.has(result)) {
        let small = null;
        try {
          small = encode(args);
          if (JSON.stringify(small).length > 4000) small = null;
        } catch {
          small = null;
        }
        made.set(result, { name: key, args: small });
      }
      return result;
    }
    entry.next = entry.calls < FIRST ? entry.calls : entry.calls + Math.max(1, Math.floor(entry.calls / 15));
    let before = null;
    let beforeText = "";
    busy += 1;
    try {
      before = encodeArgs(args, picks);
      beforeText = JSON.stringify(before);
    } catch {
      before = null;
    } finally {
      busy -= 1;
    }
    const calls = {};
    const restore = before ? patchCallbacks(args, calls) : () => {};
    const passed = before ? wrapCallbackArgs(args, calls) : args;
    let result;
    try {
      result = fn.apply(this, passed);
    } catch (error) {
      restore();
      if (before) entry.cases.push({ a: before, x: String(error?.message ?? error) });
      throw error;
    }
    restore();
    if (factory && result && typeof result === "object" && !made.has(result)) {
      made.set(result, { name: key, args: beforeText.length <= 4000 ? before : null });
    }
    if (!before) return result;
    busy += 1;
    try {
      const out = { a: before, r: encode(result) };
      const after = encodeArgs(args, picks);
      if (JSON.stringify(after) !== beforeText) out.aa = after;
      const names = Object.keys(calls);
      if (names.some((callName) => calls[callName].overflow || calls[callName].length >= CALLS_MOST)) return result;
      if (names.length) out.cb = calls;
      const size = JSON.stringify(out).length;
      if (size > CASE_BYTES_MOST) return result;
      entry.bytes += size;
      entry.cases.push(out);
      if (typeof result === "function") {
        const inner = result;
        const rc = [];
        out.rc = rc;
        result = function recorded(...values) {
          const value = inner.apply(this, values);
          if (rc.length < RESULT_CALLS_MOST) {
            try {
              rc.push([encode(values), encode(value)]);
            } catch {
              rc.length = rc.length;
            }
          }
          return value;
        };
      } else if (factory && result && typeof result === "object" && !methodsWrapped.has(result)) {
        methodsWrapped.add(result);
        const mc = {};
        for (const key of Object.keys(result)) {
          const method = result[key];
          const descriptor = Object.getOwnPropertyDescriptor(result, key);
          if (typeof method !== "function" || !descriptor?.writable || Object.isFrozen(result)) continue;
          const list = [];
          mc[key] = list;
          result[key] = function recorded(...values) {
            const value = method.apply(this, values);
            if (list.length < RESULT_CALLS_MOST) {
              try {
                list.push([encode(values), encode(value)]);
              } catch {
                list.length = list.length;
              }
            }
            return value;
          };
        }
        if (Object.keys(mc).length) out.mc = mc;
      }
    } catch {
      entry.cases.length = entry.cases.length;
    } finally {
      busy -= 1;
    }
    return result;
  };
  return wrapped;
};

process.on("exit", () => {
  if (!OUT || store.size === 0) return;
  const cases = {};
  for (const [key, entry] of store) if (entry.cases.length) cases[key] = entry.cases;
  const source = process.argv.slice(1).map((part) => path.basename(part)).join(" ");
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${process.pid}-${Date.now()}.json`), JSON.stringify({ source, cases }));
});
