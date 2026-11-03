/*! Open Historia — human-oriented, reviewed country Stats scenario authoring. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { callAI } from "../AI/main.jsx";
import { interpretScenarioStatsAiResponse, buildScenarioStartingStatsTool, typedCustomStatsKeys } from "./scenarioStatsAiResponse.js";
import { buildTargetStatsTerritorialBasisKernel, projectCountryStatsScenarioCatalog } from "../AI/countryStatsWorkerKernel.js";
import { downloadScenarioJsonAsset, loadScenarioDetails, saveScenario } from "../../runtime/library.js";
import { normalizeGameDate } from "../../runtime/gameDates.js";
import { legacyPoliticalStatsProjectionWriteError } from "../../runtime/politicalActors.js";
import {
  applyScenarioStatsManualEdits,
  assertScenarioStatsDefinitionContentsCurrent,
  authorApprovedMacroEstimates,
  createReviewedScenarioStatsSheet,
  scenarioStatsCoverage,
  scenarioStatsEditorValues,
  scenarioStatsPolityKey,
  scenarioStatsRequiredReady,
} from "../../runtime/scenarioStatsAuthoring.js";
import { DEFAULT_STAT_INDEX_KEYS, NATIONAL_NATIVE_METRICS } from "../../runtime/statIndexDefinitions.js";
import { stageExplicitNativeStatsBinding } from "../../runtime/statsExplicitNativeBinding.js";
import { auditScenarioEconomicComparability, summarizeScenarioEconomicComparability, serializeScenarioEconomicComparabilityCsv, SCENARIO_GDP_ACCOUNTING_UNIT } from "../../runtime/scenarioEconomicComparability.js";
import { reviewScenarioNationalMetricAliases, serializeScenarioNationalMetricReviewCsv, summarizeScenarioNationalMetricAliasReviews } from "../../runtime/statsMetricAliasReview.js";
import { assertNoLegacyNativeStatCopies, nationalStatsAuthoringContract } from "../../runtime/statsMetricBindings.js";
import { planBoundNationalStatsAliasArchival } from "../../runtime/statsBoundAliasArchival.js";
import { planBoundNationalStatsAliasReconciliation } from "../../runtime/statsBoundAliasReconciliation.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { saveTextToDisk } from "../../runtime/saveFile.js";
import {
  MAX_BATCH_COUNTRIES, MAX_CALLS_PER_RUN, DEFAULT_CALLS_PER_RUN,
  validScenarioStatsCallBudget, scenarioStatsGenerationCandidates, scenarioStatsGenerationQueue, scenarioStatsPlannedCalls,
  scenarioStatsNeedsCostConfirmation, scenarioStatsFailedCallProposals,
} from "./scenarioStatsGenerationBudget.js";

const clean = (value) => String(value ?? "").trim();
const copy = (value) => JSON.parse(JSON.stringify(value));
const inputStyle = { background: "rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.17)", borderRadius: 9, padding: ".55rem .6rem", color: "#fff", minWidth: 0, width: "100%" };
const buttonStyle = { background: "rgba(255,255,255,.09)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, padding: ".55rem .8rem", color: "#fff", cursor: "pointer", fontWeight: 700 };
const cardStyle = { border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: ".8rem", background: "rgba(255,255,255,.025)" };
const summary = (sheet) => sheet?.population?.total ? `${Number(sheet.population.total).toLocaleString()} residents · ${Number(sheet.economy?.gdp ?? 0).toLocaleString()} GDP` : "No quantitative baseline";
const numeric = (value) => value === "" ? "" : Number(value);
const DEMOGRAPHIC_FIELDS = new Set(["birthRate", "deathRate", "birthTrendPerYear", "deathTrendPerYear"]);
const NUMBER_FIELDS = ["population", "gdp", "stability", "gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance", "agriculture", "industry", "services", "birthRate", "deathRate", "birthTrendPerYear", "deathTrendPerYear"];
const FORM_FIELDS = [
  ["population", "Population (people)"], ["gdp", "Annual GDP (shared scenario accounting units)"],
  ["capital", "Capital"], ["continent", "Region / continent"], ["government", "Government"], ["leader", "Leader"],
  ["stability", "Stability (0–100)"], ["currency", "Currency"],
  ["gdpGrowth", "GDP growth (%/year)"], ["inflation", "Inflation (%)"], ["unemployment", "Unemployment (%)"],
  ["publicDebt", "Public debt (% of GDP)"], ["budgetBalance", "Budget balance (% of GDP/year)"],
  ["agriculture", "Agriculture share (%)"], ["industry", "Industry share (%)"], ["services", "Services share (%)"],
  ["birthRate", "Annual births per 1,000 people"], ["deathRate", "Annual deaths per 1,000 people"],
  ["birthTrendPerYear", "Change in birth rate per year"], ["deathTrendPerYear", "Change in death rate per year"],
];
const snapshot = (value) => JSON.stringify(value ?? null);
const EMPTY_SCENARIO_WORLD = Object.freeze({});

const makePrompt = ({ batch, scenarioDate, details, customKeys }) => {
  const custom = Array.isArray(customKeys);
  const typedCustom = typedCustomStatsKeys(customKeys);
  const world = details.data?.world ?? {};
  const game = details.data?.game ?? {};
  const scenario = details.scenario ?? {};
  const startingEvents = (Array.isArray(details.data?.events) ? details.data.events : [])
    .slice(0, 20).map((event) => `${clean(event.date)} ${clean(event.title)}`).filter(Boolean);
  const context = [
    `SHARED ECONOMIC ACCOUNTING UNIT FOR EVERY COUNTRY AND EVERY BATCH: ${SCENARIO_GDP_ACCOUNTING_UNIT}. This is an accounting convention, not evidence that a historical national GDP is known. Do not use PPP or current-year GDP as a substitute; state a bounded evidence/uncertainty explanation in basisNote. Population and GDP must describe the same legal territorial scope.`,
    `SCENARIO: ${clean(scenario.name)}. Starting date ${scenarioDate}.`,
    `Player's starting country: ${clean(game.country)}.`,
    `Scenario prehistory: ${clean(world.startingTimelineText).slice(0, 3200) || "not provided"}`,
    `Simulation rules: ${clean(world.simulationRules).slice(0, 1800) || "not provided"}`,
    `Pre-start event headings: ${startingEvents.join("; ").slice(0, 1400) || "not provided"}`,
    ...batch.map(({ code, name, basis }, index) => [
      `OUTPUT TOOL SLOT: country${index + 1}Json is EXCLUSIVELY for ${code} (${name}).`,
      `CANONICAL SCENARIO COUNTRY: ${code} (display name ${name}). The output slot, not an AI-invented abbreviation, supplies this identity.`,
      `AUTHORITATIVE TERRITORIAL BASIS (legal sovereignty, not occupied lands):`,
      clean(basis.context).slice(0, 4100),
      `Return exactly ${basis.macroPlan.length} regional macro bucket rows with the supplied indices:`,
      basis.macroPlan.map((entry) => `M${entry.index}: ${entry.members.map((item) => item.geography).slice(0, 12).join(", ")} (${entry.members.length} map components)`).join("\n"),
    ].join("\n")),
  ].join("\n\n");
  return {
    system: String.raw`You propose STARTING Statistics for an alternate-history/grand-strategy scenario. Generate historically and scenario-plausible ESTIMATES for the provided starting date, not today's statistics or future historical outcomes. Scenario canon outranks remembered real-world history. Do not generate anything for an unlisted country. This is author review only; no simulation changes happen from this response. Use numbers as JSON numbers, not abbreviations or prose. Call the required submit_scenario_starting_statistics output tool, filling every required countryNJson STRING field with a JSON OBJECT containing the proposal for THAT SLOT'S specified canonical country only. Every countryNJson has two REQUIRED numeric tool arguments: countryNPublicDebt (0..1000) and countryNBudgetBalance (-1000..1000); set both as JSON NUMBERS for the matching slot, and OMIT publicDebt and budgetBalance inside the countryNJson string. The function's required argument names bind the identities. Do NOT add "code", "countryCode", "polityCode", "country", "polity" or "name" in the objects; do not use ISO abbreviations as identities. Never answer with unstructured explanation. Each object must include "macro": a list of {"index":integer,"population":integer,"gdpPerCapita":number,"group":"core"|"integrated"|"overseas/dependent"} for EXACTLY the given native bucket indices. A regional bucket may have population 0 and gdpPerCapita 0 only if it is genuinely uninhabited; national population must remain positive. The native system expands these values to REAL mapped geography; you must never invent province keys. Do not include military units, artificial territorial entries, dates, or continuity/clock receipts. Estimation is permitted but must be labelled in "basisNote" with the evidence or uncertainty and the shared GDP unit; your numbers are proposals for human review, not observations. ${custom
      ? `This scenario uses a CUSTOM presentation sheet. ${typedCustom?.length ? `For each country fill its required countryNCustomStats OBJECT tool field with EXACT keys ${JSON.stringify(typedCustom)} as finite JSON numbers. Do NOT duplicate customStats inside countryNJson; these are independently authored values, not native aliases.` : customKeys.length === 0 ? `All custom cards are native-bound: do not invent any independent customStats fields.` : `For each country include a "customStats" object in countryNJson with EXACT keys ${JSON.stringify(customKeys)} (all finite numerical values).`} Also fill required typed numeric publicDebt and budgetBalance tool arguments for each matching country slot. Include optional "birthRate" and "deathRate" (0..80, births/deaths per 1,000/year), optional "birthTrendPerYear" and "deathTrendPerYear" (-2..2) only when the demographic meaning fits the scenario.`
      : `Standard modern native sheet: for EACH country also return nonempty "capital", "continent", "government", "leader", "currency"; number "stability" (0..100), "gdpGrowth" (-100..100), "inflation" (-1000..1000), "unemployment" (0..100), required typed numeric publicDebt and budgetBalance tool arguments for that country slot, "agriculture", "industry", "services" (each 0..100, sum EXACTLY 100), and "indices" with all six keys ${JSON.stringify(DEFAULT_STAT_INDEX_KEYS)} as 0..100. Include "birthRate" and "deathRate" (0..80 per thousand per year) and "birthTrendPerYear", "deathTrendPerYear" (-2..2), based on the scenario era and circumstances. No country may inherit another era's rates.`} Be careful with colonial territories: bucket population covers only held provinces, not the whole namesake geography. Do not invent missing scope.`,
    user: context,
  };
};

const ScenarioStatsAuthoringPanel = ({ details, formState, countryOptions, statsValue, statsDefinitionDirty = false, statsDefinitionUnavailable = false, onDetailsChange, onDirtyChange, onSaveStatsDefinition, onStatsChange }) => {
  const scenarioId = details?.scenario?.id;
  const world = details?.data?.world ?? EMPTY_SCENARIO_WORLD;
  const scenarioDate = normalizeGameDate(details?.data?.game?.startDate || details?.data?.game?.gameDate);
  const unsavedDate = normalizeGameDate(formState?.gameDate);
  const dateMismatch = !scenarioDate || scenarioDate !== unsavedDate;
  const authoringBlocked = dateMismatch || statsDefinitionDirty || statsDefinitionUnavailable;
  // Only independently stored custom keys are sent to AI or editable as
  // customStats. Native-bound cards are read-only views of countryStats.
  const contract = useMemo(() => nationalStatsAuthoringContract(statsValue), [statsValue]);
  const customKeys = useMemo(() => contract.custom ? contract.customKeys : null, [contract]);
  const customDefinition = contract.boundRows.length > 0 ? statsValue : null;
  const proposalContract = snapshot(contract);
  // A pre-update in-memory draft can survive Fast Refresh without the newer
  // fingerprint. Accept it only if its canonical assessed date still matches;
  // approval also checks readiness against the CURRENT metric definition.
  const staleProposal = (row) => (
    (row.generatedDate === undefined ? row.sheet?.continuity?.assessedDate !== scenarioDate : row.generatedDate !== scenarioDate)
    || (row.authoringContract !== undefined && row.authoringContract !== proposalContract)
  );
  const coverage = useMemo(() => scenarioStatsCoverage(world, countryOptions, { customKeys, customDefinition }), [world, countryOptions, customKeys, customDefinition]);
  const missing = coverage.filter((row) => row.status !== "ready");
  const [selected, setSelected] = useState("");
  const active = coverage.find((row) => row.code === selected) || coverage[0];
  const activeCode = active?.code ?? "";
  const currentSheet = world.countryStats?.[activeCode] ?? null;
  const aliasReviewRows = useMemo(() => reviewScenarioNationalMetricAliases(statsValue, currentSheet)
    .filter((row) => row.reviewRequired), [statsValue, currentSheet]);
  const scenarioAliasReview = useMemo(() => summarizeScenarioNationalMetricAliasReviews(statsValue, world, coverage), [statsValue, world, coverage]);
  const countriesNeedingReview = useMemo(() => new Set(scenarioAliasReview.rows.map((row) => row.countryCode)), [scenarioAliasReview]);
  const aliasArchival = useMemo(() => {
    try {
      return { ...planBoundNationalStatsAliasArchival({ definition: statsValue, world, roster: coverage }), error: "" };
    } catch (problem) {
      return { patches: {}, originals: {}, entries: [], unsupported: "", error: problem?.message || String(problem) };
    }
  }, [statsValue, world, coverage]);
  const [reconcileMetric, setReconcileMetric] = useState("");
  const [reconcileAction, setReconcileAction] = useState("keep-native");
  const [reconcileScope, setReconcileScope] = useState("all");
  const reconciliationPreview = useMemo(() => {
    if (!reconcileMetric) return null;
    try {
      return { ...planBoundNationalStatsAliasReconciliation({
        definition: statsValue, world, roster: coverage, metricKey: reconcileMetric,
        mode: reconcileAction, scope: reconcileScope,
      }), error: "" };
    } catch (problem) {
      return { patches: {}, originals: {}, entries: [], countries: 0, disagreements: 0,
        error: problem?.message || String(problem) };
    }
  }, [statsValue, world, coverage, reconcileMetric, reconcileAction, reconcileScope]);
  const exportAliasReview = async () => {
    // Export only a review of existing readings; do not mutate scenario state.
    try {
      const csv = serializeScenarioNationalMetricReviewCsv(scenarioAliasReview);
      const fileName = `${String(scenarioId || "scenario").replace(/[^A-Za-z0-9_-]/g, "-")}-national-statistics-review.csv`;
      await saveTextToDisk(`\uFEFF${csv}`, fileName, "text/csv;charset=utf-8");
    } catch (problem) {
      setError(problem?.message || String(problem));
    }
  };
  const unboundAliasCards = useMemo(() => {
    const reviewKeys = new Set(scenarioAliasReview.rows.map((row) => row.key));
    if (statsValue?.custom !== true) return [];
    return (statsValue.sections || []).flatMap((section) => section.stats || [])
      .filter((stat) => !stat.nativeMetric && reviewKeys.has(stat.key));
  }, [statsValue, scenarioAliasReview]);
  const [chosenNativeBindings, setChosenNativeBindings] = useState({});
  const [fields, setFields] = useState({});
  const [dirty, setDirty] = useState(false);
  const [proposals, setProposals] = useState({});
  const economicComparability = useMemo(() => {
    const names = Object.fromEntries(coverage.map((row) => [row.code, row.name]));
    const planned = Object.fromEntries(coverage
      .filter((row) => world.countryStats?.[row.code])
      .map((row) => [row.code, world.countryStats[row.code]]));
    for (const [code, proposal] of Object.entries(proposals)) {
      if (proposal?.sheet && !proposal?.error) planned[code] = proposal.sheet;
    }
    return auditScenarioEconomicComparability(planned, names);
  }, [world.countryStats, coverage, proposals]);
  const economicOverview = useMemo(() => summarizeScenarioEconomicComparability(economicComparability), [economicComparability]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [callBudget, setCallBudget] = useState(DEFAULT_CALLS_PER_RUN);
  const callBudgetValid = validScenarioStatsCallBudget(callBudget);
  const catalogRef = useRef(null);
  const draftToOpen = useRef("");
  const runId = useRef(0);
  useEffect(() => {
    setSelected(""); setProposals({}); setChosenNativeBindings({}); setReconcileMetric(""); setReconcileAction("keep-native"); setReconcileScope("all"); setProgress(""); setDirty(false); setError(""); catalogRef.current = null;
    return () => { runId.current += 1; };
  }, [scenarioId]);
  useEffect(() => {
    const draft = draftToOpen.current === activeCode ? proposals[activeCode]?.sheet : null;
    draftToOpen.current = "";
    setFields(scenarioStatsEditorValues(draft || currentSheet, customKeys)); setDirty(Boolean(draft));
  }, [activeCode, currentSheet, customKeys]);
  useEffect(() => { onDirtyChange?.(dirty || Object.keys(proposals).length > 0); }, [dirty, proposals, onDirtyChange]);
  const update = (key, value) => { setFields((previous) => ({ ...previous, [key]: value })); setDirty(true); };
  const updateNested = (key, name, value) => { setFields((previous) => ({ ...previous, [key]: { ...(previous[key] || {}), [name]: value } })); setDirty(true); };
  const ensureCatalog = async () => {
    const mapRevision = snapshot(details?.assetStatus?.regionsGeojson);
    if (catalogRef.current?.scenarioId === scenarioId && catalogRef.current?.mapRevision === mapRevision) return catalogRef.current.catalog;
    // Only the scenario's own map is authoritative. Do not reuse a different
    // campaign's cached geography or silently fall back to modern borders.
    const geojson = await downloadScenarioJsonAsset(scenarioId, "regionsGeojson");
    if (!Array.isArray(geojson?.features) || !geojson.features.length) {
      throw new Error("This scenario does not expose an authoritative regions GeoJSON. Map-backed generation is unavailable; existing Stats can still be edited. No fake geography will be created.");
    }
    const catalog = projectCountryStatsScenarioCatalog(geojson);
    if (!catalog.length) throw new Error("The region file has no usable region IDs.");
    catalogRef.current = { scenarioId, mapRevision, catalog };
    return catalog;
  };
  const basisFor = async (code, catalog) => buildTargetStatsTerritorialBasisKernel({
    bundle: { world, game: details.data?.game, events: details.data?.events || [] },
    code, scenarioCatalog: catalog,
  });
  const loadDraftToEditor = (row) => {
    draftToOpen.current = row.code;
    setSelected(row.code);
    setFields(scenarioStatsEditorValues(row.sheet, customKeys));
    setDirty(true);
  };
  const applyToScenario = async (patches, guards) => {
    if (authoringBlocked) throw new Error("Save the scenario start date and Statistics sheet definition before writing country baselines.");
    const fresh = await loadScenarioDetails(scenarioId);
    const freshDate = normalizeGameDate(fresh?.data?.game?.startDate || fresh?.data?.game?.gameDate);
    if (freshDate !== scenarioDate) throw new Error("Scenario start date changed during Statistics editing. Reload before applying.");
    if (snapshot(fresh.assetStatus?.regionsGeojson) !== snapshot(details.assetStatus?.regionsGeojson)) {
      throw new Error("Scenario map asset changed during authoring; reload the region ledger before saving.");
    }
    if (snapshot(fresh.assetStatus?.stats) !== snapshot(details.assetStatus?.stats)) {
      throw new Error("Scenario Statistics definition changed during authoring. Reload before applying values.");
    }
    if (fresh.assetStatus?.stats) {
      const currentDefinition = await downloadScenarioJsonAsset(scenarioId, "stats", { fresh: true });
      assertScenarioStatsDefinitionContentsCurrent(statsValue, currentDefinition);
    }
    // A concurrent map change invalidates every planned territorial component.
    const freshWorld = fresh.data?.world ?? {};
    if (snapshot(freshWorld.regionOwnershipOverrides) !== snapshot(world.regionOwnershipOverrides)
      || snapshot(freshWorld.regionSovereigntyOverrides) !== snapshot(world.regionSovereigntyOverrides)
      || snapshot(freshWorld.ownerCodes) !== snapshot(world.ownerCodes)) {
      throw new Error("Scenario ownership or polity roster changed. Reload Statistics proposals against the new map.");
    }
    for (const [code, prior] of Object.entries(guards)) {
      if (snapshot(freshWorld.countryStats?.[code]) !== prior) throw new Error(`${code}'s Statistics changed after generation; regenerate or reload instead of overwriting the author's newer values.`);
    }
    // A scenario with an initialized Political World cannot commit a competing
    // starting government through its reviewed Statistics sheet. The actor is
    // the authority; reject before a scenario save, never silently rewrite it.
    for (const [code, sheet] of Object.entries(patches)) {
      const politicalError = legacyPoliticalStatsProjectionWriteError(freshWorld, code, sheet);
      if (politicalError) throw new Error(`${code}: ${politicalError}`);
    }
    const nextWorld = { ...freshWorld, countryStats: { ...(freshWorld.countryStats || {}), ...patches } };
    const saved = await saveScenario(scenarioId, { world: nextWorld });
    onDetailsChange(saved);
    return saved;
  };
  const stageNativeBinding = (card) => {
    if (busy || dirty || Object.keys(proposals).length > 0 || !onStatsChange || statsDefinitionUnavailable) return;
    const nativeMetric = chosenNativeBindings[card.key];
    if (!nativeMetric) return;
    try {
      const next = stageExplicitNativeStatsBinding(statsValue, { key: card.key, nativeMetric });
      if (!window.confirm(`Bind the legacy display card ${card.label} (${card.key}) to canonical ${nativeMetric}? You must verify both figures use the same meaning, scope and units. Existing country values will NOT change. Then save the Statistics definition and explicitly archive old custom copies. Continue?`)) return;
      onStatsChange(next);
      setChosenNativeBindings((previous) => { const next = { ...previous }; delete next[card.key]; return next; });
      setProgress(`Binding staged for ${card.key}. Save Statistics sheet definition, then review and archive its old custom copies. No country values changed.`);
      setError("");
    } catch (problem) { setError(problem?.message || String(problem)); }
  };
  const reconcileBoundMetric = async () => {
    if (busy || authoringBlocked || dirty || Object.keys(proposals).length > 0
      || !reconciliationPreview?.entries?.length || reconciliationPreview.error) return;
    // The initial preview is not an authorization to write a stale world.
    // applyToScenario re-fetches the current map, definition and every original
    // country sheet and fails closed if anything changed after this decision.
    const plan = planBoundNationalStatsAliasReconciliation({
      definition: statsValue, world, roster: coverage, metricKey: reconcileMetric,
      mode: reconcileAction, scope: reconcileScope,
    });
    const examples = plan.entries.slice(0, 5).map((entry) =>
      entry.countryName + ": native " + entry.nativeValue + ", legacy " + entry.legacyValue + " => " + entry.nativeAfter).join("\n");
    const action = reconcileAction === "promote-legacy"
      ? "REPLACE the selected native readings with existing legacy values in the SAME units, preserving both old values in archived* keys"
      : "KEEP selected native readings and archive their independent legacy values";
    if (!window.confirm(
      "Review " + plan.entries.length + " readings in " + plan.countries + " countries for " + reconcileMetric + ".\n" +
      plan.disagreements + " disagreement(s).\nAction: " + action + ".\n\n" + examples + "\n\n" +
      "You must personally verify meaning, units and territorial scope from the exported CSV. " +
      "No GDP/population conversion is inferred. This saves to the SCENARIO for NEW campaigns only. " +
      "Keep an untouched backup. Continue?"
    )) return;
    setBusy(true); setError("");
    try {
      await applyToScenario(plan.patches, plan.originals);
      setProgress("Reconciled " + plan.entries.length + " " + reconcileMetric + " legacy readings in " + plan.countries + " countries; " +
        (reconcileAction === "promote-legacy" ? "native scalars explicitly updated" : "native values retained") +
        ". Other unresolved metrics still need review.");
    } catch (problem) { setError(problem?.message || String(problem)); }
    finally { setBusy(false); }
  };
  const archiveBoundAliases = async () => {
    // Saving fresh countryStats would discard draft form changes and invalidate
    // pending AI proposals. The author must settle those first.
    if (busy || authoringBlocked || dirty || Object.keys(proposals).length > 0
      || aliasArchival.error || !aliasArchival.entries.length || aliasArchival.entries.some((row) => !row.equal)) return;
    const planned = planBoundNationalStatsAliasArchival({ definition: statsValue, world, roster: coverage });
    const conflicting = planned.entries.filter((row) => !row.equal).length;
    const countries = Object.keys(planned.patches).length;
    if (!window.confirm(`Archive ${planned.entries.length} legacy custom Statistics readings across ${countries} countries, including ${conflicting} disagreements? Native values will remain unchanged. Every old numeric value will be retained in an archived* customStats key. This changes the SCENARIO for future games only. Review your CSV export if the meanings differ. Continue?`)) return;
    setBusy(true); setError("");
    try {
      await applyToScenario(planned.patches, planned.originals);
      setProgress(`Archived ${planned.entries.length} legacy readings across ${countries} countries. Native baselines retained; check any pending AI proposals again before applying.`);
    } catch (problem) { setError(problem?.message || String(problem)); }
    finally { setBusy(false); }
  };
  const saveManual = async () => {
    if (!activeCode || busy) return;
    setBusy(true); setError("");
    try {
      if (customDefinition) assertNoLegacyNativeStatCopies(customDefinition, currentSheet);
      const draft = proposals[activeCode];
      if (draft?.sheet && (staleProposal(draft))) {
        throw new Error("This AI proposal was generated for an earlier starting date or Statistics metric definition. Regenerate it against the current scenario before applying edits.");
      }
      let base = draft?.sheet ?? currentSheet;
      if (!base || !base.territorialComponents?.length) {
        // A manual baseline for a country not yet initialized is also mapped,
        // but the author's aggregate numbers are allocated transparently by
        // native regional weights (not hallucinated provinces).
        const catalog = await ensureCatalog();
        const basis = await basisFor(activeCode, catalog);
        const macro = authorApprovedMacroEstimates(basis, Number(fields.population), Number(fields.gdp));
        const row = {
          ...Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== "" && value !== null && value !== undefined)),
          macro,
          ...Object.fromEntries(NUMBER_FIELDS.filter((key) => fields[key] !== "" && fields[key] !== null && fields[key] !== undefined)
            .map((key) => [key, Number(fields[key])])),
        };
        base = createReviewedScenarioStatsSheet({ row, basis, date: scenarioDate, customKeys, customDefinition, existing: currentSheet });
      }
      const next = applyScenarioStatsManualEdits({ sheet: base, edits: fields, date: scenarioDate, customKeys, customDefinition });
      await applyToScenario({ [activeCode]: next }, { [activeCode]: snapshot(currentSheet) });
      setProposals((previous) => { const result = { ...previous }; delete result[activeCode]; return result; });
      setDirty(false); setProgress(`Saved ${active.name}'s starting Statistics.`);
    } catch (problem) { setError(problem?.message || String(problem)); }
    finally { setBusy(false); }
  };
  const runGeneration = async ({ selectedOnly = false, retryFailedOnly = false } = {}) => {
    if (busy || authoringBlocked) return;
    if (!callBudgetValid) { setError(`Enter a whole number of AI requests from 1 to ${MAX_CALLS_PER_RUN}.`); return; }
    const wanted = scenarioStatsGenerationCandidates(coverage, proposals, { selectedOnly, activeCode, onlyMissing, retryFailedOnly });
    const queue = scenarioStatsGenerationQueue(wanted, callBudget);
    if (!queue.length) { setProgress("Nothing left to generate in this selection."); return; }
    if (scenarioStatsNeedsCostConfirmation(queue) && !window.confirm(
      `This generation run may make up to ${scenarioStatsPlannedCalls(queue)} paid AI requests for ${queue.length} countries. Requests are sent sequentially, and proposals must be reviewed before saving. Continue?`
    )) return;
    setError(""); setProgress("Preparing starting Statistics…"); setBusy(true);
    const token = ++runId.current;
    try {
      const catalog = await ensureCatalog();
      const all = { ...proposals };
      let calls = 0;
      let accepted = 0;
      let rejected = 0;
      for (let cursor = 0; cursor < queue.length; cursor += MAX_BATCH_COUNTRIES) {
        if (runId.current !== token) return;
        const group = queue.slice(cursor, cursor + MAX_BATCH_COUNTRIES);
        const prepared = [];
        for (const country of group) {
          // One unresolved legacy alias must not prevent other countries in
          // this paid batch from being proposed and reviewed independently.
          if (customDefinition) {
            try { assertNoLegacyNativeStatCopies(customDefinition, world.countryStats?.[country.code]); }
            catch (problem) {
              all[country.code] = { ...country, error: problem?.message || String(problem), prior: snapshot(world.countryStats?.[country.code]) };
              rejected += 1;
              continue;
            }
          }
          const basis = await basisFor(country.code, catalog);
          if (!basis.plan?.length || !basis.macroPlan?.length) {
            all[country.code] = { ...country, error: "No authoritative mapped territory. Requires separate author review.", prior: snapshot(world.countryStats?.[country.code]) };
            rejected += 1;
          } else prepared.push({ ...country, basis });
        }
        if (!prepared.length) { setProposals({ ...all }); continue; }
        const prompts = makePrompt({ batch: prepared, scenarioDate, details, customKeys });
        // Build/validate the tool locally BEFORE recording a paid attempt.
        const tool = buildScenarioStartingStatsTool(prepared, { customKeys });
        setProgress(`Generating ${cursor + 1}–${Math.min(queue.length, cursor + group.length)} of ${queue.length} countries (max ${callBudget} AI calls this run)…`);
        let response;
        // An attempted provider call may be billed even if the tool transport
        // throws. Keep the author-selected call budget and mark each country
        // in that failed batch for explicit paid retry, rather than losing it
        // in the outer run-wide catch and silently skipping the remaining queue.
        calls += 1;
        try {
          response = await callAI(prompts.system, [{ role: "user", parts: [{ text: prompts.user }] }], {
            taskKey: "countryStatSheet", logLabel: "Scenario starting Statistics", languageMode: "none", reasoningEnabled: false,
            tool,
          });
        } catch (problem) {
          if (runId.current !== token) return;
          const reason = problem?.message || String(problem);
          logDebugEvent("stats", "Scenario Statistics paid batch failed", {
            scenarioId, countries: prepared.map((country) => country.code), reason: String(reason).slice(0, 300),
          }, { problem: true });
          Object.assign(all, scenarioStatsFailedCallProposals(prepared, world.countryStats, reason));
          rejected += prepared.length;
          setProposals({ ...all });
          continue;
        }
        if (runId.current !== token) return;
        const interpreted = interpretScenarioStatsAiResponse(response, prepared, { resolveIdentity: (identity) => scenarioStatsPolityKey(identity, world), customKeys });
        for (const item of prepared) {
          try {
            const answer = interpreted[item.code];
            if (!answer?.row) throw new Error(answer?.error || "No usable country proposal was returned.");
            const original = world.countryStats?.[item.code] ?? null;
            const sheet = createReviewedScenarioStatsSheet({ row: answer.row, basis: item.basis, date: scenarioDate, customKeys, customDefinition, existing: original });
            if (!scenarioStatsRequiredReady(sheet, customKeys, customDefinition)) throw new Error("Incomplete normalized baseline.");
            all[item.code] = { ...item, sheet, prior: snapshot(original), generatedDate: scenarioDate, authoringContract: proposalContract, basisNote: clean(answer.row.basisNote).slice(0, 360), selected: true };
            accepted += 1;
          } catch (problem) {
            const reason = problem?.message || String(problem);
            // Debug information is about validation, not the private AI reply.
            logDebugEvent("stats", "Scenario Statistics proposal rejected", {
              scenarioId, country: item.code, reason: String(reason).slice(0, 300),
            }, { problem: true });
            all[item.code] = { ...item, error: reason, prior: snapshot(world.countryStats?.[item.code]) };
            rejected += 1;
          }
        }
        setProposals({ ...all });
      }
      setProgress(`${accepted} proposed for review; ${rejected} need attention. ${calls} AI request(s). ${wanted.length - queue.length} countries remain for a later batch.`);
    } catch (problem) {
      const reason = problem?.message || String(problem);
      logDebugEvent("stats", "Scenario Statistics generation interrupted", { scenarioId, reason: String(reason).slice(0, 300) }, { problem: true });
      setError(reason);
    }
    finally { if (runId.current === token) setBusy(false); }
  };
  const applyReviewed = async () => {
    const selectedRows = Object.values(proposals).filter((row) => row.selected && row.sheet && !row.error);
    if (!selectedRows.length || busy) return;
    const stale = selectedRows.find(staleProposal);
    if (stale) {
      setError(`${stale.name}'s AI proposal was generated for an earlier date or Statistics metric definition. Regenerate it before applying; no scenario values were changed.`);
      return;
    }
    try {
      for (const row of selectedRows) {
        if (customDefinition) assertNoLegacyNativeStatCopies(customDefinition, row.sheet);
        if (!scenarioStatsRequiredReady(row.sheet, customKeys, customDefinition)) {
          throw new Error(`${row.name}'s AI proposal is incompatible with the current Statistics sheet. Regenerate it before applying.`);
        }
      }
    } catch (problem) { setError(problem?.message || String(problem)); return; }
    if (!window.confirm(`Save ${selectedRows.length} reviewed AI-estimated country baseline(s) into this SCENARIO? Existing authored fields are preserved. This affects future new games, not current campaigns.`)) return;
    setBusy(true); setError("");
    try {
      const patches = Object.fromEntries(selectedRows.map((row) => [row.code, row.sheet]));
      const guards = Object.fromEntries(selectedRows.map((row) => [row.code, row.prior]));
      await applyToScenario(patches, guards);
      setProposals((previous) => { const after = { ...previous }; for (const row of selectedRows) delete after[row.code]; return after; });
      setProgress(`Saved ${selectedRows.length} reviewed starting baselines. New campaigns will inherit them.`);
    } catch (problem) { setError(problem?.message || String(problem)); }
    finally { setBusy(false); }
  };
  const displayRows = (customKeys ? FORM_FIELDS.filter(([key]) => ["population", "gdp", "gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance", "birthRate", "deathRate", "birthTrendPerYear", "deathTrendPerYear"].includes(key)) : FORM_FIELDS);
  const ordinaryRows = displayRows.filter(([key]) => !DEMOGRAPHIC_FIELDS.has(key));
  const demographicRows = displayRows.filter(([key]) => DEMOGRAPHIC_FIELDS.has(key));
  return (
    <div style={{ display: "grid", gap: ".85rem" }}>
      <div style={cardStyle}>
        <div style={{ fontWeight: 800, marginBottom: ".25rem" }}>Starting Statistics for every country</div>
        <div style={{ color: "#abb2bd", fontSize: ".78rem", lineHeight: 1.5 }}>Edit the world's initial conditions here. AI proposes historically/scenario-appropriate figures; you review and approve them. The native simulation takes over after a campaign starts.</div>
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginTop: ".7rem", fontWeight: 800 }}>
          <span>{coverage.filter((row) => row.status === "ready").length} ready</span><span>· {coverage.filter((row) => row.status === "incomplete").length} incomplete</span><span>· {coverage.filter((row) => row.status === "missing").length} missing</span><span>· {coverage.length} countries on map roster</span>
        </div>
        {scenarioAliasReview.rows.length > 0 && <div role="note" style={{ border: "1px solid rgba(251,191,36,.35)", borderRadius: 8, padding: ".6rem", display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center", color: "#fcd34d", fontSize: ".75rem" }}>
          <strong>Legacy Statistics review required</strong>
          <span data-no-translate>{scenarioAliasReview.countries}</span> <span>countries</span>
          <span data-no-translate>{scenarioAliasReview.matching}</span> <span>matching duplicates</span>
          <span data-no-translate>{scenarioAliasReview.conflicting}</span> <span>different readings</span>
          <button type="button" style={buttonStyle} disabled={busy} onClick={exportAliasReview}>Export review CSV</button>
            {aliasArchival.entries.length > 0 && <button type="button" style={buttonStyle} disabled={busy || authoringBlocked || dirty || Object.keys(proposals).length > 0 || aliasArchival.entries.some((row) => !row.equal)} onClick={archiveBoundAliases}>Archive all only when every duplicate matches</button>}
            {aliasArchival.entries.some((row) => !row.equal) && <span>Bulk archive is blocked while conflicting values remain. Reconcile ONE metric below; neither zero nor a GDP unit ratio is proof of which reading is correct.</span>}
            {contract.boundRows.length > 0 && <div style={{ width: "100%", display: "grid", gap: ".45rem", padding: ".7rem", border: "1px solid rgba(255,255,255,.14)", borderRadius: 9 }}>
              <strong>Reconcile legacy copies - explicitly choose one source per metric</strong>
              <span>Export the review CSV and back up the scenario before applying. Options act across the selected countries, not across all metrics. The planned changes are reviewed before saving.</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: ".5rem" }}>
                <label style={{ display: "grid", gap: ".2rem" }}>Statistic to reconcile
                  <select aria-label="Legacy statistic to reconcile" style={inputStyle} value={reconcileMetric} disabled={busy} onChange={(e) => setReconcileMetric(e.target.value)}>
                    <option value="">Select metric...</option>
                    {contract.boundRows.map((row) => <option key={row.key} value={row.key}>{row.key} → {row.nativeMetric}</option>)}
                  </select>
                </label>
                <label style={{ display: "grid", gap: ".2rem" }}>Which value is authoritative?
                  <select aria-label="Reconciliation authority" style={inputStyle} value={reconcileAction} disabled={busy} onChange={(e) => setReconcileAction(e.target.value)}>
                    <option value="keep-native">Keep native; archive legacy</option>
                    <option value="promote-legacy">Use legacy 1:1; preserve prior native</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: ".2rem" }}>Which comparisons?
                  <select aria-label="Reconciliation scope" style={inputStyle} value={reconcileScope} disabled={busy} onChange={(e) => setReconcileScope(e.target.value)}>
                    <option value="all">All readings for selected metric</option>
                    <option value="different">Different readings only</option>
                    <option value="matching">Exact matches only</option>
                    <option value="native-zero">Native zero / nonzero legacy only</option>
                  </select>
                </label>
              </div>
              {reconciliationPreview && <div role="status" style={{ display: "grid", gap: ".25rem" }}>
                {reconciliationPreview.error
                  ? <span style={{ color: "#fca5a5" }}>{reconciliationPreview.error}</span>
                  : <>
                    <span>Preview: {reconciliationPreview.entries.length} archived readings in {reconciliationPreview.countries} countries; {reconciliationPreview.disagreements} disagree. {reconcileAction === "promote-legacy" ? "Old native values also retained in archivedPriorNative* keys." : "Native values will not change."}</span>
                    {reconciliationPreview.entries.slice(0, 5).map((entry, i) =>
                      <span key={i} style={{ fontFamily: "monospace", fontSize: ".7rem" }}>{entry.countryName}: native {entry.nativeValue} / legacy {entry.legacyValue} → {entry.nativeAfter}</span>)}
                  </>}
              </div>}
              <span>GDP, GDP per capita and population cannot be promoted here: they require map-aware aggregate reconciliation and confirmed units. Economic continuity cursors, invalid values, or loss of archived readings block the save.</span>
              <button type="button" style={buttonStyle} disabled={busy || authoringBlocked || dirty || Object.keys(proposals).length > 0 || !reconciliationPreview?.entries?.length || Boolean(reconciliationPreview?.error)} onClick={reconcileBoundMetric}>Review and save selected metric reconciliation</button>
            </div>}
          <span>Review CSV is read-only. Archive only affects explicitly native-bound cards after author confirmation; original numeric evidence stays in archived* customStats keys.</span>
          {(dirty || Object.keys(proposals).length > 0) && aliasArchival.entries.length > 0 && <span>Save or discard unfinished manual edits and AI proposals before archiving.</span>}
          {aliasArchival.error && <span role="alert" style={{ color: "#fca5a5" }}>Cannot safely archive: {aliasArchival.error}</span>}
          {!aliasArchival.entries.length && !aliasArchival.error && <span>Unbound legacy cards require explicit native binding review before archival.</span>}
          {unboundAliasCards.length > 0 && <div style={{ width: "100%", display: "grid", gap: ".35rem", borderTop: "1px solid rgba(251,191,36,.22)", paddingTop: ".5rem" }}>
            <strong>Explicit native source binding (optional)</strong>
            <span>Choose a native metric only when its meaning, accounting basis and geographic scope genuinely match this legacy card. This stages the display definition only; it does not move or replace country values.</span>
            {unboundAliasCards.map((card) => <div key={card.key} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".35rem" }}>
              <span data-no-translate>{card.label} ({card.key})</span>
              <select aria-label={`Native value source for ${card.key}`} style={{ ...inputStyle, maxWidth: "15rem" }} disabled={busy || dirty || Object.keys(proposals).length > 0 || statsDefinitionUnavailable || !onStatsChange}
                value={chosenNativeBindings[card.key] || ""} onChange={(event) => setChosenNativeBindings((prior) => ({ ...prior, [card.key]: event.target.value }))}>
                <option value="">Choose canonical source...</option>
                {Object.entries(NATIONAL_NATIVE_METRICS).filter(([, native]) => native.kind === card.kind).map(([key, native]) => <option key={key} value={key}>{key} ({native.path.join(".")})</option>)}
              </select>
              <button type="button" style={buttonStyle} disabled={busy || dirty || Object.keys(proposals).length > 0 || statsDefinitionUnavailable || !onStatsChange || !chosenNativeBindings[card.key]}
                onClick={() => stageNativeBinding(card)}>Stage binding for review</button>
            </div>)}
            <span>Next: save the Statistics sheet definition, then archive the legacy copies only after inspecting the proposed migration.</span>
          </div>}
        </div>}
        {dateMismatch && <p style={{ color: "#fcd34d" }}>Save the scenario's starting date before generating or saving Statistics.</p>}
        {statsDefinitionDirty && <div style={{ display: "grid", justifyItems: "start", gap: ".35rem", margin: ".4rem 0" }}>
          <p style={{ color: "#fcd34d", margin: 0 }}>The Statistics sheet definition has unsaved changes. Save its definition separately before applying country baselines; pending AI proposals will be kept.</p>
          <button type="button" style={buttonStyle} disabled={busy || statsDefinitionUnavailable || !onSaveStatsDefinition} onClick={async () => {
            setBusy(true); setError("");
            try {
              await onSaveStatsDefinition();
              setProgress("Saved the Statistics sheet definition. Pending AI proposals are preserved; review and apply them below.");
            } catch (problem) { setError(problem?.message || String(problem)); }
            finally { setBusy(false); }
          }}>Save Statistics sheet definition (keep proposals)</button>
        </div>}
        {statsDefinitionUnavailable && <p style={{ color: "#fca5a5" }}>The Statistics definition could not be loaded. Reopen this scenario before authoring starting values.</p>}
        {contract.boundRows.length > 0 && <p style={{ color: "#fcd34d", fontSize: ".75rem" }}>
          {contract.boundRows.length} card(s) read existing national Statistics rather than storing separate custom values. Missing native readings and legacy copies require author review; they will not be filled with zero or silently replaced.
        </p>}
        {missing.length > 0 && <p style={{ color: "#cbd5e1", fontSize: ".74rem" }}>Countries with missing/incomplete Statistics will not get fully functional native panels merely by starting a new campaign. Generate or edit their baselines first.</p>}
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ color: "#cbd5e1", fontSize: ".75rem", display: "flex", alignItems: "center", gap: ".4rem" }}>
            AI requests this run
            <input type="number" min="1" max={MAX_CALLS_PER_RUN} step="1" aria-label="AI requests this run"
              style={{ ...inputStyle, width: "6rem" }} disabled={busy} aria-invalid={!callBudgetValid}
              value={callBudget} onChange={(event) => setCallBudget(event.target.value === "" ? "" : Number(event.target.value))}/>
          </label>
          <button type="button" style={buttonStyle} disabled={busy || authoringBlocked || !callBudgetValid || !coverage.length} onClick={() => runGeneration()}>Generate {onlyMissing ? "missing" : "all"} - review first</button>
          <button type="button" style={buttonStyle} disabled={busy || authoringBlocked || !callBudgetValid || !activeCode} onClick={() => runGeneration({ selectedOnly: true })}>Generate selected country</button>
          <button type="button" style={buttonStyle} disabled={busy || authoringBlocked || !callBudgetValid || !Object.values(proposals).some((row) => row.error && !row.sheet)} onClick={() => runGeneration({ retryFailedOnly: true })}>Retry failed AI proposals (paid)</button>
          <label style={{ color: "#cbd5e1", fontSize: ".75rem" }}><input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)}/> Preserve complete country sheets</label>
        </div>
        {(busy || progress) && <p role="status" aria-live="polite" aria-busy={busy} style={{ fontSize: ".8rem", color: "#a7f3d0", fontWeight: 700, margin: ".6rem 0 .3rem" }}>
          {busy ? "⏳ " : ""}{progress || "Preparing starting Statistics…"}
        </p>}
        {error && <p role="alert" style={{ fontSize: ".78rem", color: "#fca5a5", margin: ".6rem 0 .3rem" }}>{error}</p>}
        <p style={{ fontSize: ".72rem", color: "#9ca3af", lineHeight: 1.5, marginBottom: 0 }}>Choose 1–{MAX_CALLS_PER_RUN} AI requests per click (up to {callBudgetValid ? callBudget * MAX_BATCH_COUNTRIES : 0} countries). The default is {DEFAULT_CALLS_PER_RUN}; runs needing more than 10 calls require explicit cost confirmation. Every call may incur provider charges. Estimates aren't researched facts. No automatic application. Generate all can propose replacements, but existing authored values remain protected.</p>
      </div>
      {economicComparability.readings.length >= 2 && <details style={{ ...cardStyle, borderColor: "rgba(255,255,255,.14)" }}>
        <summary style={{ fontWeight: 750, cursor: "pointer", color: "#cbd5e1" }}>GDP scale context (optional)</summary>
        <p style={{ color: "#cbd5e1", fontSize: ".74rem", margin: ".5rem 0" }}>
          Disparity alone is not an error. Historical and fictional economies can be very different. Use this optional context to check shared accounting units and territorial coverage; it does not require edits or block saving.
        </p>
        <div style={{ fontSize: ".72rem", color: "#abb2bd" }}>
          GDP accounting basis: <span data-no-translate>{SCENARIO_GDP_ACCOUNTING_UNIT}</span>
        </div>
        <div style={{ fontSize: ".72rem", color: "#abb2bd", margin: ".4rem 0" }}>
          <span data-no-translate>{economicOverview.readings}</span> countries with GDP and population readings; <span data-no-translate>{economicOverview.comparisons}</span> wide-gap country pairs (8x or more).
        </div>
        {economicOverview.comparisons > 0 && <div style={{ display: "grid", gap: ".4rem" }}>
          <button type="button" style={{ ...buttonStyle, fontSize: ".72rem", justifySelf: "start" }} onClick={async () => {
            try {
              await saveTextToDisk("\uFEFF" + serializeScenarioEconomicComparabilityCsv(economicComparability), String(scenarioId || "scenario").replace(/[^A-Za-z0-9_-]/g, "-") + "-economic-comparability-review.csv", "text/csv;charset=utf-8");
            } catch (problem) { setError(problem?.message || String(problem)); }
          }}>Export detailed GDP comparison CSV</button>
          <div style={{ display: "grid", gap: ".3rem", maxHeight: "12rem", overflow: "auto" }}>
            {economicOverview.countries.slice(0, 10).map((row) => <div key={row.code} style={{ fontSize: ".73rem", borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: ".3rem" }}>
              <span data-no-translate>{row.name}</span>: <span data-no-translate>{row.comparisonCount}</span> wide-gap comparisons; largest <span data-no-translate>{row.maxRatio.toLocaleString()}</span>x.
            </div>)}
          </div>
          {economicOverview.countries.length > 10 && <div style={{ color: "#abb2bd", fontSize: ".7rem" }}>
            <span data-no-translate>{economicOverview.countries.length - 10}</span> additional countries listed in the CSV.
          </div>}
        </div>}
      </details>}      {Object.keys(proposals).length > 0 && <div style={cardStyle}>
        <div style={{ fontWeight: 800 }}>Generated proposals - review before applying</div>
        <div style={{ color: "#9ca3af", fontSize: ".72rem", margin: ".4rem 0" }}>{Object.values(proposals).filter((row) => row.sheet).length} valid; {Object.values(proposals).filter((row) => row.error).length} need attention. Proposals are not saved in the scenario yet.</div>
        <p style={{ color: "#cbd5e1", fontSize: ".72rem", margin: ".3rem 0" }}>You can approve selected AI proposals exactly as generated. No edits are required for fictional economic differences.</p>
        <button type="button" style={{ ...buttonStyle, marginBottom: ".5rem" }} disabled={busy || authoringBlocked || !Object.values(proposals).some((row) => row.selected && row.sheet)} onClick={applyReviewed}>Apply selected reviewed baselines</button>
        <div style={{ maxHeight: "15rem", overflow: "auto", display: "grid", gap: ".3rem" }}>
          {Object.values(proposals).map((row) => <div key={row.code} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".35rem", padding: ".35rem", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
            <input type="checkbox" disabled={!row.sheet || busy} checked={Boolean(row.selected && row.sheet)} onChange={(event) => setProposals((previous) => ({ ...previous, [row.code]: { ...previous[row.code], selected: event.target.checked } }))}/>
            <button type="button" onClick={() => { setSelected(row.code); if (row.sheet) loadDraftToEditor(row); }} style={{ ...buttonStyle, fontSize: ".7rem" }}>{row.name}</button>
            <span style={{ fontSize: ".7rem", color: row.error ? "#fca5a5" : "#a7f3d0" }}>{row.error || summary(row.sheet)}</span>
            {row.sheet && reviewScenarioNationalMetricAliases(statsValue, row.sheet).some((item) => item.status === "different") &&
              <span role="note" style={{ color: "#fcd34d", fontSize: ".7rem" }}><span>Canonical conflict</span>{" · "}<span>Review</span></span>}
            {row.basisNote && <span title={row.basisNote} style={{ fontSize: ".7rem", color: "#a3a3a3" }}>AI estimate</span>}
            {row.error && <button type="button" disabled={busy} style={{ ...buttonStyle, fontSize: ".68rem" }} onClick={() => setProposals((previous) => { const next = { ...previous }; delete next[row.code]; return next; })}>Retry later</button>}
          </div>)}
        </div>
        <div style={{ display: "flex", gap: ".5rem", marginTop: ".55rem", flexWrap: "wrap" }}>
          <button type="button" style={buttonStyle} disabled={busy || authoringBlocked || !Object.values(proposals).some((row) => row.selected && row.sheet)} onClick={applyReviewed}>Apply selected reviewed baselines</button>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => { if (window.confirm("Discard all unapplied AI proposals?")) setProposals({}); }}>Discard drafts</button>
        </div>
      </div>}
      <div style={cardStyle}>
        <div style={{ fontWeight: 800, marginBottom: ".5rem" }}>Edit one country's starting values</div>
        <select value={activeCode} style={inputStyle} onChange={(event) => setSelected(event.target.value)}>
          {coverage.map((row) => <option key={row.code} value={row.code}>{row.name} - {row.status}{countriesNeedingReview.has(row.code) ? " · review required" : ""}</option>)}
        </select>
        {activeCode && <>
          {customDefinition && (() => {
            try { assertNoLegacyNativeStatCopies(customDefinition, currentSheet); return null; }
            catch (problem) { return <p role="alert" style={{ color: "#fca5a5", fontSize: ".75rem" }}>{problem.message}</p>; }
          })()}
          <p style={{ fontSize: ".75rem", color: "#a3a3a3" }}>Saved: {summary(currentSheet)}. {proposals[activeCode]?.sheet ? "There's also an unapplied AI proposal above. You can use Save this country to approve your edits, or Apply selected reviewed baselines to save the original AI proposal." : ""}</p>
          {aliasReviewRows.length > 0 && <div role="note" style={{ border: "1px solid rgba(251,191,36,.35)", borderRadius: 8, padding: ".6rem", margin: ".6rem 0", color: "#fcd34d", fontSize: ".72rem" }}>
            <strong>{aliasReviewRows.some((row) => row.status === "different") ? "Canonical conflict" : "Matching duplicates - review required"}</strong>
            {aliasReviewRows.map((item) => <div key={item.key} style={{ marginTop: ".35rem", overflowWrap: "anywhere" }}>
              <span>{item.label}</span> · <code>{item.nativePath}</code> = <span data-no-translate>{item.nativeValue?.toLocaleString()}</span>
              {" ↔ "}<code>{item.customPath}</code> = <span data-no-translate>{item.customValue?.toLocaleString()}</span>
              {" · "}<span>{item.status === "different" ? "Different values" : "Matching duplicate"}</span>
            </div>)}
          </div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: ".6rem" }}>
            {ordinaryRows.map(([key, label]) => <label key={key} style={{ fontSize: ".7rem", color: "#cbd5e1", display: "grid", gap: ".2rem" }}>
              {label}
              <input style={inputStyle} type={NUMBER_FIELDS.includes(key) ? "number" : "text"} step={NUMBER_FIELDS.includes(key) ? "any" : undefined} value={fields[key] ?? ""} onChange={(event) => update(key, NUMBER_FIELDS.includes(key) ? numeric(event.target.value) : event.target.value)}/>
            </label>)}
            {demographicRows.length > 0 && <div style={{ gridColumn: "1 / -1", marginTop: ".5rem", borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: ".55rem" }}>
              <strong style={{ color: "#e2e8f0", fontSize: ".84rem" }}>Natural population change (optional)</strong>
              <p style={{ color: "#aeb8c7", fontSize: ".73rem", margin: ".3rem 0" }}>Both base rates are required together. Leave all four fields blank to keep the demographic process unset. Base rates describe annual births/deaths per 1,000 residents (0 to 80).</p>
              <p style={{ color: "#aeb8c7", fontSize: ".73rem", margin: ".3rem 0" }}>Annual trends change those rates by up to 2 per 1,000 residents each year. Negative annual trends reduce the rate; births and deaths themselves cannot be negative. Monthly or quarterly inputs are not supported by this editor.</p>
            </div>}
            {demographicRows.map(([key, label]) => <label key={key} style={{ fontSize: ".7rem", color: "#cbd5e1", display: "grid", gap: ".2rem" }}>
              {label}
              <input style={inputStyle} type="number" step="any" min={key === "birthRate" || key === "deathRate" ? 0 : -2} max={key === "birthRate" || key === "deathRate" ? 80 : 2} value={fields[key] ?? ""} onChange={(event) => update(key, numeric(event.target.value))}/>
            </label>)}
            {!customKeys && DEFAULT_STAT_INDEX_KEYS.map((key) => <label key={key} style={{ fontSize: ".7rem", color: "#cbd5e1", display: "grid", gap: ".2rem" }}>
              {key.replace(/([A-Z])/g, " $1")}
              <input style={inputStyle} type="number" step="1" min="0" max="100" value={fields.indices?.[key] ?? ""} onChange={(event) => updateNested("indices", key, numeric(event.target.value))}/>
            </label>)}
            {customKeys && customKeys.map((key) => <label key={key} style={{ fontSize: ".7rem", color: "#cbd5e1", display: "grid", gap: ".2rem" }}>
              {key} (custom statistic)
              <input style={inputStyle} type="number" step="any" value={fields.customStats?.[key] ?? ""} onChange={(event) => updateNested("customStats", key, numeric(event.target.value))}/>
            </label>)}
          </div>
          <p style={{ fontSize: ".72rem", color: "#9ca3af" }}>Manual new-country entry distributes your total population/GDP across the scenario's real mapped geographies using simple native weights, not researched regional values. Review detailed AI proposals for better regional estimates. Birth and death fields are optional; their rules appear above.</p>
          <button type="button" style={buttonStyle} disabled={busy || authoringBlocked || !dirty} onClick={saveManual}>Save this country's starting values</button>
        </>}
      </div>
      <div style={{ fontSize: ".72rem", color: "#9ca3af" }}>For unusual eras, use “Customize full sheet” below. This panel edits starting VALUES; that advanced editor controls which Statistics the player sees. Neither function changes an already running campaign.</div>
    </div>
  );
};

export default ScenarioStatsAuthoringPanel;
