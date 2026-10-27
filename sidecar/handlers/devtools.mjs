import crypto from "node:crypto";
import util from "node:util";
import vm from "node:vm";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const PREVIEW_BYTES = 64 * 1024;
const BACKLOG = 300;
const RESULT_CHARS = 20_000;
const LAG_RESOLUTION = 10;
const SECRET_QUERY = /([?&](?:key|api_key|apikey|access_token|token|secret)=)[^&#]*/gi;
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-goog-api-key|api-key|anthropic-api-key)$/i;
const AsyncFunction = (async () => {}).constructor;

const hideSecrets = (url) => String(url ?? "").replace(SECRET_QUERY, "$1•••");

const urlOf = (input) => {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url ?? "");
  if (raw.startsWith("/")) return `${globalThis.location?.origin ?? ""}${raw}`;
  return raw;
};

const headersOf = (source) => {
  const rows = [];
  if (!source) return rows;
  try {
    const list = source instanceof Headers ? [...source.entries()] : Array.isArray(source) ? source : Object.entries(source);
    for (const [name, value] of list) rows.push([String(name), SECRET_HEADER.test(String(name)) ? "•••" : String(value)]);
  } catch {}
  return rows;
};

const bodyPreview = (body) => {
  if (body === undefined || body === null) return { size: 0, text: "" };
  if (typeof body === "string") return { size: Buffer.byteLength(body), text: body.slice(0, PREVIEW_BYTES) };
  if (body instanceof URLSearchParams) return bodyPreview(body.toString());
  if (body instanceof ArrayBuffer) return { size: body.byteLength, text: `(${body.byteLength} bytes of binary data)` };
  if (ArrayBuffer.isView(body)) return { size: body.byteLength, text: `(${body.byteLength} bytes of binary data)` };
  if (typeof Blob !== "undefined" && body instanceof Blob) return { size: body.size, text: `(${body.size} bytes, ${body.type || "blob"})` };
  if (typeof FormData !== "undefined" && body instanceof FormData) return { size: 0, text: "(form data)" };
  return { size: 0, text: "(stream)" };
};

const texty = (type) => /json|text|xml|javascript|event-stream|x-www-form-urlencoded|geo\+json/i.test(String(type ?? ""));

const readClone = async (response) => {
  const chunks = [];
  let kept = 0;
  let size = 0;
  if (!response.body) return { size: 0, text: "" };
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (kept < PREVIEW_BYTES) {
      const piece = chunk.subarray(0, PREVIEW_BYTES - kept);
      chunks.push(piece);
      kept += piece.byteLength;
    }
  }
  const type = response.headers.get("content-type");
  const text = texty(type) || !type ? Buffer.concat(chunks).toString("utf8") : `(${size} bytes, ${type})`;
  return { size, text };
};

const entryView = (entry) => ({
  seq: Number(entry?.seq) || 0,
  at: String(entry?.at ?? ""),
  category: String(entry?.category ?? ""),
  message: String(entry?.message ?? ""),
  detail: String(entry?.detail ?? ""),
  problem: entry?.problem === true,
  repeat: Number(entry?.repeat) || 1,
});

const describe = (value) => {
  const text = typeof value === "string" ? JSON.stringify(value) : util.inspect(value, { depth: 3, maxArrayLength: 60, maxStringLength: 4000, breakLength: 100, colors: false });
  return text.length > RESULT_CHARS ? `${text.slice(0, RESULT_CHARS)}\n… ${text.length - RESULT_CHARS} more characters` : text;
};

export const register = (ctx) => {
  const { engine, emit, clean } = ctx;
  const scope = {
    engine: ctx.engine,
    api: ctx.api,
    storage: ctx.storage,
    plain: ctx.plain,
    gameView: ctx.gameView,
    mapState: ctx.mapState,
    regionRecords: ctx.regionRecords,
    repo: ctx.repo,
    dataRoot: ctx.dataRoot,
    cacheDir: ctx.cacheDir,
    $_: undefined,
  };
  let session = null;
  let fetchWatched = false;
  let nextHttp = 0;

  const sendHttp = (record) => {
    if (session) emit("devtools.http", record);
  };

  const traced = async (inner, input, init) => {
    nextHttp += 1;
    const id = nextHttp;
    const began = performance.now();
    const method = String(init?.method ?? (typeof input === "object" && !(input instanceof URL) ? input?.method : "") ?? "GET").toUpperCase() || "GET";
    const sent = bodyPreview(init?.body);
    sendHttp({ id, phase: "start", method, url: hideSecrets(urlOf(input)), requestHeaders: headersOf(init?.headers ?? (input instanceof Request ? input.headers : null)), requestSize: sent.size, requestBody: sent.text, at: Date.now() });
    let response;
    try {
      response = await inner(input, init);
    } catch (error) {
      sendHttp({ id, phase: "failed", error: clean(error?.message ?? error) || "The request failed.", duration: performance.now() - began });
      throw error;
    }
    const head = { id, phase: "response", status: response.status, statusText: response.statusText, type: response.headers.get("content-type") ?? "", headers: headersOf(response.headers), waited: performance.now() - began };
    sendHttp(head);
    let copy = null;
    try {
      copy = response.clone();
    } catch {
      copy = null;
    }
    if (copy) {
      readClone(copy)
        .then(({ size, text }) => sendHttp({ id, phase: "done", size, body: text, duration: performance.now() - began }))
        .catch((error) => sendHttp({ id, phase: "done", size: 0, body: `(the body could not be read: ${clean(error?.message ?? error)})`, duration: performance.now() - began }));
    } else {
      sendHttp({ id, phase: "done", size: Number(response.headers.get("content-length")) || 0, body: "", duration: performance.now() - began });
    }
    return response;
  };

  const watchFetch = () => {
    if (fetchWatched) return;
    fetchWatched = true;
    const inner = globalThis.fetch;
    globalThis.fetch = (input, init = undefined) => (session ? traced(inner, input, init) : inner(input, init));
  };

  const flushLog = () => {
    if (!session) return;
    session.logQueued = false;
    const fresh = (engine.getDebugLogEntries?.() ?? []).filter((entry) => Number(entry?.seq) > session.lastSeq);
    if (fresh.length === 0) return;
    session.lastSeq = Math.max(session.lastSeq, ...fresh.map((entry) => Number(entry.seq) || 0));
    emit("devtools.log", { entries: fresh.map(entryView) });
  };

  const onLog = () => {
    if (!session || session.logQueued) return;
    session.logQueued = true;
    setTimeout(flushLog, 40);
  };

  const end = () => {
    if (!session) return;
    session.unsubscribe?.();
    session.delay.disable();
    session = null;
  };

  const own = (key) => {
    if (!session || !key || key !== session.key) throw new Error("Only the open developer tools window can do this.");
  };

  const compile = (source) => {
    const names = Object.keys(scope);
    try {
      return { names, run: new AsyncFunction(...names, `return (${source}\n);`) };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    let problem;
    try {
      new vm.Script(source);
      return { names: ["__scope", "__source"], run: new AsyncFunction("__scope", "__source", "with (__scope) { return eval(__source); }"), bound: true };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      problem = error;
    }
    try {
      return { names, run: new AsyncFunction(...names, source) };
    } catch {
      throw problem;
    }
  };

  const failure = (error) => {
    if (!(error instanceof Error)) return `Uncaught ${describe(error)}`;
    if (error instanceof SyntaxError) return `Uncaught SyntaxError: ${error.message}`;
    const lines = String(error.stack ?? "").split("\n").slice(1).filter((line) => line.trim() && !line.includes("devtools.mjs") && !line.includes("sidecar/main.mjs") && !line.includes("(node:") && !line.includes("(<anonymous>)") && !line.includes("eval at compile"));
    return [`Uncaught ${error.name}: ${error.message}`, ...lines].join("\n");
  };

  return {
    "devtools.open": async () => {
      end();
      watchFetch();
      const entries = engine.getDebugLogEntries?.() ?? [];
      const delay = monitorEventLoopDelay({ resolution: LAG_RESOLUTION });
      delay.enable();
      session = { key: crypto.randomBytes(24).toString("hex"), lastSeq: 0, logQueued: false, delay, busy: performance.eventLoopUtilization(), cpu: process.cpuUsage(), cpuAt: performance.now(), unsubscribe: null };
      session.lastSeq = entries.reduce((most, entry) => Math.max(most, Number(entry?.seq) || 0), 0);
      session.unsubscribe = engine.subscribeToDebugLog?.(onLog) ?? null;
      return {
        key: session.key,
        backlog: entries.slice(-BACKLOG).map(entryView),
        pid: process.pid,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        origin: String(globalThis.location?.origin ?? ""),
      };
    },
    "devtools.close": async ({ key } = {}) => {
      if (session && key === session.key) end();
      return true;
    },
    "devtools.eval": async ({ key, code } = {}) => {
      own(key);
      const source = String(code ?? "").trim();
      if (!source) return { ok: true, type: "undefined", text: "undefined" };
      let value;
      try {
        const compiled = compile(source);
        value = compiled.bound ? await compiled.run(scope, source) : await compiled.run(...compiled.names.map((name) => scope[name]));
      } catch (error) {
        return { ok: false, type: "error", text: failure(error) };
      }
      scope.$_ = value;
      return { ok: true, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value, text: describe(value) };
    },
    "devtools.stats": async ({ key } = {}) => {
      own(key);
      const memory = process.memoryUsage();
      const { delay } = session;
      const ms = (value) => (Number.isFinite(value) ? Math.max(0, value / 1e6 - LAG_RESOLUTION) : 0);
      const lag = { mean: ms(delay.mean), max: ms(delay.max), p99: ms(delay.percentile(99)) };
      delay.reset();
      const busy = performance.eventLoopUtilization(session.busy);
      session.busy = performance.eventLoopUtilization();
      const now = performance.now();
      const used = process.cpuUsage(session.cpu);
      const elapsed = Math.max(1, now - session.cpuAt) * 1000;
      session.cpu = process.cpuUsage();
      session.cpuAt = now;
      return {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
        lag,
        loopBusy: busy.utilization * 100,
        cpu: ((used.user + used.system) / elapsed) * 100,
        uptime: process.uptime(),
        handles: typeof process.getActiveResourcesInfo === "function" ? process.getActiveResourcesInfo().length : 0,
      };
    },
  };
};
