/*! Open Historia Continuum — bounded geopolitical JSON transport salvage */

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const repairedJsonText = (text) => String(text ?? "")
  .replace(/[“”]/g, '"')
  .replace(/,\s*([}\]])/g, "$1");

const parseArrayCandidate = (text) => {
  const direct = parseJson(text);
  if (Array.isArray(direct)) return direct;

  // Only repair common transport punctuation after strict parsing has failed.
  // This never fabricates missing rows or closes truncated containers.
  const lenient = parseJson(repairedJsonText(text));
  return Array.isArray(lenient) ? lenient : null;
};

const parseObjectCandidate = (text) => {
  const direct = parseJson(text);
  if (isPlainObject(direct)) return direct;
  const lenient = parseJson(repairedJsonText(text));
  return isPlainObject(lenient) ? lenient : null;
};

// Return intact balanced top-level JSON arrays in source order. The scanner is
// string/escape aware so brackets inside notes do not affect structure. Open
// or truncated arrays are deliberately NOT repaired: geopolitical baseline
// jobs are fail-closed and must never accept a shortened polity set.
const balancedArrayCandidates = (text) => {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (start === -1) {
      if (ch === "[") {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
};

// Targeted power recovery often asks for exactly one polity. Some providers
// then violate the string-field contract by returning one complete JSON object
// instead of a one-element array. We salvage that shape only when the caller
// explicitly allows it AND the field itself starts as an object. This avoids
// accepting an object embedded inside a truncated array such as `[{...}`.
const leadingBalancedObjectCandidate = (text) => {
  const source = String(text ?? "").trim();
  if (!source.startsWith("{")) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(0, i + 1);
    }
  }
  return null;
};

export const parseGeopoliticalArrayText = (value, { allowSingletonObject = false } = {}) => {
  if (Array.isArray(value)) return value;
  if (allowSingletonObject && isPlainObject(value)) return [value];

  const text = String(value ?? "").trim();
  if (!text) return [];

  const direct = parseArrayCandidate(text);
  if (direct) return direct;

  if (allowSingletonObject) {
    const directObject = parseObjectCandidate(text);
    if (directObject) return [directObject];
  }

  // Providers occasionally wrap an otherwise valid JSON-string tool field in
  // a markdown fence or append commentary after the closing bracket. Rather
  // than throwing away a complete batch, salvage only an INTACT balanced array.
  const unfenced = text
    .replace(/^\s*```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  if (unfenced !== text) {
    const fenced = parseArrayCandidate(unfenced);
    if (fenced) return fenced;
    if (allowSingletonObject) {
      const fencedObject = parseObjectCandidate(unfenced);
      if (fencedObject) return [fencedObject];
    }
  }

  for (const candidate of balancedArrayCandidates(unfenced)) {
    const parsed = parseArrayCandidate(candidate);
    if (parsed) return parsed;
  }

  if (allowSingletonObject) {
    const candidate = leadingBalancedObjectCandidate(unfenced);
    if (candidate) {
      const parsed = parseObjectCandidate(candidate);
      if (parsed) return [parsed];
    }
  }

  throw new Error("provider field must decode to one complete JSON array");
};
