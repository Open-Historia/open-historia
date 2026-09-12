// Tool turns across the three provider shapes.
//
// The game keeps conversation history in Gemini's shape: [{ role, parts }].
// A lookup round adds two turns to it — the model's function calls and our
// function responses — as Gemini-style parts:
//
//   { role: "model", parts: [{ functionCall: { id, name, args } }, ...] }
//   { role: "user",  parts: [{ functionResponse: { id, name, response } }, ...] }
//
// Every provider path converts that history to its own wire format, and reads
// the calls a model made back out of its own response envelope. Import-free so
// the conversions are testable in node.

const clean = (value) => String(value ?? "").trim();
const array = (value) => (Array.isArray(value) ? value : []);

let callCounter = 0;
export const nextCallId = () => `call_${Date.now().toString(36)}_${(callCounter += 1).toString(36)}`;

const partsOf = (entry) => array(entry?.parts);
const textOf = (entry) => partsOf(entry).map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
const callsOf = (entry) => partsOf(entry).filter((part) => part?.functionCall && typeof part.functionCall === "object").map((part) => part.functionCall);
// Gemini 3 signs each function call it makes (a `thoughtSignature` beside the
// call in the part) and refuses the next request unless the signature comes
// back on the same part. Carried on the call and on the stored part; the
// other providers never see it.
const signatureOf = (part) => (typeof part?.thoughtSignature === "string" && part.thoughtSignature
  ? { thoughtSignature: part.thoughtSignature }
  : typeof part?.thought_signature === "string" && part.thought_signature
    ? { thoughtSignature: part.thought_signature }
    : {});
const responsesOf = (entry) => partsOf(entry).filter((part) => part?.functionResponse && typeof part.functionResponse === "object").map((part) => part.functionResponse);

const serialise = (value) => {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value ?? null); } catch { return String(value); }
};

// ---- Gemini ---------------------------------------------------------------

// Gemini's own part types, minus the ids we carry for the other providers.
export const geminiContentsFromHistory = (history) => array(history).map((entry) => ({
  role: entry?.role === "model" ? "model" : "user",
  parts: partsOf(entry).map((part) => {
    if (part?.functionCall) {
      const { name, args } = part.functionCall;
      return { functionCall: { name: clean(name), args: args && typeof args === "object" ? args : {} }, ...signatureOf(part) };
    }
    if (part?.functionResponse) {
      const { name, response } = part.functionResponse;
      return { functionResponse: { name: clean(name), response: response && typeof response === "object" && !Array.isArray(response) ? response : { result: response ?? null } } };
    }
    return { text: typeof part?.text === "string" ? part.text : "" };
  }),
}));

export const lookupCallsFromGemini = (data, outputToolName) => {
  const parts = array(data?.candidates?.[0]?.content?.parts);
  return parts
    .filter((part) => part?.functionCall && clean(part.functionCall.name) && clean(part.functionCall.name) !== clean(outputToolName))
    .map((part) => ({
      id: nextCallId(),
      name: clean(part.functionCall.name),
      args: part.functionCall.args && typeof part.functionCall.args === "object" ? part.functionCall.args : {},
      ...signatureOf(part),
    }));
};

// ---- OpenAI-compatible ----------------------------------------------------

export const openAiMessagesFromHistory = (systemPrompt, history) => {
  const messages = [{ role: "system", content: systemPrompt }];
  for (const entry of array(history)) {
    const calls = callsOf(entry);
    const responses = responsesOf(entry);
    if (entry?.role === "model" && calls.length) {
      const text = textOf(entry);
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((call) => ({
          id: clean(call.id) || nextCallId(),
          type: "function",
          function: { name: clean(call.name), arguments: serialise(call.args ?? {}) },
        })),
      });
      continue;
    }
    if (responses.length) {
      for (const response of responses) {
        messages.push({ role: "tool", tool_call_id: clean(response.id), content: serialise(response.response) });
      }
      continue;
    }
    messages.push({ role: entry?.role === "model" ? "assistant" : "user", content: textOf(entry) });
  }
  return messages;
};

export const lookupCallsFromOpenAI = (data, outputToolName) => array(data?.choices?.[0]?.message?.tool_calls)
  .filter((call) => clean(call?.function?.name) && clean(call.function.name) !== clean(outputToolName))
  .map((call) => {
    let args = call.function?.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    return { id: clean(call.id) || nextCallId(), name: clean(call.function.name), args: args && typeof args === "object" ? args : {} };
  });

// ---- Anthropic ------------------------------------------------------------

export const anthropicMessagesFromHistory = (history) => array(history).map((entry) => {
  const calls = callsOf(entry);
  const responses = responsesOf(entry);
  if (entry?.role === "model" && calls.length) {
    const text = textOf(entry);
    return {
      role: "assistant",
      content: [
        ...(text ? [{ type: "text", text }] : []),
        ...calls.map((call) => ({ type: "tool_use", id: clean(call.id) || nextCallId(), name: clean(call.name), input: call.args && typeof call.args === "object" ? call.args : {} })),
      ],
    };
  }
  if (responses.length) {
    return {
      role: "user",
      content: responses.map((response) => ({ type: "tool_result", tool_use_id: clean(response.id), content: serialise(response.response) })),
    };
  }
  return { role: entry?.role === "model" ? "assistant" : "user", content: [{ type: "text", text: textOf(entry) }] };
});

export const lookupCallsFromAnthropic = (data, outputToolName) => array(data?.content)
  .filter((block) => block?.type === "tool_use" && clean(block.name) && clean(block.name) !== clean(outputToolName))
  .map((block) => ({ id: clean(block.id) || nextCallId(), name: clean(block.name), args: block.input && typeof block.input === "object" ? block.input : {} }));

// ---- The round itself -----------------------------------------------------

// Append one lookup round to a history: the model's calls, then our answers,
// paired by id. `results` is [{ id, name, response }].
export const appendLookupRound = (history, calls, results) => {
  const byId = new Map(array(results).map((result) => [clean(result.id), result]));
  return [
    ...array(history),
    { role: "model", parts: array(calls).map((call) => ({ functionCall: { id: clean(call.id), name: clean(call.name), args: call.args ?? {} }, ...signatureOf(call) })) },
    {
      role: "user",
      parts: array(calls).map((call) => {
        const result = byId.get(clean(call.id));
        return { functionResponse: { id: clean(call.id), name: clean(call.name), response: result ? result.response : { error: "no result" } } };
      }),
    },
  ];
};

// How much of a history is lookup traffic, for logs.
export const lookupRoundCount = (history) => array(history).filter((entry) => callsOf(entry).length > 0).length;

// One line for a call, the way a log reads it: name(key="value", n=3). Long
// strings are cut so a list of calls stays a list and not a transcript.
const argValue = (value, max) => {
  if (typeof value === "string") return JSON.stringify(value.length > max ? `${value.slice(0, max)}…` : value);
  if (value == null || typeof value === "number" || typeof value === "boolean") return String(value);
  const text = serialise(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
export const describeLookupCall = (call, { maxValue = 60 } = {}) => {
  const args = call?.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {};
  const inner = Object.entries(args).map(([key, value]) => `${key}=${argValue(value, maxValue)}`).join(", ");
  return `${clean(call?.name) || "?"}(${inner})`;
};
