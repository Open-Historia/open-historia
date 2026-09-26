/*! Open Historia — changes made outside the simulation, and the Game Master's reminders © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/gmChanges.test.js
//
// Two things the simulator was never told.
//
// 1. CHANGES. The cheats panel changes the world between turns: a country
//    annexed, a border redrawn region by region, a polity's stability set by
//    hand, a city placed, an event written into the record, the history
//    document rewritten, a turn rolled back. The GM console's AI-assisted
//    transactions are logged in world.gmAudit; the rest were logged nowhere. The
//    next skip saw the new state with no word of how it came about — a border
//    that moved with no event, a government that changed with no cause — and a
//    model shown an unexplained change tends to explain it, or to undo it.
//
//    So every such change is one line in world.gmChanges, tagged with the
//    round it happened in. The next time skip starts from that round, and it
//    opens with those lines (beside the application receipt): once, because the
//    round moves on when the skip lands; again after a rollback, because the
//    skip that heard them no longer happened.
//
// 2. REMINDERS. A standing note from the Game Master to every AI in the game —
//    the skip, the checks after it, the advisor, the leaders: "the Kerch bridge
//    is down", "the harvest has failed in the south". Every AI sees every
//    reminder — a leader included — so a reminder is for a fact, never a secret
//    (reports.js is where an audience is kept). Unlike the scenario's priority rules
//    (an author's rules for the whole game, worldDirection.js) a reminder is a
//    fact the GM declares mid-game, dated, one of a short list, removed when it
//    stops being true. Every prompt carries the whole list, so an edited one is
//    simply what the next prompt says — there is no delivered-once bookkeeping to
//    go stale. Withdrawing one IS a change of its own, so the next skip is told the
//    fact no longer holds.
//
// Import-free: gameState.js normalizes both on every read and write, the cheats
// panel records, gameplay.js and main.jsx render, and all of it is testable
// under bare node.

export const GM_CHANGES_LIMIT = 64;
export const GM_CHANGE_SUMMARY_MAX_CHARS = 280;
// What one skip is told. The rest are counted, not listed.
export const GM_CHANGES_NARRATED_MAX = 12;

export const REMINDERS_LIMIT = 12;
export const REMINDER_MAX_CHARS = 600;

// Where a change came from, so the narration can say so and the panel can group
// them. Anything else is "other" rather than lost.
export const GM_CHANGE_KINDS = Object.freeze([
  "gm-console",
  "territory",
  "groups",
  "polity",
  "stats",
  "feature",
  "timeline",
  "history",
  "rollback",
  "reminder",
  "setting",
  "other",
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => (Array.isArray(value) ? value : []);
const clip = (text, max) => {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};
const roundOf = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.trunc(Number(value)) : 0);

// An id from the entry's own content (FNV-1a), not from a clock or a counter: an
// entry that arrives without one is normalized on every read of the world, and
// it must come out with the same id every time.
const hash = (text) => {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
};
const stableId = (prefix, ...parts) => `${prefix}-${hash(parts.map(clean).join("|"))}`;

// A change made in many small steps — a border redrawn region by region — is one
// line, not thirty. A step recorded with a `group` key and an `item` joins the
// newest entry when that entry has the same key and round; its summary is the
// `template` with "{items}" standing for the names gathered so far.
export const GM_CHANGE_ITEMS_LIMIT = 40;
const ITEMS_SHOWN = 8;
const ITEMS_TOKEN = "{items}";

const renderItems = (items) => {
  const shown = items.slice(0, ITEMS_SHOWN).join(", ");
  return items.length > ITEMS_SHOWN ? `${shown} and ${items.length - ITEMS_SHOWN} more` : shown;
};

export const normalizeGmChange = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const kind = GM_CHANGE_KINDS.includes(clean(entry.kind)) ? clean(entry.kind) : "other";
  const at = clean(entry.at);
  const round = roundOf(entry.round);
  const group = clean(entry.group);
  const template = clean(entry.template);
  const items = [...new Set(array(entry.items).map(clean).filter(Boolean))].slice(0, GM_CHANGE_ITEMS_LIMIT);
  const grouped = Boolean(group && template.includes(ITEMS_TOKEN) && items.length);
  const summary = clip(grouped ? template.split(ITEMS_TOKEN).join(renderItems(items)) : entry.summary, GM_CHANGE_SUMMARY_MAX_CHARS);
  if (!summary) return null;
  return {
    id: clean(entry.id) || stableId("gm-change", kind, grouped ? `${group}|${round}|${items[0]}` : summary, round, at),
    kind,
    summary,
    round,
    date: clean(entry.date),
    at,
    ...(grouped ? { group, template, items } : {}),
  };
};

// Newest first, as world.gmAudit is; bounded; one entry per id.
export const normalizeGmChanges = (list) => {
  const seen = new Set();
  const out = [];
  for (const entry of array(list)) {
    const normalized = normalizeGmChange(entry);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
    if (out.length >= GM_CHANGES_LIMIT) break;
  }
  return out;
};

// A new world with the change recorded. The same change saved twice in a row in
// the same round (a form submitted twice, a tool re-run) is one change; a step
// of a grouped change joins the entry it belongs to.
export const recordGmChange = (world, { kind, summary, round, date, at = new Date().toISOString(), id, group, template, item } = {}) => {
  const base = world && typeof world === "object" ? world : {};
  const existing = normalizeGmChanges(base.gmChanges);
  const newest = existing[0];
  const stepOf = clean(group) && clean(item) ? clean(group) : "";
  if (stepOf && newest && newest.group === stepOf && newest.round === roundOf(round)) {
    const joined = normalizeGmChange({ ...newest, items: [...newest.items, item], at: newest.at });
    return { ...base, gmChanges: [joined, ...existing.slice(1)] };
  }
  const entry = normalizeGmChange(stepOf
    ? { id, kind, round, date, at, group: stepOf, template, items: [item] }
    : { id, kind, summary, round, date, at });
  if (!entry) return base;
  if (newest && newest.kind === entry.kind && newest.summary === entry.summary && newest.round === entry.round) {
    return { ...base, gmChanges: existing };
  }
  return { ...base, gmChanges: [entry, ...existing].slice(0, GM_CHANGES_LIMIT) };
};

// The changes a skip starting from `round` has not heard: those made in that
// round, oldest first so they read in the order they were made.
export const gmChangesForRound = (world, round) => {
  const target = roundOf(round);
  return normalizeGmChanges(world?.gmChanges)
    .filter((entry) => entry.round === target)
    .reverse();
};

// The changes made after a moment (an ISO timestamp), oldest first. How a
// conversation — the advisor — catches up since its last message.
export const gmChangesSince = (world, sinceAt) => {
  const since = Date.parse(clean(sinceAt));
  if (!Number.isFinite(since)) return [];
  return normalizeGmChanges(world?.gmChanges)
    .filter((entry) => {
      const at = Date.parse(entry.at);
      return Number.isFinite(at) && at > since;
    })
    .reverse();
};

const KIND_LABELS = Object.freeze({
  "gm-console": "GM console",
  territory: "territory",
  groups: "groups",
  polity: "country editor",
  stats: "statistics",
  feature: "map features",
  timeline: "event editor",
  history: "history document",
  rollback: "rollback",
  reminder: "reminder",
  setting: "setting",
  other: "other",
});

export const gmChangeKindLabel = (kind) => KIND_LABELS[clean(kind)] || KIND_LABELS.other;

// The block a skip opens with, after the application receipt. Empty when there
// is nothing to tell, so a campaign nobody has touched sends what it always did.
export const renderGmChangeNarration = (entries, { max = GM_CHANGES_NARRATED_MAX } = {}) => {
  const list = array(entries).map(normalizeGmChange).filter(Boolean);
  if (!list.length) return "";
  const shown = list.slice(-Math.max(1, max));
  const hidden = list.length - shown.length;
  return [
    "[CHANGES MADE OUTSIDE THE SIMULATION SINCE YOUR LAST TURN]",
    "The Game Master changed the world directly between your last turn and this one. These changes are canon, and the current map and records above already show them. They were acts of authority, not events inside the world: do not undo or contradict them, and do not write them up again as new events. Where a change would plainly be noticed inside the world, the reactions to it are yours to write.",
    ...(hidden > 0 ? [`(${hidden} earlier change${hidden === 1 ? "" : "s"} this round not listed.)`] : []),
    ...shown.map((entry) => `- ${entry.summary}${entry.kind === "other" ? "" : ` (${gmChangeKindLabel(entry.kind)})`}`),
  ].join("\n");
};

// ── Reminders ──────────────────────────────────────────────────────────────

export const normalizeReminder = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  // Line breaks are kept (a reminder may be a short list); runs of blank lines
  // and trailing space are not.
  const text = String(entry.text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .trim()
    .slice(0, REMINDER_MAX_CHARS);
  if (!text) return null;
  const at = clean(entry.at);
  const round = roundOf(entry.round);
  return {
    // Made once, when the reminder is issued, and stored with it from then on:
    // an edited reminder keeps the id it was given.
    id: clean(entry.id) || stableId("reminder", round, at, text),
    text,
    round,
    date: clean(entry.date),
    at,
  };
};

// In the order they were issued, oldest first: a list the GM reads top down.
export const normalizeReminders = (list) => {
  const seen = new Set();
  const out = [];
  for (const entry of array(list)) {
    const normalized = normalizeReminder(entry);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out.slice(-REMINDERS_LIMIT);
};

export const addReminder = (world, { text, round, date, at = new Date().toISOString(), id } = {}) => {
  const base = world && typeof world === "object" ? world : {};
  const reminder = normalizeReminder({ id, text, round, date, at });
  if (!reminder) return base;
  return { ...base, simulationReminders: normalizeReminders([...array(base.simulationReminders), reminder]) };
};

export const editReminder = (world, id, text) => {
  const base = world && typeof world === "object" ? world : {};
  const target = clean(id);
  return {
    ...base,
    simulationReminders: normalizeReminders(array(base.simulationReminders)
      .map((entry) => (clean(entry?.id) === target ? { ...entry, text } : entry))),
  };
};

// Withdrawing a reminder is a change the next skip must hear about: it has been
// told the fact every turn, and the absence of a line is not a retraction.
export const removeReminder = (world, id, { round, date, at = new Date().toISOString() } = {}) => {
  const base = world && typeof world === "object" ? world : {};
  const target = clean(id);
  const reminders = normalizeReminders(base.simulationReminders);
  const removed = reminders.find((entry) => entry.id === target);
  if (!removed) return base;
  const next = { ...base, simulationReminders: reminders.filter((entry) => entry.id !== target) };
  return recordGmChange(next, {
    kind: "reminder",
    summary: `Withdrew the reminder "${clip(removed.text, 200)}" — it no longer holds.`,
    round,
    date,
    at,
  });
};

// The standing block every AI in the game is given. Empty when there are none.
export const renderReminders = (reminders, { formatDate = (value) => value } = {}) => {
  const list = normalizeReminders(reminders);
  if (!list.length) return "";
  const dated = (entry) => {
    const when = entry.date ? clean(formatDate(entry.date)) : "";
    return when ? ` (since ${when})` : "";
  };
  return [
    "[REMINDERS FROM THE GAME MASTER]",
    "Standing facts and instructions the Game Master has issued for this game. They describe what is true now: they outrank the pre-game lore, the starting borders and anything written before them, and they stay in force until the Game Master withdraws them.",
    ...list.map((entry) => {
      const [first, ...rest] = entry.text.split("\n");
      return [`- ${first}${dated(entry)}`, ...rest.map((line) => (line ? `  ${line}` : ""))].join("\n");
    }),
  ].join("\n");
};
