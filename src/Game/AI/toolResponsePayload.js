/*! Open Historia — the structured payload of a callAI answer */
// callAI answers { rawText, toolInput }. toolInput is filled only when the
// provider made a real tool call. In json_schema, json_object and text_json
// mode, Gemini's streamed-text fallback and an Anthropic text answer, the same
// payload arrives as JSON text in rawText with toolInput null, and reading the
// envelope as the payload left every field missing. Import-free apart from
// jsonSalvage.js so it loads in node tests.

import { extractJsonPayload, unwrapMimickedToolCall } from "./jsonSalvage.js";

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const toolResponsePayload = (response, toolName = "") => {
  if (isPlainObject(response?.toolInput)) return response.toolInput;
  if (isPlainObject(response) && typeof response.rawText === "string") {
    const parsed = unwrapMimickedToolCall(extractJsonPayload(response.rawText), toolName);
    if (isPlainObject(parsed)) return parsed;
  }
  // Test doubles and older seams hand the payload over directly.
  return isPlainObject(response) ? response : null;
};

// Whether what arrived of a structured answer is a whole one, when the stream
// it came on stopped before the provider said it had finished (streamAssembly.js
// marks the envelope `closedEarly`). Whole means the output function's call
// arrived (`toolInput`), or the text holds one complete JSON payload: all any
// task would have taken from it. Prose has no way to say it is complete, so a
// reply in words is never whole here; it is judged below instead.
export const holdsWholeAnswer = (answerText, toolInput = null) =>
  isPlainObject(toolInput) || extractJsonPayload(answerText) != null;

// What a stream that ended without an end marker (no finish reason, no [DONE],
// no error) leaves the call with. It depends on what the call wanted:
//
//   "whole"   a structured answer that is all there. Used as it always was.
//   "closed"  a structured answer that is not, or nothing at all. That is the
//             connection closing mid-answer, and main.jsx fails the call on it
//             (failIfClosedEarly) rather than hand half an answer on as a
//             finished one.
//   "kept"    a reply in words, a conversation's or a task's that answers in
//             text. There is nothing to hold it to, and some gateways end every
//             stream this way: failing there would fail every reply they send,
//             where a reply that really was cut is at worst visibly cut short.
//             So it is returned as it arrived, as it was before the ending was
//             looked at, and the call's log says how the stream ended.
export const unmarkedEndVerdict = ({ structured = false, answerText = "", toolInput = null } = {}) => {
  if (structured) return holdsWholeAnswer(answerText, toolInput) ? "whole" : "closed";
  return String(answerText ?? "").trim() ? "kept" : "closed";
};
