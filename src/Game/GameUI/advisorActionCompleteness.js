// A missing Advisor Action proposal is an incomplete reply, not authorization.
// The same parser that the Advisor panel uses still owns proposal validation.
// No inferred operation, approval or world mutation happens here.
import { parseAdvisorReply } from "./advisorReply.js";

const ACTIONS_ONLY = /^```actions[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/;
const UNRESOLVED = "The advisor's Action paperwork could not be completed for review. No Action was queued; ask for the missing proposal.";

export const completeAdvisorActionReply = async ({ reply, canPropose, check, allowedUnitTypes = null }) => {
  const source = String(reply ?? "");
  const current = parseAdvisorReply(source, { allowedUnitTypes });
  // Existing malformed blocks already have native errors; never replace them
  // or ask another model to reinterpret the original operation.
  if (!canPropose || current.actionsProposal !== null || current.actionBlockProblems.length > 0) {
    return { reply: source, status: "skipped", problem: "" };
  }
  // Receipts are derived from accepted native parsing, not the advisor's claims.
  // They inform the bounded semantic check without granting any Action authority.
  const delivered = {
    deployments: current.deployments?.length ?? 0,
    projects: current.projectsProposal?.length ?? 0,
    diplomaticDrafts: current.messageDrafts?.length ?? 0,
    institutionDrafts: current.institutionDrafts?.length ?? 0,
    publicStatements: current.publicDrafts?.filter(Boolean).length ?? 0,
  };
  let response;
  try {
    response = String(await check({ delivered })).trim();
  } catch {
    return {
      reply: source, status: "unavailable",
      problem: "The advisor's Action-completeness check was unavailable. No Action was queued; check for a review card before proceeding.",
    };
  }
  if (response === "NO_MISSING_ACTION") {
    return { reply: source, status: "none", problem: "" };
  }
  if (response === "UNRESOLVED_ACTION") {
    return { reply: source, status: "unresolved", problem: UNRESOLVED };
  }
  // Completion can ONLY supply an actions fence, never a projects, deploy,
  // institution or diplomatic operation. Reject extra text or extra fences.
  if (!ACTIONS_ONLY.test(response)) {
    return { reply: source, status: "unresolved", problem: UNRESOLVED };
  }
  const proposed = parseAdvisorReply(response);
  if (!Array.isArray(proposed.actionsProposal) || proposed.actionsProposal.length === 0
      || proposed.actionBlockProblems.length || proposed.text
      || proposed.projectsProposal || proposed.deployments?.length || proposed.institutionDrafts?.length
      || proposed.messageDrafts?.length || proposed.publicDrafts?.length || proposed.chartConfig
      // There is no canonical planned-order reference in the bounded check.
      // It may only recover a CREATE draft, never guess an edit/remove target.
      || proposed.actionsProposal.some((op) => !op || typeof op !== "object" || Array.isArray(op)
        || Object.hasOwn(op, "id") || Object.hasOwn(op, "remove"))) {
    return { reply: source, status: "unresolved", problem: UNRESOLVED };
  }
  return { reply: source.trimEnd() + "\n\n" + response, status: "recovered", problem: "" };
};
