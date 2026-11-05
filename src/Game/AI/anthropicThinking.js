/*! Open Historia — Anthropic extended thinking per model © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// How a request asks an Anthropic model to think.
//
// The game asks for thinking on the calls that may have it (a leader's reply,
// the advisor) as {type: "enabled", budget_tokens}. Claude Opus and Sonnet from
// 4.6 on, and every Fable and Mythos, think "adaptive" instead, and the newest
// refuse a budget with a 400 ("thinking.type.enabled" is not supported for this
// model. Use "thinking.type.adaptive" ...), so the call failed before it started
// (a Discord game on Sonnet 5.5, 2026-10-26). Those models are asked for
// {type: "adaptive"}; older ones keep the budget.
//
// A model not listed here is learned from its first refusal
// (isEnabledThinkingRefusal), as anthropicToolChoice.js learns tool_choice.
// Pure; tested in anthropicThinking.test.js.

const ADAPTIVE_THINKING = /^claude-(?:(?:opus|sonnet)-(?:4-[6-9]|[5-9])|fable-|mythos-)/;

// Whether this model id thinks "adaptive". Platform prefixes ("anthropic.",
// "us.anthropic.") and "@" or "-date" suffixes are allowed.
export const thinksAdaptive = (model) => {
    const id = String(model ?? "").trim().toLowerCase().replace(/^(?:[a-z]{2}\.)?anthropic\./, "");
    return ADAPTIVE_THINKING.test(id);
};

// The `thinking` of a request that thinks. `adaptive` is true for a model known
// (or learned) to think adaptively.
export const thinkingFor = ({ adaptive, budgetTokens = 4096 }) => (adaptive ? { type: "adaptive" } : { type: "enabled", budget_tokens: budgetTokens });

// Whether a 400's message is the refusal of a thinking budget.
export const isEnabledThinkingRefusal = (message) => {
    const text = String(message ?? "");
    return /thinking\.type\.enabled/i.test(text) && /not supported|adaptive/i.test(text);
};
