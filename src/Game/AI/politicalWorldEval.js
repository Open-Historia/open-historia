import { callAI, buildDiplomaticEvaluationRequest } from "./main.jsx";
import { runChatActionBatch, simulateTimelineJump } from "./gameplay.js";
import { institutionBallotWorkForProposal } from "./institutionAutonomy.js";
import { getResolvedFallbackList } from "./providerConfig.js";
import { parseDiplomaticEnvelope } from "../../runtime/diplomaticEnvelope.js";
import { eventsFromLegacyChat, projectChatThread } from "../../runtime/chatThreads.js";
import { readGameStateBundle, viewAsSeen } from "../../runtime/gameState.js";
import { getLibraryState } from "../../runtime/library.js";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { getPoliticalProfileKey } from "../../runtime/politicalActors.js";
import { derivePoliticalDispositionForActor } from "../../runtime/politicalDisposition.js";
import { materializeInstitutionalChannel } from "../../runtime/institutionalChannels.js";
import { buildDiplomaticPoliticalContext } from "./diplomaticPoliticalContext.js";
import { normalizeInstitutions } from "../../runtime/institutions.js";
import {
  politicalWorldEvalContextIsolation,
  politicalWorldEvalHash,
  politicalWorldEvalLabel,
  politicalWorldEvalPromptFingerprint,
  politicalWorldEvalPromptParity,
  politicalWorldEvalReplaceContextBlock,
  politicalWorldEvalReplaceUniqueGoal,
  politicalWorldEvalSharedDirective,
  politicalWorldEvalSnapshotMetadata,
  politicalWorldEvalVariantOrder,
} from "./politicalWorldEvalCore.js";

const clean = (value) => String(value ?? "").trim();
const isGoalExperimentMode = (mode) => ["evolvedGoal", "frozenGoalAblation"].includes(clean(mode));
const list = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const snapshotIdentity = (bundle = {}) => politicalWorldEvalHash({
  actions: bundle.actions || [],
  chats: bundle.chats || [],
  events: bundle.events || [],
  game: bundle.game || {},
  world: bundle.world || {},
});

const HAWK_TRAITS = Object.freeze({
  riskTolerance: 95,
  recklessness: 82,
  caution: 5,
  opportunism: 90,
  militarism: 95,
  conciliatory: 5,
  pragmatism: 50,
  paranoia: 78,
  vindictiveness: 78,
  consensusDriven: 15,
});
const DOVE_TRAITS = Object.freeze({
  riskTolerance: 15,
  recklessness: 5,
  caution: 95,
  opportunism: 20,
  militarism: 5,
  conciliatory: 95,
  pragmatism: 82,
  paranoia: 15,
  vindictiveness: 10,
  consensusDriven: 88,
});

export const capturePoliticalWorldEvalSnapshot = async () => {
  const canonical = await readGameStateBundle({ force: true });
  const [seen, advisor] = await Promise.all([
    viewAsSeen(canonical),
    readJson(JSON_URLS.advisor, { defaultValue: [], force: true }).catch(() => []),
  ]);
  const playerVisible = {
    ...canonical,
    game: seen.game,
    world: seen.world,
    events: seen.events,
    chats: seen.chats,
    savedGame: canonical.game,
    unseen: seen.unseen ?? new Set(),
    advisor,
  };
  const snapshot = {
    capturedAt: new Date().toISOString(),
    canonical: clone(canonical),
    seen: clone({ ...playerVisible, unseen: undefined }),
    canonicalHash: snapshotIdentity(canonical),
    metadata: politicalWorldEvalSnapshotMetadata(canonical.game, getLibraryState()),
  };
  return snapshot;
};

export const listPoliticalWorldEvalActors = (snapshot) => {
  const byPolity = snapshot?.canonical?.world?.politicalActors?.byPolity || {};
  return Object.entries(byPolity)
    .map(([key, actor]) => clean(actor?.polityKey || actor?.name || key))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
};

export const listPoliticalWorldEvalGoals = (snapshot, actorName) => {
  const world = snapshot?.canonical?.world || {};
  const key = getPoliticalProfileKey(world, actorName);
  const actor = key ? world?.politicalActors?.byPolity?.[key] : null;
  return list(actor?.goals).map((goal) => clean(goal)).filter(Boolean);
};

export const listPoliticalWorldEvalChats = (snapshot) => list(snapshot?.seen?.chats)
  .filter((chat) => clean(chat?.status || "open") !== "closed")
  // Lifecycle invitation/accession negotiations have their own canonical mutation
  // seam. The A/B lab deliberately excludes them rather than risk turning a
  // read-only group evaluation into a membership decision. Permanent Councils
  // remain eligible through institutionId.
  .filter((chat) => !clean(chat?.lifecycleInstitutionId))
  .map((chat) => {
    const projected = projectChatThread(eventsFromLegacyChat(chat));
    const countries = list(projected.countries).map((row) => clean(row?.name)).filter(Boolean);
    return {
      id: clean(chat?.id),
      title: clean(chat?.title) || countries.join(" & ") || clean(chat?.id),
      countries,
      institutionId: clean(chat?.institutionId),
      group: countries.length > 2,
    };
  })
  .filter((chat) => chat.id);

export const listPoliticalWorldEvalVotingProposals = (snapshot) => {
  const institutions = normalizeInstitutions(snapshot?.canonical?.world?.institutions, snapshot?.canonical?.world || {});
  const out = [];
  for (const institution of Object.values(institutions.byId || {})) {
    for (const proposal of Object.values(institution?.proposals || {})) {
      if (clean(proposal?.status) !== "voting") continue;
      const work = institutionBallotWorkForProposal(
        snapshot?.canonical?.world || {},
        institution.id,
        proposal.id,
        snapshot?.metadata?.playerCountry || "",
        { maxVoters: 48 },
      );
      if (!work?.actors?.length) continue;
      out.push({
        institutionId: clean(institution.id),
        institutionName: clean(institution.name || institution.id),
        proposalId: clean(proposal.id),
        title: clean(proposal.title || proposal.id),
        actors: [...work.actors],
      });
    }
  }
  return out;
};

const politicalActorEvidence = (world, actorName) => {
  const key = getPoliticalProfileKey(world, actorName);
  const actor = key ? world?.politicalActors?.byPolity?.[key] : null;
  return {
    actorKey: clean(key),
    derivedDisposition: actor?.behavioralDisposition && typeof actor.behavioralDisposition === "object"
      ? clone(actor.behavioralDisposition)
      : null,
  };
};

const sensitivityWorld = (baseWorld, actorName, variant) => {
  if (!["hawk", "dove"].includes(variant)) return null;
  const world = clone(baseWorld || {});
  const key = getPoliticalProfileKey(world, actorName);
  if (!key || !world?.politicalActors?.byPolity?.[key]) {
    throw new Error(`Political World has no Political Actor for ${actorName || "the selected actor"}.`);
  }
  const actor = world.politicalActors.byPolity[key];
  const traits = variant === "hawk" ? HAWK_TRAITS : DOVE_TRAITS;
  const nextActor = { ...actor, traits: { ...(actor.traits || {}), ...traits } };
  nextActor.behavioralDisposition = derivePoliticalDispositionForActor(nextActor, {
    polityKey: key,
    updatedAt: clean(baseWorld?.updatedAt || baseWorld?.politicalActors?.updatedAt),
  });
  world.politicalActors = {
    ...(world.politicalActors || {}),
    byPolity: { ...(world.politicalActors?.byPolity || {}), [key]: nextActor },
  };
  return {
    world,
    actorKey: clean(key),
    injectedTraits: clone(traits),
    derivedDisposition: nextActor.behavioralDisposition ? clone(nextActor.behavioralDisposition) : null,
  };
};

const evolvedGoalWorld = (baseWorld, actorName, sourceGoal, replacementGoal) => {
  const world = clone(baseWorld || {});
  const key = getPoliticalProfileKey(world, actorName);
  if (!key || !world?.politicalActors?.byPolity?.[key]) {
    throw new Error(`Political World has no Political Actor for ${actorName || "the selected actor"}.`);
  }
  const actor = world.politicalActors.byPolity[key];
  const patch = politicalWorldEvalReplaceUniqueGoal(actor?.goals, sourceGoal, replacementGoal);
  world.politicalActors = {
    ...(world.politicalActors || {}),
    byPolity: {
      ...(world.politicalActors?.byPolity || {}),
      [key]: { ...actor, goals: patch.goals },
    },
  };
  return { world, actorKey: clean(key), ...patch };
};

const evolvedGoalProtocol = Object.freeze({
  evaluationBasis: "aggregate arm-level outcome frequencies",
  runsPerArm: 8,
  qualifyingOutcome: "substantive acceptance of risk-reduction terms or a concrete counterproposal retaining a meaningful deconfliction mechanism; generic willingness to talk, softer rejection, and unsupported invented agreements do not qualify",
  strongSignal: "treatment >= 6/8 qualifying outcomes AND control <= 1/8 qualifying outcomes",
  reverseSignal: "control >= 6/8 qualifying outcomes AND treatment <= 1/8 qualifying outcomes",
  pairInterpretation: "pairs are execution blocks for counterbalancing only; no individual-pair causal veto",
});

const frozenGoalAblationProtocol = Object.freeze({
  evaluationBasis: "aggregate arm-level outcome frequencies; descriptive diagnostic only",
  runsPerArm: 8,
  intervention: "replay each arm's Political Decision Context rendered from the frozen source message while changing only the visible diplomacy proposal",
  qualifyingOutcome: "substantive acceptance of the hotline or a concrete counterproposal retaining a meaningful incident-deconfliction mechanism; generic willingness to talk, softer rejection, and unsupported invented agreements do not qualify",
  threshold: "none predeclared for this follow-up diagnostic",
  pairInterpretation: "pairs are execution blocks for counterbalancing only; no individual-pair causal veto",
});

const preflightFrozenGoalAblationDiplomacy = (snapshot, config) => {
  const actorName = clean(config.speaker);
  const sourceMessage = clean(config.frozenSelectionPrompt);
  const testMessage = clean(config.prompt);
  if (!sourceMessage) throw new Error("Enter the original diplomacy message that selected the verified capsules.");
  if (!testMessage) throw new Error("Enter the autonomy-cost ablation message.");
  if (sourceMessage === testMessage) throw new Error("The frozen capsule source message and ablation test message must differ.");
  const sourceWorld = clone(snapshot?.seen?.world || {});
  const evolution = evolvedGoalWorld(sourceWorld, actorName, config.evolvedGoalSource, config.evolvedGoalReplacement);
  const render = (world, decisionFocusText) => clean(buildDiplomaticPoliticalContext({
    world,
    speakingAs: actorName,
    playerCountry: snapshot?.metadata?.playerCountry || "",
    decisionFocusText,
  })?.text);
  const controlFrozen = render(sourceWorld, sourceMessage);
  const treatmentFrozen = render(evolution.world, sourceMessage);
  const controlNatural = render(sourceWorld, testMessage);
  const treatmentNatural = render(evolution.world, testMessage);
  const replacement = clean(evolution.replacementGoal);
  if (!controlFrozen || !treatmentFrozen) throw new Error("Frozen-capsule preflight could not render both source-message Political Decision Context capsules.");
  if (!treatmentFrozen.includes(replacement)) {
    throw new Error("Frozen-capsule preflight failed: the evolved goal did not survive into the treatment capsule selected by the source message. No AI calls were sent.");
  }
  return {
    actorName,
    actorKey: evolution.actorKey,
    goalIndex: evolution.index,
    sourceGoal: evolution.sourceGoal,
    replacementGoal: evolution.replacementGoal,
    sourceMessage,
    testMessage,
    frozenControlPoliticalHash: politicalWorldEvalHash(controlFrozen),
    frozenTreatmentPoliticalHash: politicalWorldEvalHash(treatmentFrozen),
    frozenControlPoliticalChars: controlFrozen.length,
    frozenTreatmentPoliticalChars: treatmentFrozen.length,
    naturalTestControlPoliticalHash: politicalWorldEvalHash(controlNatural),
    naturalTestTreatmentPoliticalHash: politicalWorldEvalHash(treatmentNatural),
    naturalTestControlPoliticalChars: controlNatural.length,
    naturalTestTreatmentPoliticalChars: treatmentNatural.length,
    treatmentReplacementReachedFrozenCapsule: true,
    controlAlsoContainsReplacement: controlFrozen.includes(replacement),
    naturalSelectorWouldChangeControlCapsule: controlFrozen !== controlNatural,
    naturalSelectorWouldChangeTreatmentCapsule: treatmentFrozen !== treatmentNatural,
  };
};

const preflightEvolvedGoalDiplomacy = (snapshot, config) => {
  const actorName = clean(config.speaker);
  const sourceWorld = clone(snapshot?.seen?.world || {});
  const evolution = evolvedGoalWorld(sourceWorld, actorName, config.evolvedGoalSource, config.evolvedGoalReplacement);
  const control = buildDiplomaticPoliticalContext({
    world: sourceWorld,
    speakingAs: actorName,
    playerCountry: snapshot?.metadata?.playerCountry || "",
    decisionFocusText: config.prompt,
  });
  const treatment = buildDiplomaticPoliticalContext({
    world: evolution.world,
    speakingAs: actorName,
    playerCountry: snapshot?.metadata?.playerCountry || "",
    decisionFocusText: config.prompt,
  });
  const replacement = clean(evolution.replacementGoal);
  const controlText = clean(control?.text);
  const treatmentText = clean(treatment?.text);
  if (!controlText || !treatmentText) throw new Error("Evolved-goal preflight could not render both Political Decision Context capsules.");
  if (!treatmentText.includes(replacement)) {
    throw new Error("Evolved-goal preflight failed: the replacement goal did not survive into the rendered treatment capsule. No AI calls were sent.");
  }
  return {
    actorName,
    actorKey: evolution.actorKey,
    goalIndex: evolution.index,
    sourceGoal: evolution.sourceGoal,
    replacementGoal: evolution.replacementGoal,
    controlPoliticalHash: politicalWorldEvalHash(controlText),
    treatmentPoliticalHash: politicalWorldEvalHash(treatmentText),
    controlPoliticalChars: controlText.length,
    treatmentPoliticalChars: treatmentText.length,
    replacementReachedRenderedCapsule: true,
    controlAlsoContainsReplacement: controlText.includes(replacement),
  };
};

const variantSettings = (snapshot, config, variant, sourceWorld) => {
  const actorName = clean(config.sensitivityActor || config.speaker);
  const sensitivity = ["hawk", "dove"].includes(variant)
    ? sensitivityWorld(sourceWorld, actorName, variant)
    : null;
  const currentEvidence = config.experimentMode === "sensitivity" && variant === "current"
    ? politicalActorEvidence(sourceWorld, actorName)
    : null;
  const evolved = isGoalExperimentMode(config.experimentMode) && variant === "treatment"
    ? evolvedGoalWorld(sourceWorld, clean(config.speaker), config.evolvedGoalSource, config.evolvedGoalReplacement)
    : null;
  const evolvedActorKey = isGoalExperimentMode(config.experimentMode)
    ? clean(evolved?.actorKey || getPoliticalProfileKey(sourceWorld, clean(config.speaker)))
    : "";
  return {
    politicalContextMode: variant === "off" ? "omit" : "normal",
    politicalWorldOverride: sensitivity?.world || evolved?.world || null,
    sharedDirective: politicalWorldEvalSharedDirective(config.experimentMode, actorName),
    sensitivityEvidence: config.experimentMode === "sensitivity"
      ? {
          actorName,
          actorKey: clean(sensitivity?.actorKey || currentEvidence?.actorKey),
          contextMode: variant === "off" ? "omitted" : variant === "current" ? "canonical" : "counterfactual",
          injectedTraits: sensitivity?.injectedTraits || null,
          derivedDisposition: sensitivity?.derivedDisposition || currentEvidence?.derivedDisposition || null,
        }
      : null,
    evolvedGoalEvidence: isGoalExperimentMode(config.experimentMode)
      ? {
          actorName: clean(config.speaker),
          actorKey: evolvedActorKey,
          contextMode: variant === "treatment" ? "synthetic-evolved-goal" : "canonical-control",
          sourceGoal: clean(config.evolvedGoalSource),
          replacementGoal: clean(config.evolvedGoalReplacement),
          goalIndex: Number.isInteger(evolved?.index) ? evolved.index : null,
        }
      : null,
  };
};

const politicalContextTexts = (capture) => {
  const segments = list(capture?.segments).map((segment) => clean(segment?.politicalContextText)).filter(Boolean);
  if (segments.length) return segments;
  const single = clean(capture?.politicalContextText);
  return single ? [single] : [];
};

const renderedDispositionFromCapture = (capture) => {
  for (const text of politicalContextTexts(capture)) {
    const line = text.split(/\r?\n/).find((entry) => /^Disposition:\s*/i.test(entry.trim()));
    if (line) return line.trim().replace(/^Disposition:\s*/i, "");
  }
  return "";
};

const completedSensitivityEvidence = (settings, capture) => settings?.sensitivityEvidence
  ? {
      ...settings.sensitivityEvidence,
      renderedDisposition: renderedDispositionFromCapture(capture),
    }
  : null;

const completedEvolvedGoalEvidence = (settings, capture) => settings?.evolvedGoalEvidence
  ? {
      ...settings.evolvedGoalEvidence,
      politicalContextText: politicalContextTexts(capture).join("\n\n"),
    }
  : null;

const acceptedAttempt = (attempts) => {
  const rows = list(attempts);
  return [...rows].reverse().find((attempt) => attempt?.ok) || rows.at(-1) || null;
};

const transportOf = (capture) => {
  if (capture?.systemPrompt) return capture;
  const taskAttempt = acceptedAttempt(capture?.task?.attempts);
  if (taskAttempt) return taskAttempt;
  const segmentAttempt = acceptedAttempt(capture?.segments?.[0]?.task?.attempts);
  return segmentAttempt || null;
};

const historyEvidenceText = (transport = {}) => list(transport.history).map((entry) => {
  const role = clean(entry?.role);
  const parts = list(entry?.parts).map((part) => String(part?.text ?? "")).join("\n");
  return `${role}\n${parts}`;
}).join("\n\n--- HISTORY TURN ---\n\n");

const onePromptProof = (transport, politicalContextText = "", fallbackSystemPrompt = "", fallbackUserMessage = "") =>
  politicalWorldEvalPromptFingerprint({
    systemPrompt: transport?.systemPrompt || fallbackSystemPrompt || "",
    // Preserve raw text/newlines instead of JSON-stringifying the history. The
    // exact Political World block can then be removed byte-for-byte before the
    // non-PW hash is calculated.
    userMessage: historyEvidenceText(transport) || transport?.userMessage || fallbackUserMessage || "",
    politicalContextText,
  });

const promptProof = (capture) => {
  const segments = list(capture?.segments);
  if (segments.length) {
    const segmentProofs = segments.map((segment) => {
      const transport = acceptedAttempt(segment?.task?.attempts) || {};
      return onePromptProof(transport, segment?.politicalContextText || "", segment?.task?.systemPrompt || "", segment?.task?.userMessage || "");
    });
    return {
      fullHash: politicalWorldEvalHash(segmentProofs.map((proof) => proof.fullHash)),
      nonPoliticalHash: politicalWorldEvalHash(segmentProofs.map((proof) => proof.nonPoliticalHash)),
      politicalHash: politicalWorldEvalHash(segmentProofs.map((proof) => proof.politicalHash || "")),
      politicalChars: segmentProofs.reduce((sum, proof) => sum + Number(proof.politicalChars || 0), 0),
      segments: segmentProofs,
    };
  }
  const transport = transportOf(capture) || {};
  return onePromptProof(
    transport,
    capture?.politicalContextText || "",
    capture?.task?.systemPrompt || "",
    capture?.task?.userMessage || "",
  );
};

const sumUsage = (transports) => {
  const usages = transports.map((transport) => transport?.usage).filter((usage) => usage && typeof usage === "object");
  if (!usages.length) return null;
  const keys = new Set(usages.flatMap((usage) => Object.keys(usage)));
  return Object.fromEntries([...keys].map((key) => [key, usages.reduce((sum, usage) => sum + (Number(usage[key]) || 0), 0)]));
};

const transportMetrics = (capture) => {
  const segmentTransports = list(capture?.segments)
    .map((segment) => acceptedAttempt(segment?.task?.attempts))
    .filter(Boolean);
  const transports = segmentTransports.length ? segmentTransports : [transportOf(capture)].filter(Boolean);
  const primary = transports[0] || {};
  const providers = [...new Set(transports.map((transport) => clean(transport.provider)).filter(Boolean))];
  const models = [...new Set(transports.map((transport) => clean(transport.model)).filter(Boolean))];
  const entryIds = [...new Set(transports.map((transport) => clean(transport.entryId || transport.requestedEntryId)).filter(Boolean))];
  const entryLabels = [...new Set(transports.map((transport) => clean(transport.entryLabel)).filter(Boolean))];
  return {
    provider: providers.length === 1 ? providers[0] : providers.join(" + "),
    model: models.length === 1 ? models[0] : models.join(" + "),
    entryId: entryIds.length === 1 ? entryIds[0] : entryIds.join(" + "),
    entryLabel: entryLabels.length === 1 ? entryLabels[0] : entryLabels.join(" + "),
    latencyMs: transports.reduce((sum, transport) => sum + Number(transport.latencyMs || 0), 0),
    firstByteMs: Number(primary.firstByteMs || 0),
    usage: sumUsage(transports),
    lookupRounds: transports.reduce((sum, transport) => sum + Number(transport.lookupRounds || 0), 0),
    lookupCalls: transports.reduce((sum, transport) => sum + Number(transport.lookupCalls || 0), 0),
  };
};

const rawResponseEvidence = (capture) => {
  const segments = list(capture?.segments);
  if (segments.length) {
    return segments.map((segment, index) => {
      const transport = acceptedAttempt(segment?.task?.attempts);
      return `--- SEGMENT ${index + 1} ---\n${clean(transport?.rawResponse)}`;
    }).join("\n\n");
  }
  return clean(transportOf(capture)?.rawResponse);
};

const priorMessagesFromChat = (chat, playerCountry) => {
  if (!chat) return [];
  const projected = projectChatThread(eventsFromLegacyChat(chat));
  return list(projected.messages).map((message) => ({
    role: clean(message?.speaker).toLocaleLowerCase() === clean(playerCountry).toLocaleLowerCase() ? "user" : "leader",
    speaker: clean(message?.speaker),
    text: clean(message?.text),
    time: clean(message?.time),
    memorySummary: clean(message?.memorySummary),
  })).filter((message) => message.text);
};

const runDiplomacyArm = async ({ snapshot, config, variant, forceEntryId, signal }) => {
  // Every arm gets its own deep clone. Even a helper that accidentally mutates
  // an input object therefore cannot make the second arm inherit the first
  // arm's candidate state.
  const source = clone(snapshot.seen);
  const player = snapshot.metadata.playerCountry;
  const selectedChat = list(source.chats).find((chat) => clean(chat?.id) === clean(config.chatId));
  const projected = selectedChat ? projectChatThread(eventsFromLegacyChat(selectedChat)) : null;
  const participants = projected
    ? list(projected.countries).map((row) => clean(row?.name)).filter(Boolean)
    : [player, config.speaker].filter(Boolean);
  const settings = variantSettings(snapshot, config, variant, source.world);
  const priorMessages = priorMessagesFromChat(selectedChat, player);
  const requestArgs = {
    speakingAs: config.speaker,
    participantNames: participants,
    playerCountry: player,
    priorMessages,
    chatId: clean(config.chatId),
    stateOverride: source,
    politicalContextMode: settings.politicalContextMode,
    politicalWorldOverride: settings.politicalWorldOverride,
  };
  const request = await buildDiplomaticEvaluationRequest({ ...requestArgs, playerMessage: config.prompt });
  let politicalContextText = request.politicalContextText;
  let systemPrompt = request.systemPrompt;
  let frozenAblationEvidence = null;
  if (config.experimentMode === "frozenGoalAblation") {
    const frozenRequest = await buildDiplomaticEvaluationRequest({
      ...requestArgs,
      playerMessage: config.frozenSelectionPrompt,
    });
    systemPrompt = politicalWorldEvalReplaceContextBlock(
      request.systemPrompt,
      request.politicalContextText,
      frozenRequest.politicalContextText,
    );
    politicalContextText = frozenRequest.politicalContextText;
    frozenAblationEvidence = {
      sourceMessage: clean(config.frozenSelectionPrompt),
      testMessage: clean(config.prompt),
      frozenPoliticalHash: politicalWorldEvalHash(frozenRequest.politicalContextText),
      frozenPoliticalChars: String(frozenRequest.politicalContextText || "").length,
      naturalTestPoliticalHash: politicalWorldEvalHash(request.politicalContextText),
      naturalTestPoliticalChars: String(request.politicalContextText || "").length,
      frozenCapsuleReplayedByteForByte: systemPrompt.includes(frozenRequest.politicalContextText),
      naturalTestCapsuleWasReplaced: request.politicalContextText !== frozenRequest.politicalContextText,
      frozenPoliticalContextText: clean(frozenRequest.politicalContextText),
      naturalTestPoliticalContextText: clean(request.politicalContextText),
    };
  }
  const capture = { politicalContextText };
  const evaluationSystemPrompt = settings.sharedDirective
    ? `${systemPrompt}

${settings.sharedDirective}`
    : systemPrompt;
  const raw = await callAI(evaluationSystemPrompt, request.history, {
    taskKey: "diplomacy",
    languageMode: "chat",
    logLabel: `Political World A/B Lab → ${config.speaker}`,
    __forceEntryId: forceEntryId,
    __capture: capture,
    signal,
  });
  return {
    capture,
    parsed: parseDiplomaticEnvelope(raw),
    rawResponse: String(raw ?? ""),
    sensitivityEvidence: completedSensitivityEvidence(settings, capture),
    evolvedGoalEvidence: completedEvolvedGoalEvidence(settings, capture),
    frozenAblationEvidence,
  };
};

const runGroupArm = async ({ snapshot, config, variant, forceEntryId, signal }) => {
  const source = clone(snapshot.seen);
  const chat = list(source.chats).find((entry) => clean(entry?.id) === clean(config.chatId));
  if (!chat) throw new Error("Choose a current group/Council chat for this test.");
  if (clean(chat?.lifecycleInstitutionId)) throw new Error("Lifecycle invitation/accession negotiations are excluded from the read-only A/B lab.");
  const settings = variantSettings(snapshot, config, variant, source.world);
  const capture = {};
  const result = await runChatActionBatch({
    chat,
    playerMessage: config.prompt,
    playerCountry: snapshot.metadata.playerCountry,
    time: snapshot.metadata.gameDate,
    signal,
    evaluation: {
      bundleOverride: source,
      politicalContextMode: settings.politicalContextMode,
      politicalWorldOverride: settings.politicalWorldOverride,
      additionalPoliticalActors: config.experimentMode === "sensitivity" && config.sensitivityActor ? [config.sensitivityActor] : [],
      forceEntryId,
      capture,
      dryRun: true,
      sharedDirective: settings.sharedDirective,
    },
  });
  return {
    capture,
    parsed: { actions: result.actions || [], rejected: result.rejected || [] },
    rawResponse: rawResponseEvidence(capture),
    sensitivityEvidence: completedSensitivityEvidence(settings, capture),
    evolvedGoalEvidence: completedEvolvedGoalEvidence(settings, capture),
  };
};

const runInstitutionVoteArm = async ({ snapshot, config, variant, forceEntryId, signal }) => {
  const canonical = clone(snapshot.canonical);
  const materialized = materializeInstitutionalChannel({
    world: canonical.world,
    chats: canonical.chats,
    institutionId: config.institutionId,
    playerCountry: snapshot.metadata.playerCountry,
    date: snapshot.metadata.gameDate,
  });
  const bundle = { ...canonical, world: materialized.world, chats: materialized.chats };
  const settings = variantSettings(snapshot, config, variant, bundle.world);
  const capture = {};
  const result = await runChatActionBatch({
    chat: materialized.channel,
    playerCountry: snapshot.metadata.playerCountry,
    time: snapshot.metadata.gameDate,
    signal,
    institutionProposalId: config.proposalId,
    formalBusinessRequested: true,
    formalBusinessInteractive: true,
    useCanonicalState: true,
    evaluation: {
      bundleOverride: bundle,
      politicalContextMode: settings.politicalContextMode,
      politicalWorldOverride: settings.politicalWorldOverride,
      additionalPoliticalActors: config.experimentMode === "sensitivity" && config.sensitivityActor ? [config.sensitivityActor] : [],
      forceEntryId,
      capture,
      dryRun: true,
      sharedDirective: settings.sharedDirective,
    },
  });
  const votes = list(result.formalActions).filter((action) => action?.type === "institution_vote");
  return {
    capture,
    parsed: { votes, rejected: result.rejected || [], conversationalActions: list(result.actions).filter((action) => action?.type === "send_message") },
    rawResponse: rawResponseEvidence(capture),
    sensitivityEvidence: completedSensitivityEvidence(settings, capture),
    evolvedGoalEvidence: completedEvolvedGoalEvidence(settings, capture),
  };
};

const runEventsArm = async ({ snapshot, config, variant, forceEntryId, signal }) => {
  const canonical = clone(snapshot.canonical);
  const settings = variantSettings(snapshot, config, variant, canonical.world);
  const capture = {};
  const result = await simulateTimelineJump({
    days: Math.max(1, Number(config.days) || 30),
    mode: "jump",
    signal,
    evaluation: {
      bundleOverride: canonical,
      politicalContextMode: settings.politicalContextMode,
      politicalWorldOverride: settings.politicalWorldOverride,
      additionalPoliticalActors: config.experimentMode === "sensitivity" && config.sensitivityActor ? [config.sensitivityActor] : [],
      forceEntryId,
      capture,
      sharedDirective: settings.sharedDirective,
    },
  });
  return {
    capture,
    parsed: { events: result.events || [], originDate: result.originDate, targetDate: result.targetDate },
    rawResponse: rawResponseEvidence(capture),
    sensitivityEvidence: completedSensitivityEvidence(settings, capture),
    evolvedGoalEvidence: completedEvolvedGoalEvidence(settings, capture),
  };
};

const ARM_RUNNERS = {
  diplomacy: runDiplomacyArm,
  group: runGroupArm,
  institutionVote: runInstitutionVoteArm,
  events: runEventsArm,
};

export const runPoliticalWorldEvaluation = async (snapshot, config = {}, { signal = null, onProgress = null } = {}) => {
  const runner = ARM_RUNNERS[config.testType];
  if (!runner) throw new Error("Choose a Political World evaluation type.");
  const entries = getResolvedFallbackList();
  const forceEntryId = clean(config.entryId);
  const entry = entries.find((row) => row.id === forceEntryId);
  if (!entry) throw new Error("Choose one exact AI Fallback-list entry before running the A/B test.");
  const experimentMode = ["sensitivity", "evolvedGoal", "frozenGoalAblation"].includes(config.experimentMode) ? config.experimentMode : "comparison";
  const runs = isGoalExperimentMode(experimentMode)
    ? (experimentMode === "frozenGoalAblation" ? frozenGoalAblationProtocol.runsPerArm : evolvedGoalProtocol.runsPerArm)
    : Math.max(1, Math.min(5, Number(config.runs) || (config.testType === "events" ? 3 : 5)));
  if (experimentMode === "sensitivity" && !clean(config.sensitivityActor || config.speaker)) {
    throw new Error("Choose an actor for the HAWK/DOVE sensitivity sweep.");
  }
  if (isGoalExperimentMode(experimentMode) && config.testType !== "diplomacy") {
    throw new Error("The evolved-goal diagnostics currently support leader diplomacy only.");
  }
  const evolvedGoalPreflight = experimentMode === "evolvedGoal" ? preflightEvolvedGoalDiplomacy(snapshot, config) : null;
  const frozenGoalAblationPreflight = experimentMode === "frozenGoalAblation" ? preflightFrozenGoalAblationDiplomacy(snapshot, config) : null;

  const report = {
    schemaVersion: 4,
    kind: "political-world-ab-evaluation",
    createdAt: new Date().toISOString(),
    snapshot: { ...snapshot.metadata, hash: snapshot.canonicalHash, capturedAt: snapshot.capturedAt },
    config: { ...config, entryId: forceEntryId, entryLabel: entry.label, runs, experimentMode },
    ...(experimentMode === "sensitivity" ? {
      sensitivityProfiles: { hawk: HAWK_TRAITS, dove: DOVE_TRAITS },
      sensitivitySemantics: {
        actorName: clean(config.sensitivityActor || config.speaker),
        sharedDirective: politicalWorldEvalSharedDirective(experimentMode, config.sensitivityActor || config.speaker),
      },
    } : {}),
    ...(experimentMode === "evolvedGoal" ? {
      evolvedGoalProtocol,
      evolvedGoalPreflight,
    } : {}),
    ...(experimentMode === "frozenGoalAblation" ? {
      frozenGoalAblationProtocol,
      frozenGoalAblationPreflight,
    } : {}),
    runs: [],
    warnings: [],
  };
  const totalArms = runs * politicalWorldEvalVariantOrder(experimentMode, 0).length;
  let completed = 0;

  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    const order = politicalWorldEvalVariantOrder(experimentMode, runIndex);
    const run = { runIndex, order, arms: [], promptParity: false };
    for (let slot = 0; slot < order.length; slot += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException("Cancelled", "AbortError");
      const variant = order[slot];
      onProgress?.({ completed, total: totalArms, runIndex, slot, variant, label: politicalWorldEvalLabel(variant) });
      const startedAt = Date.now();
      try {
        const answer = await runner({ snapshot, config, variant, forceEntryId, signal });
        const prompt = promptProof(answer.capture);
        run.arms.push({
          variant,
          label: politicalWorldEvalLabel(variant),
          ok: true,
          elapsedMs: Date.now() - startedAt,
          prompt,
          metrics: transportMetrics(answer.capture),
          parsed: answer.parsed,
          rawResponse: answer.rawResponse,
          ...(answer.sensitivityEvidence ? { sensitivityEvidence: answer.sensitivityEvidence } : {}),
          ...(answer.evolvedGoalEvidence ? { evolvedGoalEvidence: answer.evolvedGoalEvidence } : {}),
          ...(answer.frozenAblationEvidence ? { frozenAblationEvidence: answer.frozenAblationEvidence } : {}),
          capture: answer.capture,
        });
      } catch (error) {
        run.arms.push({
          variant,
          label: politicalWorldEvalLabel(variant),
          ok: false,
          elapsedMs: Date.now() - startedAt,
          error: clean(error?.message || error),
        });
      }
      completed += 1;
      onProgress?.({ completed, total: totalArms, runIndex, slot, variant, label: politicalWorldEvalLabel(variant) });
    }
    const successful = run.arms.filter((arm) => arm.ok);
    run.promptParity = successful.length === run.arms.length && politicalWorldEvalPromptParity(successful);
    run.contextIsolation = successful.length === run.arms.length
      ? politicalWorldEvalContextIsolation(successful)
      : { ok: false, issues: ["Not every arm completed, so Political World context isolation could not be proven."] };
    const modelKeys = successful.map((arm) => `${arm.metrics?.entryId || ""}:${arm.metrics?.provider || ""}:${arm.metrics?.model || ""}`).filter(Boolean);
    run.modelParity = successful.length === run.arms.length && modelKeys.length === run.arms.length && new Set(modelKeys).size === 1;
    if (!run.promptParity) report.warnings.push(`Run ${runIndex + 1}: non-Political prompt parity could not be proven across every arm.`);
    if (!run.contextIsolation.ok) report.warnings.push(`Run ${runIndex + 1}: ${run.contextIsolation.issues.join(" ")}`);
    if (!run.modelParity) report.warnings.push(`Run ${runIndex + 1}: the provider/model that actually answered was not identical across every arm.`);
    report.runs.push(run);
  }

  const after = await readGameStateBundle({ force: true });
  report.liveStateHashAfter = snapshotIdentity(after);
  report.liveStateUnchanged = report.liveStateHashAfter === snapshot.canonicalHash;
  if (!report.liveStateUnchanged) {
    report.warnings.push("The live campaign changed while this evaluation was running. Results are still from the frozen snapshot, but the live-state immutability check cannot prove the change came from elsewhere.");
  }
  report.completedAt = new Date().toISOString();
  return report;
};
