/*! Open Historia — Anthropic tool_choice per model © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Which Anthropic models may be FORCED to call a tool, and what the request
// says instead when one may not.
//
// The structured calls force the answer: tool_choice {type:"tool"} once only
// the answer is allowed, {type:"any"} while lookups are too. Claude Opus 5.5,
// Claude Sonnet 5.5, Claude Fable 5.1 and Claude Mythos 5.1 refuse both with a
// 400 ("tool_choice: type "tool" and "any" are not supported for this model."),
// so every structured call to them failed before it started. For those models
// the call goes out with tool_choice "auto" and the last user message ends with
// a line telling the model to answer through the tool. A reply that is prose
// anyway is still read by the JSON salvage, as on any endpoint that does not
// enforce tool_choice.
//
// A model not listed here is learned from its first refusal
// (isForcedToolChoiceRefusal), so a later release costs one request, not a turn.
// Pure; tested in anthropicToolChoice.test.js.

const NO_FORCED_TOOL_CHOICE = /^claude-(?:opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)(?![0-9])/;

// Whether this model id is one that refuses a forced tool_choice. Platform
// prefixes ("anthropic.", "us.anthropic.") and "@" or "-date" suffixes are allowed.
export const refusesForcedToolChoice = (model) => {
    const id = String(model ?? "").trim().toLowerCase().replace(/^(?:[a-z]{2}\.)?anthropic\./, "");
    return NO_FORCED_TOOL_CHOICE.test(id);
};

// Whether a 400's message is the forced-tool_choice refusal.
export const isForcedToolChoiceRefusal = (message) => {
    const text = String(message ?? "");
    return /tool_choice/i.test(text) && /not supported/i.test(text);
};

// The tool_choice for a structured call. `forced` false means the model refuses
// a forced choice, so it gets "auto" and the reminder below does the asking.
export const structuredToolChoice = ({ forced, toolName, lookupsAllowed }) => {
    if (!forced) return { type: "auto" };
    return lookupsAllowed ? { type: "any" } : { type: "tool", name: toolName };
};

// The line that asks for the tool call when tool_choice cannot.
export const toolCallReminder = ({ toolName, lookupsAllowed }) => (lookupsAllowed
    ? `Respond by calling a tool: one of the lookup tools if you still need information, otherwise ${toolName} with your answer. Do not answer in plain text.`
    : `Give your answer by calling the ${toolName} tool now. Do not answer in plain text.`);

// The messages with the reminder as a final text block of the last user turn
// (after any tool_result blocks, which must come first). A conversation that
// ends on an assistant turn gets a user turn of its own. Never mutates.
export const withToolCallReminder = (messages, reminder) => {
    const list = Array.isArray(messages) ? messages : [];
    const block = { type: "text", text: reminder };
    const last = list.at(-1);
    if (!last || last.role !== "user") return [...list, { role: "user", content: [block] }];
    const content = typeof last.content === "string"
        ? [{ type: "text", text: last.content }, block]
        : [...(Array.isArray(last.content) ? last.content : []), block];
    return [...list.slice(0, -1), { ...last, content }];
};
