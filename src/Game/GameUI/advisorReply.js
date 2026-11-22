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
import { stripAdvisorActionHistoryAnnotations } from "../AI/advisorActionHistory.js";

// A ```chart fence that never closed (the reply ran out) is not matched by
// extractFencedJson and would print its JSON into the bubble.
const UNCLOSED_CHART = /```chart[\s\S]*$/;

// (A plan written in prose under English "Action:" and "Lead:" headings used
// to be taken for an Action the advisor forgot to submit, with a button to ask
// for it. The same plan in any other language was not, and a plan written
// that way in English was not always one. What the advisor submits is its
// ```actions block, and nothing else is read as one.)

// Why a whole block drew nothing, before any entry was looked at.
const blockProblems = (json, reason) => {
  if (reason) return [`it was ${reason}, so nothing in it was offered`];
  if (json !== null && !Array.isArray(json)) return ["it was not a list, so nothing in it was offered"];
  return [];
};

// A provider may emit several independent ```actions arrays even though the
// prompt asks for one. The old single-block extractor rendered every later
// machine-readable array as raw code and only offered the first for review.
// Reuse the existing strict fenced parser for EACH block, in appearance order;
// a bad block contributes no operations and is reported instead of silently
// swallowing the other proposals. An incomplete final fence is never salvaged
// into a potentially unintended Action, even after streaming has ended.
const extractActionBlocks = (rawText, { streaming }) => {
  let rest = rawText;
  let found = 0;
  const operations = [];
  const problems = [];
  while (true) {
    // In streaming mode the existing extractor hides an unfinished fence.
    // Use that mode here also for a final truncated fence, then explicitly
    // report it; other structured block types keep their established policy.
    const block = extractFencedJson(rest, "actions", { streaming: true });
    if (block.rest === rest) break;
    found += 1;
    rest = block.rest;
    if (Array.isArray(block.json)) operations.push(...block.json);
    else if (block.json !== null) problems.push(`Action block ${found} was not a list; no proposals were offered from it.`);
    else if (block.reason) problems.push(`Action block ${found} was ${block.reason}; no proposals were offered from it.`);
    else if (!streaming) problems.push(`Action block ${found} was cut off before it closed; no proposals were offered from it.`);
  }
  return { rest, json: found ? operations : null, problems };
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
  const { rest: afterActions, json: actionsRaw, problems: actionBlockProblems } = extractActionBlocks(afterChart, { streaming });
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
    text: stripAdvisorActionHistoryAnnotations(rest.trim()),
    chartConfig: chart.config,
    chartProblem: chart.problem,
    actionsProposal: Array.isArray(actionsRaw) ? actionsRaw : null,
    actionBlockProblems,
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
