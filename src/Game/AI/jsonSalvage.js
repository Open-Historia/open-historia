/*! Open Historia — model-output JSON salvage © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Turning whatever a model actually said back into the payload the schema
// wants. Kept import-free (and separate from gameplay.js, which pulls in the
// whole browser runtime) so the salvage rules can be unit-tested directly —
// see jsonSalvage.test.js.

const normalizeString = (value) => String(value ?? "").trim();

const maybeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// Parse, and when that fails, repair the JSON slips small local models make
// most: trailing commas before } or ], and curly "smart" quotes as string
// delimiters. Repairs are only ever attempted AFTER a strict parse failed, so
// well-formed output is never touched.
const lenientJsonParse = (value) => {
  const direct = maybeJsonParse(value);
  if (direct) return direct;
  const repaired = value
    .replace(/[“”]/g, '"')
    .replace(/,\s*([}\]])/g, "$1");
  return maybeJsonParse(repaired)
    ?? maybeJsonParse(escapeInnerQuotes(repaired))
    ?? maybeJsonParse(repairLooseJson(repaired))
    ?? maybeJsonParse(escapeInnerQuotes(repairLooseJson(repaired)));
};

// An answer written as a JavaScript object rather than as JSON: keys with no
// quotes, strings in single quotes, a comment, a comma before a closing brace.
//
// It is what a model reaches for when the contract it was shown is not JSON
// either. The first real time skip asked of Gemini as JSON text (2026-10-05,
// gemini-3.5-flash-lite, the contract as an outline in the prompt) wrote its
// top level and its events as JSON and then, three levels down, this:
//     "unitOps": [ { op: "spawn", unit: { name: "Northern Vanguard Task Force", ...
// The whole answer stopped parsing over the missing quotes, and the skip cost a
// second request to be told what the first one had already said. The mime type
// application/json does not hold that model to JSON's syntax; only a response
// schema does, and the skip's contract does not fit in one (schemaOutline.js).
//
// Rewritten to JSON, string by string so nothing inside a string is touched:
//   a bare word in key position (after `{` or a `,` in an object, before `:`)
//   gets its quotes; a 'single-quoted' string becomes a "double-quoted" one;
//   // and /* */ comments go; a comma before `}` or `]` goes; and so does a `?`
//   between a key and its `:`, the outline's mark for an optional field copied
//   into the answer with the key.
// Nothing is invented and no value is reinterpreted: text that was not such an
// object comes back changed in none of those ways and still does not parse.
// Like every repair here it is tried only after a strict parse failed.
const WORD_START = /[A-Za-z_$]/;
const WORD_CHAR = /[A-Za-z0-9_$]/;
const BLANK = /\s/;

export const repairLooseJson = (text) => {
  const source = String(text ?? "");
  const length = source.length;
  const out = [];
  const stack = [];
  // Whether a word met here would be a key: just inside an object, or after a
  // comma in one.
  let keyPosition = false;
  let at = 0;
  const dropTrailingComma = () => {
    let end = out.length - 1;
    while (end >= 0 && BLANK.test(out[end])) end -= 1;
    if (end >= 0 && out[end] === ",") out.splice(end, 1);
  };
  while (at < length) {
    const char = source[at];
    if (char === '"') {
      let end = at + 1;
      let escaped = false;
      while (end < length) {
        const inner = source[end];
        if (escaped) escaped = false;
        else if (inner === "\\") escaped = true;
        else if (inner === '"') break;
        end += 1;
      }
      out.push(source.slice(at, Math.min(end + 1, length)));
      at = end + 1;
      keyPosition = false;
      continue;
    }
    if (char === "'") {
      let end = at + 1;
      let value = "";
      while (end < length && source[end] !== "'") {
        if (source[end] === "\\" && end + 1 < length) {
          value += source[end + 1] === "'" ? "'" : source[end] + source[end + 1];
          end += 2;
          continue;
        }
        value += source[end] === '"' ? "\\\"" : source[end];
        end += 1;
      }
      out.push(`"${value}"`);
      at = end + 1;
      keyPosition = false;
      continue;
    }
    if (char === "/" && source[at + 1] === "/") {
      while (at < length && source[at] !== "\n") at += 1;
      continue;
    }
    if (char === "/" && source[at + 1] === "*") {
      const end = source.indexOf("*/", at + 2);
      at = end === -1 ? length : end + 2;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      keyPosition = char === "{";
      out.push(char);
      at += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      dropTrailingComma();
      stack.pop();
      keyPosition = false;
      out.push(char);
      at += 1;
      continue;
    }
    if (char === ",") {
      keyPosition = stack[stack.length - 1] === "{";
      out.push(char);
      at += 1;
      continue;
    }
    if (char === ":") {
      keyPosition = false;
      out.push(char);
      at += 1;
      continue;
    }
    // `"note"?: "..."`, or `note?: "..."`: nothing else puts a ? before a colon
    // outside a string.
    if (char === "?") {
      let after = at + 1;
      while (after < length && BLANK.test(source[after])) after += 1;
      if (source[after] === ":") {
        at += 1;
        continue;
      }
    }
    if (keyPosition && WORD_START.test(char)) {
      let end = at + 1;
      while (end < length && WORD_CHAR.test(source[end])) end += 1;
      let after = end;
      if (source[after] === "?") after += 1;
      while (after < length && BLANK.test(source[after])) after += 1;
      if (source[after] === ":") {
        out.push(`"${source.slice(at, end)}"`);
        at = end;
        keyPosition = false;
        continue;
      }
    }
    out.push(char);
    at += 1;
  }
  return out.join("");
};

// One value out of a text that is JSON or nearly: strict, then every repair
// above. Null when none of them makes it parse. For a caller that already has
// exactly the text of one value (streamedEvents.js, one finished event).
export const parseLooseJson = (text) => lenientJsonParse(String(text ?? ""));

// A quote copied into a string without its backslash. The board prompt titles
// entries `Operation "Name"`, and a model copying that into its answer wrote
// `"name":"Operation "Name""` — one unescaped pair, and the whole reply stopped
// being JSON, which held the turn (a DeepSeek V4 Flash field report).
//
// Inside a string, a quote can only END it if what follows is a separator (`,`
// `:` `}` `]`) or the end of the text; any other quote is content and gets its
// backslash. Only reached after a strict parse AND the other repairs failed, so
// well-formed output is never touched, and whatever this produces still has to
// pass the schema.
const escapeInnerQuotes = (text) => {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      const next = text.slice(i + 1).match(/^\s*(.?)/)[1];
      if (next === "" || ",:}]".includes(next)) {
        inString = false;
      } else {
        out += "\\\"";
        continue;
      }
    }
    out += ch;
  }
  return out;
};

const closersFor = (stack) => stack
  .map((ch) => (ch === "{" ? "}" : "]"))
  .reverse()
  .join("");

// Every balanced top-level {...} or [...] block in the text, string-aware, in
// order of appearance. A greedy first-{-to-last-} regex dies when the model
// writes prose containing a brace after its JSON, or emits two objects; walking
// candidates and parsing each one survives both.
//
// A block left OPEN when the text runs out yielded nothing at all, so a turn
// whose only flaw was a forgotten closing bracket — the model opening two
// arrays around a mimicked tool call and closing one — was discarded whole to
// the canned fallback. That one shape gets its missing closers appended and is
// offered as a last-resort candidate, after every intact block.
//
// The repair is deliberately narrow, because the alternative is worse than the
// fallback: closing off a response that was genuinely cut off mid-flight would
// apply a shortened turn — some of the events, some of the projectOps — while
// presenting it as the whole thing. A turn either lands as the model wrote it
// or it falls back; it never half-lands. So a fragment is repaired ONLY when
// appending the closers cannot change its content, which needs all three:
//   - the text ends outside a string, on a closed value (`}` or `]`), so no
//     token is sitting half-written;
//   - every unclosed container is an ARRAY — an unclosed object is missing a
//     key/value pair by definition, so its content is not yet knowable;
//   - each of those arrays holds exactly ONE member (no comma at its level),
//     which is the tool-call envelope and nothing else. Two members means the
//     model was mid-list and a third may have been lost.
// Anything else — mid-string, mid-number, a dangling comma, an open object, a
// half-written array — is left unparseable on purpose.
const CLOSED_VALUE_TAIL = /[}\]]$/;

const balancedJsonCandidates = (text) => {
  const candidates = [];
  const repairs = [];
  const stack = [];
  // Commas seen at each still-open level, i.e. how many members that container
  // has already taken on. Parallel to `stack`.
  const commas = [];
  let start = -1;
  let inString = false;
  let escaped = false;
  const open = (ch) => {
    stack.push(ch);
    commas.push(0);
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (start === -1) {
      if (ch === "{" || ch === "[") {
        start = i;
        stack.length = 0;
        commas.length = 0;
        open(ch);
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = inString;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === "{" || ch === "[") open(ch);
      else if (ch === ",") commas[commas.length - 1] += 1;
      else if (ch === "}" || ch === "]") {
        stack.pop();
        commas.pop();
        if (stack.length === 0) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  if (start !== -1 && !inString && stack.length
      && stack.every((ch, level) => ch === "[" && commas[level] === 0)) {
    const fragment = text.slice(start).trimEnd();
    if (CLOSED_VALUE_TAIL.test(fragment)) repairs.push(`${fragment}${closersFor(stack)}`);
  }
  // Objects first: the payload is an object, and a stray inline array (e.g. in
  // the model's commentary) must not shadow it.
  candidates.sort((a, b) => (a[0] === "{" ? 0 : 1) - (b[0] === "{" ? 0 : 1));
  return [...candidates, ...repairs];
};

// Some openai-compatible endpoints/models (seen with nvidia/nemotron models)
// are asked to call the tool (tool_choice: "required") but don't actually
// populate tool_calls — they answer with a normal text message that just
// writes out what a tool call would look like, e.g.
// `[{ "name": "submit_jump_result", "parameters": { events: [...], ... } }]`,
// sometimes wrapped in an extra array. response.toolInput is null in that
// case (there is no real tool_calls entry to extract), and extractJsonPayload
// happily parses the text into that wrapper shape rather than the bare
// arguments object the schema expects, so it fails validation (or, if the
// wrapping breaks strict JSON parsing, fails to parse at all) and the whole
// turn is discarded to the canned fallback. Unwrap it back to the actual
// arguments object so the real content underneath still gets applied.
export const unwrapMimickedToolCall = (value, toolName) => {
  let current = value;
  for (let hops = 0; hops < 3 && Array.isArray(current) && current.length === 1; hops += 1) {
    current = current[0];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return value;
  const name = normalizeString(current.name);
  if (toolName && name && name !== toolName) return value;
  // getGameplayTool returns null for tasks with no registered tool, so a name
  // match can't always be demanded. When there is nothing to check against,
  // require the wrapper to be NOTHING BUT an envelope — a real payload that
  // happened to carry `name`/`parameters` would bring its own other fields
  // along, and unwrapping it would throw the rest of the turn away.
  if (!toolName || !name) {
    const envelopeKeys = new Set(["name", "parameters", "arguments", "input"]);
    if (Object.keys(current).some((key) => !envelopeKeys.has(key))) return value;
  }
  let args = current.parameters ?? current.arguments ?? current.input;
  // The openai wire format these models are imitating carries `arguments` as a
  // JSON *string*, not an object — which is exactly what a model reproducing
  // that format from memory tends to write, so it is the likeliest shape here.
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return value; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return value;
  return args;
};

// An explicit gear-change for a model that will not stop planning.
//
// `<think>` tags only help when the model emits them; plenty do not, and simply
// narrate their plan as ordinary content until the budget runs out. Asking for a
// literal marker before the payload does two jobs: it gives the model a defined
// moment to STOP deliberating and start answering — which is the actual failure,
// not the formatting — and it gives us an unambiguous cut point that does not
// depend on guessing where prose ends and JSON begins.
//
// Deliberately ugly and unlikely to appear in narrative prose about diplomacy.
export const ANSWER_SENTINEL = "<<<JSON>>>";

// How to ask for it. Kept next to the marker so the two can never drift apart.
export const ANSWER_SENTINEL_DIRECTIVE =
  `Think silently if you must, but you MUST finish by writing the line ${ANSWER_SENTINEL} `
  + "on its own, and then the JSON object and nothing else. Everything before that line is "
  + "discarded, so the answer itself must come after it. Do not stop before writing it.";

// Everything after the LAST sentinel. Last rather than first: a model that
// restates the instruction while planning ("...then I write <<<JSON>>>...")
// would otherwise have its own plan treated as the answer.
export const stripBeforeSentinel = (text) => {
  const body = String(text ?? "");
  const at = body.lastIndexOf(ANSWER_SENTINEL);
  return at === -1 ? body : body.slice(at + ANSWER_SENTINEL.length);
};

// One JSON ARRAY out of a text that should be one. Strict first; then the
// same repairs extractJsonPayload makes (smart quotes, trailing commas, an
// unescaped inner quote); then the first balanced [...] block in the text that
// parses, so a comment or a second array after the real one no longer costs
// the whole transaction. Null when nothing array-shaped survives — the caller
// decides whether that is an error.
export const extractJsonArray = (rawText) => {
  const text = normalizeString(rawText);
  if (!text) return null;
  const direct = lenientJsonParse(text);
  if (Array.isArray(direct)) return direct;
  for (const fence of text.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)) {
    const parsed = fence[1] ? lenientJsonParse(fence[1].trim()) : null;
    if (Array.isArray(parsed)) return parsed;
  }
  for (const candidate of balancedJsonCandidates(text)) {
    if (candidate[0] !== "[") continue;
    const parsed = lenientJsonParse(candidate);
    if (Array.isArray(parsed)) return parsed;
  }
  return null;
};

export const extractJsonPayload = (rawText) => {
  // Reasoning models (and several Ollama chat templates) prepend a think block
  // the strict parser chokes on; the answer follows it.
  const text = stripBeforeSentinel(rawText)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();

  const direct = lenientJsonParse(text);
  if (direct) return direct;

  // Any fenced block, not just ```json — small models label fences ```JSON,
  // ```javascript, or not at all.
  for (const fence of text.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)) {
    const parsed = fence[1] ? lenientJsonParse(fence[1].trim()) : null;
    if (parsed && typeof parsed === "object") return parsed;
  }

  for (const candidate of balancedJsonCandidates(text)) {
    const parsed = lenientJsonParse(candidate);
    if (parsed && typeof parsed === "object") return parsed;
  }

  return null;
};
