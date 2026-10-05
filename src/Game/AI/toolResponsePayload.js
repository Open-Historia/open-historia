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
