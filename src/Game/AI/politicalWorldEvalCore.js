// Political World A/B evaluation helpers. Kept dependency-free so the harness's
// pairing/parity rules can be regression-tested without loading the game client.

const clean = (value) => String(value ?? "").trim();

export const POLITICAL_WORLD_EVAL_VARIANTS = Object.freeze({
  comparison: ["current", "off"],
  sensitivity: ["off", "current", "hawk", "dove"],
  evolvedGoal: ["control", "treatment"],
  frozenGoalAblation: ["control", "treatment"],
});

export const politicalWorldSensitivityDirective = (actorName) => {
  const actor = clean(actorName) || "the selected actor";
  return `[POLITICAL WORLD SENSITIVITY EVALUATION - COUNTERFACTUAL TEMPERAMENT]
This is a read-only diagnostic counterfactual for ${actor}. For ${actor} ONLY, when scenario-authored temperament, behavioral characterization, or generic roleplay guidance conflicts with an explicit Political Decision Context supplied for this arm, the Political Decision Context controls ${actor}'s CURRENT decision temperament for this task. Scenario statements that ${actor} is generally more or less coercive, militarized, risk-tolerant, conciliatory, cautious, or compromise-oriented are behavioral characterization for this diagnostic, not objective world facts.
Preserve objective campaign canon unchanged: history, events, institutions, alliances, capabilities, territory, relationships, goals, fears, ambitions, knowledge, and constraints remain facts. Do not rewrite interests or make the actor forget established facts. If this arm supplies no Political Decision Context, use the ordinary scenario/game characterization exactly as written.
This precedence rule changes decision style and interpretation only. It does not authorize canonical mutations, player actions, or fabricated facts.`;
};

export const politicalWorldEvalSharedDirective = (mode, actorName) =>
  mode === "sensitivity" ? politicalWorldSensitivityDirective(actorName) : "";

export const politicalWorldEvalReplaceUniqueGoal = (goals, sourceGoal, replacementGoal) => {
  const source = clean(sourceGoal);
  const replacement = clean(replacementGoal);
  if (!source) throw new Error("Choose the exact canonical goal to replace.");
  if (!replacement) throw new Error("Enter the evolved canonical goal.");
  if (source === replacement) throw new Error("The evolved goal must differ from the seed goal.");

  const rows = Array.isArray(goals) ? [...goals] : [];
  const matches = rows.map((goal) => clean(goal)).reduce((count, goal) => count + (goal === source ? 1 : 0), 0);
  if (matches !== 1) {
    throw new Error(`Expected exactly one canonical goal matching the selected seed goal; found ${matches}.`);
  }
  if (rows.some((goal) => clean(goal) === replacement && clean(goal) !== source)) {
    throw new Error("The evolved goal already exists elsewhere in this actor's canonical goals.");
  }

  const index = rows.findIndex((goal) => clean(goal) === source);
  const previous = clean(rows[index]);
  rows[index] = replacement;
  return { goals: rows, index, sourceGoal: previous, replacementGoal: replacement };
};

export const politicalWorldEvalEvolvedOutcomeSummary = (runs = [], judgements = {}) => {
  const counts = {
    control: { completed: 0, scored: 0, qualifying: 0, canonIssue: 0 },
    treatment: { completed: 0, scored: 0, qualifying: 0, canonIssue: 0 },
  };
  const validScores = new Set(["qualifying", "nonQualifying", "canonIssue"]);
  (Array.isArray(runs) ? runs : []).forEach((run, runIndex) => {
    (Array.isArray(run?.arms) ? run.arms : []).forEach((arm, armIndex) => {
      const variant = clean(arm?.variant);
      if (!arm?.ok || !counts[variant]) return;
      counts[variant].completed += 1;
      const score = clean(judgements?.[`evolved:${runIndex}:${armIndex}`]);
      if (!validScores.has(score)) return;
      counts[variant].scored += 1;
      if (score === "qualifying") counts[variant].qualifying += 1;
      if (score === "canonIssue") counts[variant].canonIssue += 1;
    });
  });

  const fullyScored = counts.control.scored === counts.control.completed
    && counts.treatment.scored === counts.treatment.completed;
  const completeEightByEight = fullyScored
    && counts.control.completed === 8
    && counts.treatment.completed === 8;
  let threshold = "incomplete";
  if (completeEightByEight) {
    if (counts.treatment.qualifying >= 6 && counts.control.qualifying <= 1) threshold = "predicted-strong-signal";
    else if (counts.control.qualifying >= 6 && counts.treatment.qualifying <= 1) threshold = "reverse-strong-signal";
    else threshold = "not-met";
  }
  return { ...counts, fullyScored, completeEightByEight, threshold };
};

export const politicalWorldEvalSnapshotMetadata = (canonicalGame = {}, libraryState = {}) => {
  const game = canonicalGame && typeof canonicalGame === "object" ? canonicalGame : {};
  const library = libraryState && typeof libraryState === "object" ? libraryState : {};
  const activeGame = library.activeGame && typeof library.activeGame === "object" ? library.activeGame : {};
  const scenario = library.runtimeScenario && typeof library.runtimeScenario === "object" ? library.runtimeScenario : {};
  return {
    gameId: clean(activeGame.id || library.activeGameId || game.id || game.gameId),
    gameName: clean(activeGame.name || game.gameName || game.name),
    scenarioId: clean(activeGame.scenarioId || scenario.id || game.scenarioId),
    scenarioName: clean(scenario.name || activeGame.scenarioName || game.scenarioName),
    playerCountry: clean(game.country),
    gameDate: clean(game.gameDate),
    round: Number(game.round || 0),
  };
};

// Deterministic counterbalancing: ordinary modes rotate the starting arm. The
// evolved-goal diagnostic locks an irregular 8-block schedule in advance so it
// has exactly four control-first and four treatment-first blocks without using
// runtime randomness after outcomes are visible.
const EVOLVED_GOAL_BLOCK_ORDER = Object.freeze([
  ["control", "treatment"],
  ["treatment", "control"],
  ["treatment", "control"],
  ["control", "treatment"],
  ["control", "treatment"],
  ["treatment", "control"],
  ["control", "treatment"],
  ["treatment", "control"],
]);

export const politicalWorldEvalVariantOrder = (mode = "comparison", runIndex = 0) => {
  if (["evolvedGoal", "frozenGoalAblation"].includes(mode)) {
    const index = Math.abs(Number(runIndex) || 0) % EVOLVED_GOAL_BLOCK_ORDER.length;
    return [...EVOLVED_GOAL_BLOCK_ORDER[index]];
  }
  const variants = POLITICAL_WORLD_EVAL_VARIANTS[mode] || POLITICAL_WORLD_EVAL_VARIANTS.comparison;
  if (!variants.length) return [];
  const offset = Math.abs(Number(runIndex) || 0) % variants.length;
  return [...variants.slice(offset), ...variants.slice(0, offset)];
};

// Fast, deterministic non-cryptographic fingerprint for prompt/snapshot parity.
// This is diagnostic identity, not security, so FNV-1a is deliberate.
export const politicalWorldEvalHash = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const withoutPoliticalBlock = (value, politicalContextText) => {
  const source = String(value ?? "");
  const block = String(politicalContextText ?? "");
  const stripped = block ? source.replace(block, "") : source;
  return stripped.replace(/\n{3,}/g, "\n\n").trim();
};

export const politicalWorldEvalPromptFingerprint = ({ systemPrompt = "", userMessage = "", politicalContextText = "" } = {}) => ({
  fullHash: politicalWorldEvalHash(`${systemPrompt}\n\n${userMessage}`),
  nonPoliticalHash: politicalWorldEvalHash(
    `${withoutPoliticalBlock(systemPrompt, politicalContextText)}\n\n${withoutPoliticalBlock(userMessage, politicalContextText)}`,
  ),
  politicalHash: politicalContextText ? politicalWorldEvalHash(politicalContextText) : "",
  politicalChars: String(politicalContextText ?? "").length,
});

export const politicalWorldEvalReplaceContextBlock = (systemPrompt, renderedPoliticalContext, frozenPoliticalContext) => {
  const prompt = String(systemPrompt ?? "");
  const rendered = String(renderedPoliticalContext ?? "");
  const frozen = String(frozenPoliticalContext ?? "");
  if (!rendered) throw new Error("Frozen-capsule ablation could not identify the newly rendered Political World block.");
  if (!frozen) throw new Error("Frozen-capsule ablation has no Political World block to replay.");
  const parts = prompt.split(rendered);
  if (parts.length !== 2) {
    throw new Error(`Frozen-capsule ablation expected the rendered Political World block exactly once; found ${Math.max(0, parts.length - 1)} occurrences.`);
  }
  return `${parts[0]}${frozen}${parts[1]}`;
};

export const politicalWorldEvalPromptParity = (arms = []) => {
  const hashes = arms.map((arm) => clean(arm?.prompt?.nonPoliticalHash)).filter(Boolean);
  return hashes.length > 1 && new Set(hashes).size === 1;
};

// Prompt parity alone is not enough: a broken projection could make ON and OFF
// byte-identical and still "pass" the non-PW hash check. Prove that OFF really
// contains no explicit Political World block and every enabled/sensitivity arm
// actually received one before treating the comparison as meaningful.
export const politicalWorldEvalContextIsolation = (arms = []) => {
  const issues = [];
  for (const arm of arms) {
    const variant = clean(arm?.variant);
    const chars = Number(arm?.prompt?.politicalChars || 0);
    if (variant === "off" && chars !== 0) {
      issues.push(`Political World OFF still carried ${chars} explicit context character${chars === 1 ? "" : "s"}.`);
    } else if (["current", "hawk", "dove", "control", "treatment"].includes(variant) && chars <= 0) {
      issues.push(`${politicalWorldEvalLabel(variant)} received no explicit Political World decision context.`);
    }
  }
  return { ok: issues.length === 0, issues };
};

export const politicalWorldEvalLabel = (variant) => ({
  current: "Political World ON",
  off: "Political World OFF",
  hawk: "HAWK sensitivity",
  dove: "DOVE sensitivity",
  control: "Seed control",
  treatment: "Evolved treatment",
}[variant] || clean(variant) || "Unknown");
