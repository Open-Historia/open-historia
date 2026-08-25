/*! Open Historia — portions (advisor fenced-block extraction & truncation repair) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Pulling the machine-readable fences out of an advisor reply.
//
// Lifted out of advisor.jsx so it can actually be tested: advisor.jsx is JSX and
// reaches assets.js -> maplibre-gl, so nothing in it can be unit-tested, and this
// is exactly the kind of string handling that needs to be. DELIBERATELY
// IMPORT-FREE, the same trick eventFocus.js uses, so its tests run in a bare
// checkout.

// Extracts one fenced ```<lang> block (JSON payload) from a reply and strips it
// from the remaining text — the "prose + one machine-readable fence" convention
// the chart, actions, senddraft, deploy and projects blocks all ride.
//
// `salvageTruncated` handles the failure mode that a big block WILL eventually
// hit: the reply runs out of tokens partway through the JSON, so there is an
// opening fence and no closing one. The strict regex below simply does not match
// that, which means the block is neither applied nor stripped — the raw JSON
// dumps into the chat as prose and nothing anywhere says why. Opt in for blocks
// big enough to be cut off; leave it off for the small ones, where an unterminated
// fence more likely means the model was talking ABOUT the format rather than using
// it, and salvaging would act on something it never meant to send.
export const extractFencedJson = (text, lang, { salvageTruncated = false } = {}) => {
  const regex = new RegExp("```" + lang + "\\s*([\\s\\S]*?)```");
  const match = text.match(regex);

  if (match) {
    let json = null;
    try {
      json = JSON.parse(match[1].trim());
    } catch (err) {
      // A closed fence that will not parse is worth one repair attempt too: a
      // model can also close the fence and still have mangled the array.
      json = salvageTruncated ? repairTruncatedJsonArray(match[1]) : null;
      if (json === null) {
        console.warn(`[advisor] malformed \`\`\`${lang} block, dropping it:`, err.message);
      }
    }
    return { rest: text.replace(regex, ""), json, truncated: false };
  }

  if (!salvageTruncated) return { rest: text, json: null, truncated: false };

  const openRegex = new RegExp("```" + lang + "\\s*");
  const open = text.match(openRegex);
  if (!open) return { rest: text, json: null, truncated: false };

  // Everything after the opening fence is the (incomplete) payload. Report
  // `truncated` even when the repair works, so the caller can tell the player the
  // reply was cut short and some of it may be missing.
  const body = text.slice(open.index + open[0].length);
  const json = repairTruncatedJsonArray(body);
  if (json === null) {
    console.warn(`[advisor] unterminated \`\`\`${lang} block and nothing salvageable in it`);
  }
  return { rest: text.slice(0, open.index), json, truncated: true };
};

// Recovers the complete leading elements of a JSON array whose tail was cut off.
//
// `[{"a":1},{"b":2},{"c":` becomes `[{"a":1},{"b":2}]`. Walks the text tracking
// string/escape state (so a brace inside a string value never miscounts depth)
// and remembers the offset just past each top-level element that closed cleanly.
// Whatever completed is kept; the half-written tail is discarded.
//
// Returns null when nothing at all is recoverable, so callers can distinguish
// "salvaged some of it" from "there was nothing usable here".
export const repairTruncatedJsonArray = (text) => {
  const source = String(text ?? "").trim();
  if (!source.startsWith("[")) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastCompleteEnd = -1;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

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
      // Depth 0 means the array itself closed — the input was complete after all.
      if (depth === 0) {
        try {
          const parsed = JSON.parse(source.slice(0, index + 1));
          // Null means "nothing usable here" for every caller, so an array that
          // parsed cleanly but is empty reports the same as one that did not.
          return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
        } catch { return null; }
      }
    }
  }

  if (lastCompleteEnd === -1) return null;

  try {
    const repaired = JSON.parse(`${source.slice(0, lastCompleteEnd)}]`);
    return Array.isArray(repaired) && repaired.length > 0 ? repaired : null;
  } catch {
    return null;
  }
};

// Did the model clearly TRY to send a projects block that we could not use?
//
// Without this, the three ways it can go wrong — no fence at all, an unterminated
// fence with nothing salvageable, valid JSON whose every op was rejected — all
// look identical to the player: a wall of JSON in the chat and a board that never
// changes. Detecting the attempt is what lets the UI say so.
export const looksLikeProjectOps = (text) => {
  const source = String(text ?? "");
  if (!source.includes('"op"')) return false;
  return /"op"\s*:\s*"(create|start|launch|open|add|update|progress|edit|milestone|complete|finish|completed|remove|cancel|abandon|delete)"/.test(source)
    && /"(name|project|projectId)"\s*:/.test(source);
};
