// OpenHistoria Continuum — Native World Integrity v0.8.6-native-audit
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

export const WORLD_INTEGRITY_VERSION = "0.8.6-native-audit";

const EXPLORATION_ACTOR_SLOTS = 6;
const EXPLORATION_GLOBAL_SLOTS = 2;

const EXPLORATION_DOMAINS = Object.freeze([
  "diplomacy / foreign policy / commercial relations",
  "domestic politics / institutions / leadership pressures",
  "economy / industry / trade / finance",
  "society / labour / public order / reform",
  "science / technology / infrastructure / communications",
  "military readiness / doctrine / procurement (not routine battlefield continuation)",
  "regional / colonial / minority governance where applicable",
  "third-party reaction to wars, crises, treaties, and balance-of-power changes",
]);

const WORLD_SWEEP_AUDIT_RE = /\[\[WORLD_SWEEP:([^\]]*)\]\]/i;

const ROUTINE_MILITARY_CUE_RE =
  /\b(skirmish(?:es)?|reconnaissance|patrol(?:s|ling)?|prob(?:e|es|ing)|artillery(?:\s+(?:fire|exchange|exchanges|bombardment|bombardments))?|counter[- ]battery|sporadic\s+(?:fire|clashes|fighting)|trench\s+(?:raid|raids)|outpost\s+(?:clash|clashes)|localized\s+(?:fighting|clashes|attacks?))\b/i;

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

    records.push({
      canonical,
      aliases: expandedAliases,
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
    });
  }

  return [...byCanonical.values()];
};

export const canonicalWorldActor = (actor, world, gameCountry = "") => {
  const raw = normalizeString(actor);
  if (!raw) return "";

  const key = raw.toLowerCase();
  const record = polityAliasRecords(world, gameCountry).find((entry) =>
    entry.canonical.toLowerCase() === key ||
    normalizeArray(entry.aliases).some((alias) =>
      normalizeString(alias).toLowerCase() === key
    )
  );

  return normalizeString(record?.canonical) || raw;
};

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

    if (!deferredUpdateHasObjectiveDelta(prior, update)) return false;

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
  const weighted = [];

  const add = (actor, weight = 1, reason = "") => {
    const text = canonicalWorldActor(actor, world, gameCountry);
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

  for (const owner of Object.values(world?.regionOwnershipOverrides || {})) {
    add(owner, 6, "current de-facto territorial state");
  }
  for (const owner of Object.values(world?.regionSovereigntyOverrides || {})) {
    add(owner, 6, "current legal territorial state");
  }
  for (const claimants of Object.values(world?.regionClaimants || {})) {
    for (const actor of normalizeArray(claimants)) {
      add(actor, 6, "current territorial claim/contest");
    }
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
    for (const actor of mentionedPolities(text, world, gameCountry)) {
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

export const buildNativeWorldExplorationSlate = ({
  bundle,
  allStorylines = [],
  selectedStorylines = [],
  diplomaticActors = [],
  causalCandidates = [],
} = {}) => {
  const actorRows = actorPoolForExploration(
    bundle,
    diplomaticActors,
    causalCandidates,
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

  const deferred = normalizeArray(allStorylines)
    .filter((storyline) =>
      normalizeString(storyline?.status).toLowerCase() !== "resolved" &&
      !selectedIds.has(normalizeString(storyline?.id))
    );

  // Relevance comes first. Rotation is only a tie-break inside similarly
  // evidence-backed actors; it must never promote a catalog ghost over a
  // polity with an active war, treaty, relation, unit, territory, or current signal.
  const rankedActors = [...actorRows].sort((a, b) =>
    (b.weight - a.weight) ||
    (
      stableHash(`${seed}|${a.actor}`) -
      stableHash(`${seed}|${b.actor}`)
    ) ||
    a.actor.localeCompare(b.actor)
  );

  const actorSlots = rankedActors
    .slice(0, EXPLORATION_ACTOR_SLOTS)
    .map((row, index) => {
      const actor = row.actor;
      const domain =
        EXPLORATION_DOMAINS[(seed + index * 3) % EXPLORATION_DOMAINS.length];

      const deferredTopics = deferred
        .filter((storyline) =>
          normalizeArray(storyline?.participants)
            .some((participant) =>
              worldActorsEquivalent(
                actor,
                participant,
                bundle?.world || {},
                normalizeString(bundle?.game?.country),
              )
            )
        )
        .slice(0, 3)
        .map((storyline) => normalizeString(storyline?.title))
        .filter(Boolean);

      const candidateEvidence = normalizeArray(causalCandidates)
        .filter((candidate) =>
          actorMentionedInText(
            actor,
            `${normalizeString(candidate?.title)} ${normalizeString(candidate?.detail)}`,
            bundle?.world || {},
            normalizeString(bundle?.game?.country),
          )
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
        type: "actor-domain",
      };
    });

  const globalBase = actorSlots.length;

  const globalSlots = [
    {
      id: globalBase + 1,
      actor: "Cross-border system",
      domain:
        "new diplomacy, mediation, alignment, trade, alliance, or third-party reaction not already represented by a deferred storyline",
      deferredTopics: [],
      basis: "scan current wars, treaties, relations, territorial pressures, and foreign interests for a new cross-border consequence",
      relevance: 0,
      type: "global",
    },
    {
      id: globalBase + 2,
      actor: "Wider world",
      domain:
        "new technology, industry, infrastructure, social movement, institutional change, or regional pressure capable of starting a genuinely new process",
      deferredTopics: [],
      basis: "use the current map/canon and surviving structural conditions; do not resurrect dormant or future polities from memorized history",
      relevance: 0,
      type: "global",
    },
  ].slice(0, EXPLORATION_GLOBAL_SLOTS);

  return [...actorSlots, ...globalSlots];
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

    if (/diplom|mediat|align|trade|alliance|cross-border|third-party/.test(domain)) {
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

export const screenGeneratedWorldEvents = ({
  events = [],
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

    kept.push(event);
  }

  const result = {
    events: kept,
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
      `kept ${kept.length}/${normalizeArray(events).length} generated event(s); ` +
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
