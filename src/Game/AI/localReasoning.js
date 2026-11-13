/*! Open Historia — what the "Model reasoning" setting sends to an OpenAI-compatible endpoint © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
// Import-free on purpose: runs under node --test without a build.
//
// The setting used to say something only when it was ON (reasoning_effort
// "medium", and enable_thinking for the local servers that key on it). OFF
// sent nothing, which a hosted API reads as "no reasoning" and a local server
// reads as "whatever the model's template does" — and the template of a
// thinking-class model (Qwen3, Gemma-family reasoning builds served by
// llama.cpp) thinks by default. So a player who had switched reasoning off
// still waited for it: a field report (2026-11-12, llama.cpp, a 27B model on a
// 12 GB card) had a one-month time skip open for 1,144 seconds with 37,717
// characters of reasoning and not one character of answer.
//
// OFF now says so to a local server: reasoning_effort "none", which llama.cpp
// maps to the template's thinking switch. Measured on that same server with
// one short prompt and a 700-token cap: nothing sent, 2,619 characters of
// reasoning and no answer; "none", no reasoning and the whole answer in a
// third of the time.
//
// Local servers only. A hosted API that is sent nothing already does not
// reason, and several of them refuse a value they do not list, which would
// cost a failed request per call to tell them what they already do.

// The fields a chat-completions request carries for the setting.
//   enabled      the player's "Model reasoning" setting
//   local        the endpoint is on this machine or network
//   toolRefused  this call's endpoint refused reasoning together with function
//                tools, so it is left out for the rest of the call
//   offRefused   this endpoint refused the "none" value (remembered for the session)
export const openAiReasoningFields = ({ enabled = true, local = false, toolRefused = false, offRefused = false } = {}) => {
  if (enabled) {
    if (toolRefused) return {};
    // enable_thinking: textgen/oobabooga honour it per request; llama.cpp and
    // LM Studio ignore a field they do not know. Sent only when the setting is
    // ON, so a server started with thinking on is never told otherwise by it.
    return { reasoning_effort: "medium", ...(local ? { enable_thinking: true } : {}) };
  }
  return local && !offRefused ? { reasoning_effort: "none" } : {};
};

// Whether a 400's message is the endpoint refusing the reasoning field itself:
// an older local server that lists only low/medium/high. The request is then
// sent again without it, and the endpoint is not asked again this session.
export const isReasoningOffRefusal = (message) => {
  const text = String(message ?? "");
  return /reasoning[_ ]effort/i.test(text) && !/function tools/i.test(text);
};
