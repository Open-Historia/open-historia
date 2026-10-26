import fs from "node:fs";
import path from "node:path";

const IDB_NAME = "oh-political-world-v2";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const trim = (value) => String(value ?? "").trim();
const array = (value) => (Array.isArray(value) ? value : []);
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
};

const readJsonFile = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

const createFileIndexedDb = (root) => {
  const databases = new Map();
  const later = (work) => setImmediate(work);
  const copy = (value) => (value === undefined ? undefined : structuredClone(value));
  const safe = (value) => String(value).replace(/[^a-z0-9._-]+/gi, "_");
  const dirOf = (name) => path.join(root, safe(name));
  const load = (name) => {
    if (databases.has(name)) return databases.get(name);
    const meta = readJsonFile(path.join(dirOf(name), "meta.json"), { version: 0, stores: {} });
    const stores = new Map();
    for (const [storeName, keyPath] of Object.entries(meta?.stores ?? {})) {
      const saved = readJsonFile(path.join(dirOf(name), `${safe(storeName)}.json`), {});
      stores.set(storeName, { keyPath, rows: new Map(Object.entries(saved && typeof saved === "object" ? saved : {})) });
    }
    const database = { name, version: Number(meta?.version) || 0, stores };
    databases.set(name, database);
    return database;
  };
  const saveMeta = (database) => writeAtomic(path.join(dirOf(database.name), "meta.json"), JSON.stringify({
    version: database.version,
    stores: Object.fromEntries([...database.stores].map(([storeName, store]) => [storeName, store.keyPath])),
  }));
  const saveStore = (database, storeName) => writeAtomic(
    path.join(dirOf(database.name), `${safe(storeName)}.json`),
    JSON.stringify(Object.fromEntries(database.stores.get(storeName).rows)),
  );
  const handleOf = (database) => ({
    objectStoreNames: { contains: (storeName) => database.stores.has(storeName) },
    createObjectStore: (storeName, { keyPath } = {}) => {
      database.stores.set(storeName, { keyPath, rows: new Map() });
      saveMeta(database);
      saveStore(database, storeName);
      return {};
    },
    close: () => {},
    transaction: (storeNames) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const storeName of names) {
        if (!database.stores.has(storeName)) throw new Error(`NotFoundError: no object store "${storeName}"`);
      }
      const transaction = { oncomplete: null, onerror: null, onabort: null, error: null };
      const dirty = new Set();
      let scheduled = false;
      const settle = () => {
        if (scheduled) return;
        scheduled = true;
        later(() => {
          try {
            for (const storeName of dirty) saveStore(database, storeName);
          } catch (error) {
            transaction.error = error;
            transaction.onerror?.({ target: transaction });
            transaction.onabort?.({ target: transaction });
            return;
          }
          transaction.oncomplete?.({ target: transaction });
        });
      };
      transaction.objectStore = (storeName) => {
        const store = database.stores.get(storeName);
        const request = (result) => {
          const entry = { result, error: null, onsuccess: null, onerror: null };
          later(() => entry.onsuccess?.({ target: entry }));
          settle();
          return entry;
        };
        return {
          get: (key) => request(copy(store.rows.get(String(key)))),
          getAll: () => request([...store.rows.values()].map(copy)),
          getAllKeys: () => request([...store.rows.keys()]),
          put: (value) => {
            const key = String(value?.[store.keyPath]);
            store.rows.set(key, copy(value));
            dirty.add(storeName);
            return request(key);
          },
          delete: (key) => {
            store.rows.delete(String(key));
            dirty.add(storeName);
            return request(undefined);
          },
        };
      };
      settle();
      return transaction;
    },
  });
  return {
    open: (name, version = 1) => {
      const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        if (name !== IDB_NAME) {
          request.error = new Error(`The native app keeps no ${name} database.`);
          request.onerror?.({ target: request });
          return;
        }
        try {
          const database = load(name);
          request.result = handleOf(database);
          if (database.version < Number(version || 1)) {
            const oldVersion = database.version;
            database.version = Number(version || 1);
            request.onupgradeneeded?.({ target: request, oldVersion, newVersion: database.version });
            saveMeta(database);
          }
          request.onsuccess?.({ target: request });
        } catch (error) {
          request.error = error;
          request.onerror?.({ target: request });
        }
      });
      return request;
    },
  };
};

const normalizeProgressSampleError = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    const message = clean(value);
    return message ? { polityKey: "", errors: [message] } : null;
  }
  if (typeof value !== "object") return null;
  const polityKey = clean(value.polityKey);
  const errors = (Array.isArray(value.errors) ? value.errors : [value.issue])
    .map(clean)
    .filter(Boolean);
  if (!polityKey && errors.length === 0) return null;
  return { polityKey, errors };
};

const formatDuration = (milliseconds) => {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  if (!Number.isFinite(seconds)) return "Estimating…";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
};

const callsToFinish = (estimated) => (estimated > 0
  ? (estimated === 1 ? "About 1 more AI call to finish" : `About ${estimated} more AI calls to finish`)
  : "");

const aiRequestsUsed = (calls, ceiling) => `${calls === 1 ? "1 AI request used" : `${calls} AI requests used`}${ceiling ? ` · Safety limit: ${ceiling}` : ""}`;

const safeFileToken = (value) => clean(value)
  .replace(/[^a-z0-9._-]+/gi, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80) || "scenario";

const buildRows = (result, { allowRosterExpansion = false, selectValid = true } = {}) => {
  const rows = [];
  for (const entry of result?.proposals ?? []) {
    rows.push({
      polityKey: entry.item.polityKey,
      depth: entry.item.depth,
      needs: [...entry.item.needs],
      confidence: entry.validation?.provenance?.confidence ?? "unknown",
      selected: selectValid,
      allowEntityExpansion: allowRosterExpansion && entry.item.hasExistingActor === true,
      proposal: entry.proposal,
      actorPatchText: JSON.stringify(entry.proposal.actorPatch ?? {}, null, 2),
      sourceErrors: [],
      status: "valid",
    });
  }
  for (const failure of result?.failures ?? []) {
    rows.push({
      polityKey: failure.polityKey,
      depth: failure.depth,
      needs: [...(failure.needs ?? [])],
      confidence: "unknown",
      selected: false,
      allowEntityExpansion: false,
      proposal: null,
      actorPatchText: "",
      sourceErrors: [...(failure.errors ?? [])],
      status: "failed",
    });
  }
  return rows.sort((left, right) => left.polityKey.localeCompare(right.polityKey));
};

const restoreResultFromDiagnostic = (diagnostic, { scenarioId = "", scenarioDate = "" } = {}) => {
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    throw new Error("Run log is not a Political World diagnostic object.");
  }
  if (diagnostic.kind !== "political-world-generation-diagnostic" || Number(diagnostic.schemaVersion) !== 1) {
    throw new Error("Run log is not a supported Political World generation diagnostic.");
  }

  const loggedScenarioId = clean(diagnostic?.scenario?.id);
  const loggedScenarioDate = clean(diagnostic?.scenario?.scenarioDate);
  const currentScenarioId = clean(scenarioId);
  const currentScenarioDate = clean(scenarioDate);
  if (currentScenarioId && loggedScenarioId && loggedScenarioId !== currentScenarioId) {
    throw new Error(`Run log belongs to scenario ${loggedScenarioId}, not ${currentScenarioId}.`);
  }
  if (currentScenarioDate && loggedScenarioDate && loggedScenarioDate !== currentScenarioDate) {
    throw new Error(`Run log scenario date ${loggedScenarioDate} does not match current canonical date ${currentScenarioDate}.`);
  }

  const accepted = Array.isArray(diagnostic.acceptedProposals) ? diagnostic.acceptedProposals : [];
  const failures = Array.isArray(diagnostic.failures) ? diagnostic.failures : [];
  if (!accepted.length && !failures.length) {
    throw new Error("Run log contains no accepted proposals or failures to restore.");
  }

  const seen = new Set();
  const proposals = accepted.map((entry, index) => {
    const polityKey = clean(entry?.polityKey || entry?.proposal?.polityKey);
    const proposal = entry?.proposal;
    if (!polityKey || !proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
      throw new Error(`Run log proposal ${index + 1} is missing a valid polityKey/proposal.`);
    }
    if (seen.has(polityKey)) throw new Error(`Run log contains duplicate accepted proposal for ${polityKey}.`);
    seen.add(polityKey);
    if (clean(proposal.polityKey) && clean(proposal.polityKey) !== polityKey) {
      throw new Error(`Run log proposal key mismatch for ${polityKey}.`);
    }
    if (loggedScenarioDate && clean(proposal.scenarioDate) && clean(proposal.scenarioDate) !== loggedScenarioDate) {
      throw new Error(`Run log proposal ${polityKey} targets ${clean(proposal.scenarioDate)}, not ${loggedScenarioDate}.`);
    }
    const needs = Array.isArray(entry?.needs) ? entry.needs.map(clean).filter(Boolean) : [];
    const item = {
      polityKey,
      depth: clean(entry?.depth || proposal?.depth || "standard") || "standard",
      needs,
      hasExistingActor: false,
    };
    return {
      item,
      proposal,
      historicalVerification: entry?.historicalVerification ?? null,
      validation: {
        appliedPaths: Array.isArray(entry?.appliedPathsPreview) ? [...entry.appliedPathsPreview] : [],
        provenance: { confidence: clean(proposal?.provenance?.confidence || "unknown") || "unknown" },
      },
    };
  });

  for (const failure of failures) {
    const polityKey = clean(failure?.polityKey);
    if (polityKey && seen.has(polityKey)) throw new Error(`Run log lists ${polityKey} as both accepted and failed.`);
  }

  const runMode = clean(diagnostic?.run?.mode || "balanced") || "balanced";
  return {
    scenarioDate: loggedScenarioDate || currentScenarioDate,
    generatedAt: clean(diagnostic?.run?.generatedAt) || new Date().toISOString(),
    uiRunKind: runMode,
    plan: { items: proposals.map((entry) => entry.item) },
    proposals,
    failures,
    warnings: Array.isArray(diagnostic.warnings) ? [...diagnostic.warnings] : [],
    batches: Array.isArray(diagnostic.batches) ? [...diagnostic.batches] : [],
    diagnostics: Array.isArray(diagnostic.diagnostics) ? [...diagnostic.diagnostics] : [],
    historicalVerification: diagnostic.historicalVerification ?? null,
    generatedPolities: proposals.length,
    failedPolities: failures.length,
  };
};

const restorePipelineResultFromDiagnostic = (diagnostic, { scenarioId = "", scenarioDate = "" } = {}) => {
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    throw new Error("Run log is not a Political World pipeline diagnostic object.");
  }
  if (diagnostic.kind !== "political-world-pipeline-diagnostic" || Number(diagnostic.schemaVersion) !== 1) {
    throw new Error("Run log is not a supported Political World pipeline diagnostic.");
  }
  const loggedScenarioId = clean(diagnostic?.scenario?.id);
  const loggedScenarioDate = clean(diagnostic?.scenario?.scenarioDate);
  const currentScenarioId = clean(scenarioId);
  const currentScenarioDate = clean(scenarioDate);
  if (currentScenarioId && loggedScenarioId && loggedScenarioId !== currentScenarioId) {
    throw new Error(`Run log belongs to scenario ${loggedScenarioId}, not ${currentScenarioId}.`);
  }
  if (currentScenarioDate && loggedScenarioDate && loggedScenarioDate !== currentScenarioDate) {
    throw new Error(`Run log scenario date ${loggedScenarioDate} does not match current canonical date ${currentScenarioDate}.`);
  }

  const restoreStage = (stage, label) => {
    if (!stage) return null;
    const proposals = Array.isArray(stage.acceptedProposals) ? stage.acceptedProposals : [];
    const failures = Array.isArray(stage.failures) ? stage.failures : [];
    if (!proposals.length && !failures.length) throw new Error(`${label} run log contains no proposals or failures.`);
    return {
      scenarioDate: loggedScenarioDate || currentScenarioDate,
      generatedAt: clean(diagnostic?.run?.generatedAt) || new Date().toISOString(),
      plan: { items: proposals.map((entry) => entry?.item).filter(Boolean) },
      proposals,
      failures,
      warnings: Array.isArray(stage.warnings) ? [...stage.warnings] : [],
      batches: Array.isArray(stage.batches) ? [...stage.batches] : [],
      diagnostics: Array.isArray(stage.diagnostics) ? [...stage.diagnostics] : [],
      historicalVerification: stage.historicalVerification ?? null,
      governingAlignmentRepair: label === "Governing alignment" ? {
        requested: Number(stage.requested) || 0,
        nativeResolved: Number(stage.nativeResolved) || 0,
        modelRequested: Number(stage.modelRequested) || 0,
        modelResolved: Number(stage.modelResolved) || 0,
        nonPartisan: Number(stage.nonPartisan) || 0,
        modelCalls: Number(stage.modelCalls) || 0,
      } : undefined,
      generatedPolities: Number(stage.accepted) || proposals.length,
      failedPolities: Number(stage.failed) || failures.length,
    };
  };

  const politics = restoreStage(diagnostic.politics, "Political Actors");
  const governingAlignment = restoreStage(diagnostic.governingAlignment, "Governing alignment");
  const geo = diagnostic.geopolitics && !diagnostic.geopolitics.error ? diagnostic.geopolitics : null;
  const geopolitics = geo ? {
    schemaVersion: Number(geo.schemaVersion) || 2,
    scenarioDate: loggedScenarioDate || currentScenarioDate,
    generatedAt: clean(geo?.run?.generatedAt || diagnostic?.run?.generatedAt) || new Date().toISOString(),
    requestedPolities: Number(geo?.run?.requestedPolities) || 0,
    records: Array.isArray(geo.membershipRegimeProfiles) ? [...geo.membershipRegimeProfiles] : [],
    institutionCatalog: Array.isArray(geo.institutionCatalog) ? [...geo.institutionCatalog] : [],
    powerCalibration: Array.isArray(geo.powerCalibrationEvidence) ? [...geo.powerCalibrationEvidence] : [],
    agreements: Array.isArray(geo.agreements) ? [...geo.agreements] : [],
    warnings: Array.isArray(geo.warnings) ? [...geo.warnings] : [],
    diagnostics: Array.isArray(geo.diagnostics) ? [...geo.diagnostics] : [],
    blockingErrors: Array.isArray(geo.blockingErrors) ? [...geo.blockingErrors] : [],
    unresolvedMembershipPolities: Array.isArray(geo?.unresolvedBreakdown?.memberships) ? [...geo.unresolvedBreakdown.memberships] : [],
    unresolvedPowerPolities: Array.isArray(geo?.unresolvedBreakdown?.powerCalibration) ? [...geo.unresolvedBreakdown.powerCalibration] : [],
    modelCalls: Number(geo?.run?.modelCalls) || 0,
  } : null;

  if (!politics || politics.failedPolities) throw new Error("Combined run log does not contain a clean Political Actor stage to resume.");
  if (!governingAlignment || governingAlignment.failedPolities) throw new Error("Combined run log does not contain a clean governing-alignment stage to resume.");

  const blockingErrors = Array.isArray(diagnostic.blockingErrors) ? [...diagnostic.blockingErrors] : [];
  return {
    schemaVersion: 1,
    kind: "political-world-pipeline-result",
    scenarioDate: loggedScenarioDate || currentScenarioDate,
    generatedAt: clean(diagnostic?.run?.generatedAt) || new Date().toISOString(),
    allowEntityExpansion: diagnostic?.run?.allowEntityExpansion === true,
    politics,
    governingAlignment,
    geopolitics,
    blockingErrors,
    complete: diagnostic?.run?.complete === true && blockingErrors.length === 0,
    restoredFromDiagnostic: true,
  };
};

const PAUSES_FROM_PROVIDER = ["provider-quota", "provider-rate-limit", "provider-unavailable", "provider-config", "task-error", "storage-unavailable"];

const HEAVY_DATA = ["actions", "advisor", "chat", "events", "intercepts", "snapshots"];

const actorLabel = (world, polityKey) => clean(world?.polityOverrides?.[polityKey]?.name) || clean(polityKey) || "Unknown polity";
const representationLabel = (value) => clean(value).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
const kindLabel = (value) => String(value || "other")
  .replace(/_/g, " ")
  .replace(/\b\w/g, (char) => char.toUpperCase());

const proposalPolities = (text) => {
  const found = [];
  for (const match of String(text ?? "").matchAll(/^POLITY: (.+)$/gm)) {
    const key = clean(match[1]);
    if (key && !found.includes(key)) found.push(key);
  }
  return found;
};

const standInActorPatch = (polityKey) => ({
  politicalSystem: { type: "Parliamentary republic", representation: "electoral", regimeCharacter: "democratic" },
  government: {
    form: "Parliamentary republic",
    ideology: "Centrist coalition",
    status: "stable",
    headOfState: `President of ${polityKey}`,
    headOfGovernment: `Prime Minister of ${polityKey}`,
    rulingPartyIds: ["civic-union"],
    coalitionPartyIds: ["green-alliance"],
  },
  leader: `Prime Minister of ${polityKey}`,
  parties: [
    { id: "civic-union", name: "Civic Union", ideology: "Centre-right", support: { percent: 41 }, goals: ["Lower taxes"], politicalResponse: { summary: "Backs the government's budget line.", issues: { economy: { position: 30, sensitivity: 60, strainResponse: 10 } } } },
    { id: "social-front", name: "Social Front", ideology: "Centre-left", support: { percent: 34 }, goals: ["Higher wages"], politicalResponse: { summary: "Opposes spending cuts.", issues: { economy: { position: -30, sensitivity: 70, strainResponse: -20 } } } },
    { id: "green-alliance", name: "Green Alliance", ideology: "Green politics", support: { percent: 15 }, goals: ["Cleaner energy"], politicalResponse: { summary: "Trades support for climate pledges.", issues: { environment: { position: 60, sensitivity: 80, strainResponse: 0 } } } },
  ],
  goals: ["Keep the budget balanced", "Strengthen regional trade"],
  fears: ["A recession at home"],
  ambitions: ["A larger voice among its neighbours"],
  domesticPressures: ["Rising prices"],
  traits: { pragmatism: 62, caution: 55, opportunism: 38 },
});

export const register = (ctx) => {
  const { engine, emit, plain, dataRoot, addStandIn, standIn } = ctx;
  const lib = engine.library;
  const review = () => engine.polGenReview;
  const storage = () => engine.polV2Storage;
  const checkpoints = () => engine.polV2Checkpoint;
  const pipeline = () => engine.polV2Pipeline;
  const capability = () => engine.edPoliticalCapability;
  const normalizeGameDate = (value) => engine.gameDates.normalizeGameDate(value);

  const fileIdb = createFileIndexedDb(path.join(dataRoot, "native", "political-world"));
  let idbUsers = 0;
  let installed = null;
  const withIdb = async (work) => {
    if (idbUsers === 0 && typeof globalThis.indexedDB === "undefined") {
      globalThis.indexedDB = fileIdb;
      installed = fileIdb;
    }
    idbUsers += 1;
    try {
      return await work();
    } finally {
      idbUsers -= 1;
      if (idbUsers === 0 && installed && globalThis.indexedDB === installed) {
        delete globalThis.indexedDB;
        installed = null;
      }
    }
  };

  if (standIn) {
    addStandIn(({ tool, text }) => {
      if (tool === "submit_political_world_generation") {
        const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(String(text))?.[1] ?? "";
        return {
          args: {
            proposals: proposalPolities(text).slice(0, 12).map((polityKey) => ({
              polityKey,
              confidence: "moderate",
              sourceAsOf: date,
              referenceDates: [],
              actorPatchJson: JSON.stringify(standInActorPatch(polityKey)),
            })),
          },
        };
      }
      if (tool === "submit_political_world_historical_verification") {
        return {
          args: {
            verifications: proposalPolities(text).slice(0, 4).map((polityKey) => ({
              polityKey,
              verdict: "confirmed",
              confidence: "high",
              issue: "",
              correctionScopes: [],
              replaceRepresentationEntities: false,
              correctedIdentityJson: "",
            })),
          },
        };
      }
      if (tool === "submit_political_world_temporal_sentinel") {
        return {
          args: {
            checksJson: JSON.stringify(proposalPolities(text).map((polityKey) => ({
              polityKey,
              verdict: "clear",
              confidence: "high",
              issue: "",
              checkedFactIds: [],
              challengedFactIds: [],
            }))),
          },
        };
      }
      if (tool === "submit_political_governing_alignment_repair") {
        return {
          args: {
            alignments: proposalPolities(text).map((polityKey) => ({
              polityKey,
              confidence: "moderate",
              alignmentJson: JSON.stringify({ nonPartisan: true }),
            })),
          },
        };
      }
      return null;
    });
  }

  const detailsView = (details) => {
    const view = plain(details);
    if (view?.data && typeof view.data === "object") {
      for (const key of HEAVY_DATA) delete view.data[key];
    }
    return view;
  };

  const loadDetails = (scenarioId) => lib.loadScenarioDetails(clean(scenarioId));

  const MODES = () => review().POLITICAL_WORLD_GENERATION_MODES;
  const modeOptions = () => [
    {
      id: MODES().BALANCED,
      label: "Balanced",
      description: "The player's country and countries at war get full detail, countries that already have Political Actors or puppet ties get rich detail, and every other country gets standard detail.",
    },
    {
      id: MODES().SIMULATION_READY,
      label: "Simulation-ready",
      description: "The player's country and countries at war get full detail, and every other sovereign country gets rich detail so its politics can react during play. The AI's answers are the longest.",
    },
    {
      id: MODES().BASIC,
      label: "Basic",
      description: "The player's country and countries at war get full detail, and every other country gets standard detail, even one that already has Political Actors. The AI's answers are the shortest.",
    },
  ];

  const sessions = new Map();

  const freshSession = (scenarioId) => ({
    scenarioId: clean(scenarioId),
    mode: MODES().BALANCED,
    allowRosterExpansion: false,
    busy: false,
    applying: false,
    error: "",
    progress: "",
    progressInfo: null,
    result: null,
    rows: [],
    rowsVersion: 0,
    expandedPolity: "",
    lastApplied: null,
    runKind: "balanced",
    pipelineResult: null,
    v2Checkpoint: null,
    v2CallBudget: 20,
    scenarioTags: null,
    v2Persistence: null,
    details: null,
    inputs: null,
    testInputs: null,
    form: {},
    generationStartedAt: 0,
    progressPhase: "",
    callId: 0,
  });

  const sessionOf = (scenarioId) => {
    const key = clean(scenarioId);
    if (!sessions.has(key)) sessions.set(key, freshSession(key));
    return sessions.get(key);
  };

  const takeForm = (session, form) => {
    if (form && typeof form === "object") session.form = form;
  };

  const computeInputs = (session) => {
    try {
      session.inputs = review().buildScenarioPoliticalGenerationInputs(session.details, { mode: session.mode, maxBatchSize: 8, countryTags: session.scenarioTags });
    } catch {
      session.inputs = null;
    }
    try {
      session.testInputs = review().buildScenarioPoliticalGenerationTestInputs(session.details, { maxBatchSize: 5, count: 15 });
    } catch {
      session.testInputs = null;
    }
  };

  const loadCheckpointInto = (session) => withIdb(async () => {
    const scenarioId = clean(session.details?.scenario?.id);
    const scenarioDate = session.inputs?.scenarioDate ?? "";
    if (!scenarioId || !scenarioDate || !session.inputs?.world) {
      session.v2Checkpoint = null;
      return;
    }
    try {
      const checkpoint = await storage().loadPoliticalWorldV2Checkpoint(scenarioId, { scenarioDate });
      const fingerprint = checkpoints().buildPoliticalWorldInputFingerprint({
        scenarioId,
        scenarioDate,
        world: session.inputs.world,
        roundZeroContext: session.inputs.roundZeroContext || null,
      });
      let visibleCheckpoint = checkpoints().checkpointMatchesInput(checkpoint, fingerprint) ? checkpoint : null;
      if (!visibleCheckpoint && checkpoint) {
        const rebased = engine.polV2Rebase.rebasePoliticalWorldV2ReferenceCanon(checkpoint, session.inputs, fingerprint);
        if (rebased) visibleCheckpoint = await storage().savePoliticalWorldV2Checkpoint(rebased);
      }
      session.v2Checkpoint = visibleCheckpoint;
      if (visibleCheckpoint) {
        session.runKind = "political-world-v2";
        if (visibleCheckpoint?.pauseReason === "reference-canon-rebase") {
          session.progress = "Political World progress recovered. Scenario context changed; Continue Generation will refresh reference institutions without rebuilding completed political actors.";
        }
      }
    } catch {
      session.v2Checkpoint = null;
    }
  });

  const refreshSession = async (session) => {
    session.details = await loadDetails(session.scenarioId);
    session.scenarioTags = await lib.downloadScenarioJsonAsset(session.scenarioId, "tags").catch(() => null);
    computeInputs(session);
    await loadCheckpointInto(session);
  };

  const derived = (session) => {
    const inputs = session.inputs;
    const scenarioDate = inputs?.scenarioDate ?? "";
    const unsavedDateRaw = clean(session.form?.gameDate);
    const unsavedDate = normalizeGameDate(unsavedDateRaw) || unsavedDateRaw;
    const dateMismatch = Boolean(unsavedDate && scenarioDate && unsavedDate !== scenarioDate);
    const polityCount = inputs?.polities?.length ?? 0;
    const actorCount = Object.keys(inputs?.politicalActors?.byPolity ?? {}).length;
    const v2Checkpoint = session.v2Checkpoint;
    const pipelineBlocked = (session.pipelineResult?.blockingErrors?.length ?? 0) > 0;
    const pipelineReady = Boolean(session.pipelineResult?.complete && !pipelineBlocked);
    const v2Ready = Boolean(v2Checkpoint?.quality?.canonicalReady);
    const applyReady = session.runKind === "political-world-v2" ? v2Ready : pipelineReady;
    const v2Jobs = Object.values(v2Checkpoint?.jobs ?? {});
    const v2FailedJobs = Number(v2Checkpoint?.worklistSummary?.failed) || v2Jobs.filter((job) => job?.status === "failed").length;
    const v2Unresolved = Array.isArray(v2Checkpoint?.quality?.unresolved) ? v2Checkpoint.quality.unresolved : [];
    const v2PartiallyApplied = new Set((v2Checkpoint?.partialApplications ?? []).flatMap((entry) => entry?.polities ?? [])).size;
    const v2UnresolvedPolityKeys = [...new Set(v2Unresolved.map((entry) => clean(entry?.polityKey)).filter(Boolean))];
    const v2UnresolvedPolityCount = v2UnresolvedPolityKeys.length;
    const v2RetryPolityCount = v2UnresolvedPolityCount || v2FailedJobs;
    const v2NeedsRetry = Boolean(
      v2Checkpoint?.status === "paused"
        && v2Checkpoint?.pauseReason === "bounded-unresolved"
        && v2RetryPolityCount > 0,
    );
    const v2Counts = v2Checkpoint?.quality?.counts || {};
    const v2TotalPolities = Number(v2Counts.polities) || polityCount;
    const v2PolitiesReady = v2TotalPolities
      ? Math.max(0, Math.min(
        v2TotalPolities,
        Number(v2Counts.politicalActors) || 0,
        Number(v2Counts.memberships) || 0,
        Number(v2Counts.governingAlignment) || 0,
        Number(v2Counts.powerEvidence) || 0,
      ))
      : 0;
    return {
      scenarioDate, unsavedDate, dateMismatch, polityCount, actorCount, pipelineBlocked, pipelineReady, v2Ready, applyReady,
      v2PartiallyApplied, v2UnresolvedPolityKeys, v2UnresolvedPolityCount, v2RetryPolityCount, v2NeedsRetry, v2Counts, v2TotalPolities, v2PolitiesReady,
    };
  };

  const genView = (session, { withRows = false } = {}) => {
    const d = derived(session);
    const { busy, applying, runKind, progressInfo, v2Checkpoint, pipelineResult, result } = session;
    const cap = capability();
    const worldState = cap.politicalWorldCapability(session.inputs?.world ?? session.details?.data?.world ?? {}, { polityCount: d.polityCount });
    const absent = worldState.status === cap.POLITICAL_WORLD_CAPABILITY.ABSENT;
    const sparse = worldState.status === cap.POLITICAL_WORLD_CAPABILITY.SPARSE;
    const option = modeOptions().find((entry) => entry.id === session.mode);
    const view = {
      scenarioId: session.scenarioId,
      scenarioName: clean(session.details?.scenario?.name || session.details?.scenario?.id || "scenario"),
      status: cap.politicalWorldCapabilityLabel(worldState),
      tone: absent ? "absent" : sparse ? "sparse" : "ready",
      statusNote: absent
        ? "This scenario has no Political World yet. Politics-related systems will remain unavailable until you generate, review and apply one."
        : sparse
          ? `This scenario already has ${d.actorCount} Political Actor${d.actorCount === 1 ? "" : "s"}, but coverage is incomplete. Generation can fill the missing political world without replacing authored state.`
          : `This scenario already has a Political World with ${d.actorCount} Political Actor${d.actorCount === 1 ? "" : "s"}. You can regenerate missing pieces or use the repair tools below when needed.`,
      scenarioDate: d.scenarioDate,
      polityCount: d.polityCount,
      actorCount: d.actorCount,
      busy,
      applying,
      runKind,
      dateMismatch: d.dateMismatch,
      dateMismatchNote: d.dateMismatch
        ? `Save the Scenario Editor first: the visible date (${d.unsavedDate}) differs from the saved date (${d.scenarioDate}). Political World generation always uses saved scenario data.`
        : "",
      showGenerate: !d.v2Ready,
      generateLabel: busy && runKind === "political-world-v2" ? "Building Political World…" : (v2Checkpoint ? "Continue Generation" : "Generate Political World"),
      generateDisabled: busy || applying || d.dateMismatch,
      retryDeferred: d.v2NeedsRetry,
      applyLabel: applying ? "Applying to Scenario…" : "Apply to Scenario",
      applyDisabled: !d.applyReady || busy || applying || d.dateMismatch,
      showPause: busy,
      hint: busy && runKind === "political-world-v2"
        ? "Progress is saved as you go. You can pause and continue later."
        : d.v2NeedsRetry
          ? `${d.v2RetryPolityCount} ${d.v2RetryPolityCount === 1 ? "polity needs" : "polities need"} another attempt. Completed work is saved. Continue Generation retries only unfinished polities. You can close the editor and continue later.`
          : d.v2Ready
            ? "Generation is complete. Review the summary below, then apply it to the scenario."
            : v2Checkpoint
              ? "Completed work is saved. Continue Generation picks up unfinished work only. You can close the editor and come back later."
              : "Generation is staged for review and saves progress as it goes. Nothing is written to the scenario until Apply to Scenario succeeds.",
      callBudget: session.v2CallBudget,
      mode: session.mode,
      modes: modeOptions().map((entry) => [entry.id, entry.label]),
      modeDescription: option?.description ?? "",
      allowRosterExpansion: session.allowRosterExpansion,
      settingsDisabled: busy || applying,
      toolsDisabled: busy || applying || d.dateMismatch,
      showRecheck: Boolean(result && !busy && runKind !== "governing-alignment-repair" && runKind !== "political-world-unified"),
      recheckDisabled: applying || d.dateMismatch,
      showRunLog: Boolean(result && !busy && runKind !== "political-world-unified"),
      showRetryNote: d.v2NeedsRetry,
      hasCheckpoint: Boolean(v2Checkpoint),
      exportDisabled: busy,
      progress: session.progress,
      error: session.error,
      persistenceWarning: session.v2Persistence?.durable === false,
      lastApplied: session.lastApplied?.length > 0 ? `Applied: ${session.lastApplied.map((entry) => entry.polityKey).join(", ")}` : "",
      files: {
        runLog: result ? `political-generation-${safeFileToken(clean(session.details?.scenario?.name || session.details?.scenario?.id || "scenario"))}-${safeFileToken(result.scenarioDate || d.scenarioDate)}-${safeFileToken(result.uiRunKind || runKind)}.json` : "",
        diagnostic: pipelineResult ? `political-world-${safeFileToken(clean(session.details?.scenario?.name || session.details?.scenario?.id || "scenario"))}-${safeFileToken(pipelineResult.scenarioDate || d.scenarioDate)}.json` : "",
        v2Diagnostic: v2Checkpoint ? `political-world-v2-${safeFileToken(clean(session.details?.scenario?.name || session.details?.scenario?.id || "scenario"))}-${safeFileToken(v2Checkpoint.scenarioDate || d.scenarioDate)}.json` : "",
        checkpoint: v2Checkpoint ? `political-world-checkpoint-${safeFileToken(clean(session.details?.scenario?.name || session.details?.scenario?.id || "scenario"))}-${safeFileToken(v2Checkpoint.scenarioDate || d.scenarioDate)}.json` : "",
      },
      live: null,
      batch: null,
      checkpointCard: null,
      pipelineCard: null,
      rowsVersion: session.rowsVersion,
      showRows: session.rows.length > 0 && runKind !== "political-world-unified",
      expandedPolity: session.expandedPolity,
    };

    const progressTotal = Number(progressInfo?.totalPolities) || 0;
    const progressResolved = Math.max(0, Math.min(progressTotal, Number(progressInfo?.resolvedPolities) || 0));
    const progressReadyPolities = progressInfo?.v2 && progressTotal
      ? Math.max(0, Math.min(
        progressTotal,
        Number(progressInfo?.resolvedPolities) || 0,
        Number(progressInfo?.memberships) || 0,
        Number(progressInfo?.governingAlignment) || 0,
        Number(progressInfo?.powerEvidence) || 0,
      ))
      : progressResolved;
    const progressPercent = progressTotal ? Math.round((progressResolved / progressTotal) * 100) : 0;
    const progressReadyPercent = progressTotal ? Math.round((progressReadyPolities / progressTotal) * 100) : 0;
    const progressEtaMs = progressResolved > 0 && Number(progressInfo?.elapsedMs) > 0
      ? (Number(progressInfo.elapsedMs) / progressResolved) * (progressTotal - progressResolved)
      : null;

    if (busy && progressInfo?.v2) {
      const info = progressInfo;
      const total = info.totalPolities ?? d.polityCount;
      const actors = info.resolvedPolities ?? 0;
      const memberships = info.memberships ?? 0;
      const institutionsResolved = info.membershipInstitutionsResolved ?? 0;
      const institutionsTotal = info.membershipInstitutionsTotal;
      const alignment = info.governingAlignment ?? 0;
      const power = info.powerEvidence ?? 0;
      const verified = info.verified ?? 0;
      const verificationTargets = info.verificationTargets ?? 0;
      const steps = info.pendingJobs ?? 0;
      view.live = {
        readyText: `${progressReadyPolities} of ${info.totalPolities ?? d.polityCount} polities ready`,
        requestsText: aiRequestsUsed(info.modelCalls ?? 0, info.totalModelCallCeiling),
        percent: progressReadyPercent,
        lines: [
          `Political actors: ${actors}/${total} · memberships: ${memberships}/${total}${institutionsTotal ? ` (${institutionsResolved}/${institutionsTotal} institutions resolved)` : ""} · governments & coalitions: ${alignment}/${total} · power: ${power}/${total}${info.verificationRequired ? ` · verified: ${verified}/${verificationTargets}` : ""}`,
          Number(steps) === 1 ? "1 step remaining" : `${steps} steps remaining`,
          callsToFinish(info.estimatedCallsRemaining ?? 0),
        ].filter(Boolean),
      };
    }

    if (busy && progressTotal > 0 && !progressInfo?.v2) {
      const info = progressInfo;
      const phase = info?.phase;
      const batch = (info?.batchIndex ?? 0) + 1;
      const batches = info?.totalBatches ?? "?";
      const attempt = info?.attempt ?? 1;
      const attempts = info?.maxAttempts ?? 2;
      const label = phase === "historical-verification"
        ? (info?.verificationPass === "collision-recheck" ? "Timeline-canon collision re-check" : "Historical check")
        : (info?.generationMode === "quantitative-landscape-fast"
          ? "Landscape backfill"
          : (info?.generationMode === "governing-alignment-fast" ? "Governing alignment" : "Generation"));
      const counts = phase === "historical-verification"
        ? ` · ${info?.verifiedTotal ?? 0} confirmed · ${info?.correctedTotal ?? 0} corrected · ${info?.failedTotal ?? 0} failed`
        : ` · ${info?.acceptedTotal ?? 0} accepted · ${info?.failedTotal ?? 0} failed`;
      const sample = normalizeProgressSampleError(info?.sampleError);
      view.batch = {
        resolvedText: `${progressResolved} / ${progressTotal} polities resolved`,
        percentText: `${progressPercent}%`,
        percent: progressPercent,
        lines: [
          `${label} · batch ${batch} of ${batches} · attempt ${attempt} of ${attempts}${counts}`,
          progressEtaMs == null ? "Estimated remaining: estimating…" : `Estimated remaining: ${formatDuration(progressEtaMs)}`,
        ],
        sample: sample ? {
          title: `Current rejection${sample.polityKey ? ` — ${sample.polityKey}` : ""}`,
          errors: sample.errors.slice(0, 2),
        } : null,
      };
    }

    if (v2Checkpoint && !busy && runKind === "political-world-v2") {
      const counts = d.v2Counts;
      const total = d.v2TotalPolities;
      const calls = v2Checkpoint.modelCalls ?? 0;
      const ceiling = v2Checkpoint.totalModelCallCeiling;
      const unresolvedCount = d.v2UnresolvedPolityCount;
      const retryCount = d.v2RetryPolityCount;
      view.checkpointCard = {
        ready: d.v2Ready,
        title: d.v2Ready ? "Political World ready" : (d.v2NeedsRetry ? "Generation paused" : "Generation progress saved"),
        badge: d.v2Ready ? "ready" : (d.v2NeedsRetry ? "needs another attempt" : "saved"),
        lines: [
          `${d.v2PolitiesReady} of ${total} polities ready${d.v2NeedsRetry ? (retryCount === 1 ? " · 1 polity needs another attempt" : ` · ${retryCount} polities need another attempt`) : unresolvedCount ? (unresolvedCount === 1 ? " · 1 polity unfinished" : ` · ${unresolvedCount} polities unfinished`) : ""}`,
          callsToFinish(Number(v2Checkpoint.worklistSummary?.estimatedCallsRemaining) || 0),
          `Political actors: ${counts.politicalActors ?? 0}/${total} · memberships: ${counts.memberships ?? 0}/${total} · governments & coalitions: ${counts.governingAlignment ?? 0}/${total} · power: ${counts.powerEvidence ?? 0}/${total}`,
          `Institutions: ${counts.institutions ?? 0} · agreements: ${counts.agreements ?? 0} · ${calls === 1 ? "1 AI request used" : `${calls} AI requests used`}${ceiling ? ` · safety limit: ${ceiling}` : ""}`,
        ].filter(Boolean),
        partial: d.v2PartiallyApplied > 0
          ? (d.v2PartiallyApplied === 1
            ? "1 finished polity from this checkpoint is already in the scenario."
            : `${d.v2PartiallyApplied} finished polities from this checkpoint are already in the scenario.`)
          : "",
        readyText: "Quality checks passed. The Political World is ready to apply to the scenario.",
        pausedText: v2Checkpoint.pauseReason === "model-call-budget"
          ? "Generation paused at this run's AI-request limit. Completed work is saved. Continue Generation continues unfinished polities."
          : v2Checkpoint.pauseReason === "total-model-call-budget"
            ? (v2Checkpoint.lastError || "Generation paused at the AI-request safety limit. Completed work is saved.")
            : v2Checkpoint.pauseReason === "bounded-unresolved"
              ? `${retryCount} ${retryCount === 1 ? "polity needs" : "polities need"} another attempt. Completed work is saved. Continue Generation retries only the unfinished polities.`
              : PAUSES_FROM_PROVIDER.includes(v2Checkpoint.pauseReason)
                ? (v2Checkpoint.lastError || "Generation paused because the current AI provider could not complete a step. Completed work is saved; continue after the provider issue is resolved.")
                : `${unresolvedCount} ${unresolvedCount === 1 ? "polity remains" : "polities remain"} unfinished. Completed work is saved.`,
        unfinished: d.v2UnresolvedPolityKeys.length > 0
          ? `Still unfinished: ${d.v2UnresolvedPolityKeys.slice(0, 8).join(" · ")}${d.v2UnresolvedPolityKeys.length > 8 ? "…" : ""}`
          : "",
        ceiling: v2Checkpoint.pauseReason === "total-model-call-budget",
        applyCompleteLabel: applying ? "Applying to Scenario…" : "Apply what is complete",
        applyCompleteDisabled: applying || d.dateMismatch,
        actionsDisabled: applying,
      };
    }

    if (pipelineResult && !busy && runKind === "political-world-unified") {
      const geo = pipelineResult.geopolitics;
      view.pipelineCard = {
        blocked: d.pipelineBlocked,
        summary: `Political Actors: ${pipelineResult.politics?.generatedPolities ?? 0} accepted / ${pipelineResult.politics?.failedPolities ?? 0} failed`
          + (pipelineResult.governingAlignment ? ` · Governing alignment: ${pipelineResult.governingAlignment.generatedPolities ?? 0} patch(es), ${pipelineResult.governingAlignment.governingAlignmentRepair?.nonPartisan?.length ?? 0} non-partisan, ${pipelineResult.governingAlignment.failedPolities ?? 0} failed` : "")
          + (geo ? ` · Geopolitics: ${geo.records?.length ?? 0} profiles, ${geo.institutionCatalog?.length ?? 0} institutions, ${geo.powerCalibration?.length ?? 0} power inputs, ${geo.agreements?.length ?? 0} agreements, ${geo.modelCalls ?? 0} AI call(s)` : ""),
        catalog: geo?.institutionCatalog?.length
          ? `Catalog sample: ${geo.institutionCatalog.slice(0, 10).map((entry) => `${entry.shortName || entry.name} [${entry.id}]`).join(" · ")}${geo.institutionCatalog.length > 10 ? " …" : ""}`
          : "",
        blockingErrors: d.pipelineBlocked ? pipelineResult.blockingErrors.slice(0, 8) : [],
      };
    }

    if (withRows) {
      view.rows = session.rows.map((row) => ({
        polityKey: row.polityKey,
        depth: row.depth,
        needs: row.needs,
        confidence: row.confidence,
        selected: row.selected,
        allowEntityExpansion: row.allowEntityExpansion,
        actorPatchText: row.actorPatchText,
        sourceErrors: row.sourceErrors,
        status: row.status,
      }));
    }
    return view;
  };

  const pushProgress = (session) => {
    emit("editor.politics.progress", { scenarioId: session.scenarioId, call: session.callId, view: genView(session) });
  };

  const setRows = (session, rows) => {
    session.rows = rows;
    session.rowsVersion += 1;
  };

  const mergeRowEdits = (session, edits) => {
    const byKey = new Map(array(edits).map((entry) => [clean(entry?.polityKey), entry]));
    session.rows = session.rows.map((row) => {
      const edit = byKey.get(row.polityKey);
      if (!edit) return row;
      return {
        ...row,
        selected: edit.selected === true,
        allowEntityExpansion: edit.allowEntityExpansion === true,
        actorPatchText: typeof edit.actorPatchText === "string" ? edit.actorPatchText : row.actorPatchText,
        sourceErrors: Array.isArray(edit.sourceErrors) ? edit.sourceErrors.map(String) : row.sourceErrors,
      };
    });
  };

  const savedScenarioDate = (details) => {
    const raw = clean(details?.data?.game?.startDate || details?.data?.game?.gameDate);
    return normalizeGameDate(raw) || raw;
  };

  const generatePoliticalWorld = async (session, { retryDeferred = false } = {}, signal) => {
    const inputs = session.inputs;
    const d = derived(session);
    if (!inputs || session.busy || session.applying) return;
    if (!inputs.scenarioDate) {
      session.error = "Save a valid scenario start date before generating the Political World.";
      return;
    }
    if (d.dateMismatch) {
      session.error = "The Scenario Editor date has unsaved changes. Save the scenario first so Political World generation uses the saved start date.";
      return;
    }
    if (session.form?.canonContextTouched) {
      session.error = "Save the World tab first. Political World generation only uses saved scenario data, never unsaved editor choices.";
      return;
    }

    session.busy = true;
    session.runKind = "political-world-v2";
    session.error = "";
    session.lastApplied = null;
    session.pipelineResult = null;
    session.result = null;
    setRows(session, []);
    session.progress = session.v2Checkpoint ? "Resuming Political World generation checkpoint…" : "Initializing Political World generation…";
    session.progressInfo = null;
    session.v2Persistence = null;
    session.generationStartedAt = Date.now();
    pushProgress(session);
    const callsBefore = Number(session.v2Checkpoint?.modelCalls) || 0;
    try {
      await withIdb(async () => {
        const freshDetails = await loadDetails(session.scenarioId);
        const freshTags = await lib.downloadScenarioJsonAsset(freshDetails?.scenario?.id || session.scenarioId, "tags");
        const freshInputs = review().buildScenarioPoliticalGenerationInputs(freshDetails, { mode: session.mode, maxBatchSize: 8, countryTags: freshTags });
        if (freshInputs.scenarioDate !== inputs.scenarioDate) {
          throw new Error(`Scenario start date changed from ${inputs.scenarioDate} to ${freshInputs.scenarioDate || "<blank>"}. Save/reload before generating Political World.`);
        }
        const canon = engine.polScenarioCanon;
        const editorCanonContext = canon.normalizeCanonContext(session.form?.canonContext || {});
        const savedCanon = canon.readScenarioCanon(freshInputs.world || {});
        const editorActivePacks = canon.activeReferencePackIds(editorCanonContext);
        const savedActivePacks = canon.activeReferencePackIds(savedCanon.canonContext);
        if (editorActivePacks.length && (!savedCanon.initialized || editorActivePacks.some((id) => !savedActivePacks.includes(id)))) {
          throw new Error("Saved world context does not match the editor's active reference knowledge. Save the World tab once more, then retry Political World generation.");
        }

        const labels = {
          "institution-discovery": "Discovering institutions…",
          "political-actor": "Constructing Political Actors…",
          "governing-alignment": "Resolving governments and coalitions…",
          "institution-membership-resolution": "Resolving one uncovered institution's complete membership…",
          "agreement-resolution": "Resolving standing agreements…",
          "power-evidence": "Calibrating geopolitical power evidence…",
          "temporal-sentinel": "Checking exact-date political identity…",
          "historical-verification": "Adjudicating timeline-canon corrections…",
        };
        const next = await pipeline().generateOrResumePoliticalWorldV2({
          scenarioId: freshDetails?.scenario?.id || session.scenarioId,
          inputs: freshInputs,
          qualityMode: "canonical",
          maxModelCalls: Math.max(1, Math.trunc(Number(session.v2CallBudget) || 20)),
          allowEntityExpansion: session.allowRosterExpansion,
          retryDeferred,
          signal,
          onProgress: ({ checkpoint, summary, quality, runningJob, persistence }) => {
            session.v2Persistence = persistence || null;
            session.v2Checkpoint = checkpoint;
            const type = clean(runningJob?.type);
            if (type) session.progress = labels[type] || `Running ${type}…`;
            const counts = quality?.counts || {};
            const totalPolities = Number(counts.polities) || d.polityCount;
            const verificationRequired = checkpoint?.historicalVerificationRequired === true;
            const verificationTargets = verificationRequired ? (Number(counts.verificationTargets) || 0) : 0;
            const canonicalTotal = totalPolities * 4 + verificationTargets;
            const canonicalResolved = (Number(counts.politicalActors) || 0)
              + (Number(counts.memberships) || 0)
              + (Number(counts.governingAlignment) || 0)
              + (Number(counts.powerEvidence) || 0)
              + (verificationRequired ? Math.min(verificationTargets, Number(counts.verified) || 0) : 0);
            session.progressInfo = {
              v2: true,
              phase: type || "checkpoint",
              failedJobs: Number(summary?.failed) || 0,
              pendingJobs: (Number(summary?.pending) || 0) + (Number(summary?.running) || 0),
              estimatedCallsRemaining: Number(summary?.estimatedCallsRemaining) || 0,
              totalPolities,
              resolvedPolities: Number(counts.politicalActors) || 0,
              memberships: Number(counts.memberships) || 0,
              membershipInstitutionsResolved: Number(counts.membershipInstitutionsResolved) || 0,
              membershipInstitutionsTotal: Number(counts.membershipInstitutionsTotal) || 0,
              governingAlignment: Number(counts.governingAlignment) || 0,
              powerEvidence: Number(counts.powerEvidence) || 0,
              verified: Number(counts.verified) || 0,
              verificationTargets,
              verificationRequired,
              canonicalResolved,
              canonicalTotal,
              canonicalPercent: canonicalTotal
                ? (quality?.canonicalReady === true ? 100 : Math.min(99, Math.round((canonicalResolved / canonicalTotal) * 100)))
                : 0,
              acceptedTotal: Number(counts.politicalActors) || 0,
              failedTotal: Number(summary?.failed) || 0,
              modelCalls: Number(checkpoint?.modelCalls) || 0,
              totalModelCallCeiling: Number(checkpoint?.totalModelCallCeiling) || 0,
              unresolvedCount: Array.isArray(quality?.unresolved) ? quality.unresolved.length : 0,
              sampleError: quality?.blockingErrors?.[0]
                ? { polityKey: "", errors: [quality.blockingErrors[0]] }
                : checkpoint?.lastError
                  ? { polityKey: "", errors: [checkpoint.lastError] }
                  : null,
              elapsedMs: Math.max(0, Date.now() - session.generationStartedAt),
            };
            pushProgress(session);
          },
        });
        session.v2Checkpoint = next;
        const sessionCalls = Math.max(0, (Number(next.modelCalls) || 0) - callsBefore);
        if (next.quality?.canonicalReady) {
          const counts = next.quality?.counts || {};
          const referenceSummary = Number(counts.referenceInstitutionsExpected) > 0
            ? ` Reference scope: ${counts.referenceInstitutionsMaterialized ?? 0}/${counts.referenceInstitutionsExpected ?? 0} expected institutions materialized.`
            : "";
          session.progress = `Political World ready. ${counts.politicalActors ?? 0} of ${counts.polities ?? d.polityCount} polities completed.${referenceSummary} ${sessionCalls} AI request${sessionCalls === 1 ? "" : "s"} used this run. Review the summary, then apply it to the scenario.`;
        } else if (next.status === "paused" && next.pauseReason === "model-call-budget") {
          session.progress = `Generation paused after ${sessionCalls} AI request${sessionCalls === 1 ? "" : "s"}. Completed work is saved. Continue Generation when you're ready.`;
        } else if (next.status === "paused" && next.pauseReason === "total-model-call-budget") {
          session.progress = next.lastError || "Generation paused at the AI-request safety limit. Completed work is saved. Review the unfinished polities before continuing.";
        } else if (next.status === "paused" && next.pauseReason === "aborted") {
          session.progress = "Generation paused. Completed work is saved.";
        } else if (next.status === "paused" && next.pauseReason === "bounded-unresolved") {
          const unresolvedPolities = [...new Set((Array.isArray(next.quality?.unresolved) ? next.quality.unresolved : []).map((entry) => clean(entry?.polityKey)).filter(Boolean))].length
            || Number(next.worklistSummary?.failed)
            || 0;
          session.progress = `Generation paused. ${unresolvedPolities} ${unresolvedPolities === 1 ? "polity needs" : "polities need"} another attempt. Completed work is saved. Continue Generation retries only unfinished polities.`;
        } else if (next.status === "paused" && PAUSES_FROM_PROVIDER.includes(next.pauseReason)) {
          session.progress = next.lastError || "Generation paused because the current AI provider could not complete a step. Completed work is saved; continue after the provider issue is resolved.";
        } else {
          const unresolvedPolities = [...new Set((Array.isArray(next.quality?.unresolved) ? next.quality.unresolved : []).map((entry) => clean(entry?.polityKey)).filter(Boolean))].length;
          const blockers = next.quality?.blockingErrors?.length ?? 0;
          session.progress = blockers
            ? `Generation stopped because ${blockers} blocking error${blockers === 1 ? " needs" : "s need"} attention. Completed work is saved.`
            : `Generation paused with ${unresolvedPolities} ${unresolvedPolities === 1 ? "polity" : "polities"} unfinished. Completed work is saved.`;
        }
      });
    } catch (nextError) {
      if (nextError?.name === "AbortError") session.progress = "Political World generation paused. Completed work remains saved.";
      else session.error = nextError?.message || String(nextError);
    } finally {
      session.busy = false;
    }
  };

  const applyPoliticalWorld = async (session) => {
    const d = derived(session);
    if (!session.details?.scenario?.id || !d.applyReady || session.busy || session.applying) return null;
    session.applying = true;
    session.error = "";
    let savedDetails = null;
    try {
      await withIdb(async () => {
        const scenarioId = session.details.scenario.id;
        const freshDetails = await loadDetails(scenarioId);
        const freshDate = savedScenarioDate(freshDetails);
        if (session.runKind === "political-world-v2") {
          const v2Checkpoint = session.v2Checkpoint;
          if (!v2Checkpoint) throw new Error("Political World generation checkpoint is missing.");
          if (freshDate !== v2Checkpoint.scenarioDate) {
            throw new Error(`Scenario start date changed from ${v2Checkpoint.scenarioDate} to ${freshDate || "<blank>"}. Start a fresh Political World generation for the new date.`);
          }
          const freshInputs = review().buildScenarioPoliticalGenerationInputs(freshDetails, { mode: session.mode, maxBatchSize: 8 });
          const world = pipeline().applyPoliticalWorldV2Checkpoint({
            checkpoint: v2Checkpoint,
            freshWorld: freshDetails?.data?.world ?? {},
            freshRoundZeroContext: freshInputs.roundZeroContext || null,
            scenarioId,
            scenarioDate: freshDate,
          });
          const saved = await lib.saveScenario(scenarioId, { world });
          await pipeline().discardPoliticalWorldV2Checkpoint(scenarioId);
          savedDetails = saved;
          const counts = v2Checkpoint.quality?.counts || {};
          session.progress = `Political World added to scenario - ${counts.politicalActors ?? 0} polities, ${counts.institutions ?? 0} institutions, ${counts.agreements ?? 0} agreements.`;
          session.v2Checkpoint = null;
          session.progressInfo = null;
          return;
        }
        const pipelineResult = session.pipelineResult;
        if (freshDate !== pipelineResult.scenarioDate) {
          throw new Error(`Scenario start date changed from ${pipelineResult.scenarioDate} to ${freshDate || "<blank>"}. Regenerate the Political World.`);
        }
        const application = engine.polPipeline.applyPoliticalWorldPipeline({
          world: freshDetails?.data?.world ?? {},
          result: pipelineResult,
          date: pipelineResult.scenarioDate,
        });
        const saved = await lib.saveScenario(scenarioId, { world: application.world });
        savedDetails = saved;
        const politicalCount = application.applied?.politics?.length ?? 0;
        const alignmentCount = application.applied?.governingAlignment?.length ?? 0;
        const geopoliticalCount = application.applied?.geopolitics?.length ?? 0;
        session.progress = `Applied Political World atomically: ${politicalCount} political patch(es), ${alignmentCount} governing-alignment patch(es), ${geopoliticalCount} geopolitical operation(s).`;
        session.pipelineResult = null;
        session.progressInfo = null;
      });
    } catch (nextError) {
      session.error = nextError?.message || String(nextError);
    } finally {
      session.applying = false;
    }
    return savedDetails;
  };

  const allowMoreV2Calls = async (session) => {
    if (!session.v2Checkpoint || session.busy || session.applying) return;
    session.error = "";
    try {
      await withIdb(async () => {
        const next = await pipeline().grantPoliticalWorldV2Calls(session.v2Checkpoint);
        const amount = Number(next?.ceilingGrants?.at(-1)?.amount) || 0;
        session.v2Checkpoint = next;
        session.progress = amount === 1
          ? "Allowed 1 more AI call. Resume Generation continues the saved work."
          : `Allowed ${amount} more AI calls. Resume Generation continues the saved work.`;
      });
    } catch (nextError) {
      session.error = nextError?.message || String(nextError);
    }
  };

  const discardV2Checkpoint = async (session) => {
    if (!session.v2Checkpoint || session.busy || session.applying) return;
    session.error = "";
    try {
      await withIdb(async () => {
        await pipeline().discardPoliticalWorldV2Checkpoint(session.v2Checkpoint.scenarioId || session.details?.scenario?.id);
      });
      session.v2Checkpoint = null;
      session.progressInfo = null;
      session.v2Persistence = null;
      session.progress = "Political World checkpoint discarded. Generate Political World starts a fresh run.";
    } catch (nextError) {
      session.error = nextError?.message || String(nextError);
    }
  };

  const applyCompleteV2Work = async (session) => {
    if (!session.details?.scenario?.id || !session.v2Checkpoint || session.busy || session.applying) return null;
    session.applying = true;
    session.error = "";
    let savedDetails = null;
    try {
      await withIdb(async () => {
        const scenarioId = session.details.scenario.id;
        const v2Checkpoint = session.v2Checkpoint;
        const freshDetails = await loadDetails(scenarioId);
        const freshDate = savedScenarioDate(freshDetails);
        if (freshDate !== v2Checkpoint.scenarioDate) {
          throw new Error(`Scenario start date changed from ${v2Checkpoint.scenarioDate} to ${freshDate || "<blank>"}. Resume from a fresh v2 checkpoint.`);
        }
        const freshInputs = review().buildScenarioPoliticalGenerationInputs(freshDetails, { mode: session.mode, maxBatchSize: 8 });
        const application = pipeline().applyCompletePoliticalWorldV2Work({
          checkpoint: v2Checkpoint,
          freshWorld: freshDetails?.data?.world ?? {},
          freshRoundZeroContext: freshInputs.roundZeroContext || null,
          scenarioId,
          scenarioDate: freshDate,
          polities: freshInputs.polities,
        });
        const saved = await lib.saveScenario(scenarioId, { world: application.world });
        const reloaded = saved?.data?.world ? saved : await loadDetails(scenarioId);
        const savedInputs = review().buildScenarioPoliticalGenerationInputs(reloaded, { mode: session.mode, maxBatchSize: 8 });
        const kept = await pipeline().keepPoliticalWorldV2CheckpointAfterPartialApply({
          checkpoint: v2Checkpoint,
          world: savedInputs.world,
          roundZeroContext: savedInputs.roundZeroContext || null,
          applied: application,
          relevanceByPolity: freshInputs.relevanceByPolity,
        });
        session.v2Checkpoint = kept;
        savedDetails = saved;
        const count = application.polities.length;
        session.progress = application.institutions
          ? (count === 0
            ? "Applied the institutions and standing agreements to the scenario. No polity has passed every check yet, so every polity stays in this checkpoint for a later run."
            : count === 1
              ? "Applied 1 finished polity and the institutions and standing agreements to the scenario. The rest stay in this checkpoint for a later run."
              : `Applied ${count} finished polities and the institutions and standing agreements to the scenario. The rest stay in this checkpoint for a later run.`)
          : (count === 1
            ? "Applied 1 finished polity to the scenario. The other polities, the institutions and the standing agreements stay in this checkpoint for a later run."
            : `Applied ${count} finished polities to the scenario. The other polities, the institutions and the standing agreements stay in this checkpoint for a later run.`);
      });
    } catch (nextError) {
      session.error = nextError?.message || String(nextError);
    } finally {
      session.applying = false;
    }
    return savedDetails;
  };

  const batchInfo = (session, fields) => {
    if (session.progressPhase !== fields.phase) {
      session.progressPhase = fields.phase;
      session.generationStartedAt = Date.now();
    }
    return { ...fields, elapsedMs: Math.max(0, Date.now() - session.generationStartedAt) };
  };

  const generateProposals = async (session, testMode, signal) => {
    const generationInputs = testMode ? session.testInputs : session.inputs;
    const d = derived(session);
    if (!generationInputs || session.busy || session.applying) return;
    if (!generationInputs.scenarioDate) {
      session.error = "Save a valid scenario start date before generating political state.";
      return;
    }
    if (d.dateMismatch) {
      session.error = "The Scenario Editor date has unsaved changes. Save the scenario first so generation uses the saved scenario start date.";
      return;
    }

    session.busy = true;
    session.pipelineResult = null;
    session.runKind = testMode ? "test-15" : session.mode;
    session.error = "";
    session.lastApplied = null;
    session.progress = "Planning missing political state…";
    session.progressInfo = null;
    session.progressPhase = "generation";
    session.generationStartedAt = Date.now();
    pushProgress(session);
    try {
      const allowEntityExpansionByPolity = session.allowRosterExpansion
        ? Object.fromEntries(Object.keys(generationInputs.politicalActors?.byPolity ?? {}).map((polityKey) => [polityKey, true]))
        : {};
      const nextResult = await engine.polGenerator.generatePoliticalWorldProposals({
        ...generationInputs,
        allowEntityExpansionByPolity,
        maxAttempts: 2,
        signal,
        onBatch: ({
          phase = "generation", generationMode = "", verificationPass = "initial", batchIndex, totalBatches, attempt, maxAttempts, accepted, unresolved,
          resolvedPolities, totalPolities, acceptedTotal, failedTotal, verifiedTotal, correctedTotal, sampleError,
        }) => {
          session.progress = phase === "historical-verification"
            ? (verificationPass === "collision-recheck" ? "Re-checking conflicting officeholders…" : "Checking timeline canon…")
            : (generationMode === "quantitative-landscape-fast" ? "Backfilling quantitative political landscapes…" : "Generating Political World…");
          session.progressInfo = batchInfo(session, {
            phase,
            generationMode,
            verificationPass,
            batchIndex,
            totalBatches,
            attempt,
            maxAttempts,
            accepted: array(accepted).length,
            unresolved: array(unresolved).length,
            resolvedPolities,
            totalPolities,
            acceptedTotal,
            failedTotal,
            verifiedTotal,
            correctedTotal,
            sampleError,
          });
          pushProgress(session);
        },
      });
      const resultWithRun = { ...nextResult, uiRunKind: testMode ? "test-15" : session.mode };
      session.result = resultWithRun;
      setRows(session, buildRows(resultWithRun, { allowRosterExpansion: session.allowRosterExpansion, selectValid: !testMode }));
      session.expandedPolity = nextResult.proposals?.[0]?.item?.polityKey ?? "";
      if (!nextResult.plan?.items?.length) {
        session.progress = "Political world is already complete for this generation mode. No AI call was needed.";
      } else {
        const verification = nextResult.historicalVerification;
        const verificationSummary = verification?.enabled
          ? ` Exact-date check: ${verification.confirmed} confirmed, ${verification.corrected} corrected, ${verification.failed} failed.`
          : "";
        session.progress = `${testMode ? "Test complete: " : ""}${nextResult.generatedPolities} valid proposal(s), ${nextResult.failedPolities} failed.${verificationSummary}`;
      }
    } catch (nextError) {
      if (nextError?.name === "AbortError") session.progress = "Political generation cancelled.";
      else session.error = nextError?.message || String(nextError);
    } finally {
      session.busy = false;
    }
  };

  const repairGoverningAlignment = async (session, signal) => {
    const inputs = session.inputs;
    const d = derived(session);
    if (!inputs || session.busy || session.applying) return;
    if (!inputs.scenarioDate) {
      session.error = "Save a valid scenario start date before repairing governing alignment.";
      return;
    }
    if (d.dateMismatch) {
      session.error = "The Scenario Editor date has unsaved changes. Save the scenario first so governing alignment uses the saved scenario start date.";
      return;
    }

    session.busy = true;
    session.pipelineResult = null;
    session.runKind = "governing-alignment-repair";
    session.error = "";
    session.lastApplied = null;
    session.progress = "Planning missing governing-party / coalition references…";
    session.progressInfo = null;
    session.progressPhase = "generation";
    session.generationStartedAt = Date.now();
    pushProgress(session);
    try {
      const nextResult = await engine.polAlignmentRepair.generatePoliticalGoverningAlignmentRepair({
        ...inputs,
        maxAttempts: 2,
        signal,
        onBatch: ({
          phase = "generation", generationMode = "governing-alignment-fast", batchIndex, totalBatches, attempt, maxAttempts,
          accepted, unresolved, resolvedPolities, totalPolities, acceptedTotal, failedTotal, sampleError,
        }) => {
          session.progress = "Repairing governing-party / coalition alignment…";
          session.progressInfo = batchInfo(session, {
            phase,
            generationMode,
            batchIndex,
            totalBatches,
            attempt,
            maxAttempts,
            accepted: array(accepted).length,
            unresolved: array(unresolved).length,
            resolvedPolities,
            totalPolities,
            acceptedTotal,
            failedTotal,
            sampleError,
          });
          pushProgress(session);
        },
      });
      const resultWithRun = { ...nextResult, uiRunKind: "governing-alignment-repair" };
      session.result = resultWithRun;
      setRows(session, buildRows(resultWithRun, { allowRosterExpansion: false, selectValid: true }));
      session.expandedPolity = nextResult.proposals?.[0]?.item?.polityKey ?? "";
      const nonPartisan = nextResult.governingAlignmentRepair?.nonPartisan?.length ?? 0;
      if (!nextResult.plan?.items?.length) {
        session.progress = "Governing alignment is already present for every repairable party-based government. No AI call was needed.";
      } else {
        session.progress = `Governing alignment repair complete: ${nextResult.generatedPolities} valid patch(es), ${nonPartisan} genuinely non-partisan/partyless government(s), ${nextResult.failedPolities} failed. Temporal verifier: 0 calls.`;
      }
    } catch (nextError) {
      if (nextError?.name === "AbortError") session.progress = "Governing alignment repair cancelled.";
      else session.error = nextError?.message || String(nextError);
    } finally {
      session.busy = false;
    }
  };

  const recheckHistory = async (session, signal) => {
    const d = derived(session);
    const result = session.result;
    if (!session.details?.scenario?.id || !result || session.busy || session.applying) return;
    if (d.dateMismatch) {
      session.error = "The Scenario Editor date has unsaved changes. Save the scenario before re-checking timeline canon.";
      return;
    }

    session.busy = true;
    session.error = "";
    session.lastApplied = null;
    session.progress = "Re-checking timeline canon only…";
    session.progressInfo = null;
    session.progressPhase = "historical-verification";
    session.generationStartedAt = Date.now();
    pushProgress(session);
    try {
      const freshDetails = await loadDetails(session.details.scenario.id);
      const freshInputs = review().buildScenarioPoliticalGenerationInputs(freshDetails, { mode: session.mode, maxBatchSize: 8 });
      if (freshInputs.scenarioDate !== result.scenarioDate) {
        throw new Error(`Scenario start date changed from ${result.scenarioDate} to ${freshInputs.scenarioDate || "<blank>"}. Generate political proposals again for the new canonical date.`);
      }
      const allowEntityExpansionByPolity = session.allowRosterExpansion
        ? Object.fromEntries(Object.keys(freshInputs.politicalActors?.byPolity ?? {}).map((polityKey) => [polityKey, true]))
        : {};
      const previousRows = new Map(session.rows.map((row) => [row.polityKey, row]));
      const nextResult = await engine.polGenerator.reverifyPoliticalWorldProposals({
        result,
        scenarioDate: freshInputs.scenarioDate,
        historyAuthority: freshInputs.historyAuthority || null,
        politicalActors: freshInputs.politicalActors,
        scenarioContext: freshInputs.scenarioContext,
        contextByPolity: freshInputs.contextByPolity,
        allowEntityExpansionByPolity,
        signal,
        onBatch: ({
          phase = "historical-verification", verificationPass = "initial", batchIndex, totalBatches, attempt, maxAttempts, accepted, unresolved,
          resolvedPolities, totalPolities, acceptedTotal, failedTotal, verifiedTotal, correctedTotal, sampleError,
        }) => {
          session.progress = verificationPass === "collision-recheck"
            ? "Re-checking conflicting officeholders…"
            : "Re-checking timeline canon only…";
          session.progressInfo = {
            phase,
            verificationPass,
            batchIndex,
            totalBatches,
            attempt,
            maxAttempts,
            accepted: array(accepted).length,
            unresolved: array(unresolved).length,
            resolvedPolities,
            totalPolities,
            acceptedTotal,
            failedTotal,
            verifiedTotal,
            correctedTotal,
            sampleError,
            elapsedMs: Math.max(0, Date.now() - session.generationStartedAt),
          };
          pushProgress(session);
        },
      });
      const baseRunKind = clean(result.uiRunKind || session.runKind).replace(/-history-recheck$/, "");
      const resultWithRun = { ...nextResult, uiRunKind: `${baseRunKind}-history-recheck` };
      const nextRows = buildRows(resultWithRun, { allowRosterExpansion: session.allowRosterExpansion, selectValid: false }).map((row) => {
        const previous = previousRows.get(row.polityKey);
        if (!previous || row.status !== "valid") return row;
        return {
          ...row,
          selected: previous.selected === true,
          allowEntityExpansion: previous.allowEntityExpansion === true,
        };
      });
      session.result = resultWithRun;
      setRows(session, nextRows);
      session.expandedPolity = nextRows.some((row) => row.polityKey === session.expandedPolity) ? session.expandedPolity : (nextRows[0]?.polityKey ?? "");
      const verification = nextResult.historicalVerification;
      const collision = verification?.collisionRechecks;
      const collisionSummary = collision?.groups
        ? ` Collision review: ${collision.groups} group(s), ${collision.resolvedPolities?.length ?? 0} polity/polities resolved, ${collision.failedPolities?.length ?? 0} failed closed.`
        : "";
      session.progress = `Historical re-check complete without regenerating politics: ${verification?.confirmed ?? 0} confirmed, ${verification?.corrected ?? 0} corrected, ${verification?.failed ?? 0} failed.${collisionSummary}`;
      session.runKind = resultWithRun.uiRunKind;
    } catch (nextError) {
      if (nextError?.name === "AbortError") session.progress = "Historical re-check cancelled.";
      else session.error = nextError?.message || String(nextError);
    } finally {
      session.busy = false;
    }
  };

  const restoreRunLog = async (session, file) => {
    if (!file || session.busy || session.applying) return;
    session.error = "";
    session.lastApplied = null;
    const d = derived(session);
    try {
      const diagnostic = JSON.parse(fs.readFileSync(file, "utf8"));
      if (diagnostic?.kind === "political-world-v2-checkpoint") {
        await withIdb(async () => {
          const freshDetails = await loadDetails(session.details?.scenario?.id);
          const freshInputs = review().buildScenarioPoliticalGenerationInputs(freshDetails, { mode: session.mode, maxBatchSize: 8 });
          const restoredCheckpoint = engine.polV2CheckpointFile.restorePoliticalWorldV2CheckpointFile(diagnostic, {
            scenarioId: session.details?.scenario?.id,
            inputs: freshInputs,
          });
          if ((Number(session.v2Checkpoint?.modelCalls) || 0) > (Number(restoredCheckpoint.modelCalls) || 0)) {
            throw new Error("This scenario already has a saved Political World checkpoint with more work in it than this file. Resume or apply that one instead.");
          }
          const saved = await storage().savePoliticalWorldV2Checkpoint(restoredCheckpoint);
          const calls = Number(saved?.modelCalls) || 0;
          session.v2Checkpoint = saved;
          session.pipelineResult = null;
          session.result = null;
          setRows(session, []);
          session.runKind = "political-world-v2";
          session.expandedPolity = "";
          session.progressInfo = null;
          session.progress = calls === 1
            ? "Restored the Political World checkpoint without any AI calls. It holds 1 AI call of work. Resume continues it, and Apply to Scenario writes it once its quality checks pass."
            : `Restored the Political World checkpoint without any AI calls. It holds ${calls} AI calls of work. Resume continues it, and Apply to Scenario writes it once its quality checks pass.`;
        });
      } else if (diagnostic?.kind === "political-world-pipeline-diagnostic") {
        const restoredPipeline = restorePipelineResultFromDiagnostic(diagnostic, {
          scenarioId: session.details?.scenario?.id,
          scenarioDate: d.scenarioDate,
        });
        session.pipelineResult = restoredPipeline;
        session.result = null;
        setRows(session, []);
        session.runKind = "political-world-unified";
        session.expandedPolity = "";
        session.progressInfo = null;
        session.progress = `Restored combined Political World review without any AI calls: ${restoredPipeline.politics?.generatedPolities ?? 0} Political Actors and ${restoredPipeline.governingAlignment?.generatedPolities ?? 0} governing-alignment patches preserved.`;
      } else {
        const restored = restoreResultFromDiagnostic(diagnostic, {
          scenarioId: session.details?.scenario?.id,
          scenarioDate: d.scenarioDate,
        });
        const restoredRunKind = clean(restored.uiRunKind || "balanced");
        const restoredRows = buildRows(restored, {
          allowRosterExpansion: session.allowRosterExpansion,
          selectValid: !restoredRunKind.startsWith("test-15"),
        });
        session.pipelineResult = null;
        session.result = restored;
        setRows(session, restoredRows);
        session.runKind = restoredRunKind;
        session.expandedPolity = restoredRows.find((row) => row.status === "valid")?.polityKey ?? "";
        session.progressInfo = null;
        session.progress = `Restored Political World review from run log without any AI calls: ${restored.generatedPolities} accepted, ${restored.failedPolities} failed.`;
      }
    } catch (nextError) {
      session.error = `Could not restore Political World run log: ${nextError?.message || String(nextError)}`;
    }
  };

  const runLogOf = (session) => {
    const result = session.result;
    const d = derived(session);
    const scenarioName = clean(session.details?.scenario?.name || session.details?.scenario?.id || "scenario");
    return {
      schemaVersion: 1,
      kind: "political-world-generation-diagnostic",
      scenario: {
        id: clean(session.details?.scenario?.id),
        name: scenarioName,
        scenarioDate: result.scenarioDate || d.scenarioDate,
      },
      run: {
        mode: result.uiRunKind || session.runKind,
        generatedAt: result.generatedAt,
        plannedPolities: result.plan?.items?.length ?? 0,
        accepted: result.generatedPolities ?? 0,
        failed: result.failedPolities ?? 0,
      },
      batches: result.batches ?? [],
      warnings: result.warnings ?? [],
      failures: result.failures ?? [],
      acceptedProposals: (result.proposals ?? []).map((entry) => ({
        polityKey: entry.item?.polityKey,
        depth: entry.item?.depth,
        needs: entry.item?.needs,
        proposal: entry.proposal,
        historicalVerification: entry.historicalVerification ?? null,
        appliedPathsPreview: entry.validation?.appliedPaths ?? [],
      })),
      diagnostics: result.diagnostics ?? [],
      historicalVerification: result.historicalVerification ?? null,
    };
  };

  const writeJsonFile = (file, value) => {
    try {
      fs.writeFileSync(file, JSON.stringify(value, null, 2));
    } catch (error) {
      console.warn(`[political world] could not save ${path.basename(file)}: ${error?.message || error}`);
    }
  };

  const saveFile = async (session, kind, file) => {
    if (!file) return;
    const scenarioName = clean(session.details?.scenario?.name || session.details?.scenario?.id || "scenario");
    if (kind === "runLog") {
      if (!session.result) return;
      writeJsonFile(file, runLogOf(session));
      return;
    }
    if (kind === "diagnostic") {
      if (!session.pipelineResult) return;
      session.error = "";
      try {
        const diagnostic = engine.polPipeline.buildPoliticalWorldPipelineDiagnostic({
          result: session.pipelineResult,
          world: session.inputs?.world ?? {},
          scenario: { id: clean(session.details?.scenario?.id), name: scenarioName },
        });
        writeJsonFile(file, diagnostic);
      } catch (nextError) {
        session.error = `Could not build Political World diagnostic: ${nextError?.message || String(nextError)}`;
      }
      return;
    }
    if (kind === "v2Diagnostic") {
      if (!session.v2Checkpoint) return;
      session.error = "";
      try {
        const diagnostic = pipeline().buildPoliticalWorldV2Diagnostic({
          checkpoint: session.v2Checkpoint,
          scenario: { id: clean(session.details?.scenario?.id), name: scenarioName },
        });
        writeJsonFile(file, diagnostic);
      } catch (nextError) {
        session.error = `Could not build Political World generation diagnostic: ${nextError?.message || String(nextError)}`;
      }
      return;
    }
    if (kind === "checkpoint") {
      if (!session.v2Checkpoint) return;
      session.error = "";
      try {
        const exported = engine.polV2CheckpointFile.buildPoliticalWorldV2CheckpointFile({
          checkpoint: session.v2Checkpoint,
          scenario: { id: clean(session.details?.scenario?.id), name: scenarioName },
        });
        writeJsonFile(file, exported);
      } catch (nextError) {
        session.error = `Could not export the Political World checkpoint: ${nextError?.message || String(nextError)}`;
      }
    }
  };

  const applySelected = async (session, edits) => {
    mergeRowEdits(session, edits);
    const rowErrors = {};
    const selectedCount = session.rows.filter((row) => row.status === "valid" && row.selected).length;
    if (!session.details?.scenario?.id || !session.result || !selectedCount || session.busy || session.applying) return { rowErrors, saved: null };
    session.applying = true;
    session.error = "";
    let saved = null;
    try {
      const reviews = [];
      const parseErrors = [];
      for (const row of session.rows) {
        if (row.status !== "valid" || !row.selected) continue;
        let actorPatch;
        try {
          actorPatch = JSON.parse(row.actorPatchText);
        } catch (parseError) {
          parseErrors.push({ polityKey: row.polityKey, message: parseError.message });
          continue;
        }
        reviews.push({
          selected: true,
          proposal: row.proposal,
          actorPatch,
          allowEntityExpansion: row.allowEntityExpansion === true,
          fillEmptyGovernmentPartyRefs: row.needs.includes("governing_alignment"),
        });
      }
      if (parseErrors.length) {
        for (const entry of parseErrors) rowErrors[entry.polityKey] = [`Edited actorPatch is not valid JSON: ${entry.message}`];
        throw new Error("Fix invalid JSON in the selected political proposals before applying.");
      }
      const freshDetails = await loadDetails(session.details.scenario.id);
      const freshDate = savedScenarioDate(freshDetails);
      if (freshDate !== session.result.scenarioDate) {
        throw new Error(`Scenario start date changed from ${session.result.scenarioDate} to ${freshDate || "<blank>"}. Regenerate political proposals for the new canonical date.`);
      }
      const freshWorld = freshDetails?.data?.world ?? {};
      const application = review().applyReviewedPoliticalGeneration({
        politicalActors: freshWorld.politicalActors,
        scenarioDate: session.result.scenarioDate,
        reviews,
      });
      if (!application.ok) {
        for (const entry of application.errors) rowErrors[entry.polityKey] = entry.errors;
        throw new Error("One or more reviewed political proposals no longer validate against current scenario canon. Nothing was applied.");
      }
      if (!application.applied.length) {
        session.progress = "Selected proposals no longer fill missing fields; scenario canon was left unchanged.";
        return { rowErrors, saved: null };
      }
      saved = await lib.saveScenario(session.details.scenario.id, {
        world: {
          ...freshWorld,
          politicalActors: application.politicalActors,
        },
      });
      session.lastApplied = application.applied;
      session.progress = `Applied political state to ${application.applied.length} polity/polities.`;
      session.result = null;
      setRows(session, []);
      session.expandedPolity = "";
    } catch (nextError) {
      session.error = nextError?.message || String(nextError);
      session.rows = session.rows.map((row) => (rowErrors[row.polityKey] ? { ...row, sourceErrors: rowErrors[row.polityKey] } : row));
    } finally {
      session.applying = false;
    }
    return { rowErrors, saved };
  };

  const genReply = async (session, saved = null, extra = {}) => {
    if (saved) {
      session.details = saved?.data?.world ? saved : await loadDetails(session.scenarioId);
      session.scenarioTags = await lib.downloadScenarioJsonAsset(session.scenarioId, "tags").catch(() => session.scenarioTags);
      computeInputs(session);
      await loadCheckpointInto(session);
    }
    return {
      view: genView(session, { withRows: true }),
      ...(saved ? { details: detailsView(saved) } : {}),
      ...extra,
    };
  };

  const genMethod = (work) => async (args = {}, context = {}) => {
    const session = sessionOf(args.scenarioId);
    takeForm(session, args.form);
    if (!session.details) await refreshSession(session);
    return work(session, args, context);
  };

  const authorRows = (world) => engine.polScenarioPolities.collectScenarioPoliticalPolities(world).map((entry) => ({
    polityKey: entry.polityKey,
    label: actorLabel(world, entry.polityKey),
    hasActor: Boolean(world?.politicalActors?.byPolity?.[entry.polityKey]),
  })).sort((a, b) => a.label.localeCompare(b.label));

  const authorDraft = (world, polityKey) => {
    const key = clean(polityKey);
    const actor = key ? world?.politicalActors?.byPolity?.[key] || null : null;
    const snapshot = key ? engine.polCountryEditor.politicalDebugSnapshotFromWorld(world, key) : null;
    return {
      polityKey: key,
      label: key ? actorLabel(world, key) : "",
      hasActor: Boolean(actor),
      draft: engine.polCountryEditor.politicalActorToEditorState(actor),
      debug: {
        decisionAuthority: JSON.stringify(snapshot?.decisionAuthority ?? null, null, 2),
        derivedDisposition: JSON.stringify(snapshot?.derivedDisposition ?? null, null, 2),
        actor: JSON.stringify(snapshot?.actor ?? null, null, 2),
      },
    };
  };

  const authorState = (world, polityKey) => {
    const rows = authorRows(world);
    return {
      rows,
      actorCount: Object.keys(world?.politicalActors?.byPolity || {}).length,
      ...authorDraft(world, polityKey),
    };
  };

  const institutionState = (scenarioId, world) => {
    const authoring = engine.polInstitutionAuthoring;
    const rows = authoring.institutionAuthoringRows(world);
    const polities = engine.polScenarioPolities;
    const polityOptions = polities.collectScenarioPoliticalPolities(world)
      .filter((entry) => entry.active !== false)
      .map((entry) => {
        const override = world?.polityOverrides?.[entry.polityKey] || {};
        const label = clean(override?.name) || clean(entry.polityKey);
        const aliases = [entry.polityKey, label, ...(Array.isArray(override?.aliases) ? override.aliases : [])]
          .map((value) => clean(value))
          .filter(Boolean);
        return { polityKey: entry.polityKey, label, aliases };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    const resolverAliases = {};
    for (const [rawKey, rawOverride] of Object.entries(world?.polityOverrides ?? {})) {
      const key = clean(rawKey);
      if (!key || /^(NA|XCA|Z0[1-9])$/i.test(key)) continue;
      resolverAliases[key.toLocaleLowerCase()] = key;
      const override = rawOverride && typeof rawOverride === "object" && !Array.isArray(rawOverride) ? rawOverride : {};
      for (const token of [override.name, ...(Array.isArray(override.aliases) ? override.aliases : [])]) {
        const alias = clean(token);
        if (alias) resolverAliases[alias.toLocaleLowerCase()] = key;
      }
    }
    const roster = authoring.institutionMemberRoster(world);
    const known = new Set(roster);
    for (const override of Object.values(world?.polityOverrides ?? {})) {
      if (!override || typeof override !== "object") continue;
      for (const token of [override.name, ...(Array.isArray(override.aliases) ? override.aliases : [])]) {
        if (trim(token)) known.add(trim(token));
      }
    }
    return {
      scenarioId: clean(scenarioId),
      rows: rows.map((institution) => ({
        id: institution.id,
        name: institution.name || "",
        shortName: institution.shortName || "",
        kind: institution.kind || "",
        memberCount: Array.isArray(institution.members) ? institution.members.length : 0,
        draft: authoring.institutionAuthoringDraft(institution),
      })),
      totalMembers: rows.reduce((total, institution) => total + (Array.isArray(institution.members) ? institution.members.length : 0), 0),
      kinds: engine.polInstitutions.INSTITUTION_KINDS.map((kind) => [kind, kindLabel(kind)]),
      badges: Object.entries(engine.polInstitutionLogos.BUILTIN_INSTITUTION_LOGOS).map(([key, url]) => [key, url]),
      polityOptions,
      roster,
      known: [...known],
      resolverAliases,
      checkUnmatched: Array.isArray(world?.ownerCodes) && world.ownerCodes.length > 0 && roster.length > 0,
      emptyDraft: authoring.institutionAuthoringDraft(null),
    };
  };

  return {
    "editor.politics.gen.open": async ({ scenarioId, form = {} } = {}) => {
      const session = freshSession(scenarioId);
      sessions.set(session.scenarioId, session);
      takeForm(session, form);
      await refreshSession(session);
      return { view: genView(session, { withRows: true }) };
    },
    "editor.politics.gen.refresh": genMethod(async (session) => {
      await refreshSession(session);
      return { view: genView(session, { withRows: true }) };
    }),
    "editor.politics.gen.view": genMethod(async (session) => ({ view: genView(session, { withRows: true }) })),
    "editor.politics.gen.settings": genMethod(async (session, { mode, allowRosterExpansion, callBudget }) => {
      if (mode !== undefined && modeOptions().some((entry) => entry.id === mode) && mode !== session.mode) {
        session.mode = mode;
        computeInputs(session);
      }
      if (allowRosterExpansion !== undefined) session.allowRosterExpansion = allowRosterExpansion === true;
      if (callBudget !== undefined) session.v2CallBudget = Math.max(1, Math.trunc(Number(callBudget) || 1));
      return { view: genView(session, { withRows: true }) };
    }),
    "editor.politics.gen.run": genMethod(async (session, { retryDeferred = false }, { signal, id }) => {
      session.callId = Number(id) || 0;
      await generatePoliticalWorld(session, { retryDeferred: retryDeferred === true }, signal);
      return genReply(session);
    }),
    "editor.politics.gen.apply": genMethod(async (session) => genReply(session, await applyPoliticalWorld(session))),
    "editor.politics.gen.allowMore": genMethod(async (session) => {
      await allowMoreV2Calls(session);
      return genReply(session);
    }),
    "editor.politics.gen.discard": genMethod(async (session) => {
      await discardV2Checkpoint(session);
      return genReply(session);
    }),
    "editor.politics.gen.applyComplete": genMethod(async (session) => genReply(session, await applyCompleteV2Work(session))),
    "editor.politics.gen.generate": genMethod(async (session, { test = false }, { signal, id }) => {
      session.callId = Number(id) || 0;
      await generateProposals(session, test === true, signal);
      return genReply(session);
    }),
    "editor.politics.gen.repair": genMethod(async (session, _args, { signal, id }) => {
      session.callId = Number(id) || 0;
      await repairGoverningAlignment(session, signal);
      return genReply(session);
    }),
    "editor.politics.gen.recheck": genMethod(async (session, { rows }, { signal, id }) => {
      session.callId = Number(id) || 0;
      mergeRowEdits(session, rows);
      await recheckHistory(session, signal);
      return genReply(session);
    }),
    "editor.politics.gen.restore": genMethod(async (session, { path: file }) => {
      await restoreRunLog(session, clean(file));
      return genReply(session);
    }),
    "editor.politics.gen.save": genMethod(async (session, { kind, path: file, rows }) => {
      mergeRowEdits(session, rows);
      await saveFile(session, clean(kind), clean(file));
      return genReply(session);
    }),
    "editor.politics.gen.applySelected": genMethod(async (session, { rows }) => {
      const { rowErrors, saved } = await applySelected(session, rows);
      return genReply(session, saved, { rowErrors });
    }),
    "editor.politics.author.load": async ({ scenarioId, polityKey = "" } = {}) => {
      const details = await loadDetails(scenarioId);
      const world = details?.data?.world || {};
      const rows = authorRows(world);
      const key = clean(polityKey) && rows.some((row) => row.polityKey === clean(polityKey)) ? clean(polityKey) : (rows[0]?.polityKey || "");
      return {
        ...authorState(world, key),
        traits: engine.polTraits.POLITICAL_TRAIT_REGISTRY.map((trait) => ({
          key: trait.key,
          label: trait.label,
          description: trait.description,
          min: trait.min,
          max: trait.max,
          aliases: [...trait.aliases],
        })),
        representations: Object.values(engine.polActors.POLITICAL_REPRESENTATIONS).map((value) => [value, representationLabel(value)]),
        regimes: engine.polActors.POLITICAL_REGIME_CHARACTERS.map((value) => [value, representationLabel(value)]),
      };
    },
    "editor.politics.author.draft": async ({ scenarioId, polityKey = "" } = {}) => {
      const details = await loadDetails(scenarioId);
      return authorState(details?.data?.world || {}, polityKey);
    },
    "editor.politics.author.save": async ({ scenarioId, polityKey, draft } = {}) => {
      const key = clean(polityKey);
      if (!clean(scenarioId) || !key) return { message: "" };
      try {
        const details = await loadDetails(scenarioId);
        const nextWorld = clone(details?.data?.world || {}) || {};
        const actor = engine.polCountryEditor.applyPoliticalEditorStateToWorld(nextWorld, key, draft || {});
        const nextDetails = await lib.saveScenario(clean(scenarioId), {
          worldPatch: { politicalActors: nextWorld.politicalActors },
        });
        const world = nextDetails?.data?.world || {};
        const state = authorState(world, key);
        return {
          ...state,
          draft: engine.polCountryEditor.politicalActorToEditorState(actor),
          details: detailsView(nextDetails),
          message: "Political World saved.",
          saved: true,
        };
      } catch (error) {
        return { message: error?.message || "Could not save Political World.", saved: false };
      }
    },
    "editor.politics.author.delete": async ({ scenarioId, polityKey } = {}) => {
      const key = clean(polityKey);
      if (!clean(scenarioId) || !key) return { message: "" };
      try {
        const details = await loadDetails(scenarioId);
        const world = details?.data?.world || {};
        const removed = engine.polPolityRename.removePoliticalActorFromWorld(clone(world) || {}, key);
        if (!removed.removedKey) return { message: "This polity has no Political World profile to delete.", saved: false };
        const nextDetails = await lib.saveScenario(clean(scenarioId), {
          worldPatch: { politicalActors: removed.world.politicalActors },
        });
        const nextWorld = nextDetails?.data?.world || {};
        return {
          ...authorState(nextWorld, key),
          draft: engine.polCountryEditor.politicalActorToEditorState(null),
          details: detailsView(nextDetails),
          message: "Political World profile deleted.",
          saved: true,
        };
      } catch (error) {
        return { message: error?.message || "Could not delete Political World profile.", saved: false };
      }
    },
    "editor.politics.inst.load": async ({ scenarioId } = {}) => {
      const details = await loadDetails(scenarioId);
      return institutionState(scenarioId, details?.data?.world || {});
    },
    "editor.politics.inst.save": async ({ scenarioId, draft = {}, pendingLogoDataUrl = "" } = {}) => {
      const id = clean(scenarioId);
      try {
        const details = await loadDetails(id);
        const world = details?.data?.world || {};
        const authoring = engine.polInstitutionAuthoring;
        const result = authoring.upsertScenarioInstitution(world, draft);
        if (result.error) throw new Error(result.error);
        const institutionId = result.institution.id;
        const storedLogos = await lib.downloadScenarioJsonAsset(id, "institutionLogos") || {};
        const nextStoredLogos = storedLogos && typeof storedLogos === "object" && !Array.isArray(storedLogos)
          ? { ...storedLogos }
          : {};
        if (pendingLogoDataUrl) nextStoredLogos[institutionId] = pendingLogoDataUrl;
        else if (result.institution.logoAsset !== true) delete nextStoredLogos[institutionId];
        if (pendingLogoDataUrl || Object.hasOwn(storedLogos || {}, institutionId)) {
          await lib.uploadScenarioAsset(
            id,
            "institutionLogos",
            new Blob([JSON.stringify(nextStoredLogos)], { type: "application/json" }),
          );
        }
        const nextDetails = await lib.saveScenario(id, {
          worldPatch: { institutions: result.world.institutions },
        });
        return {
          ...institutionState(id, nextDetails?.data?.world || {}),
          selectedId: result.institution.id,
          draft: authoring.institutionAuthoringDraft(result.institution),
          details: detailsView(nextDetails),
          message: "Institution saved to scenario canon.",
          saved: true,
        };
      } catch (error) {
        return { message: error?.message || "Could not save institution.", saved: false };
      }
    },
    "editor.politics.inst.delete": async ({ scenarioId, institutionId } = {}) => {
      const id = clean(scenarioId);
      try {
        const details = await loadDetails(id);
        const world = details?.data?.world || {};
        const authoring = engine.polInstitutionAuthoring;
        const rows = authoring.institutionAuthoringRows(world);
        const selected = rows.find((entry) => entry.id === trim(institutionId)) || null;
        if (!selected) return { message: "", saved: false };
        const label = selected.name || selected.id;
        const result = authoring.removeScenarioInstitution(world, selected.id);
        if (result.error) throw new Error(result.error);
        const storedLogos = await lib.downloadScenarioJsonAsset(id, "institutionLogos") || {};
        if (storedLogos && typeof storedLogos === "object" && !Array.isArray(storedLogos) && Object.hasOwn(storedLogos, selected.id)) {
          const nextStoredLogos = { ...storedLogos };
          delete nextStoredLogos[selected.id];
          await lib.uploadScenarioAsset(
            id,
            "institutionLogos",
            new Blob([JSON.stringify(nextStoredLogos)], { type: "application/json" }),
          );
        }
        const nextDetails = await lib.saveScenario(id, {
          worldPatch: { institutions: result.world.institutions },
        });
        return {
          ...institutionState(id, nextDetails?.data?.world || {}),
          selectedId: "",
          details: detailsView(nextDetails),
          message: `${label} deleted from the scenario.`,
          saved: true,
        };
      } catch (error) {
        return { message: error?.message || "Could not delete the institution.", saved: false };
      }
    },
  };
};
