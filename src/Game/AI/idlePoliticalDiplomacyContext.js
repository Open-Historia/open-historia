/*! Open Historia Continuum — bounded PWv2 context for idle/event diplomacy. */
import { getPoliticalProfile } from "../../runtime/politicalActors.js";
import { buildBoundedPoliticalDecisionContextSet } from "./politicalDecisionContext.js";
import { sharedInstitutionRoutesForPlayer } from "./institutionIdleRouting.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => Array.isArray(value) ? value : [];
const lower = (value) => clean(value).toLocaleLowerCase();

// Deterministic candidate selection means PWv2 improves background diplomacy
// without buying another model request. An event's own political participants
// come first; otherwise current conversations, shared institutions and the live
// diplomatic/war ledgers provide the bounded focus. Political Actor keys are a
// final fallback only so a quiet campaign can still produce an autonomous note.
export const buildIdleDiplomacyPoliticalDecisionSet = (
  bundle,
  { event = null, maxActors = 6 } = {},
) => {
  const world = bundle?.world || {};
  const player = clean(bundle?.game?.country);
  if (!player) return buildBoundedPoliticalDecisionContextSet(world, { actorPolities: [], maxActors: 0 });

  const candidates = [];
  const seen = new Set();
  const add = (value) => {
    const name = clean(value?.name || value?.code || value?.polity || value);
    if (!name || lower(name) === lower(player)) return;
    const actor = getPoliticalProfile(world, name);
    if (!actor) return;
    const canonical = clean(actor.polityKey || actor.name || name);
    const key = lower(canonical);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(canonical);
  };
  const addList = (value) => list(value).forEach(add);

  if (event) {
    const impacts = event?.impacts || {};
    for (const change of list(impacts.polityChanges)) add(change?.name || change?.code);
    for (const op of list(impacts.politicalActorOps)) add(op?.polityKey || op?.polity || op?.country);
    for (const transfer of list(impacts.regionTransfers)) {
      add(transfer?.fromCode);
      add(transfer?.toCode);
    }
    for (const op of list(impacts.regionControlOps)) {
      add(op?.fromCode);
      add(op?.toCode);
      add(op?.actorCode);
      add(op?.claimantCode);
    }
    for (const op of list(impacts.institutionLifecycleOps)) {
      add(op?.actorPolity);
      add(op?.targetPolity);
    }
    for (const chat of list(impacts.createdChats)) {
      add(chat?.speaker);
      addList(chat?.countries);
    }
  }

  for (const chat of list(bundle?.chats).filter((entry) => lower(entry?.status) !== "closed")) addList(chat?.countries);
  for (const route of sharedInstitutionRoutesForPlayer(world, player, { limit: 6 })) addList(route?.members);

  for (const relation of list(world?.relations)) {
    if (lower(relation?.a) === lower(player)) add(relation?.b);
    else if (lower(relation?.b) === lower(player)) add(relation?.a);
  }
  for (const agreement of list(world?.agreements)) {
    const parties = list(agreement?.parties).map(clean).filter(Boolean);
    if (parties.some((party) => lower(party) === lower(player))) addList(parties);
  }
  for (const war of list(world?.wars)) {
    const sideA = list(war?.sideA).map(clean).filter(Boolean);
    const sideB = list(war?.sideB).map(clean).filter(Boolean);
    if (sideA.some((party) => lower(party) === lower(player))) addList(sideB);
    if (sideB.some((party) => lower(party) === lower(player))) addList(sideA);
  }
  if (candidates.length < maxActors) Object.keys(world?.politicalActors?.byPolity || {}).forEach(add);

  const selected = candidates.slice(0, Math.max(0, Number(maxActors) || 0));
  return buildBoundedPoliticalDecisionContextSet(world, {
    actorPolities: selected,
    counterpartByActor: Object.fromEntries(selected.map((actor) => [actor, player])),
    maxActors,
    perActorMaxChars: 2200,
    maxTotalChars: 10500,
    limits: {
      traits: 6,
      goals: 4,
      fears: 4,
      ambitions: 4,
      domesticPressures: 4,
      pressureIssues: 4,
      governingEntities: 3,
      oppositionEntities: 2,
      perceptions: 3,
      relations: 4,
      agreements: 4,
      wars: 3,
      institutions: 5,
      institutionLifecycleCases: 4,
    },
  });
};

export const idleDiplomacyPoliticalContextText = (decisionSet) => decisionSet?.text
  ? [
      "[PRIVATE POLITICAL DECISION CONTEXT - ENGINE DATA]",
      "Choose a speaker only from an actor capsule below when capsules are available. Use only that speaker's own private capsule; never leak one government's hidden politics to another or to the player as omniscient fact.",
      decisionSet.text,
    ].join("\n")
  : "";

export const idleDiplomacySpeakerHasContext = (world, speaker, decisionSet) => {
  if (!decisionSet?.contexts?.length) return true; // legacy/no-PWv2 scenario: do not disable diplomacy
  const actor = getPoliticalProfile(world, speaker);
  return Boolean(actor && decisionSet.contexts.some((context) => getPoliticalProfile(world, context?.actorPolity) === actor));
};
