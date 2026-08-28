/*! Open Historia — client-side diagnostic logging © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Ships page-side events to the server's log file (server/logStore.js), which is
// the one place the whole app writes to.
//
// Deliberately routed through the server rather than an Electron preload: the
// game window has no preload on purpose — attaching one is what broke the app
// last time (see electron/main.cjs, which routes the build id the same way).
// Going through the API also means the zip build, Termux and the website all log
// the same way, with no per-platform branch.

const ENDPOINT = "/api/log";
// Batched because a render loop that throws can produce hundreds of identical
// errors a second, and one request per error would turn a bug into an outage.
const FLUSH_MS = 2000;
const MAX_QUEUE = 200;

let queue = [];
let timer = null;
let installed = false;
// Set false after a failed POST so a server that is gone (or a website build with
// no local server) stops retrying every two seconds forever.
let enabled = true;

const flush = async () => {
  timer = null;
  if (!enabled || queue.length === 0) return;
  const entries = queue;
  queue = [];
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
      keepalive: true, // survives the page being closed mid-flush
    });
  } catch {
    // Never re-queue: the failure is usually "no server", and holding the
    // entries would grow the queue without bound for the rest of the session.
    enabled = false;
  }
};

const schedule = () => {
  if (timer || !enabled) return;
  timer = setTimeout(flush, FLUSH_MS);
};

export const logEvent = (entry) => {
  if (!enabled) return;
  if (queue.length >= MAX_QUEUE) {
    // Drop the oldest rather than the newest: whatever is happening NOW is what
    // the reporter is looking at.
    queue.shift();
  }
  queue.push({ source: "client", level: "info", ...entry });
  // Errors go out promptly — a crash that takes the tab with it should not lose
  // the entry that explains it.
  if (entry?.level === "error") flush();
  else schedule();
};

// Convenience wrapper for the AI layer, which has the most useful context and the
// least visibility today.
export const logAi = (event, message, data, level = "info") =>
  logEvent({ source: "ai", level, event, message, data });

const describe = (error) => ({
  message: String(error?.message ?? error ?? "unknown error"),
  data: error?.stack ? { stack: String(error.stack).slice(0, 8000) } : undefined,
});

export const installLogClient = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const described = describe(event.error ?? event.message);
    logEvent({
      level: "error",
      event: "window.error",
      message: described.message,
      data: {
        ...(described.data ?? {}),
        source: `${event.filename ?? ""}:${event.lineno ?? 0}:${event.colno ?? 0}`,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const described = describe(event.reason);
    logEvent({ level: "error", event: "unhandled.rejection", ...described });
  });

  // Page identity, so a report's log says which build and which browser it came
  // from without the reporter having to know.
  logEvent({
    event: "session.start",
    message: "Page loaded",
    data: {
      build: import.meta.env.VITE_APP_BUILD || "dev",
      userAgent: navigator.userAgent,
      href: location.href,
    },
  });

  // A close mid-batch would otherwise lose the last two seconds, which is
  // exactly the window a crash lands in.
  window.addEventListener("pagehide", flush);
};
