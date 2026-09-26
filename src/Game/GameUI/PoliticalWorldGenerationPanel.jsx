import React, { useEffect, useMemo, useRef, useState } from "react";

import { loadScenarioDetails, saveScenario } from "../../runtime/library.js";
import { saveBlobToDisk } from "../../runtime/saveFile.js";
import { acceptFor } from "../../runtime/fileAccept.js";
import { activeReferencePackIds, normalizeCanonContext, readScenarioCanon } from "../../runtime/scenarioCanon.js";
import {
  POLITICAL_WORLD_CAPABILITY,
  politicalWorldCapability,
  politicalWorldCapabilityLabel,
} from "../../runtime/politicalWorldCapability.js";
import {
  POLITICAL_WORLD_GENERATION_MODES,
  applyReviewedPoliticalGeneration,
  buildScenarioPoliticalGenerationInputs,
  buildScenarioPoliticalGenerationTestInputs,
} from "../../runtime/politicalWorldGenerationReview.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

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

const panelStyle = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  marginBottom: "0.95rem",
  padding: "0.9rem",
};

const buttonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "rgba(246,246,248,0.94)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.8rem",
  fontWeight: 700,
  justifyContent: "center",
  minHeight: "2.1rem",
  padding: "0 0.85rem",
};

const selectStyle = {
  background: "rgba(255,255,255,0.05)",
  colorScheme: "dark",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  color: "#f8fafc",
  minHeight: "2.2rem",
  padding: "0 0.6rem",
};

const textareaStyle = {
  background: "rgba(0,0,0,0.2)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  color: "#e5e7eb",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "0.72rem",
  lineHeight: 1.45,
  minHeight: "13rem",
  padding: "0.75rem",
  resize: "vertical",
  width: "100%",
};

const MODE_OPTIONS = [
  {
    id: POLITICAL_WORLD_GENERATION_MODES.BALANCED,
    label: "Balanced",
    description: "Player/belligerents full; existing actors rich; other sovereign polities standard.",
  },
  {
    id: POLITICAL_WORLD_GENERATION_MODES.SIMULATION_READY,
    label: "Simulation-ready",
    description: "Player/belligerents full; every other sovereign polity rich enough for native response/disposition simulation.",
  },
  {
    id: POLITICAL_WORLD_GENERATION_MODES.BASIC,
    label: "Basic",
    description: "Player/belligerents full; other sovereign polities receive standard identity only.",
  },
];

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

const patchSummary = (text) => {
  try {
    const patch = JSON.parse(text);
    const system = clean(patch?.politicalSystem?.type || patch?.politicalSystem?.representation);
    const parties = Array.isArray(patch?.parties) ? patch.parties.length : 0;
    const blocs = Array.isArray(patch?.powerBlocs) ? patch.powerBlocs.length : 0;
    const head = clean(patch?.government?.headOfGovernment?.name || patch?.government?.headOfGovernment || patch?.leader?.name || patch?.leader);
    const ruling = Array.isArray(patch?.government?.rulingPartyIds) ? patch.government.rulingPartyIds.map(clean).filter(Boolean) : [];
    const coalition = Array.isArray(patch?.government?.coalitionPartyIds) ? patch.government.coalitionPartyIds.map(clean).filter(Boolean) : [];
    return [
      system,
      head && `leader: ${head}`,
      ruling.length && `government: ${ruling.join(", ")}`,
      coalition.length && `coalition: ${coalition.join(", ")}`,
      parties && `${parties} parties`,
      blocs && `${blocs} blocs`,
    ].filter(Boolean).join(" · ") || "Structured political patch";
  } catch {
    return "Invalid JSON edit";
  }
};

const savedScenarioDate = (details) => clean(details?.data?.game?.startDate || details?.data?.game?.gameDate);

const formatDuration = (milliseconds) => {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  if (!Number.isFinite(seconds)) return "Estimating…";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
};

// The progress and checkpoint lines. Each is ONE string in an element of its
// own: the translator (runtime/translator.js) reads an element as one sentence
// only when every child is a text node, so a line break element between lines
// made it look up each piece alone ("remaining ·", "deferred ·"), and a
// language pack cannot translate a plural "s" on its own, so every count is a
// whole phrase ("1 unresolved item" / "{{unresolved}} unresolved items").
const AiCallsTotal = ({ calls, ceiling, style }) => (
  <span style={style}>
    {ceiling
      ? `${calls}/${ceiling} AI calls total`
      : calls === 1 ? "1 AI call total" : `${calls} AI calls total`}
  </span>
);

const LiveProgressCounts = ({ info, polityCount }) => {
  const total = info.totalPolities ?? polityCount;
  const actors = info.resolvedPolities ?? 0;
  const memberships = info.memberships ?? 0;
  const institutionsResolved = info.membershipInstitutionsResolved ?? 0;
  const institutionsTotal = info.membershipInstitutionsTotal;
  const alignment = info.governingAlignment ?? 0;
  const power = info.powerEvidence ?? 0;
  const verified = info.verified ?? 0;
  const verificationTargets = info.verificationTargets ?? 0;
  const pending = info.pendingJobs ?? 0;
  const deferred = info.failedJobs ?? 0;
  const unresolved = info.unresolvedCount ?? 0;
  return (
    <>
      <div>
        {`Actors: ${actors}/${total} · memberships: ${memberships}/${total}${institutionsTotal ? ` (${institutionsResolved}/${institutionsTotal} institutions resolved)` : ""} · alignment: ${alignment}/${total} · power: ${power}/${total}${info.verificationRequired ? ` · verified: ${verified}/${verificationTargets}` : ""}`}
      </div>
      <div>
        {`Work queue: ${pending} remaining · ${deferred} deferred · ${unresolved === 1 ? "1 unresolved item" : `${unresolved} unresolved items`}`}
      </div>
    </>
  );
};

const BatchProgressDetails = ({ info, etaMs }) => {
  const phase = info?.phase;
  const inRescue = ["memberships-rescue", "memberships-recovery-split", "memberships-tiny-retry"].includes(phase);
  const batch = (info?.batchIndex ?? 0) + 1;
  const batches = info?.totalBatches ?? "?";
  const attempt = info?.attempt ?? 1;
  const attempts = info?.maxAttempts ?? 2;
  const confirmed = info?.verifiedTotal ?? 0;
  const corrected = info?.correctedTotal ?? 0;
  const accepted = info?.acceptedTotal ?? 0;
  const failed = info?.failedTotal ?? 0;
  return (
    <>
      <div>
        <span>
          {phase === "historical-verification"
            ? (info?.verificationPass === "collision-recheck" ? "Timeline-canon collision re-check" : "Historical check")
            : (phase === "memberships-rescue"
              ? "Geopolitical unresolved-only rescue"
              : (phase === "memberships-tiny-retry"
                ? "Geopolitical final tiny retry"
                : (info?.generationMode === "quantitative-landscape-fast"
                  ? "Landscape backfill"
                  : (info?.generationMode === "governing-alignment-fast"
                    ? "Governing alignment"
                    : (info?.generationMode === "geopolitical-fast" ? "Geopolitical baseline" : "Generation")))))}
        </span>
        {!inRescue && <span>{` · batch ${batch} of ${batches} · attempt ${attempt} of ${attempts}`}</span>}
        <span>
          {phase === "historical-verification"
            ? ` · ${confirmed} confirmed · ${corrected} corrected · ${failed} failed`
            : ` · ${accepted} accepted · ${failed} failed`}
        </span>
      </div>
      <div>{etaMs == null ? "Estimated remaining: estimating…" : `Estimated remaining: ${formatDuration(etaMs)}`}</div>
    </>
  );
};

const CheckpointCounts = ({ checkpoint, pending, deferred, polityCount }) => {
  const counts = checkpoint.quality?.counts ?? {};
  const polities = counts.polities ?? polityCount;
  const calls = checkpoint.modelCalls ?? 0;
  const ceiling = checkpoint.totalModelCallCeiling;
  const actors = counts.politicalActors ?? 0;
  const memberships = counts.memberships ?? 0;
  const alignment = counts.governingAlignment ?? 0;
  const institutions = counts.institutions ?? 0;
  const agreements = counts.agreements ?? 0;
  const power = counts.powerEvidence ?? 0;
  return (
    <>
      <div>{`Work queue: ${pending} remaining${deferred ? ` · ${deferred} deferred` : ""} · AI calls: ${calls}${ceiling ? `/${ceiling}` : ""}`}</div>
      <div>{`Political Actors: ${actors}/${polities} · memberships: ${memberships}/${polities} · governing alignment: ${alignment}/${polities}`}</div>
      <div>{`Institutions: ${institutions} · agreements: ${agreements} · power evidence: ${power}/${polities}`}</div>
    </>
  );
};

const safeFileToken = (value) => clean(value)
  .replace(/[^a-z0-9._-]+/gi, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80) || "scenario";

// runtime/saveFile.js: a download in a browser, the share sheet in the app.
// Callers do not wait on it, so a save that fails is logged, not thrown.
const downloadJsonFile = (filename, value) =>
  saveBlobToDisk(new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" }), filename)
    .catch((error) => console.warn(`[political world] could not save ${filename}: ${error?.message || error}`));
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

const PoliticalWorldGenerationPanel = ({ details, formState, onDetailsChange } = {}) => {
  const [mode, setMode] = useState(POLITICAL_WORLD_GENERATION_MODES.BALANCED);
  const [allowRosterExpansion, setAllowRosterExpansion] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [progressInfo, setProgressInfo] = useState(null);
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [expandedPolity, setExpandedPolity] = useState("");
  const [filter, setFilter] = useState("");
  const [lastApplied, setLastApplied] = useState(null);
  const [runKind, setRunKind] = useState("balanced");
  const [geopoliticalResult, setGeopoliticalResult] = useState(null);
  const [geopoliticalApplying, setGeopoliticalApplying] = useState(false);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [v2Checkpoint, setV2Checkpoint] = useState(null);
  const [v2CallBudget, setV2CallBudget] = useState(20);
  const abortRef = useRef(null);
  const restoreRunLogInputRef = useRef(null);
  const generationStartedAtRef = useRef(0);
  const progressPhaseRef = useRef("");

  const inputs = useMemo(() => {
    try {
      return buildScenarioPoliticalGenerationInputs(details, { mode, maxBatchSize: 8 });
    } catch {
      return null;
    }
  }, [details, mode]);

  const testInputs = useMemo(() => {
    try {
      return buildScenarioPoliticalGenerationTestInputs(details, { maxBatchSize: 5, count: 15 });
    } catch {
      return null;
    }
  }, [details]);

  const scenarioDate = inputs?.scenarioDate ?? "";
  const unsavedDate = clean(formState?.gameDate);
  const dateMismatch = Boolean(unsavedDate && scenarioDate && unsavedDate !== scenarioDate);
  const polityCount = inputs?.polities?.length ?? 0;
  const actorCount = Object.keys(inputs?.politicalActors?.byPolity ?? {}).length;
  const politicalWorldState = politicalWorldCapability(inputs?.world ?? details?.data?.world ?? {}, { polityCount });
  const politicalWorldStatus = politicalWorldCapabilityLabel(politicalWorldState);
  const politicalWorldAbsent = politicalWorldState.status === POLITICAL_WORLD_CAPABILITY.ABSENT;
  const politicalWorldSparse = politicalWorldState.status === POLITICAL_WORLD_CAPABILITY.SPARSE;
  const politicalWorldTone = politicalWorldAbsent
    ? { background: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.28)", color: "#fde68a" }
    : politicalWorldSparse
      ? { background: "rgba(124,58,237,0.10)", border: "rgba(167,139,250,0.28)", color: "#ede9fe" }
      : { background: "rgba(34,197,94,0.09)", border: "rgba(74,222,128,0.24)", color: "#bbf7d0" };
  const selectedCount = rows.filter((row) => row.status === "valid" && row.selected).length;
  const pipelineBlocked = (pipelineResult?.blockingErrors?.length ?? 0) > 0;
  const pipelineReady = Boolean(pipelineResult?.complete && !pipelineBlocked);
  const v2Ready = Boolean(v2Checkpoint?.quality?.canonicalReady);
  const applyReady = runKind === "political-world-v2" ? v2Ready : pipelineReady;
  const v2Jobs = Object.values(v2Checkpoint?.jobs ?? {});
  const v2FailedJobs = Number(v2Checkpoint?.worklistSummary?.failed) || v2Jobs.filter((job) => job?.status === "failed").length;
  const v2PendingJobs = v2Checkpoint?.worklistSummary
    ? (Number(v2Checkpoint.worklistSummary.pending) || 0) + (Number(v2Checkpoint.worklistSummary.running) || 0)
    : v2Jobs.filter((job) => job?.status === "pending" || job?.status === "running").length;
  const v2Unresolved = Array.isArray(v2Checkpoint?.quality?.unresolved) ? v2Checkpoint.quality.unresolved : [];
  const progressTotal = Number(progressInfo?.totalPolities) || 0;
  const progressResolved = Math.max(0, Math.min(progressTotal, Number(progressInfo?.resolvedPolities) || 0));
  const progressPercent = progressTotal ? Math.round((progressResolved / progressTotal) * 100) : 0;
  const progressEtaMs = progressResolved > 0 && Number(progressInfo?.elapsedMs) > 0
    ? (Number(progressInfo.elapsedMs) / progressResolved) * (progressTotal - progressResolved)
    : null;
  const progressSampleError = normalizeProgressSampleError(progressInfo?.sampleError);
  const visibleRows = rows.filter((row) => !clean(filter) || row.polityKey.toLocaleLowerCase().includes(clean(filter).toLocaleLowerCase()));

  useEffect(() => {
    let cancelled = false;
    const scenarioId = clean(details?.scenario?.id);
    if (!scenarioId || !scenarioDate || !inputs?.world) {
      setV2Checkpoint(null);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const [
          { loadPoliticalWorldV2Checkpoint, savePoliticalWorldV2Checkpoint },
          { buildPoliticalWorldInputFingerprint, checkpointMatchesInput },
          { rebasePoliticalWorldV2ReferenceCanon },
        ] = await Promise.all([
          import("../AI/politicalWorldV2/storage.js"),
          import("../AI/politicalWorldV2/checkpoint.js"),
          import("../AI/politicalWorldV2/checkpointRebase.js"),
        ]);
        const checkpoint = await loadPoliticalWorldV2Checkpoint(scenarioId, { scenarioDate });
        const fingerprint = buildPoliticalWorldInputFingerprint({
          scenarioId,
          scenarioDate,
          world: inputs.world,
          roundZeroContext: inputs.roundZeroContext || null,
        });
        let visibleCheckpoint = checkpointMatchesInput(checkpoint, fingerprint) ? checkpoint : null;
        if (!visibleCheckpoint && checkpoint) {
          const rebased = rebasePoliticalWorldV2ReferenceCanon(checkpoint, inputs, fingerprint);
          if (rebased) {
            visibleCheckpoint = await savePoliticalWorldV2Checkpoint(rebased);
          }
        }
        if (!cancelled) {
          setV2Checkpoint(visibleCheckpoint);
          if (visibleCheckpoint) {
            setRunKind("political-world-v2");
            if (visibleCheckpoint?.pauseReason === "reference-canon-rebase") {
              setProgress("Political World generation checkpoint recovered. Canon Context changed; Resume will reconcile reference institutions without regenerating accepted Political Actors.");
            }
          }
        }
      } catch {
        if (!cancelled) setV2Checkpoint(null);
      }
    })();
    return () => { cancelled = true; };
  }, [details?.scenario?.id, scenarioDate, inputs?.world]);

  const updateRow = (polityKey, patch) => {
    setRows((current) => current.map((row) => row.polityKey === polityKey ? { ...row, ...patch } : row));
  };

  const generatePoliticalWorld = async ({ retryDeferred = false } = {}) => {
    if (!inputs || busy || applying || geopoliticalApplying) return;
    if (!inputs.scenarioDate) {
      setError("Save a valid scenario start date before generating the Political World.");
      return;
    }
    if (dateMismatch) {
      setError("The Scenario Editor date has unsaved changes. Save the scenario first so Political World generation uses the saved start date.");
      return;
    }
    if (formState?.canonContextTouched) {
      setError("Save the World tab first. Political World generation only uses saved scenario data, never unsaved editor choices.");
      return;
    }

    setBusy(true);
    setRunKind("political-world-v2");
    setError("");
    setLastApplied(null);
    setPipelineResult(null);
    setResult(null);
    setRows([]);
    setGeopoliticalResult(null);
    setProgress(v2Checkpoint ? "Resuming Political World generation checkpoint…" : "Initializing Political World generation…");
    setProgressInfo(null);
    generationStartedAtRef.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    const callsBefore = Number(v2Checkpoint?.modelCalls) || 0;
    try {
      // Always reload the saved scenario before v2 starts/resumes. Canon Context
      // is an authority boundary, so generation must never run against a stale
      // React/editor snapshot after the user has just saved universe/reference
      // settings.
      const freshDetails = await loadScenarioDetails(details?.scenario?.id);
      const freshInputs = buildScenarioPoliticalGenerationInputs(freshDetails, { mode, maxBatchSize: 8 });
      if (freshInputs.scenarioDate !== inputs.scenarioDate) {
        throw new Error(`Scenario start date changed from ${inputs.scenarioDate} to ${freshInputs.scenarioDate || "<blank>"}. Save/reload before generating Political World.`);
      }
      const editorCanonContext = normalizeCanonContext(formState?.canonContext || {});
      const savedCanon = readScenarioCanon(freshInputs.world || {});
      const editorActivePacks = activeReferencePackIds(editorCanonContext);
      const savedActivePacks = activeReferencePackIds(savedCanon.canonContext);
      if (editorActivePacks.length && (!savedCanon.initialized || editorActivePacks.some((id) => !savedActivePacks.includes(id)))) {
        throw new Error("Saved world context does not match the editor's active reference knowledge. Save the World tab once more, then retry Political World generation.");
      }

      const { generateOrResumePoliticalWorldV2 } = await import("../AI/politicalWorldV2/pipeline.js");
      const next = await generateOrResumePoliticalWorldV2({
        scenarioId: freshDetails?.scenario?.id || details?.scenario?.id,
        inputs: freshInputs,
        qualityMode: "canonical",
        maxModelCalls: Math.max(1, Math.trunc(Number(v2CallBudget) || 20)),
        allowEntityExpansion: allowRosterExpansion,
        retryDeferred,
        signal: controller.signal,
        onProgress: ({ checkpoint, summary, quality, runningJob }) => {
          setV2Checkpoint(checkpoint);
          const type = clean(runningJob?.type);
          const labels = {
            "institution-discovery": "Discovering institutions…",
            "political-actor": "Constructing Political Actors…",
            "governing-alignment": "Resolving governments and coalitions…",
            "membership-resolution": "Resolving formal institutional memberships…",
            "membership-surface": "Reconciling institution memberships…",
            "institution-membership-resolution": "Resolving one uncovered institution's complete membership…",
            "agreement-resolution": "Resolving standing agreements…",
            "power-evidence": "Calibrating geopolitical power evidence…",
            "temporal-sentinel": "Checking exact-date political identity…",
            "historical-verification": "Adjudicating timeline-canon corrections…",
          };
          if (type) setProgress(labels[type] || `Running ${type}…`);
          const counts = quality?.counts || {};
          const totalPolities = Number(counts.polities) || polityCount;
          const verificationRequired = checkpoint?.historicalVerificationRequired === true;
          const verificationTargets = verificationRequired ? (Number(counts.verificationTargets) || 0) : 0;
          const canonicalTotal = totalPolities * 4 + verificationTargets;
          const canonicalResolved = (Number(counts.politicalActors) || 0)
            + (Number(counts.memberships) || 0)
            + (Number(counts.governingAlignment) || 0)
            + (Number(counts.powerEvidence) || 0)
            + (verificationRequired ? Math.min(verificationTargets, Number(counts.verified) || 0) : 0);
          setProgressInfo({
            v2: true,
            phase: type || "checkpoint",
            failedJobs: Number(summary?.failed) || 0,
            pendingJobs: (Number(summary?.pending) || 0) + (Number(summary?.running) || 0),
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
            elapsedMs: Math.max(0, Date.now() - generationStartedAtRef.current),
          });
        },
      });
      setV2Checkpoint(next);
      const sessionCalls = Math.max(0, (Number(next.modelCalls) || 0) - callsBefore);
      if (next.quality?.canonicalReady) {
        const counts = next.quality?.counts || {};
        const referenceSummary = Number(counts.referenceInstitutionsExpected) > 0
          ? ` Reference scope: ${counts.referenceInstitutionsMaterialized ?? 0}/${counts.referenceInstitutionsExpected ?? 0} expected institutions materialized.`
          : "";
        setProgress(`Political World generation passed its quality checks: ${counts.politicalActors ?? 0}/${counts.polities ?? polityCount} Political Actors, ${counts.memberships ?? 0}/${counts.polities ?? polityCount} membership profiles, ${counts.institutions ?? 0} institutions, ${counts.agreements ?? 0} agreements and ${counts.powerEvidence ?? 0}/${counts.polities ?? polityCount} power records.${referenceSummary} ${sessionCalls} AI call(s) used this run. Review, then apply it to the scenario.`);
      } else if (next.status === "paused" && next.pauseReason === "model-call-budget") {
        setProgress(`Political World generation paused cleanly after ${sessionCalls} AI call(s) this run. Progress is saved; press Resume Generation whenever you want to continue.`);
      } else if (next.status === "paused" && next.pauseReason === "total-model-call-budget") {
        setProgress(next.lastError || "Political World generation reached its lifetime AI-call safety ceiling. Completed work is saved; inspect unresolved targets before spending more calls.");
      } else if (next.status === "paused" && next.pauseReason === "aborted") {
        setProgress("Political World generation paused. Completed work is saved.");
      } else if (next.status === "paused" && next.pauseReason === "bounded-unresolved") {
        const deferred = Number(next.worklistSummary?.failed) || 0;
        setProgress(`Political World generation deferred ${deferred} stubborn target(s) after bounded retries. Completed work is saved; normal Resume keeps those retry limits and continues independent unfinished work. Use Retry Deferred Targets only when you want another bounded attempt at the deferred set.`);
      } else if (next.status === "paused" && ["provider-quota", "provider-rate-limit", "provider-unavailable", "provider-config", "task-error"].includes(next.pauseReason)) {
        setProgress(next.lastError || "Political World generation paused because the current provider task could not complete. No unresolved polity was penalized for this provider failure.");
      } else {
        const unresolved = next.quality?.unresolved?.length ?? 0;
        const blockers = next.quality?.blockingErrors?.length ?? 0;
        setProgress(`Political World generation stopped with ${unresolved} unresolved item(s) and ${blockers} blocking job error(s). Completed work remains saved.`);
      }
    } catch (nextError) {
      if (nextError?.name === "AbortError") setProgress("Political World generation paused. Completed work remains saved.");
      else setError(nextError?.message || String(nextError));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const generatePoliticalWorldLegacy = async () => {
    if (!inputs || busy || applying || geopoliticalApplying) return;
    if (!inputs.scenarioDate) {
      setError("Save a valid scenario start date before generating the Political World.");
      return;
    }
    if (dateMismatch) {
      setError("The Scenario Editor date has unsaved changes. Save the scenario first so Political World generation uses the saved scenario start date.");
      return;
    }

    setBusy(true);
    setRunKind("political-world-unified");
    setError("");
    setLastApplied(null);
    setPipelineResult(null);
    setResult(null);
    setRows([]);
    setGeopoliticalResult(null);
    setProgress("Generating Political Actors…");
    setProgressInfo(null);
    progressPhaseRef.current = "politics";
    generationStartedAtRef.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { generatePoliticalWorldPipeline } = await import("../AI/politicalWorldPipeline.js");
      const nextResult = await generatePoliticalWorldPipeline({
        ...inputs,
        allowEntityExpansion: allowRosterExpansion,
        signal: controller.signal,
        onProgress: ({
          stage = "politics", phase = "generation", generationMode = "", verificationPass = "initial",
          batchIndex, totalBatches, attempt, maxAttempts, accepted = [], unresolved = [],
          resolvedPolities, totalPolities, acceptedTotal, failedTotal, verifiedTotal, correctedTotal, sampleError, warning,
        }) => {
          const progressPhase = `${stage}:${phase}`;
          if (progressPhaseRef.current !== progressPhase) {
            progressPhaseRef.current = progressPhase;
            generationStartedAtRef.current = Date.now();
          }
          if (stage === "politics") {
            setProgress(phase === "historical-verification"
              ? (verificationPass === "collision-recheck" ? "Re-checking conflicting officeholders…" : "Checking timeline canon…")
              : (generationMode === "quantitative-landscape-fast" ? "Building quantitative political landscapes…" : "Generating Political Actors…"));
          } else if (stage === "governing-alignment") {
            setProgress("Resolving governing parties and coalitions…");
          } else if (stage === "geopolitics") {
            if (phase === "memberships-rescue") setProgress("Rescuing unresolved institutional memberships…");
            else if (phase === "memberships-recovery-split") setProgress("Recovering unresolved memberships in smaller bounded chunks…");
            else if (phase === "memberships-tiny-retry") setProgress("Retrying final unresolved institutional memberships…");
            else setProgress("Generating institutions, memberships, power calibration and standing agreements…");
          }
          setProgressInfo({
            phase,
            pipelineStage: stage,
            generationMode,
            verificationPass,
            batchIndex,
            totalBatches,
            attempt: attempt ?? 1,
            maxAttempts: maxAttempts ?? 1,
            accepted: Array.isArray(accepted) ? accepted.length : Number(accepted) || 0,
            unresolved: Array.isArray(unresolved) ? unresolved.length : Number(unresolved) || 0,
            resolvedPolities: Number(resolvedPolities) || 0,
            totalPolities: Number(totalPolities) || 0,
            acceptedTotal: Number(acceptedTotal ?? resolvedPolities) || 0,
            failedTotal: Number(failedTotal) || 0,
            verifiedTotal,
            correctedTotal,
            sampleError: sampleError || (warning ? { polityKey: "", errors: [warning] } : null),
            elapsedMs: Math.max(0, Date.now() - generationStartedAtRef.current),
          });
        },
      });
      setPipelineResult(nextResult);
      if (nextResult.complete) {
        const politicsAccepted = nextResult.politics?.generatedPolities ?? 0;
        const alignmentAccepted = nextResult.governingAlignment?.generatedPolities ?? 0;
        const geo = nextResult.geopolitics;
        setProgress(`Political World ready for review: ${politicsAccepted} political patch(es), ${alignmentAccepted} governing-alignment patch(es), ${geo?.records?.length ?? 0} membership/regime profiles, ${geo?.institutionCatalog?.length ?? 0} institutions, ${geo?.powerCalibration?.length ?? 0} power inputs and ${geo?.agreements?.length ?? 0} standing agreements. Nothing has been applied yet.`);
      } else {
        setProgress(`Political World generation stopped fail-closed with ${nextResult.blockingErrors?.length ?? 0} blocking error(s). Nothing has been applied.`);
      }
    } catch (nextError) {
      if (nextError?.name === "AbortError") setProgress("Political World generation cancelled. Nothing was applied.");
      else setError(nextError?.message || String(nextError));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const retryPipelineGeopoliticsOnly = async () => {
    if (!inputs || !pipelineResult?.politics || !pipelineResult?.governingAlignment || busy || applying || geopoliticalApplying) return;
    if (dateMismatch) {
      setError("The Scenario Editor date has unsaved changes. Save the scenario first so geopolitical retry uses the saved scenario start date.");
      return;
    }
    setBusy(true);
    setRunKind("political-world-unified");
    setError("");
    setProgress("Retrying geopolitical substrate only…");
    setProgressInfo(null);
    progressPhaseRef.current = "geopolitics";
    generationStartedAtRef.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { resumePoliticalWorldPipelineGeopolitics } = await import("../AI/politicalWorldPipeline.js");
      const nextResult = await resumePoliticalWorldPipelineGeopolitics({
        ...inputs,
        priorResult: pipelineResult,
        signal: controller.signal,
        onProgress: ({ stage = "geopolitics", phase = "generation", batchIndex, totalBatches, resolvedPolities, totalPolities, warning }) => {
          const progressPhase = `${stage}:${phase}`;
          if (progressPhaseRef.current !== progressPhase) {
            progressPhaseRef.current = progressPhase;
            generationStartedAtRef.current = Date.now();
          }
          if (phase === "memberships-rescue") setProgress("Rescuing unresolved institutional memberships…");
          else if (phase === "memberships-recovery-split") setProgress("Recovering unresolved memberships in smaller bounded chunks…");
          else if (phase === "memberships-tiny-retry") setProgress("Retrying final unresolved institutional memberships…");
          else setProgress("Retrying geopolitical institutions, memberships, power calibration and agreements…");
          setProgressInfo({
            phase,
            pipelineStage: "geopolitics",
            batchIndex,
            totalBatches,
            resolvedPolities: Number(resolvedPolities) || 0,
            totalPolities: Number(totalPolities) || 0,
            acceptedTotal: Number(resolvedPolities) || 0,
            sampleError: warning ? { polityKey: "", errors: [warning] } : null,
            elapsedMs: Math.max(0, Date.now() - generationStartedAtRef.current),
          });
        },
      });
      setPipelineResult(nextResult);
      if (nextResult.complete) {
        setProgress(`Geopolitical retry complete: ${nextResult.geopolitics?.records?.length ?? 0} membership/regime profiles are staged. Political Actors and governing alignment were reused without regeneration. Review, then apply it to the scenario.`);
      } else {
        setProgress(`Geopolitical retry stopped fail-closed with ${nextResult.blockingErrors?.length ?? 0} blocking error(s). Political Actors and governing alignment were not regenerated.`);
      }
    } catch (nextError) {
      if (nextError?.name === "AbortError") setProgress("Geopolitical retry cancelled. Nothing was applied.");
      else setError(nextError?.message || String(nextError));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const applyPoliticalWorld = async () => {
    if (!details?.scenario?.id || !applyReady || busy || applying || geopoliticalApplying) return;
    setApplying(true);
    setError("");
    try {
      const freshDetails = await loadScenarioDetails(details.scenario.id);
      const freshDate = savedScenarioDate(freshDetails);

      if (runKind === "political-world-v2") {
        if (!v2Checkpoint) throw new Error("Political World generation checkpoint is missing.");
        if (freshDate !== v2Checkpoint.scenarioDate) {
          throw new Error(`Scenario start date changed from ${v2Checkpoint.scenarioDate} to ${freshDate || "<blank>"}. Resume from a fresh v2 checkpoint.`);
        }
        const { applyPoliticalWorldV2Checkpoint, discardPoliticalWorldV2Checkpoint } = await import("../AI/politicalWorldV2/pipeline.js");
        const freshInputs = buildScenarioPoliticalGenerationInputs(freshDetails, { mode, maxBatchSize: 8 });
        const world = applyPoliticalWorldV2Checkpoint({
          checkpoint: v2Checkpoint,
          freshWorld: freshDetails?.data?.world ?? {},
          freshRoundZeroContext: freshInputs.roundZeroContext || null,
          scenarioId: details.scenario.id,
          scenarioDate: freshDate,
        });
        const saved = await saveScenario(details.scenario.id, { world });
        await discardPoliticalWorldV2Checkpoint(details.scenario.id);
        onDetailsChange?.(saved);
        const counts = v2Checkpoint.quality?.counts || {};
        setProgress(`Applied Political World to the scenario: ${counts.politicalActors ?? 0} Political Actors, ${counts.institutions ?? 0} institutions, ${counts.agreements ?? 0} standing agreements and ${counts.powerEvidence ?? 0} power records.`);
        setV2Checkpoint(null);
        setProgressInfo(null);
        return;
      }

      if (freshDate !== pipelineResult.scenarioDate) {
        throw new Error(`Scenario start date changed from ${pipelineResult.scenarioDate} to ${freshDate || "<blank>"}. Regenerate the Political World.`);
      }
      const { applyPoliticalWorldPipeline } = await import("../AI/politicalWorldPipeline.js");
      const application = applyPoliticalWorldPipeline({
        world: freshDetails?.data?.world ?? {},
        result: pipelineResult,
        date: pipelineResult.scenarioDate,
      });
      const saved = await saveScenario(details.scenario.id, { world: application.world });
      onDetailsChange?.(saved);
      const politicalCount = application.applied?.politics?.length ?? 0;
      const alignmentCount = application.applied?.governingAlignment?.length ?? 0;
      const geopoliticalCount = application.applied?.geopolitics?.length ?? 0;
      setProgress(`Applied Political World atomically: ${politicalCount} political patch(es), ${alignmentCount} governing-alignment patch(es), ${geopoliticalCount} geopolitical operation(s).`);
      setPipelineResult(null);
      setProgressInfo(null);
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
    } finally {
      setApplying(false);
    }
  };


  const downloadPoliticalWorldDiagnostic = async () => {
    if (!pipelineResult) return;
    setError("");
    try {
      const { buildPoliticalWorldPipelineDiagnostic } = await import("../AI/politicalWorldPipeline.js");
      const scenarioName = clean(details?.scenario?.name || details?.scenario?.id || "scenario");
      const diagnostic = buildPoliticalWorldPipelineDiagnostic({
        result: pipelineResult,
        world: inputs?.world ?? {},
        scenario: { id: clean(details?.scenario?.id), name: scenarioName },
      });
      downloadJsonFile(`political-world-${safeFileToken(scenarioName)}-${safeFileToken(pipelineResult.scenarioDate || scenarioDate)}.json`, diagnostic);
    } catch (nextError) {
      setError(`Could not build Political World diagnostic: ${nextError?.message || String(nextError)}`);
    }
  };

  const downloadPoliticalWorldV2Diagnostic = async () => {
    if (!v2Checkpoint) return;
    setError("");
    try {
      const { buildPoliticalWorldV2Diagnostic } = await import("../AI/politicalWorldV2/pipeline.js");
      const scenarioName = clean(details?.scenario?.name || details?.scenario?.id || "scenario");
      const diagnostic = buildPoliticalWorldV2Diagnostic({
        checkpoint: v2Checkpoint,
        scenario: { id: clean(details?.scenario?.id), name: scenarioName },
      });
      downloadJsonFile(`political-world-v2-${safeFileToken(scenarioName)}-${safeFileToken(v2Checkpoint.scenarioDate || scenarioDate)}.json`, diagnostic);
    } catch (nextError) {
      setError(`Could not build Political World generation diagnostic: ${nextError?.message || String(nextError)}`);
    }
  };


  const generate = async (testMode = false) => {
    const generationInputs = testMode ? testInputs : inputs;
    if (!generationInputs || busy || applying) return;
    if (!generationInputs.scenarioDate) {
      setError("Save a valid scenario start date before generating political state.");
      return;
    }
    if (dateMismatch) {
      setError("The Scenario Editor date has unsaved changes. Save the scenario first so generation uses the saved scenario start date.");
      return;
    }

    setBusy(true);
    setPipelineResult(null);
    setRunKind(testMode ? "test-15" : mode);
    setError("");
    setLastApplied(null);
    setProgress("Planning missing political state…");
    setProgressInfo(null);
    progressPhaseRef.current = "generation";
    generationStartedAtRef.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { generatePoliticalWorldProposals } = await import("../AI/politicalWorldGenerator.js");
      const allowEntityExpansionByPolity = allowRosterExpansion
        ? Object.fromEntries(Object.keys(generationInputs.politicalActors?.byPolity ?? {}).map((polityKey) => [polityKey, true]))
        : {};
      const nextResult = await generatePoliticalWorldProposals({
        ...generationInputs,
        allowEntityExpansionByPolity,
        maxAttempts: 2,
        signal: controller.signal,
        onBatch: ({
          phase = "generation", generationMode = "", verificationPass = "initial", batchIndex, totalBatches, attempt, maxAttempts, accepted, unresolved,
          resolvedPolities, totalPolities, acceptedTotal, failedTotal, verifiedTotal, correctedTotal, sampleError,
        }) => {
          if (progressPhaseRef.current !== phase) {
            progressPhaseRef.current = phase;
            generationStartedAtRef.current = Date.now();
          }
          setProgress(phase === "historical-verification"
            ? (verificationPass === "collision-recheck" ? "Re-checking conflicting officeholders…" : "Checking timeline canon…")
            : (generationMode === "quantitative-landscape-fast" ? "Backfilling quantitative political landscapes…" : "Generating Political World…"));
          setProgressInfo({
            phase,
            generationMode,
            verificationPass,
            batchIndex,
            totalBatches,
            attempt,
            maxAttempts,
            accepted: accepted.length,
            unresolved: unresolved.length,
            resolvedPolities,
            totalPolities,
            acceptedTotal,
            failedTotal,
            verifiedTotal,
            correctedTotal,
            sampleError,
            elapsedMs: Math.max(0, Date.now() - generationStartedAtRef.current),
          });
        },
      });
      const resultWithRun = { ...nextResult, uiRunKind: testMode ? "test-15" : mode };
      setResult(resultWithRun);
      setRows(buildRows(resultWithRun, { allowRosterExpansion, selectValid: !testMode }));
      setExpandedPolity(nextResult.proposals?.[0]?.item?.polityKey ?? "");
      if (!nextResult.plan?.items?.length) {
        setProgress("Political world is already complete for this generation mode. No AI call was needed.");
      } else {
        const verification = nextResult.historicalVerification;
        const verificationSummary = verification?.enabled
          ? ` Exact-date check: ${verification.confirmed} confirmed, ${verification.corrected} corrected, ${verification.failed} failed.`
          : "";
        setProgress(`${testMode ? "Test complete: " : ""}${nextResult.generatedPolities} valid proposal(s), ${nextResult.failedPolities} failed.${verificationSummary}`);
      }
    } catch (nextError) {
      if (nextError?.name === "AbortError") setProgress("Political generation cancelled.");
      else setError(nextError?.message || String(nextError));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };


  const repairGoverningAlignment = async () => {
    if (!inputs || busy || applying) return;
    if (!inputs.scenarioDate) {
      setError("Save a valid scenario start date before repairing governing alignment.");
      return;
    }
    if (dateMismatch) {
      setError("The Scenario Editor date has unsaved changes. Save the scenario first so governing alignment uses the saved scenario start date.");
      return;
    }

    setBusy(true);
    setPipelineResult(null);
    setRunKind("governing-alignment-repair");
    setError("");
    setLastApplied(null);
    setProgress("Planning missing governing-party / coalition references…");
    setProgressInfo(null);
    progressPhaseRef.current = "generation";
    generationStartedAtRef.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { generatePoliticalGoverningAlignmentRepair } = await import("../AI/politicalGoverningAlignmentRepair.js");
      const nextResult = await generatePoliticalGoverningAlignmentRepair({
        ...inputs,
        maxAttempts: 2,
        signal: controller.signal,
        onBatch: ({
          phase = "generation", generationMode = "governing-alignment-fast", batchIndex, totalBatches, attempt, maxAttempts,
          accepted, unresolved, resolvedPolities, totalPolities, acceptedTotal, failedTotal, sampleError,
        }) => {
          if (progressPhaseRef.current !== phase) {
            progressPhaseRef.current = phase;
            generationStartedAtRef.current = Date.now();
          }
          setProgress("Repairing governing-party / coalition alignment…");
          setProgressInfo({
            phase,
            generationMode,
            batchIndex,
            totalBatches,
            attempt,
            maxAttempts,
            accepted: accepted.length,
            unresolved: unresolved.length,
            resolvedPolities,
            totalPolities,
            acceptedTotal,
            failedTotal,
            sampleError,
            elapsedMs: Math.max(0, Date.now() - generationStartedAtRef.current),
          });
        },
      });
      const resultWithRun = { ...nextResult, uiRunKind: "governing-alignment-repair" };
      setResult(resultWithRun);
      setRows(buildRows(resultWithRun, { allowRosterExpansion: false, selectValid: true }));
      setExpandedPolity(nextResult.proposals?.[0]?.item?.polityKey ?? "");
      const nonPartisan = nextResult.governingAlignmentRepair?.nonPartisan?.length ?? 0;
      if (!nextResult.plan?.items?.length) {
        setProgress("Governing alignment is already present for every repairable party-based government. No AI call was needed.");
      } else {
        setProgress(`Governing alignment repair complete: ${nextResult.generatedPolities} valid patch(es), ${nonPartisan} genuinely non-partisan/partyless government(s), ${nextResult.failedPolities} failed. Temporal verifier: 0 calls.`);
      }
    } catch (nextError) {
      if (nextError?.name === "AbortError") setProgress("Governing alignment repair cancelled.");
      else setError(nextError?.message || String(nextError));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };


  const recheckHistory = async () => {
    if (!details?.scenario?.id || !result || busy || applying) return;
    if (dateMismatch) {
      setError("The Scenario Editor date has unsaved changes. Save the scenario before re-checking timeline canon.");
      return;
    }

    setBusy(true);
    setError("");
    setLastApplied(null);
    setProgress("Re-checking timeline canon only…");
    setProgressInfo(null);
    progressPhaseRef.current = "historical-verification";
    generationStartedAtRef.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const freshDetails = await loadScenarioDetails(details.scenario.id);
      const freshInputs = buildScenarioPoliticalGenerationInputs(freshDetails, { mode, maxBatchSize: 8 });
      if (freshInputs.scenarioDate !== result.scenarioDate) {
        throw new Error(`Scenario start date changed from ${result.scenarioDate} to ${freshInputs.scenarioDate || "<blank>"}. Generate political proposals again for the new canonical date.`);
      }
      const { reverifyPoliticalWorldProposals } = await import("../AI/politicalWorldGenerator.js");
      const allowEntityExpansionByPolity = allowRosterExpansion
        ? Object.fromEntries(Object.keys(freshInputs.politicalActors?.byPolity ?? {}).map((polityKey) => [polityKey, true]))
        : {};
      const previousRows = new Map(rows.map((row) => [row.polityKey, row]));
      const nextResult = await reverifyPoliticalWorldProposals({
        result,
        scenarioDate: freshInputs.scenarioDate,
        historyAuthority: freshInputs.historyAuthority || null,
        politicalActors: freshInputs.politicalActors,
        scenarioContext: freshInputs.scenarioContext,
        contextByPolity: freshInputs.contextByPolity,
        allowEntityExpansionByPolity,
        signal: controller.signal,
        onBatch: ({
          phase = "historical-verification", verificationPass = "initial", batchIndex, totalBatches, attempt, maxAttempts, accepted, unresolved,
          resolvedPolities, totalPolities, acceptedTotal, failedTotal, verifiedTotal, correctedTotal, sampleError,
        }) => {
          setProgress(verificationPass === "collision-recheck"
            ? "Re-checking conflicting officeholders…"
            : "Re-checking timeline canon only…");
          setProgressInfo({
            phase,
            verificationPass,
            batchIndex,
            totalBatches,
            attempt,
            maxAttempts,
            accepted: accepted.length,
            unresolved: unresolved.length,
            resolvedPolities,
            totalPolities,
            acceptedTotal,
            failedTotal,
            verifiedTotal,
            correctedTotal,
            sampleError,
            elapsedMs: Math.max(0, Date.now() - generationStartedAtRef.current),
          });
        },
      });
      const baseRunKind = clean(result.uiRunKind || runKind).replace(/-history-recheck$/, "");
      const resultWithRun = { ...nextResult, uiRunKind: `${baseRunKind}-history-recheck` };
      const nextRows = buildRows(resultWithRun, { allowRosterExpansion, selectValid: false }).map((row) => {
        const previous = previousRows.get(row.polityKey);
        if (!previous || row.status !== "valid") return row;
        return {
          ...row,
          selected: previous.selected === true,
          allowEntityExpansion: previous.allowEntityExpansion === true,
        };
      });
      setResult(resultWithRun);
      setRows(nextRows);
      setExpandedPolity((current) => nextRows.some((row) => row.polityKey === current) ? current : (nextRows[0]?.polityKey ?? ""));
      const verification = nextResult.historicalVerification;
      const collision = verification?.collisionRechecks;
      const collisionSummary = collision?.groups
        ? ` Collision review: ${collision.groups} group(s), ${collision.resolvedPolities?.length ?? 0} polity/polities resolved, ${collision.failedPolities?.length ?? 0} failed closed.`
        : "";
      setProgress(`Historical re-check complete without regenerating politics: ${verification?.confirmed ?? 0} confirmed, ${verification?.corrected ?? 0} corrected, ${verification?.failed ?? 0} failed.${collisionSummary}`);
      setRunKind(resultWithRun.uiRunKind);
    } catch (nextError) {
      if (nextError?.name === "AbortError") setProgress("Historical re-check cancelled.");
      else setError(nextError?.message || String(nextError));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const restoreRunLog = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file || busy || applying) return;
    setError("");
    setLastApplied(null);
    try {
      const diagnostic = JSON.parse(await file.text());
      if (diagnostic?.kind === "political-world-pipeline-diagnostic") {
        const restoredPipeline = restorePipelineResultFromDiagnostic(diagnostic, {
          scenarioId: details?.scenario?.id,
          scenarioDate,
        });
        setPipelineResult(restoredPipeline);
        setResult(null);
        setRows([]);
        setRunKind("political-world-unified");
        setExpandedPolity("");
        setProgressInfo(null);
        setProgress(`Restored combined Political World review without any AI calls: ${restoredPipeline.politics?.generatedPolities ?? 0} Political Actors and ${restoredPipeline.governingAlignment?.generatedPolities ?? 0} governing-alignment patches preserved. You can retry geopolitics only.`);
      } else {
        const restored = restoreResultFromDiagnostic(diagnostic, {
          scenarioId: details?.scenario?.id,
          scenarioDate,
        });
        const restoredRunKind = clean(restored.uiRunKind || "balanced");
        const restoredRows = buildRows(restored, {
          allowRosterExpansion,
          selectValid: !restoredRunKind.startsWith("test-15"),
        });
        setPipelineResult(null);
        setResult(restored);
        setRows(restoredRows);
        setRunKind(restoredRunKind);
        setExpandedPolity(restoredRows.find((row) => row.status === "valid")?.polityKey ?? "");
        setProgressInfo(null);
        setProgress(`Restored Political World review from run log without any AI calls: ${restored.generatedPolities} accepted, ${restored.failedPolities} failed.`);
      }
    } catch (nextError) {
      setError(`Could not restore Political World run log: ${nextError?.message || String(nextError)}`);
    } finally {
      if (event?.target) event.target.value = "";
    }
  };

  const downloadRunLog = () => {
    if (!result) return;
    const scenarioName = clean(details?.scenario?.name || details?.scenario?.id || "scenario");
    const log = {
      schemaVersion: 1,
      kind: "political-world-generation-diagnostic",
      scenario: {
        id: clean(details?.scenario?.id),
        name: scenarioName,
        scenarioDate: result.scenarioDate || scenarioDate,
      },
      run: {
        mode: result.uiRunKind || runKind,
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
    downloadJsonFile(`political-generation-${safeFileToken(scenarioName)}-${safeFileToken(result.scenarioDate || scenarioDate)}-${safeFileToken(result.uiRunKind || runKind)}.json`, log);
  };

  const downloadGeopoliticalDiagnostic = async () => {
    if (!geopoliticalResult) return;
    setError("");
    try {
      const { buildGeopoliticalBaselineDiagnostic } = await import("../AI/geopoliticalWorldGenerator.js");
      const scenarioName = clean(details?.scenario?.name || details?.scenario?.id || "scenario");
      const diagnostic = buildGeopoliticalBaselineDiagnostic({
        result: geopoliticalResult,
        world: inputs?.world ?? {},
        scenario: {
          id: clean(details?.scenario?.id),
          name: scenarioName,
        },
      });
      downloadJsonFile(`geopolitical-baseline-${safeFileToken(scenarioName)}-${safeFileToken(geopoliticalResult.scenarioDate || scenarioDate)}.json`, diagnostic);
    } catch (nextError) {
      setError(`Could not build geopolitical diagnostic: ${nextError?.message || String(nextError)}`);
    }
  };

  const cancel = () => abortRef.current?.abort();

  const generateGeopoliticalBaseline = async () => {
    if (!inputs || busy || applying || geopoliticalApplying) return;
    if (!inputs.scenarioDate) {
      setError("Save a valid scenario start date before generating geopolitical state.");
      return;
    }
    if (dateMismatch) {
      setError("The Scenario Editor date has unsaved changes. Save the scenario first so geopolitical generation uses the saved scenario start date.");
      return;
    }
    setBusy(true);
    setPipelineResult(null);
    setRunKind("geopolitical-baseline");
    setError("");
    setLastApplied(null);
    setGeopoliticalResult(null);
    setProgress("Building global institution catalog, era-relative power calibration, formal memberships and major agreements…");
    setProgressInfo(null);
    generationStartedAtRef.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { generateGeopoliticalWorldBaseline } = await import("../AI/geopoliticalWorldGenerator.js");
      const nextResult = await generateGeopoliticalWorldBaseline({
        scenarioDate: inputs.scenarioDate,
        historyAuthority: inputs.historyAuthority || null,
        polities: inputs.polities,
        world: inputs.world,
        scenarioContext: inputs.scenarioContext,
        signal: controller.signal,
        onBatch: ({ phase = "memberships", batchIndex, totalBatches, resolvedPolities, totalPolities, warning }) => {
          if (phase === "memberships-rescue") setProgress("Rescuing only unresolved geopolitical membership profiles…");
          else if (phase === "memberships-tiny-retry") setProgress("Retrying the final unresolved geopolitical profiles…");
          setProgressInfo({
            phase,
            generationMode: "geopolitical-fast",
            batchIndex,
            totalBatches,
            attempt: 1,
            maxAttempts: 1,
            accepted: resolvedPolities,
            unresolved: Math.max(0, totalPolities - resolvedPolities),
            resolvedPolities,
            totalPolities,
            acceptedTotal: resolvedPolities,
            failedTotal: 0,
            sampleError: warning ? { polityKey: "", errors: [warning] } : null,
            elapsedMs: Math.max(0, Date.now() - generationStartedAtRef.current),
          });
        },
      });
      setGeopoliticalResult(nextResult);
      setProgress(nextResult.requestedPolities
        ? (nextResult.blockingErrors?.length
          ? `Geopolitical baseline stopped with ${nextResult.blockingErrors.length} blocking completeness error(s). Review before retrying; Apply is disabled.`
          : `Geopolitical baseline ready for review: ${nextResult.records.length} polity membership/regime profiles, ${nextResult.institutionCatalog.length} institutions, ${nextResult.powerCalibration.length} power records, ${nextResult.agreements.length} major agreements in ${nextResult.modelCalls} AI call(s).`)
        : "Geopolitical baseline is already initialized. No AI call was needed.");
    } catch (nextError) {
      if (nextError?.name === "AbortError") setProgress("Geopolitical generation cancelled.");
      else setError(nextError?.message || String(nextError));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const applyGeopoliticalBaseline = async () => {
    if (!details?.scenario?.id || !geopoliticalResult || busy || applying || geopoliticalApplying) return;
    setGeopoliticalApplying(true);
    setError("");
    try {
      const freshDetails = await loadScenarioDetails(details.scenario.id);
      const freshDate = savedScenarioDate(freshDetails);
      if (freshDate !== geopoliticalResult.scenarioDate) {
        throw new Error(`Scenario start date changed from ${geopoliticalResult.scenarioDate} to ${freshDate || "<blank>"}. Regenerate the geopolitical baseline.`);
      }
      const { applyGeopoliticalWorldBaseline } = await import("../AI/geopoliticalWorldGenerator.js");
      const application = applyGeopoliticalWorldBaseline({
        world: freshDetails?.data?.world ?? {},
        result: geopoliticalResult,
        date: geopoliticalResult.scenarioDate,
      });
      const saved = await saveScenario(details.scenario.id, { world: application.world });
      onDetailsChange?.(saved);
      setProgress(`Applied geopolitical baseline (${application.applied.length} change(s)).`);
      setGeopoliticalResult(null);
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
    } finally {
      setGeopoliticalApplying(false);
    }
  };

  const applySelected = async () => {
    if (!details?.scenario?.id || !result || !selectedCount || busy || applying) return;
    setApplying(true);
    setError("");
    try {
      const reviews = [];
      const parseErrors = [];
      for (const row of rows) {
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
        for (const entry of parseErrors) updateRow(entry.polityKey, { sourceErrors: [`Edited actorPatch is not valid JSON: ${entry.message}`] });
        throw new Error("Fix invalid JSON in the selected political proposals before applying.");
      }

      // Re-read immediately before persistence. Generation can take minutes and the
      // Scenario Editor may have been saved by another action meanwhile; applying a
      // stale world snapshot would silently roll those changes back.
      const freshDetails = await loadScenarioDetails(details.scenario.id);
      const freshDate = savedScenarioDate(freshDetails);
      if (freshDate !== result.scenarioDate) {
        throw new Error(`Scenario start date changed from ${result.scenarioDate} to ${freshDate || "<blank>"}. Regenerate political proposals for the new canonical date.`);
      }
      const freshWorld = freshDetails?.data?.world ?? {};
      const application = applyReviewedPoliticalGeneration({
        politicalActors: freshWorld.politicalActors,
        scenarioDate: result.scenarioDate,
        reviews,
      });
      if (!application.ok) {
        for (const entry of application.errors) updateRow(entry.polityKey, { sourceErrors: entry.errors });
        throw new Error("One or more reviewed political proposals no longer validate against current scenario canon. Nothing was applied.");
      }
      if (!application.applied.length) {
        setProgress("Selected proposals no longer fill missing fields; scenario canon was left unchanged.");
        return;
      }

      const saved = await saveScenario(details.scenario.id, {
        world: {
          ...freshWorld,
          politicalActors: application.politicalActors,
        },
      });
      onDetailsChange?.(saved);
      setLastApplied(application.applied);
      setProgress(`Applied political state to ${application.applied.length} polity/polities.`);
      setResult(null);
      setRows([]);
      setExpandedPolity("");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div style={panelStyle}>
      <div style={{ alignItems: "flex-start", display: "flex", gap: "0.75rem", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "1rem", fontWeight: 800 }}>Political World</div>
          <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.78rem", lineHeight: 1.55, marginTop: "0.3rem" }}>
            Give this scenario governments, Political Actors, domestic politics, institutions context and its starting geopolitical state. Generation is staged for review and does not change the scenario until you apply it.
          </div>
        </div>
        <span style={{ background: politicalWorldTone.background, border: `1px solid ${politicalWorldTone.border}`, borderRadius: "999px", color: politicalWorldTone.color, flex: "0 0 auto", fontSize: "0.68rem", fontWeight: 800, padding: "0.35rem 0.6rem" }}>
          {politicalWorldStatus}
        </span>
      </div>

      <div style={{ background: politicalWorldTone.background, border: `1px solid ${politicalWorldTone.border}`, borderRadius: 12, color: politicalWorldTone.color, fontSize: "0.72rem", lineHeight: 1.5, marginTop: "0.75rem", padding: "0.65rem 0.7rem" }}>
        {politicalWorldAbsent
          ? "This scenario has no Political World yet. Politics-related systems will remain unavailable until you generate, review and apply one."
          : politicalWorldSparse
            ? `This scenario already has ${actorCount} Political Actor${actorCount === 1 ? "" : "s"}, but coverage is incomplete. Generation can fill the missing political world without replacing authored state.`
            : `This scenario already has a Political World with ${actorCount} Political Actor${actorCount === 1 ? "" : "s"}. You can regenerate missing pieces or use the repair tools below when needed.`}
      </div>

      <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: "0.85rem" }}>
        <div style={{ background: "rgba(255,255,255,0.035)", borderRadius: 12, padding: "0.65rem" }}>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.65rem", textTransform: "uppercase" }}>Start date</div>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, marginTop: "0.15rem" }}>{scenarioDate || "Not set"}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.035)", borderRadius: 12, padding: "0.65rem" }}>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.65rem", textTransform: "uppercase" }}>Polities</div>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, marginTop: "0.15rem" }}>{polityCount}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.035)", borderRadius: 12, padding: "0.65rem" }}>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.65rem", textTransform: "uppercase" }}>Political actors</div>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, marginTop: "0.15rem" }}>{actorCount}</div>
        </div>
      </div>

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.55rem", marginTop: "0.85rem" }}>
        <button disabled={busy || applying || geopoliticalApplying || dateMismatch} onClick={generatePoliticalWorld} style={{ ...buttonStyle, background: "rgba(124,58,237,0.3)", borderColor: "rgba(167,139,250,0.34)", minWidth: "11.5rem", opacity: busy || applying || geopoliticalApplying || dateMismatch ? 0.55 : 1 }} type="button">
          {busy && runKind === "political-world-v2" ? "Building Political World…" : (v2Checkpoint && !v2Ready ? "Resume Generation" : "Generate Political World")}
        </button>
        <button disabled={!applyReady || busy || applying || geopoliticalApplying || dateMismatch} onClick={applyPoliticalWorld} style={{ ...buttonStyle, background: "rgba(34,197,94,0.22)", borderColor: "rgba(74,222,128,0.34)", minWidth: "10.5rem", opacity: !applyReady || busy || applying || geopoliticalApplying || dateMismatch ? 0.5 : 1 }} type="button">
          {applying ? "Applying to Scenario…" : "Apply to Scenario"}
        </button>
        {busy && <button onClick={cancel} style={{ ...buttonStyle, background: "rgba(127,29,29,0.3)" }} type="button">Cancel</button>}
      </div>
      <div style={{ color: "rgba(255,255,255,0.52)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.45rem" }}>
        Generation saves its progress as a staged preview. Resume continues unfinished work without resetting bounded validation retries. Nothing is written to the scenario until Apply to Scenario succeeds.
      </div>

      <details style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, marginTop: "0.7rem", padding: "0.55rem 0.65rem" }}>
        <summary style={{ color: "rgba(255,255,255,0.62)", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>Advanced generation settings & repair tools</summary>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.65rem" }}>
          <label style={{ alignItems: "center", color: "rgba(255,255,255,0.58)", display: "inline-flex", fontSize: "0.68rem", gap: "0.35rem" }}>
            Maximum AI calls this run
            <input
              disabled={busy || applying}
              max="200"
              min="1"
              onChange={(event) => setV2CallBudget(Math.max(1, Math.trunc(Number(event.target.value) || 1)))}
              style={{ ...selectStyle, minHeight: "2.1rem", width: "4.8rem" }}
              type="number"
              value={v2CallBudget}
            />
          </label>
          <select disabled={busy || applying} onChange={(event) => setMode(event.target.value)} style={selectStyle} value={mode}>
            {MODE_OPTIONS.map((option) => <option key={option.id} style={{ background: "#2b2b30", color: "#f8fafc" }} value={option.id}>{option.label} repair</option>)}
          </select>
          <button disabled={busy || applying || dateMismatch} onClick={() => generate(false)} style={{ ...buttonStyle, opacity: busy || applying || dateMismatch ? 0.55 : 1 }} type="button">Generate Missing Politics</button>
          <button disabled={busy || applying || dateMismatch} onClick={repairGoverningAlignment} style={{ ...buttonStyle, opacity: busy || applying || dateMismatch ? 0.55 : 1 }} type="button">Repair Governing Alignment</button>
          <button disabled={busy || applying || geopoliticalApplying || dateMismatch} onClick={generateGeopoliticalBaseline} style={{ ...buttonStyle, opacity: busy || applying || geopoliticalApplying || dateMismatch ? 0.55 : 1 }} type="button">Generate Geopolitical Baseline</button>
          <button disabled={busy || applying || dateMismatch} onClick={() => generate(true)} style={{ ...buttonStyle, opacity: busy || applying || dateMismatch ? 0.55 : 1 }} type="button">Test 15 Polities</button>
          <input accept={acceptFor("application/json,.json")} onChange={restoreRunLog} ref={restoreRunLogInputRef} style={{ display: "none" }} type="file" />
          <button disabled={busy || applying || dateMismatch} onClick={() => restoreRunLogInputRef.current?.click()} style={{ ...buttonStyle, opacity: busy || applying || dateMismatch ? 0.55 : 1 }} type="button">Restore Run Log</button>
          {result && !busy && runKind !== "governing-alignment-repair" && runKind !== "political-world-unified" && <button disabled={applying || dateMismatch} onClick={recheckHistory} style={buttonStyle} type="button">Re-check Timeline Canon</button>}
          {result && !busy && runKind !== "political-world-unified" && <button onClick={downloadRunLog} style={buttonStyle} type="button">Download Run Log</button>}
          {geopoliticalResult && runKind !== "political-world-unified" && <button onClick={downloadGeopoliticalDiagnostic} style={buttonStyle} type="button">Download Geopolitical Diagnostic</button>}
          {v2FailedJobs > 0 && <button disabled={busy || applying || dateMismatch} onClick={() => generatePoliticalWorld({ retryDeferred: true })} style={{ ...buttonStyle, opacity: busy || applying || dateMismatch ? 0.55 : 1 }} type="button">Retry Deferred Targets</button>}
          {v2Checkpoint && <button onClick={downloadPoliticalWorldV2Diagnostic} style={buttonStyle} type="button">Download Generation Diagnostic</button>}
        </div>
        <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.66rem", lineHeight: 1.45, marginTop: "0.5rem" }}>
          Repair Governing Alignment can only fill missing rulingPartyIds / coalitionPartyIds from party IDs that already exist and never runs the temporal verifier.
        </div>
        <label style={{ alignItems: "flex-start", color: "rgba(255,255,255,0.56)", display: "flex", fontSize: "0.68rem", gap: "0.45rem", lineHeight: 1.45, marginTop: "0.65rem" }}>
          <input checked={allowRosterExpansion} disabled={busy || applying} onChange={(event) => setAllowRosterExpansion(event.target.checked)} type="checkbox" />
          <span><strong>Allow roster expansion proposals.</strong> This also affects the main Political World generation run. Leave it off for the safest preserve-authored-rosters behavior.</span>
        </label>
      </details>

      {dateMismatch && (
        <div style={{ background: "rgba(245,158,11,0.11)", border: "1px solid rgba(245,158,11,0.28)", borderRadius: 12, color: "#fde68a", fontSize: "0.75rem", marginTop: "0.7rem", padding: "0.65rem" }}>
          Save the Scenario Editor first: the visible date ({unsavedDate}) differs from the saved date ({scenarioDate}). Political World generation always uses saved scenario data.
        </div>
      )}
      {busy && progressInfo?.v2 && (
        <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, marginTop: "0.7rem", padding: "0.65rem" }}>
          <div style={{ alignItems: "center", display: "flex", fontSize: "0.7rem", gap: "0.6rem", justifyContent: "space-between" }}>
            <span style={{ color: "rgba(255,255,255,0.76)", fontWeight: 700 }}>
              Generation progress: {progressInfo.canonicalResolved ?? 0}/{progressInfo.canonicalTotal ?? 0} ({progressInfo.canonicalPercent ?? 0}%)
            </span>
            <AiCallsTotal calls={progressInfo.modelCalls ?? 0} ceiling={progressInfo.totalModelCallCeiling} style={{ color: "rgba(255,255,255,0.52)" }} />
          </div>
          <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 999, height: 8, marginTop: "0.45rem", overflow: "hidden" }}>
            <div style={{ background: "rgba(139,92,246,0.9)", borderRadius: 999, height: "100%", transition: "width 180ms ease", width: `${progressInfo.canonicalPercent ?? 0}%` }} />
          </div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", lineHeight: 1.5, marginTop: "0.45rem" }}>
            <LiveProgressCounts info={progressInfo} polityCount={polityCount} />
          </div>
        </div>
      )}
      {busy && progressTotal > 0 && !progressInfo?.v2 && (
        <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, marginTop: "0.7rem", padding: "0.65rem" }}>
          <div style={{ alignItems: "center", display: "flex", fontSize: "0.7rem", gap: "0.6rem", justifyContent: "space-between" }}>
            <span style={{ color: "rgba(255,255,255,0.76)", fontWeight: 700 }}>
              {progressResolved} / {progressTotal} polities resolved
            </span>
            <span style={{ color: "rgba(255,255,255,0.52)" }}>{progressPercent}%</span>
          </div>
          <div
            aria-valuemax={progressTotal}
            aria-valuemin={0}
            aria-valuenow={progressResolved}
            role="progressbar"
            style={{ background: "rgba(255,255,255,0.08)", borderRadius: 999, height: 8, marginTop: "0.45rem", overflow: "hidden" }}
          >
            <div style={{ background: "rgba(139,92,246,0.9)", borderRadius: 999, height: "100%", transition: "width 180ms ease", width: `${progressPercent}%` }} />
          </div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", lineHeight: 1.5, marginTop: "0.45rem" }}>
            <BatchProgressDetails info={progressInfo} etaMs={progressEtaMs} />
          </div>
          {progressSampleError && (
            <div style={{ background: "rgba(127,29,29,0.13)", border: "1px solid rgba(248,113,113,0.18)", borderRadius: 10, color: "#fecaca", fontSize: "0.68rem", lineHeight: 1.45, marginTop: "0.5rem", padding: "0.5rem" }}>
              <strong>Current rejection{progressSampleError.polityKey ? ` — ${progressSampleError.polityKey}` : ""}</strong>
              {progressSampleError.errors.slice(0, 2).map((entry) => <div key={entry}>• {entry}</div>)}
            </div>
          )}
        </div>
      )}
      {progress && <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.75rem", marginTop: "0.7rem" }}>{progress}</div>}
      {error && <div style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, color: "#fecaca", fontSize: "0.75rem", marginTop: "0.7rem", padding: "0.65rem" }}>{error}</div>}
      {lastApplied?.length > 0 && (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.24)", borderRadius: 12, color: "#bbf7d0", fontSize: "0.75rem", marginTop: "0.7rem", padding: "0.65rem" }}>
          Applied: {lastApplied.map((entry) => entry.polityKey).join(", ")}
        </div>
      )}

      {v2Checkpoint && !busy && runKind === "political-world-v2" && (
        <div style={{ background: v2Ready ? "rgba(34,197,94,0.08)" : "rgba(124,58,237,0.09)", border: `1px solid ${v2Ready ? "rgba(74,222,128,0.24)" : "rgba(167,139,250,0.24)"}`, borderRadius: 12, marginTop: "0.8rem", padding: "0.75rem" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "0.6rem", justifyContent: "space-between" }}>
            <div style={{ color: v2Ready ? "#bbf7d0" : "#ede9fe", fontSize: "0.78rem", fontWeight: 800 }}>Political World generation checkpoint</div>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.66rem" }}>{clean(v2Checkpoint.status) || "ready"}</div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.7rem", lineHeight: 1.55, marginTop: "0.3rem" }}>
            <CheckpointCounts checkpoint={v2Checkpoint} pending={v2PendingJobs} deferred={v2FailedJobs} polityCount={polityCount} />
          </div>
          {v2Ready ? (
            <div style={{ color: "#bbf7d0", fontSize: "0.7rem", marginTop: "0.45rem" }}>Quality checks passed. The Political World is ready to apply to the scenario.</div>
          ) : (
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.68rem", lineHeight: 1.5, marginTop: "0.45rem" }}>
              {v2Checkpoint.pauseReason === "model-call-budget"
                ? "Paused at this run's AI-call budget. Resume continues unfinished work only."
                : v2Checkpoint.pauseReason === "total-model-call-budget"
                  ? (v2Checkpoint.lastError || "Paused at the lifetime AI-call safety ceiling. Completed work is saved; inspect unresolved targets before spending more calls.")
                  : v2Checkpoint.pauseReason === "bounded-unresolved"
                  ? `Deferred ${v2FailedJobs} stubborn target(s) after bounded retries. Resume preserves those retry limits and continues independent unfinished work; use Retry Deferred Targets for another bounded attempt.`
                  : ["provider-quota", "provider-rate-limit", "provider-unavailable", "provider-config", "task-error"].includes(v2Checkpoint.pauseReason)
                    ? (v2Checkpoint.lastError || "The current AI provider task paused before producing a usable result. Resume after the provider issue is resolved.")
                    : `${v2Unresolved.length} item(s) remain unresolved.`}
              {v2Unresolved.length > 0 && <div style={{ marginTop: "0.25rem" }}>Sample: {v2Unresolved.slice(0, 8).map((entry) => `${entry.polityKey} (${entry.kind})`).join(" · ")}{v2Unresolved.length > 8 ? "…" : ""}</div>}
            </div>
          )}
        </div>
      )}
      {pipelineResult && !busy && runKind === "political-world-unified" && (
        <div style={{ background: pipelineBlocked ? "rgba(127,29,29,0.12)" : "rgba(124,58,237,0.09)", border: `1px solid ${pipelineBlocked ? "rgba(248,113,113,0.28)" : "rgba(167,139,250,0.24)"}`, borderRadius: 12, marginTop: "0.8rem", padding: "0.75rem" }}>
          <div style={{ color: pipelineBlocked ? "#fecaca" : "#ede9fe", fontSize: "0.78rem", fontWeight: 800 }}>Political World review</div>
          <div style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.7rem", lineHeight: 1.55, marginTop: "0.3rem" }}>
            Political Actors: {pipelineResult.politics?.generatedPolities ?? 0} accepted / {pipelineResult.politics?.failedPolities ?? 0} failed
            {pipelineResult.governingAlignment ? ` · Governing alignment: ${pipelineResult.governingAlignment.generatedPolities ?? 0} patch(es), ${pipelineResult.governingAlignment.governingAlignmentRepair?.nonPartisan?.length ?? 0} non-partisan, ${pipelineResult.governingAlignment.failedPolities ?? 0} failed` : ""}
            {pipelineResult.geopolitics ? ` · Geopolitics: ${pipelineResult.geopolitics.records?.length ?? 0} profiles, ${pipelineResult.geopolitics.institutionCatalog?.length ?? 0} institutions, ${pipelineResult.geopolitics.powerCalibration?.length ?? 0} power inputs, ${pipelineResult.geopolitics.agreements?.length ?? 0} agreements, ${pipelineResult.geopolitics.modelCalls ?? 0} AI call(s)` : ""}
          </div>
          {!!pipelineResult.geopolitics?.institutionCatalog?.length && (
            <div style={{ color: "rgba(196,181,253,0.76)", fontSize: "0.66rem", lineHeight: 1.5, marginTop: "0.35rem" }}>
              Catalog sample: {pipelineResult.geopolitics.institutionCatalog.slice(0, 10).map((entry) => `${entry.shortName || entry.name} [${entry.id}]`).join(" · ")}{pipelineResult.geopolitics.institutionCatalog.length > 10 ? " …" : ""}
            </div>
          )}
          {pipelineBlocked ? (
            <div style={{ background: "rgba(127,29,29,0.18)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10, color: "#fecaca", fontSize: "0.68rem", lineHeight: 1.5, marginTop: "0.55rem", padding: "0.55rem" }}>
              <strong>Apply to Scenario is blocked.</strong>
              {pipelineResult.blockingErrors.slice(0, 8).map((entry) => <div key={entry}>• {entry}</div>)}
            </div>
          ) : (
            <div style={{ background: "rgba(34,197,94,0.09)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10, color: "#bbf7d0", fontSize: "0.68rem", lineHeight: 1.5, marginTop: "0.55rem", padding: "0.55rem" }}>
              Preview ready. No scenario data has been written yet. Review this summary, then use Apply to Scenario above.
            </div>
          )}
          {pipelineBlocked && pipelineResult.politics?.failedPolities === 0 && pipelineResult.governingAlignment?.failedPolities === 0 && (
            <button disabled={busy || applying || geopoliticalApplying || dateMismatch} onClick={retryPipelineGeopoliticsOnly} style={{ ...buttonStyle, background: "rgba(16,185,129,0.16)", borderColor: "rgba(52,211,153,0.3)", marginTop: "0.55rem", marginRight: "0.45rem", opacity: busy || applying || geopoliticalApplying || dateMismatch ? 0.55 : 1 }} type="button">
              Retry Geopolitics Only
            </button>
          )}
          <button onClick={downloadPoliticalWorldDiagnostic} style={{ ...buttonStyle, background: "rgba(255,255,255,0.045)", marginTop: "0.55rem" }} type="button">Download Combined Diagnostic</button>
        </div>
      )}

      {geopoliticalResult && !busy && runKind !== "political-world-unified" && (
        <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(52,211,153,0.22)", borderRadius: 12, marginTop: "0.8rem", padding: "0.7rem" }}>
          <div style={{ color: "#d1fae5", fontSize: "0.76rem", fontWeight: 800 }}>Geopolitical baseline review</div>
          <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.25rem" }}>
            {geopoliticalResult.records.length} polity membership/regime profiles · {geopoliticalResult.institutionCatalog?.length ?? 0} canonical institutions · {geopoliticalResult.powerCalibration?.length ?? 0} power-baseline inputs · {geopoliticalResult.agreements.length} major agreements · {geopoliticalResult.modelCalls} AI call(s).
            {geopoliticalResult.warnings.length ? ` ${geopoliticalResult.warnings.length} warning(s).` : ""}
          </div>
          {!!geopoliticalResult.institutionCatalog?.length && (
            <div style={{ color: "rgba(167,243,208,0.72)", fontSize: "0.66rem", lineHeight: 1.5, marginTop: "0.35rem" }}>
              Catalog sample: {geopoliticalResult.institutionCatalog.slice(0, 10).map((entry) => `${entry.shortName || entry.name} [${entry.id}]`).join(" · ")}
              {geopoliticalResult.institutionCatalog.length > 10 ? " …" : ""}
            </div>
          )}
          {!!geopoliticalResult.blockingErrors?.length && (
            <div style={{ background: "rgba(127,29,29,0.18)", border: "1px solid rgba(248,113,113,0.28)", borderRadius: 10, color: "#fecaca", fontSize: "0.68rem", lineHeight: 1.5, marginTop: "0.5rem", padding: "0.5rem" }}>
              <strong>Apply blocked: baseline completeness failed.</strong>
              {geopoliticalResult.blockingErrors.slice(0, 6).map((entry) => <div key={entry}>• {entry}</div>)}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.55rem" }}>
            <button disabled={geopoliticalApplying || dateMismatch || geopoliticalResult.blockingErrors?.length} onClick={applyGeopoliticalBaseline} style={{ ...buttonStyle, background: "rgba(34,197,94,0.2)", borderColor: "rgba(34,211,153,0.32)", opacity: geopoliticalApplying || dateMismatch || geopoliticalResult.blockingErrors?.length ? 0.55 : 1 }} type="button">
              {geopoliticalApplying ? "Applying…" : "Apply Geopolitical Baseline"}
            </button>
            <button disabled={geopoliticalApplying} onClick={downloadGeopoliticalDiagnostic} style={{ ...buttonStyle, background: "rgba(255,255,255,0.045)", opacity: geopoliticalApplying ? 0.55 : 1 }} type="button">
              Download Diagnostic
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && runKind !== "political-world-unified" && (
        <div style={{ marginTop: "0.95rem" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between", marginBottom: "0.6rem" }}>
            <input
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter polities…"
              style={{ ...selectStyle, flex: 1, minWidth: 0 }}
              value={filter}
            />
            <button disabled={!selectedCount || applying} onClick={applySelected} style={{ ...buttonStyle, background: "rgba(34,197,94,0.18)", borderColor: "rgba(34,197,94,0.3)", opacity: !selectedCount || applying ? 0.5 : 1 }} type="button">
              {applying ? "Applying…" : `Apply Selected (${selectedCount})`}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", maxHeight: "30rem", overflowY: "auto", paddingRight: "0.15rem" }}>
            {visibleRows.map((row) => {
              const expanded = expandedPolity === row.polityKey;
              const failed = row.status === "failed";
              return (
                <div key={row.polityKey} style={{ background: failed ? "rgba(127,29,29,0.16)" : "rgba(255,255,255,0.035)", border: `1px solid ${failed ? "rgba(248,113,113,0.25)" : "rgba(255,255,255,0.08)"}`, borderRadius: 13, padding: "0.65rem" }}>
                  <div style={{ alignItems: "center", display: "flex", gap: "0.55rem" }}>
                    {!failed && <input checked={row.selected} onChange={(event) => updateRow(row.polityKey, { selected: event.target.checked })} type="checkbox" />}
                    <button onClick={() => setExpandedPolity(expanded ? "" : row.polityKey)} style={{ background: "none", border: 0, color: "#fff", cursor: "pointer", flex: 1, padding: 0, textAlign: "left" }} type="button">
                      <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "0.82rem", fontWeight: 800 }}>{row.polityKey}</span>
                        <span style={{ color: failed ? "#fca5a5" : "rgba(255,255,255,0.48)", fontSize: "0.64rem", textTransform: "uppercase" }}>{failed ? "failed" : `${row.depth} · ${row.confidence}`}</span>
                      </div>
                      {!failed && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", marginTop: "0.18rem" }}>{patchSummary(row.actorPatchText)}</div>}
                    </button>
                  </div>

                  {expanded && (
                    <div style={{ marginTop: "0.65rem" }}>
                      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", marginBottom: "0.45rem" }}>
                        Needs: {row.needs.join(", ") || "none"}
                      </div>
                      {row.sourceErrors.length > 0 && (
                        <div style={{ color: "#fecaca", fontSize: "0.7rem", lineHeight: 1.5, marginBottom: "0.55rem" }}>
                          {row.sourceErrors.map((entry) => <div key={entry}>• {entry}</div>)}
                        </div>
                      )}
                      {!failed && (
                        <>
                          <textarea
                            aria-label={`${row.polityKey} political actor patch`}
                            onChange={(event) => updateRow(row.polityKey, { actorPatchText: event.target.value, sourceErrors: [] })}
                            spellCheck={false}
                            style={textareaStyle}
                            value={row.actorPatchText}
                          />
                          <label style={{ alignItems: "center", color: "rgba(255,255,255,0.62)", display: "flex", fontSize: "0.7rem", gap: "0.45rem", marginTop: "0.5rem" }}>
                            <input
                              checked={row.allowEntityExpansion}
                              onChange={(event) => updateRow(row.polityKey, { allowEntityExpansion: event.target.checked })}
                              type="checkbox"
                            />
                            Allow this reviewed patch to add new parties/power blocs to an already-authored roster.
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default PoliticalWorldGenerationPanel;
