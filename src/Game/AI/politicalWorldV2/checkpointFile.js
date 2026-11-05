/*! Open Historia Continuum — Political World v2 checkpoint export and restore
 *
 * Unapplied generation work lives only in the checkpoint store (storage.js).
 * Clearing site data, reinstalling the app or changing machine would lose
 * every AI call it holds, so the panel can write the whole checkpoint to a
 * file and read it back. Restoring makes no AI call: the checkpoint is
 * accepted only for the scenario, date and political inputs it was made from
 * (or after the same narrow Canon Context rebase the panel already allows),
 * and Resume or Apply then carries on from it.
 */

import {
  buildPoliticalWorldInputFingerprint,
  checkpointMatchesInput,
  normalizePoliticalWorldV2Checkpoint,
} from "./checkpoint.js";
import { rebasePoliticalWorldV2ReferenceCanon } from "./checkpointRebase.js";

export const POLITICAL_WORLD_V2_CHECKPOINT_FILE_KIND = "political-world-v2-checkpoint";
export const POLITICAL_WORLD_V2_CHECKPOINT_FILE_VERSION = 1;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const buildPoliticalWorldV2CheckpointFile = ({ checkpoint, scenario = {}, now = new Date().toISOString() } = {}) => {
  const normalized = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!normalized) throw new Error("There is no Political World generation checkpoint to export.");
  return {
    schemaVersion: POLITICAL_WORLD_V2_CHECKPOINT_FILE_VERSION,
    kind: POLITICAL_WORLD_V2_CHECKPOINT_FILE_KIND,
    exportedAt: now,
    scenario: {
      id: clean(scenario?.id || normalized.scenarioId),
      name: clean(scenario?.name),
      scenarioDate: clean(normalized.scenarioDate),
    },
    checkpoint: normalized,
  };
};

export const isPoliticalWorldV2CheckpointFile = (value) => Boolean(
  value && typeof value === "object" && !Array.isArray(value) && value.kind === POLITICAL_WORLD_V2_CHECKPOINT_FILE_KIND,
);

// inputs are the ones buildScenarioPoliticalGenerationInputs makes from the
// freshly loaded saved scenario, exactly as a Generate or Resume would use.
export const restorePoliticalWorldV2CheckpointFile = (file, { scenarioId = "", inputs = null } = {}) => {
  if (!isPoliticalWorldV2CheckpointFile(file) || Number(file.schemaVersion) !== POLITICAL_WORLD_V2_CHECKPOINT_FILE_VERSION) {
    throw new Error("File is not a supported Political World checkpoint.");
  }
  const checkpoint = normalizePoliticalWorldV2Checkpoint(file.checkpoint);
  if (!checkpoint) throw new Error("The checkpoint in this file was made by a different version of the game and cannot be resumed.");

  const currentScenarioId = clean(scenarioId);
  const currentScenarioDate = clean(inputs?.scenarioDate);
  if (!currentScenarioId || !currentScenarioDate) throw new Error("Save the scenario with a valid start date before restoring a checkpoint.");
  if (clean(checkpoint.scenarioDate) !== currentScenarioDate) {
    throw new Error(`Checkpoint scenario date ${clean(checkpoint.scenarioDate) || "<blank>"} does not match current canonical date ${currentScenarioDate}.`);
  }

  const fingerprintFor = (id) => buildPoliticalWorldInputFingerprint({
    scenarioId: id,
    scenarioDate: currentScenarioDate,
    world: inputs?.world || {},
    roundZeroContext: inputs?.roundZeroContext || null,
  });
  const currentFingerprint = fingerprintFor(currentScenarioId);
  if (checkpointMatchesInput(checkpoint, currentFingerprint)) return checkpoint;

  // The same scenario can come back under another id (re-imported, or copied to
  // another machine). The fingerprint covers every political input, so when
  // this world under the checkpoint's own id reproduces it exactly, the work
  // was made from identical inputs and is rebound to the current id.
  const sourceScenarioId = clean(checkpoint.scenarioId);
  if (sourceScenarioId && sourceScenarioId !== currentScenarioId && checkpointMatchesInput(checkpoint, fingerprintFor(sourceScenarioId))) {
    return { ...checkpoint, scenarioId: currentScenarioId, inputFingerprint: currentFingerprint };
  }

  const rebased = rebasePoliticalWorldV2ReferenceCanon({ ...checkpoint, scenarioId: currentScenarioId }, inputs, currentFingerprint);
  if (rebased) return rebased;
  if (sourceScenarioId && sourceScenarioId !== currentScenarioId) {
    throw new Error(`Checkpoint belongs to scenario ${sourceScenarioId}, not ${currentScenarioId}.`);
  }
  throw new Error("The scenario's political data has changed since this checkpoint was exported, so its work no longer fits. Generate the Political World again.");
};
