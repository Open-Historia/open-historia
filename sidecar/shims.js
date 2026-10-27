import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";

const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
};

class PersistentStorage {
  #file;
  #items = new Map();
  #timer = null;
  #dirty = false;

  constructor(file) {
    this.#file = file;
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [key, value] of Object.entries(saved)) this.#items.set(key, String(value));
    } catch {
      this.#items.clear();
    }
  }

  get length() {
    return this.#items.size;
  }

  key(index) {
    return [...this.#items.keys()][index] ?? null;
  }

  getItem(key) {
    const value = this.#items.get(String(key));
    return value === undefined ? null : value;
  }

  setItem(key, value) {
    this.#items.set(String(key), String(value));
    this.#schedule();
  }

  removeItem(key) {
    if (this.#items.delete(String(key))) this.#schedule();
  }

  clear() {
    this.#items.clear();
    this.#schedule();
  }

  flush() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.#dirty) return;
    writeAtomic(this.#file, JSON.stringify(Object.fromEntries(this.#items)));
    this.#dirty = false;
  }

  #schedule() {
    this.#dirty = true;
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.flush(), 250);
  }
}

const domError = (name, message) => new DOMException(message, name);
const dataError = (message = "The parameter is not a valid key.") => domError("DataError", message);

const keyRank = (key) => {
  if (typeof key === "number") return Number.isNaN(key) ? 0 : 1;
  if (key instanceof Date) return Number.isNaN(key.getTime()) ? 0 : 2;
  if (typeof key === "string") return 3;
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) return 4;
  if (Array.isArray(key)) return key.every((item) => keyRank(item) > 0) ? 5 : 0;
  return 0;
};

const bytesOf = (key) => (key instanceof ArrayBuffer ? new Uint8Array(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength));

const compareKeys = (a, b) => {
  const left = keyRank(a);
  const right = keyRank(b);
  if (!left || !right) throw dataError();
  if (left !== right) return left < right ? -1 : 1;
  if (left === 2) return compareKeys(a.getTime(), b.getTime());
  if (left === 1 || left === 3) return a === b ? 0 : a < b ? -1 : 1;
  if (left === 4) {
    const x = bytesOf(a);
    const y = bytesOf(b);
    for (let index = 0; index < Math.min(x.length, y.length); index += 1) {
      if (x[index] !== y[index]) return x[index] < y[index] ? -1 : 1;
    }
    return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
  }
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = compareKeys(a[index], b[index]);
    if (order) return order;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
};

const encodeKey = (key) => {
  const rank = keyRank(key);
  if (rank === 1) return `n${Object.is(key, -0) ? 0 : key}`;
  if (rank === 2) return `d${key.getTime()}`;
  if (rank === 3) return `s${key}`;
  if (rank === 4) return `b${Buffer.from(bytesOf(key)).toString("hex")}`;
  return `a${JSON.stringify(key.map(encodeKey))}`;
};

const copyKey = (key) => (typeof key === "object" && key !== null ? structuredClone(key) : key);
const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
const safeName = (name) => `${String(name).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60)}-${sha1(String(name)).slice(0, 10)}`;

const readPath = (value, keyPath) => {
  if (Array.isArray(keyPath)) {
    const parts = keyPath.map((part) => readPath(value, part));
    return parts.some((part) => part === undefined) ? undefined : parts;
  }
  if (keyPath === "") return value;
  let current = value;
  for (const part of String(keyPath).split(".")) {
    if (current === null || current === undefined) return undefined;
    const box = Object(current);
    if (!(part in box)) return undefined;
    current = box[part];
  }
  return current;
};

const writePath = (value, keyPath, key) => {
  const parts = String(keyPath).split(".");
  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (current[part] === undefined) current[part] = {};
    current = current[part];
    if (!current || typeof current !== "object") throw dataError("The key path cannot hold a generated key.");
  }
  current[parts[parts.length - 1]] = key;
};

const stringList = (names) => {
  const items = [...names];
  Object.defineProperty(items, "contains", { value: (name) => items.includes(String(name)) });
  Object.defineProperty(items, "item", { value: (index) => items[index] ?? null });
  return Object.freeze(items);
};

class IDBKeyRange {
  constructor(lower, upper, lowerOpen, upperOpen) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = Boolean(lowerOpen);
    this.upperOpen = Boolean(upperOpen);
    Object.freeze(this);
  }

  static only(value) {
    if (!keyRank(value)) throw dataError();
    return new IDBKeyRange(copyKey(value), copyKey(value), false, false);
  }

  static lowerBound(lower, open = false) {
    if (!keyRank(lower)) throw dataError();
    return new IDBKeyRange(copyKey(lower), undefined, open, true);
  }

  static upperBound(upper, open = false) {
    if (!keyRank(upper)) throw dataError();
    return new IDBKeyRange(undefined, copyKey(upper), true, open);
  }

  static bound(lower, upper, lowerOpen = false, upperOpen = false) {
    const order = compareKeys(lower, upper);
    if (order > 0 || (order === 0 && (lowerOpen || upperOpen))) throw dataError("The lower bound is above the upper bound.");
    return new IDBKeyRange(copyKey(lower), copyKey(upper), lowerOpen, upperOpen);
  }

  includes(key) {
    if (!keyRank(key)) throw dataError();
    if (this.lower !== undefined) {
      const order = compareKeys(this.lower, key);
      if (order > 0 || (order === 0 && this.lowerOpen)) return false;
    }
    if (this.upper !== undefined) {
      const order = compareKeys(this.upper, key);
      if (order < 0 || (order === 0 && this.upperOpen)) return false;
    }
    return true;
  }
}

const rangeOf = (query, required = false) => {
  if (query === undefined || query === null) {
    if (required) throw dataError("A key or key range is required.");
    return null;
  }
  if (query instanceof IDBKeyRange) return query;
  return IDBKeyRange.only(query);
};

const exactKey = (range) => (range && range.lower !== undefined && range.upper !== undefined && !range.lowerOpen && !range.upperOpen && compareKeys(range.lower, range.upper) === 0 ? range.lower : undefined);
const limitOf = (count) => (count === undefined || count === null || Number(count) <= 0 ? Infinity : Math.floor(Number(count)));

const THREW = Symbol("threw");
const HANDLERS = Symbol("handlers");

const defineHandlers = (Target, types) => {
  for (const type of types) {
    Object.defineProperty(Target.prototype, `on${type}`, {
      configurable: true,
      get() {
        return this[HANDLERS]?.[type] ?? null;
      },
      set(handler) {
        if (!this[HANDLERS]) this[HANDLERS] = {};
        const handlers = this[HANDLERS];
        if (!(type in handlers)) {
          this.addEventListener(type, (event) => {
            const current = handlers[type];
            if (typeof current !== "function") return;
            try {
              current.call(this, event);
            } catch (error) {
              event[THREW] = error;
            }
          });
        }
        handlers[type] = typeof handler === "function" ? handler : null;
      },
    });
  }
};

const fire = (target, type, extra = {}) => {
  const event = new Event(type, { cancelable: type === "error" });
  for (const [name, value] of Object.entries(extra)) Object.defineProperty(event, name, { value, enumerable: true });
  target.dispatchEvent(event);
  return event;
};

class IDBRequest extends EventTarget {
  #result = undefined;
  #error = null;
  #done = false;

  constructor(source = null, transaction = null) {
    super();
    this.source = source;
    this.transaction = transaction;
  }

  get result() {
    return this.#result;
  }

  get error() {
    return this.#error;
  }

  get readyState() {
    return this.#done ? "done" : "pending";
  }

  settle(result, error = null) {
    this.#result = error ? undefined : result;
    this.#error = error;
    this.#done = true;
  }
}
defineHandlers(IDBRequest, ["success", "error"]);

class IDBOpenDBRequest extends IDBRequest {}
defineHandlers(IDBOpenDBRequest, ["upgradeneeded", "blocked"]);

class Backing {
  constructor(root, name) {
    this.name = name;
    this.dir = path.join(root, safeName(name));
    this.version = 0;
    this.stores = new Map();
    this.queue = [];
    this.running = null;
    this.connections = new Set();
    this.load();
  }

  load() {
    this.version = 0;
    this.stores = new Map();
    let meta = null;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(this.dir, "meta.json"), "utf8"));
    } catch {
      return;
    }
    this.version = Math.max(0, Math.floor(Number(meta?.version) || 0));
    for (const [name, info] of Object.entries(meta?.stores ?? {})) {
      const store = {
        name,
        dir: String(info?.dir || safeName(name)),
        keyPath: info?.keyPath ?? null,
        autoIncrement: info?.autoIncrement === true,
        counter: Math.max(1, Number(info?.counter) || 1),
        indexes: new Map(Object.entries(info?.indexes ?? {}).map(([index, spec]) => [index, { keyPath: spec?.keyPath ?? "", unique: spec?.unique === true, multiEntry: spec?.multiEntry === true }])),
        rows: new Map(),
      };
      const folder = path.join(this.dir, store.dir);
      let files = [];
      try {
        files = fs.readdirSync(folder).filter((file) => file.endsWith(".v8"));
      } catch {
        files = [];
      }
      for (const file of files) {
        try {
          const row = v8.deserialize(fs.readFileSync(path.join(folder, file)));
          if (row && keyRank(row.key)) store.rows.set(encodeKey(row.key), { key: row.key, value: row.value });
        } catch {
          continue;
        }
      }
      this.stores.set(name, store);
    }
  }

  writeMeta() {
    const stores = {};
    for (const store of this.stores.values()) {
      stores[store.name] = {
        dir: store.dir,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        counter: store.counter,
        indexes: Object.fromEntries(store.indexes),
      };
    }
    writeAtomic(path.join(this.dir, "meta.json"), JSON.stringify({ name: this.name, version: this.version, stores }));
  }

  rowFile(store, encoded) {
    return path.join(this.dir, store.dir, `${sha1(encoded)}.v8`);
  }

  enqueue(task) {
    this.queue.push(task);
    this.next();
  }

  next() {
    if (this.running || this.queue.length === 0) return;
    const task = this.queue.shift();
    this.running = task;
    setImmediate(() => task.start());
  }

  finish(task) {
    if (this.running !== task) return;
    this.running = null;
    this.next();
  }
}

const sortedRows = (store) => [...store.rows.values()].sort((a, b) => compareKeys(a.key, b.key));

class IDBTransaction extends EventTarget {
  #backing;
  #names;
  #queue = [];
  #journal = new Map();
  #state = "waiting";
  #schema = null;
  #removedStores = [];
  #hooks;

  constructor(db, backing, names, mode, hooks = {}) {
    super();
    this.db = db;
    this.mode = mode;
    this.error = null;
    this.#backing = backing;
    this.#names = names;
    this.#hooks = hooks;
  }

  get objectStoreNames() {
    return stringList(this.mode === "versionchange" ? [...this.#backing.stores.keys()].sort() : this.#names);
  }

  get durability() {
    return "default";
  }

  objectStore(name) {
    if (this.#state === "finished") throw domError("InvalidStateError", "The transaction has finished.");
    const store = this.#backing.stores.get(String(name));
    if (!store || (this.mode !== "versionchange" && !this.#names.includes(String(name)))) throw domError("NotFoundError", `No object store named "${name}" in this transaction.`);
    return new IDBObjectStore(this, store);
  }

  abort() {
    if (this.#state === "finished" || this.#state === "committing") throw domError("InvalidStateError", "The transaction has finished.");
    this.#abort(null);
  }

  commit() {
    if (this.#state === "finished") throw domError("InvalidStateError", "The transaction has finished.");
  }

  writable() {
    if (this.mode === "readonly") throw domError("ReadOnlyError", "The transaction is read-only.");
  }

  live() {
    if (this.#state === "finished" || this.#state === "committing") throw domError("TransactionInactiveError", "The transaction has finished.");
  }

  request(source, operation) {
    this.live();
    const request = new IDBRequest(source, this);
    this.#queue.push({ request, operation });
    return request;
  }

  touch(store, encoded) {
    if (!this.#journal.has(store)) this.#journal.set(store, { counter: store.counter, rows: new Map() });
    const changes = this.#journal.get(store);
    if (!changes.rows.has(encoded)) changes.rows.set(encoded, store.rows.get(encoded));
  }

  touchCounter(store) {
    if (!this.#journal.has(store)) this.#journal.set(store, { counter: store.counter, rows: new Map() });
  }

  removeStore(store) {
    this.#removedStores.push(store);
  }

  start() {
    if (this.#state !== "waiting") return;
    this.#state = "running";
    if (this.mode === "versionchange") {
      this.#schema = {
        version: this.#backing.version,
        stores: new Map([...this.#backing.stores].map(([name, store]) => [name, { ...store, indexes: new Map(store.indexes) }])),
      };
    }
    try {
      this.#hooks.begin?.(this);
    } catch (error) {
      this.#abort(error instanceof DOMException ? error : domError("AbortError", String(error?.message ?? error)));
      return;
    }
    if (this.#state === "running") this.#pump();
  }

  #pump() {
    if (this.#state !== "running") return;
    const next = this.#queue.shift();
    if (!next) {
      this.#commit();
      return;
    }
    let result;
    let failure = null;
    try {
      result = next.operation();
    } catch (error) {
      failure = error instanceof DOMException ? error : domError("UnknownError", String(error?.message ?? error));
    }
    if (failure) {
      next.request.settle(undefined, failure);
      const event = fire(next.request, "error");
      if (event[THREW] || !event.defaultPrevented) {
        this.#fail(failure);
        return;
      }
    } else {
      next.request.settle(result);
      const event = fire(next.request, "success");
      if (event[THREW]) {
        this.#fail(domError("AbortError", String(event[THREW]?.message ?? event[THREW])));
        return;
      }
    }
    setImmediate(() => this.#pump());
  }

  #fail(error) {
    this.error = error;
    fire(this, "error");
    if (this.db) fire(this.db, "error");
    this.#abort(error);
  }

  #persist() {
    const backing = this.#backing;
    if (this.mode === "versionchange") {
      for (const store of this.#removedStores) {
        if (!backing.stores.has(store.name) || backing.stores.get(store.name) !== store) fs.rmSync(path.join(backing.dir, store.dir), { recursive: true, force: true });
      }
    }
    let counters = this.mode === "versionchange";
    for (const [store, changes] of this.#journal) {
      if (backing.stores.get(store.name) !== store) continue;
      if (changes.counter !== store.counter) counters = true;
      fs.mkdirSync(path.join(backing.dir, store.dir), { recursive: true });
      for (const encoded of changes.rows.keys()) {
        const row = store.rows.get(encoded);
        const file = backing.rowFile(store, encoded);
        if (row) writeAtomic(file, v8.serialize({ key: row.key, value: row.value }));
        else fs.rmSync(file, { force: true });
      }
    }
    if (counters) backing.writeMeta();
  }

  #rollback() {
    const backing = this.#backing;
    for (const [store, changes] of this.#journal) {
      store.counter = changes.counter;
      for (const [encoded, previous] of changes.rows) {
        if (previous) store.rows.set(encoded, previous);
        else store.rows.delete(encoded);
      }
    }
    if (this.#schema) {
      backing.version = this.#schema.version;
      backing.stores = this.#schema.stores;
    }
  }

  #commit() {
    this.#state = "committing";
    try {
      this.#persist();
    } catch (error) {
      this.#state = "running";
      this.#rollback();
      try {
        this.#persist();
      } catch {
        this.#journal.clear();
      }
      this.#fail(domError("UnknownError", `The data could not be written: ${error?.message ?? error}`));
      return;
    }
    this.#state = "finished";
    this.#backing.finish(this);
    fire(this, "complete");
    this.#hooks.end?.(false);
  }

  #abort(error) {
    if (this.#state === "finished") return;
    this.#state = "finished";
    this.#rollback();
    this.error = error ?? null;
    for (const pending of this.#queue.splice(0)) {
      pending.request.settle(undefined, domError("AbortError", "The transaction was aborted."));
      fire(pending.request, "error");
    }
    this.#backing.finish(this);
    fire(this, "abort");
    this.#hooks.end?.(true);
  }
}
defineHandlers(IDBTransaction, ["complete", "error", "abort"]);

class IDBObjectStore {
  #tx;
  #store;

  constructor(tx, store) {
    this.#tx = tx;
    this.#store = store;
  }

  get name() {
    return this.#store.name;
  }

  get keyPath() {
    return this.#store.keyPath;
  }

  get autoIncrement() {
    return this.#store.autoIncrement;
  }

  get indexNames() {
    return stringList([...this.#store.indexes.keys()].sort());
  }

  get transaction() {
    return this.#tx;
  }

  put(value, key) {
    return this.#write(value, key, false);
  }

  add(value, key) {
    return this.#write(value, key, true);
  }

  #write(value, key, noOverwrite) {
    this.#tx.live();
    this.#tx.writable();
    const store = this.#store;
    if (store.keyPath !== null && key !== undefined) throw dataError("This store keeps its keys inside its values.");
    if (store.keyPath === null && key === undefined && !store.autoIncrement) throw dataError("A key is required for this store.");
    if (key !== undefined && !keyRank(key)) throw dataError();
    let copy;
    try {
      copy = structuredClone(value);
    } catch (error) {
      throw domError("DataCloneError", String(error?.message ?? error));
    }
    let inline;
    if (store.keyPath !== null) {
      inline = readPath(copy, store.keyPath);
      if (inline === undefined) {
        if (!store.autoIncrement) throw dataError("The value has no key at the store's key path.");
      } else if (!keyRank(inline)) {
        throw dataError("The value's key is not a valid key.");
      }
    }
    const tx = this.#tx;
    return tx.request(this, () => {
      let primary = store.keyPath !== null ? (inline === undefined ? undefined : copyKey(inline)) : (key === undefined ? undefined : copyKey(key));
      if (primary === undefined) {
        tx.touchCounter(store);
        primary = store.counter;
        store.counter += 1;
        if (store.keyPath !== null) writePath(copy, store.keyPath, primary);
      } else if (store.autoIncrement && typeof primary === "number" && primary >= store.counter) {
        tx.touchCounter(store);
        store.counter = Math.floor(primary) + 1;
      }
      const encoded = encodeKey(primary);
      if (noOverwrite && store.rows.has(encoded)) throw domError("ConstraintError", "A record with this key already exists.");
      for (const [name, spec] of store.indexes) {
        if (!spec.unique) continue;
        const indexed = readPath(copy, spec.keyPath);
        if (!keyRank(indexed)) continue;
        for (const [otherKey, row] of store.rows) {
          if (otherKey === encoded) continue;
          const other = readPath(row.value, spec.keyPath);
          if (keyRank(other) && compareKeys(other, indexed) === 0) throw domError("ConstraintError", `The index "${name}" already holds this key.`);
        }
      }
      tx.touch(store, encoded);
      store.rows.set(encoded, { key: primary, value: copy });
      return copyKey(primary);
    });
  }

  #rowsIn(range) {
    const exact = exactKey(range);
    if (exact !== undefined) {
      const row = this.#store.rows.get(encodeKey(exact));
      return row ? [row] : [];
    }
    const rows = sortedRows(this.#store);
    return range ? rows.filter((row) => range.includes(row.key)) : rows;
  }

  get(query) {
    this.#tx.live();
    const range = rangeOf(query, true);
    return this.#tx.request(this, () => {
      const row = this.#rowsIn(range)[0];
      return row ? structuredClone(row.value) : undefined;
    });
  }

  getKey(query) {
    this.#tx.live();
    const range = rangeOf(query, true);
    return this.#tx.request(this, () => {
      const row = this.#rowsIn(range)[0];
      return row ? copyKey(row.key) : undefined;
    });
  }

  getAll(query, count) {
    this.#tx.live();
    const range = rangeOf(query);
    const limit = limitOf(count);
    return this.#tx.request(this, () => this.#rowsIn(range).slice(0, limit).map((row) => structuredClone(row.value)));
  }

  getAllKeys(query, count) {
    this.#tx.live();
    const range = rangeOf(query);
    const limit = limitOf(count);
    return this.#tx.request(this, () => this.#rowsIn(range).slice(0, limit).map((row) => copyKey(row.key)));
  }

  count(query) {
    this.#tx.live();
    const range = rangeOf(query);
    return this.#tx.request(this, () => (range ? this.#rowsIn(range).length : this.#store.rows.size));
  }

  delete(query) {
    this.#tx.live();
    this.#tx.writable();
    const range = rangeOf(query, true);
    const tx = this.#tx;
    return tx.request(this, () => {
      for (const row of this.#rowsIn(range)) {
        const encoded = encodeKey(row.key);
        tx.touch(this.#store, encoded);
        this.#store.rows.delete(encoded);
      }
      return undefined;
    });
  }

  clear() {
    this.#tx.live();
    this.#tx.writable();
    const tx = this.#tx;
    return tx.request(this, () => {
      for (const encoded of [...this.#store.rows.keys()]) {
        tx.touch(this.#store, encoded);
        this.#store.rows.delete(encoded);
      }
      return undefined;
    });
  }

  index(name) {
    this.#tx.live();
    const spec = this.#store.indexes.get(String(name));
    if (!spec) throw domError("NotFoundError", `No index named "${name}".`);
    return new IDBIndex(this, this.#tx, this.#store, String(name), spec);
  }

  createIndex(name, keyPath, options = {}) {
    if (this.#tx.mode !== "versionchange") throw domError("InvalidStateError", "Indexes can only be made while the database is upgraded.");
    const indexName = String(name);
    if (this.#store.indexes.has(indexName)) throw domError("ConstraintError", `The index "${indexName}" already exists.`);
    if (options?.multiEntry && Array.isArray(keyPath)) throw domError("InvalidAccessError", "A multi-entry index needs a single key path.");
    const spec = { keyPath: Array.isArray(keyPath) ? keyPath.map(String) : String(keyPath), unique: options?.unique === true, multiEntry: options?.multiEntry === true };
    this.#store.indexes.set(indexName, spec);
    this.#tx.touchCounter(this.#store);
    return new IDBIndex(this, this.#tx, this.#store, indexName, spec);
  }

  deleteIndex(name) {
    if (this.#tx.mode !== "versionchange") throw domError("InvalidStateError", "Indexes can only be removed while the database is upgraded.");
    if (!this.#store.indexes.delete(String(name))) throw domError("NotFoundError", `No index named "${name}".`);
    this.#tx.touchCounter(this.#store);
  }
}

class IDBIndex {
  #objectStore;
  #tx;
  #store;
  #name;
  #spec;

  constructor(objectStore, tx, store, name, spec) {
    this.#objectStore = objectStore;
    this.#tx = tx;
    this.#store = store;
    this.#name = name;
    this.#spec = spec;
  }

  get name() {
    return this.#name;
  }

  get keyPath() {
    return this.#spec.keyPath;
  }

  get unique() {
    return this.#spec.unique;
  }

  get multiEntry() {
    return this.#spec.multiEntry;
  }

  get objectStore() {
    return this.#objectStore;
  }

  #entries(range) {
    const entries = [];
    for (const row of this.#store.rows.values()) {
      const indexed = readPath(row.value, this.#spec.keyPath);
      if (indexed === undefined) continue;
      if (this.#spec.multiEntry && Array.isArray(indexed)) {
        const seen = new Set();
        for (const item of indexed) {
          if (!keyRank(item)) continue;
          const encoded = encodeKey(item);
          if (seen.has(encoded)) continue;
          seen.add(encoded);
          entries.push({ indexKey: item, row });
        }
      } else if (keyRank(indexed)) {
        entries.push({ indexKey: indexed, row });
      }
    }
    const kept = range ? entries.filter((entry) => range.includes(entry.indexKey)) : entries;
    return kept.sort((a, b) => compareKeys(a.indexKey, b.indexKey) || compareKeys(a.row.key, b.row.key));
  }

  get(query) {
    this.#tx.live();
    const range = rangeOf(query, true);
    return this.#tx.request(this, () => {
      const entry = this.#entries(range)[0];
      return entry ? structuredClone(entry.row.value) : undefined;
    });
  }

  getKey(query) {
    this.#tx.live();
    const range = rangeOf(query, true);
    return this.#tx.request(this, () => {
      const entry = this.#entries(range)[0];
      return entry ? copyKey(entry.row.key) : undefined;
    });
  }

  getAll(query, count) {
    this.#tx.live();
    const range = rangeOf(query);
    const limit = limitOf(count);
    return this.#tx.request(this, () => this.#entries(range).slice(0, limit).map((entry) => structuredClone(entry.row.value)));
  }

  getAllKeys(query, count) {
    this.#tx.live();
    const range = rangeOf(query);
    const limit = limitOf(count);
    return this.#tx.request(this, () => this.#entries(range).slice(0, limit).map((entry) => copyKey(entry.row.key)));
  }

  count(query) {
    this.#tx.live();
    const range = rangeOf(query);
    return this.#tx.request(this, () => this.#entries(range).length);
  }
}

class IDBDatabase extends EventTarget {
  #backing;
  #closed = false;
  upgrade = null;

  constructor(backing) {
    super();
    this.#backing = backing;
    backing.connections.add(this);
  }

  get name() {
    return this.#backing.name;
  }

  get version() {
    return this.#backing.version;
  }

  get objectStoreNames() {
    return stringList([...this.#backing.stores.keys()].sort());
  }

  createObjectStore(name, options = {}) {
    if (!this.upgrade) throw domError("InvalidStateError", "Object stores can only be made while the database is upgraded.");
    const storeName = String(name);
    if (this.#backing.stores.has(storeName)) throw domError("ConstraintError", `The object store "${storeName}" already exists.`);
    const keyPath = options?.keyPath === undefined || options?.keyPath === null ? null : (Array.isArray(options.keyPath) ? options.keyPath.map(String) : String(options.keyPath));
    const autoIncrement = options?.autoIncrement === true;
    if (autoIncrement && (keyPath === "" || Array.isArray(keyPath))) throw domError("InvalidAccessError", "A generated key needs a single, non-empty key path.");
    const store = { name: storeName, dir: safeName(`${storeName}-${Date.now().toString(36)}`), keyPath, autoIncrement, counter: 1, indexes: new Map(), rows: new Map() };
    this.#backing.stores.set(storeName, store);
    this.upgrade.touchCounter(store);
    return new IDBObjectStore(this.upgrade, store);
  }

  deleteObjectStore(name) {
    if (!this.upgrade) throw domError("InvalidStateError", "Object stores can only be removed while the database is upgraded.");
    const store = this.#backing.stores.get(String(name));
    if (!store) throw domError("NotFoundError", `No object store named "${name}".`);
    this.#backing.stores.delete(String(name));
    this.upgrade.removeStore(store);
  }

  transaction(storeNames, mode = "readonly") {
    if (this.#closed) throw domError("InvalidStateError", "The database connection is closed.");
    if (this.upgrade) throw domError("InvalidStateError", "The database is being upgraded.");
    const names = [...new Set((Array.isArray(storeNames) || (storeNames && typeof storeNames !== "string" && typeof storeNames[Symbol.iterator] === "function") ? [...storeNames] : [storeNames]).map(String))];
    if (names.length === 0) throw domError("InvalidAccessError", "A transaction needs at least one object store.");
    for (const name of names) {
      if (!this.#backing.stores.has(name)) throw domError("NotFoundError", `No object store named "${name}".`);
    }
    if (mode !== "readonly" && mode !== "readwrite") throw new TypeError(`Unknown transaction mode: ${mode}`);
    const tx = new IDBTransaction(this, this.#backing, names, mode);
    this.#backing.enqueue(tx);
    return tx;
  }

  close() {
    this.#closed = true;
    this.#backing.connections.delete(this);
  }
}
defineHandlers(IDBDatabase, ["abort", "close", "error", "versionchange"]);

class IDBFactory {
  #root;
  #backings = new Map();

  constructor(root) {
    this.#root = root;
  }

  #backing(name) {
    if (!this.#backings.has(name)) this.#backings.set(name, new Backing(this.#root, name));
    return this.#backings.get(name);
  }

  open(name, version) {
    if (version !== undefined && (!Number.isInteger(Number(version)) || Number(version) < 1)) throw new TypeError("The version must be a whole number of at least 1.");
    const request = new IDBOpenDBRequest();
    const dbName = String(name);
    const wanted = version === undefined ? undefined : Number(version);
    setImmediate(() => this.#open(request, dbName, wanted));
    return request;
  }

  #open(request, name, wanted) {
    let backing;
    try {
      backing = this.#backing(name);
    } catch (error) {
      request.settle(undefined, domError("UnknownError", String(error?.message ?? error)));
      fire(request, "error");
      return;
    }
    const task = {
      start: () => {
        const target = wanted ?? Math.max(1, backing.version);
        if (target <= backing.version) {
          backing.finish(task);
          if (target < backing.version) {
            request.settle(undefined, domError("VersionError", `The database is at version ${backing.version}, above the requested ${target}.`));
            fire(request, "error");
          } else {
            request.settle(new IDBDatabase(backing));
            fire(request, "success");
          }
          return;
        }
        const oldVersion = backing.version;
        for (const other of backing.connections) fire(other, "versionchange", { oldVersion, newVersion: target });
        const db = new IDBDatabase(backing);
        const upgrade = new IDBTransaction(db, backing, [], "versionchange", {
          begin: (tx) => {
            backing.version = target;
            db.upgrade = tx;
            request.transaction = tx;
            request.settle(db);
            const event = fire(request, "upgradeneeded", { oldVersion, newVersion: target });
            if (event[THREW]) throw event[THREW];
          },
          end: (aborted) => {
            db.upgrade = null;
            request.transaction = null;
            if (aborted) {
              db.close();
              request.settle(undefined, domError("AbortError", "The database upgrade was aborted."));
              fire(request, "error");
              return;
            }
            fire(request, "success");
          },
        });
        backing.running = upgrade;
        upgrade.start();
      },
    };
    backing.enqueue(task);
  }

  deleteDatabase(name) {
    const request = new IDBOpenDBRequest();
    const dbName = String(name);
    setImmediate(() => {
      const backing = this.#backing(dbName);
      const task = {
        start: () => {
          const oldVersion = backing.version;
          for (const other of backing.connections) fire(other, "versionchange", { oldVersion, newVersion: null });
          let failure = null;
          try {
            fs.rmSync(backing.dir, { recursive: true, force: true });
          } catch (error) {
            failure = error;
          }
          backing.version = 0;
          backing.stores = new Map();
          backing.finish(task);
          if (failure) {
            request.settle(undefined, domError("UnknownError", String(failure?.message ?? failure)));
            fire(request, "error");
            return;
          }
          request.settle(undefined);
          fire(request, "success", { oldVersion, newVersion: null });
        },
      };
      backing.enqueue(task);
    });
    return request;
  }

  async databases() {
    const found = [];
    let folders = [];
    try {
      folders = fs.readdirSync(this.#root);
    } catch {
      folders = [];
    }
    for (const folder of folders) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(this.#root, folder, "meta.json"), "utf8"));
        if (meta?.name && Number(meta.version) > 0) found.push({ name: String(meta.name), version: Number(meta.version) });
      } catch {
        continue;
      }
    }
    return found;
  }

  cmp(a, b) {
    return compareKeys(a, b);
  }
}

const quietMedia = () => ({
  matches: false,
  media: "",
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});

export const installShims = ({ origin, storageFile }) => {
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  const storage = new PersistentStorage(storageFile);
  const session = new PersistentStorage(path.join(path.dirname(storageFile), "session-storage.json"));
  let visible = true;

  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.dispatchEvent = events.dispatchEvent.bind(events);
  globalThis.location = new URL(`${origin}/`);
  globalThis.localStorage = storage;
  globalThis.sessionStorage = session;
  globalThis.indexedDB = new IDBFactory(path.join(path.dirname(storageFile), "indexeddb"));
  globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.matchMedia = quietMedia;
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16);
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
  globalThis.requestIdleCallback = (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 8 }), 1);
  globalThis.cancelIdleCallback = (handle) => clearTimeout(handle);
  globalThis.document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    get hidden() {
      return !visible;
    },
    hasFocus: () => visible,
    title: "Open Historia",
    documentElement: { lang: "en", dir: "ltr", style: {}, dataset: {}, setAttribute() {}, removeAttribute() {} },
    body: null,
    head: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    getElementsByTagName: () => [],
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
    createElement(tag) {
      throw new Error(`The native engine has no page to make a <${tag}> in.`);
    },
  };
  try {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, get: () => true });
  } catch {
    globalThis.navigator = { ...globalThis.navigator, onLine: true };
  }

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init = undefined) => {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    const url = raw && raw.startsWith("/") ? `${origin}${raw}` : raw;
    const options = init ? { ...init } : {};
    delete options.cache;
    if (typeof input === "string" || input instanceof URL) return nativeFetch(url, options);
    return nativeFetch(new Request(url, input), options);
  };

  const setVisible = (next) => {
    const changed = visible !== Boolean(next);
    visible = Boolean(next);
    if (changed) documentEvents.dispatchEvent(new Event("visibilitychange"));
  };

  let hidden = false;
  const hidePage = () => {
    if (hidden) return;
    hidden = true;
    try {
      events.dispatchEvent(new Event("pagehide"));
    } catch {}
    for (const store of [storage, session]) {
      try {
        store.flush();
      } catch {}
    }
  };

  process.on("unhandledRejection", (reason) => {
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: reason });
    events.dispatchEvent(event);
  });
  process.on("uncaughtExceptionMonitor", (error) => {
    const event = new Event("error");
    Object.defineProperty(event, "error", { value: error });
    Object.defineProperty(event, "message", { value: String(error?.message ?? error) });
    events.dispatchEvent(event);
    hidePage();
  });
  process.on("exit", hidePage);

  return { storage, setVisible, hidePage };
};

export const WEBRTC_NAMES = Object.freeze(["RTCPeerConnection", "RTCSessionDescription", "RTCIceCandidate", "RTCDataChannel"]);

export const installWebRtc = async () => {
  if (WEBRTC_NAMES.every((name) => typeof globalThis[name] === "function")) return true;
  try {
    const rtc = await import("node-datachannel/polyfill");
    for (const name of WEBRTC_NAMES) {
      if (typeof rtc[name] === "function") globalThis[name] = rtc[name];
    }
  } catch (error) {
    process.stderr.write(`[sidecar] WebRTC is not available: ${error?.message ?? error}\n`);
  }
  return WEBRTC_NAMES.every((name) => typeof globalThis[name] === "function");
};

await installWebRtc();
