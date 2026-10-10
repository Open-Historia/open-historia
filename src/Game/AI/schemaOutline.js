/*! Open Historia — a JSON Schema written out as the shape of an answer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A task's output contract as text a model reads, instead of a schema a provider
// compiles: the answer's shape in TypeScript notation, with each field's
// description beside it as a comment.
//
// It exists for the time skip on Gemini (main.jsx callGemini). A skip's events
// are shown one at a time as they are written, which needs the answer as
// streamed text, and this API streams text but never a function call's
// arguments. Asking for the text with the contract as generationConfig
// .responseSchema was measured against the live API (2026-10-05) and does not
// hold: the schema is compiled into a grammar with a ceiling on its size, the
// skip's contract sits at it (the contract as it stood passed with its unions
// merged, and was refused again once the Projects board's ops were added), and
// that ceiling has moved before (geminiSchema.js). So the contract goes in the
// prompt, where its size costs tokens and nothing else, and the answer is held
// to it by the task's own validation, exactly as an answer from a model with no
// function calling at all always has been (gameplaySchemas.js
// normalizeGameplayPayload, fitAnswerToSchema, schemaSalvage.js).
//
// The notation is TypeScript's for a type, the densest form models read
// reliably (about a fifth fewer characters than the same schema as JSON), with
// one deliberate difference: every key is written in double quotes, as the
// answer has to write it. A model copies the notation it is shown. The first
// real skip asked this way was shown bare keys and wrote some of its own keys
// bare, three levels down, which is not JSON and cost the skip a second request
// (jsonSalvage.js repairLooseJson reads such an answer now, so this is the
// second of two guards against it).
//
// Import-free, like geminiSchema.js, so it runs under bare node.

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const keyText = (name) => JSON.stringify(String(name));

// The field that tells a union's object branches apart (as geminiSchema.js
// unionDiscriminator): the first one every branch pins with an enum.
const discriminatorOf = (branches) => {
  if (branches.length < 2 || !branches.every((branch) => isObject(branch) && isObject(branch.properties))) return "";
  return Object.keys(branches[0].properties).find((name) => branches.every((branch) => {
    const values = branch.properties[name]?.enum;
    return Array.isArray(values) && values.length > 0;
  })) || "";
};

// Two branches for one value are two spellings of one thing (a structure built
// nested under `marker`, or written flat): the schema accepts both so that no
// answer is lost over the difference, and a model needs to be shown one. The
// flattest is kept, since it is the one models reach for.
const nestedObjectCount = (branch) => Object.values(branch.properties)
  .filter((entry) => isObject(entry) && (entry.type === "object" || isObject(entry.properties))).length;
const oneSpellingEach = (branches, key) => {
  const kept = [];
  for (const branch of branches) {
    const label = branch.properties[key].enum.join("|");
    const at = kept.findIndex((entry) => entry.label === label);
    if (at === -1) kept.push({ label, branch });
    else if (nestedObjectCount(branch) < nestedObjectCount(kept[at].branch)) kept[at] = { label, branch };
  }
  return kept.map((entry) => entry.branch);
};

const nonNullBranches = (node) => (Array.isArray(node?.anyOf) ? node.anyOf.filter((branch) => branch?.type !== "null") : []);
const allowsNull = (node) => node?.nullable === true
  || (Array.isArray(node?.type) && node.type.includes("null"))
  || (Array.isArray(node?.anyOf) && node.anyOf.some((branch) => branch?.type === "null"));
const typeOf = (node) => (Array.isArray(node?.type) ? node.type.find((entry) => entry !== "null") : node?.type)
  || (isObject(node?.properties) ? "object" : node?.items ? "array" : "");

const range = (node) => {
  const low = Number.isFinite(node.minimum) ? node.minimum : null;
  const high = Number.isFinite(node.maximum) ? node.maximum : null;
  if (low !== null && high !== null) return ` ${low}..${high}`;
  if (low !== null) return ` >= ${low}`;
  if (high !== null) return ` <= ${high}`;
  return "";
};

const countWords = (node) => {
  const low = Number.isFinite(node.minItems) && node.minItems > 0 ? node.minItems : null;
  const high = Number.isFinite(node.maxItems) ? node.maxItems : null;
  if (low !== null && high !== null) return low === high ? `exactly ${low}` : `${low} to ${high}`;
  if (low !== null) return `at least ${low}`;
  if (high !== null) return `at most ${high}`;
  return "";
};

// A value that fits on the line of the field that holds it, or "" when it needs
// lines of its own (an object, a union of objects, or an array of either).
const inlineType = (node) => {
  if (!isObject(node)) return "any";
  const branches = nonNullBranches(node);
  const nullable = allowsNull(node) ? " | null" : "";
  if (branches.length === 1) return inlineType({ ...branches[0], nullable: allowsNull(node) });
  if (branches.length > 1) {
    const parts = branches.map(inlineType);
    return parts.every(Boolean) ? `${parts.join(" | ")}${nullable}` : "";
  }
  if (Array.isArray(node.enum)) return `${node.enum.map((entry) => JSON.stringify(entry)).join(" | ")}${nullable}`;
  const type = typeOf(node);
  if (type === "object") return isObject(node.properties) && Object.keys(node.properties).length ? "" : `object${nullable}`;
  if (type === "array") {
    const item = inlineType(node.items);
    return item ? `[${item}]${nullable}` : "";
  }
  if (type === "integer" || type === "number") return `${type}${range(node)}${nullable}`;
  if (type === "boolean" || type === "string") return `${type}${nullable}`;
  return `any${nullable}`;
};

/**
 * @param schema  a task's output schema (JSON Schema, as gameplaySchemas.js writes them)
 * @returns       the same contract as TypeScript notation, one field per line
 */
export const renderSchemaOutline = (schema, { indent = "  " } = {}) => {
  const lines = [];
  const pad = (depth) => indent.repeat(depth);
  const comment = (text) => (text ? `  // ${text}` : "");

  // The lines of a value that does not fit on one: an object's fields, a
  // union's shapes, an array's item. `said` holds the field descriptions a
  // union has already given, so its later shapes do not repeat them.
  const block = (node, depth, { head = "", tail = "", note = "", said = null } = {}) => {
    const branches = nonNullBranches(node);
    const nullable = allowsNull(node) ? " | null" : "";
    if (branches.length === 1) {
      block({ ...branches[0], nullable: allowsNull(node), description: node.description ?? branches[0].description }, depth, { head, tail, note, said });
      return;
    }
    if (branches.length > 1) {
      const key = discriminatorOf(branches);
      const shapes = key ? oneSpellingEach(branches, key) : branches;
      const shared = new Set();
      if (head || note) lines.push(`${pad(depth)}${head}${comment(note)}`.trimEnd());
      lines.push(`${pad(depth)}// one of these shapes${key ? `, told apart by ${keyText(key)}` : ""}:`);
      shapes.forEach((branch, index) => {
        block(branch, depth, { head: index ? "| " : "", tail: index === shapes.length - 1 ? `${nullable}${tail}` : "", said: shared });
      });
      return;
    }
    const type = typeOf(node);
    if (type === "array") {
      const item = node.items ?? {};
      const count = countWords(node);
      lines.push(`${pad(depth)}${head}[${comment([note, count && `(${count})`].filter(Boolean).join(" "))}`.trimEnd());
      block(item, depth + 1, { said });
      lines.push(`${pad(depth)}]${nullable}${tail}`);
      return;
    }
    // An object.
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    lines.push(`${pad(depth)}${head}{${comment(note)}`.trimEnd());
    for (const [name, entry] of Object.entries(isObject(node.properties) ? node.properties : {})) {
      const label = `${keyText(name)}${required.has(name) ? "" : "?"}: `;
      const described = oneLine(entry?.description);
      const repeat = said?.has(`${name}\u0000${described}`);
      if (said && described) said.add(`${name}\u0000${described}`);
      const fieldNote = repeat ? "" : described;
      const inline = inlineType(entry);
      if (inline) {
        const count = typeOf(entry) === "array" ? countWords(entry) : "";
        lines.push(`${pad(depth + 1)}${label}${inline},${comment([fieldNote, count && `(${count})`].filter(Boolean).join(" "))}`.trimEnd());
      } else {
        block(entry, depth + 1, { head: label, tail: ",", note: fieldNote, said });
      }
    }
    lines.push(`${pad(depth)}}${nullable}${tail}`);
  };

  const inline = inlineType(schema);
  if (inline) return inline;
  block(schema, 0, { note: oneLine(schema?.description) });
  return lines.join("\n");
};

// What a model is told about an answer written this way. `first` names the field
// the answer must open with (a skip's events, so they can be shown as they are
// written) when the caller needs that said.
export const buildAnswerFormatBlock = (schema, { first = "" } = {}) => [
  "[Answer Format]",
  "Answer with ONE JSON object and nothing else: no prose before or after it, no markdown fence. "
    + "It must be strict JSON all the way down: every key in double quotes at every depth, every string in double quotes, no comments, no trailing commas. "
    + "Its shape is given below. A key followed by ? is optional: leave it out entirely when you have nothing for it, rather than writing an empty value, and never write the ? itself. "
    + "`a | b` lists the only values a field takes. The text after // describes a field and is not part of the answer. "
    + "Use only the fields shown, spelled exactly as shown. "
    + `Write the fields in the order shown${first ? `, "${first}" first, finishing each entry before starting the next` : ""}.`,
  renderSchemaOutline(schema),
].join("\n");
