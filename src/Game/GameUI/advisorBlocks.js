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

  if (lastCompleteEnd === -1) return null;

  const rebuilt = lenientJsonParse(`${body.slice(0, lastCompleteEnd)}]`);
  return Array.isArray(rebuilt) && rebuilt.length > 0 ? rebuilt : null;
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
    try {
      json = JSON.parse(body.trim());
    } catch (err) {
      json = salvageTruncated ? repairTruncatedJsonArray(body) : null;
      if (json === null) {
        reason = `invalid JSON (${err.message})`;
        console.warn(`[advisor] malformed \`\`\`${lang} block, dropping it:`, err.message);
        console.warn(`[advisor] the block that failed:\n${body.slice(0, 2000)}`);
      } else {
        console.warn(`[advisor] repaired a malformed \`\`\`${lang} block (${err.message})`);
      }
    }
    return { rest: text.replace(regex, ""), json, truncated: false, reason };
  }

  if (!salvageTruncated) return { rest: text, json: null, truncated: false, reason: "" };

  const openRegex = new RegExp("```" + lang + "\\s*");
  const open = text.match(openRegex);
  if (!open) return { rest: text, json: null, truncated: false, reason: "" };

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
