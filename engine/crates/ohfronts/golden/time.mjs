import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const fixtures = process.env.GOLDEN_DIR ? path.resolve(process.env.GOLDEN_DIR) : path.join(here, "../tests/golden");
const { runFronts } = await import(pathToFileURL(path.join(root, "src/runtime/fronts/engine.js")).href);
const file = JSON.parse(fs.readFileSync(path.join(fixtures, "engine.json"), "utf8"));
const TYPED = { U8: Uint8Array, U8C: Uint8ClampedArray, I8: Int8Array, U16: Uint16Array, I16: Int16Array, U32: Uint32Array, I32: Int32Array, F32: Float32Array, F64: Float64Array };
const blobs = new Map();
const raw = (node) => (node && node.$ === "ref" ? raw(file.blobs[node.k]) : node);
const decode = (node, ids) => {
  if (Array.isArray(node)) return node.map((item) => decode(item, ids));
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ !== "string") return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, decode(value, ids)]));
  switch (node.$) {
    case "u": return undefined;
    case "NaN": return NaN;
    case "Inf": return Infinity;
    case "-Inf": return -Infinity;
    case "-0": return -0;
    case "fn": return () => undefined;
    case "cyc": return null;
    case "S16": return String.fromCharCode(...node.v);
    case "ref": {
      if (!blobs.has(node.k)) blobs.set(node.k, decode(file.blobs[node.k], ids));
      return blobs.get(node.k);
    }
    case "id": {
      const value = decode(node.v, ids);
      ids.set(node.n, value);
      return value;
    }
    case "same": return ids.get(node.n);
    case "made":
    case "O": return decode(node.v, ids);
    case "Map": return new Map(raw(node.v).map((pair) => raw(pair)).map(([key, value]) => [decode(key, ids), decode(value, ids)]));
    case "Set": return new Set(raw(node.v).map((value) => decode(value, ids)));
    default: {
      const Type = TYPED[node.$];
      if (!Type) throw new Error(`tag ${node.$}`);
      if (node.v) return Type.from(node.v.map((value) => decode(value, ids)));
      if (node.r) {
        const out = [];
        for (let at = 0; at < node.r.length; at += 2) for (let count = 0; count < node.r[at + 1]; count += 1) out.push(decode(node.r[at], ids));
        return Type.from(out);
      }
      const bytes = Buffer.from(node.b, "base64");
      return new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
  }
};
const READERS = ["controllerOf", "sovereignOf", "isGroup", "strengthOf", "shortageOf", "militaryOf", "musterOf", "peopleOf"];
const rounds = Number(process.env.ROUNDS) || 5;
const cases = file.cases.runFronts ?? [];
const rows = [];
cases.forEach((item, index) => {
  const plain = () => {
    const input = decode(item.a, new Map())[0];
    const kept = input.arenas instanceof Map && [...input.arenas.values()].some((value) => value !== true && !Array.isArray(value));
    if (typeof input.staffPolicy === "function" || (input.rehearsers ?? null) !== null || (kept && !Array.isArray(input.map?.regions))) return null;
    for (const key of Object.keys(input)) if (typeof input[key] === "function") delete input[key];
    if (input.arenas instanceof Map) input.arenas = new Map([...input.arenas].filter(([, value]) => value === true || Array.isArray(value)));
    for (const reader of READERS) {
      const calls = item.cb?.[`0.${reader}`];
      if (!calls) continue;
      const table = new Map();
      for (const [args, result] of calls) {
        const key = String(decode(args, new Map())[0]);
        if (!table.has(key)) table.set(key, decode(result, new Map()));
      }
      input[reader] = (asked) => table.get(String(asked));
    }
    return input;
  };
  if (!plain()) return;
  let best = Infinity;
  for (let round = 0; round < rounds; round += 1) {
    const input = plain();
    const started = process.hrtime.bigint();
    runFronts(input);
    const took = Number(process.hrtime.bigint() - started) / 1e6;
    if (took < best) best = took;
  }
  rows.push({ index, ms: Math.round(best * 1000) / 1000, days: item.a?.[0]?.days });
});
rows.sort((a, b) => b.ms - a.ms);
for (const row of rows) console.log(`js runFronts#${row.index} ${row.ms} ms days ${JSON.stringify(row.days)}`);
console.log(`js total ${rows.reduce((sum, row) => sum + row.ms, 0).toFixed(3)} ms over ${rows.length} runs`);
