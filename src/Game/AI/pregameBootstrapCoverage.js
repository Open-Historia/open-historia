import { createWorldActorResolver } from "./nativeWorldIntegrity.js";

// Which current polities a Round-Zero answer must show in a live war or an
// unresolved storyline, and whether it does.
//
// The requirements used to be read out of the scenario briefing by English
// word lists ("declares war", "wages war", "fights against", "armed
// opposition"...), and an answer that left out an actor they picked was
// refused, a second request, and asked again at every open of the game. A
// briefing that said "In 1990 Iraq declared war on Kuwait. The war ended in
// 1991" made both countries mandatory in a LIVE war; the same sentence in
// French required nothing. The owner, 2026-11-06: "dont do keywording its super
// unreliable"; 2026-11-13: "Historical wars aren't always initialized
// properly". Nothing is read from the briefing's words now: the model is given
// the briefing and writes the wars it holds, and only requirements a caller
// states outright are checked.

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

// No requirement is derived from the briefing's words (see above).
export const derivePregameBootstrapCoverageRequirements = () => [];

const addConflictActors = (target, values, resolver) => {
  for (const value of normalizeArray(values)) {
    const canonical = resolver.knownCanonical(value);
    if (canonical) target.add(canonical.toLowerCase());
  }
};

const conflictCoverageSet = (candidate, world) => {
  const resolver = createWorldActorResolver(world);
  const covered = new Set();

  for (const war of normalizeArray(world?.wars)) {
    const status = normalizeString(war?.status).toLowerCase();
    if (status && !["active", "ceasefire"].includes(status)) continue;
    addConflictActors(covered, war?.sideA, resolver);
    addConflictActors(covered, war?.sideB, resolver);
  }
  for (const storyline of normalizeArray(world?.storylines)) {
    const status = normalizeString(storyline?.status).toLowerCase();
    if (["resolved", "ended", "closed", "inactive"].includes(status)) continue;
    addConflictActors(covered, storyline?.participants, resolver);
  }

  for (const fact of normalizeArray(candidate?.canonicalUpdates)) {
    const kind = normalizeString(fact?.kind).toLowerCase();
    if (kind === "war") {
      addConflictActors(covered, fact?.sideA, resolver);
      addConflictActors(covered, fact?.sideB, resolver);
    } else if (kind === "storyline") {
      addConflictActors(covered, fact?.participants, resolver);
    }
  }
  return covered;
};

// The requirements a caller states ({ polity, evidence? }), checked: "" when
// each is in a live war or an unresolved storyline of the world or the answer.
export const validatePregameBootstrapCoverage = (
  candidate,
  {
    world = {},
    requirements = null,
  } = {},
) => {
  const required = normalizeArray(requirements);
  if (!required.length) return "";

  const covered = conflictCoverageSet(candidate, world);
  const missing = required.filter((entry) => !covered.has(normalizeString(entry?.polity).toLowerCase()));
  if (!missing.length) return "";

  const names = missing.map((entry) => normalizeString(entry?.polity)).filter(Boolean);
  const firstEvidence = normalizeString(missing[0]?.evidence);
  const evidence = firstEvidence ? ` Authoritative briefing evidence: "${firstEvidence}"` : "";
  return `Round-Zero baseline omits authoritative armed actor${names.length === 1 ? "" : "s"}: ${names.join(", ")}. `
    + "Each current polity explicitly presented by the scenario briefing as armed opposition must appear in an active/ceasefire war or unresolved non-war storyline. "
    + "Add it to the appropriate existing conflict/process fact; do not invent a new war unless the scenario canon supports one."
    + evidence;
};
