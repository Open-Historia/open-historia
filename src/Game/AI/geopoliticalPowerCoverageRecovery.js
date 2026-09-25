/*! Open Historia Continuum — bounded coverage recovery for global power calibration */

import { seedPowerBaselineScore } from "../../runtime/powerStatus.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];

const recoveryContext = (scenarioContext, pendingTargets, attempt, maxAttempts) => [
  clean(scenarioContext),
  "POWER COVERAGE RECOVERY:",
  `This is bounded recovery attempt ${attempt}/${maxAttempts}. Return EXACTLY one power record for EVERY requested canonical polity key below.`,
  "Every requested key is an active actor in this scenario and must receive an era-relative strategicWeight even if it is disputed, partially recognized, a microstate, dependency-like polity, nonstandard historical actor, or custom scenario polity.",
  "Do not omit a polity because its real-world sovereignty/recognition is contested. Score the canonical scenario actor that is explicitly supplied.",
  `Still unresolved: ${pendingTargets.join(" | ")}`,
].filter(Boolean).join("\n");

/**
 * Resolve a requested power-calibration batch with a bounded salvage loop.
 *
 * The initial provider result may legitimately contain useful partial work. We
 * retain those rows in an in-memory staged world so they become scale anchors
 * for the narrow retry, then request ONLY the missing keys. Nothing here writes
 * persistent world state; the caller remains responsible for the final commit.
 */
export const recoverCompletePowerCalibration = async ({
  scenarioDate = "",
  targets = [],
  polities = [],
  world = {},
  scenarioContext = "",
  round = 0,
  generateJob,
  maxAttempts = 3,
  onAttempt = null,
} = {}) => {
  if (typeof generateJob !== "function") throw new Error("Power coverage recovery requires a generateJob function.");

  const requested = [...new Set(array(targets).map(clean).filter(Boolean))];
  const acceptedByPolity = new Map();
  const attempts = [];
  let stagedWorld = world;
  let pending = [...requested];
  const boundedAttempts = Math.max(1, Math.min(3, Math.trunc(Number(maxAttempts) || 1)));

  for (let attempt = 1; attempt <= boundedAttempts && pending.length; attempt += 1) {
    if (typeof onAttempt === "function") {
      onAttempt({
        attempt,
        maxAttempts: boundedAttempts,
        pendingTargets: [...pending],
        accepted: acceptedByPolity.size,
        requested: requested.length,
      });
    }

    const result = await generateJob({
      scenarioDate,
      targets: pending,
      polities,
      world: stagedWorld,
      scenarioContext: attempt === 1
        ? scenarioContext
        : recoveryContext(scenarioContext, pending, attempt, boundedAttempts),
    });

    let newlyAccepted = 0;
    for (const row of array(result?.powerCalibration)) {
      const polityKey = clean(row?.polityKey);
      const strategicWeight = Number(row?.strategicWeight);
      if (!polityKey || !requested.includes(polityKey) || acceptedByPolity.has(polityKey) || !Number.isFinite(strategicWeight)) continue;
      acceptedByPolity.set(polityKey, row);
      newlyAccepted += 1;

      const existing = stagedWorld?.powerStatus?.byPolity?.[polityKey];
      if (clean(existing?.basis).toLowerCase() !== "authored") {
        stagedWorld = seedPowerBaselineScore(stagedWorld, polityKey, strategicWeight, {
          basis: "generated-relative-baseline",
          date: scenarioDate,
          round,
          reasons: clean(row?.note) ? [clean(row.note)] : [],
        });
      }
    }

    pending = requested.filter((polityKey) => !acceptedByPolity.has(polityKey));
    attempts.push({
      attempt,
      requested: array(result?.acceptedPolities).length + array(result?.unresolvedPolities).length || (pending.length + newlyAccepted),
      acceptedThisAttempt: newlyAccepted,
      acceptedTotal: acceptedByPolity.size,
      unresolved: [...pending],
    });
  }

  return {
    powerCalibration: requested.map((polityKey) => acceptedByPolity.get(polityKey)).filter(Boolean),
    acceptedPolities: requested.filter((polityKey) => acceptedByPolity.has(polityKey)),
    unresolvedPolities: [...pending],
    attempts,
    stagedWorld,
  };
};
