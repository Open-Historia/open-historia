import fs from "node:fs";
import path from "node:path";

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
    writeAtomic(this.#file, JSON.stringify(Object.fromEntries(this.#items)));
  }

  #schedule() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.flush(), 250);
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
  let visible = true;

  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.dispatchEvent = events.dispatchEvent.bind(events);
  globalThis.location = new URL(`${origin}/`);
  globalThis.localStorage = storage;
  globalThis.sessionStorage = new PersistentStorage(path.join(path.dirname(storageFile), "session-storage.json"));
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

  return { storage, setVisible };
};
