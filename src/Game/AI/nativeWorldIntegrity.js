import { resolveStockCountryCode } from "../../runtime/polityIdentity.js";
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

export const WORLD_INTEGRITY_VERSION = "0.13.1-crisis-seam-repair";

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

const parseIsoDate = (value) => {
  const text = normalizeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
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
    .filter((date) => parseIsoDate(date) != null && (!originDate || date <= originDate))
    .sort()
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
    "regionControlOps",
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
  const weighted = [];

  const add = (actor, weight = 1, reason = "") => {
    const text = actorResolver.canonical(actor);
    if (!text) return;
    weighted.push({
      actor: text,
      weight: Math.max(0, Number(weight) || 0),
      reason: normalizeString(reason),
    });
  };

  // Named exploration slots must be earned by CURRENT campaign evidence.
  // The previous implementation added every alias/stat entry in the save,
  // which turned the world sweep into a tour of tiny states, dormant regimes,
  // and future/historical catalog identities.
  add(gameCountry, 5, "player polity / autonomous domestic life");

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
          ? "cross-border reaction, domestic spillover, regional security, diplomacy, political pressure, economic shock, social response, or a NEW latent problem inside the player's current causal sphere that is not merely another routine update to a selected storyline"
          : EXPLORATION_DOMAINS[(seed + 17 + index * 5) % EXPLORATION_DOMAINS.length],
      deferredTopics: [],
      basis:
        "same-scope balance filler: local actors already receiving selected-storyline attention remain excluded from independent actor slots; inspect independent regional/system consequences rather than borrowing a wider-world actor or servicing the selected storyline again",
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
    return { events: source, dropped: [] };
  }

  const recentLowCount = normalizeArray(priorEvents)
    .slice(-LOW_TRAJECTORY_RECENT_WINDOW)
    .filter(lowTrajectoryInstitutionalEvent)
    .length;

  const cap = recentLowCount >= LOW_TRAJECTORY_RECENT_SATURATION ? 1 : 2;
  if (currentLow.length <= cap) return { events: source, dropped: [] };

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
      String(a.event?.date || "").localeCompare(String(b.event?.date || "")) ||
      a.index - b.index
    );

  const keepIndexes = new Set(ranked.slice(0, cap).map((row) => row.index));
  const lowIndexes = new Set(currentLow.map((row) => row.index));
  const dropped = [];
  const kept = [];

  source.forEach((event, index) => {
    if (!lowIndexes.has(index) || keepIndexes.has(index)) {
      kept.push(event);
      return;
    }
    dropped.push({
      id: normalizeString(event?.id),
      title: normalizeString(event?.title),
      route: "LOW_TRAJECTORY_FEED_SATURATION",
      reason:
        `low-trajectory institutional/process card suppressed because this batch contained ${currentLow.length} such cards` +
        (recentLowCount >= LOW_TRAJECTORY_RECENT_SATURATION
          ? ` and ${recentLowCount}/${LOW_TRAJECTORY_RECENT_WINDOW} recent cards were already the same low-branch texture`
          : ""),
    });
  });

  return { events: kept, dropped };
};

export const screenGeneratedWorldEvents = ({
  events = [],
  priorEvents = [],
  world = {},
  game = {},
  analysis = null,
} = {}) => {
  const kept = [];
  const dropped = [];
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

    const event = controlSanitized.event;

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
      dropped.push({
        id: normalizeString(event?.id),
        title: normalizeString(event?.title),
        route: "ROUTINE_MILITARY_PRECURATION",
        reason: routineReason,
      });
      continue;
    }

    const administrativeReason = routineAdministrativeNoDeltaReason(event);
    if (administrativeReason) {
      dropped.push({
        id: normalizeString(event?.id),
        title: normalizeString(event?.title),
        route: "ROUTINE_ADMINISTRATIVE_PROCESS",
        reason: administrativeReason,
      });
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

  const result = {
    events: feedGuard.events,
    dropped,
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
      `stripped ${strippedNoOpRegionControlOps} no-op control op(s).`,
      result,
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
