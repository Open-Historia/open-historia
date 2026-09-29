/*! Open Historia — a suggestion: someone's changes to a community scenario, as a file © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A player who downloaded a scenario from the community hub and changed it can
// send the changes back to its author: Suggest changes compares their copy with
// the post's file (scenarioChanges.js), saves the difference as a small .zip —
// the edits only, never the whole scenario — and opens the post, where the
// player comments with the file attached. The author's game reads the comments
// on its own posts (hubPosts.js), and the author accepts or rejects each change.
//
//   <scenario>-suggestion.zip
//     suggestion.json       { schema, id, createdAt, scenario, by, note, changes[] }
//     files/cover.<ext>     a suggested cover image, when there is one
//     files/background.json a suggested basemap, when there is one

import { zipBundle, unzipBundle, looksLikeZip } from "./bundleZip.js";
import { countChanges, isDetailFieldPath, POLITICS_FIELDS, summarizeChangesForComment } from "./scenarioChanges.js";
import { SUGGESTION_MARKER } from "./hubPosts.js";

export const SUGGESTION_SCHEMA = "open-historia-scenario-suggestion/1";
const MAX_NOTE = 1500;
const MAX_BY = 80;
const MAX_CHANGES = 20000;

const randomHex = (bytes) => {
  const values = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  else for (let i = 0; i < values.length; i += 1) values[i] = Math.floor(Math.random() * 256);
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
};

// What Publish writes into a post so this install can recognise it later.
export const newPublishKey = () => `oh-${randomHex(8)}`;
export const newSuggestionId = () => `sug-${randomHex(8)}`;

const clean = (value, max) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const slug = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "scenario";

export const suggestionFileName = (scenarioName) => `${slug(scenarioName)}-suggestion.zip`;

// The change kinds a suggestion may carry (scenarioChanges.js). Anything else
// in a file is dropped on reading, so a file from a newer or a broken build
// shows what this build can apply and nothing it would misread.
export const KNOWN_KINDS = new Set([
  "field", "politics", "history", "stats", "institutionLogos", "cover",
  "region-owner", "region-name", "region-type", "region-claims", "region-group", "borders",
  "polity-add", "polity-remove", "polity-change", "polity-rename",
  "group-add", "group-remove", "group-change",
  "city-add", "city-remove", "city-change", "cities-replace",
  "unit-add", "unit-remove", "unit-change",
  "marker-add", "marker-remove", "marker-change",
  "puppet-add", "puppet-remove", "puppet-change",
  "map-field", "background",
]);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
// A Politics change names the ledger it goes into and the entry, both of
// which become object keys when it is applied: only a ledger this build knows,
// and never a key that would reach an object's prototype.
const POLITICS_LEDGERS = new Set(["byPolity", "byId"]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
// Its field, like a field change's path, becomes a key of the author's world:
// only a Politics part this build writes.
// An entry (a Politics record, a pre-history event) becomes an object key too.
const safeEntryKey = (entry) => entry === undefined || entry === null || (typeof entry === "string" && !UNSAFE_KEYS.has(entry));
const validPoliticsChange = (change) => POLITICS_FIELDS.includes(change.field)
  && (change.within === undefined || POLITICS_LEDGERS.has(change.within))
  && safeEntryKey(change.entry);
const validChange = (change) => isRecord(change)
  && typeof change.id === "string" && change.id
  && KNOWN_KINDS.has(change.kind)
  && (change.area === "details" || change.area === "map")
  && (change.kind !== "field" || isDetailFieldPath(change.path))
  && (change.kind !== "politics" || validPoliticsChange(change))
  && (change.kind !== "history" || ((change.part === "event" || change.part === "setup") && safeEntryKey(change.entry)))
  && (change.kind !== "borders" || Array.isArray(change.regions));

export const normalizeSuggestion = (raw) => {
  if (!isRecord(raw) || raw.schema !== SUGGESTION_SCHEMA) {
    throw new Error("That file is not a scenario suggestion.");
  }
  const seen = new Set();
  const changes = [];
  for (const change of Array.isArray(raw.changes) ? raw.changes : []) {
    if (!validChange(change) || seen.has(change.id)) continue;
    seen.add(change.id);
    changes.push(change);
    if (changes.length >= MAX_CHANGES) break;
  }
  const scenario = isRecord(raw.scenario) ? raw.scenario : {};
  const postId = Number(scenario.postId);
  return {
    schema: SUGGESTION_SCHEMA,
    id: clean(raw.id, 80) || newSuggestionId(),
    createdAt: clean(raw.createdAt, 40),
    scenario: {
      name: clean(scenario.name, 200),
      title: clean(scenario.title, 200),
      ...(Number.isInteger(postId) && postId > 0 ? { postId } : {}),
      bundleUrl: clean(scenario.bundleUrl, 600),
    },
    by: clean(raw.by, MAX_BY),
    note: clean(raw.note, MAX_NOTE),
    changes,
  };
};

export const buildSuggestion = ({ changes, scenario, origin, by = "", note = "" }) => normalizeSuggestion({
  schema: SUGGESTION_SCHEMA,
  id: newSuggestionId(),
  createdAt: new Date().toISOString(),
  scenario: {
    name: scenario?.name ?? "",
    title: origin?.title ?? "",
    postId: origin?.postId,
    bundleUrl: origin?.bundleUrl ?? "",
  },
  by,
  note,
  changes,
});

const base64ToBytes = (base64) => {
  const binary = globalThis.atob(String(base64 ?? ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const coverExtension = (contentType) => (/png/i.test(contentType) ? "png" : /webp/i.test(contentType) ? "webp" : /gif/i.test(contentType) ? "gif" : "jpg");

// The .zip: suggestion.json, with the heavy payloads (a cover image, a basemap)
// as files of their own, the image stored as bytes rather than base64.
export const buildSuggestionZip = async (suggestion) => {
  const files = {};
  const changes = suggestion.changes.map((change) => {
    if (change.kind === "cover" && change.to?.base64) {
      const file = `files/cover.${coverExtension(change.to.contentType)}`;
      files[file] = base64ToBytes(change.to.base64);
      const { base64, ...to } = change.to;
      return { ...change, to: { ...to, file } };
    }
    if (change.kind === "background" && change.to?.data) {
      const file = "files/background.json";
      files[file] = JSON.stringify(change.to.data);
      const { data, ...to } = change.to;
      return { ...change, to: { ...to, file } };
    }
    return change;
  });
  files["suggestion.json"] = JSON.stringify({ ...suggestion, changes });
  return zipBundle(files);
};

// A suggestion file as the author's game reads it: the .zip Suggest changes
// saves (from the hub or a file), or a bare suggestion.json.
export const readSuggestionFile = async (input) => {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
    : input instanceof Uint8Array ? input
      : new Uint8Array(await input.arrayBuffer());
  if (!looksLikeZip(bytes)) {
    try {
      return normalizeSuggestion(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (error) {
      throw new Error(error?.message === "That file is not a scenario suggestion." ? error.message : "That file is not a scenario suggestion.");
    }
  }
  const zip = await unzipBundle(bytes);
  const text = await zip.text("suggestion.json");
  if (!text) throw new Error("That .zip holds no suggestion (suggestion.json is missing).");
  const raw = JSON.parse(text);
  const changes = [];
  for (const change of Array.isArray(raw?.changes) ? raw.changes : []) {
    if (change?.kind === "cover" && typeof change.to?.file === "string") {
      const { file, ...to } = change.to;
      const base64 = await zip.base64(file);
      changes.push(base64 ? { ...change, to: { ...to, base64 } } : { ...change, to: null, missingFile: true });
    } else if (change?.kind === "background" && typeof change.to?.file === "string") {
      const { file, ...to } = change.to;
      const data = await zip.text(file);
      let parsed = null;
      try { parsed = data ? JSON.parse(data) : null; } catch { parsed = null; }
      changes.push(parsed ? { ...change, to: { ...to, data: parsed } } : { ...change, to: null, missingFile: true });
    } else {
      changes.push(change);
    }
  }
  return normalizeSuggestion({ ...raw, changes });
};

// The comment the player pastes on the post, with the file dragged in. Plain
// English: it is read on GitHub, where the game's language packs do not reach.
// The marker line is what the author's game looks for.
export const buildSuggestionComment = (suggestion, { fileName = "" } = {}) => {
  const counts = countChanges(suggestion.changes);
  const lines = summarizeChangesForComment(suggestion.changes);
  const total = counts.details + counts.map;
  return [
    `**Suggested changes** to this scenario (${total} ${total === 1 ? "change" : "changes"}), made with Open Historia's Suggest changes.`,
    ...(suggestion.note ? ["", suggestion.note] : []),
    "",
    ...lines.map((line) => `- ${line}`),
    "",
    `<!-- Drag the file${fileName ? ` ${fileName}` : ""} into this comment before you post it: the author's game reads the changes from it. -->`,
    "",
    `${SUGGESTION_MARKER}: ${suggestion.id}`,
  ].join("\n");
};
