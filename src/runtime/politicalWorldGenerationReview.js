/*! Open Historia — Political World generation review/apply contract (Phase006C) */

import {
  POLITICAL_GENERATION_DEPTHS,
  POLITICAL_GENERATION_SOURCES,
  validatePoliticalGenerationProposal,
} from "./politicalWorldGeneration.js";
import {
  normalizePoliticalActors,
  POLITICAL_ACTORS_SCHEMA_VERSION,
} from "./politicalActors.js";
import {
  collectScenarioPoliticalPolities,
  createScenarioPolityResolver,
} from "./scenarioPolities.js";
import {
  buildRoundZeroCanonContext,
  buildRoundZeroCanonContextText,
} from "./roundZeroCanonContext.js";
import {
  isFeatureEnabled,
  normalizeFeatureSettings,
} from "../../server/gameFeatures.js";
import { normalizeGameDate } from "./gameDates.js";

export { collectScenarioPoliticalPolities } from "./scenarioPolities.js";

export const POLITICAL_WORLD_REVIEW_SCHEMA_VERSION = 1;
export const POLITICAL_GENERATION_PROVENANCE_SCHEMA_VERSION = 1;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export const POLITICAL_WORLD_GENERATION_MODES = Object.freeze({
  BASIC: "basic",
  BALANCED: "balanced",
  SIMULATION_READY: "simulation-ready",
});

export const POLITICAL_WORLD_GENERATION_TEST_TARGETS = Object.freeze([
  ["Republic of Poland", "Poland"],
  ["Russian Federation", "Russia"],
  ["People's Republic of China", "China", "PRC"],
  ["Democratic People's Republic of Korea", "North Korea", "DPRK"],
  ["Ethiopia"],
  ["Republic of Equatorial Guinea", "Equatorial Guinea"],
  ["Republic of South Sudan", "South Sudan"],
  ["Republic of Azerbaijan", "Azerbaijan"],
  ["Kingdom of Saudi Arabia", "Saudi Arabia"],
  ["Islamic Republic of Iran", "Iran"],
  ["Kingdom of Thailand", "Thailand"],
  ["Republic of Malawi", "Malawi"],
  ["Republic of Malta", "Malta"],
  ["Kyrgyz Republic", "Kyrgyzstan"],
  ["Republic of Djibouti", "Djibouti"],
]);

const polityAliasResolver = createScenarioPolityResolver;

const activeBelligerents = (world, resolve) => {
  const out = new Set();
  for (const war of Array.isArray(world?.wars) ? world.wars : []) {
    if (clean(war?.status).toLocaleLowerCase() !== "active") continue;
    for (const side of [war?.sideA, war?.sideB]) {
      for (const rawPolity of Array.isArray(side) ? side : []) {
        const polity = resolve(rawPolity);
        if (polity) out.add(polity);
      }
    }
  }
  return out;
};

const activePuppetParticipants = (world, resolve, enabled = true) => {
  const out = new Set();
  if (!enabled) return out;
  for (const row of Array.isArray(world?.puppets) ? world.puppets : []) {
    if (clean(row?.status || "active").toLocaleLowerCase() !== "active") continue;
    const overlord = resolve(row?.overlord);
    const puppet = resolve(row?.puppet);
    if (overlord) out.add(overlord);
    if (puppet) out.add(puppet);
  }
  return out;
};

export const buildScenarioPoliticalRelevance = ({
  world = {},
  playerPolity = "",
  mode = POLITICAL_WORLD_GENERATION_MODES.BALANCED,
  puppetStates = true,
} = {}) => {
  const resolve = polityAliasResolver(world);
  const player = resolve(playerPolity);
  const belligerents = activeBelligerents(world, resolve);
  const puppetParticipants = activePuppetParticipants(world, resolve, puppetStates);
  const existingActors = new Set(Object.keys(world?.politicalActors?.byPolity ?? {}).map(resolve).filter(Boolean));
  const relevanceByPolity = {};

  for (const polity of collectScenarioPoliticalPolities(world)) {
    const key = polity.polityKey;
    if (key === player || belligerents.has(key)) {
      relevanceByPolity[key] = { depth: POLITICAL_GENERATION_DEPTHS.FULL };
      continue;
    }
    if (mode === POLITICAL_WORLD_GENERATION_MODES.SIMULATION_READY) {
      relevanceByPolity[key] = {
        depth: polity.sovereign === false ? POLITICAL_GENERATION_DEPTHS.MINIMAL : POLITICAL_GENERATION_DEPTHS.RICH,
      };
      continue;
    }
    if (mode === POLITICAL_WORLD_GENERATION_MODES.BALANCED && (existingActors.has(key) || puppetParticipants.has(key))) {
      relevanceByPolity[key] = { depth: POLITICAL_GENERATION_DEPTHS.RICH };
      continue;
    }
    relevanceByPolity[key] = {
      depth: polity.sovereign === false ? POLITICAL_GENERATION_DEPTHS.MINIMAL : POLITICAL_GENERATION_DEPTHS.STANDARD,
    };
  }
  return relevanceByPolity;
};

const scenarioDateFromDetails = (details) => {
  const game = details?.data?.game ?? {};
  return normalizeGameDate(clean(game.startDate || game.gameDate));
};

const roundZeroContextFromDetails = (details) => {
  const scenario = details?.scenario ?? {};
  const world = details?.data?.world ?? {};
  const game = details?.data?.game ?? {};
  const events = details?.data?.events ?? [];
  return buildRoundZeroCanonContext({ scenario, world, game, events });
};

const scenarioContextFromDetails = (details) => {
  const scenario = details?.scenario ?? {};
  const world = details?.data?.world ?? {};
  const game = details?.data?.game ?? {};
  const events = details?.data?.events ?? [];
  return buildRoundZeroCanonContextText({ scenario, world, game, events }, { maxChars: 9000 });
};

const polityContextByKey = (world, polities) => {
  const out = {};
  for (const polity of polities) {
    const override = world?.polityOverrides?.[polity.polityKey];
    if (!isPlainObject(override)) continue;
    const context = {
      name: clean(override.name || polity.polityKey),
      ...(Array.isArray(override.aliases) && override.aliases.length ? { aliases: override.aliases.slice(0, 16) } : {}),
      ...(clean(override.status) ? { status: clean(override.status) } : {}),
      ...(clean(override.note) ? { scenarioNote: clean(override.note) } : {}),
    };
    out[polity.polityKey] = context;
  }
  return out;
};

const politicalTestToken = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "");

export const selectPoliticalGenerationTestPolities = (polities = [], count = 15) => {
  const limit = Math.max(1, Math.min(15, Math.trunc(Number(count)) || 15));
  const available = Array.isArray(polities) ? polities.filter((entry) => entry?.active !== false) : [];
  const byToken = new Map();
  for (const polity of available) {
    const key = politicalTestToken(polity?.polityKey);
    if (key && !byToken.has(key)) byToken.set(key, polity);
  }
  const selected = [];
  const seen = new Set();
  for (const aliases of POLITICAL_WORLD_GENERATION_TEST_TARGETS) {
    const match = aliases.map(politicalTestToken).map((token) => byToken.get(token)).find(Boolean);
    if (!match || seen.has(match.polityKey)) continue;
    seen.add(match.polityKey);
    selected.push(match);
    if (selected.length >= limit) return selected;
  }
  for (const polity of available) {
    if (seen.has(polity.polityKey)) continue;
    seen.add(polity.polityKey);
    selected.push(polity);
    if (selected.length >= limit) break;
  }
  return selected;
};

export const buildScenarioPoliticalGenerationInputs = (details, {
  mode = POLITICAL_WORLD_GENERATION_MODES.BALANCED,
  maxBatchSize = 8,
} = {}) => {
  const world = details?.data?.world ?? {};
  const game = details?.data?.game ?? {};
  const scenarioFeatures = normalizeFeatureSettings(details?.scenario?.features);
  const polities = collectScenarioPoliticalPolities(world).filter((entry) => entry.active !== false);
  const roundZeroContext = roundZeroContextFromDetails(details);
  return {
    scenarioDate: scenarioDateFromDetails(details),
    polities,
    politicalActors: normalizePoliticalActors(world.politicalActors),
    world,
    historyAuthority: roundZeroContext.historyAuthority,
    roundZeroContext,
    relevanceByPolity: buildScenarioPoliticalRelevance({
      world,
      playerPolity: game.country,
      mode,
      puppetStates: isFeatureEnabled(scenarioFeatures, "puppetStates"),
    }),
    scenarioContext: scenarioContextFromDetails(details),
    contextByPolity: polityContextByKey(world, polities),
    maxBatchSize,
    // Normal Scenario Editor generation should establish a missing Round-Zero
    // numeric landscape before optional RICH/FULL enrichment on already-existing
    // actors. This keeps applied-world migrations on the lightweight 48-polity
    // transport. Fixed stress tests override this to exercise full enrichment.
    prioritizeQuantitativeLandscapeBackfill: true,
  };
};

export const buildScenarioPoliticalGenerationTestInputs = (details, {
  maxBatchSize = 5,
  count = 15,
} = {}) => {
  const base = buildScenarioPoliticalGenerationInputs(details, {
    mode: POLITICAL_WORLD_GENERATION_MODES.SIMULATION_READY,
    maxBatchSize,
  });
  const polities = selectPoliticalGenerationTestPolities(base.polities, count);
  const relevanceByPolity = Object.fromEntries(polities.map((entry) => [entry.polityKey, { depth: POLITICAL_GENERATION_DEPTHS.RICH }]));
  const contextByPolity = Object.fromEntries(polities
    .filter((entry) => base.contextByPolity?.[entry.polityKey] !== undefined)
    .map((entry) => [entry.polityKey, base.contextByPolity[entry.polityKey]]));
  return {
    ...base,
    polities,
    relevanceByPolity,
    contextByPolity,
    maxBatchSize: Math.max(1, Math.min(5, Math.trunc(Number(maxBatchSize)) || 5)),
    prioritizeQuantitativeLandscapeBackfill: false,
    testMode: true,
  };
};

const provenanceRecord = (validation) => ({
  source: POLITICAL_GENERATION_SOURCES.GENERATED,
  scenarioDate: clean(validation?.provenance?.scenarioDate),
  depth: clean(validation?.provenance?.depth),
  confidence: clean(validation?.provenance?.confidence) || "unknown",
  ...(clean(validation?.provenance?.generatedAt) ? { generatedAt: clean(validation.provenance.generatedAt) } : {}),
  ...(clean(validation?.provenance?.sourceAsOf) ? { sourceAsOf: clean(validation.provenance.sourceAsOf) } : {}),
});

const attachGenerationProvenance = (actor, validation) => {
  const next = clone(actor) ?? {};
  const current = isPlainObject(next.generationProvenance) ? clone(next.generationProvenance) : {};
  const byPath = isPlainObject(current.byPath) ? current.byPath : {};
  const record = provenanceRecord(validation);
  for (const path of validation?.appliedPaths ?? []) {
    const key = clean(path);
    if (key) byPath[key] = record;
  }
  next.generationProvenance = {
    ...current,
    schemaVersion: POLITICAL_GENERATION_PROVENANCE_SCHEMA_VERSION,
    byPath,
    lastAppliedAt: clean(validation?.provenance?.generatedAt) || current.lastAppliedAt || "",
  };
  return next;
};

export const applyReviewedPoliticalGeneration = ({
  politicalActors,
  scenarioDate,
  reviews = [],
} = {}) => {
  const normalized = normalizePoliticalActors(politicalActors);
  const validations = [];
  const errors = [];

  for (const review of reviews) {
    if (review?.selected === false) continue;
    const polityKey = clean(review?.proposal?.polityKey);
    if (!polityKey) {
      errors.push({ polityKey: "", errors: ["Review proposal is missing polityKey"] });
      continue;
    }
    const proposal = {
      ...clone(review.proposal),
      actorPatch: clone(review.actorPatch ?? review.proposal?.actorPatch),
    };
    const validation = validatePoliticalGenerationProposal(proposal, {
      polityKey,
      scenarioDate,
      depth: proposal.depth,
      existingActor: normalized.byPolity[polityKey] ?? null,
      allowEntityExpansion: review.allowEntityExpansion === true,
      fillEmptyGovernmentPartyRefs: review.fillEmptyGovernmentPartyRefs === true,
      fillSparseActorPlaceholders: review.fillSparseActorPlaceholders === true,
    });
    if (!validation.ok) {
      errors.push({ polityKey, errors: [...validation.errors] });
      continue;
    }
    validations.push({ polityKey, validation });
  }

  if (errors.length) {
    return {
      ok: false,
      errors,
      politicalActors: normalized,
      applied: [],
    };
  }

  const next = {
    schemaVersion: POLITICAL_ACTORS_SCHEMA_VERSION,
    byPolity: { ...normalized.byPolity },
  };
  const applied = [];
  for (const { polityKey, validation } of validations) {
    if (!validation.appliedPaths.length) continue;
    next.byPolity[polityKey] = attachGenerationProvenance(validation.actor, validation);
    applied.push({
      polityKey,
      appliedPaths: [...validation.appliedPaths],
      provenance: clone(validation.provenance),
    });
  }

  return {
    ok: true,
    errors: [],
    politicalActors: next,
    applied,
  };
};
