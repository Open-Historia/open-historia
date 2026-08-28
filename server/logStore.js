/*! Open Historia — diagnostic log store © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// One append-only JSONL file the whole app writes to: the Electron main process,
// this server, the page, and the AI layer. Bug reports arrive as "it broke" with
// nothing to go on, and the interesting state — which prompt was sent, what the
// model answered, which impacts were dropped — only ever existed in a console
// nobody had open.
//
// Lives under the writable data dir (server/dataDir.js), so it lands beside the
// saves in every build: server/data/logs for the zip, the Electron userData dir
// for the installed app, and the sandbox path on Android.

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir.js";

const LOG_DIR = path.join(DATA_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
// Five files of five megabytes. Big enough to hold a long session with full
// prompts, small enough that the whole set can be attached to a bug report.
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

const LEVELS = new Set(["debug", "info", "warn", "error"]);
const SOURCES = new Set(["main", "server", "client", "ai"]);

// Redaction happens HERE rather than at each caller. A key can reach this file
// from the page's provider settings, an AI request header, a relayed URL or a
// pasted error message, and a redactor placed at any one of those eventually
// misses a path. One choke point is the only version that stays true.
//
// Ordered widest-first: a bearer header wrapping a key must not be half-matched.
const REDACTIONS = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "$1-[redacted]"],
  [/\bAIza[A-Za-z0-9_-]{10,}/g, "[redacted-google-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "[redacted-github-token]"],
  // key-ish assignments in JSON, query strings or prose
  [/("?\b(?:api[_-]?key|apikey|access[_-]?token|authorization|password|secret)"?\s*[:=]\s*"?)([^"\s,&}]{6,})/gi, "$1[redacted]"],
];

export const redact = (value) => {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (typeof text !== "string") return text;
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text;
};

const rotate = () => {
  try {
    if (!fs.existsSync(LOG_FILE) || fs.statSync(LOG_FILE).size < MAX_BYTES) return;
    // Drop the oldest, shuffle the rest down, then move the live file aside.
    const oldest = `${LOG_FILE}.${MAX_FILES - 1}`;
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
    for (let index = MAX_FILES - 2; index >= 1; index -= 1) {
      const from = `${LOG_FILE}.${index}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${LOG_FILE}.${index + 1}`);
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // A failed rotation must never take the app down; the next append just
    // grows the current file a little further.
  }
};

// Never throws. Logging is diagnostics — a broken log must not become the
// failure it was meant to explain.
export const appendLog = (entry) => {
  try {
    const level = LEVELS.has(entry?.level) ? entry.level : "info";
    const source = SOURCES.has(entry?.source) ? entry.source : "client";
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      source,
      event: String(entry?.event ?? "").slice(0, 120),
      message: redact(String(entry?.message ?? "")).slice(0, 8000),
      // Free-form context: AI prompt/response bodies, request metadata, stacks.
      // Redacted as a whole so a key nested anywhere inside is caught too.
      ...(entry?.data === undefined ? {} : { data: redact(entry.data).slice(0, 200000) }),
    });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotate();
    fs.appendFileSync(LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // swallow: see above
  }
};

export const appendLogBatch = (entries) => {
  if (!Array.isArray(entries)) return 0;
  // Bounded so one bad client cannot write a gigabyte in a single request.
  const capped = entries.slice(0, 200);
  for (const entry of capped) appendLog(entry);
  return capped.length;
};

// Newest-last tail, for the in-app viewer. Reads only the live file: the
// rotated ones are for attaching to a report, not for browsing.
export const readLogTail = (limit = 500) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(5000, limit))).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { at: "", level: "warn", source: "server", event: "unparseable", message: line.slice(0, 500) };
      }
    });
  } catch {
    return [];
  }
};

export const logFilePath = () => LOG_FILE;
