// A group participant has the same authority as their one-to-one Advisor
// recipient type. Keep machine-readable proposals on the originating member's
// reply, never on a synthetic "group" official.
import { parseAdvisorReply } from "./advisorReply.js";
import { reviewAdvisorActionProposals } from "./advisorActionReview.js";
import { extractFencedJson, looksLikeProjectOps } from "./advisorBlocks.js";
import { applyAdvisorProjectProposal, canAdvisorApplyProjectOps } from "./advisorProjectRouting.js";

// An entire provider batch is parsed before the world is writable. Every
// speaker receives a stable reply ID and independent Action proposal ledger.
// If any speaker misformats a native block, reject the WHOLE batch.
export const stageAdvisorGroupBatch = (records, { allowedUnitTypes, makeReplyId, currentActions } = {}) => {
  if (!Array.isArray(records) || !records.length || typeof makeReplyId !== "function") {
    throw new Error("A group batch requires replies and stable message IDs.");
  }
  return records.map((record) => {
    if (!record?.speakerId) throw new Error("Group batch has an unidentified speaker.");
    const replyId = makeReplyId();
    if (record.silent === true) {
      if (record.text !== "" || record.memory || record.actionProposals || record.projectsSummary) {
        throw new Error("A silent group participant cannot write prose or operations.");
      }
      return { role: "advisor", speakerId: record.speakerId, id: replyId, silent: true, text: "", projectOps: [] };
    }
    if (!String(record.text || "").trim()) throw new Error("Group batch has an empty speaker reply.");
    const parsed = parseAdvisorReply(record.text, { allowedUnitTypes });
    const { proposals, problems } = reviewAdvisorActionProposals(parsed.actionsProposal, replyId, currentActions);
    if ([...parsed.actionBlockProblems, ...problems].length) {
      throw new Error(`Group batch has invalid Action proposals from ${record.speakerId}.`);
    }
    const project = extractFencedJson(record.text, "projects", { salvageTruncated: false });
    const projectFence = /```projects\b/i.test(record.text);
    if (projectFence && (!Array.isArray(project.json) || project.truncated || project.dropped > 0)) {
      throw new Error(`Group batch has invalid Project operations from ${record.speakerId}.`);
    }
    return {
      ...record, id: replyId,
      ...(proposals.length ? { actionProposals: proposals } : {}),
      ...(parsed.chartProblem ? { chartProblem: parsed.chartProblem } : {}),
      ...(parsed.draftProblems.length ? { draftProblems: parsed.draftProblems } : {}),
      ...(parsed.institutionDraftProblems.length ? { institutionDraftProblems: parsed.institutionDraftProblems } : {}),
      ...(parsed.deployProblems.length ? { deployProblems: parsed.deployProblems } : {}),
      projectOps: projectFence ? project.json : [],
    };
  });
};


export const prepareAdvisorGroupMemberReply = async ({
  speakerId, recipient, replyId, text, memory = "", allowedUnitTypes,
  gameDate, round, mutateWorldState, applyProjectOpsToWorld, currentActions,
} = {}) => {
  if (!speakerId || !replyId || !String(text || "").trim()) {
    throw new Error("A group Advisor reply must identify its speaker and message.");
  }
  if (!canAdvisorApplyProjectOps(speakerId, recipient)) {
    throw new Error("Only an active government Advisor / Minister may propose group orders.");
  }
  const { actionsProposal, actionBlockProblems, chartProblem, draftProblems,
    institutionDraftProblems, deployProblems } = parseAdvisorReply(text, { allowedUnitTypes });
  const { proposals: actionProposals, problems: invalidProposals } =
    reviewAdvisorActionProposals(actionsProposal, replyId, currentActions);
  const actionsProblems = [...actionBlockProblems, ...invalidProposals];
  const { json: projectsProposal, truncated, reason, dropped, excerpt } =
    extractFencedJson(text, "projects", { salvageTruncated: true });

  let projectsSummary = null;
  let projectsFailure = "";
  if (projectsProposal) {
    try {
      projectsSummary = await applyAdvisorProjectProposal({
        proposal: projectsProposal, gameDate, round, mutateWorldState, applyProjectOpsToWorld,
      });
    } catch (error) {
      projectsFailure = error?.message || String(error);
    }
  }
  const projectsProblem = projectsSummary
    ? truncated ? "truncated" : dropped > 0 ? "partial" : ""
    : looksLikeProjectOps(text) ? truncated ? "truncated-empty" : "unusable" : "";
  const projectsDetail = projectsFailure || (projectsProblem === "partial"
    ? `${dropped} malformed project entries were skipped.`
    : projectsProblem === "unusable" ? reason || "No valid Project changes were applied." : "");

  return {
    id: replyId,
    role: "advisor",
    speakerId,
    text: String(text).trim(),
    ...(memory ? { memory } : {}),
    ...(chartProblem ? { chartProblem } : {}),
    ...(actionsProblems.length ? { actionsProblems } : {}),
    ...(actionProposals.length ? { actionProposals } : {}),
    ...(draftProblems.length ? { draftProblems } : {}),
    ...(institutionDraftProblems.length ? { institutionDraftProblems } : {}),
    ...(deployProblems.length ? { deployProblems } : {}),
    ...(projectsSummary ? { projectsSummary } : {}),
    ...(projectsProblem ? { projectsProblem } : {}),
    ...(projectsDetail ? { projectsDetail } : {}),
    ...((projectsProblem === "unusable" || projectsProblem === "partial") && excerpt
      ? { projectsExcerpt: excerpt } : {}),
  };
};
