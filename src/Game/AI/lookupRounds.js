/*! Open Historia — the lookup rounds of one AI call © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/lookupRounds.test.js
//
// Lookup rounds (lookupTools.js, toolTurns.js). A structured task may hand
// callAI `lookups: { tools, execute, maxRounds?, onRound? }`: the lookup
// functions are declared beside the task's output function, and when the model
// calls them instead of answering, each call is answered here (from the live
// campaign, by the task's executor) and the exchange goes back as the next
// turns of the same conversation. That repeats until the model calls the
// output function, or the round budget is spent and the final request is made
// with only the output function callable. One provider request per round; the
// system prompt is byte-identical across rounds, so a cached prefix pays off.
// Three, not more: every round re-sends the whole prompt, and a model that
// asks one question per round spent seven rounds and three hundred thousand
// prompt tokens on one jump. The directive tells it to ask everything at once.
//
// A REPEATED LOOKUP ENDS THE ASKING. A small model will ask the same question
// again, word for word, having just been answered. A player's log has
// list_projects(owner="Russia", status="all") three rounds running, the same
// of list_powers(query="") in two other tasks and of
// list_regions(owner="Russian Federation") in a skip, and
// region_info(regionId="2476") twice: each a whole request that re-sent the
// prompt to learn what the conversation already said, and that last task then
// spent its final request without calling the output function at all. So a
// call that repeats one already answered in this conversation, same function
// and same arguments, is not run again. It is answered with a line saying its
// result is above and the output function must be called now, and the next
// request offers only the output function, exactly as the last round of the
// budget does. It can only shorten the conversation: no request is added, and
// the round cannot be spent a third time.
//
// Lives apart from main.jsx (which pulls in the whole browser runtime and so
// cannot be unit-tested) so the loop can be driven with a scripted model.

import { logDebugEvent } from "../../runtime/debugLog.js";
import {
    appendLookupRound,
    describeLookupCall,
    lookupCallKey,
    lookupRoundCount,
    repeatedLookupAnswer,
} from "./toolTurns.js";

export const DEFAULT_LOOKUP_ROUNDS = 3;

// `dispatch(conversation, { lookupTools, requireOutputTool })` makes one
// provider request and resolves with the provider's result: the answer, or
// `{ lookupCalls }` when the model asked instead.
//
// Every round the model spends asking is reported to `onRound` — callAI
// writes it to the telemetry record and the diagnostics log — so "what did
// the model look up before it answered" is answerable from the console.
// `outputTool` is the name of the task's output function, for the line a
// repeated lookup is answered with.
export async function runWithLookups(lookups, history, dispatch, { label, provider, outputTool = "", onRound = null }) {
    const tools = Array.isArray(lookups?.tools) ? lookups.tools.filter((entry) => entry?.name && entry?.schema) : [];
    if (!tools.length || typeof lookups?.execute !== "function") return dispatch(history, {});
    const maxRounds = Number.isInteger(lookups.maxRounds) && lookups.maxRounds >= 0 ? lookups.maxRounds : DEFAULT_LOOKUP_ROUNDS;
    let conversation = Array.isArray(history) ? history : [];
    let roundStartedAt = Date.now();
    // The lookups answered in earlier rounds of this conversation, by function
    // and arguments (toolTurns.js lookupCallKey), and whether the model has
    // asked one of them again.
    const answeredBefore = new Set();
    let repeated = false;
    for (let round = 0; ; round += 1) {
        const requireOutputTool = round >= maxRounds || repeated;
        if (round > 0) lookups.onRound?.(round);
        const result = await dispatch(conversation, { lookupTools: tools, requireOutputTool });
        const calls = Array.isArray(result?.lookupCalls) ? result.lookupCalls : [];
        // The answer, or a request that could not be turned into one (a final
        // round still asking questions falls through to the runner's retry).
        if (!calls.length || result?.toolInput || requireOutputTool) {
            if (round > 0) {
                logDebugEvent("ai-call", `${label}: ${provider} answered after ${round} lookup round${round === 1 ? "" : "s"}${result?.toolInput ? "" : " without calling the output function"}.`,
                    { lookupRounds: lookupRoundCount(conversation), answered: Boolean(result?.toolInput), forcedOutput: requireOutputTool });
            }
            return result;
        }
        const elapsedMs = Date.now() - roundStartedAt;
        const results = [];
        const answered = [];
        const askedThisRound = [];
        for (const call of calls) {
            const startedAt = Date.now();
            const key = lookupCallKey(call);
            // Asked and answered in an earlier round: not run again.
            const repeat = answeredBefore.has(key);
            let response;
            if (repeat) {
                response = repeatedLookupAnswer(outputTool);
                repeated = true;
            } else {
                try {
                    response = await lookups.execute(call.name, call.args);
                } catch (error) {
                    response = { error: String(error?.message || error) };
                }
                askedThisRound.push(key);
            }
            if (response == null || typeof response !== "object" || Array.isArray(response)) response = { result: response ?? null };
            results.push({ id: call.id, name: call.name, response });
            answered.push({
                name: call.name,
                args: call.args,
                label: describeLookupCall(call),
                response: JSON.stringify(response),
                ms: Date.now() - startedAt,
                error: !repeat && typeof response.error === "string" && response.error.length > 0,
                repeat,
            });
        }
        // Only now, so the same call made twice in ONE turn is simply answered
        // twice, as it always was: that is a careless model, not one going round.
        for (const key of askedThisRound) answeredBefore.add(key);
        // Always logged: the calls and what they cost, one line. The full
        // arguments and answers ride along only in detailed mode.
        logDebugEvent("ai-call", `${label}: lookup round ${round + 1} on ${provider}: ${answered.map((entry) => `${entry.label}${entry.repeat ? " [asked before: not run again]" : ""}`).join("; ")}.`, {
            answers: answered.map((entry) => `${entry.name} ${entry.repeat ? "REPEAT " : entry.error ? "ERROR " : ""}${entry.response.length} chars`).join("; "),
            modelMs: elapsedMs,
            ...(repeated ? { next: "only the output function is offered: a lookup was repeated" } : {}),
        });
        logDebugEvent("ai-call", `${label}: lookup round ${round + 1} in full.`, answered.map((entry) => ({
            call: entry.label, args: entry.args, response: entry.response,
        })), { verbose: true });
        try {
            onRound?.({ round: round + 1, calls: answered, elapsedMs });
        } catch (error) {
            console.warn("[ai] a lookup-round observer threw; continuing.", error);
        }
        conversation = appendLookupRound(conversation, calls, results);
        roundStartedAt = Date.now();
    }
}
