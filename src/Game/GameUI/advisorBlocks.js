/*! Open Historia — portions (advisor fenced-block extraction & JSON recovery) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
// Returns `reason` describing why nothing came back, so the UI can say something
// better than "it didn't work" and a bug report has something to go on.
export const extractFencedJson = (text, lang, { salvageTruncated = false } = {}) => {
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

  if (!salvageTruncated) return { rest: text, json: null, truncated: false, reason: "", dropped: 0, excerpt: "" };

  const openRegex = new RegExp("```" + lang + "\\s*");
  const open = text.match(openRegex);
  if (!open) return { rest: text, json: null, truncated: false, reason: "", dropped: 0, excerpt: "" };

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
export const looksLikeProjectOps = (text) => {
  const source = String(text ?? "");
  if (!source.includes('"op"') && !source.includes("“op”")) return false;
  return /["“]op["”]\s*:\s*["“](create|start|launch|open|add|update|progress|edit|milestone|complete|finish|completed|remove|cancel|abandon|delete)["”]/.test(source)
    && /["“](name|project|projectId)["”]\s*:/.test(source);
};
