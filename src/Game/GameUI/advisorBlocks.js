/*! Open Historia — portions (advisor fenced-block extraction & JSON recovery) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Pulling the machine-readable fences out of an advisor reply, and getting usable
// JSON out of them even when the model's is not quite valid.
//
// Lifted out of advisor.jsx so it can actually be tested: advisor.jsx is JSX and
// reaches assets.js -> maplibre-gl, so nothing in it can be unit-tested, and this
// is exactly the kind of string handling that needs to be. DELIBERATELY
// IMPORT-FREE, the same trick eventFocus.js uses, so its tests run in a bare
// checkout — which is also why the repairs below are reimplemented here rather
// than imported from gameplay.js's lenientJsonParse, whose behaviour they mirror.

const maybeJsonParse = (value) => {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? null : parsed;
  } catch {
    return null;
  }
};

// The slips a model actually makes when writing JSON by hand, in the order they
// turn up in the field. Mirrors gameplay.js's lenientJsonParse (curly quotes and
// trailing commas), plus the two this path has hit that it had not:
//
//   - Smart quotes. A model whose prose is full of typographic punctuation writes
//     JSON the same way, and one ” anywhere in a long array kills the whole block.
//     This is the FIRST suspect whenever a well-fenced block will not parse.
//   - Trailing commas before } or ].
//   - // and /* */ comments, which chatty models add to "explain" their payload.
//   - A wrapper object: {"projects": [...]} instead of a bare array.
//
// Repairs run ONLY after a strict parse fails, so well-formed output is never
// touched — the same discipline extractJsonPayload follows.
const REPAIRS = [
  (text) => text.replace(/[“”„‟]/g, '"'),
  (text) => text.replace(/,\s*([}\]])/g, "$1"),
  (text) => text.replace(/\/\/[^\n\r]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""),
];

export const lenientJsonParse = (value) => {
  const source = String(value ?? "");
  const direct = maybeJsonParse(source);
  if (direct) return direct;

  // Apply the repairs cumulatively: a block can easily have both smart quotes
  // and a trailing comma, and fixing one at a time would still fail.
  let repaired = source;
  for (const repair of REPAIRS) {
    repaired = repair(repaired);
    const parsed = maybeJsonParse(repaired);
    if (parsed) return parsed;
  }
  return null;
};

// The payload we want is an array of ops. Accept the shapes a model reaches for
// when it decides an array on its own is not self-describing enough.
const unwrapOpsArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["projects", "ops", "projectOps", "operations", "entries", "items", "data"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  // A single op sent bare rather than wrapped in an array.
  if (typeof value.op === "string") return [value];
  return null;
};

// Escapes what a model leaves unescaped INSIDE a JSON string value.
//
// The failure this exists for, straight from a field report: "Expected ',' or
// '}' after property value ... line 10". The model wrote
//   "summary":"A 1 GW reactor (the "Titan-class" megalith)."
// and that inner quote closes the string early, so the parser hits bare text
// where it wanted a comma. Same class of problem: a real line break inside a
// summary.
//
// Each property value is located by its BOUNDARY rather than by its closing
// quote — everything between :" and the quote that precedes either the next
// "key": or the object's end. That is what lets the inner quotes be found at all;
// scanning for the first closing quote is exactly the mistake the parser makes.
const escapeInnerStringChars = (value) => value
  // Normalise first so an already-escaped quote is not double-escaped: this
  // matches a literal backslash-quote, NOT a bare quote.
  .replace(/\\"/g, '"')
  .replace(/"/g, '\\"')
  .replace(/\r/g, "")
  .replace(/\n/g, "\\n")
  .replace(/\t/g, "\\t");

export const repairJsonStringValues = (text) => String(text ?? "").replace(
  /("(?:\\.|[^"\\])*"\s*:\s*)"([\s\S]*?)"(\s*(?:,\s*"(?:\\.|[^"\\])*"\s*:|,?\s*[}\]]))/g,
  (whole, key, value, tail) => `${key}"${escapeInnerStringChars(value)}"${tail}`,
);

// Parse one object's worth of text, trying progressively harder.
const parseObjectCandidate = (text) => {
  const trimmed = String(text ?? "").trim().replace(/,\s*$/, "");
  if (!trimmed.startsWith("{")) return null;
  const direct = lenientJsonParse(trimmed);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  const repaired = lenientJsonParse(repairJsonStringValues(trimmed));
  return repaired && typeof repaired === "object" && !Array.isArray(repaired) ? repaired : null;
};

// Splits an array body into one text per top-level object, WITHOUT relying on
// cumulative brace/string state.
//
// State-tracking is the obvious way to do this and the wrong one here: a single
// unescaped quote inverts the in-string flag and every brace after it is counted
// wrongly, so one bad entry corrupts the parse of every entry that follows. This
// re-anchors at each line that opens an object, so a bad entry costs exactly
// itself. Models emit these arrays one object per line almost without exception;
// a genuinely multi-line object still accumulates correctly, because its
// continuation lines start with a key or a brace-close, not with "{".
const splitObjectTexts = (body) => {
  const texts = [];
  let current = [];
  for (const line of String(body ?? "").split("\n")) {
    if (/^\s*\{/.test(line) && current.length > 0) {
      texts.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) texts.push(current.join("\n"));
  return texts;
};

// Recover as many entries as possible from a block, dropping only what is
// genuinely unreadable. Returns { ops, dropped } so the caller can tell the
// player that eight of ten landed rather than implying all of it did.
export const recoverOpsElementwise = (body) => {
  const texts = splitObjectTexts(String(body ?? "").replace(/^\s*\[/, "").replace(/\]\s*$/, ""));
  const ops = [];
  let dropped = 0;

  for (let index = 0; index < texts.length; index += 1) {
    const parsed = parseObjectCandidate(texts[index]);
    if (parsed) { ops.push(parsed); continue; }
    // A false split (a nested object that happened to start its own line) shows
    // up as two fragments that only parse once rejoined.
    const joined = index + 1 < texts.length ? parseObjectCandidate(`${texts[index]}\n${texts[index + 1]}`) : null;
    if (joined) { ops.push(joined); index += 1; continue; }
    if (texts[index].trim()) dropped += 1;
  }

  return { ops, dropped };
};

// Recovers a usable ops array from a block, whether it is merely malformed or
// genuinely cut off partway through.
//
// Two independent problems, handled in order:
//   1. The text is complete but invalid — smart quotes, a trailing comma, a
//      comment. lenientJsonParse repairs it.
//   2. The text stops mid-array. Walk it tracking string/escape state (so a brace
//      inside a string value never miscounts depth), remember the offset just past
//      each top-level element that closed cleanly, and rebuild from that.
//
// Returns null when nothing at all is recoverable, so callers can tell "salvaged
// some of it" from "there was nothing usable here".
export const repairTruncatedJsonArray = (text) => {
  const source = String(text ?? "").trim();
  if (!source) return null;

  // Whole-payload attempt first: this catches the complete-but-invalid case, and
  // an already-valid payload passes straight through untouched.
  const whole = unwrapOpsArray(lenientJsonParse(source));
  if (whole && whole.length > 0) return whole;

  // Tolerate a wrapper object around a truncated array by starting the walk at
  // the first bracket rather than demanding the text begin with one.
  const start = source.indexOf("[");
  if (start === -1) return null;
  const body = source.slice(start);

  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastCompleteEnd = -1;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === "[" || char === "{") {
      depth += 1;
    } else if (char === "]" || char === "}") {
      depth -= 1;
      // Back to depth 1 means a top-level element of the array just closed.
      if (depth === 1) lastCompleteEnd = index + 1;
      // Depth 0 means the array closed. Do NOT return here on a parse failure —
      // an otherwise complete array with one bad token still has every element
      // before it intact, and giving up would throw the whole board away over a
      // stray comma. Fall through to the reconstruction below instead.
      if (depth === 0) break;
    }
  }

  if (lastCompleteEnd !== -1) {
    const rebuilt = lenientJsonParse(`${body.slice(0, lastCompleteEnd)}]`);
    if (Array.isArray(rebuilt) && rebuilt.length > 0) return rebuilt;
  }

  // Last resort: recover entry by entry. This is what survives a single bad
  // entry in the MIDDLE of an otherwise good batch — the walk above gives up at
  // the corruption, this one keeps everything on both sides of it.
  const { ops } = recoverOpsElementwise(body);
  return ops.length > 0 ? ops : null;
};

// The text around the character a JSON parse failed at, for showing the player.
// V8's message carries "at position N"; without that, fall back to the head of
// the block, which is still better than nothing.
export const excerptAroundError = (body, message, radius = 140) => {
  const source = String(body ?? "");
  const match = /at position (\d+)/.exec(String(message ?? ""));
  if (!match) return source.slice(0, radius * 2).trim();
  const at = Number(match[1]);
  const from = Math.max(0, at - radius);
  const to = Math.min(source.length, at + radius);
  return `${from > 0 ? "…" : ""}${source.slice(from, to).trim()}${to < source.length ? "…" : ""}`;
};

// Extracts one fenced ```<lang> block (JSON payload) from a reply and strips it
// from the remaining text — the "prose + one machine-readable fence" convention
// the chart, actions, senddraft, deploy and projects blocks all ride.
//
// `salvageTruncated` opts a block into the recovery above. Use it for blocks big
// enough to be cut off or hand-written enough to be malformed; leave it off for
// the small ones, where an unterminated fence more likely means the model was
// talking ABOUT the format rather than using it, and salvaging would act on
// something it never meant to send.
//
// `streaming` says the reply is still arriving. An open fence then is not a
// broken block but one whose end has not come yet: its text is hidden from the
// bubble and nothing is salvaged or warned about. The final reply is parsed
// again once complete, and that parse is the one that counts. Without this every
// chunk of a streaming ```projects block logged "unterminated ... nothing
// salvageable" and re-ran the repair walk over it.
//
// Returns `reason` describing why nothing came back, so the UI can say something
// better than "it didn't work" and a bug report has something to go on.
export const extractFencedJson = (text, lang, { salvageTruncated = false, streaming = false } = {}) => {
  const regex = new RegExp("```" + lang + "\\s*([\\s\\S]*?)```");
  const match = text.match(regex);

  if (match) {
    const body = match[1];
    let json = null;
    let reason = "";
    let dropped = 0;
    let excerpt = "";
    try {
      json = JSON.parse(body.trim());
    } catch (err) {
      json = salvageTruncated ? repairTruncatedJsonArray(body) : null;
      excerpt = excerptAroundError(body, err.message);
      if (json === null) {
        reason = `invalid JSON (${err.message})`;
        console.warn(`[advisor] malformed \`\`\`${lang} block, dropping it:`, err.message);
        console.warn(`[advisor] the block that failed:\n${body.slice(0, 2000)}`);
      } else {
        // Something was recovered, but say how much was not: silently importing
        // eight of ten and implying ten is worse than importing eight and saying so.
        dropped = Math.max(0, recoverOpsElementwise(body).dropped);
        console.warn(`[advisor] repaired a malformed \`\`\`${lang} block (${err.message})`);
      }
    }
    return { rest: text.replace(regex, ""), json, truncated: false, reason, dropped, excerpt };
  }

  if (!salvageTruncated && !streaming) return { rest: text, json: null, truncated: false, reason: "", dropped: 0, excerpt: "" };

  const openRegex = new RegExp("```" + lang + "\\s*");
  const open = text.match(openRegex);
  if (!open) return { rest: text, json: null, truncated: false, reason: "", dropped: 0, excerpt: "" };
  if (streaming) return { rest: text.slice(0, open.index), json: null, truncated: false, reason: "", dropped: 0, excerpt: "" };

  // Everything after the opening fence is the (incomplete) payload. Report
  // `truncated` even when the repair works, so the caller can tell the player the
  // reply was cut short and some of it may be missing.
  const body = text.slice(open.index + open[0].length);
  const json = repairTruncatedJsonArray(body);
  if (json === null) {
    console.warn(`[advisor] unterminated \`\`\`${lang} block and nothing salvageable in it`);
    console.warn(`[advisor] the block that failed:\n${body.slice(0, 2000)}`);
  }
  return {
    rest: text.slice(0, open.index),
    json,
    truncated: true,
    reason: json === null ? "cut off before any entry finished" : "",
    dropped: 0,
    excerpt: json === null ? String(body ?? "").slice(0, 280).trim() : "",
  };
};

// Did the model clearly TRY to send a projects block that we could not use?
//
// Without this, the ways it can go wrong — no fence at all, an unterminated fence
// with nothing salvageable, JSON too broken to repair, valid JSON whose every op
// was rejected — all look identical to the player: a wall of JSON in the chat (or
// a reply that just stops) and a board that never changes.
// Kept in step with normalizeProjectOp's verb list BY HAND — the two live in
// different modules (this one is deliberately import-free so its tests run in a
// bare checkout) and nothing can check them against each other. A verb missing
// here is not a dropped op; it is a SILENT one: the block fails to parse, this
// says "not a projects block", and the player gets no "Board not fully updated"
// warning at all. cancelled/shelve/fail/failed/drop were all missing.
const PROJECT_OP_VERBS = [
  "create", "start", "launch", "open", "add",
  "update", "progress", "edit",
  "milestone",
  "complete", "finish", "completed",
  "cancel", "cancelled", "abandon", "shelve",
  "fail", "failed",
  "remove", "delete", "drop",
].join("|");

export const looksLikeProjectOps = (text) => {
  const source = String(text ?? "");
  if (!source.includes('"op"') && !source.includes("“op”")) return false;
  return new RegExp(`["“]op["”]\\s*:\\s*["“](${PROJECT_OP_VERBS})["”]`).test(source)
    && /["“](name|project|projectId)["”]\s*:/.test(source);
};

// ── Charts, and what happened to a reply's blocks ─────────────────────────────
//
// The advisor draws a chart by writing a ```chart fence with a Chart.js config
// in it. The references do this with a typed output function per chart and a
// receipt that says whether it rendered; here the fence stays (it works on every
// provider, a function only where functions do), and the two things the fence
// was missing are added:
//
//   - a check BEFORE it is drawn. AdvisorChart read config.data.datasets
//     unguarded, so a config without data threw during render — a broken
//     bubble at best. A chart that fails the check is not drawn; the panel says
//     why in a line of its own.
//   - a receipt. The advisor never learned that a chart did not draw, or that
//     its actions or board block half landed, and would build on it. What went
//     wrong with a reply is kept on it and told to the advisor ahead of the next
//     question (AI/conversationCatchUp.js), once.

// The types the advisor's prompt permits, and the only ones AdvisorChart lays
// out correctly (every other type gets x/y axes).
export const CHART_TYPES = Object.freeze(["bar", "line", "pie", "doughnut"]);

// "4.2%", "1,200", " 42 " → numbers; anything else a gap, which Chart.js draws
// as one rather than failing.
const chartNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").replace(/[,%\s]/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

// { config, problem }: a config safe to hand AdvisorChart, or why not.
export const validateChartConfig = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { config: null, problem: "the chart block was not a Chart.js config object" };
  }
  const type = String(value.type ?? "").trim().toLowerCase();
  if (!CHART_TYPES.includes(type)) {
    return { config: null, problem: `"${String(value.type ?? "")}" is not a chart type the panel can draw; use one of ${CHART_TYPES.join(", ")}` };
  }
  const labels = Array.isArray(value.data?.labels) ? value.data.labels.map((label) => String(label ?? "")) : [];
  if (!labels.length) return { config: null, problem: "the chart had no data.labels" };
  const datasets = (Array.isArray(value.data?.datasets) ? value.data.datasets : [])
    .filter((dataset) => dataset && typeof dataset === "object")
    .map((dataset) => ({ ...dataset, data: Array.isArray(dataset.data) ? dataset.data.map(chartNumber) : [] }))
    .filter((dataset) => dataset.data.some((point) => point !== null));
  if (!datasets.length) return { config: null, problem: "none of the chart's data.datasets had a number in it" };
  const options = value.options && typeof value.options === "object" && !Array.isArray(value.options) ? value.options : {};
  return { config: { ...value, type, data: { ...value.data, labels, datasets }, options }, problem: "" };
};

// Everything that went wrong with one stored advisor reply, as sentences the
// advisor can act on. Reads only what the panel stored on the message.
export const describeReplyProblems = (message) => {
  if (!message || typeof message !== "object") return [];
  const problems = [];
  const chart = String(message.chartProblem ?? "").trim();
  if (chart) problems.push(`your chart was not drawn: ${chart}`);
  // One list per block the panel turns into buttons or queue edits: a button
  // that was never drawn is an offer the advisor must not build on.
  for (const [field, block] of [
    ["actionsProblems", "actions"],
    ["draftProblems", "senddraft"],
    ["institutionDraftProblems", "institutiondraft"],
    ["deployProblems", "deploy"],
  ]) {
    for (const line of Array.isArray(message[field]) ? message[field] : []) {
      const text = String(line ?? "").trim();
      if (text) problems.push(`in your ${block} block, ${text}`);
    }
  }
  const detail = String(message.projectsDetail ?? "").trim();
  switch (String(message.projectsProblem ?? "")) {
    case "partial": problems.push(`in your projects block, ${detail || "some entries were malformed and skipped"}`); break;
    case "unusable": problems.push(`your projects block could not be used: ${detail || "nothing in it applied"}`); break;
    case "truncated": problems.push("your projects block was cut off by the reply's length limit, so its last entries may be missing"); break;
    case "truncated-empty": problems.push("your projects block was cut off before any entry finished, so nothing on the board changed"); break;
    default: break;
  }
  return problems;
};

// ── The actions block and the deploy block ────────────────────────────────────

// What the advisor's ```actions proposal does to the queue, worked out without
// touching it: advisor.jsx reads the queue, calls this, reverts `reverts` and
// writes `next`. `normalize` is gameState.js normalizeActionEntry, passed in so
// this file stays import-free.
//
// Returns { next, items, problems, reverts }:
//   - items: what the confirmation card shows ("added", "updated", "removed");
//   - problems: what the advisor asked for and did not get, in sentences — its
//     receipt, told to it before the next question;
//   - reverts: the unitRevert of every planned troop order removed, which the
//     caller undoes on the map as the Actions panel's delete does (#368). A
//     placed deployment whose order left the queue otherwise stayed on the map
//     for good, and the simulation was never told about it.
export const planAdvisorActionEdits = (current, proposal, normalize) => {
  let next = Array.isArray(current) ? [...current] : [];
  const items = [];
  const problems = [];
  const reverts = [];
  if (!Array.isArray(proposal)) return { next, items, problems, reverts };

  for (const raw of proposal) {
    if (!raw || typeof raw !== "object") {
      problems.push("an entry was not an object and was ignored");
      continue;
    }
    const id = String(raw.id ?? "").trim();

    if (raw.remove) {
      if (!id) {
        problems.push("a removal named no id, so nothing was removed");
        continue;
      }
      const removed = next.filter((action) => action.id === id);
      if (removed.length === 0) {
        problems.push(`the removal of ${id} matched no queued action, so nothing was removed`);
        continue;
      }
      next = next.filter((action) => action.id !== id);
      for (const action of removed) {
        // Only a planned order still has something to undo: one a skip already
        // resolved keeps its outcome (actions.jsx handleDelete).
        if (action.unitRevert && (action.status ?? "planned") === "planned") reverts.push(action.unitRevert);
      }
      items.push({ change: "removed", title: raw.title || removed[0].title || id });
      continue;
    }

    const existingIndex = id ? next.findIndex((action) => action.id === id) : -1;
    if (existingIndex !== -1) {
      const existing = next[existingIndex];
      const updated = {
        ...existing,
        ...(raw.title ? { title: String(raw.title) } : {}),
        ...(raw.text ? { text: String(raw.text) } : {}),
        ...(raw.kind === "chat" || raw.kind === "action" ? { kind: raw.kind } : {}),
      };
      next[existingIndex] = updated;
      items.push({ change: "updated", title: updated.title });
      continue;
    }

    // No id, or an id that doesn't match anything current — either a genuinely
    // new proposal, or the model referencing a stale/already-resolved id. Both
    // land as a fresh queued action rather than being silently dropped — and
    // the second is said, because the advisor believes it edited something.
    const created = normalize({
      title: raw.title,
      text: raw.text,
      kind: raw.kind === "chat" ? "chat" : "action",
      source: "advisor",
      status: "planned",
    });
    if (!created) {
      problems.push(id
        ? `the edit of ${id} matched no queued action and had no title or text, so nothing was queued`
        : "an entry had no title or text, so nothing was queued");
      continue;
    }
    if (id) problems.push(`the edit of ${id} matched no queued action, so it was queued as a new one`);
    next.push(created);
    items.push({ change: "added", title: created.title });
  }

  return { next, items, problems, reverts };
};

// Every type deployUnit can place. The scenario may allow fewer
// (world.allowedUnitTypes, the Forces panel's list).
export const DEPLOYABLE_UNIT_TYPES = Object.freeze(["infantry", "armor", "air", "naval", "artillery", "garrison"]);

// The ```deploy entries that become "Place" buttons, each with `index`: its
// place among the well-formed entries, which is what a message's
// placedDeployments records. It does not move when the scenario's allowed
// types change, so a button already placed stays marked as placed.
//
// Filtered hard: a button that places a unit somewhere unusable is worse than
// no button, so anything missing a real type, a name or real coordinates goes,
// and so does a type the scenario does not allow. Each drop is said in
// `problems`, so the advisor learns which of its buttons were never drawn.
export const filterAdvisorDeployments = (raw, allowedTypes = null, problems = []) => {
  if (!Array.isArray(raw)) return [];
  const allowed = Array.isArray(allowedTypes) && allowedTypes.length
    ? allowedTypes.map((type) => String(type ?? "").trim().toLowerCase()).filter(Boolean)
    : null;
  const wellFormed = [];
  raw.forEach((entry, position) => {
    const label = String(entry?.name ?? "").trim() ? `"${String(entry.name).trim()}"` : `entry ${position + 1}`;
    if (!entry || typeof entry !== "object") {
      problems.push(`entry ${position + 1} was not an object, so no button was drawn for it`);
      return;
    }
    const type = String(entry.type ?? "").trim().toLowerCase();
    const lng = Number(entry.lng);
    const lat = Number(entry.lat);
    if (!DEPLOYABLE_UNIT_TYPES.includes(type)) {
      problems.push(`${label} had the type "${String(entry.type ?? "")}", which is not one of ${DEPLOYABLE_UNIT_TYPES.join(", ")}, so no button was drawn for it`);
    } else if (!String(entry.name ?? "").trim()) {
      problems.push(`${label} had no name, so no button was drawn for it`);
    } else if (!Number.isFinite(lng) || !Number.isFinite(lat) || (lng === 0 && lat === 0)) {
      problems.push(`${label} had no real lng/lat, so no button was drawn for it`);
    } else {
      wellFormed.push(entry);
    }
  });
  return wellFormed
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => {
      if (!allowed || allowed.includes(String(entry.type).trim().toLowerCase())) return true;
      problems.push(`"${String(entry.name).trim()}" is ${String(entry.type).trim().toLowerCase()}, which this scenario does not allow (only ${allowed.join(", ")}), so no button was drawn for it`);
      return false;
    });
};
