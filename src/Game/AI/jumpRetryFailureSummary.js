/*! Open Historia - bounded second-attempt diagnostics for generated Timeline turns.
 * The schema reports its first error. A separate native accounting contract may
 * also fail in the same answer. Tell the model both facts on its ONE existing
 * retry, without weakening either validator or rewriting any canonical state.
 */
import { validateGeneratedStatsEconomicAccounting } from "../../runtime/statsEconomicEventAccounting.js";

const JUMP_KEYS = new Set(["jumpForward", "autoJumpForward"]);

export const jumpRetryFailureSummary = (taskKey, candidate, primaryError) => {
  const first = String(primaryError ?? "").trim();
  if (!JUMP_KEYS.has(taskKey) || !Array.isArray(candidate?.events)) return first;
  // The strict validator reports the FIRST invalid event. A field report's
  // corrective retry fixed one Economy event and then failed on the next.
  // Apply the SAME audit validator to each independent event to disclose
  // all failures at once, without fabricating an audit state or GDP effect.
  const issues = candidate.events.flatMap((event, index) => {
    const error = validateGeneratedStatsEconomicAccounting([event]);
    if (!error) return [];
    return [error.replace(/^\$\.events\[0\]/, "$.events[" + index + "]")];
  });
  if (!issues.length) return first;
  const independent = [...new Set(issues)].filter((error) => !first.includes(error));
  if (!independent.length) return first || issues[0];
  const shown = independent.slice(0, 12);
  const more = independent.length - shown.length;
  const details = shown.join("; ") + (more ? "; plus " + more + " further event(s) requiring review" : "");
  return first
    ? first + " ALSO correct this independently detected native Statistics error: " + details
    : details;
};
