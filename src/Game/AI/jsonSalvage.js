/*! Open Historia — model-output JSON salvage © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
  return maybeJsonParse(repaired);
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

export const extractJsonPayload = (rawText) => {
  // Reasoning models (and several Ollama chat templates) prepend a think block
  // the strict parser chokes on; the answer follows it.
  const text = rawText
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
