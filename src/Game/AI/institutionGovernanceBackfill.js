/*! Open Historia Continuum — lazy governance migration for pre-governance saves.
 *
 * Fresh/resumed PWv2 owns normal institution-governance materialization. This
 * compatibility seam exists for campaigns created before that PWv2 stage
 * existed, and for an institution a scenario authored without a charter rule.
 * On first formal ballot attempt (institutionGovernanceRetry.js), if the exact
 * proposal still has no canonical voting rule, run the same ONE global
 * governance resolver against the scenario-start authority boundary, or the
 * current date for an institution founded since, then atomically merge only
 * missing charter law into the live generation. Authored/current charter law
 * always wins.
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
import { isCanonicalGameDate } from "../../runtime/gameDates.js";
import { buildRoundZeroCanonContextText } from "../../runtime/roundZeroCanonContext.js";
import { resolveScenarioHistoryAuthority } from "../../runtime/scenarioHistoryAuthority.js";
import {
  applyGeopoliticalInstitutionGovernanceBaseline,
  generateGeopoliticalInstitutionGovernanceJob,
} from "./geopoliticalWorldGenerator.js";
import { geopoliticalInstitutionGovernanceTargets } from "./geopoliticalInstitutionGovernance.js";
import { GOVERNANCE_BACKFILL_STALE, votingRuleMissingError } from "./institutionGovernanceRetry.js";

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

  const startDate = clean(game?.startDate || game?.gameDate);
  if (!isCanonicalGameDate(startDate)) {
    throw new Error("Cannot resolve institutional voting law because this campaign has no canonical scenario start date.");
  }
  // The resolver judges institutions as they stood on one date. An institution
  // founded after the scenario began did not exist at its start, so its law is
  // resolved as of today instead. One the resolver would not be asked about on
  // either date (not active, or no usable founding date) costs no request.
  const currentDate = isCanonicalGameDate(clean(game?.gameDate)) ? clean(game.gameDate) : startDate;
  const heldAt = (date) => geopoliticalInstitutionGovernanceTargets({ world, scenarioDate: date })
    .some((entry) => entry.id === initial.institution.id);
  const scenarioDate = heldAt(startDate) ? startDate : heldAt(currentDate) ? currentDate : "";
  if (!scenarioDate) throw votingRuleMissingError(initial.institution.name || targetInstitutionId);
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
      throw Object.assign(new Error("Campaign advanced while institutional voting rules were being resolved. Please submit the ballot again."), { code: GOVERNANCE_BACKFILL_STALE });
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
      // Constitutional baseline backfilled into an old save: provenance belongs
      // to the date the law was resolved for (the scenario start, unless the
      // institution was founded since).
      date: scenarioDate,
    });
    appliedInfo = { migrated: applied.appliedInstitutionIds.length > 0, warnings: applied.warnings };
    return { world: applied.world };
  }, { expectedGameId: activeGameId });

  const finalWorld = committed?.world || world;
  const final = effectiveRule(finalWorld, targetInstitutionId, targetProposalId);
  if (!final.rule || final.rule.type === "unspecified") {
    if (Array.isArray(generated?.warnings) && generated.warnings.length) {
      console.warn("[institution governance] no voting rule could be established.", generated.warnings);
    }
    throw votingRuleMissingError(final.institution?.name || targetInstitutionId);
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
