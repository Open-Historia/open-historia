// A failed structured task can contain a genuine answer that is malformed JSON.
// Never relabel that captured answer as hidden reasoning merely because it is long.
import { OUTPUT_LIMIT_MESSAGE, REASONING_ONLY_MESSAGE } from "./providerErrors.js";

export const describeUnparseableStructuredAnswer = ({
  rawText = "", reasoningOnly = false, cutAtOutputLimit = false,
} = {}) => {
  if (cutAtOutputLimit) return OUTPUT_LIMIT_MESSAGE;
  if (reasoningOnly) return REASONING_ONLY_MESSAGE;
  const text = String(rawText ?? "").trim();
  if (!text) return "Response did not contain parseable JSON or tool arguments.";
  if (/^(?:```(?:json)?\s*)?[{\[]/i.test(text)) {
    return "The model returned malformed or incomplete JSON; no valid structured answer could be parsed.";
  }
  return "The model returned text that did not contain a parseable structured answer.";
};
