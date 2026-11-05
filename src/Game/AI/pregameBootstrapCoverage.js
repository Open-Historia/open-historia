import { createWorldActorResolver } from "./nativeWorldIntegrity.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const escapeRegExp = (value) => normalizeString(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const briefingSegments = (briefing) =>
  normalizeString(briefing)
    .split(/(?<=[.!?])\s+|\r?\n+/u)
    .map((entry) => normalizeString(entry))
    .filter(Boolean);

const canonicalActorList = (world, canonicalPolities = []) => {
  const resolver = createWorldActorResolver(world);
  const seen = new Set();
  const result = [];
  const push = (value) => {
    const canonical = resolver.knownCanonical(value);
    const key = canonical.toLowerCase();
    if (!canonical || seen.has(key)) return;
    seen.add(key);
    result.push(canonical);
  };
  for (const polity of normalizeArray(canonicalPolities)) push(polity);
  if (!result.length) {
    for (const record of resolver.records) push(record?.canonical);
  }
  return { resolver, actors: result };
};

const actorAliasPattern = (actor, resolver) => {
  const aliases = [...new Set(
    resolver.aliasesFor(actor)
      .map(normalizeString)
      .filter((entry) => entry.length >= 3),
  )]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  return aliases.length ? `(?<![a-z0-9])(?:${aliases.join("|")})(?![a-z0-9])` : "";
};

// Coverage extraction is actor-local, not sentence-global. A sentence like
// "China observes Russia, which remains at war with Ukraine" must anchor Russia
// and Ukraine only, not China. The patterns below therefore require the actor to
// occupy the grammatical neighborhood of a strong armed-opposition cue.
const actorHasArmedCoverageCue = (actor, segment, resolver) => {
  const alias = actorAliasPattern(actor, resolver);
  if (!alias) return false;

  const forwardArmedDefiance = new RegExp(
    `${alias}[^.!?]{0,110}\\b(?:declares?|declared|declar(?:e|es|ed|ing))\\s+armed\\s+(?:defiance|opposition|rebellion|uprising|revolt)\\b`,
    "i",
  );
  const forwardDirect = new RegExp(
    `${alias}[^.!?]{0,32}\\b(?:declares?|declared|declar(?:e|es|ed|ing))\\s+(?:a\\s+)?(?:state\\s+of\\s+)?war\\b|`
      + `${alias}[^.!?]{0,32}\\b(?:wages?|waged|waging)\\s+war\\b|`
      + `${alias}[^.!?]{0,32}\\b(?:rebels?|rebelled|rebelling|fights?|fought|fighting)\\s+against\\b`,
    "i",
  );
  const directAtWar = new RegExp(
    `${alias}[^.!?]{0,24}\\b(?:is|are|was|were|remains?|remain)\\s+at\\s+war\\b`,
    "i",
  );
  const reverseTarget = new RegExp(
    `\\b(?:at\\s+war\\s+(?:with|against)|declares?|declared|declar(?:e|es|ed|ing)\\s+(?:a\\s+)?(?:state\\s+of\\s+)?war\\s+on|(?:fights?|fought|fighting)\\s+against)\\b[^.!?]{0,60}${alias}`,
    "i",
  );
  const roleCue = new RegExp(
    `\\b(?:insurgent|insurgents|separatist|separatists|secessionist|secessionists|belligerent|belligerents|combatant|combatants|rebel|rebels)\\b[^.!?]{0,70}${alias}|`
      + `${alias}[^.!?]{0,70}\\b(?:insurgent|insurgents|separatist|separatists|secessionist|secessionists|belligerent|belligerents|combatant|combatants)\\b`,
    "i",
  );
  const hostilitiesCue = new RegExp(
    `${alias}[^.!?]{0,40}\\b(?:opens?|opened|resumes?|resumed|renews?|renewed)\\s+hostilities\\b|`
      + `\\b(?:hostilities\\s+(?:with|against))\\b[^.!?]{0,60}${alias}`,
    "i",
  );

  return forwardArmedDefiance.test(segment)
    || forwardDirect.test(segment)
    || directAtWar.test(segment)
    || reverseTarget.test(segment)
    || roleCue.test(segment)
    || hostilitiesCue.test(segment);
};

export const derivePregameBootstrapCoverageRequirements = ({
  briefing = "",
  world = {},
  canonicalPolities = [],
} = {}) => {
  const { resolver, actors } = canonicalActorList(world, canonicalPolities);
  if (!actors.length || !normalizeString(briefing)) return [];

  const requirements = new Map();
  for (const segment of briefingSegments(briefing)) {
    for (const actor of actors) {
      if (!actorHasArmedCoverageCue(actor, segment, resolver)) continue;
      const key = actor.toLowerCase();
      if (requirements.has(key)) continue;
      requirements.set(key, {
        polity: actor,
        evidence: segment.slice(0, 240),
        kind: "armed-actor",
      });
    }
  }
  return [...requirements.values()];
};

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

export const validatePregameBootstrapCoverage = (
  candidate,
  {
    world = {},
    briefing = "",
    canonicalPolities = [],
    requirements = null,
  } = {},
) => {
  const required = Array.isArray(requirements)
    ? requirements
    : derivePregameBootstrapCoverageRequirements({ briefing, world, canonicalPolities });
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
