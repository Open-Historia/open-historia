/*! Open Historia Continuum — lazy governance migration for pre-governance saves.
 *
 * Fresh/resumed PWv2 owns normal institution-governance materialization. This
 * compatibility seam exists only for campaigns created before that PWv2 stage
 * existed. On first formal ballot attempt, if the exact proposal still has no
 * canonical voting rule, run the same ONE global governance resolver against
 * the scenario-start authority boundary, then atomically merge only missing
 * charter law into the live generation. Authored/current charter law always wins.
 */

import { JSON_URLS, readJson } from "../../runtime/assets.js";
import {
  mutateCanonicalTurnState,
  readEventsState,
  readWorldState,
} from "../../runtime/gameState.js";
import { getLibraryState } from "../../runtime/library.js";
import {
  institutionVotingRuleForProposal,
} from "../../runtime/institutionalGovernance.js";
import { resolveInstitutionRecord } from "../../runtime/institutions.js";
import { buildRoundZeroCanonContextText } from "../../runtime/roundZeroCanonContext.js";
import { resolveScenarioHistoryAuthority } from "../../runtime/scenarioHistoryAuthority.js";
import {
  applyGeopoliticalInstitutionGovernanceBaseline,
  generateGeopoliticalInstitutionGovernanceJob,
} from "./geopoliticalWorldGenerator.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const values = (value) => value && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : [];

const proposalFrom = (institution, proposalId) => institution?.proposals?.[clean(proposalId)]
  || values(institution?.proposals).find((proposal) => lower(proposal?.id) === lower(proposalId))
  || null;

const effectiveRule = (world, institutionId, proposalId) => {
  const institution = resolveInstitutionRecord(world, institutionId);
  const proposal = proposalFrom(institution, proposalId);
  if (!institution || !proposal) return { institution, proposal, rule: null };
  return { institution, proposal, rule: institutionVotingRuleForProposal(institution, proposal) };
};

/**
 * Backfill missing constitutional law for an already-running campaign.
 *
 * This is deliberately one global provider call, matching the canonical PWv2
 * stage. Old saves therefore pay the migration cost once, not once per room.
 * The provider works outside the canonical write queue; publication re-checks
 * campaign/date/round and merges only still-missing governance.
 */
export const ensureLegacyInstitutionGovernanceForBallot = async ({
  institutionId = "",
  proposalId = "",
  expectedGameId = "",
  callModel,
} = {}) => {
  const targetInstitutionId = clean(institutionId);
  const targetProposalId = clean(proposalId);
  if (!targetInstitutionId || !targetProposalId) throw new Error("Institution and proposal are required for governance migration.");

  const [game, world, events] = await Promise.all([
    readJson(JSON_URLS.game, { defaultValue: {}, force: true }),
    readWorldState({ force: true }),
    readEventsState({ force: true }),
  ]);
  const initial = effectiveRule(world, targetInstitutionId, targetProposalId);
  if (!initial.institution) throw new Error(`Unknown institution ${targetInstitutionId}.`);
  if (!initial.proposal) throw new Error(`Unknown proposal ${targetProposalId}.`);
  if (initial.rule?.type && initial.rule.type !== "unspecified") {
    return { migrated: false, skippedModelCall: true, world, institution: initial.institution, proposal: initial.proposal, rule: initial.rule };
  }

  const scenarioDate = clean(game?.startDate || game?.gameDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scenarioDate)) {
    throw new Error("Cannot resolve institutional voting law because this campaign has no canonical scenario start date.");
  }
  const capturedGameDate = clean(game?.gameDate);
  const capturedRound = Number.isFinite(Number(game?.round)) ? Number(game.round) : 0;
  const activeGameId = clean(expectedGameId || getLibraryState()?.activeGameId);
  const historyAuthority = resolveScenarioHistoryAuthority({ world, scenarioDate });
  const scenarioContext = buildRoundZeroCanonContextText({ world, game, events }, { maxChars: 9000 });

  const generated = await generateGeopoliticalInstitutionGovernanceJob({
    scenarioDate,
    historyAuthority,
    world,
    scenarioContext,
    ...(callModel ? { callModel } : {}),
  });

  let appliedInfo = null;
  const committed = await mutateCanonicalTurnState(({ world: liveWorld, game: liveGame }) => {
    if (clean(liveGame?.gameDate) !== capturedGameDate || Number(liveGame?.round || 0) !== capturedRound) {
      throw new Error("Campaign advanced while institutional voting rules were being resolved. Please submit the ballot again.");
    }

    const live = effectiveRule(liveWorld, targetInstitutionId, targetProposalId);
    if (!live.institution || !live.proposal) throw new Error("Institutional proposal changed while voting rules were being resolved.");
    if (live.rule?.type && live.rule.type !== "unspecified") {
      appliedInfo = { migrated: false, alreadyConfigured: true };
      return null;
    }

    const applied = applyGeopoliticalInstitutionGovernanceBaseline({
      world: liveWorld,
      governance: generated.governance,
      // This is Round-Zero constitutional baseline being backfilled into an old
      // save, so provenance belongs to the scenario start rather than today.
      date: scenarioDate,
    });
    appliedInfo = { migrated: applied.appliedInstitutionIds.length > 0, warnings: applied.warnings };
    return { world: applied.world };
  }, { expectedGameId: activeGameId });

  const finalWorld = committed?.world || world;
  const final = effectiveRule(finalWorld, targetInstitutionId, targetProposalId);
  if (!final.rule || final.rule.type === "unspecified") {
    const warningText = Array.isArray(generated?.warnings) && generated.warnings.length
      ? ` ${generated.warnings.slice(0, 2).join(" ")}`
      : "";
    throw new Error(`No canonical voting rule could be established for ${final.institution?.name || targetInstitutionId}. Configure its charter in the Political/Institution editor or rerun Political World v2.${warningText}`);
  }

  return {
    migrated: appliedInfo?.migrated === true,
    skippedModelCall: generated?.skippedModelCall === true,
    world: finalWorld,
    institution: final.institution,
    proposal: final.proposal,
    rule: final.rule,
    warnings: [...(generated?.warnings || []), ...(appliedInfo?.warnings || [])],
  };
};
