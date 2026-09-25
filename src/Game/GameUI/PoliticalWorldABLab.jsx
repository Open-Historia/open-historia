import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getEntryStatus, getResolvedFallbackList } from "../AI/providerConfig.js";
import { politicalWorldEvalEvolvedOutcomeSummary } from "../AI/politicalWorldEvalCore.js";
import { saveTextToDisk } from "../../runtime/saveFile.js";
import {
  capturePoliticalWorldEvalSnapshot,
  listPoliticalWorldEvalActors,
  listPoliticalWorldEvalChats,
  listPoliticalWorldEvalGoals,
  listPoliticalWorldEvalVotingProposals,
  runPoliticalWorldEvaluation,
} from "../AI/politicalWorldEval.js";

const panel = {
  background: "rgba(16,16,19,0.88)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "12px",
  padding: "0.85rem",
};
const input = {
  background: "rgba(0,0,0,0.28)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "8px",
  color: "#f8fafc",
  fontFamily: "inherit",
  fontSize: "0.75rem",
  padding: "0.58rem 0.65rem",
  width: "100%",
};
const label = { color: "rgba(255,255,255,0.56)", display: "block", fontSize: "0.62rem", fontWeight: 800, marginBottom: "0.3rem", textTransform: "uppercase" };

const Field = ({ title, children }) => <label style={{ display: "block", minWidth: 0 }}><span style={label}>{title}</span>{children}</label>;

const saveReport = (report) => saveTextToDisk(
  JSON.stringify(report, null, 2),
  `openhistoria-political-world-ab-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  "application/json",
);

const ArmBody = ({ arm }) => {
  if (!arm?.ok) return <div style={{ color: "#fca5a5", fontSize: "0.75rem" }}>{arm?.error || "This arm failed."}</div>;
  const parsed = arm.parsed || {};
  if (typeof parsed.reply === "string") {
    return <div style={{ color: "rgba(255,255,255,0.86)", fontSize: "0.78rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{parsed.reply || "(no visible reply)"}</div>;
  }
  if (Array.isArray(parsed.events)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        {parsed.events.length ? parsed.events.map((event, index) => (
          <div key={`${event?.id || index}`} style={{ borderLeft: "2px solid rgba(167,139,250,0.55)", paddingLeft: "0.55rem" }}>
            <div style={{ color: "#f8fafc", fontSize: "0.74rem", fontWeight: 800 }}>{event?.title || `Event ${index + 1}`}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.62rem", marginTop: "0.12rem" }}>{event?.date || ""}</div>
            {(event?.description || event?.text) && <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.7rem", lineHeight: 1.4, marginTop: "0.2rem" }}>{event.description || event.text}</div>}
          </div>
        )) : <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.72rem" }}>No events returned.</div>}
      </div>
    );
  }
  if (Array.isArray(parsed.votes)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        {parsed.votes.length ? parsed.votes.map((vote, index) => (
          <div key={index} style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.72rem" }}>
            <b>{vote.actorName}</b>: {String(vote.voteChoice || "").toUpperCase()}{vote.reason ? ` - ${vote.reason}` : ""}
          </div>
        )) : <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.72rem" }}>No formal ballots returned.</div>}
      </div>
    );
  }
  if (Array.isArray(parsed.actions)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {parsed.actions.length ? parsed.actions.map((action, index) => (
          <div key={index} style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.72rem", lineHeight: 1.4 }}>
            <b>{action.actorName || action.type}</b>{action.content ? `: ${action.content}` : ` - ${action.type}`}
          </div>
        )) : <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.72rem" }}>No actions returned.</div>}
      </div>
    );
  }
  return <pre style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.65rem", margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(parsed, null, 2)}</pre>;
};

const compactRecord = (value) => value && typeof value === "object"
  ? Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== "").map(([key, entry]) => `${key}=${entry}`).join(" · ")
  : "";

const isGoalExperimentMode = (mode) => ["evolvedGoal", "frozenGoalAblation"].includes(mode);

const ArmCard = ({ arm, blindName, revealed }) => (
  <div style={{ ...panel, minWidth: 0 }}>
    <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between", marginBottom: "0.6rem" }}>
      <div style={{ color: "#f8fafc", fontSize: "0.78rem", fontWeight: 900 }}>{revealed ? arm.label : `Response ${blindName}`}</div>
      <div style={{ color: arm.ok ? "#86efac" : "#fca5a5", fontSize: "0.6rem", fontWeight: 800 }}>{arm.ok ? "completed" : "failed"}</div>
    </div>
    <ArmBody arm={arm} />
    {arm.ok && (
      <details style={{ marginTop: "0.65rem" }}>
        <summary style={{ color: "rgba(255,255,255,0.42)", cursor: "pointer", fontSize: "0.62rem" }}>Model / prompt evidence</summary>
        <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.62rem", lineHeight: 1.5, marginTop: "0.4rem" }}>
          <div>{arm.metrics?.entryLabel || `${arm.metrics?.provider || "provider"} ${arm.metrics?.model || ""}`}</div>
          <div>{Math.round(arm.metrics?.latencyMs || arm.elapsedMs || 0)} ms · {arm.metrics?.usage?.totalTokens ?? "?"} tokens</div>
          <div>Non-PW prompt: {arm.prompt?.nonPoliticalHash}</div>
          <div>PW block: {arm.prompt?.politicalChars || 0} chars {arm.prompt?.politicalHash ? `(${arm.prompt.politicalHash})` : ""}</div>
          {revealed && arm.sensitivityEvidence && <>
            <div style={{ marginTop: "0.35rem" }}>Sensitivity actor: {arm.sensitivityEvidence.actorName || "?"} · {arm.sensitivityEvidence.contextMode || "?"}</div>
            <div>Injected traits: {compactRecord(arm.sensitivityEvidence.injectedTraits) || "none"}</div>
            <div>Derived disposition: {compactRecord(arm.sensitivityEvidence.derivedDisposition) || "none"}</div>
            <div>Rendered disposition: {arm.sensitivityEvidence.renderedDisposition || "none"}</div>
          </>}
          {revealed && arm.evolvedGoalEvidence && <>
            <div style={{ marginTop: "0.35rem" }}>Evolved-goal arm: {arm.evolvedGoalEvidence.contextMode || "?"}</div>
            <div>Seed goal: {arm.evolvedGoalEvidence.sourceGoal || "?"}</div>
            <div>Treatment goal: {arm.evolvedGoalEvidence.replacementGoal || "?"}</div>
          </>}
          {revealed && arm.frozenAblationEvidence && <>
            <div style={{ marginTop: "0.35rem" }}>Frozen capsule replay: {arm.frozenAblationEvidence.frozenCapsuleReplayedByteForByte ? "PROVEN" : "NOT PROVEN"}</div>
            <div>Frozen PW: {arm.frozenAblationEvidence.frozenPoliticalChars || 0} chars ({arm.frozenAblationEvidence.frozenPoliticalHash || "?"})</div>
            <div>Natural new-task PW: {arm.frozenAblationEvidence.naturalTestPoliticalChars || 0} chars ({arm.frozenAblationEvidence.naturalTestPoliticalHash || "?"})</div>
            <div>Natural selector differed: {arm.frozenAblationEvidence.naturalTestCapsuleWasReplaced ? "yes - frozen block substituted" : "no - same block"}</div>
          </>}
        </div>
      </details>
    )}
  </div>
);

export default function PoliticalWorldABLab({ onClose }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [judgements, setJudgements] = useState({});
  const abortRef = useRef(null);
  const entries = useMemo(() => getResolvedFallbackList(), []);
  const [config, setConfig] = useState({
    testType: "diplomacy",
    experimentMode: "comparison",
    runs: 5,
    entryId: entries[0]?.id || "",
    speaker: "",
    chatId: "",
    institutionId: "",
    proposalId: "",
    prompt: "",
    days: 30,
    sensitivityActor: "",
    evolvedGoalSource: "",
    evolvedGoalReplacement: "",
    frozenSelectionPrompt: "",
    blind: true,
  });

  useEffect(() => {
    let live = true;
    setLoadingSnapshot(true);
    capturePoliticalWorldEvalSnapshot().then((value) => {
      if (!live) return;
      setSnapshot(value);
      const actors = listPoliticalWorldEvalActors(value).filter((name) => name !== value.metadata.playerCountry);
      const chats = listPoliticalWorldEvalChats(value);
      const defaultSpeaker = actors[0] || "";
      const direct = chats.find((chat) => !chat.group && !chat.institutionId && chat.countries.includes(defaultSpeaker));
      const votes = listPoliticalWorldEvalVotingProposals(value);
      setConfig((prior) => ({
        ...prior,
        speaker: prior.speaker || defaultSpeaker,
        sensitivityActor: prior.sensitivityActor || defaultSpeaker,
        chatId: prior.chatId || direct?.id || "",
        institutionId: prior.institutionId || votes[0]?.institutionId || "",
        proposalId: prior.proposalId || votes[0]?.proposalId || "",
      }));
    }).catch((cause) => {
      if (live) setError(String(cause?.message || cause));
    }).finally(() => { if (live) setLoadingSnapshot(false); });
    return () => { live = false; abortRef.current?.abort(); };
  }, []);

  const actors = useMemo(() => snapshot ? listPoliticalWorldEvalActors(snapshot).filter((name) => name !== snapshot.metadata.playerCountry) : [], [snapshot]);
  const chats = useMemo(() => snapshot ? listPoliticalWorldEvalChats(snapshot) : [], [snapshot]);
  const groupChats = useMemo(() => chats.filter((chat) => chat.group || chat.institutionId), [chats]);
  const voting = useMemo(() => snapshot ? listPoliticalWorldEvalVotingProposals(snapshot) : [], [snapshot]);
  const selectedGroupChat = useMemo(() => groupChats.find((chat) => chat.id === config.chatId) || null, [groupChats, config.chatId]);
  const selectedVoting = useMemo(() => voting.find((row) => row.institutionId === config.institutionId && row.proposalId === config.proposalId) || null, [voting, config.institutionId, config.proposalId]);
  const sensitivityActors = useMemo(() => {
    if (config.testType === "diplomacy") return config.speaker ? [config.speaker] : [];
    if (config.testType === "group") return (selectedGroupChat?.countries || []).filter((name) => name && name !== snapshot?.metadata?.playerCountry);
    if (config.testType === "institutionVote") return selectedVoting?.actors || [];
    return actors;
  }, [actors, config.speaker, config.testType, selectedGroupChat, selectedVoting, snapshot?.metadata?.playerCountry]);
  const effectiveSensitivityActor = sensitivityActors.includes(config.sensitivityActor)
    ? config.sensitivityActor
    : sensitivityActors[0] || "";

  const evolvedGoals = useMemo(() => snapshot && config.speaker ? listPoliticalWorldEvalGoals(snapshot, config.speaker) : [], [config.speaker, snapshot]);
  const effectiveEvolvedGoalSource = evolvedGoals.includes(config.evolvedGoalSource)
    ? config.evolvedGoalSource
    : evolvedGoals[0] || "";

  const patch = (next) => setConfig((prior) => ({ ...prior, ...next }));
  const setExperimentMode = (experimentMode) => {
    patch({
      experimentMode,
      ...(isGoalExperimentMode(experimentMode)
        ? {
            testType: "diplomacy",
            runs: 8,
            blind: true,
            ...(experimentMode === "frozenGoalAblation" && !config.frozenSelectionPrompt.trim() && config.prompt.trim()
              ? { frozenSelectionPrompt: config.prompt }
              : {}),
          }
        : { runs: config.testType === "events" ? 3 : 5 }),
    });
  };
  const setTestType = (testType) => {
    const next = { testType, runs: isGoalExperimentMode(config.experimentMode) ? 8 : testType === "events" ? 3 : 5 };
    if (testType === "diplomacy") {
      next.chatId = chats.find((chat) => !chat.group && !chat.institutionId && chat.countries.includes(config.speaker))?.id || "";
      next.sensitivityActor = config.speaker || "";
    } else if (testType === "group") {
      next.chatId = groupChats[0]?.id || "";
      next.sensitivityActor = groupChats[0]?.countries?.find((name) => name !== snapshot?.metadata?.playerCountry) || "";
    } else if (testType === "institutionVote") {
      next.institutionId = voting[0]?.institutionId || "";
      next.proposalId = voting[0]?.proposalId || "";
      next.sensitivityActor = voting[0]?.actors?.[0] || "";
    } else {
      next.sensitivityActor = actors[0] || "";
    }
    patch(next);
  };

  const run = async () => {
    if (!snapshot || running) return;
    setError("");
    setReport(null);
    setRevealed(false);
    setJudgements({});
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const result = await runPoliticalWorldEvaluation(snapshot, {
        ...config,
        sensitivityActor: effectiveSensitivityActor,
        evolvedGoalSource: effectiveEvolvedGoalSource,
      }, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      setReport(result);
      setRevealed(!config.blind);
    } catch (cause) {
      if (cause?.name !== "AbortError") setError(String(cause?.message || cause));
    } finally {
      abortRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const effectiveRuns = isGoalExperimentMode(config.experimentMode) ? 8 : Math.max(1, Number(config.runs) || 1);
  const requestedArms = (config.experimentMode === "sensitivity" ? 4 : 2) * effectiveRuns;
  const canRun = snapshot && config.entryId && !running
    && (config.testType !== "diplomacy" || (config.speaker && config.prompt.trim()))
    && (config.testType !== "group" || (selectedGroupChat && config.prompt.trim()))
    && (config.testType !== "institutionVote" || Boolean(selectedVoting))
    && (config.experimentMode !== "sensitivity" || Boolean(effectiveSensitivityActor))
    && (!isGoalExperimentMode(config.experimentMode) || (config.testType === "diplomacy" && effectiveEvolvedGoalSource && config.evolvedGoalReplacement.trim()))
    && (config.experimentMode !== "frozenGoalAblation" || (config.frozenSelectionPrompt.trim() && config.prompt.trim() && config.frozenSelectionPrompt.trim() !== config.prompt.trim()));
  const evolvedSummary = useMemo(() => {
    if (!isGoalExperimentMode(report?.config?.experimentMode)) return null;
    const summary = politicalWorldEvalEvolvedOutcomeSummary(report.runs, judgements);
    return report?.config?.experimentMode === "frozenGoalAblation"
      ? { ...summary, threshold: "not-predeclared" }
      : summary;
  }, [judgements, report]);
  const evolvedBlindScoringReady = !evolvedSummary || (
    evolvedSummary.fullyScored
    && (evolvedSummary.control.completed + evolvedSummary.treatment.completed) > 0
  );

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Political World A/B Lab" style={{ alignItems: "center", background: "rgba(3,3,5,0.74)", backdropFilter: "blur(18px)", display: "flex", inset: 0, justifyContent: "center", padding: "1rem", position: "fixed", zIndex: 2147483600 }}>
      <div style={{ background: "linear-gradient(180deg, rgba(33,30,43,0.98), rgba(13,13,17,0.98))", border: "1px solid rgba(167,139,250,0.28)", borderRadius: "16px", boxShadow: "0 28px 90px rgba(0,0,0,0.55)", color: "white", display: "flex", flexDirection: "column", fontFamily: "sans-serif", height: "min(900px, calc(100vh - 2rem))", maxWidth: "1320px", overflow: "hidden", width: "min(97vw, 1320px)" }}>
        <header style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.8rem", padding: "0.9rem 1rem" }}>
          <div style={{ alignItems: "center", background: "rgba(139,92,246,0.16)", border: "1px solid rgba(167,139,250,0.24)", borderRadius: "9px", display: "flex", fontWeight: 900, height: "2.2rem", justifyContent: "center", width: "2.2rem" }}>A/B</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1rem", fontWeight: 900 }}>Political World A/B Lab</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.65rem", marginTop: "0.15rem" }}>Frozen, read-only paired Gemini/provider evaluation. Campaign canon is never applied or changed.</div>
          </div>
          <button type="button" onClick={onClose} disabled={running} style={{ ...input, cursor: running ? "not-allowed" : "pointer", fontSize: "1rem", padding: 0, width: "2.25rem", height: "2.25rem" }}>×</button>
        </header>

        <div style={{ display: "grid", flex: 1, gridTemplateColumns: "minmax(270px, 330px) minmax(0, 1fr)", minHeight: 0 }}>
          <aside style={{ borderRight: "1px solid rgba(255,255,255,0.08)", minHeight: 0, overflowY: "auto", padding: "0.85rem" }}>
            <div style={{ ...panel, marginBottom: "0.7rem" }}>
              <div style={{ color: "#ddd6fe", fontSize: "0.66rem", fontWeight: 900, textTransform: "uppercase" }}>Frozen source</div>
              {loadingSnapshot ? <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.45rem" }}>Reading current campaign...</div> : snapshot ? (
                <div style={{ fontSize: "0.72rem", lineHeight: 1.55, marginTop: "0.4rem" }}>
                  <b>{snapshot.metadata.gameName || snapshot.metadata.scenarioName || snapshot.metadata.gameId || "Current campaign"}</b><br />
                  <span style={{ color: "rgba(255,255,255,0.42)" }}>{snapshot.metadata.scenarioName || snapshot.metadata.scenarioId || "Scenario metadata unavailable"}</span><br />
                  <span style={{ color: "rgba(255,255,255,0.58)" }}>{snapshot.metadata.playerCountry} · {snapshot.metadata.gameDate} · round {snapshot.metadata.round || "?"}</span><br />
                  <span style={{ color: "rgba(255,255,255,0.32)" }}>snapshot {snapshot.canonicalHash}</span>
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              <Field title="Test type">
                <select value={config.testType} onChange={(e) => setTestType(e.target.value)} disabled={isGoalExperimentMode(config.experimentMode)} style={input}>
                  <option value="diplomacy">Leader diplomacy</option>
                  <option value="group">Group / Council response</option>
                  <option value="institutionVote">Institution vote</option>
                  <option value="events">Event generation / time skip</option>
                </select>
              </Field>
              <Field title="Experiment">
                <select value={config.experimentMode} onChange={(e) => setExperimentMode(e.target.value)} style={input}>
                  <option value="comparison">Current Political World vs OFF</option>
                  <option value="sensitivity">Sensitivity: OFF / Current / HAWK / DOVE</option>
                  <option value="evolvedGoal">Evolved canonical goal: Seed control / Treatment</option>
                  <option value="frozenGoalAblation">Frozen capsules: autonomy-cost ablation</option>
                </select>
              </Field>
              {config.experimentMode === "sensitivity" && <div style={{ color: "rgba(196,181,253,0.72)", fontSize: "0.62rem", lineHeight: 1.45 }}>
                Counterfactual diagnostic: for the selected actor only, an injected Political Decision Context overrides conflicting scenario-authored temperament for this task. Objective campaign facts, goals, relationships, capabilities and history stay unchanged. OFF keeps ordinary scenario characterization.
              </div>}
              {config.experimentMode === "evolvedGoal" && <div style={{ color: "rgba(196,181,253,0.72)", fontSize: "0.62rem", lineHeight: 1.45 }}>
                Controlled evolved-state diagnostic: both arms keep Political World enabled. Treatment replaces exactly one canonical goal in an isolated clone, preserves its list position, and changes no traits, disposition, government, perceptions, objective canon or live save state. The lab locks 8 control + 8 treatment calls with a predeclared 4/4 control-first vs treatment-first block order.
              </div>}
              {config.experimentMode === "frozenGoalAblation" && <div style={{ color: "rgba(196,181,253,0.72)", fontSize: "0.62rem", lineHeight: 1.45 }}>
                Follow-up isolation diagnostic: each arm first renders its Political Decision Context from the original source message, then replays that exact block byte-for-byte while the provider sees a different diplomacy proposal. CP3B is therefore held fixed for the call; production selection and Political World behavior are not changed.
              </div>}
              <Field title="Exact AI entry">
                <select value={config.entryId} onChange={(e) => patch({ entryId: e.target.value })} style={input}>
                  {entries.map((entry) => {
                    const state = getEntryStatus(entry.id);
                    return <option key={entry.id} value={entry.id}>{entry.label}{state?.status && state.status !== "ready" ? ` (${state.status})` : ""}</option>;
                  })}
                </select>
              </Field>
              <Field title="Paired runs">
                <input type="number" min="1" max={isGoalExperimentMode(config.experimentMode) ? 8 : 5} value={effectiveRuns} disabled={isGoalExperimentMode(config.experimentMode)} onChange={(e) => patch({ runs: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} style={input} />
              </Field>

              {config.testType === "diplomacy" && <>
                <Field title="Speaking polity">
                  <select value={config.speaker} onChange={(e) => patch({ speaker: e.target.value, sensitivityActor: e.target.value, evolvedGoalSource: "", chatId: "" })} style={input}>{actors.map((name) => <option key={name}>{name}</option>)}</select>
                </Field>
                <Field title="Conversation context (optional)">
                  <select value={config.chatId} onChange={(e) => patch({ chatId: e.target.value })} style={input}>
                    <option value="">Fresh exchange</option>
                    {chats.filter((chat) => chat.countries.includes(config.speaker)).map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
                  </select>
                </Field>
              </>}

              {isGoalExperimentMode(config.experimentMode) && config.testType === "diplomacy" && <>
                <Field title="Seed goal to replace">
                  <select value={effectiveEvolvedGoalSource} onChange={(e) => patch({ evolvedGoalSource: e.target.value })} style={input}>
                    {evolvedGoals.map((goal) => <option key={goal} value={goal}>{goal}</option>)}
                  </select>
                </Field>
                <Field title="Evolved goal">
                  <textarea value={config.evolvedGoalReplacement} onChange={(e) => patch({ evolvedGoalReplacement: e.target.value })} rows={4} placeholder="Enter the one synthetic evolved priority. It must not simply copy the probe's requested mechanism." style={{ ...input, lineHeight: 1.45, resize: "vertical" }} />
                </Field>
                {config.experimentMode === "frozenGoalAblation" && <Field title="Frozen capsule source message">
                  <textarea value={config.frozenSelectionPrompt} onChange={(e) => patch({ frozenSelectionPrompt: e.target.value })} rows={5} placeholder="Paste the exact original proposal that selected the verified control/treatment capsules..." style={{ ...input, lineHeight: 1.45, resize: "vertical" }} />
                </Field>}
                {config.experimentMode === "evolvedGoal" ? <div style={{ color: "rgba(253,230,138,0.76)", fontSize: "0.62rem", lineHeight: 1.45 }}>
                  Predeclared interpretation: aggregate arm frequencies only. Strong predicted-direction signal = treatment at least 6/8 qualifying, control at most 1/8. Reverse signal = control at least 6/8, treatment at most 1/8. A qualifying reply must accept substantive risk-reduction terms or offer a concrete counterproposal retaining a meaningful deconfliction mechanism. Generic willingness to talk, softer rejection, and unsupported invented agreements do not qualify; individual pairs are execution blocks, not causal vetoes.
                </div> : <div style={{ color: "rgba(253,230,138,0.76)", fontSize: "0.62rem", lineHeight: 1.45 }}>
                  Diagnostic interpretation only: no new strong-signal threshold is predeclared. Blind-score the two arms using the same qualifying/non-qualifying/canon-issue rubric, then compare aggregate frequencies. The report records both the frozen source-message capsule and the capsule CP3B would naturally have selected for the new test message.
                </div>}
              </>}

              {config.testType === "group" && <Field title="Group / Council">
                <select value={config.chatId} onChange={(e) => {
                  const nextChat = groupChats.find((chat) => chat.id === e.target.value);
                  patch({ chatId: e.target.value, sensitivityActor: nextChat?.countries?.find((name) => name !== snapshot?.metadata?.playerCountry) || "" });
                }} style={input}>{groupChats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select>
              </Field>}

              {config.testType === "institutionVote" && <Field title="Open ballot">
                <select value={`${config.institutionId}::${config.proposalId}`} onChange={(e) => {
                  const [institutionId, proposalId] = e.target.value.split("::");
                  const nextVote = voting.find((row) => row.institutionId === institutionId && row.proposalId === proposalId);
                  patch({ institutionId, proposalId, sensitivityActor: nextVote?.actors?.[0] || "" });
                }} style={input}>
                  {!voting.length && <option value="::">No current voting proposals</option>}
                  {voting.map((row) => <option key={`${row.institutionId}:${row.proposalId}`} value={`${row.institutionId}::${row.proposalId}`}>{row.institutionName} - {row.title}</option>)}
                </select>
              </Field>}

              {config.testType === "events" && <Field title="Time window (days)">
                <input type="number" min="1" max="365" value={config.days} onChange={(e) => patch({ days: Math.max(1, Math.min(365, Number(e.target.value) || 30)) })} style={input} />
              </Field>}

              {config.experimentMode === "sensitivity" && config.testType !== "diplomacy" && <Field title="Sensitivity actor">
                <select value={effectiveSensitivityActor} onChange={(e) => patch({ sensitivityActor: e.target.value })} style={input}>{sensitivityActors.map((name) => <option key={name}>{name}</option>)}</select>
              </Field>}

              {["diplomacy", "group"].includes(config.testType) && <Field title={config.experimentMode === "frozenGoalAblation" ? "Ablation test message" : "Test message"}>
                <textarea value={config.prompt} onChange={(e) => patch({ prompt: e.target.value })} rows={5} placeholder="Enter the exact player message used in every arm..." style={{ ...input, lineHeight: 1.45, resize: "vertical" }} />
              </Field>}

              <label style={{ alignItems: "center", color: "rgba(255,255,255,0.72)", display: "flex", fontSize: "0.7rem", gap: "0.5rem" }}>
                <input type="checkbox" checked={config.blind} disabled={isGoalExperimentMode(config.experimentMode)} onChange={(e) => patch({ blind: e.target.checked })} /> Blind labels until reveal{isGoalExperimentMode(config.experimentMode) ? " (required for this protocol)" : ""}
              </label>

              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.64rem", lineHeight: 1.45 }}>
                This test will make at least <b style={{ color: "rgba(255,255,255,0.72)" }}>{requestedArms}</b> AI calls. Validation retries can add calls. Every arm is pinned to the exact entry above.
              </div>
              <div style={{ color: "rgba(253,230,138,0.72)", fontSize: "0.62rem", lineHeight: 1.45 }}>
                Developer diagnostic: saved JSON reports include raw prompts/responses and may contain private Political World state or campaign spoilers.
              </div>

              <button type="button" disabled={!canRun} onClick={run} style={{ ...input, background: canRun ? "rgba(124,58,237,0.34)" : "rgba(255,255,255,0.04)", borderColor: canRun ? "rgba(167,139,250,0.5)" : "rgba(255,255,255,0.08)", color: canRun ? "#ede9fe" : "rgba(255,255,255,0.3)", cursor: canRun ? "pointer" : "not-allowed", fontWeight: 900 }}>
                {running ? "Running paired evaluation..." : "Run paired test"}
              </button>
              {running && <button type="button" onClick={() => abortRef.current?.abort(new DOMException("Cancelled", "AbortError"))} style={{ ...input, cursor: "pointer" }}>Cancel</button>}
            </div>
          </aside>

          <main style={{ minHeight: 0, overflowY: "auto", padding: "0.9rem" }}>
            {error && <div style={{ ...panel, borderColor: "rgba(248,113,113,0.35)", color: "#fecaca", fontSize: "0.74rem", marginBottom: "0.7rem" }}>{error}</div>}
            {running && progress && (
              <div style={{ ...panel, marginBottom: "0.7rem" }}>
                <div style={{ color: "#ddd6fe", fontSize: "0.75rem", fontWeight: 850 }}>{progress.label}</div>
                <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.66rem", marginTop: "0.25rem" }}>Completed {progress.completed}/{progress.total} arms. The campaign is not being modified.</div>
              </div>
            )}
            {!report && !running && (
              <div style={{ alignItems: "center", color: "rgba(255,255,255,0.35)", display: "flex", flexDirection: "column", height: "100%", justifyContent: "center", minHeight: "300px", textAlign: "center" }}>
                <div style={{ fontSize: "2rem", marginBottom: "0.55rem" }}>A/B</div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem", fontWeight: 850 }}>Same campaign. Same task. Same model.</div>
                <div style={{ fontSize: "0.72rem", lineHeight: 1.5, marginTop: "0.35rem", maxWidth: "520px" }}>The harness can suppress, perturb, or synthetically evolve only the explicit Political World decision context, proves the remaining prompt hash matches, and never applies either candidate to the campaign.</div>
              </div>
            )}
            {report && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                <div style={{ ...panel, alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ color: report.liveStateUnchanged ? "#86efac" : "#fde68a", fontSize: "0.74rem", fontWeight: 850 }}>{report.liveStateUnchanged ? "Read-only check passed" : "Live campaign changed during evaluation"}</div>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.64rem", marginTop: "0.18rem" }}>{report.warnings.length ? report.warnings.join(" ") : "Every completed pair proved non-Political prompt parity."}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.45rem" }}>
                    {config.blind && <button type="button" disabled={!revealed && isGoalExperimentMode(report?.config?.experimentMode) && !evolvedBlindScoringReady} onClick={() => setRevealed((value) => !value)} style={{ ...input, cursor: !revealed && isGoalExperimentMode(report?.config?.experimentMode) && !evolvedBlindScoringReady ? "not-allowed" : "pointer", opacity: !revealed && isGoalExperimentMode(report?.config?.experimentMode) && !evolvedBlindScoringReady ? 0.5 : 1, width: "auto" }}>{revealed ? "Hide labels" : isGoalExperimentMode(report?.config?.experimentMode) && !evolvedBlindScoringReady ? "Score all responses first" : "Reveal variants"}</button>}
                    <button type="button" onClick={() => {
                      saveReport({ ...report, judgements, ...(evolvedSummary ? { goalOutcomeSummary: evolvedSummary, ...(report?.config?.experimentMode === "evolvedGoal" ? { evolvedOutcomeSummary: evolvedSummary } : {}) } : {}) }).catch((cause) => setError(String(cause?.message || cause)));
                    }} style={{ ...input, cursor: "pointer", width: "auto" }}>Save JSON report</button>
                  </div>
                </div>

                {isGoalExperimentMode(report.config?.experimentMode) && evolvedSummary && revealed && (
                  <div style={{ ...panel, color: "rgba(255,255,255,0.72)", fontSize: "0.7rem", lineHeight: 1.5 }}>
                    <div style={{ color: "#f8fafc", fontWeight: 900 }}>{report.config?.experimentMode === "frozenGoalAblation" ? "Aggregate frozen-capsule ablation score" : "Aggregate evolved-goal score"}</div>
                    <div>Treatment qualifying: {evolvedSummary.treatment.qualifying}/{evolvedSummary.treatment.completed} · Control qualifying: {evolvedSummary.control.qualifying}/{evolvedSummary.control.completed}</div>
                    <div>Canon/fabrication issues: treatment {evolvedSummary.treatment.canonIssue}, control {evolvedSummary.control.canonIssue}</div>
                    {report.config?.experimentMode === "evolvedGoal" ? <div style={{ marginTop: "0.25rem", fontWeight: 800 }}>Predeclared threshold: {evolvedSummary.threshold === "predicted-strong-signal" ? "PREDICTED-DIRECTION STRONG SIGNAL" : evolvedSummary.threshold === "reverse-strong-signal" ? "REVERSE STRONG SIGNAL" : evolvedSummary.threshold === "not-met" ? "NOT MET" : "INCOMPLETE - requires eight completed/scored responses in each arm"}</div> : <div style={{ marginTop: "0.25rem", fontWeight: 800 }}>Follow-up diagnostic: no new strong-signal threshold predeclared.</div>}
                  </div>
                )}

                {report.runs.map((runResult, runIndex) => (
                  <section key={runIndex} style={{ ...panel, background: "rgba(255,255,255,0.018)" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: "0.55rem", justifyContent: "space-between", marginBottom: "0.65rem" }}>
                      <div style={{ fontSize: "0.78rem", fontWeight: 900 }}>Run {runIndex + 1}</div>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <div style={{ color: runResult.modelParity ? "#86efac" : "#fca5a5", fontSize: "0.62rem", fontWeight: 800 }}>{runResult.modelParity ? "model MATCH" : "model mismatch"}</div>
                        <div style={{ color: runResult.promptParity ? "#86efac" : "#fca5a5", fontSize: "0.62rem", fontWeight: 800 }}>{runResult.promptParity ? "non-PW prompt MATCH" : "prompt parity NOT PROVEN"}</div>
                        <div style={{ color: runResult.contextIsolation?.ok ? "#86efac" : "#fca5a5", fontSize: "0.62rem", fontWeight: 800 }}>{runResult.contextIsolation?.ok ? "PW isolation PROVEN" : "PW isolation NOT PROVEN"}</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: "0.65rem", gridTemplateColumns: `repeat(${Math.min(4, runResult.arms.length)}, minmax(0, 1fr))` }}>
                      {runResult.arms.map((arm, armIndex) => <ArmCard key={`${arm.variant}:${armIndex}`} arm={arm} blindName={String.fromCharCode(65 + armIndex)} revealed={revealed || !config.blind} />)}
                    </div>
                    {config.blind && !isGoalExperimentMode(report.config?.experimentMode) && runResult.arms.length === 2 && !revealed && (
                      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.65rem" }}>
                        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.64rem" }}>Which better reflects the campaign's politics?</span>
                        {["A", "B", "No meaningful difference"].map((choice) => (
                          <button key={choice} type="button" onClick={() => setJudgements((prior) => ({ ...prior, [runIndex]: choice }))} style={{ ...input, background: judgements[runIndex] === choice ? "rgba(124,58,237,0.28)" : input.background, cursor: "pointer", fontSize: "0.65rem", padding: "0.38rem 0.52rem", width: "auto" }}>{choice}</button>
                        ))}
                      </div>
                    )}
                    {config.blind && isGoalExperimentMode(report.config?.experimentMode) && !revealed && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", marginTop: "0.65rem" }}>
                        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.64rem", lineHeight: 1.45 }}>Blind-score every completed response before reveal. "Canon/fabrication issue" is non-qualifying and records unsupported invented agreements or objective-canon contradictions separately.{report.config?.experimentMode === "frozenGoalAblation" ? " For this follow-up, qualifying means accepting the hotline or retaining a concrete incident-deconfliction mechanism in a counterproposal." : ""}</div>
                        {runResult.arms.map((arm, armIndex) => {
                          if (!arm.ok) return null;
                          const key = `evolved:${runIndex}:${armIndex}`;
                          const blindName = String.fromCharCode(65 + armIndex);
                          return (
                            <div key={key} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                              <span style={{ color: "rgba(255,255,255,0.68)", fontSize: "0.65rem", fontWeight: 800, minWidth: "78px" }}>Response {blindName}</span>
                              {[
                                ["qualifying", "Qualifying"],
                                ["nonQualifying", "Non-qualifying"],
                                ["canonIssue", "Canon/fabrication issue"],
                              ].map(([value, title]) => (
                                <button key={value} type="button" onClick={() => setJudgements((prior) => ({ ...prior, [key]: value }))} style={{ ...input, background: judgements[key] === value ? "rgba(124,58,237,0.28)" : input.background, cursor: "pointer", fontSize: "0.65rem", padding: "0.38rem 0.52rem", width: "auto" }}>{title}</button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}
