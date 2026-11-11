/*! Open Historia — occupations settled after their war © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Issue #1000: in a 1947 save Germany had surrendered and its wars were ended, but 18 regions of Poland were still
// under German control, so the map showed Poland German. Nothing ends an occupation when its war ends. Told so in
// words, a live skip (gemini-3.1-flash-lite, 2026-11-10) wrote ten events and settled none of them; a small model
// fills what its answer must hold, not what a paragraph asks (and a required string it fills with ""). So the time
// skip's answer has a required field for it, occupationSettlements, an object with one required key a group of the
// regions listed under [Occupations Outliving Their War] ({ o1: "Poland" }; Game/AI/standingContext.js
// occupationGroups, gameplaySchemas.js withOccupationSettlements), each group told how its war ended; lines of
// "<region>~<the polity it goes to>" are read too. Who keeps the land is
// the story's to say; the game applies the answer:
//   to the sovereign: the occupation ends (control back to it);
//   to the occupier: it keeps the land, now its own;
//   to another polity on the map: it takes the land outright.
// A line for a region that was not listed, an unknown region, or a polity that is not on the map, changes nothing.
//
// Pure, and loads in plain Node.

export const OCCUPATION_SETTLEMENTS_FIELD = "occupationSettlements";
// What each key answers: returned to the sovereign, or kept by the occupier. A polity's name is read too (another
// power that took the land).
export const OCCUPATION_OUTCOMES = ["returned", "kept"];
// A group whose war is on the ledger is asked instead who lost it ("<occupier> lost" / "<sovereign> lost"): a live
// skip on issue #1000's save, its world still showing the German Reich a great power of 38 regions, answered "kept"
// twice though the war's note said Germany had surrendered; who lost is what the note says outright. Asked "who
// lost", it answered "Poland lost" (Poland fell in 1939): the question is who had lost when the war ENDED.
export const occupationOutcomesFor = (group) => (group?.war
  ? [`${group.sovereign} lost at the end`, `${group.controller} lost at the end`]
  : OCCUPATION_OUTCOMES);
// The polity that holds a group's land after the answer: the sovereign for "returned" or "<occupier> lost at the
// end", the occupier for "kept" or "<sovereign> lost at the end", a polity's name as written otherwise.
export const occupationAnswerPolity = (to, group) => {
  const said = fold(to);
  if (said === "returned" || said === fold(`${group?.controller} lost at the end`)) return group?.sovereign ?? "";
  if (said === "kept" || said === fold(`${group?.sovereign} lost at the end`)) return group?.controller ?? "";
  return clean(to);
};

const clean = (value, most = 160) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const regionKey = (value) => fold(value).replace(/^region:\s*/, "");

// The answer as written: { o1: "Poland", o2: "Soviet Union" } (one key a group, standingContext.js occupationGroups),
// or several such objects (a skip in segments), read as [{ key, to }].
export const readOccupationAnswers = (value) => {
  const objects = (Array.isArray(value) ? value : [value]).filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  const read = [];
  for (const object of objects) {
    for (const [key, to] of Object.entries(object)) {
      const polity = clean(to);
      if (/^o\d+$/i.test(clean(key)) && polity) read.push({ key: clean(key).toLowerCase(), to: polity });
    }
  }
  return read;
};

// The line form, "<region>~<polity>" (an answer that wrote lines anyway): [{ region, to }]. A string or a list of
// strings; "-" bullets and quotes are let go.
export const readOccupationSettlements = (value) => {
  const lines = (Array.isArray(value) ? value : [value]).filter((entry) => typeof entry === "string")
    .flatMap((entry) => entry.split(/\r?\n|;(?=[^~]*~)/));
  const read = [];
  for (const raw of lines) {
    const line = clean(raw, 400).replace(/^[-*•]\s*/, "").replace(/^["']|["']$/g, "");
    const at = line.lastIndexOf("~");
    if (at <= 0) continue;
    const region = clean(line.slice(0, at));
    const to = clean(line.slice(at + 1));
    if (region && to) read.push({ region, to });
  }
  return read;
};

// The settlements for `pending` (occupationsAfterTheirWar's rows: { regionId, name, controller, sovereign }), by
// the names a line may use for a region (`namesOf(row)`: its id, its name, "region: <name>"), to a polity
// `knownPolity(name)` says is on the map (returning its name as the map writes it). [{ regionId, from, sovereign,
// to, kind: "returned" | "kept" | "taken" }], one per region at most (the first line for it).
export const planOccupationSettlements = (lines, pending, { namesOf = (row) => [row.regionId, row.name], knownPolity = (name) => name } = {}) => {
  const byName = new Map();
  for (const row of Array.isArray(pending) ? pending : []) {
    for (const name of namesOf(row)) if (name && !byName.has(regionKey(name))) byName.set(regionKey(name), row);
  }
  const done = new Set();
  const plan = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = byName.get(regionKey(line.region));
    if (!row || done.has(row.regionId)) continue;
    const to = knownPolity(line.to);
    if (!to) continue;
    done.add(row.regionId);
    const kind = fold(to) === fold(row.sovereign) ? "returned" : fold(to) === fold(row.controller) ? "kept" : "taken";
    plan.push({ regionId: row.regionId, from: row.controller, sovereign: row.sovereign, to, kind });
  }
  return plan;
};

// The world with the plan applied, a new object (its region records copied), and the world itself when the plan is
// empty. The new holder holds and owns the region: the sovereignty row (kept only while the two differ) goes, and
// so does any claim of the new holder's on it.
export const applyOccupationSettlements = (world, plan) => {
  if (!Array.isArray(plan) || plan.length === 0) return world;
  const next = {
    ...world,
    regionOwnershipOverrides: { ...(world?.regionOwnershipOverrides ?? {}) },
    regionSovereigntyOverrides: { ...(world?.regionSovereigntyOverrides ?? {}) },
    regionClaimants: { ...(world?.regionClaimants ?? {}) },
  };
  for (const { regionId, to } of plan) {
    next.regionOwnershipOverrides[regionId] = to;
    delete next.regionSovereigntyOverrides[regionId];
    const claimants = Array.isArray(next.regionClaimants[regionId]) ? next.regionClaimants[regionId] : null;
    if (claimants) {
      const kept = claimants.filter((name) => fold(name) !== fold(to));
      if (kept.length) next.regionClaimants[regionId] = kept;
      else delete next.regionClaimants[regionId];
    }
  }
  return next;
};
