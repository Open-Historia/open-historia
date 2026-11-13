/*! Open Historia — fail-closed recovery of independent unsupported battlefield reports (AGPL-3.0-or-later). */
import { eventNarratesHardCombat } from "./nativeWarLedger.js";

// This is NOT a substitute for a war ledger. A report without a defensible
// canonical war cannot become true merely because the model narrated it.
// Withhold only independent *model-generated* reporting that has no native
// effects or dependent records. The caller records the withholding in the
// turn receipt; the original candidate is never modified on a failed check.
const EMPTY = (value) => {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.every(EMPTY);
  if (typeof value === "object") return Object.values(value).every(EMPTY);
  return false;
};

const LEDGERS = [
  "warUpdates", "relationUpdates", "agreementUpdates", "puppetUpdates",
  "storylineUpdates", "frontOrders", "projectOps", "boardProvisionalEventIds",
];
const DISPLAY_FIELDS = new Set([
  "id", "date", "title", "description", "kind", "type",
  "warId", "combatants", "impacts", "places",
  "importance", "notable", "quote", "tags",
]);
const KNOWN_PAYLOAD_FIELDS = new Set([
  "events", "summary", "stopDate", "clearActions", "politicalClaims", ...LEDGERS,
]);

const independentReport = (event, protectedPolities) => {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  if (!String(event.id || "").trim() || !String(event.title || "").trim()) return false;
  // Major moments and explicitly notable events can determine the rest of the
  // jump, even without a canonical impact row. They must be retried or held,
  // not opportunistically dropped for speed.
  if (event.notable || ["major", "critical"].includes(String(event.importance || "").toLowerCase())) return false;
  if (Array.isArray(event.tags) && event.tags.some((tag) => /^(scripted|authored|player|action)$/i.test(String(tag)))) return false;
  if (!eventNarratesHardCombat(event) || String(event.warId || "").trim()) return false;
  if (!EMPTY(event.impacts)) return false;
  // Authored / player / scenario event provenance is not disposable. Unknown
  // nonempty properties may carry a reference, resolution, or native mutation.
  for (const [field, value] of Object.entries(event)) {
    if (!DISPLAY_FIELDS.has(field) && !EMPTY(value)) return false;
  }
  const words = [event.title, event.description, ...(Array.isArray(event.combatants) ? event.combatants : [])]
    .map((value) => String(value ?? "").toLowerCase()).join(" ");
  return !protectedPolities.some((polity) =>
    typeof polity === "string" && polity.trim() && words.includes(polity.toLowerCase().trim()));
};

export const isolateUnsupportedWarReports = (candidate, unresolved, { protectedPolities = [], protectedTitles = [] } = {}) => {
  const invalid = { candidate: null, dropped: [] };
  const events = candidate?.events;
  if (!Array.isArray(events) || events.length < 2 || !Array.isArray(unresolved) || !unresolved.length) return invalid;
  // No global canonical mutations may depend on a removed event. A future,
  // more selective repair must validate event-level referential integrity first.
  if (LEDGERS.some((field) => !EMPTY(candidate[field]))) return invalid;
  if (!EMPTY(candidate.clearActions) || !EMPTY(candidate.politicalClaims)) return invalid;
  // Unknown nonempty top-level fields might carry impacts, execution receipts,
  // or cross-event references. Without a native contract we cannot prove them
  // independent of the discarded report.
  if (Object.entries(candidate).some(([field, value]) =>
    !KNOWN_PAYLOAD_FIELDS.has(field) && !EMPTY(value))) return invalid;

  const indexes = new Set();
  for (const entry of unresolved) {
    const index = entry?.index;
    if (!Number.isInteger(index) || index < 0 || index >= events.length) return invalid;
    if (!independentReport(events[index], protectedPolities)) return invalid;
    // Scenario scripted beats and queued player Actions may have established a
    // specific event title before the model wrote it. Never discard that
    // authored/authorized event just because the model omitted its war link.
    const title = String(events[index].title || "").trim().toLowerCase();
    if (protectedTitles.some((value) => typeof value === "string"
      && value.trim().toLowerCase() === title)) return invalid;
    indexes.add(index);
  }
  if (!indexes.size || indexes.size >= events.length) return invalid;

  const removed = events.filter((_, i) => indexes.has(i));
  const kept = events.filter((_, i) => !indexes.has(i));
  if (!kept.length) return invalid;
  // Treat a textual reference in another surviving event as a potential
  // causal dependency. Do not silently cut a link in the narrative.
  for (const event of kept) {
    const raw = JSON.stringify(event);
    if (removed.some((prior) =>
      raw.includes(JSON.stringify(prior.id)) || (prior.title && raw.includes(prior.title)))) return invalid;
  }
  return {
    candidate: {
      ...candidate,
      events: kept,
      // The model's summary may also narrate the unsupported battle. Do not
      // publish that summary after withholding its supporting event.
      summary: "",
    },
    dropped: removed,
  };
};
