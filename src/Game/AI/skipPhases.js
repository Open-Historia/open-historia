/*! Open Historia — the phases of a time skip, said while they run and timed after © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/skipPhases.test.js
//
// A skip is a handful of distinct pieces of work — reading the world, writing
// the events, the one review request, placing the armies and fronts, writing it
// all into the record, the board, the history — and the player was shown one
// word for all of it: "Simulating…". A 25-second skip that says nothing for 25
// seconds reads as a hung one; the review request that takes six of them is
// indistinguishable from the jump request that takes fifteen. And afterwards the
// log said how long the whole turn took and how many requests it used, never
// where either went.
//
// So the skip enters each phase by name as it starts it. The panel shows the
// phase's own words while it runs (D10), and when the skip lands the log gets
// one line: each phase, its time, and the requests made inside it (F5) — "25.8 s
// — reading the world 1.1 s · writing 1 month of events 16.9 s (1 request) ·
// checking the moves 6.2 s (1 request) · …". A phase entered twice (the writing
// of each segment) is one line, its times added.
//
// Import-free, with the clock and the request count handed in, so it is tested
// under bare node and the skip keeps its one budget as the source of truth.

export const SKIP_PHASES = Object.freeze({
  reading: "Reading the world",
  writing: "Writing the events",
  checking: "Checking the skip",
  placing: "Placing the armies and the fronts",
  applying: "Writing it into the record",
  board: "Updating the Projects board",
  history: "Folding older history into the history document",
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

// { enter(phase, { label, detail }), finish() → summary, current }
// `onChange({ phase, label, detail })` hears every phase as it starts; a throw
// there is the listener's problem, never the skip's.
export const createSkipPhases = ({ now = () => Date.now(), requestsUsed = () => 0, onChange = null } = {}) => {
  const entries = [];
  let current = null;
  let finished = null;

  const close = (at) => {
    if (!current) return;
    entries.push({
      phase: current.phase,
      label: current.label,
      ms: Math.max(0, at - current.startedAt),
      requests: Math.max(0, finite(requestsUsed()) - current.requestsAtStart),
    });
    current = null;
  };

  const tell = () => {
    if (!current || typeof onChange !== "function") return;
    try {
      onChange({ phase: current.phase, label: current.label, detail: current.detail });
    } catch { /* a listener that throws must never cost a turn */ }
  };

  return {
    enter(phase, { label = "", detail = "" } = {}) {
      if (finished) return;
      const at = now();
      close(at);
      current = {
        phase: clean(phase),
        label: clean(label) || SKIP_PHASES[clean(phase)] || clean(phase),
        detail: clean(detail),
        startedAt: at,
        requestsAtStart: finite(requestsUsed()),
      };
      tell();
    },
    finish() {
      if (!finished) {
        close(now());
        finished = summarizeSkipPhases(entries);
      }
      return finished;
    },
    get current() {
      return current?.phase ?? "";
    },
  };
};

// One line per phase in the order first entered; a phase entered again adds to
// its line. The label kept is the first one: "writing 1 month of events", not
// "part 3 of 3".
export const summarizeSkipPhases = (entries) => {
  const byPhase = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const phase = clean(entry?.phase);
    if (!phase) continue;
    const line = byPhase.get(phase) ?? { phase, label: clean(entry.label) || SKIP_PHASES[phase] || phase, ms: 0, requests: 0 };
    line.ms += Math.max(0, finite(entry.ms));
    line.requests += Math.max(0, finite(entry.requests));
    byPhase.set(phase, line);
  }
  const phases = [...byPhase.values()];
  return {
    phases,
    totalMs: phases.reduce((sum, line) => sum + line.ms, 0),
    requests: phases.reduce((sum, line) => sum + line.requests, 0),
  };
};

const seconds = (ms) => `${(Math.max(0, finite(ms)) / 1000).toFixed(1)} s`;

// The one line the log gets when a skip lands. A phase that took no time and
// made no request (a board with nothing to do) is left out of the line — it is
// still in the summary.
export const PHASE_LINE_MIN_MS = 50;

export const formatSkipPhases = (summary) => {
  const phases = (Array.isArray(summary?.phases) ? summary.phases : [])
    .filter((line) => line.requests > 0 || line.ms >= PHASE_LINE_MIN_MS);
  if (!phases.length) return "";
  return `${seconds(summary.totalMs)} — ${phases.map((line) => (
    `${line.label.charAt(0).toLowerCase()}${line.label.slice(1)} ${seconds(line.ms)}`
    + (line.requests ? ` (${line.requests} request${line.requests === 1 ? "" : "s"})` : "")
  )).join(" · ")}`;
};

// What the review is about to do, in the words the panel shows while it runs:
// the jobs it carries, not "checking".
const REVIEW_JOB_WORDS = Object.freeze({
  units: "moving the armies",
  territory: "redrawing the fronts",
  structures: "placing new structures",
  timeline: "checking the record",
  board: "updating the board",
});

export const describeReviewJobs = (jobKeys) => {
  const keys = (Array.isArray(jobKeys) ? jobKeys : []).map(clean).filter(Boolean);
  const agents = keys.filter((key) => !REVIEW_JOB_WORDS[key]).length;
  const words = [
    ...keys.map((key) => REVIEW_JOB_WORDS[key]).filter(Boolean),
    ...(agents ? [`hearing from ${agents === 1 ? "an agent" : `${agents} agents`}`] : []),
  ];
  if (!words.length) return SKIP_PHASES.checking;
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
};
