/*! Open Historia — event category tags. Ported from Abdulrahman Azmy's fork. */
// Import-free on purpose: both the save normalizer (gameState.js) and the AI
// schemas (gameplaySchemas.js, itself import-free for its node tests) read the
// vocabulary from here, so it lives in exactly one place.
//
// Category tags are emitted by the model on every event through the live tool
// schema and consumed by the timeline's filter chips. Events generated before
// the field existed simply have none — they still render and can never be
// filtered out, they just light up no chip.

export const EVENT_TAG_ENUM = Object.freeze([
  "Military",
  "Diplomacy",
  "Economy",
  "Politics",
  "Culture",
  "Disaster",
]);

export const MAX_EVENT_TAGS = 3;

// Case-insensitive match against the enum; unknown or empty tags are dropped,
// duplicates collapse, and at most MAX_EVENT_TAGS survive (the schema promises
// maxItems: 3, but a lenient local backend may not enforce it).
export const normalizeEventTags = (value) => {
  if (!Array.isArray(value)) return [];
  const tags = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const wanted = entry.trim().toLowerCase();
    const tag = EVENT_TAG_ENUM.find((candidate) => candidate.toLowerCase() === wanted);
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length >= MAX_EVENT_TAGS) break;
  }
  return tags;
};
