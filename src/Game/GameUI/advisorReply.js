// One advisor reply, taken apart: the prose the bubble shows, and every
// machine-readable fence in it (chart, actions, senddraft, institutiondraft,
// deploy, projects) turned into what the panel draws.
//
// Lifted out of advisor.jsx so it can be tested, like the helpers it calls:
// every import here is import-free, so its tests run in a bare checkout.
//
// It runs on every render of a reply (AdvisorMessageRow) and once more when the
// reply arrives (advisor.jsx runTurn), which is where the *Problems lists are
// kept on the message: what the advisor offered and the panel did not draw, told
// to it before the next question (advisorBlocks.js describeReplyProblems).
import { extractFencedJson, filterAdvisorDeployments, validateChartConfig } from "./advisorBlocks.js";
import { buildMessageDrafts } from "./advisorDrafts.js";
import { buildInstitutionDrafts } from "./advisorInstitutionDrafts.js";

// A ```chart fence that never closed (the reply ran out) is not matched by
// extractFencedJson and would print its JSON into the bubble.
const UNCLOSED_CHART = /```chart[\s\S]*$/;

// Why a whole block drew nothing, before any entry was looked at.
const blockProblems = (json, reason) => {
  if (reason) return [`it was ${reason}, so nothing in it was offered`];
  if (json !== null && !Array.isArray(json)) return ["it was not a list, so nothing in it was offered"];
  return [];
};

// `allowedUnitTypes` is the scenario's world.allowedUnitTypes: a deployment of
// any other type gets no button.
// `streaming`: the reply is still arriving, so an open fence is hidden rather
// than salvaged (advisorBlocks.js extractFencedJson).
export const parseAdvisorReply = (rawText, { allowedUnitTypes = null, streaming = false } = {}) => {
  const { rest: chartRest, json: chartJson, reason: chartReason } = extractFencedJson(String(rawText ?? ""), "chart");
  const unclosedChart = !chartJson && !chartReason && UNCLOSED_CHART.test(chartRest);
  const afterChart = unclosedChart ? chartRest.replace(UNCLOSED_CHART, "") : chartRest;
  // Checked before it is drawn (advisorBlocks.js validateChartConfig): a chart
  // the panel cannot lay out is replaced by a line saying why, and the advisor
  // is told the same thing before the next question.
  const chart = chartJson
    ? validateChartConfig(chartJson)
    : { config: null, problem: chartReason ? `the chart block was ${chartReason}` : unclosedChart ? "the chart block was cut off before it closed" : "" };
  const { rest: afterActions, json: actionsRaw } = extractFencedJson(afterChart, "actions", { streaming });
  const { rest: afterDrafts, json: draftsRaw, reason: draftsReason } = extractFencedJson(afterActions, "senddraft", { streaming });
  const { rest: afterInstitutionDrafts, json: institutionDraftsRaw, reason: institutionDraftsReason } = extractFencedJson(afterDrafts, "institutiondraft", { streaming });
  const { rest: afterDeploy, json: deployRaw, reason: deployReason } = extractFencedJson(afterInstitutionDrafts, "deploy", { streaming });
  const { rest, json: projectsRaw, truncated: projectsTruncated } = extractFencedJson(afterDeploy, "projects", { salvageTruncated: true, streaming });

  const draftProblems = blockProblems(draftsRaw, draftsReason);
  const messageDrafts = Array.isArray(draftsRaw) ? buildMessageDrafts(draftsRaw, afterActions, draftProblems) : null;
  const institutionDraftProblems = blockProblems(institutionDraftsRaw, institutionDraftsReason);
  const institutionDrafts = buildInstitutionDrafts(institutionDraftsRaw, institutionDraftProblems);
  // A deployment the advisor is recommending, ready to place with one click.
  const deployProblems = blockProblems(deployRaw, deployReason);
  const deployments = filterAdvisorDeployments(deployRaw, allowedUnitTypes, deployProblems);

  return {
    text: rest.trim(),
    chartConfig: chart.config,
    chartProblem: chart.problem,
    actionsProposal: Array.isArray(actionsRaw) ? actionsRaw : null,
    messageDrafts,
    institutionDrafts: institutionDrafts.length ? institutionDrafts : null,
    deployments: deployments.length ? deployments : null,
    projectsProposal: Array.isArray(projectsRaw) ? projectsRaw : null,
    projectsTruncated,
    draftProblems,
    institutionDraftProblems,
    deployProblems,
  };
};
