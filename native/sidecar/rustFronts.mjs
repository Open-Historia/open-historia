import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { metricTableFor } from "../../server/mapDistance.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const FRONTS_HOST = process.platform === "win32" ? "ohfronts-host.exe" : "ohfronts-host";
export const FRONTS_HOST_DIR = "ohfronts";
export const READERS = Object.freeze(["controllerOf", "sovereignOf", "isGroup", "strengthOf", "shortageOf", "militaryOf", "musterOf", "peopleOf", "groupOwnerOf"]);
const BY_REGION = ["controllerOf", "sovereignOf"];
const LEFT_OUT = new Set([...READERS, "staffPolicy", "rehearsers", "arenas"]);
const SLICE_MS = 100;

export const rustFrontsMode = (env = process.env) => {
  const value = String(env?.OH_RUST_FRONTS ?? "").trim().toLowerCase();
  if (value === "0" || value === "off" || value === "false") return "off";
  return value === "shadow" ? "shadow" : "on";
};

export const frontsHostCandidates = ({ env = process.env, dir = here } = {}) => [
  String(env?.OH_RUST_FRONTS_HOST ?? "").trim(),
  path.join(dir, FRONTS_HOST_DIR, FRONTS_HOST),
  path.join(dir, "..", "engine", "target", "release", FRONTS_HOST),
  path.join(dir, "..", "engine", "target", "debug", FRONTS_HOST),
].filter(Boolean);

export const frontsHostPath = (options = {}) => frontsHostCandidates(options).find((file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}) ?? "";

export const frontsHostAnswers = (file) => {
  const result = spawnSync(file, [], { input: '{"t":"ping","id":1}\n', encoding: "utf8", timeout: 30_000, windowsHide: true });
  return result.status === 0 && String(result.stdout ?? "").includes('{"t":"pong","id":1}');
};

const TYPED = [
  [Uint8ClampedArray, "U8C"], [Uint8Array, "U8"], [Int8Array, "I8"], [Uint16Array, "U16"], [Int16Array, "I16"],
  [Uint32Array, "U32"], [Int32Array, "I32"], [Float32Array, "F32"], [Float64Array, "F64"],
];
const TYPE_OF = Object.fromEntries(TYPED.map(([Type, tag]) => [tag, Type]));
const tagOf = (view) => TYPED.find(([Type]) => view instanceof Type)?.[1] ?? "";

export const encode = (value) => {
  const wrapped = new WeakSet();
  return JSON.stringify(value, function replace(key, item) {
    if (item === undefined) return { $: "u" };
    if (typeof item === "number") {
      if (Number.isNaN(item)) return { $: "NaN" };
      if (item === Infinity) return { $: "Inf" };
      if (item === -Infinity) return { $: "-Inf" };
      if (Object.is(item, -0)) return { $: "-0" };
      return item;
    }
    if (typeof item === "function") return { $: "fn" };
    if (item === null || typeof item !== "object" || wrapped.has(item)) return item;
    if (Array.isArray(item)) return item;
    if (item instanceof Map) return { $: "Map", v: [...item.entries()] };
    if (item instanceof Set) return { $: "Set", v: [...item.values()] };
    if (ArrayBuffer.isView(item)) {
      const tag = tagOf(item);
      if (!tag) throw new Error("a typed array the Rust engine cannot read");
      return { $: tag, b: Buffer.from(item.buffer, item.byteOffset, item.byteLength).toString("base64") };
    }
    if (Object.hasOwn(item, "$")) {
      const copy = { ...item };
      wrapped.add(copy);
      return { $: "O", v: copy };
    }
    return item;
  });
};

const setOwn = (target, key, value) => {
  if (key === "__proto__") Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  else target[key] = value;
};

export const revive = (node) => {
  if (Array.isArray(node)) {
    for (let at = 0; at < node.length; at += 1) node[at] = revive(node[at]);
    return node;
  }
  if (node === null || typeof node !== "object") return node;
  const tag = node.$;
  if (typeof tag !== "string") {
    for (const key of Object.keys(node)) setOwn(node, key, revive(node[key]));
    return node;
  }
  switch (tag) {
    case "u": return undefined;
    case "NaN": return NaN;
    case "Inf": return Infinity;
    case "-Inf": return -Infinity;
    case "-0": return -0;
    case "fn": return () => undefined;
    case "O": {
      const out = {};
      for (const key of Object.keys(node.v ?? {})) setOwn(out, key, revive(node.v[key]));
      return out;
    }
    case "Map": return new Map((node.v ?? []).map(([key, value]) => [revive(key), revive(value)]));
    case "Set": return new Set((node.v ?? []).map(revive));
    default: {
      const Type = TYPE_OF[tag];
      if (!Type) throw new Error(`the Rust engine sent an unknown tag ${tag}`);
      if (typeof node.b === "string") {
        const bytes = Buffer.from(node.b, "base64");
        return new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }
      return Type.from((node.v ?? []).map(revive));
    }
  }
};

export const decode = (text) => revive(JSON.parse(text));

const kindOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Map) return "map";
  if (value instanceof Set) return "set";
  if (ArrayBuffer.isView(value)) return tagOf(value) || "view";
  return typeof value;
};

export const firstDifference = (a, b, at = "result") => {
  const kind = kindOf(a);
  if (kind !== kindOf(b)) return `${at}: ${kind} against ${kindOf(b)}`;
  if (kind === "number") return Object.is(a, b) ? "" : `${at}: ${a} against ${b}`;
  if (kind === "function") return "";
  if (kind !== "object" && kind !== "array" && kind !== "map" && kind !== "set" && !TYPE_OF[kind]) return a === b ? "" : `${at}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`;
  if (kind === "map" || kind === "set") return firstDifference([...a.entries()], [...b.entries()], at);
  if (TYPE_OF[kind]) return firstDifference([...a], [...b], at);
  if (kind === "array") {
    if (a.length !== b.length) return `${at}: ${a.length} items against ${b.length}`;
    for (let index = 0; index < a.length; index += 1) {
      const found = firstDifference(a[index], b[index], `${at}[${index}]`);
      if (found) return found;
    }
    return "";
  }
  const keys = Object.keys(a);
  const others = Object.keys(b);
  if (keys.join("\u0001") !== others.join("\u0001")) {
    const missing = keys.filter((key) => !Object.hasOwn(b, key));
    const extra = others.filter((key) => !Object.hasOwn(a, key));
    return `${at}: keys ${missing.length || extra.length ? `${missing.join(",")} / ${extra.join(",")}` : "in another order"}`;
  }
  for (const key of keys) {
    const found = firstDifference(a[key], b[key], `${at}.${key}`);
    if (found) return found;
  }
  return "";
};

const POLICIES = new WeakMap();
export const ruledBy = (policy, by, args = []) => {
  if (typeof policy === "function") POLICIES.set(policy, { by, a: args });
  return policy;
};

export const createFrontsHost = ({ file = frontsHostPath(), log = (text) => process.stderr.write(`${text}\n`) } = {}) => {
  if (!file) throw new Error("the Rust front engine is not in this copy of the game");
  const child = spawn(file, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let dead = null;
  let made = 0;
  const waiting = new Map();
  const askers = new Map();
  let ready = null;
  const readyNow = new Promise((resolve, reject) => {
    ready = { resolve, reject };
  });
  readyNow.catch(() => {});
  const write = (text) => {
    if (dead) throw dead;
    child.stdin.write(`${text}\n`);
  };
  const die = (error) => {
    if (dead) return;
    dead = error instanceof Error ? error : new Error(String(error));
    ready.reject(dead);
    for (const entry of waiting.values()) entry.reject(dead);
    waiting.clear();
  };
  child.on("error", die);
  child.on("exit", (code, signal) => die(new Error(`the Rust front engine stopped (${signal || code})`)));
  child.stdin.on("error", die);
  child.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) log(line);
  });
  const answer = async (message) => {
    const ask = askers.get(message.id);
    let text;
    try {
      if (!ask) throw new Error(`nobody answers for run ${message.id}`);
      const value = await ask(message.name, message.key);
      text = `{"t":"answer","q":${message.q},"v":${encode(value)}}`;
    } catch (error) {
      text = `{"t":"answer","q":${message.q},"error":${JSON.stringify(String(error?.message ?? error))}}`;
    }
    try {
      write(text);
    } catch { }
  };
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try {
      message = line.startsWith('{"t":"result"') ? decode(line) : JSON.parse(line);
    } catch (error) {
      die(new Error(`the Rust front engine sent what could not be read: ${error?.message ?? error}`));
      return;
    }
    if (message.t === "ready") {
      ready.resolve();
      return;
    }
    if (message.t === "ask") {
      void answer(message);
      return;
    }
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id);
    if (message.t === "error") entry.reject(new Error(`the Rust front engine failed: ${message.message}`));
    else entry.resolve(message);
  });
  const call = async (id, text) => {
    await readyNow;
    return new Promise((resolve, reject) => {
      if (dead) {
        reject(dead);
        return;
      }
      if (waiting.has(id)) {
        reject(new Error(`run ${id} is already waiting on the Rust front engine`));
        return;
      }
      waiting.set(id, { resolve, reject });
      try {
        write(text);
      } catch (error) {
        waiting.delete(id);
        reject(error);
      }
    });
  };
  return {
    get dead() {
      return dead;
    },
    ready: () => readyNow,
    nextId: () => {
      made += 1;
      return made;
    },
    call,
    asks: askers,
    cancel: (id) => {
      try {
        write(`{"t":"cancel","id":${id}}`);
      } catch { }
    },
    drop: (id) => {
      askers.delete(id);
      try {
        write(`{"t":"drop","id":${id}}`);
      } catch { }
    },
    close: () => {
      die(new Error("the Rust front engine was closed"));
      try {
        child.stdin.end();
      } catch { }
      try {
        child.kill();
      } catch { }
    },
    pid: child.pid,
  };
};

const finiteTimes = (value) => {
  const factor = Number(value);
  return factor > 0 && Number.isFinite(factor) ? factor : 1;
};

export const metricTablesOf = (input) => {
  const found = new Map();
  const add = (type, factor) => {
    if (typeof type !== "string" || !type) return;
    const key = `${type}|${factor}`;
    if (found.has(key)) return;
    const table = metricTableFor(type, factor);
    if (table) found.set(key, [type, factor, table]);
  };
  const map = input?.map;
  if (map && map.flat !== true && map.metric && Array.isArray(map.metric.kx)) {
    const given = Number(map.factor);
    add(map.metric.type, given > 0 && map.factor !== 1 ? given : 1);
  }
  for (const record of Array.isArray(input?.battlefields) ? input.battlefields : []) {
    const frame = record?.frame;
    if (frame && typeof frame === "object" && frame.flat !== true && typeof frame.proj === "string") add(frame.proj, finiteTimes(frame.factor));
  }
  return [...found.values()];
};

const cityNameOf = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 120).trim();

export const collationOf = (input) => {
  const cities = Array.isArray(input?.map?.cities) ? input.map.cities : [];
  if (cities.length === 0 || !Array.isArray(input?.transports) || input.transports.length === 0) return {};
  const names = [...new Set(cities.map((city) => `city: ${cityNameOf(city?.name)}`))].sort((a, b) => a.localeCompare(b));
  const ranks = {};
  let rank = 0;
  names.forEach((name, at) => {
    if (at > 0 && names[at - 1].localeCompare(name) !== 0) rank += 1;
    ranks[name] = rank;
  });
  return ranks;
};

const abortError = () => new DOMException("The land war's run was called off.", "AbortError");

export const openMessage = (id, input, { policy = null, regionIds = null } = {}) => {
  const given = input ?? {};
  for (const [key, value] of Object.entries(given)) {
    if (typeof value === "function" && !LEFT_OUT.has(key)) throw new Error(`the Rust engine cannot be handed ${key}`);
  }
  let spec = null;
  if (typeof given.staffPolicy === "function") {
    spec = POLICIES.get(given.staffPolicy) ?? policy;
    if (!spec) throw new Error("the staff leading this run has no Rust port");
  }
  const data = {};
  for (const [key, value] of Object.entries(given)) {
    if (LEFT_OUT.has(key)) continue;
    data[key] = value;
  }
  if (given.arenas instanceof Map) data.arenas = new Map([...given.arenas].filter(([, value]) => value === true || Array.isArray(value)));
  const readers = READERS.filter((name) => typeof given[name] === "function");
  const ids = new Set(Array.isArray(regionIds) ? regionIds : []);
  for (const region of Array.isArray(given.map?.regions) ? given.map.regions : []) {
    const regionId = String(region?.id ?? "").trim();
    if (regionId) ids.add(regionId);
  }
  const tables = {};
  if (ids.size > 0) {
    for (const name of BY_REGION.filter((reader) => readers.includes(reader))) {
      const table = {};
      for (const regionId of ids) table[regionId] = given[name](regionId);
      tables[name] = table;
    }
  }
  return `{"t":"open","id":${id},"readers":${JSON.stringify(readers)},"policy":${spec ? encode(spec) : "null"},"tables":${encode(tables)},"metrics":${encode(metricTablesOf(given))},"collation":${encode(collationOf(given))},"input":${encode(data)}}`;
};

export const rustRunMaker = (host, { policy = null, regionIds = () => null, slice = SLICE_MS } = {}) => {
  const open = new Set();
  const createFrontRun = (input) => {
    const id = host.nextId();
    const state = { opened: false, done: false, has: false, result: undefined, error: null };
    const fail = (error) => {
      if (!state.error) state.error = error instanceof Error || error instanceof DOMException ? error : new Error(String(error));
      open.delete(id);
      host.drop(id);
      return null;
    };
    const call = async (text) => {
      try {
        const reply = await host.call(id, text);
        if (reply?.t === "cancelled") return fail(abortError());
        return reply;
      } catch (error) {
        return fail(error);
      }
    };
    const begin = async () => {
      let text;
      try {
        text = openMessage(id, input, { policy, regionIds: regionIds() });
      } catch (error) {
        return fail(error);
      }
      open.add(id);
      host.asks.set(id, (name, key) => input[name](key));
      const reply = await call(text);
      if (reply) {
        state.opened = true;
        state.done = reply.finished === true;
      }
      return reply;
    };
    function* steps(days) {
      if (state.error) return;
      if (!state.opened && !(yield { wait: begin })) return;
      let left = Number(days) >= 0 ? Number(days) : Infinity;
      while (!state.done && left > 0) {
        const reply = yield { wait: () => call(`{"t":"advance","id":${id},"days":${Number.isFinite(left) ? left : -1},"ms":${slice}}`) };
        if (!reply) return;
        left -= Number(reply.ran) || 0;
        state.done = reply.finished === true;
        if (!state.done && left > 0) yield null;
      }
      if (state.done && !state.has) {
        const reply = yield { wait: () => call(`{"t":"finish","id":${id}}`) };
        if (!reply) return;
        state.result = reply.v;
        state.has = true;
        open.delete(id);
        host.asks.delete(id);
      }
    }
    return {
      steps,
      advance: () => {
        throw new Error("a run fought by the Rust engine is taken in steps");
      },
      finished: () => {
        if (state.error) throw state.error;
        return state.has;
      },
      finish: () => {
        if (state.error) throw state.error;
        if (!state.has) throw new Error("the Rust engine's run is not finished");
        return state.result;
      },
    };
  };
  return {
    createFrontRun,
    cancel: () => {
      for (const id of open) host.cancel(id);
    },
    release: () => {
      for (const id of open) host.drop(id);
      open.clear();
    },
  };
};
