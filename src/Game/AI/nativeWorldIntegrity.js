import { resolveStockCountryCode } from "../../runtime/polityIdentity.js";
import {
  EVENT_AGENCY_MAX_SOVEREIGN_ACTORS,
  EVENT_AGENCY_SOVEREIGN_AUTHORITIES,
  normalizeEventAgency,
  eventAgencyStructureReason,
} from "../../runtime/eventAgency.js";
import { propagateCanonicalProcessAuthorityRefs } from "./playerAgencyAuthority.js";
import {
  institutionResolutionAuthorityIds,
  listInstitutionResolutionAuthorities,
} from "../../runtime/institutionalAuthority.js";
import { resolveInstitutionRecord } from "../../runtime/institutions.js";
import { compareGameDates, gameDateDayNumber } from "../../runtime/gameDates.js";
// Native World Integrity (ported from kernely's Continuum branch).
//
// This module is deliberately separate from the World Director and Timeline
// Curator. Responsibilities:
// - provide a deterministic rotating exploration slate so "independent world"
//   attention is concrete rather than a vague prompt sentence;
// - derive exploration coverage from the actual returned world payload so audit bookkeeping is native;
// - reject/sanitize a few objective pre-curation integrity failures BEFORE
//   hidden multi-pass state can ingest them;
// - decide whether a scheduler-deferred storyline has a material endogenous
//   development or external trigger strong enough to re-enter this pass.
//
// It does NOT decide which plausible event is historically interesting. That
// remains the semantic Timeline Curator's job.

export const WORLD_INTEGRITY_VERSION = "0.18.0-native-event-provenance";
export const NATIVE_AUTHORITY_BINDER_VERSION = "2.0.0-native-event-provenance";
export const NATIVE_EVENT_PROVENANCE_VERSION = "1.0.0-semantic-native-owner";

// R3.6: keep the 10-lane attention slate structurally balanced rather than
// hoping actor availability happens to produce 50/50. Up to five independent
// PLAYER-SPHERE actor lanes and three independent WIDER-WORLD actor lanes are used
// when available. If selected-storyline exclusion leaves one side sparse, cheap
// regional/system evaluation lanes fill that side instead of borrowing actors from
// the other side. Two protected wider-world global lanes (crisis discovery +
// cross-border system) complete the normal 5/5 layout. Evaluation only, no quota.
const EXPLORATION_PLAYER_SPHERE_ACTOR_SLOTS = 5;
const EXPLORATION_WIDER_EVIDENCE_ACTOR_SLOTS = 1;
const EXPLORATION_WIDER_LATENT_ACTOR_SLOTS = 2;
const EXPLORATION_WIDER_ACTOR_SLOTS =
  EXPLORATION_WIDER_EVIDENCE_ACTOR_SLOTS + EXPLORATION_WIDER_LATENT_ACTOR_SLOTS;
const EXPLORATION_ACTOR_SLOTS =
  EXPLORATION_PLAYER_SPHERE_ACTOR_SLOTS + EXPLORATION_WIDER_ACTOR_SLOTS;
const EXPLORATION_TARGET_PER_SCOPE = 5;

const EXPLORATION_DOMAINS = Object.freeze([
  "diplomacy / foreign policy / commercial relations",
  "domestic politics / institutions / leadership pressures",
  "economy / industry / trade / finance",
  "society / labour / public order / reform",
  "science / technology / infrastructure / communications",
  "military readiness / doctrine / procurement (not routine battlefield continuation)",
  "regional / colonial / minority governance where applicable",
  "third-party reaction to wars, crises, treaties, and balance-of-power changes",
  "political rupture / elite fracture / mass unrest / coup or constitutional risk when current pressures support it",
  "strategic risk / coercive escalation / mobilization / brinkmanship / miscalculation when current interests support it",
]);

const WORLD_SWEEP_AUDIT_RE = /\[\[WORLD_SWEEP:([^\]]*)\]\]/i;

const ROUTINE_MILITARY_CUE_RE =
  /\b(skirmish(?:es)?|reconnaissance|patrol(?:s|ling)?|prob(?:e|es|ing)|artillery(?:\s+(?:fire|exchange|exchanges|bombardment|bombardments))?|counter[- ]battery|sporadic\s+(?:fire|clashes|fighting)|trench\s+(?:raid|raids)|outpost\s+(?:clash|clashes)|localized\s+(?:fighting|clashes|attacks?)|readiness\s+(?:remains?|stays?|continues?)\s+(?:elevated|heightened|high)|(?:elevated|heightened)\s+(?:military\s+)?readiness\s+(?:remains?|continues?)|maintain(?:s|ed|ing)?\s+(?:a\s+)?(?:heavy\s+|heightened\s+|elevated\s+)?(?:military\s+|security\s+)?posture|continued\s+(?:vigilance|monitoring|surveillance|alert\s+status)|security\s+posture\s+(?:remains?|continues?)|forces?\s+remain(?:s|ed)?\s+on\s+(?:heightened|high)\s+alert)\b/i;

const STRONG_MILITARY_CONSEQUENCE_RE =
  /\b(breakthrough|breaks?\s+through|captur(?:e|es|ed|ing)|seiz(?:e|es|ed|ing)|occup(?:y|ies|ied|ation)|liberat(?:e|es|ed|ion)|retreat(?:s|ed|ing)?|withdraw(?:s|al|n|ing)?|encircl(?:e|es|ed|ement)|surrender(?:s|ed|ing)?|ceasefire|armistice|collapse(?:s|d)?|destroy(?:s|ed|ing)?|annihilat(?:e|es|ed|ion)|casualt(?:y|ies)|loss(?:es)?|killed|wounded|captured|gain(?:s|ed)?\s+ground|advance(?:s|d|ing)?|repuls(?:e|es|ed)|defeat(?:s|ed)?|front\s+(?:breaks|collapses)|decisive\s+(?:victory|defeat)|major\s+offensive|general\s+offensive)\b/i;

// Material endogenous changes that can legitimately wake a deferred process even
// when they do not yet carry a hard map/ledger impact. The associated storyline
// update must ALSO move objective state (status/pressure/momentum); this regex alone
// never turns routine prose into a valid re-entry.
const ENDOGENOUS_MATERIAL_CUE_RE =
  /\b(counter[- ]?offensive|counter[- ]?attack|offensive|assault|mutiny|desertion|rebellion|uprising|riot|strike|mass\s+protest|resign(?:s|ed|ation)?|dismiss(?:es|ed|al)?|appoint(?:s|ed|ment)?|replac(?:e|es|ed|ement)|command\s+change|leadership\s+change|mobiliz(?:e|es|ed|ation)|reinforc(?:e|es|ed|ement)|conscription|ammunition\s+shortage|supply\s+(?:crisis|collapse|shortage)|food\s+shortage|epidemic|disease\s+outbreak|peace\s+(?:feelers?|talks?|proposal)|negotiat(?:e|es|ed|ion|ions)|mediat(?:e|es|ed|ion)|sanction(?:s|ed)?|election|vote|prototype|production\s+begins|enters\s+service|inaugurat(?:e|es|ed|ion)|complet(?:e|es|ed|ion)|bankrupt(?:cy)?|financial\s+crisis|political\s+crisis|government\s+crisis|cabinet\s+crisis|general\s+staff\s+shakeup)\b/i;

const WAR_DEPENDENT_HOMEFRONT_RE =
  /\b(wartime\s+(?:economy|rationing|food\s+(?:policy|distribution)|mobilization|demobilization|tax(?:es|ation)?|controls?|shortages?|production|administration)|war\s+economy|war\s+tax(?:es|ation)?|home[- ]front\s+(?:rationing|shortages?|mobilization)|demobilization\s+(?:crisis|strain|pressures?))\b/i;

const PREPAREDNESS_RE =
  /\b(prepare(?:s|d|ing|ation)?|preparedness|contingenc(?:y|ies)|simulate(?:s|d|ing|ion)?|test(?:s|ed|ing)?|exercise(?:s|d)?|reserve(?:s)?|stockpil(?:e|es|ed|ing)|study|studies|examin(?:e|es|ed|ing)|plan(?:s|ned|ning)?|potential\s+war|future\s+war|in\s+the\s+event\s+of\s+war|if\s+war|emergency\s+planning)\b/i;

const FOREIGN_SPILLOVER_RE =
  /\b(spillover|foreign\s+war|neighbou?r(?:ing)?\s+(?:war|conflict)|disrupted\s+imports?|refugee\s+pressure|border\s+trade\s+(?:disruption|interruption)|external\s+conflict|sanctions?|embargo|shipping\s+disruption|trade\s+disruption)\b/i;

const PROCESS_ONLY_POLITY_UPDATE_RE =
  /\b(debate(?:s|d)?|review(?:s|ed)?|meeting(?:s)?|committee|study|studies|proposal|discussion(?:s)?|consultation(?:s)?|hearing(?:s)?|assessment|conference|deliberation(?:s)?)\b/i;

const CONCRETE_POLITY_OUTCOME_RE =
  /\b(pass(?:es|ed)?|adopt(?:s|ed)?|enact(?:s|ed)?|approv(?:e|es|ed)|implement(?:s|ed)?|appoint(?:s|ed)?|resign(?:s|ed)?|dismiss(?:es|ed)?|dissolv(?:e|es|ed)|reorganiz(?:e|es|ed)|reform(?:s|ed)?|establish(?:es|ed)|abolish(?:es|ed)|ratif(?:y|ies|ied)|decree(?:s|d)?|takes?\s+office|government\s+(?:falls|forms)|constitution(?:al)?\s+(?:change|reform)|coup|law\s+(?:passes|is\s+enacted))\b/i;


const ROUTINE_ADMINISTRATIVE_CUE_RE =
  /\b(?:technical review|committee review|working group|administrative implementation|implementation review|compliance review|compliance tracking|inspection protocol|inspection standards|regulatory harmonization|protocol refinement|procedural update|standards update|monitoring framework|coordination mechanism|advisory committee|streamlined (?:procedures|protocols|standards)|finaliz(?:e|es|ed) (?:technical|administrative|inspection|compliance|procedural|regulatory)|publishes? (?:a )?(?:routine )?(?:review|assessment|report)|reports? on implementation)\b/i;

const ADMINISTRATIVE_MATERIAL_OUTCOME_RE =
  /\b(?:law (?:passes|is enacted)|tax (?:raised|cut|introduced)|ban (?:takes effect|imposed)|resign(?:s|ed|ation)|appoint(?:s|ed|ment)|government (?:falls|forms)|election|referendum|strike|protest|riot|shortage|shutdown|bank failure|default|market crash|mobiliz(?:e|es|ed|ation)|deploy(?:s|ed|ment)|sanction(?:s|ed)|embargo|treaty|agreement (?:signed|reached)|ceasefire|martial law|state of emergency|opens? (?:a )?(?:factory|plant|facility)|enters service|production begins|becomes operational|disaster|accident)\b/i;

// A crisis-discovery lane is satisfied only by a genuinely NEW persistent
// unstable process, not by another administrative card that happens to use the
// word "crisis". The model still decides whether such a process exists.
const CRISIS_DISCOVERY_KIND_RE =
  /\b(crisis|revolution|uprising|insurgency|secession|constitutional|succession|financial|banking|government|political|security|standoff|coup)\b/i;

// R3.6 — native trajectory value. This is intentionally cheap and conservative:
// it does not decide history or force drama. It only tells candidate selection that
// a grounded process with several materially different future branches is normally
// more valuable than another isolated administrative success when both are valid.
const TRAJECTORY_BREAKPOINT_RE =
  /\b(coup(?: attempt)?|mutiny|uprising|rebellion|insurgency|secession|civil war|government falls?|cabinet collapses?|banking panic|bank run|sovereign default|currency crash|constitutional crisis|succession crisis|martial law|state of emergency|mobiliz(?:e|es|ed|ation)|ultimatum|blockade|border clash|armed clash|incursion|direct clash|nuclear alert)\b/i;
const TRAJECTORY_INSTABILITY_RE =
  /\b(reject(?:s|ed|ion)?|refus(?:e|es|ed|al)|schism|split(?:s|ting)?|breakaway|autonomy|federal tension|regional defiance|mass protest|general strike|nationwide strike|industrial dispute|leadership challenge|confidence vote|impeach(?:ment)?|sanction(?:s|ed)?|missile test|ends? (?:the )?moratorium|withdraw(?:s|al)? from|deadlock|talks? (?:fail|collapse|break down)|credit crunch|liquidity crisis|debt crisis|shortage|rationing|separatist|ethnic tension|communal violence)\b/i;
const TRAJECTORY_CAPABILITY_RE =
  /\b(enters? service|commission(?:s|ed)?|deploy(?:s|ed|ment)|production begins|factory opens?|plant opens?|law (?:passes|is enacted|is signed)|signs? (?:a |the )?(?:treaty|accord|agreement)|ratif(?:y|ies|ied)|election result|resign(?:s|ed|ation)|appoint(?:s|ed|ment)|reorganiz(?:e|es|ed)|restructur(?:e|es|ed)|merger|launches? (?:a )?(?:major )?(?:programme|program|facility)|operational)\b/i;
const TRAJECTORY_SETTLED_RE =
  /\b(avert(?:s|ed|ing)|settlement reached|agreement reached|deal reached|resolved|stabiliz(?:e|es|ed|ation)|stands? down|de[- ]?escalat(?:e|es|ed|ion)|ceasefire|armistice)\b/i;

const TRAJECTORY_REPORTING_RE =
  /\b(quarterly|annual|monthly)\s+(?:trade |economic |industrial |export |market )?(?:outlook|assessment|review|report)|publishes? (?:its |a )?(?:quarterly |annual |monthly )?(?:outlook|assessment|review|report)|releases? (?:its |a )?(?:quarterly |annual |monthly )?(?:outlook|assessment|review|report)\b/i;

// R3.7 — low-trajectory feed saturation guard. This is intentionally narrower
// than "administrative event": one concrete technical/implementation milestone is
// fine. What we suppress is a cluster of low-branch cards monopolising scarce
// visible slots while the recent feed is already full of the same texture.
const LOW_TRAJECTORY_INSTITUTIONAL_RE =
  /\b(?:technical (?:dialogue|consultations?|talks?|working sessions?|coordination)|working[- ]level consultations?|bilateral working sessions?|regulatory sandbox|administrative network|municipal data network|compliance framework|coordination framework|coordination mechanism|implementation framework|quarterly (?:outlook|assessment|review|report)|refinancing (?:facility|window)|customs efficiency|procedural harmonization|standards alignment)\b/i;
const LOW_TRAJECTORY_RECENT_WINDOW = 12;
const LOW_TRAJECTORY_RECENT_SATURATION = 4;
const LOW_TRAJECTORY_BATCH_TRIGGER = 3;

export const deriveWorldTrajectoryValue = (record = {}) => {
  const text = `${normalizeString(record?.title)} ${normalizeString(record?.description || record?.detail || record?.state)}`;
  const hardImpacts = hardImpactKeysForEvent(record).length;
  if (TRAJECTORY_BREAKPOINT_RE.test(text)) return 5;
  if (TRAJECTORY_INSTABILITY_RE.test(text) && !TRAJECTORY_SETTLED_RE.test(text)) return 4;
  if (hardImpacts >= 2) return 4;
  if (hardImpacts === 1 || TRAJECTORY_CAPABILITY_RE.test(text)) return 3;
  if (TRAJECTORY_REPORTING_RE.test(text)) return 0;
  if (ROUTINE_ADMINISTRATIVE_CUE_RE.test(text) && !ADMINISTRATIVE_MATERIAL_OUTCOME_RE.test(text)) return 0;
  if (TRAJECTORY_SETTLED_RE.test(text)) return 2;
  return 1;
};

const latentCrisisConsequenceChannels = (text) => {
  const channels = new Set(["persistent storyline"]);
  if (/\b(border|military|missile|mobiliz|security|clash|incursion|blockade|armed)\b/i.test(text)) {
    channels.add("relations");
    channels.add("units / readiness");
    channels.add("war or territorial control if belligerency actually crosses the threshold");
  }
  if (/\b(secession|autonomy|federal|constitutional|government|coup|succession|leadership)\b/i.test(text)) {
    channels.add("polity/government state");
    channels.add("relations");
  }
  if (/\b(bank|credit|debt|currency|financial|shortage|strike|labou?r|industry)\b/i.test(text)) {
    channels.add("Stats / economic-social state");
  }
  return [...channels].slice(0, 5);
};

const deriveLatentCrisisDiscoveryCandidate = ({
  causalCandidates = [],
  actorResolver,
  playerSphereKeys = new Set(),
} = {}) => {
  const rows = [];
  for (const candidate of normalizeArray(causalCandidates)) {
    if (normalizeArray(candidate?.storylineIds).length) continue;
    const text = `${normalizeString(candidate?.title)} ${normalizeString(candidate?.detail)}`;
    const trajectoryValue = deriveWorldTrajectoryValue(candidate);
    if (trajectoryValue < 4 || TRAJECTORY_SETTLED_RE.test(text)) continue;

    const actors = actorResolver.mentionedPolities(text)
      .map((actor) => actorResolver.canonical(actor))
      .filter(Boolean);
    if (!actors.length) continue;

    const widerActors = actors.filter((actor) => !playerSphereKeys.has(actor.toLowerCase()));
    if (!widerActors.length) continue;

    rows.push({
      actor: widerActors[0],
      actors: uniqueStrings(actors).slice(0, 4),
      sourceCandidateId: normalizeString(candidate?.id),
      sourceTitle: normalizeString(candidate?.title),
      sourceDetail: normalizeString(candidate?.detail),
      trajectoryValue,
      score: (Number(candidate?.score) || 0) + trajectoryValue * 3,
      consequenceChannels: latentCrisisConsequenceChannels(text),
    });
  }

  return rows.sort((a, b) =>
    (b.score - a.score) ||
    (b.trajectoryValue - a.trajectoryValue) ||
    a.actor.localeCompare(b.actor)
  )[0] || null;
};

const normalizeString = (value) =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeArray = (value) =>
  Array.isArray(value) ? value : [];


const eventMentionsPolity = (event, polity) => {
  const token = normalizeString(polity);
  if (!token) return true;
  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`.toLocaleLowerCase();
  return text.includes(token.toLocaleLowerCase());
};

// FC5B: canonical war state must be legible in the visible event that creates or
// carries it. A model may correctly emit combatants/war lifecycle while writing
// prose that only mentions proxies or one side. Native repair keeps the accepted
// canonical meaning visible without spending another model request.
export const repairVisibleWarEventCoherence = (candidate) => {
  let repaired = 0;
  for (const event of normalizeArray(candidate?.events)) {
    if (!event || typeof event !== "object") continue;
    const warId = normalizeString(event?.warId);
    const combatants = [...new Set(normalizeArray(event?.combatants).map(normalizeString).filter(Boolean))];
    if (!warId || combatants.length < 2) continue;
    const missing = combatants.filter((polity) => !eventMentionsPolity(event, polity));
    if (!missing.length) continue;
    const allNamed = combatants.join(" and ");
    const suffix = ` Canonical belligerents in this fighting include ${allNamed}; their exact form of involvement remains as recorded in the campaign war state.`;
    event.description = `${normalizeString(event?.description)}${suffix}`.trim();
    repaired += 1;
  }
  return { repaired };
};

const uniqueStrings = (items) => [...new Set(
  normalizeArray(items).map(normalizeString).filter(Boolean),
)];

const stableHash = (value) => {
  let hash = 2166136261;
  for (const ch of String(value ?? "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// Milliseconds for a game date, BC included (runtime/gameDates.js).
const parseIsoDate = (value) => {
  const dayNumber = gameDateDayNumber(value);
  return dayNumber === null ? null : dayNumber * 86400000;
};

export const worldIntegrityAgeDays = (originDate, eventDate) => {
  const origin = parseIsoDate(originDate);
  const event = parseIsoDate(eventDate);
  if (origin == null || event == null) return 99999;
  return Math.max(0, Math.round((origin - event) / 86400000));
};

export const latestCanonicalWorldEventDate = (events, originDate) =>
  normalizeArray(events)
    .map((event) => normalizeString(event?.date))
    .filter((date) => parseIsoDate(date) != null && (!originDate || compareGameDates(date, originDate) <= 0))
    .sort(compareGameDates)
    .at(-1) || "";

const activeWarEntries = (world) =>
  normalizeArray(world?.wars).filter((war) =>
    ["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())
  );

const activeBelligerentSet = (world) => {
  const set = new Set();
  for (const war of activeWarEntries(world)) {
    for (const actor of [...normalizeArray(war?.sideA), ...normalizeArray(war?.sideB)]) {
      const key = normalizeString(actor).toLowerCase();
      if (key) set.add(key);
    }
  }
  return set;
};

const polityAliasRecords = (world, gameCountry = "") => {
  const records = [];
  const overrideAliasMap = new Map();

  for (const [key, entry] of Object.entries(world?.polityOverrides || {})) {
    const canonical = normalizeString(entry?.name || entry?.code || key);
    if (!canonical) continue;

    for (const alias of uniqueStrings([
      canonical,
      key,
      entry?.code,
      entry?.name,
      ...normalizeArray(entry?.aliases),
    ])) {
      overrideAliasMap.set(alias.toLowerCase(), canonical);
    }
  }

  const canonicalize = (token) => {
    const raw = normalizeString(token);
    if (!raw) return "";
    return overrideAliasMap.get(raw.toLowerCase()) || raw;
  };

  const add = (token, aliases = []) => {
    const canonical = canonicalize(token);
    if (!canonical) return;

    const expandedAliases = uniqueStrings([
      canonical,
      token,
      ...normalizeArray(aliases),
    ]);

    const stockCodes = uniqueStrings(
      expandedAliases
        .map((alias) => resolveStockCountryCode(alias))
        .filter(Boolean),
    );

    records.push({
      canonical,
      aliases: expandedAliases,
      stockCodes,
    });
  };

  add(gameCountry);

  for (const [key, entry] of Object.entries(world?.polityOverrides || {})) {
    add(
      entry?.name || entry?.code || key,
      [key, entry?.code, entry?.name, ...normalizeArray(entry?.aliases)],
    );
  }

  for (const key of Object.keys(world?.countryStats || {})) add(key);

  // Territory ownership is identity provenance too. A bounded/normalized world
  // view may omit full polityOverrides while still carrying exact active owner
  // names. Admit those names so stock short aliases such as "North Korea" can
  // resolve back to the campaign identity "Democratic People's Republic of Korea".
  for (const owner of uniqueStrings(Object.values(world?.regionOwnershipOverrides || {}))) add(owner);
  for (const owner of uniqueStrings(Object.values(world?.regionSovereigntyOverrides || {}))) add(owner);
  for (const actor of uniqueStrings(
    Object.values(world?.regionClaimants || {}).flatMap((claimants) => normalizeArray(claimants)),
  )) add(actor);

  for (const war of normalizeArray(world?.wars)) {
    for (const actor of [...normalizeArray(war?.sideA), ...normalizeArray(war?.sideB)]) {
      add(actor);
    }
  }

  for (const relation of normalizeArray(world?.relations)) {
    add(relation?.polityA || relation?.a || relation?.actorA);
    add(relation?.polityB || relation?.b || relation?.actorB);
  }

  for (const agreement of normalizeArray(world?.agreements)) {
    for (const actor of normalizeArray(agreement?.parties)) add(actor);
  }

  for (const storyline of normalizeArray(world?.storylines)) {
    for (const actor of normalizeArray(storyline?.participants)) add(actor);
  }

  const byCanonical = new Map();

  for (const record of records) {
    const key = record.canonical.toLowerCase();
    const prior = byCanonical.get(key);

    byCanonical.set(key, {
      canonical: prior?.canonical || record.canonical,
      aliases: uniqueStrings([
        ...(prior?.aliases || []),
        ...record.aliases,
      ]),
      stockCodes: uniqueStrings([
        ...(prior?.stockCodes || []),
        ...normalizeArray(record.stockCodes),
      ]),
    });
  }

  return [...byCanonical.values()];
};

export const createWorldActorResolver = (world, gameCountry = "") => {
  const records = polityAliasRecords(world, gameCountry);
  const byAlias = new Map();
  const byCanonical = new Map();
  const stockToCanonicals = new Map();

  for (const record of records) {
    const canonical = normalizeString(record?.canonical);
    if (!canonical) continue;
    byCanonical.set(canonical.toLowerCase(), record);
    for (const alias of uniqueStrings([canonical, ...normalizeArray(record?.aliases)])) {
      const key = alias.toLowerCase();
      if (!byAlias.has(key)) byAlias.set(key, canonical);
    }
    for (const code of normalizeArray(record?.stockCodes)) {
      const key = normalizeString(code).toUpperCase();
      if (!key) continue;
      if (!stockToCanonicals.has(key)) stockToCanonicals.set(key, new Set());
      stockToCanonicals.get(key).add(canonical);
    }
  }

  // Current-state identity intentionally excludes storylines, because a stale
  // storyline alias is exactly what this precedence layer is meant to heal.
  const authoritativeTokens = uniqueStrings([
    gameCountry,
    ...Object.entries(world?.polityOverrides || {}).flatMap(([keyValue, entry]) => [
      keyValue,
      entry?.code,
      entry?.name,
      ...normalizeArray(entry?.aliases),
    ]),
    ...Object.keys(world?.countryStats || {}),
    ...Object.values(world?.regionOwnershipOverrides || {}),
    ...Object.values(world?.regionSovereigntyOverrides || {}),
    ...Object.values(world?.regionClaimants || {}).flatMap((claimants) => normalizeArray(claimants)),
    ...normalizeArray(world?.wars).flatMap((war) => [
      ...normalizeArray(war?.sideA),
      ...normalizeArray(war?.sideB),
    ]),
    ...normalizeArray(world?.relations).flatMap((relation) => [
      relation?.polityA || relation?.a || relation?.actorA,
      relation?.polityB || relation?.b || relation?.actorB,
    ]),
    ...normalizeArray(world?.agreements).flatMap((agreement) => normalizeArray(agreement?.parties)),
  ]);

  const authoritativeByStock = new Map();
  for (const token of authoritativeTokens) {
    const code = normalizeString(resolveStockCountryCode(token)).toUpperCase();
    if (!code) continue;
    const canonical =
      byAlias.get(normalizeString(token).toLowerCase()) ||
      normalizeString(token);
    if (!canonical) continue;
    if (!authoritativeByStock.has(code)) authoritativeByStock.set(code, new Set());
    authoritativeByStock.get(code).add(canonical);
  }

  const canonical = (actor) => {
    const raw = normalizeString(actor);
    if (!raw) return "";
    const stockCode = normalizeString(resolveStockCountryCode(raw)).toUpperCase();

    if (stockCode) {
      const authoritative = [...(authoritativeByStock.get(stockCode) || [])];
      if (authoritative.length === 1) return authoritative[0];
    }

    const exact = byAlias.get(raw.toLowerCase());
    if (exact) return exact;

    if (stockCode) {
      const matches = [...(stockToCanonicals.get(stockCode) || [])];
      if (matches.length === 1) return matches[0];
    }

    return raw;
  };

  // `canonical()` intentionally preserves an unknown token as itself because
  // several legacy callers use it as a normalization helper. Grounding cannot
  // treat that fallback as proof that the token is a real polity, though. This
  // stricter resolver is for legal/canonical ownership decisions.
  const knownCanonical = (actor) => {
    const resolved = canonical(actor);
    return resolved && byCanonical.has(resolved.toLowerCase()) ? resolved : "";
  };

  const equivalent = (left, right) => {
    const a = canonical(left).toLowerCase();
    const b = canonical(right).toLowerCase();
    return Boolean(a && b && a === b);
  };

  const aliasesFor = (actor) => {
    const target = canonical(actor);
    const record = byCanonical.get(target.toLowerCase());
    return uniqueStrings([target, ...(record?.aliases || [])]);
  };

  const mentioned = (value) => {
    const haystack = ` ${normalizeString(value).toLowerCase()} `;
    const matches = [];
    for (const record of records) {
      const aliases = uniqueStrings([record.canonical, ...normalizeArray(record.aliases)])
        .sort((a, b) => b.length - a.length);
      if (aliases.some((alias) => {
        const token = normalizeString(alias).toLowerCase();
        if (!token || token.length < 3) return false;
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(haystack);
      })) {
        matches.push(record.canonical);
      }
    }
    return uniqueStrings(matches);
  };

  return {
    records,
    canonical,
    knownCanonical,
    equivalent,
    aliasesFor,
    mentionedPolities: mentioned,
  };
};

export const canonicalWorldActor = (actor, world, gameCountry = "") =>
  createWorldActorResolver(world, gameCountry).canonical(actor);


export const worldActorsEquivalent = (
  left,
  right,
  world,
  gameCountry = "",
) => {
  const a = canonicalWorldActor(left, world, gameCountry).toLowerCase();
  const b = canonicalWorldActor(right, world, gameCountry).toLowerCase();
  return Boolean(a && b && a === b);
};

const actorMentionedInText = (actor, text, world, gameCountry = "") => {
  const target = normalizeString(actor);
  if (!target) return true;

  const haystack = ` ${normalizeString(text).toLowerCase()} `;
  const record = polityAliasRecords(world, gameCountry)
    .find((entry) => entry.canonical.toLowerCase() === target.toLowerCase());

  const aliases = uniqueStrings([target, ...(record?.aliases || [])])
    .sort((a, b) => b.length - a.length);

  return aliases.some((alias) => {
    const token = normalizeString(alias).toLowerCase();
    if (!token || token.length < 3) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i")
      .test(haystack);
  });
};

const mentionedPolities = (text, world, gameCountry = "") => {
  const matches = [];
  for (const record of polityAliasRecords(world, gameCountry)) {
    if (actorMentionedInText(record.canonical, text, world, gameCountry)) {
      matches.push(record.canonical);
    }
  }
  return uniqueStrings(matches);
};

const actorIsActiveBelligerent = (actor, world) => {
  const rawBelligerents = activeBelligerentSet(world);
  const target = normalizeString(actor).toLowerCase();
  if (!target) return false;
  if (rawBelligerents.has(target)) return true;

  const record = polityAliasRecords(world)
    .find((entry) => entry.canonical.toLowerCase() === target);

  return Boolean(record?.aliases.some((alias) =>
    rawBelligerents.has(normalizeString(alias).toLowerCase())
  ));
};

const hardImpactKeysForEvent = (event) => {
  const impacts =
    event?.impacts && typeof event.impacts === "object"
      ? event.impacts
      : {};

  const keys = [];

  for (const key of [
    "regionTransfers",
    "regionClaims",
    "groupOps",
    "regionControlOps",
    "politicalActorOps",
    "unitOps",
    "markerOps",
    "createdChats",
  ]) {
    if (normalizeArray(impacts[key]).length) keys.push(key);
  }

  const lifecycle = normalizeArray(impacts?.polityChanges).filter((change) =>
    ["create", "rename", "restore", "dissolve"].includes(
      normalizeString(change?.operation).toLowerCase()
    )
  );

  if (lifecycle.length) keys.push("polityLifecycle");
  return keys;
};

const transportReferencesEventNumber = (value, oneBasedEventNumber) => {
  const target = Number(oneBasedEventNumber);
  if (!Number.isInteger(target) || target < 1) return false;

  return String(value ?? "")
    .split(/\r?\n/)
    .some((line) => {
      const fields = line.split("~");
      if (fields.length < 5) return false;

      return fields[4]
        .split(",")
        .map((item) => Number.parseInt(item.trim(), 10))
        .some((item) => item === target);
    });
};

const eventHasLedgerTrigger = (candidate, zeroBasedEventIndex) => {
  const oneBased = zeroBasedEventIndex + 1;

  return [
    candidate?.warUpdates,
    candidate?.relationUpdates,
    candidate?.agreementUpdates,
  ].some((value) =>
    transportReferencesEventNumber(value, oneBased)
  );
};

const newParticipantsMentionedInEvent = (prior, update, event) => {
  const before = new Set(
    normalizeArray(prior?.participants)
      .map((item) => normalizeString(item).toLowerCase())
      .filter(Boolean),
  );

  const additions = normalizeArray(update?.participants)
    .map(normalizeString)
    .filter(Boolean)
    .filter((participant) => !before.has(participant.toLowerCase()));

  if (!additions.length) return false;

  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;

  return additions.some((participant) =>
    actorMentionedInText(participant, text, {}, "")
  );
};

const deferredUpdateHasObjectiveDelta = (prior, update) => {
  if (!prior || !update) return false;

  const priorStatus = normalizeString(prior?.status).toLowerCase();
  const nextStatus = normalizeString(update?.status).toLowerCase();
  if (nextStatus && nextStatus !== priorStatus) return true;

  const priorPressure = Math.max(0, Math.min(100, Number(prior?.pressure) || 0));
  const nextPressure = Math.max(0, Math.min(100, Number(update?.pressure) || 0));
  if (Math.abs(nextPressure - priorPressure) >= 4) return true;

  const priorMomentum = Math.max(0, Math.min(100, Number(prior?.momentum) || 0));
  const nextMomentum = Math.max(0, Math.min(100, Number(update?.momentum) || 0));
  return Math.abs(nextMomentum - priorMomentum) >= 6;
};

export const deferredStorylineReentryHasConcreteTrigger = (
  candidate,
  eventIndexes,
  prior,
  update,
  { requireObjectiveDelta = true } = {},
) =>
  normalizeArray(eventIndexes).some((eventIndex) => {
    const event = normalizeArray(candidate?.events)[eventIndex];
    if (!event) return false;

    // Existing hard mechanics/ledger transitions remain sufficient by themselves.
    if (hardImpactKeysForEvent(event).length) return true;
    if (eventHasLedgerTrigger(candidate, eventIndex)) return true;
    if (newParticipantsMentionedInEvent(prior, update, event)) return true;

    const text =
      `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;

    // Routine battlefield continuity is still not a trigger, even if the model
    // tries to buy re-entry by nudging pressure/momentum. A concrete consequence
    // such as casualties, capture, retreat, breakthrough, etc. escapes this gate.
    if (
      ROUTINE_MILITARY_CUE_RE.test(text) &&
      !STRONG_MILITARY_CONSEQUENCE_RE.test(text)
    ) {
      return false;
    }

    if (requireObjectiveDelta && !deferredUpdateHasObjectiveDelta(prior, update)) return false;

    if (STRONG_MILITARY_CONSEQUENCE_RE.test(text)) return true;
    if (ENDOGENOUS_MATERIAL_CUE_RE.test(text)) return true;

    const importance = normalizeString(event?.importance).toLowerCase();
    if (event?.notable === true || ["major", "critical"].includes(importance)) {
      return true;
    }

    return false;
  });

const actorPoolForExploration = (
  bundle,
  diplomaticActors = [],
  causalCandidates = [],
) => {
  const world = bundle?.world || {};
  const gameCountry = normalizeString(bundle?.game?.country);
  const actorResolver = createWorldActorResolver(world, gameCountry);
  const playerCanonical = actorResolver.canonical(gameCountry);
  const weighted = [];

  const add = (actor, weight = 1, reason = "") => {
    const text = actorResolver.canonical(actor);
    if (!text) return;

    // The human polity may belong to the PLAYER-SPHERE as a causal target, but it
    // must never receive its own autonomous actor-domain exploration lane. A named
    // player slot strongly invites the model to invent cabinet/parliament/foreign-
    // policy choices merely to satisfy exploration. Connected NPC actors and the
    // regional/system lanes keep the player's sphere alive without granting that
    // sovereign discretion.
    if (playerCanonical && actorResolver.equivalent(text, playerCanonical)) return;

    weighted.push({
      actor: text,
      weight: Math.max(0, Number(weight) || 0),
      reason: normalizeString(reason),
    });
  };

  // Named exploration slots must be earned by CURRENT campaign evidence.
  // The previous implementation added every alias/stat entry in the save,
  // which turned the world sweep into a tour of tiny states, dormant regimes,
  // and future/historical catalog identities. The human polity is deliberately
  // excluded by add(): PLAYER-SPHERE is an attention scope, not permission for
  // autonomous player-government decisions.

  for (const actor of normalizeArray(diplomaticActors)) {
    add(actor, 9, "active diplomatic ledger");
  }

  for (const war of activeWarEntries(world)) {
    for (const actor of [...normalizeArray(war?.sideA), ...normalizeArray(war?.sideB)]) {
      add(actor, 8, `active canonical conflict ${normalizeString(war?.id) || "war"}`);
    }
  }

  for (const storyline of normalizeArray(world?.storylines)) {
    const status = normalizeString(storyline?.status).toLowerCase();
    if (status === "resolved") continue;
    for (const actor of normalizeArray(storyline?.participants)) {
      add(
        actor,
        status === "active" ? 7 : 4,
        `unresolved ${normalizeString(storyline?.kind) || "world"} storyline`,
      );
    }
  }

  for (const agreement of normalizeArray(world?.agreements)) {
    const status = normalizeString(agreement?.status).toLowerCase();
    if (["ended", "expired", "terminated"].includes(status)) continue;
    for (const actor of normalizeArray(agreement?.parties)) {
      add(actor, 7, `formal ${normalizeString(agreement?.type) || "agreement"} relationship`);
    }
  }

  for (const relation of normalizeArray(world?.relations)) {
    add(relation?.polityA || relation?.a || relation?.actorA, 6, "bilateral relation ledger");
    add(relation?.polityB || relation?.b || relation?.actorB, 6, "bilateral relation ledger");
  }

  for (const unit of normalizeArray(world?.units)) {
    add(unit?.ownerCode || unit?.owner, 6, "persistent military presence");
  }

  for (const owner of uniqueStrings(Object.values(world?.regionOwnershipOverrides || {}))) {
    add(owner, 6, "current de-facto territorial state");
  }
  for (const owner of uniqueStrings(Object.values(world?.regionSovereigntyOverrides || {}))) {
    add(owner, 6, "current legal territorial state");
  }
  for (const actor of uniqueStrings(
    Object.values(world?.regionClaimants || {}).flatMap((claimants) => normalizeArray(claimants)),
  )) {
    add(actor, 6, "current territorial claim/contest");
  }

  for (const [key, entry] of Object.entries(world?.polityOverrides || {})) {
    if (normalizeString(entry?.status).toLowerCase() === "active") {
      add(entry?.name || entry?.code || key, 5, "explicitly active polity lifecycle");
    }
  }

  // Current causal evidence may introduce a relevant actor that is not otherwise
  // present in a formal ledger. This is bounded to the Director's filtered
  // present-tense evidence, never the raw full history.
  for (const candidate of normalizeArray(causalCandidates)) {
    const text = `${normalizeString(candidate?.title)} ${normalizeString(candidate?.detail)}`;
    for (const actor of actorResolver.mentionedPolities(text)) {
      add(actor, 8, `current evidence: ${normalizeString(candidate?.title) || "active development"}`);
    }
  }

  const best = new Map();
  for (const row of weighted) {
    const key = row.actor.toLowerCase();
    const prior = best.get(key);
    if (!prior) {
      best.set(key, {
        actor: row.actor,
        weight: row.weight,
        reasons: row.reason ? [row.reason] : [],
      });
      continue;
    }

    prior.weight = Math.max(prior.weight, row.weight);
    if (row.reason && !prior.reasons.includes(row.reason)) {
      prior.reasons.push(row.reason);
    }
  }

  return [...best.values()];
};

const buildPlayerSphereActorKeys = ({
  bundle,
  diplomaticActors = [],
  causalCandidates = [],
  actorResolver,
} = {}) => {
  const world = bundle?.world || {};
  const player = actorResolver.canonical(bundle?.game?.country);
  const playerKey = normalizeString(player).toLowerCase();
  const keys = new Set();
  const add = (actor) => {
    const canonical = actorResolver.canonical(actor);
    const key = normalizeString(canonical).toLowerCase();
    if (key) keys.add(key);
  };

  add(player);

  // The bounded diplomatic context is already selected around the player and
  // active processes, so its actors are legitimate members of the player's
  // current causal sphere rather than arbitrary geographic catalog entries.
  for (const actor of normalizeArray(diplomaticActors)) add(actor);

  for (const relation of normalizeArray(world?.relations)) {
    const a = actorResolver.canonical(relation?.polityA || relation?.a || relation?.actorA);
    const b = actorResolver.canonical(relation?.polityB || relation?.b || relation?.actorB);
    if (normalizeString(a).toLowerCase() === playerKey) add(b);
    if (normalizeString(b).toLowerCase() === playerKey) add(a);
  }

  for (const agreement of normalizeArray(world?.agreements)) {
    const parties = normalizeArray(agreement?.parties).map((actor) => actorResolver.canonical(actor));
    if (parties.some((actor) => normalizeString(actor).toLowerCase() === playerKey)) {
      for (const actor of parties) add(actor);
    }
  }

  for (const war of activeWarEntries(world)) {
    const actors = [...normalizeArray(war?.sideA), ...normalizeArray(war?.sideB)]
      .map((actor) => actorResolver.canonical(actor));
    if (actors.some((actor) => normalizeString(actor).toLowerCase() === playerKey)) {
      for (const actor of actors) add(actor);
    }
  }

  for (const storyline of normalizeArray(world?.storylines)) {
    if (normalizeString(storyline?.status).toLowerCase() === "resolved") continue;
    const participants = normalizeArray(storyline?.participants)
      .map((actor) => actorResolver.canonical(actor));
    if (participants.some((actor) => normalizeString(actor).toLowerCase() === playerKey)) {
      for (const actor of participants) add(actor);
    }
  }

  // Current evidence can pull a nearby/connected actor into the sphere even
  // before a formal relation ledger exists. This is intentionally bounded to
  // the Director's present-tense causal candidate set.
  for (const candidate of normalizeArray(causalCandidates)) {
    const text = `${normalizeString(candidate?.title)} ${normalizeString(candidate?.detail)}`;
    const mentioned = actorResolver.mentionedPolities(text);
    if (mentioned.some((actor) => normalizeString(actor).toLowerCase() === playerKey)) {
      for (const actor of mentioned) add(actor);
    }
  }

  return keys;
};

export const buildNativeWorldExplorationSlate = ({
  bundle,
  allStorylines = [],
  selectedStorylines = [],
  diplomaticActors = [],
  causalCandidates = [],
  crisisCandidates = causalCandidates,
} = {}) => {
  const actorRows = actorPoolForExploration(
    bundle,
    diplomaticActors,
    causalCandidates,
  );
  const actorResolver = createWorldActorResolver(
    bundle?.world || {},
    normalizeString(bundle?.game?.country),
  );
  const originDate = normalizeString(bundle?.game?.gameDate);
  const round = Math.max(0, Math.trunc(Number(bundle?.game?.round) || 0));
  const seed = stableHash(
    `${originDate}|${round}|${actorRows.map((row) => row.actor).sort().join("|")}`,
  );

  const selectedIds = new Set(
    normalizeArray(selectedStorylines)
      .map((storyline) => normalizeString(storyline?.id))
      .filter(Boolean),
  );

  // Selected storylines already give their participants dedicated causal
  // attention. Keep them out of independent actor-domain slots so a crisis actor
  // cannot earn another routine card merely by being salient. R3.6 fixes the live
  // 1/9 scope imbalance with same-scope SYSTEM fillers instead of violating this
  // separation.
  const selectedParticipantKeys = new Set(
    normalizeArray(selectedStorylines)
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map((actor) => actorResolver.canonical(actor).toLowerCase())
      .filter(Boolean),
  );

  const deferred = normalizeArray(allStorylines)
    .filter((storyline) =>
      normalizeString(storyline?.status).toLowerCase() !== "resolved" &&
      !selectedIds.has(normalizeString(storyline?.id))
    );

  // R3.6 composition target: five PLAYER-SPHERE evaluation lanes and five
  // WIDER-WORLD lanes by construction. This does NOT mean five local + five global
  // events. Quiet lanes stay quiet. Actor scarcity is handled by system/global
  // lanes rather than silently turning a 50/50 scheduler into 1/9.
  const playerSphereKeys = buildPlayerSphereActorKeys({
    bundle,
    diplomaticActors,
    causalCandidates,
    actorResolver,
  });

  const stableRank = (salt) => (a, b) =>
    (b.weight - a.weight) ||
    (stableHash(`${seed}|${salt}|${a.actor}`) - stableHash(`${seed}|${salt}|${b.actor}`)) ||
    a.actor.localeCompare(b.actor);

  const eligibleActorRows = actorRows.filter((row) =>
    !selectedParticipantKeys.has(row.actor.toLowerCase())
  );

  const spherePool = eligibleActorRows
    .filter((row) => playerSphereKeys.has(row.actor.toLowerCase()))
    .sort(stableRank("player-sphere"));

  const widerPool = eligibleActorRows
    .filter((row) => !playerSphereKeys.has(row.actor.toLowerCase()));

  const sphereActors = spherePool
    .slice(0, EXPLORATION_PLAYER_SPHERE_ACTOR_SLOTS)
    .map((row) => ({ ...row, scope: "player-sphere" }));

  const sphereUsed = new Set(sphereActors.map((row) => row.actor.toLowerCase()));
  const widerEvidenceActors = widerPool
    .filter((row) => row.weight > 5)
    .sort(stableRank("wider-evidence"))
    .slice(0, EXPLORATION_WIDER_EVIDENCE_ACTOR_SLOTS)
    .map((row) => ({ ...row, scope: "wider-world" }));

  const widerUsed = new Set(widerEvidenceActors.map((row) => row.actor.toLowerCase()));
  const widerLatentActors = widerPool
    .filter((row) =>
      row.weight <= 5 &&
      !widerUsed.has(row.actor.toLowerCase())
    )
    .sort((a, b) =>
      (stableHash(`${seed}|wider-latent|${a.actor}`) - stableHash(`${seed}|wider-latent|${b.actor}`)) ||
      a.actor.localeCompare(b.actor)
    )
    .slice(0, EXPLORATION_WIDER_LATENT_ACTOR_SLOTS)
    .map((row) => ({
      ...row,
      scope: "wider-world",
      reasons: uniqueStrings([
        ...normalizeArray(row.reasons),
        "rotating latent-world attention: active polity outside the player sphere without a stronger recent evidence slot",
      ]),
    }));

  const widerActors = [...widerEvidenceActors, ...widerLatentActors];
  const usedKeys = new Set([
    ...sphereUsed,
    ...widerActors.map((row) => row.actor.toLowerCase()),
  ]);

  // Fill a sparse side from its own remaining actors first. If one side genuinely
  // cannot fill, borrow from the other side rather than shrinking the world sweep.
  const fillTo = (rows, target, pool, scope, salt) => {
    if (rows.length >= target) return;
    const extras = [...pool]
      .filter((row) => !usedKeys.has(row.actor.toLowerCase()))
      .sort(stableRank(salt));
    for (const row of extras) {
      if (rows.length >= target) break;
      rows.push({ ...row, scope });
      usedKeys.add(row.actor.toLowerCase());
    }
  };

  fillTo(
    sphereActors,
    EXPLORATION_PLAYER_SPHERE_ACTOR_SLOTS,
    spherePool,
    "player-sphere",
    "player-sphere-fill",
  );
  fillTo(
    widerActors,
    EXPLORATION_WIDER_ACTOR_SLOTS,
    widerPool,
    "wider-world",
    "wider-world-fill",
  );

  // Never borrow across the scope boundary just to hit an actor count. Missing
  // PLAYER-SPHERE actor lanes become regional/system lanes below; missing wider
  // actor lanes become wider-system lanes. This preserves both selected-storyline
  // isolation and the 5/5 attention contract.
  const rankedActors = [...sphereActors, ...widerActors];

  const actorSlots = rankedActors.map((row, index) => {
    const actor = row.actor;
    const domain =
      EXPLORATION_DOMAINS[(seed + index * 3) % EXPLORATION_DOMAINS.length];

    const deferredTopics = deferred
      .filter((storyline) =>
        normalizeArray(storyline?.participants)
          .some((participant) => actorResolver.equivalent(actor, participant))
      )
      .slice(0, 3)
      .map((storyline) => normalizeString(storyline?.title))
      .filter(Boolean);

    const candidateEvidence = normalizeArray(causalCandidates)
      .filter((candidate) =>
        actorResolver.aliasesFor(actor).some((alias) => {
          const token = normalizeString(alias).toLowerCase();
          if (!token || token.length < 3) return false;
          const haystack = normalizeString(
            `${normalizeString(candidate?.title)} ${normalizeString(candidate?.detail)}`,
          ).toLowerCase();
          return haystack.includes(token);
        })
      )
      .slice(0, 2)
      .map((candidate) => normalizeString(candidate?.title))
      .filter(Boolean);

    const basisParts = uniqueStrings([
      ...normalizeArray(row.reasons),
      ...candidateEvidence.map((title) => `current causal evidence: ${title}`),
    ]).slice(0, 4);

    return {
      id: index + 1,
      actor,
      domain,
      deferredTopics,
      basis: basisParts.join("; "),
      relevance: row.weight,
      scope: row.scope || (playerSphereKeys.has(actor.toLowerCase()) ? "player-sphere" : "wider-world"),
      type: "actor-domain",
    };
  });

  const latentCrisis = deriveLatentCrisisDiscoveryCandidate({
    // R3.7: dedicated crisis evidence is allowed to come from the full bounded
    // recent-history scan rather than only the ordinary top-10 initiative list.
    causalCandidates: normalizeArray(crisisCandidates).length
      ? crisisCandidates
      : causalCandidates,
    actorResolver,
    playerSphereKeys,
  });

  let nextId = actorSlots.length + 1;
  const systemSlots = [];

  const playerCount = actorSlots.filter((slot) => slot.scope === "player-sphere").length;
  const playerDeficit = Math.max(0, EXPLORATION_TARGET_PER_SCOPE - playerCount);
  for (let index = 0; index < playerDeficit; index += 1) {
    systemSlots.push({
      id: nextId++,
      actor: index === 0 ? "Player-sphere regional system" : `Player-sphere independent system ${index + 1}`,
      domain:
        index === 0
          ? "cross-border reaction, non-sovereign domestic spillover, regional security pressure, incoming diplomacy, economic shock, social response, or a NEW latent problem inside the player's current causal sphere that is not merely another routine update to a selected storyline; do not originate a fresh government/parliament/sovereign choice for the human polity"
          : EXPLORATION_DOMAINS[(seed + 17 + index * 5) % EXPLORATION_DOMAINS.length],
      deferredTopics: [],
      basis:
        "same-scope balance filler: local actors already receiving selected-storyline attention remain excluded from independent actor slots; inspect independent regional/system consequences rather than borrowing a wider-world actor or servicing the selected storyline again. PLAYER-SPHERE is not player authority: if the human government must choose, stop at the pressure/proposal unless exact prior player authority exists",
      relevance: 0,
      scope: "player-sphere",
      type: "regional-system",
    });
  }

  const crisisActor = latentCrisis?.actor || "Wider-world latent instability";
  const crisisBasis = latentCrisis
    ? `PROTECTED CURRENT TRIGGER: ${latentCrisis.sourceTitle}. ${latentCrisis.sourceDetail || ""} ` +
      `Native trajectory value ${latentCrisis.trajectoryValue}/5. Plausible consequence channels if the process genuinely crosses threshold: ${latentCrisis.consequenceChannels.join(", ")}. ` +
      "Do not force escalation; decide whether this evidence has actually become a new persistent unstable process."
    : "No trajectory-4/5 wider-world trigger was found in the bounded present-tense ledger. Search latent instability conservatively; a crisis is not required and war is not the default.";

  systemSlots.push({
    id: nextId++,
    actor: crisisActor,
    domain:
      "CRISIS DISCOVERY: test whether current political legitimacy, elite fracture, constitutional/succession dispute, separatism/federal tension, mass unrest, military-security friction, financial panic, resource shock, sanctions pressure, alliance fracture, or similar instability has crossed from background tension into a genuinely NEW persistent multi-turn crisis",
    deferredTopics: [],
    basis: crisisBasis,
    relevance: latentCrisis?.score || 0,
    scope: "wider-world",
    type: "crisis-discovery",
    targetActor: latentCrisis?.actor || "",
    targetActors: latentCrisis?.actors || [],
    sourceCandidateId: latentCrisis?.sourceCandidateId || "",
    trajectoryValue: latentCrisis?.trajectoryValue || 0,
    consequenceChannels: latentCrisis?.consequenceChannels || [],
  });

  systemSlots.push({
    id: nextId++,
    actor: "Cross-border / wider world system",
    domain:
      "new diplomacy, mediation, alignment, trade, alliance, third-party reaction, technology, industry, social movement, institutional change, disaster, or regional pressure not already represented by a deferred storyline",
    deferredTopics: [],
    basis:
      "scan the wider current map/canon and surviving structural conditions for an independent consequential development; do not resurrect dormant or future polities from memorized history",
    relevance: 0,
    scope: "wider-world",
    type: "global",
  });

  const widerCount = actorSlots.filter((slot) => slot.scope === "wider-world").length +
    systemSlots.filter((slot) => slot.scope === "wider-world").length;
  const widerDeficit = Math.max(0, EXPLORATION_TARGET_PER_SCOPE - widerCount);
  for (let index = 0; index < widerDeficit; index += 1) {
    systemSlots.push({
      id: nextId++,
      actor: `Wider-world independent system ${index + 1}`,
      domain: EXPLORATION_DOMAINS[(seed + 31 + index * 7) % EXPLORATION_DOMAINS.length],
      deferredTopics: [],
      basis:
        "same-scope balance filler: current evidence did not provide another independent named wider-world actor, so inspect structural/latent causes without borrowing a player-sphere actor",
      relevance: 0,
      scope: "wider-world",
      type: "global",
    });
  }

  // Hard cap remains ten. Scope fillers only replace absent actor lanes, so this
  // slice normally removes nothing; it is a final safety guard for malformed saves.
  return [...actorSlots, ...systemSlots].slice(0, 10);
};

export const formatWorldExplorationAuditContract = (slate) => {
  if (!normalizeArray(slate).length) return [];

  return [
    "WORLD SWEEP EVALUATION — REQUIRED INTERNALLY",
    "The native exploration slate below is an evaluation obligation, NOT an event quota.",
    "Evaluate every numbered slot against THIS campaign before finalizing the response. A slot may be genuinely quiet.",
    "Do NOT output WORLD_SWEEP markers, eventN audit references, storyline audit references, or any other audit bookkeeping.",
    "Native Javascript derives exploration coverage from the actual events, storyline updates, diplomacy, and ledgers you return.",
    "Your job is to decide what happened; runtime owns indexing, linkage, and audit bookkeeping.",
  ];
};

const parseWorldSweepAudit = (summary) => {
  const match = WORLD_SWEEP_AUDIT_RE.exec(String(summary ?? ""));
  if (!match) return null;

  const entries = new Map();

  for (const rawPart of String(match[1] || "").split(";")) {
    const part = rawPart.trim();
    if (!part) continue;

    const pos = part.indexOf("=");
    if (pos < 1) {
      return {
        error: `Malformed WORLD_SWEEP audit entry "${part}".`,
        entries,
      };
    }

    const id = Number.parseInt(part.slice(0, pos).trim(), 10);
    const verdict = normalizeString(part.slice(pos + 1));

    if (!Number.isInteger(id) || id < 1 || !verdict) {
      return {
        error: `Malformed WORLD_SWEEP audit entry "${part}".`,
        entries,
      };
    }

    if (entries.has(id)) {
      return {
        error: `Duplicate WORLD_SWEEP slot ${id}.`,
        entries,
      };
    }

    entries.set(id, verdict);
  }

  return { error: "", entries };
};

const decodeStorylineAuditRecords = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);

  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const text = normalizeString(line);
      if (!text) return null;

      const fields = text.split("~");

      return {
        id: normalizeString(fields[0]),
        title: normalizeString(fields[6]),
        participants: normalizeString(fields[7])
          .split(",")
          .map(normalizeString)
          .filter(Boolean),
        state: normalizeString(fields.slice(9).join("~")),
      };
    })
    .filter(Boolean);
};

const hasNativeLedgerRecords = (value) =>
  Array.isArray(value)
    ? value.length > 0
    : Boolean(normalizeString(value));

const eventExplorationText = (event) => [
  normalizeString(event?.id),
  normalizeString(event?.title),
  normalizeString(event?.description),
  normalizeArray(event?.combatants).join(" "),
  JSON.stringify(event?.impacts ?? {}),
].filter(Boolean).join(" ");

const storylineExplorationText = (entry) => [
  normalizeString(entry?.id),
  normalizeString(entry?.title),
  normalizeString(entry?.state),
  normalizeArray(entry?.participants).join(" "),
].filter(Boolean).join(" ");

export const deriveWorldExplorationAudit = (
  candidate,
  analysis = null,
  {
    world = {},
    gameCountry = "",
  } = {},
) => {
  const slate = normalizeArray(analysis?.explorationSlate);
  const events = normalizeArray(candidate?.events);
  const storylineUpdates = decodeStorylineAuditRecords(candidate?.storylineUpdates);
  const outreach = normalizeArray(candidate?.diplomaticOutreach);
  const ledgerValues = [
    candidate?.warUpdates,
    candidate?.relationUpdates,
    candidate?.agreementUpdates,
  ];
  const ledgerText = JSON.stringify(ledgerValues);
  const outreachText = JSON.stringify(outreach);

  const entries = new Map();
  const claimedEventIndexes = new Set();
  const claimedStorylineIds = new Set();

  const claimEventForActor = (actor) => {
    for (let index = 0; index < events.length; index += 1) {
      if (
        actorMentionedInText(
          actor,
          eventExplorationText(events[index]),
          world,
          gameCountry,
        )
      ) {
        claimedEventIndexes.add(index);
        return `event${index + 1}`;
      }
    }
    return "";
  };

  const claimStorylineForActor = (actor) => {
    for (const update of storylineUpdates) {
      if (
        actorMentionedInText(
          actor,
          storylineExplorationText(update),
          world,
          gameCountry,
        )
      ) {
        const id = normalizeString(update?.id);
        if (id) claimedStorylineIds.add(id.toLowerCase());
        return id ? `storyline:${id}` : "";
      }
    }
    return "";
  };

  // Actor-domain slots are derived from actual returned material. The model no
  // longer has to maintain a parallel magic-string audit in summary.
  for (const slot of slate.filter((entry) => entry?.type === "actor-domain")) {
    const id = Number(slot?.id);
    if (!Number.isInteger(id)) continue;

    const actor = normalizeString(slot?.actor);
    let verdict = actor ? claimEventForActor(actor) : "";

    if (!verdict && actor) verdict = claimStorylineForActor(actor);

    if (
      !verdict &&
      actor &&
      outreach.length > 0 &&
      actorMentionedInText(actor, outreachText, world, gameCountry)
    ) {
      verdict = "outreach";
    }

    if (
      !verdict &&
      actor &&
      ledgerValues.some(hasNativeLedgerRecords) &&
      actorMentionedInText(actor, ledgerText, world, gameCountry)
    ) {
      verdict = "ledger";
    }

    entries.set(id, verdict || "quiet");
  }

  // Global slots are intentionally conservative. They only count as covered when
  // the returned payload itself contains cross-border or otherwise-unclaimed world
  // material; they are never "satisfied" by a model-authored audit claim.
  for (const slot of slate.filter((entry) => entry?.type !== "actor-domain")) {
    const id = Number(slot?.id);
    if (!Number.isInteger(id)) continue;

    const domain = normalizeString(slot?.domain).toLowerCase();
    let verdict = "";

    if (slot?.type === "crisis-discovery") {
      const existingIds = new Set(
        normalizeArray(world?.storylines)
          .map((entry) => normalizeString(entry?.id).toLowerCase())
          .filter(Boolean),
      );
      const discovered = storylineUpdates.find((entry) => {
        const idValue = normalizeString(entry?.id).toLowerCase();
        const kind = normalizeString(entry?.kind);
        const status = normalizeString(entry?.status).toLowerCase();
        return (
          idValue &&
          !existingIds.has(idValue) &&
          status !== "resolved" &&
          CRISIS_DISCOVERY_KIND_RE.test(kind) &&
          (Number(entry?.pressure) || 0) >= 40 &&
          deriveWorldTrajectoryValue(entry) >= 3 &&
          normalizeArray(entry?.eventIndexes).length > 0
        );
      });
      if (discovered) {
        const storylineId = normalizeString(discovered?.id);
        if (storylineId) claimedStorylineIds.add(storylineId.toLowerCase());
        verdict = storylineId ? `storyline:${storylineId}` : "new-crisis";
      }
    } else if (/diplom|mediat|align|trade|alliance|cross-border|third-party/.test(domain)) {
      if (outreach.length > 0) {
        verdict = "outreach";
      } else if (ledgerValues.some(hasNativeLedgerRecords)) {
        verdict = "ledger";
      } else {
        for (let index = 0; index < events.length; index += 1) {
          const text = eventExplorationText(events[index]);
          const actorCount = mentionedPolities(text, world, gameCountry).length;
          const createdChats = normalizeArray(events[index]?.impacts?.createdChats).length;
          if (actorCount >= 2 || createdChats > 0) {
            claimedEventIndexes.add(index);
            verdict = `event${index + 1}`;
            break;
          }
        }
      }
    } else {
      const unclaimedEventIndex = events.findIndex(
        (_event, index) => !claimedEventIndexes.has(index),
      );
      if (unclaimedEventIndex >= 0) {
        claimedEventIndexes.add(unclaimedEventIndex);
        verdict = `event${unclaimedEventIndex + 1}`;
      } else {
        const unclaimedStoryline = storylineUpdates.find((entry) => {
          const idValue = normalizeString(entry?.id).toLowerCase();
          return idValue && !claimedStorylineIds.has(idValue);
        });
        if (unclaimedStoryline) {
          const storylineId = normalizeString(unclaimedStoryline?.id);
          claimedStorylineIds.add(storylineId.toLowerCase());
          verdict = `storyline:${storylineId}`;
        }
      }
    }

    entries.set(id, verdict || "quiet");
  }

  // Defensive completion for malformed/internal slates: every real slot gets a
  // deterministic verdict even if its type was missing.
  for (const slot of slate) {
    const id = Number(slot?.id);
    if (Number.isInteger(id) && !entries.has(id)) entries.set(id, "quiet");
  }

  const quietSlotIds = [...entries.entries()]
    .filter(([, verdict]) => verdict === "quiet")
    .map(([id]) => id);
  const nonQuietCount = [...entries.values()]
    .filter((verdict) => verdict !== "quiet")
    .length;

  return {
    entries,
    quietSlotIds,
    nonQuietCount,
    slotCount: slate.length,
  };
};

export const validateWorldExplorationAudit = (
  candidate,
  analysis = null,
  {
    finalAttempt = false,
    world = {},
    gameCountry = "",
  } = {},
) => {
  const slate = normalizeArray(analysis?.explorationSlate);
  if (!slate.length) return "";

  // 0.8.6: exploration bookkeeping is now entirely native. The model still has
  // to evaluate the slate because the Director prompt tells it to, but it no
  // longer has to mirror that reasoning into a fragile WORLD_SWEEP magic string.
  // Coverage is derived from the actual returned events/storylines/diplomacy.
  const audit = deriveWorldExplorationAudit(candidate, analysis, {
    world,
    gameCountry,
  });

  // Long silence still gets one deliberate second look, but the retry is now
  // triggered from ACTUAL lack of material output rather than a model-authored
  // audit string. On the final attempt a genuinely quiet world is legal.
  const silenceDays = Number(analysis?.visibleSilenceDays);

  if (
    !finalAttempt &&
    Number.isFinite(silenceDays) &&
    silenceDays >= 60 &&
    slate.length >= 4 &&
    audit.nonQuietCount === 0
  ) {
    return `The campaign has had no canonical visible milestone for ${silenceDays} days and native inspection found no material result across ${slate.length} exploration slot(s). Re-evaluate the slate once more from current interests/capabilities and surviving latent causes. This is NOT an event quota: if the second pass is still genuinely quiet, keep it quiet.`;
  }

  return "";
};

export const stripWorldSweepAudit = (summary) =>
  normalizeString(
    String(summary ?? "").replace(WORLD_SWEEP_AUDIT_RE, " ")
  );


const stablePolityIdentityToken = (token, world) => {
  const raw = normalizeString(token);
  if (!raw) return "";

  const target = raw.toLowerCase();
  for (const [key, entry] of Object.entries(world?.polityOverrides || {})) {
    const stable = normalizeString(entry?.code || key || entry?.name);
    const aliases = uniqueStrings([
      key,
      entry?.code,
      entry?.name,
      ...(normalizeArray(entry?.aliases)),
    ]);

    if (aliases.some((alias) => alias.toLowerCase() === target)) {
      return stable || raw;
    }
  }

  return raw;
};

const deepMergePlain = (left, right) => {
  if (
    !left || typeof left !== "object" || Array.isArray(left) ||
    !right || typeof right !== "object" || Array.isArray(right)
  ) {
    return right == null ? left : right;
  }

  const out = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      out[key] && typeof out[key] === "object" && !Array.isArray(out[key])
    ) {
      out[key] = deepMergePlain(out[key], value);
    } else if (value != null) {
      out[key] = value;
    }
  }
  return out;
};

const mergePolityUpdateRecords = (base, incoming) => {
  const merged = {
    ...base,
    ...incoming,
    // Keep the first emitted code/name spelling for presentation. The stable
    // lineage key is used only for duplicate detection; runtime identity
    // resolution still canonicalizes the mutation itself.
    code: normalizeString(base?.code) || normalizeString(incoming?.code),
    name: normalizeString(base?.name) || normalizeString(incoming?.name),
    aliases: uniqueStrings([
      ...normalizeArray(base?.aliases),
      ...normalizeArray(incoming?.aliases),
    ]),
    stats: deepMergePlain(base?.stats || {}, incoming?.stats || {}),
  };

  if (incoming?.tags == null && base?.tags != null) merged.tags = base.tags;
  if (incoming?.reputation == null && base?.reputation != null) {
    merged.reputation = base.reputation;
  }
  if (!normalizeString(incoming?.color) && normalizeString(base?.color)) {
    merged.color = base.color;
  }
  if (!normalizeString(incoming?.note) && normalizeString(base?.note)) {
    merged.note = base.note;
  }

  return merged;
};

const sanitizeDuplicatePolityUpdates = (event, world) => {
  if (!event || typeof event !== "object") {
    return { event, merged: 0 };
  }

  const impacts =
    event?.impacts && typeof event.impacts === "object"
      ? event.impacts
      : {};
  const changes = normalizeArray(impacts?.polityChanges);
  if (changes.length < 2) return { event, merged: 0 };

  const kept = [];
  const updateIndexByStable = new Map();
  let mergedCount = 0;

  for (const change of changes) {
    const operation = normalizeString(change?.operation).toLowerCase();
    if (operation !== "update") {
      kept.push(change);
      continue;
    }

    const stable = stablePolityIdentityToken(
      change?.code || change?.name,
      world,
    ).toLowerCase();

    if (!stable || !updateIndexByStable.has(stable)) {
      const index = kept.length;
      kept.push(change);
      if (stable) updateIndexByStable.set(stable, index);
      continue;
    }

    const index = updateIndexByStable.get(stable);
    kept[index] = mergePolityUpdateRecords(kept[index], change);
    mergedCount += 1;
  }

  if (!mergedCount) return { event, merged: 0 };

  return {
    event: {
      ...event,
      impacts: {
        ...impacts,
        polityChanges: kept,
      },
    },
    merged: mergedCount,
  };
};

const sanitizeNoOpRegionControlOps = (event, world) => {
  if (!event || typeof event !== "object") {
    return { event, removed: 0 };
  }

  const impacts =
    event?.impacts && typeof event.impacts === "object"
      ? event.impacts
      : {};
  const ops = normalizeArray(impacts?.regionControlOps);
  if (!ops.length) return { event, removed: 0 };

  const kept = [];
  const seenContestKeys = new Set();
  let removed = 0;

  for (const op of ops) {
    const kind = normalizeString(op?.op).toLowerCase();
    const regionId = normalizeString(op?.regionId);
    const claimants = normalizeArray(world?.regionClaimants?.[regionId])
      .map((claimant) =>
        stablePolityIdentityToken(
          typeof claimant === "string"
            ? claimant
            : claimant?.code || claimant?.name || claimant?.claimantCode,
          world,
        ).toLowerCase()
      )
      .filter(Boolean);

    if (kind === "contest") {
      const actor = stablePolityIdentityToken(op?.actorCode, world).toLowerCase();
      const signature = `${regionId.toLowerCase()}|${actor}`;

      if (
        !regionId ||
        !actor ||
        claimants.includes(actor) ||
        seenContestKeys.has(signature)
      ) {
        removed += 1;
        continue;
      }

      seenContestKeys.add(signature);
      kept.push(op);
      continue;
    }

    if (kind === "clear_contest") {
      const clearAll = op?.clearAll === true;
      const claimant = stablePolityIdentityToken(
        op?.claimantCode,
        world,
      ).toLowerCase();

      if (
        !regionId ||
        (clearAll && claimants.length === 0) ||
        (!clearAll && (!claimant || !claimants.includes(claimant)))
      ) {
        removed += 1;
        continue;
      }
    }

    kept.push(op);
  }

  if (!removed) return { event, removed: 0 };

  return {
    event: {
      ...event,
      impacts: {
        ...impacts,
        regionControlOps: kept,
      },
    },
    removed,
  };
};

const sanitizeProcessOnlyPolityUpdates = (event) => {
  if (!event || typeof event !== "object") {
    return { event, removed: 0 };
  }

  const text =
    `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;

  if (
    !PROCESS_ONLY_POLITY_UPDATE_RE.test(text) ||
    CONCRETE_POLITY_OUTCOME_RE.test(text)
  ) {
    return { event, removed: 0 };
  }

  const impacts =
    event?.impacts && typeof event.impacts === "object"
      ? event.impacts
      : {};

  const changes = normalizeArray(impacts?.polityChanges);
  if (!changes.length) return { event, removed: 0 };

  const kept = changes.filter((change) =>
    normalizeString(change?.operation).toLowerCase() !== "update"
  );

  const removed = changes.length - kept.length;
  if (!removed) return { event, removed: 0 };

  return {
    event: {
      ...event,
      impacts: {
        ...impacts,
        polityChanges: kept,
      },
    },
    removed,
  };
};

const falseNonBelligerentWartimeReason = (
  event,
  world,
  gameCountry = "",
) => {
  const text =
    `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;

  if (!WAR_DEPENDENT_HOMEFRONT_RE.test(text)) return "";
  if (PREPAREDNESS_RE.test(text) || FOREIGN_SPILLOVER_RE.test(text)) return "";

  const actors = mentionedPolities(text, world, gameCountry);

  if (!actors.length && event?.playerRelated && normalizeString(gameCountry)) {
    actors.push(normalizeString(gameCountry));
  }

  if (!actors.length) return "";
  if (actors.some((actor) => actorIsActiveBelligerent(actor, world))) return "";

  return `war-dependent domestic/economic condition asserted for non-belligerent actor(s): ${actors.join(", ")}`;
};

const routineMilitaryNoDeltaReason = (event) => {
  const text =
    `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;

  if (!ROUTINE_MILITARY_CUE_RE.test(text)) return "";
  if (STRONG_MILITARY_CONSEQUENCE_RE.test(text)) return "";
  // An event explicitly bound to a queued player Action is the order's
  // canonical answer. Hiding it here would make settleOrders carry the
  // same order over as overdue even though the simulator cited it exactly.
  if (normalizeArray(event?.impacts?.actionIds).length) return "";
  if (hardImpactKeysForEvent(event).length) return "";

  return "routine military continuation with no native material consequence";
};


const routineAdministrativeNoDeltaReason = (event) => {
  const text =
    `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;

  if (!ROUTINE_ADMINISTRATIVE_CUE_RE.test(text)) return "";
  if (ADMINISTRATIVE_MATERIAL_OUTCOME_RE.test(text)) return "";
  if (hardImpactKeysForEvent(event).length) return "";
  if (normalizeArray(event?.storylineIds).length) return "";
  if (normalizeString(event?.warId)) return "";
  if (event?.playerRelated === true) return "";
  if (normalizeArray(event?.impacts?.actionIds).length) return "";

  return "routine administrative/process card with no material native consequence";
};



const AUTHORITY_BINDING_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "onto", "over", "under",
  "its", "their", "your", "our", "his", "her", "they", "them", "you", "are", "was", "were",
  "will", "would", "shall", "should", "can", "could", "have", "has", "had", "been", "being",
  "new", "current", "existing", "event", "events", "government", "state", "polity", "country",
]);

const authorityTokenStem = (value) => {
  const token = normalizeString(value).toLocaleLowerCase();
  if (!token) return "";
  return token.length >= 7 ? token.slice(0, 7) : token;
};

const authorityTokens = (value, excluded = new Set()) => {
  const text = normalizeString(value).toLocaleLowerCase();
  if (!text) return new Set();
  const matches = text.match(/[\p{L}\p{N}]+/gu) || [];
  const result = new Set();
  for (const raw of matches) {
    if (raw.length < 3 || AUTHORITY_BINDING_STOP_WORDS.has(raw)) continue;
    const token = authorityTokenStem(raw);
    if (!token || excluded.has(token)) continue;
    result.add(token);
  }
  return result;
};

const authoritySemanticScore = (left, right, { excluded = new Set() } = {}) => {
  const aText = normalizeString(left).toLocaleLowerCase();
  const bText = normalizeString(right).toLocaleLowerCase();
  if (!aText || !bText) return 0;

  const a = authorityTokens(aText, excluded);
  const b = authorityTokens(bText, excluded);
  if (!a.size || !b.size) return 0;

  let shared = 0;
  let distinctive = 0;
  for (const token of a) {
    if (!b.has(token)) continue;
    shared += 1;
    if (token.length >= 5) distinctive += 1;
  }
  if (!shared) return 0;

  const eventCoverage = shared / a.size;
  const sourceCoverage = shared / b.size;
  const dice = (2 * shared) / (a.size + b.size);
  let score = Math.max(dice, (0.72 * eventCoverage) + (0.28 * sourceCoverage));

  // Exact normalized phrase containment is strong evidence, but never let a
  // single generic word become authority by itself.
  if (Math.min(aText.length, bText.length) >= 14 && (aText.includes(bText) || bText.includes(aText))) {
    score = Math.max(score, 0.92);
  }
  if (distinctive < 2 && score < 0.9) score = Math.min(score, 0.24);
  return Number(score.toFixed(4));
};

const eventAuthoritySemanticText = (event) => [
  normalizeString(event?.title),
  normalizeString(event?.description),
].filter(Boolean).join(" ");

const eventAuthorityTitleText = (event) => normalizeString(event?.title);

const actionAuthoritySemanticText = (action) => [
  normalizeString(action?.title),
  normalizeString(action?.text),
  normalizeString(action?.rawInput),
].filter(Boolean).join(" ");

const messageAuthoritySemanticText = (message) => [
  normalizeString(message?.text || message?.content || message?.message),
].filter(Boolean).join(" ");

const currentActionRecords = (actions) => normalizeArray(actions)
  .filter((entry) => {
    const status = normalizeString(entry?.status).toLowerCase();
    return !status || status === "planned";
  })
  .map((entry) => ({
    id: normalizeString(entry?.id),
    source: entry,
    text: actionAuthoritySemanticText(entry),
  }))
  .filter((entry) => entry.id && entry.text);

const currentActionIds = (actions) => new Set(currentActionRecords(actions).map((entry) => entry.id));

const playerCommitmentRecords = (chats, resolver, playerCanonical) => {
  const records = [];
  for (const chat of normalizeArray(chats)) {
    for (const message of normalizeArray(chat?.messages)) {
      const id = normalizeString(message?.id);
      const text = messageAuthoritySemanticText(message);
      if (!id || !text) continue;
      const role = normalizeString(message?.role).toLowerCase();
      const claimedActor = normalizeString(message?.polityKey || message?.code || message?.speaker);

      // Speaker identity is stronger provenance than generic chat role labels.
      // Only fall back to role=user/player when the transport has no actor identity.
      const authoredByPlayer = claimedActor
        ? resolver.equivalent(claimedActor, playerCanonical)
        : role === "user" || role === "player";
      if (!authoredByPlayer) continue;
      records.push({ id, source: message, text });
    }
  }
  return records;
};

const playerCommitmentMessageIds = (chats, resolver, playerCanonical) => new Set(
  playerCommitmentRecords(chats, resolver, playerCanonical).map((entry) => entry.id),
);

const canonicalProcessIds = (world) => {
  const ids = new Set();
  const add = (value) => {
    const id = normalizeString(value);
    if (id) ids.add(id);
  };

  for (const storyline of normalizeArray(world?.storylines)) {
    const status = normalizeString(storyline?.status).toLowerCase();
    if (status && status === "resolved") continue;
    add(storyline?.id);
  }
  for (const project of normalizeArray(world?.projects)) {
    const status = normalizeString(project?.status).toLowerCase();
    if (["completed", "cancelled", "canceled", "failed", "removed"].includes(status)) continue;
    add(project?.id);
  }
  for (const war of normalizeArray(world?.wars)) {
    const status = normalizeString(war?.status).toLowerCase();
    if (!["active", "ceasefire"].includes(status)) continue;
    add(war?.id);
  }
  for (const order of normalizeArray(world?.pendingUnitOrders)) add(order?.id);
  for (const id of institutionResolutionAuthorityIds(world)) add(id);

  return ids;
};

const resolveUniqueSemanticAuthority = (event, records, {
  playerCanonical = "",
  threshold = 0.34,
  margin = 0.1,
} = {}) => {
  const excluded = authorityTokens(playerCanonical);
  const fullText = eventAuthoritySemanticText(event);
  const titleText = eventAuthorityTitleText(event);
  const scored = normalizeArray(records)
    .map((entry) => ({
      ...entry,
      score: Math.max(
        authoritySemanticScore(titleText, entry.text, { excluded }),
        authoritySemanticScore(fullText, entry.text, { excluded }),
      ),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const best = scored[0] || null;
  const second = scored[1] || null;
  if (!best || best.score < threshold) {
    return { match: null, scored, reason: "no-semantic-match" };
  }
  if (second && best.score - second.score < margin) {
    return { match: null, scored, reason: "ambiguous-semantic-match" };
  }
  return { match: best, scored, reason: "unique-semantic-match" };
};

const mirrorPrimaryAgencyRow = (agency) => {
  const rows = normalizeArray(agency?.sovereignActors);
  const primary = rows[0];
  if (!primary) return agency;
  return {
    ...agency,
    sovereignPolity: normalizeString(primary?.polity || primary?.sovereignPolity),
    authority: normalizeString(primary?.authority).toLowerCase(),
    authorityRef: normalizeString(primary?.authorityRef),
    sovereignActors: rows,
  };
};

const INSTITUTION_SUBPRINCIPAL_HINT_RE = /\b(?:council|committee|secretariat|commission|assembly|board|bureau|office|service|agency|command|directorate|mission|delegation|court|panel|ministers?|ministerial|summit|conference|working group)\b/i;

const normalizeInstitutionAuthorityPhrase = (value) => normalizeString(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const activeInstitutionEntries = (world = {}) => {
  const ledger = world?.institutions?.byId || world?.institutions || {};
  return Object.entries(ledger)
    .filter(([id, institution]) => id !== "schemaVersion" && id !== "ledgerVersion"
      && institution && typeof institution === "object" && !Array.isArray(institution)
      && normalizeString(institution.status || "active").toLowerCase() === "active")
    .map(([id, institution]) => ({ ...institution, id: institution.id || id }));
};

// A model may name a real organ/sub-body (for example "EU Foreign Affairs Council")
// while the canonical ledger owns the parent institution ("European Union"). Exact
// canonical identity remains preferred. A bounded fallback is allowed only when one
// active institution identity appears as a whole phrase inside an obvious institutional
// organ label. This is data-driven and deliberately fails closed on ambiguity.
const resolveInstitutionAuthorityPrincipal = (world = {}, principal = "") => {
  const principalPhrase = normalizeInstitutionAuthorityPhrase(principal);
  if (!principalPhrase) return null;

  const entries = activeInstitutionEntries(world);
  const identityRows = entries.map((institution) => ({
    institution,
    identities: [institution.id, institution.name, institution.shortName, ...normalizeArray(institution.aliases)]
      .map(normalizeInstitutionAuthorityPhrase)
      .filter(Boolean),
  }));

  // Exact identity is still strict: duplicate names/aliases are ambiguous and
  // therefore fail closed rather than inheriting resolveInstitutionRecord's
  // first-match convenience semantics.
  const exactMatches = identityRows.filter(({ identities }) => identities.includes(principalPhrase));
  if (exactMatches.length === 1) return exactMatches[0].institution;
  if (exactMatches.length > 1) return null;

  if (!INSTITUTION_SUBPRINCIPAL_HINT_RE.test(principalPhrase)) return null;

  const rootedMatches = identityRows.filter(({ identities }) => identities.some((identity) => (
    principalPhrase.startsWith(`${identity} `)
    || principalPhrase.endsWith(` ${identity}`)
    || principalPhrase.includes(` ${identity} `)
  )));
  return rootedMatches.length === 1 ? rootedMatches[0].institution : null;
};

const nativeCanonicalProcessCandidates = (event, world) => {
  const allowed = canonicalProcessIds(world);
  const candidates = new Set();
  const add = (value) => {
    const id = normalizeString(value);
    if (id && allowed.has(id)) candidates.add(id);
  };
  for (const id of normalizeArray(event?.storylineIds)) add(id);
  add(event?.warId);
  return candidates;
};

// Native authority binder: model output may classify WHOSE authority is being
// exercised, but opaque canonical ids are never trusted as model-authored facts.
// This binder resolves those ids against current save state using semantic event
// evidence and already-established native links. If a unique canonical source
// cannot be proved, it deliberately leaves the ref blank so the existing hard
// authority validator rejects the event. This is the single seam for player
// orders, player-authored diplomatic commitments, and canonical-process refs.
export const bindWorldEventAuthorityRefs = (candidate, {
  world = {},
  gameCountry = "",
  actions = [],
  chats = [],
} = {}) => {
  if (!candidate || typeof candidate !== "object") {
    return { applied: 0, unresolved: [], bindings: [] };
  }

  // Preserve the earlier native storyline binder as one source of deterministic
  // process provenance. Raw model update indexes remain excluded here.
  propagateCanonicalProcessAuthorityRefs(candidate, {
    world,
    includeStorylineUpdates: false,
  });

  const resolver = createWorldActorResolver(world, gameCountry);
  const playerCanonical = resolver.canonical(normalizeString(gameCountry));
  const actionRecords = currentActionRecords(actions);
  const commitmentRecords = playerCommitmentRecords(chats, resolver, playerCanonical);
  const bindings = [];
  const unresolved = [];
  let applied = 0;

  candidate.events = normalizeArray(candidate?.events).map((event, eventIndex) => {
    if (!event || typeof event !== "object") return event;

    let eventWithAgency = event;
    let rawAgency = event?.agency;
    const rawStructureReason = eventAgencyStructureReason(rawAgency);
    const rawNormalized = rawStructureReason ? null : normalizeEventAgency(rawAgency);

    // event.agency is a model hint, not canonical truth. Missing or malformed
    // provenance is reconstructed from semantic event evidence and current canon
    // whenever native code can do so unambiguously. A model claim that touches
    // player sovereignty is never overwritten here; it must pass the hard player
    // authority checks below.
    if (!rawNormalized || rawStructureReason) {
      const derived = deriveNativeEventAgency(event, {
        world,
        resolver,
        playerCanonical,
        actionRecords,
        commitmentRecords,
      });
      if (derived.agency) {
        rawAgency = derived.agency;
        eventWithAgency = { ...event, agency: rawAgency };
        applied += 1;
        bindings.push({
          eventIndex,
          rowIndex: -1,
          authority: "native-provenance",
          authorityRef: "",
          principal: normalizeString(rawAgency.principal),
          semanticScore: 1,
          source: derived.source,
          reason: derived.reason,
        });
      } else {
        unresolved.push({
          eventIndex,
          rowIndex: -1,
          authority: "native-provenance",
          reason: derived.reason || rawStructureReason || "missing-event-agency",
          candidateCount: 0,
          bestScore: 0,
          source: derived.source || "native-unresolved",
        });
        return eventWithAgency;
      }
    }

    let agency = { ...rawAgency };
    let rows = Array.isArray(rawAgency.sovereignActors)
      ? rawAgency.sovereignActors.map((row) => ({ ...row }))
      : [];

    const agencyAuthority = normalizeString(agency.authority).toLowerCase();
    if (normalizeString(agency.principalKind).toLowerCase() === "institution"
        && ["autonomous", "independent"].includes(agencyAuthority)) {
      const institution = resolveInstitutionAuthorityPrincipal(world, agency.principal);
      const canonicalPrincipal = normalizeString(institution?.name || institution?.shortName || institution?.id);
      if (canonicalPrincipal && canonicalPrincipal !== normalizeString(agency.principal)) {
        const originalPrincipal = normalizeString(agency.principal);
        agency.principal = canonicalPrincipal;
        applied += 1;
        bindings.push({
          eventIndex,
          rowIndex: -1,
          authority: "institution-principal",
          authorityRef: normalizeString(institution?.id),
          principal: originalPrincipal,
          canonicalPrincipal,
          semanticScore: 1,
        });
      }
    }

    // Backward-compatible normalization for a singular sovereign mirror.
    if (!rows.length && normalizeString(rawAgency.sovereignPolity) &&
        EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(normalizeString(rawAgency.authority).toLowerCase())) {
      rows = [{
        polity: normalizeString(rawAgency.sovereignPolity),
        authority: normalizeString(rawAgency.authority).toLowerCase(),
        authorityRef: normalizeString(rawAgency.authorityRef),
      }];
    }

    const boundActionIds = [];
    rows = rows.map((row, rowIndex) => {
      const next = { ...row };
      const polity = normalizeString(row?.polity || row?.sovereignPolity);
      const canonical = resolver.canonical(polity);
      const authority = normalizeString(row?.authority).toLowerCase();
      const isPlayer = Boolean(playerCanonical && canonical && resolver.equivalent(canonical, playerCanonical));

      // Opaque ids on autonomous AI sovereign rows are never meaningful.
      if (authority === "autonomous") {
        next.authorityRef = "";
        return next;
      }
      if (!isPlayer) return next;

      if (authority === "player-order") {
        const resolved = resolveUniqueSemanticAuthority(eventWithAgency, actionRecords, {
          playerCanonical,
          threshold: 0.34,
          margin: 0.1,
        });
        next.authorityRef = resolved.match?.id || "";
        if (resolved.match) {
          boundActionIds.push(resolved.match.id);
          applied += 1;
          bindings.push({
            eventIndex,
            rowIndex,
            authority,
            authorityRef: resolved.match.id,
            semanticScore: resolved.match.score,
          });
        } else {
          unresolved.push({
            eventIndex,
            rowIndex,
            authority,
            reason: resolved.reason,
            candidateCount: actionRecords.length,
            bestScore: resolved.scored[0]?.score || 0,
          });
        }
        return next;
      }

      if (authority === "player-commitment") {
        const resolved = resolveUniqueSemanticAuthority(eventWithAgency, commitmentRecords, {
          playerCanonical,
          threshold: 0.28,
          margin: 0.08,
        });
        next.authorityRef = resolved.match?.id || "";
        if (resolved.match) {
          applied += 1;
          bindings.push({
            eventIndex,
            rowIndex,
            authority,
            authorityRef: resolved.match.id,
            semanticScore: resolved.match.score,
          });
        } else {
          unresolved.push({
            eventIndex,
            rowIndex,
            authority,
            reason: resolved.reason,
            candidateCount: commitmentRecords.length,
            bestScore: resolved.scored[0]?.score || 0,
          });
        }
        return next;
      }

      return next;
    });

    if (rows.length) {
      agency = mirrorPrimaryAgencyRow({ ...agency, sovereignActors: rows });
    } else if (normalizeString(agency.authority).toLowerCase() === "canonical-process") {
      // canonical-process may not borrow sovereign discretion. Prefer hard native
      // event links (storyline/war). If none exists, a passed institutional
      // resolution may own a later delegated consequence only when the event's
      // institution principal resolves canonically and exactly one still-open
      // resolution matches the event semantics. Proposal ids remain native-owned.
      const candidates = nativeCanonicalProcessCandidates(eventWithAgency, world);
      let authorityRef = "";
      let semanticScore = 0;
      let reason = candidates.size > 1 ? "ambiguous-native-process-link" : "missing-native-process-link";
      let candidateCount = candidates.size;
      if (candidates.size === 1) {
        authorityRef = [...candidates][0];
        semanticScore = 1;
      } else if (candidates.size === 0 && normalizeString(agency.principalKind).toLowerCase() === "institution") {
        const institution = resolveInstitutionRecord(world, agency.principal);
        const records = institution
          ? listInstitutionResolutionAuthorities(world, { institutionId: institution.id })
          : [];
        const resolved = resolveUniqueSemanticAuthority(eventWithAgency, records, { threshold: 0.34, margin: 0.1 });
        authorityRef = resolved.match?.id || "";
        semanticScore = resolved.match?.score || 0;
        reason = resolved.reason;
        candidateCount = records.length;
      }
      if (authorityRef) {
        agency.authorityRef = authorityRef;
        applied += 1;
        bindings.push({ eventIndex, rowIndex: -1, authority: "canonical-process", authorityRef, semanticScore });
      } else {
        agency.authorityRef = "";
        unresolved.push({
          eventIndex,
          rowIndex: -1,
          authority: "canonical-process",
          reason,
          candidateCount,
          bestScore: semanticScore,
        });
      }
    }

    // Beta deliberately exposes queued action ids to the time-skip model so an
    // event can say which CURRENT player action it resolves. Treat those ids as
    // untrusted references, not as native-only fields: preserve only exact ids
    // that still exist in the current planned-action set, and union them with an
    // id proven by a native player-order authority binding. Merely naming a valid
    // action id never grants sovereign authority; the agency binder above still
    // has to prove the event semantically matches the player's order.
    const knownActionIds = currentActionIds(actions);
    const claimedActionIds = normalizeArray(eventWithAgency?.impacts?.actionIds)
      .map(normalizeString)
      .filter((id) => id && knownActionIds.has(id));
    const boundActionIdList = [...new Set([...claimedActionIds, ...boundActionIds])];
    const existingImpacts = eventWithAgency?.impacts && typeof eventWithAgency.impacts === "object" && !Array.isArray(eventWithAgency.impacts)
      ? eventWithAgency.impacts
      : null;
    const impacts = existingImpacts
      ? { ...existingImpacts, actionIds: boundActionIdList }
      : boundActionIdList.length
        ? { actionIds: boundActionIdList }
        : eventWithAgency?.impacts;

    return {
      ...eventWithAgency,
      agency,
      ...(impacts ? { impacts } : {}),
    };
  });

  return { applied, unresolved, bindings };
};


const FRESH_SOVEREIGN_POLICY_RE = new RegExp([
  "\\bdeclare(?:s|d)?\\s+war\\b",
  "\\b(?:general\\s+|national\\s+|full\\s+)?mobiliz(?:e|es|ed|ation)\\b",
  "\\b(?:signs?|ratif(?:y|ies|ied)|accedes?|withdraws?)\\b[\\s\\S]{0,80}\\b(?:treaty|alliance|pact|agreement|convention)\\b",
  "\\b(?:imposes?|adopts?|expands?|lifts?)\\s+(?:new\\s+)?(?:economic\\s+|targeted\\s+)?sanctions?\\b",
  "\\bexpels?\\b[\\s\\S]{0,60}\\bdiplomat\\b",
  "\\brecalls?\\b[\\s\\S]{0,60}\\bambassador\\b",
  "\\b(?:recognizes?|derecognizes?)\\b[\\s\\S]{0,80}\\b(?:state|government|independence|sovereignty)\\b",
  "\\b(?:annex(?:es|ed|ation)?|cedes?|transfers?)\\b[\\s\\S]{0,80}\\b(?:territor|province|region|sovereignty|border)\\b",
  "\\b(?:joins?|leaves?|withdraws?\\s+from)\\b[\\s\\S]{0,80}\\b(?:alliance|treaty\\s+organization|union|bloc)\\b",
  "\\b(?:passes?|enacts?|adopts?|approves?)\\s+(?:an?\\s+|the\\s+)?(?:law|bill|national\\s+budget|supplementary\\s+budget|constitutional\\s+amendment)\\b",
  "\\b(?:national|countrywide|armed\\s+forces)\\s+(?:alert|readiness|posture|state\\s+of\\s+emergency)\\b",
  "\\b(?:deploys?|orders?)\\b[\\s\\S]{0,80}\\b(?:troops|brigade|division|battalion|warships?|fighter\\s+aircraft|missile\\s+units?)\\b",
].join("|"), "i");

const GOVERNMENT_POLICY_DECISION_RE = /\b(?:government|cabinet|parliament|legislature|president|prime\s+minister|foreign\s+ministry|ministry\s+of\s+foreign\s+affairs|defen[cs]e\s+ministry|ministry\s+of\s+defen[cs]e)\b[\s\S]{0,100}\b(?:approves?|adopts?|passes?|authorizes?|orders?|declares?|signs?|ratifies?|recognizes?|imposes?|withdraws?|expels?|recalls?|allocates?)\b/i;

// A subordinate body may execute standing cross-border procedures, but it may
// not use delegated-routine to CREATE a new international/security commitment.
// This catches the semantic boundary rather than trusting mandateBasis prose.
const NEW_CROSS_BORDER_COMMITMENT_RE = /\b(?:establish(?:es|ed|ing)?|creat(?:e|es|ed|ing)|form(?:s|ed|ing)?|found(?:s|ed|ing)?|launch(?:es|ed|ing)?|signs?|concludes?|agrees?\s+to)\b[\s\S]{0,120}\b(?:new\s+)?(?:bilateral|trilateral|multilateral|cross-border|international|intergovernmental|joint)\b[\s\S]{0,120}\b(?:agreement|protocol|memorandum|framework|mechanism|initiative|partnership|alliance|organization|organisation|institution|union|council|bloc|commission|secretariat|command|task\s+force|coordination\s+arrangement|security\s+arrangement)\b/i;


const EVENT_SUBJECT_VERB_RE = /\b(?:signs?|ratif(?:y|ies|ied)|launch(?:es|ed)?|review(?:s|ed)?|detect(?:s|ed)?|complete(?:s|d)?|conduct(?:s|ed)?|introduc(?:e|es|ed)|uncover(?:s|ed)?|report(?:s|ed)?|reject(?:s|ed)?|approv(?:e|es|ed)|adopt(?:s|ed)?|implement(?:s|ed)?|expand(?:s|ed)?|impos(?:e|es|ed)|deploy(?:s|ed)?|arrest(?:s|ed)?|detain(?:s|ed)?|warn(?:s|ed)?|begin(?:s)?|start(?:s|ed)?|open(?:s|ed)?|clos(?:e|es|ed)|rais(?:e|es|ed)|lower(?:s|ed)?|increas(?:e|es|ed)|reduc(?:e|es|ed)|conven(?:e|es|ed)|meet(?:s)?|vote(?:s|d)?|rule(?:s|d)?|order(?:s|ed)?|announce(?:s|d)?|condemn(?:s|ed)?|press(?:es|ed)?|intensif(?:y|ies|ied)|retake(?:s|n)?|advance(?:s|d)?|hold(?:s)?|elect(?:s|ed)?|form(?:s|ed)?|resign(?:s|ed)?|dismiss(?:es|ed)?|suspend(?:s|ed)?|resume(?:s|d)?|withdraw(?:s|n)?|enter(?:s|ed)?|leave(?:s|left)?|join(?:s|ed)?)\b/i;

const DELEGATED_DOMESTIC_ACTOR_RE = /\b(?:border guard|coast guard|security service|intelligence service|police|constabulary|customs|fire service|emergency service|civil protection|regulator|central bank|national bank|armed forces|military command|national guard|ministry|ministerial department|public health agency|transport authority|port authority|railway authority|municipal(?:ity)?|local authorities?|national security council|cyber(?:security)? (?:centre|center|agency|service)|cert\.[a-z]{2})\b/i;
const ENDOGENOUS_DOMESTIC_PROCESS_RE = /\b(?:opposition|protest(?:s|ers)?|strike(?:s|rs)?|scandal|court|judge|judiciary|prosecutor|journalist|media|corruption allegation|coalition dispute|party revolt|riot|demonstration|leak|bureaucratic failure|industrial accident|transport accident|power outage|public controversy|constitutional challenge|confidence challenge)\b/i;
const EXOGENOUS_EVENT_RE = /\b(?:earthquake|storm|hurricane|cyclone|flood|wildfire|drought|epidemic|pandemic|volcanic|tsunami|landslide|meteor|natural disaster)\b/i;

// Bounded multi-polity interactions are not automatically fresh sovereign acts.
// Intelligence-service consultations, technical working groups, liaison meetings
// and similar activity can occur under existing mandates without every member
// government making a new policy choice.  This is deliberately narrower than
// generic diplomacy language: declarations, treaties, sanctions, deployments
// and new frameworks are caught by eventCrossesFreshSovereignPolicyBoundary.
const ROUTINE_COLLECTIVE_PROCESS_RE = /\b(?:meeting|consultations?|coordination|liaison|working\s+group|workshop|conference|technical\s+talks?|staff\s+talks?|expert\s+talks?|information[-\s]sharing|intelligence[-\s]sharing|threat[-\s]sharing|joint\s+review)\b/i;

// Fresh *shared* sovereign choices can be reconstructed from semantic actors
// without asking the model to author legal provenance. Keep this deliberately
// narrower than the general sovereign-policy detector: sanctions, expulsions,
// deployments and recognition can mention a target polity but are normally
// unilateral. Treaties and creation of intergovernmental arrangements are the
// main cases where all explicitly listed semantic actors are co-participants.
const JOINT_SOVEREIGN_COMMITMENT_RE = /\b(?:sign(?:s|ed|ing)?|ratif(?:y|ies|ied|ication)|conclud(?:e|es|ed|ing)|agree(?:s|d|ing)?\s+to|adopt(?:s|ed|ing)?\s+(?:a\s+)?joint|issue(?:s|d|ing)?\s+(?:a\s+)?joint|establish(?:es|ed|ing)?|creat(?:e|es|ed|ing)|form(?:s|ed|ing)?|found(?:s|ed|ing)?)\b[\s\S]{0,140}\b(?:treaty|agreement|pact|convention|memorandum|joint\s+declaration|alliance|intergovernmental|organization|organisation|institution|union|council|bloc|commission|secretariat|framework|mechanism|task\s+force|command)\b/i;

const nativePolicySemantic = (event) => `${normalizeString(event?.title)} ${normalizeString(event?.description)}`
  .replace(/\bwithout\s+(?:changing|altering|raising|lowering)\s+(?:the\s+)?(?:national\s+|countrywide\s+)?(?:alert|readiness|posture)\b/gi, "")
  .replace(/\bdoes\s+not\s+(?:change|alter|raise|lower)\s+(?:the\s+)?(?:national\s+|countrywide\s+)?(?:alert|readiness|posture)\b/gi, "");

export const eventCrossesFreshSovereignPolicyBoundary = (event) => {
  const semantic = nativePolicySemantic(event);
  return FRESH_SOVEREIGN_POLICY_RE.test(semantic)
    || GOVERNMENT_POLICY_DECISION_RE.test(semantic)
    || NEW_CROSS_BORDER_COMMITMENT_RE.test(semantic);
};

const nativeSubjectLabel = (event) => {
  const title = normalizeString(event?.title);
  if (!title) return "";
  const match = EVENT_SUBJECT_VERB_RE.exec(title);
  if (!match || match.index < 2) return title.slice(0, 96);
  return normalizeString(title.slice(0, match.index)).replace(/^the\s+/i, "").slice(0, 96);
};

const identityPhraseMatches = (textValue, identityValue) => {
  const text = normalizeInstitutionAuthorityPhrase(textValue);
  const identity = normalizeInstitutionAuthorityPhrase(identityValue);
  if (!text || !identity) return false;
  return text === identity || text.startsWith(`${identity} `) || text.includes(` ${identity} `) || text.endsWith(` ${identity}`);
};

const actorFamilyMentioned = (textValue, aliases = []) => {
  const text = normalizeString(textValue).toLowerCase();
  if (!text) return false;
  for (const alias of uniqueStrings(aliases)) {
    const phrase = normalizeString(alias).toLowerCase();
    if (!phrase) continue;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (phrase.length >= 3 && new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text)) return true;
    const tokens = phrase.replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((token) => token.length >= 6);
    if (tokens.some((token) => text.includes(token.slice(0, 5)))) return true;
  }
  return false;
};

const semanticActorTokens = (event) => uniqueStrings(normalizeArray(event?.actors).map(normalizeString).filter(Boolean));

const semanticActorPolities = (event, resolver) => uniqueStrings(
  semanticActorTokens(event).map((actor) => resolver.knownCanonical(actor)).filter(Boolean),
);

const semanticActorInstitutions = (event, world) => {
  const byId = new Map();
  for (const actor of semanticActorTokens(event)) {
    const institution = resolveInstitutionRecord(world, actor);
    const id = normalizeString(institution?.id);
    if (id && !byId.has(id)) byId.set(id, institution);
  }
  return [...byId.values()];
};

const eventMentionedPolities = (event, resolver) => {
  // When generation supplies an explicit semantic actor set, treat it as the
  // stronger statement of WHO acts. This prevents a target polity mentioned in
  // prose from being mistaken for a co-signatory or decision owner. Older/event
  // payloads without actors keep the text-based fallback.
  const explicitActors = semanticActorTokens(event);
  const actorPolities = semanticActorPolities(event, resolver);
  if (explicitActors.length && actorPolities.length) return actorPolities;
  return uniqueStrings(
    resolver.mentionedPolities(`${normalizeString(event?.title)} ${normalizeString(event?.description)}`),
  );
};

const subjectPolityFromEvent = (event, resolver) => {
  const actorPolities = semanticActorPolities(event, resolver);
  if (actorPolities.length === 1) return actorPolities[0];

  const combatants = uniqueStrings(normalizeArray(event?.combatants).map((actor) => resolver.knownCanonical(actor)).filter(Boolean));
  if (combatants.length === 1) return combatants[0];

  const title = normalizeString(event?.title);
  const titleMatches = [];
  for (const record of resolver.records) {
    if (uniqueStrings([record.canonical, ...normalizeArray(record.aliases)]).some((alias) => {
      const escaped = normalizeString(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return escaped && new RegExp(`^\\s*(?:the\\s+)?${escaped}(?:\\b|\\s)`, "i").test(title);
    })) titleMatches.push(record.canonical);
  }
  const uniqueTitleMatches = uniqueStrings(titleMatches);
  if (uniqueTitleMatches.length === 1) return uniqueTitleMatches[0];

  const mentionedTitle = resolver.mentionedPolities(title);
  if (mentionedTitle.length === 1) return mentionedTitle[0];
  const mentionedAll = resolver.mentionedPolities(`${title} ${normalizeString(event?.description)}`);
  if (mentionedAll.length === 1) return mentionedAll[0];
  return "";
};

const subjectInstitutionFromEvent = (event, world) => {
  const actorInstitutions = semanticActorInstitutions(event, world);
  if (actorInstitutions.length === 1) return actorInstitutions[0];
  if (actorInstitutions.length > 1) return null;

  const title = normalizeString(event?.title);
  const full = `${title} ${normalizeString(event?.description)}`;
  const entries = activeInstitutionEntries(world);
  const rows = entries.map((institution) => ({
    institution,
    identities: uniqueStrings([institution.id, institution.name, institution.shortName, ...normalizeArray(institution.aliases)]),
  }));
  const starting = rows.filter(({ identities }) => identities.some((identity) => {
    const normalizedTitle = normalizeInstitutionAuthorityPhrase(title);
    const normalizedIdentity = normalizeInstitutionAuthorityPhrase(identity);
    return normalizedIdentity && (normalizedTitle === normalizedIdentity || normalizedTitle.startsWith(`${normalizedIdentity} `));
  }));
  if (starting.length === 1) return starting[0].institution;
  if (starting.length > 1) return null;
  const mentioned = rows.filter(({ identities }) => identities.some((identity) => identityPhraseMatches(full, identity)));
  return mentioned.length === 1 ? mentioned[0].institution : null;
};

const rawAgencyClaimsPlayerSovereignty = (rawAgency, resolver, playerCanonical) => {
  if (!rawAgency || typeof rawAgency !== "object" || Array.isArray(rawAgency) || !playerCanonical) return false;
  const tokens = [
    rawAgency.sovereignPolity,
    ...normalizeArray(rawAgency.sovereignActors).map((row) => row?.polity || row?.sovereignPolity),
  ].map(normalizeString).filter(Boolean);
  if (tokens.some((token) => resolver.equivalent(token, playerCanonical))) return true;
  const principalKind = normalizeString(rawAgency.principalKind).toLowerCase();
  return principalKind === "polity" && resolver.equivalent(rawAgency.principal, playerCanonical);
};

const nativeDomesticAgency = (event, playerCanonical, authority) => ({
  principal: nativeSubjectLabel(event) || `${playerCanonical} domestic process`,
  principalKind: authority === "delegated-routine" ? "domestic-actor" : "domestic-process",
  sovereignPolity: "",
  authority,
  authorityRef: "",
  sovereignActors: [],
  jurisdictionPolity: playerCanonical,
  ...(authority === "delegated-routine" ? {
    mandateBasis: "native provenance resolution: bounded execution inside an existing domestic operational/legal mandate; no fresh sovereign-policy signal detected",
  } : {}),
});

const deriveNativeEventAgency = (event, {
  world = {},
  resolver,
  playerCanonical = "",
  actionRecords = [],
  commitmentRecords = [],
} = {}) => {
  if (!event || typeof event !== "object") return { agency: null, reason: "not-an-event", source: "none" };
  const rawAgency = event?.agency;
  if (rawAgencyClaimsPlayerSovereignty(rawAgency, resolver, playerCanonical)) {
    return { agency: null, reason: "model-agency-claims-player-sovereignty", source: "model" };
  }

  const fullText = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  const explicitActorTokens = semanticActorTokens(event);
  const actorPolities = semanticActorPolities(event, resolver);
  const hasExplicitPolityActors = Boolean(explicitActorTokens.length && actorPolities.length);
  const playerIsSemanticActor = Boolean(
    playerCanonical && actorPolities.some((polity) => resolver.equivalent(polity, playerCanonical)),
  );
  // An explicit semantic actor list is stronger evidence than prose mentions.
  // This prevents a TARGET polity in "France sanctions Latvia" from being
  // treated as a Latvian sovereign choice merely because Latvia appears in the
  // description. Legacy events without semantic actors keep the text fallback.
  const playerMentioned = hasExplicitPolityActors
    ? playerIsSemanticActor
    : Boolean(playerCanonical && actorFamilyMentioned(fullText, resolver.aliasesFor(playerCanonical)));
  const crossesSovereign = eventCrossesFreshSovereignPolicyBoundary(event);
  const jointSovereignChoice = Boolean(
    crossesSovereign
    && actorPolities.length >= 2
    && JOINT_SOVEREIGN_COMMITMENT_RE.test(fullText),
  );

  let actionMatch = null;
  let commitmentMatch = null;
  if (playerMentioned) {
    actionMatch = resolveUniqueSemanticAuthority(event, actionRecords, {
      playerCanonical,
      threshold: 0.34,
      margin: 0.1,
    });
    commitmentMatch = resolveUniqueSemanticAuthority(event, commitmentRecords, {
      playerCanonical,
      threshold: 0.28,
      margin: 0.08,
    });
  }

  // Shared treaties / agreements / newly established intergovernmental
  // arrangements are one place where semantic participants are materially
  // stronger evidence than a single grammatical subject. Native code owns the
  // legal rows; event.actors only says WHO jointly chose. Targets and observers
  // must not be listed there. The player row still requires pre-existing
  // authority and therefore fails closed when neither an order nor a prior
  // diplomatic commitment can be proved.
  if (jointSovereignChoice) {
    let playerAuthority = "";
    if (playerIsSemanticActor) {
      if (actionMatch?.match) playerAuthority = "player-order";
      else if (commitmentMatch?.match) playerAuthority = "player-commitment";
      else {
        return {
          agency: null,
          reason: "joint-player-sovereign-choice-without-authority",
          source: "native-unresolved-player",
        };
      }
    }

    const sovereignActors = actorPolities.map((polity) => ({
      polity,
      authority: playerCanonical && resolver.equivalent(polity, playerCanonical)
        ? playerAuthority
        : "autonomous",
      authorityRef: "",
    }));
    const primary = sovereignActors[0];
    return {
      source: playerIsSemanticActor ? `native-joint-${playerAuthority}` : "native-joint-sovereign",
      reason: playerIsSemanticActor
        ? (playerAuthority === "player-order" ? actionMatch?.reason : commitmentMatch?.reason) || "joint-semantic-actors"
        : "joint-semantic-actors",
      agency: {
        principal: primary.polity,
        principalKind: "polity",
        sovereignPolity: primary.polity,
        authority: primary.authority,
        authorityRef: "",
        sovereignActors,
      },
    };
  }

  if (playerMentioned) {
    if (actionMatch?.match) {
      return {
        source: "native-player-order",
        reason: actionMatch.reason,
        agency: {
          principal: playerCanonical,
          principalKind: "polity",
          sovereignPolity: playerCanonical,
          authority: "player-order",
          authorityRef: "",
          sovereignActors: [{ polity: playerCanonical, authority: "player-order", authorityRef: "" }],
        },
      };
    }
    if (commitmentMatch?.match) {
      return {
        source: "native-player-commitment",
        reason: commitmentMatch.reason,
        agency: {
          principal: playerCanonical,
          principalKind: "polity",
          sovereignPolity: playerCanonical,
          authority: "player-commitment",
          authorityRef: "",
          sovereignActors: [{ polity: playerCanonical, authority: "player-commitment", authorityRef: "" }],
        },
      };
    }
  }

  const processIds = nativeCanonicalProcessCandidates(event, world);
  if (processIds.size === 1 && normalizeString(event?.warId)) {
    return {
      source: "native-canonical-process",
      reason: "existing-war-process",
      agency: {
        principal: `canonical process ${[...processIds][0]}`,
        principalKind: "exogenous-process",
        sovereignPolity: "",
        authority: "canonical-process",
        authorityRef: "",
        sovereignActors: [],
      },
    };
  }

  const subjectPolity = subjectPolityFromEvent(event, resolver);
  if (subjectPolity) {
    if (playerCanonical && resolver.equivalent(subjectPolity, playerCanonical)) {
      if (!crossesSovereign && DELEGATED_DOMESTIC_ACTOR_RE.test(fullText)) {
        return { source: "native-player-delegated", reason: "bounded-domestic-actor", agency: nativeDomesticAgency(event, playerCanonical, "delegated-routine") };
      }
      if (!crossesSovereign && ENDOGENOUS_DOMESTIC_PROCESS_RE.test(fullText)) {
        return { source: "native-player-endogenous", reason: "endogenous-domestic-process", agency: nativeDomesticAgency(event, playerCanonical, "endogenous-domestic") };
      }
      return { agency: null, reason: crossesSovereign ? "player-fresh-sovereign-choice-without-authority" : "player-event-not-safely-classifiable", source: "native-unresolved-player" };
    }
    return {
      source: "native-foreign-polity",
      reason: "unique-semantic-polity-subject",
      agency: {
        principal: subjectPolity,
        principalKind: "polity",
        sovereignPolity: subjectPolity,
        authority: "autonomous",
        authorityRef: "",
        sovereignActors: [{ polity: subjectPolity, authority: "autonomous", authorityRef: "" }],
      },
    };
  }

  const institution = subjectInstitutionFromEvent(event, world);
  if (institution) {
    if (playerMentioned && crossesSovereign) {
      return { agency: null, reason: "institution-event-also-implicates-player-fresh-sovereign-choice", source: "native-unresolved-player" };
    }
    const principal = normalizeString(institution?.name || institution?.shortName || institution?.id);
    return {
      source: "native-institution",
      reason: "unique-canonical-institution-subject",
      agency: {
        principal,
        principalKind: "institution",
        sovereignPolity: "",
        authority: "autonomous",
        authorityRef: "",
        sovereignActors: [],
      },
    };
  }

  // Several governments/agencies may participate in a bounded consultation or
  // coordination process without the event itself exercising fresh sovereign
  // discretion.  Represent the interaction honestly as a collective process
  // instead of inventing a fake standing institution or pretending one polity
  // alone owns the meeting.  Any treaty/new framework/etc. remains outside this
  // path because crossesSovereign is true.
  const mentionedPolities = eventMentionedPolities(event, resolver);
  if (!crossesSovereign && mentionedPolities.length >= 2 && ROUTINE_COLLECTIVE_PROCESS_RE.test(fullText)) {
    return {
      source: "native-collective-process",
      reason: "bounded-multi-polity-coordination",
      agency: {
        principal: nativeSubjectLabel(event) || "multilateral coordination process",
        principalKind: "collective-process",
        sovereignPolity: "",
        authority: "independent",
        authorityRef: "",
        sovereignActors: [],
      },
    };
  }

  if (playerMentioned && !crossesSovereign && DELEGATED_DOMESTIC_ACTOR_RE.test(fullText)) {
    return { source: "native-player-delegated", reason: "bounded-domestic-actor", agency: nativeDomesticAgency(event, playerCanonical, "delegated-routine") };
  }
  if (playerMentioned && !crossesSovereign && ENDOGENOUS_DOMESTIC_PROCESS_RE.test(fullText)) {
    return { source: "native-player-endogenous", reason: "endogenous-domestic-process", agency: nativeDomesticAgency(event, playerCanonical, "endogenous-domestic") };
  }
  if (playerMentioned && crossesSovereign) {
    return { agency: null, reason: "player-fresh-sovereign-choice-without-authority", source: "native-unresolved-player" };
  }

  if (EXOGENOUS_EVENT_RE.test(fullText)) {
    return {
      source: "native-exogenous",
      reason: "non-discretionary-exogenous-event",
      agency: {
        principal: nativeSubjectLabel(event) || "exogenous world process",
        principalKind: "exogenous-process",
        sovereignPolity: "",
        authority: "external-consequence",
        authorityRef: "",
        sovereignActors: [],
      },
    };
  }

  return { agency: null, reason: "no-unique-native-provenance", source: "native-unresolved" };
};

const delegatedStructuredSovereignReason = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  for (const key of ["actionIds", "polityChanges", "politicalActorOps", "regionTransfers", "regionClaims", "spyOps"]) {
    if (normalizeArray(impacts?.[key]).length) return `${key} changes sovereign/legal state and cannot be justified by delegated-routine authority`;
  }
  for (const op of normalizeArray(impacts?.unitOps)) {
    const kind = normalizeString(op?.op).toLowerCase();
    if (["spawn", "remove"].includes(kind)) {
      return `unitOps.${kind} creates/removes persistent military capability and requires sovereign or already-authorized process provenance`;
    }
  }
  return "";
};

// FC5: human control protects fresh sovereign political will, not every event
// inside the country. The model supplies a proposed class, but native JS checks
// whether the event actually crosses a sovereign-policy gate before accepting
// delegated-routine/endogenous-domestic provenance.
const nonSovereignPlayerActivityReason = (event, agency, { world = {}, resolver, playerCanonical }) => {
  const authority = normalizeString(agency?.authority).toLowerCase();
  if (!["delegated-routine", "endogenous-domestic"].includes(authority)) return "";

  const jurisdiction = resolver.canonical(normalizeString(agency?.jurisdictionPolity));
  if (!jurisdiction) return `${authority} jurisdictionPolity does not resolve to a canonical polity`;
  const principalKind = normalizeString(agency?.principalKind).toLowerCase();
  const principal = normalizeString(agency?.principal);
  const knownPolityPrincipal = resolver.records.some((record) =>
    [record.canonical, ...normalizeArray(record.aliases)]
      .some((name) => normalizeString(name).toLowerCase() === principal.toLowerCase()));
  if (principalKind === "polity" || knownPolityPrincipal) {
    return `${authority} cannot relabel a sovereign polity/government principal as non-sovereign activity`;
  }
  if (authority === "delegated-routine" && !["domestic-actor", "organization", "person", "institution"].includes(principalKind)) {
    return `delegated-routine principalKind must be domestic-actor, organization, person, or subordinate domestic institution; received ${principalKind || "(blank)"}`;
  }
  if (authority === "delegated-routine" && principalKind === "institution") {
    // `institution` is also the canonical kind used by international/collective
    // institutions elsewhere in the runtime. A domestic ministry, border guard,
    // armed-forces command or similar subordinate state body may execute routine
    // activity inside its jurisdiction, but an international/canonical institution
    // must use its own-right institutional authority path instead of borrowing the
    // human polity's delegated mandate.
    const institution = resolveInstitutionRecord(world, principal);
    if (institution) {
      return "delegated-routine institution principal resolves to a canonical institution; use institutional own-right authority or sovereign provenance instead of a domestic delegated mandate";
    }
  }
  if (authority === "endogenous-domestic" && !["domestic-process", "domestic-actor", "organization", "person"].includes(principalKind)) {
    return `endogenous-domestic principalKind must be domestic-process, domestic-actor, organization, or person; received ${principalKind || "(blank)"}`;
  }

  // Native semantics, not the model's authority label, decide whether a claimed
  // non-sovereign event actually crosses a fresh sovereign-policy boundary.
  if (eventCrossesFreshSovereignPolicyBoundary(event)) {
    return `${authority} event text crosses a fresh sovereign-policy boundary; a non-sovereign label cannot authorize government/parliament policy or a new international commitment`;
  }
  if (authority === "delegated-routine") {
    const structured = delegatedStructuredSovereignReason(event);
    if (structured) return structured;
  }

  // For the human polity this is the key distinction: jurisdiction says where
  // the activity occurs; it never turns into consent by that sovereign.
  if (playerCanonical && resolver.equivalent(jurisdiction, playerCanonical)) return "";
  return "";
};

const eventAgencyAuthorityReason = (event, {
  world = {},
  gameCountry = "",
  actions = [],
  chats = [],
  requireAgency = false,
} = {}) => {
  const player = normalizeString(gameCountry);
  if (!player || !event || typeof event !== "object") return "";

  const rawAgency = event?.agency;
  const structureReason = eventAgencyStructureReason(rawAgency);
  if (structureReason) return structureReason;
  if (rawAgency && Object.prototype.hasOwnProperty.call(rawAgency, "sovereignActors")) {
    if (!Array.isArray(rawAgency.sovereignActors)) {
      return "event.agency.sovereignActors must be an array";
    }
    if (rawAgency.sovereignActors.length > EVENT_AGENCY_MAX_SOVEREIGN_ACTORS) {
      return `event.agency.sovereignActors exceeds the native limit of ${EVENT_AGENCY_MAX_SOVEREIGN_ACTORS}`;
    }
    for (const row of rawAgency.sovereignActors) {
      const polity = normalizeString(row?.polity || row?.sovereignPolity);
      const authority = normalizeString(row?.authority).toLowerCase();
      if (!polity) return "each event.agency.sovereignActors row requires a polity";
      if (!EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(authority)) {
        return `sovereign actor ${polity} uses invalid authority ${authority || "(blank)"}`;
      }
    }
  }

  const agency = normalizeEventAgency(rawAgency);
  if (!agency) {
    return requireAgency
      ? "event is missing valid structural agency provenance"
      : "";
  }

  const resolver = createWorldActorResolver(world, player);
  const playerCanonical = resolver.canonical(player);
  const sovereignActors = normalizeArray(agency.sovereignActors);

  const playerPoliticalActorMutation = normalizeArray(event?.impacts?.politicalActorOps).some((operation) => {
    const target = resolver.canonical(normalizeString(operation?.polityKey || operation?.polity || operation?.country));
    return Boolean(target && playerCanonical && resolver.equivalent(target, playerCanonical));
  });
  if (playerPoliticalActorMutation && eventCrossesFreshSovereignPolicyBoundary(event)) {
    const authorizedPlayerRow = sovereignActors.some((row) => {
      const target = resolver.canonical(normalizeString(row?.polity));
      const authority = normalizeString(row?.authority).toLowerCase();
      return Boolean(
        target
        && resolver.equivalent(target, playerCanonical)
        && ["player-order", "player-commitment"].includes(authority)
      );
    });
    if (!authorizedPlayerRow) {
      return `politicalActorOps encodes a fresh sovereign-policy choice for the human-controlled polity ${playerCanonical} without player-order or player-commitment authority`;
    }
  }

  const nonSovereignReason = nonSovereignPlayerActivityReason(event, agency, { world, resolver, playerCanonical });
  if (nonSovereignReason) return nonSovereignReason;

  if (sovereignActors.length > EVENT_AGENCY_MAX_SOVEREIGN_ACTORS) {
    return `event.agency.sovereignActors exceeds the native limit of ${EVENT_AGENCY_MAX_SOVEREIGN_ACTORS}`;
  }

  if (sovereignActors.length) {
    const seen = new Set();
    const actionsById = currentActionIds(actions);
    const commitmentIds = playerCommitmentMessageIds(chats, resolver, playerCanonical);
    const eventActionIds = new Set(
      normalizeArray(event?.impacts?.actionIds).map(normalizeString).filter(Boolean),
    );

    for (const row of sovereignActors) {
      const polity = normalizeString(row?.polity);
      const authority = normalizeString(row?.authority).toLowerCase();
      const authorityRef = normalizeString(row?.authorityRef);
      if (!polity) return "each event.agency.sovereignActors row requires a polity";
      if (!EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(authority)) {
        return `sovereign actor ${polity} uses invalid authority ${authority || "(blank)"}`;
      }

      const canonical = resolver.canonical(polity);
      const identityKey = normalizeString(canonical || polity).toLocaleLowerCase();
      if (seen.has(identityKey)) {
        return `event.agency.sovereignActors lists ${canonical || polity} more than once`;
      }
      seen.add(identityKey);

      const isPlayer = Boolean(canonical && resolver.equivalent(canonical, playerCanonical));
      if (authority === "autonomous") {
        if (isPlayer) {
          return `${playerCanonical} is human-controlled, but event.agency grants it autonomous sovereign authority as a principal, co-signatory, or joint participant without pre-existing player authorization`;
        }
        if (authorityRef) return `autonomous authority for ${canonical || polity} must leave authorityRef blank`;
        continue;
      }

      if (!isPlayer) {
        return `${authority} authority is valid only for the human-controlled polity, not ${canonical || polity}`;
      }
      if (!authorityRef) return `${authority} authority for ${playerCanonical} requires authorityRef`;

      if (authority === "player-order") {
        if (!actionsById.has(authorityRef)) {
          return `player-order authorityRef "${authorityRef}" does not match a current queued player action`;
        }
        if (!eventActionIds.has(authorityRef)) {
          return `player-order authorityRef "${authorityRef}" must also appear in impacts.actionIds`;
        }
      } else if (!commitmentIds.has(authorityRef)) {
        return `player-commitment authorityRef "${authorityRef}" does not match an existing player-authored diplomatic message`;
      }
    }

    return "";
  }

  if (["delegated-routine", "endogenous-domestic"].includes(agency.authority)) {
    if (agency.sovereignPolity || sovereignActors.length) {
      return `${agency.authority} is non-sovereign provenance and must leave sovereignPolity blank and sovereignActors empty`;
    }
    if (agency.authorityRef) return `${agency.authority} must leave authorityRef blank`;
    return "";
  }

  if (["independent", "external-consequence"].includes(agency.authority) && agency.sovereignPolity) {
    return `${agency.authority} authority cannot exercise sovereignPolity; use autonomous/player-order/canonical-process when a sovereign state is actually making the choice`;
  }

  if (["autonomous", "independent"].includes(agency.authority)) {
    if (agency.authority === "independent" && agency.principalKind === "collective-process"
        && eventCrossesFreshSovereignPolicyBoundary(event)) {
      return "independent collective-process provenance cannot disguise a fresh sovereign-policy choice or new international commitment";
    }
    // Own-right discretion is not confined to sovereign governments. Membership
    // in a collective institution is NOT a fresh choice by every member state.
    // Conversely, relabeling a known government as a private actor grants nothing.
    const principalKey = normalizeString(agency.principal).toLowerCase();
    const knownPolity = resolver.records.some((record) =>
      [record.canonical, ...normalizeArray(record.aliases)]
        .some((name) => normalizeString(name).toLowerCase() === principalKey));
    if (agency.principalKind === "polity" || knownPolity) {
      return `${agency.authority} authority for a polity requires at least one sovereignActors row`;
    }
    if (agency.principalKind === "exogenous-process") {
      return "a non-discretionary process requires canonical-process or external-consequence authority";
    }
    if (agency.authorityRef) return `${agency.authority} own-right authority must leave authorityRef blank`;
    if (agency.principalKind === "institution") {
      const institution = resolveInstitutionAuthorityPrincipal(world, agency.principal);
      if (!institution) {
        return "institutional own-right authority requires one unambiguous active canonical institution principal; membership alone grants no sovereign authority";
      }
    }
    return "";
  }

  if (agency.authority === "external-consequence" && agency.principalKind !== "exogenous-process") {
    return "external-consequence requires a non-discretionary exogenous-process principal, not a disguised actor decision";
  }

  if (agency.authority === "player-order") {
    return "player-order authority requires a sovereignActors row for the human-controlled polity";
  }

  if (agency.authority === "player-commitment") {
    return "player-commitment authority requires a sovereignActors row for the human-controlled polity";
  }

  if (agency.authority === "canonical-process") {
    // A pre-existing process can own a consequence, but it cannot be cited as a
    // magic permission token for a fresh sovereign decision. If sovereign
    // discretion is still being exercised, the event must use the corresponding
    // sovereign authority (autonomous for AI polities, player-order/commitment for
    // the human polity). Process consequences therefore carry no sovereignPolity.
    if (agency.sovereignPolity || sovereignActors.length) {
      return "canonical-process authority represents an already-authorized consequence and must leave sovereignPolity blank and sovereignActors empty; it cannot grant fresh sovereign discretion";
    }
    const ref = normalizeString(agency.authorityRef);
    if (!ref) return "canonical-process authority requires authorityRef";
    if (!canonicalProcessIds(world).has(ref)) {
      return `canonical-process authorityRef "${ref}" is not an already-existing active canonical storyline/project/war/order/institution resolution`;
    }
    return "";
  }

  // independent and external-consequence are deliberately valid only when they
  // do not borrow sovereign authority. Their effects may still affect the player;
  // target/effect is not decision ownership.
  return "";
};

export const playerAgencyViolationReason = (event, options = {}) =>
  eventAgencyAuthorityReason(event, { ...options, requireAgency: false });

export const resolveWorldEventProvenance = (candidate, options = {}) =>
  bindWorldEventAuthorityRefs(candidate, options);

const eventReferencesPlayerSovereignty = (event, {
  world = {},
  gameCountry = "",
  unresolved = null,
} = {}) => {
  const resolver = createWorldActorResolver(world, gameCountry);
  const playerCanonical = resolver.canonical(normalizeString(gameCountry));
  if (!playerCanonical) return false;
  if (rawAgencyClaimsPlayerSovereignty(event?.agency, resolver, playerCanonical)) return true;
  const playerPoliticalActorMutation = normalizeArray(event?.impacts?.politicalActorOps).some((operation) => {
    const target = resolver.canonical(normalizeString(operation?.polityKey || operation?.polity || operation?.country));
    return Boolean(target && resolver.equivalent(target, playerCanonical));
  });
  if (playerPoliticalActorMutation && eventCrossesFreshSovereignPolicyBoundary(event)) return true;
  if (normalizeString(unresolved?.source).includes("player")) return true;
  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  return actorFamilyMentioned(text, resolver.aliasesFor(playerCanonical))
    && eventCrossesFreshSovereignPolicyBoundary(event);
};

const provenanceRecordCollections = (candidate) => [
  candidate?.warUpdates,
  candidate?.relationUpdates,
  candidate?.agreementUpdates,
  candidate?.institutionUpdates,
  candidate?.storylineUpdates,
  candidate?.countryStatPatches,
].filter(Array.isArray);

const eventHasCanonicalProvenanceDependencies = (candidate, event, eventIndex) => {
  if (!event || typeof event !== "object") return true;
  if (hardImpactKeysForEvent(event).length) return true;
  if (normalizeArray(event?.impacts?.actionIds).length) return true;
  if (normalizeString(event?.warId)) return true;
  if (normalizeArray(event?.storylineIds).length) return true;
  const eventId = normalizeString(event?.id);
  if (eventId && normalizeArray(candidate?.boardProvisionalEventIds).map(normalizeString).includes(eventId)) return true;
  if (eventHasLedgerTrigger(candidate, eventIndex)) return true;

  for (const records of provenanceRecordCollections(candidate)) {
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      if (eventId && normalizeArray(record?.eventIds).map(normalizeString).includes(eventId)) return true;
      if (normalizeArray(record?.eventIndexes).map(Number).some((value) => value === eventIndex)) return true;
    }
  }
  return false;
};

const remapEventIndexesAfterDrop = (candidate, dropIndexes) => {
  const drops = [...dropIndexes].sort((a, b) => a - b);
  const remap = (value) => {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || dropIndexes.has(index)) return null;
    return index - drops.filter((drop) => drop < index).length;
  };
  for (const records of provenanceRecordCollections(candidate)) {
    for (const record of records) {
      if (!record || typeof record !== "object" || !Array.isArray(record.eventIndexes)) continue;
      record.eventIndexes = record.eventIndexes.map(remap).filter((value) => Number.isInteger(value));
    }
  }
};

// World Engine event-local quarantine primitive. Validators outside the native
// provenance pass (for example Political Decision Context compatibility) may
// identify one or more exact event indexes that are unsafe to publish. They may
// quarantine ONLY events that have no canonical impacts/ledger/storyline/action
// dependencies. This preserves the strong domain-owner boundary: an event with
// canonical consequences is still a hard failure until that entire dependency
// set can be repaired coherently rather than silently orphaned.
//
// The helper deliberately accepts already-derived issues instead of re-running
// any semantic validator. It owns only the safe batch mutation/remap step.
export const quarantineIndependentWorldEventIssues = (
  candidate,
  issues = [],
  { label = "world grounding" } = {},
) => {
  const events = normalizeArray(candidate?.events);
  const dropIndexes = new Set();
  const dropped = [];
  const blocked = [];

  for (const issue of normalizeArray(issues)) {
    const index = Number(issue?.index);
    if (!Number.isInteger(index) || index < 0 || index >= events.length) continue;
    const event = events[index];
    const row = {
      ...issue,
      index,
      id: normalizeString(issue?.id || event?.id),
      title: normalizeString(issue?.title || event?.title) || "Untitled",
      message: normalizeString(issue?.message),
    };

    if (eventHasCanonicalProvenanceDependencies(candidate, event, index)) {
      blocked.push(row);
      continue;
    }

    dropIndexes.add(index);
    dropped.push(row);
  }

  if (dropIndexes.size) {
    candidate.events = events.filter((_, index) => !dropIndexes.has(index));
    remapEventIndexesAfterDrop(candidate, dropIndexes);
    console.warn(
      `[OH World Engine] quarantined ${dropIndexes.size} independent ${label} event(s); ` +
      "dependent canonical changes remain fail-closed.",
      dropped,
    );
  }

  return {
    dropped,
    blocked,
    error: normalizeString(blocked[0]?.message),
  };
};

export const validateWorldPlayerAgencyPayload = (candidate, {
  world = {},
  gameCountry = "",
  actions = [],
  chats = [],
  salvageIndependent = false,
  // World Engine normal-turn mode: semantic events with no canonical ledger/impact
  // dependencies may be quarantined individually even when they cross the human
  // sovereign boundary. Dropping the event preserves sovereignty; it does NOT
  // reinterpret, downgrade, or fabricate authority. Hard/dependent events still
  // fail closed because removing them could strand canonical state.
  quarantineIndependentInvalidEvents = false,
  onQuarantine = null,
} = {}) => {
  const binding = bindWorldEventAuthorityRefs(candidate, {
    world,
    gameCountry,
    actions,
    chats,
  });
  if (binding.applied > 0) {
    const derived = binding.bindings.filter((entry) => entry.authority === "native-provenance").length;
    console.info(
      `[OH Native Authority Binder v${NATIVE_AUTHORITY_BINDER_VERSION}] ` +
      `${binding.applied} native provenance/authority binding(s) applied` +
      `${derived ? ` (${derived} event provenance record(s) reconstructed natively)` : ""}.`,
    );
  }

  const events = normalizeArray(candidate?.events);
  const dropIndexes = new Set();
  const droppedAudit = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const reason = eventAgencyAuthorityReason(event, {
      world,
      gameCountry,
      actions,
      chats,
      requireAgency: true,
    });
    if (!reason) continue;

    const unresolved = binding.unresolved.find((entry) => entry.eventIndex === index);
    const hardPlayerBoundary = eventReferencesPlayerSovereignty(event, {
      world,
      gameCountry,
      unresolved,
    });

    const independent = !eventHasCanonicalProvenanceDependencies(candidate, event, index);
    const mayQuarantine = independent && (
      quarantineIndependentInvalidEvents ||
      (salvageIndependent && !hardPlayerBoundary)
    );
    if (mayQuarantine) {
      dropIndexes.add(index);
      droppedAudit.push({
        index,
        id: normalizeString(event?.id),
        title: normalizeString(event?.title) || "Untitled",
        reason,
        resolution: normalizeString(unresolved?.reason),
        boundary: hardPlayerBoundary ? "player-sovereignty" : "unresolved-provenance",
      });
      continue;
    }

    const binderDetail = unresolved
      ? ` Native provenance resolution: ${unresolved.reason}; ${unresolved.candidateCount} canonical candidate(s); best semantic score ${Number(unresolved.bestScore || 0).toFixed(2)}.`
      : "";
    const prefix = hardPlayerBoundary ? "Player-agency authority violation" : "Event provenance resolution failure";
    return `${prefix} at $.events[${index}] ("${normalizeString(event?.title) || "Untitled"}"): ${reason}.${binderDetail} ` +
      (hardPlayerBoundary
        ? "The human sovereign boundary remains hard; correct the semantic event or bind it to existing player authority."
        : "Native provenance could not safely establish decision ownership; do not invent opaque authority ids.");
  }

  if (dropIndexes.size) {
    candidate.events = events.filter((_, index) => !dropIndexes.has(index));
    remapEventIndexesAfterDrop(candidate, dropIndexes);
    console.warn(
      `[OH Native Event Provenance v${NATIVE_EVENT_PROVENANCE_VERSION}] ` +
      `quarantined ${dropIndexes.size} independent invalid event(s) after native resolution; keeping the rest of the segment without weakening canonical authority.`,
      droppedAudit,
    );
    if (typeof onQuarantine === "function") onQuarantine(droppedAudit);
  }
  return "";
};

const importanceWeightForQuality = (importance) => {
  switch (normalizeString(importance).toLowerCase()) {
    case "critical": return 4;
    case "major": return 3;
    case "moderate": return 2;
    case "minor": return 1;
    default: return 0;
  }
};

const eventHasExplicitActionAuthority = (event) =>
  normalizeArray(event?.impacts?.actionIds).length > 0;

const lowTrajectoryInstitutionalEvent = (event) => {
  if (!event || typeof event !== "object") return false;
  if (deriveWorldTrajectoryValue(event) > 1) return false;
  if (hardImpactKeysForEvent(event).length) return false;
  if (normalizeArray(event?.storylineIds).length) return false;
  if (normalizeString(event?.warId)) return false;
  if (eventHasExplicitActionAuthority(event)) return false;
  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  return LOW_TRAJECTORY_INSTITUTIONAL_RE.test(text) ||
    TRAJECTORY_REPORTING_RE.test(text) ||
    (ROUTINE_ADMINISTRATIVE_CUE_RE.test(text) && !ADMINISTRATIVE_MATERIAL_OUTCOME_RE.test(text));
};

export const createWorldEventScopeClassifier = (
  analysis = null,
  { world = {}, gameCountry = "" } = {},
) => {
  // Build identity provenance ONCE for the bounded visible batch. Never recreate
  // the 4k+ region alias index once per event; that is the exact class of hotpath
  // R3.2 removed from the World Director.
  const resolver = createWorldActorResolver(world, gameCountry);
  const playerActors = uniqueStrings([
    gameCountry,
    ...normalizeArray(analysis?.explorationSlate)
      .filter((slot) => slot?.scope === "player-sphere" && slot?.type === "actor-domain")
      .map((slot) => slot?.actor),
  ])
    .map((actor) => resolver.canonical(actor))
    .filter(Boolean);

  return (event) => {
    if (!event || typeof event !== "object") return "unknown";
    if (event?.playerRelated === true) return "player-sphere";

    const text = eventExplorationText(event);
    const actors = mentionedPolities(text, world, gameCountry)
      .map((actor) => resolver.canonical(actor))
      .filter(Boolean);

    if (
      actors.some((actor) =>
        playerActors.some((sphereActor) => resolver.equivalent(actor, sphereActor))
      )
    ) {
      return "player-sphere";
    }

    return actors.length ? "wider-world" : "unknown";
  };
};

export const classifyWorldEventScope = (
  event,
  analysis = null,
  options = {},
) => createWorldEventScopeClassifier(analysis, options)(event);

const applyLowTrajectoryFeedGuard = ({
  events,
  priorEvents = [],
  analysis = null,
  world = {},
  game = {},
} = {}) => {
  const source = normalizeArray(events);
  const currentLow = source
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => lowTrajectoryInstitutionalEvent(event));

  if (currentLow.length < LOW_TRAJECTORY_BATCH_TRIGGER) {
    return { events: source, dropped: [], hidden: [] };
  }

  const recentLowCount = normalizeArray(priorEvents)
    .slice(-LOW_TRAJECTORY_RECENT_WINDOW)
    .filter(lowTrajectoryInstitutionalEvent)
    .length;

  const cap = recentLowCount >= LOW_TRAJECTORY_RECENT_SATURATION ? 1 : 2;
  if (currentLow.length <= cap) return { events: source, dropped: [], hidden: [] };

  const classifyScope = createWorldEventScopeClassifier(analysis, {
    world,
    gameCountry: normalizeString(game?.country),
  });
  const scopeCounts = source.reduce((acc, event) => {
    const scope = classifyScope(event);
    acc[scope] = (acc[scope] || 0) + 1;
    return acc;
  }, {});

  const ranked = currentLow
    .map(({ event, index }) => {
      const scope = classifyScope(event);
      const scopeCount = scopeCounts[scope] || 0;
      return {
        event,
        index,
        scope,
        keepScore:
          importanceWeightForQuality(event?.importance) * 10 +
          (event?.notable === true ? 4 : 0) -
          scopeCount,
      };
    })
    .sort((a, b) =>
      (b.keepScore - a.keepScore) ||
      compareGameDates(a.event?.date || "", b.event?.date || "") ||
      a.index - b.index
    );

  const keepIndexes = new Set(ranked.slice(0, cap).map((row) => row.index));
  const lowIndexes = new Set(currentLow.map((row) => row.index));
  const dropped = [];
  const hidden = [];
  const kept = [];

  source.forEach((event, index) => {
    if (!lowIndexes.has(index) || keepIndexes.has(index)) {
      kept.push(event);
      return;
    }
    const row = {
      id: normalizeString(event?.id),
      title: normalizeString(event?.title),
      route: "LOW_TRAJECTORY_FEED_SATURATION",
      reason:
        `low-trajectory institutional/process card suppressed because this batch contained ${currentLow.length} such cards` +
        (recentLowCount >= LOW_TRAJECTORY_RECENT_SATURATION
          ? ` and ${recentLowCount}/${LOW_TRAJECTORY_RECENT_WINDOW} recent cards were already the same low-branch texture`
          : ""),
    };
    dropped.push(row);
    hidden.push({ event, route: row.route, reason: row.reason });
  });

  return { events: kept, dropped, hidden };
};

export const screenGeneratedWorldEvents = ({
  events = [],
  priorEvents = [],
  world = {},
  game = {},
  actions = [],
  chats = [],
  analysis = null,
} = {}) => {
  const kept = [];
  const dropped = [];
  // Canonical events kept off the timeline by a VISIBILITY rule (routine,
  // low-value) are handed on whole: they still happened, and the Board reads
  // every Canonical event. `dropped` stays the audit of everything removed; a
  // rejection (the wartime-causality rule) is in `dropped` and never here.
  const hidden = [];
  const keepOffTimeline = (event, route, reason) => {
    dropped.push({ id: normalizeString(event?.id), title: normalizeString(event?.title), route, reason });
    hidden.push({ event, route, reason });
  };
  let strippedPolityUpdates = 0;
  let mergedDuplicatePolityUpdates = 0;
  let strippedNoOpRegionControlOps = 0;

  for (const original of normalizeArray(events)) {
    const processSanitized = sanitizeProcessOnlyPolityUpdates(original);
    strippedPolityUpdates += processSanitized.removed;

    const lineageSanitized = sanitizeDuplicatePolityUpdates(
      processSanitized.event,
      world,
    );
    mergedDuplicatePolityUpdates += lineageSanitized.merged;

    const controlSanitized = sanitizeNoOpRegionControlOps(
      lineageSanitized.event,
      world,
    );
    strippedNoOpRegionControlOps += controlSanitized.removed;

    const eventWrapper = { events: [controlSanitized.event] };
    bindWorldEventAuthorityRefs(eventWrapper, {
      world,
      gameCountry: normalizeString(game?.country),
      actions,
      chats,
    });
    const event = eventWrapper.events[0];

    const agencyReason = eventAgencyAuthorityReason(event, {
      world,
      gameCountry: normalizeString(game?.country),
      actions,
      chats,
      requireAgency: false,
    });
    if (agencyReason) {
      dropped.push({
        id: normalizeString(event?.id),
        title: normalizeString(event?.title),
        route: "PLAYER_AGENCY_AUTHORITY",
        reason: agencyReason,
      });
      continue;
    }

    const wartimeReason = falseNonBelligerentWartimeReason(
      event,
      world,
      normalizeString(game?.country),
    );

    if (wartimeReason) {
      dropped.push({
        id: normalizeString(event?.id),
        title: normalizeString(event?.title),
        route: "NON_BELLIGERENT_WARTIME_CAUSALITY",
        reason: wartimeReason,
      });
      continue;
    }

    const routineReason = routineMilitaryNoDeltaReason(event);

    if (routineReason) {
      keepOffTimeline(event, "ROUTINE_MILITARY_PRECURATION", routineReason);
      continue;
    }

    const administrativeReason = routineAdministrativeNoDeltaReason(event);
    if (administrativeReason) {
      keepOffTimeline(event, "ROUTINE_ADMINISTRATIVE_PROCESS", administrativeReason);
      continue;
    }

    kept.push(event);
  }

  const feedGuard = applyLowTrajectoryFeedGuard({
    events: kept,
    priorEvents,
    analysis,
    world,
    game,
  });
  if (feedGuard.dropped.length) dropped.push(...feedGuard.dropped);
  hidden.push(...feedGuard.hidden);

  const result = {
    events: feedGuard.events,
    dropped,
    hidden,
    strippedPolityUpdates,
    mergedDuplicatePolityUpdates,
    strippedNoOpRegionControlOps,
    analysisVersion:
      normalizeString(analysis?.version) ||
      WORLD_INTEGRITY_VERSION,
  };

  if (
    dropped.length ||
    strippedPolityUpdates ||
    mergedDuplicatePolityUpdates ||
    strippedNoOpRegionControlOps
  ) {
    console.info(
      `[OH Native World Integrity v${WORLD_INTEGRITY_VERSION}] ` +
      `kept ${result.events.length}/${normalizeArray(events).length} generated event(s); ` +
      `dropped ${dropped.length}, stripped ${strippedPolityUpdates} unsupported polity update(s), ` +
      `merged ${mergedDuplicatePolityUpdates} duplicate polity update(s), ` +
      `stripped ${strippedNoOpRegionControlOps} no-op control op(s); ${hidden.length} kept off the timeline for the Board.`,
      // The Hidden events are whole events; `dropped` already names them.
      { ...result, hidden: hidden.length },
    );
  }

  return result;
};

export const runWorldIntegritySelfTests = () => {
  const world = {
    polityOverrides: {
      DEU: {
        code: "German Empire",
        name: "German Empire",
        aliases: ["Germany"],
      },
      POL: {
        code: "Poland",
        name: "Poland",
        aliases: [],
      },
      RUS: {
        code: "Russian Empire",
        name: "Russian Empire",
        aliases: ["Russia"],
      },
      "Austrian Empire": {
        code: "Austrian Empire",
        name: "Austria-Hungary",
        aliases: ["Austria-Hungary"],
      },
    },
    regionClaimants: {
      "reg-masovia": ["Russian Empire"],
    },
    wars: [
      {
        id: "polish-war",
        status: "active",
        sideA: ["Poland"],
        sideB: ["Russian Empire"],
      },
    ],
  };

  const game = {
    country: "German Empire",
    gameDate: "1916-03-01",
    round: 1,
  };

  const make = (title, description, impacts = {}) => ({
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    description,
    impacts: {
      regionTransfers: [],
      regionControlOps: [],
      polityChanges: [],
      unitOps: [],
      markerOps: [],
      createdChats: [],
      ...impacts,
    },
  });

  const cases = [];

  const run = (
    name,
    event,
    expectedKept,
    expectedStripped = 0,
  ) => {
    const result = screenGeneratedWorldEvents({
      events: [event],
      world,
      game,
    });

    const pass =
      result.events.length === (expectedKept ? 1 : 0) &&
      result.strippedPolityUpdates === expectedStripped;

    cases.push({
      name,
      pass,
      kept: result.events.length,
      dropped: result.dropped[0]?.route || "",
      stripped: result.strippedPolityUpdates,
    });
  };

  run(
    "non-belligerent wartime rationing rejected",
    make(
      "German Wartime Rationing Continues",
      "Germany expands its wartime rationing as shortages deepen.",
    ),
    false,
  );

  run(
    "wartime preparedness remains legal",
    make(
      "Germany Tests Wartime Food Reserves",
      "German officials simulate wartime ration allocations for a potential future conflict.",
    ),
    true,
  );

  run(
    "routine artillery without delta rejected",
    make(
      "Russian Artillery Bombardment Outside Warsaw",
      "Russian artillery resumes bombardment and localized probing outside Warsaw.",
    ),
    false,
  );

  run(
    "breakthrough with control consequence survives",
    make(
      "Russian Forces Break Through Outside Warsaw",
      "Russian forces break through and capture the outer defensive belt.",
      {
        regionControlOps: [
          {
            op: "control",
            regionId: "Warsaw",
            fromCode: "Poland",
            toCode: "Russian Empire",
          },
        ],
      },
    ),
    true,
  );

  run(
    "process-only polity update stripped",
    make(
      "Reichstag Reviews Food Policy",
      "The Reichstag debates food policy without adopting a measure.",
      {
        polityChanges: [
          {
            operation: "update",
            code: "German Empire",
            stats: { stability: 82 },
          },
        ],
      },
    ),
    true,
    1,
  );

  {
    const duplicateAliasResult = screenGeneratedWorldEvents({
      events: [
        make(
          "Austro-Hungarian Ministry Reports Severe Fiscal Strain",
          "The finance ministry reports severe fiscal strain and a material stability decline.",
          {
            polityChanges: [
              {
                operation: "update",
                code: "Austria-Hungary",
                stats: {
                  stability: 43,
                  economy: { inflation: "13%" },
                },
              },
              {
                operation: "update",
                code: "Austrian Empire",
                stats: {
                  stability: 43,
                  economy: { budgetBalance: "-16% GDP" },
                },
              },
            ],
          },
        ),
      ],
      world,
      game,
    });

    const mergedChange =
      duplicateAliasResult.events[0]?.impacts?.polityChanges?.[0] || null;

    cases.push({
      name: "same-lineage polity updates merge before persistence",
      pass:
        duplicateAliasResult.events.length === 1 &&
        duplicateAliasResult.mergedDuplicatePolityUpdates === 1 &&
        duplicateAliasResult.events[0]?.impacts?.polityChanges?.length === 1 &&
        mergedChange?.stats?.stability === 43 &&
        mergedChange?.stats?.economy?.inflation === "13%" &&
        mergedChange?.stats?.economy?.budgetBalance === "-16% GDP",
      kept: duplicateAliasResult.events.length,
      dropped: duplicateAliasResult.dropped[0]?.route || "",
      stripped: duplicateAliasResult.mergedDuplicatePolityUpdates,
    });
  }

  {
    const noOpContestResult = screenGeneratedWorldEvents({
      events: [
        make(
          "Russian Artillery Probe in Masovia",
          "Russian artillery resumes localized probing in Masovia; Polish positions remain unchanged.",
          {
            regionControlOps: [
              {
                op: "contest",
                regionId: "reg-masovia",
                regionName: "Masovia",
                fromCode: "Poland",
                actorCode: "Russian Empire",
              },
            ],
          },
        ),
      ],
      world,
      game,
    });

    cases.push({
      name: "already-existing contest cannot smuggle routine combat",
      pass:
        noOpContestResult.events.length === 0 &&
        noOpContestResult.strippedNoOpRegionControlOps === 1 &&
        noOpContestResult.dropped[0]?.route === "ROUTINE_MILITARY_PRECURATION",
      kept: noOpContestResult.events.length,
      dropped: noOpContestResult.dropped[0]?.route || "",
      stripped: noOpContestResult.strippedNoOpRegionControlOps,
    });
  }

  const deferredPrior = {
    id: "storyline-deferred-motion-test",
    status: "active",
    pressure: 78,
    momentum: 20,
    participants: ["Poland", "Russian Empire"],
  };

  const routineDeferredReentry = deferredStorylineReentryHasConcreteTrigger(
    {
      events: [make(
        "Russian Artillery Exchanges Continue",
        "Russian and Polish batteries exchange localized artillery fire while the trench line remains unchanged.",
      )],
      warUpdates: "",
      relationUpdates: "",
      agreementUpdates: "",
    },
    [0],
    deferredPrior,
    { ...deferredPrior, pressure: 82, momentum: 28 },
  );

  cases.push({
    name: "deferred routine artillery cannot self-reactivate",
    pass: routineDeferredReentry === false,
    kept: "",
    dropped: routineDeferredReentry ? "unexpected reentry" : "ROUTINE_CONTINUITY_BLOCKED",
    stripped: "",
  });

  const endogenousDeferredReentry = deferredStorylineReentryHasConcreteTrigger(
    {
      events: [make(
        "Polish Counteroffensive Retakes Forward Positions",
        "Polish forces launch a counteroffensive, repulse Russian units and regain ground after exploiting an overextended sector.",
      )],
      warUpdates: "",
      relationUpdates: "",
      agreementUpdates: "",
    },
    [0],
    deferredPrior,
    { ...deferredPrior, pressure: 82, momentum: 34 },
  );

  cases.push({
    name: "material endogenous offensive can reactivate deferred storyline",
    pass: endogenousDeferredReentry === true,
    kept: endogenousDeferredReentry ? 1 : 0,
    dropped: "",
    stripped: "",
  });

  const longSilenceCandidate = {
    events: [],
    storylineUpdates: "",
    diplomaticOutreach: [],
    warUpdates: "",
    relationUpdates: "",
    agreementUpdates: "",
    summary: "",
  };

  const longSilenceFirst = validateWorldExplorationAudit(
    longSilenceCandidate,
    {
      explorationSlate: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
      ],
      visibleSilenceDays: 75,
    },
    { finalAttempt: false },
  );

  const longSilenceFinal = validateWorldExplorationAudit(
    longSilenceCandidate,
    {
      explorationSlate: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
      ],
      visibleSilenceDays: 75,
    },
    { finalAttempt: true },
  );

  cases.push({
    name: "long silence forces one re-check but final quiet is legal",
    pass: Boolean(longSilenceFirst) && !longSilenceFinal,
    kept: "",
    dropped:
      Boolean(longSilenceFirst) && !longSilenceFinal
        ? "RETRY_THEN_ACCEPT"
        : (longSilenceFirst || longSilenceFinal || ""),
    stripped: "",
  });

  const auditAttributionMismatch = validateWorldExplorationAudit(
    {
      events: [
        make(
          "Russian Cabinet Reviews Railway Finance",
          "Russian ministers approve a railway financing package after a domestic cabinet review.",
        ),
      ],
      storylineUpdates: "",
      diplomaticOutreach: [],
      warUpdates: "",
      relationUpdates: "",
      agreementUpdates: "",
      summary: "",
    },
    {
      explorationSlate: [
        { id: 1, actor: "Austria-Hungary", type: "actor-domain" },
        { id: 2, actor: "German Empire", type: "actor-domain" },
        { id: 3, actor: "Cross-border system", type: "global" },
        { id: 4, actor: "Wider world", type: "global" },
      ],
      visibleSilenceDays: 10,
    },
    { finalAttempt: false, world, gameCountry: game.country },
  );

  cases.push({
    name: "native exploration derivation ignores absent model audit bookkeeping",
    pass: auditAttributionMismatch === "",
    kept: 1,
    dropped: auditAttributionMismatch || "",
    stripped: "",
  });

  const aliasSlate = buildNativeWorldExplorationSlate({
    bundle: {
      game: { country: "German Empire", gameDate: "1916-04-12", round: 54 },
      world: {
        polityOverrides: {
          "Austrian Empire": {
            code: "Austrian Empire",
            name: "Austria-Hungary",
            aliases: ["Austrian Empire", "Austria-Hungary"],
          },
        },
        countryStats: {
          "Austrian Empire": {},
        },
        wars: [],
        relations: [],
        agreements: [],
        storylines: [],
      },
    },
    allStorylines: [],
    selectedStorylines: [],
    diplomaticActors: ["Austrian Empire", "Austria-Hungary"],
  });

  const aliasActors = aliasSlate
    .filter((slot) => slot.type === "actor-domain")
    .map((slot) => normalizeString(slot.actor));

  cases.push({
    name: "exploration actor aliases collapse to one polity",
    pass:
      aliasActors.filter((actor) => actor === "Austria-Hungary").length <= 1 &&
      !aliasActors.includes("Austrian Empire"),
    kept: aliasActors.join(", "),
    dropped: "",
    stripped: "",
  });

  const ghostSlate = buildNativeWorldExplorationSlate({
    bundle: {
      game: { country: "German Empire", gameDate: "1916-04-12", round: 54 },
      world: {
        polityOverrides: {
          "Protectorate Bohemia-Moravia": {
            code: "Protectorate Bohemia-Moravia",
            name: "Protectorate Bohemia-Moravia",
            aliases: [],
          },
        },
        countryStats: {
          "Protectorate Bohemia-Moravia": {},
        },
        wars: [
          {
            id: "test-war",
            status: "active",
            sideA: ["Poland"],
            sideB: ["Russian Empire"],
          },
        ],
        relations: [],
        agreements: [],
        storylines: [],
        units: [],
      },
    },
    allStorylines: [],
    selectedStorylines: [],
    diplomaticActors: ["British Empire"],
    causalCandidates: [],
  });

  const ghostActors = ghostSlate
    .filter((slot) => slot.type === "actor-domain")
    .map((slot) => normalizeString(slot.actor));

  cases.push({
    name: "passive catalog ghost cannot consume exploration slot",
    pass:
      !ghostActors.includes("Protectorate Bohemia-Moravia") &&
      ghostActors.includes("British Empire") &&
      ghostActors.includes("Poland") &&
      ghostActors.includes("Russian Empire"),
    kept: ghostActors.join(", "),
    dropped: "",
    stripped: "",
  });

  const passed = cases.every((entry) => entry.pass);

  console.table(cases);
  console.info(
    `[OH Native World Integrity self-test] ` +
    `${passed ? "PASS" : "FAIL"} — ` +
    `${cases.filter((entry) => entry.pass).length}/${cases.length}`,
  );

  return { passed, cases };
};

const installDebugApi = () => {
  if (typeof globalThis === "undefined") return;

  globalThis.__OH_NATIVE_WORLD_INTEGRITY__ = {
    version: WORLD_INTEGRITY_VERSION,
    selfTest: () => runWorldIntegritySelfTests(),
  };
};

installDebugApi();
