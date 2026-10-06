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

// Whether what arrived of an answer is a whole one, when the stream it came on
// stopped before the provider said it had finished (streamAssembly.js marks the
// envelope `closedEarly`). Whole means the output function's call arrived
// (`toolInput`), or the text holds one complete JSON payload: all any task
// would have taken from it, so the answer is used as it always was. Anything
// else is the connection closing mid-answer, and main.jsx fails the call on it
// (failIfClosedEarly) rather than hand half an answer on as a finished one.
// Prose has no way to say it is complete, so a reply in words is never whole here.
export const holdsWholeAnswer = (answerText, toolInput = null) =>
  isPlainObject(toolInput) || extractJsonPayload(answerText) != null;
