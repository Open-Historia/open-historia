// Bounds the author-controlled AI request budget. This is scenario proposal
// generation only: no automatic application and no background requests.
export const MAX_BATCH_COUNTRIES = 3;
export const MAX_CALLS_PER_RUN = 100;
export const DEFAULT_CALLS_PER_RUN = 10;
export const HIGH_COST_CONFIRM_THRESHOLD = 10;

export const validScenarioStatsCallBudget = (value) =>
  Number.isInteger(value) && value >= 1 && value <= MAX_CALLS_PER_RUN;

// A failed proposal remains visible for diagnosis. It must be explicitly
// retriable without clearing unrelated VALID, unapproved proposals; retries
// spend only the same author-selected capped request budget as normal runs.
export const scenarioStatsGenerationCandidates = (
  coverage, proposals, { selectedOnly = false, activeCode = "", onlyMissing = true, retryFailedOnly = false } = {},
) => (Array.isArray(coverage) ? coverage : []).filter((row) => {
  if (!row?.code) return false;
  const existing = proposals?.[row.code];
  if (retryFailedOnly) return Boolean(existing?.error && !existing?.sheet);
  return (selectedOnly ? row.code === activeCode : (!onlyMissing || row.status !== "ready"))
    && !existing;
});

export const scenarioStatsGenerationQueue = (wanted, budget) => {
  if (!validScenarioStatsCallBudget(budget)) {
    throw new RangeError(`Statistics AI requests must be a whole number from 1 to ${MAX_CALLS_PER_RUN}.`);
  }
  return wanted.slice(0, MAX_BATCH_COUNTRIES * budget);
};

export const scenarioStatsPlannedCalls = (queue) =>
  Math.ceil(queue.length / MAX_BATCH_COUNTRIES);

export const scenarioStatsNeedsCostConfirmation = (queue) =>
  scenarioStatsPlannedCalls(queue) > HIGH_COST_CONFIRM_THRESHOLD;


// A provider exception is not a successful empty response. Preserve one
// failure per requested canonical country so the existing failed-only retry
// action can target exactly this paid batch without touching valid proposals.
// No world values or proposal sheets are created here.
export const scenarioStatsFailedCallProposals = (prepared, countryStats, reason) => {
  const diagnostic = String(reason || "The AI provider did not return an answer.").trim().slice(0, 300);
  return Object.fromEntries((Array.isArray(prepared) ? prepared : [])
    .filter((country) => typeof country?.code === "string" && country.code.trim())
    .map((country) => [country.code, {
      ...country,
      error: `AI request failed: ${diagnostic}`,
      prior: JSON.stringify(countryStats?.[country.code] ?? null),
    }]));
};
