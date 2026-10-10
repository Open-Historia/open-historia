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

// The lookup rounds of a history as plain text: what the model asked, then what
// came back. For an endpoint that refused the function declarations mid-
// conversation (some local servers and gateways take no tools at all), which a
// history of function calls cannot then be sent to either. The model still
// reads every answer it asked for.
export const flattenLookupRounds = (history) => array(history).map((entry) => {
  const calls = callsOf(entry);
  const responses = responsesOf(entry);
  if (entry?.role === "model" && calls.length) {
    const text = textOf(entry);
    return { role: "model", parts: [{ text: [text, ...calls.map((call) => `[Looked up ${describeLookupCall(call)}]`)].filter(Boolean).join("\n") }] };
  }
  if (responses.length) {
    return { role: "user", parts: [{ text: responses.map((response) => `[${clean(response.name) || "lookup"} answered: ${serialise(response.response)}]`).join("\n") }] };
  }
  return entry;
});

// ---- Rounds carried to the next attempt -----------------------------------

// A lookup's answer is a fact about the campaign, whoever asked and whichever
// model reads it. A task that asks again (runJsonTask's retry) or moves to the
// next Fallback entry used to start from the bare conversation and pay again for
// rounds already answered. `carry` ({ rounds, at }) keeps them: `rounds` in the
// stored shape, `at` where in the conversation they were first asked. And
// `outputOnly`, once the task has asked a lookup it already had the answer to
// (see "A lookup asked a second time" below).
export const createLookupCarry = () => ({ rounds: [], at: null, outputOnly: false });

// Keeps one answered round. `baseLength` is the length of the conversation the
// attempt started from, which is where the rounds go back in.
export const carryLookupRound = (carry, baseLength, calls, results) => {
  if (!carry || typeof carry !== "object") return;
  if (!Number.isInteger(carry.at)) carry.at = Math.max(0, Number(baseLength) || 0);
  carry.rounds = appendLookupRound(array(carry.rounds), calls, results);
};

// How many rounds the carry holds: the next attempt's round budget is what is left.
export const carriedRoundCount = (carry) => lookupRoundCount(carry?.rounds);

// The conversation an attempt starts from, with the carried rounds back where
// they were asked. As TEXT (flattenLookupRounds), never as function calls:
// Gemini 3 refuses a function call whose thought signature another model or
// another request made, and a text turn reads the same on every provider.
// The conversation only grows at its end between attempts, so the prefix
// before `at` is the one the rounds followed.
export const withCarriedRounds = (history, carry) => {
  const list = array(history);
  const rounds = array(carry?.rounds);
  if (!rounds.length) return list;
  const at = Number.isInteger(carry.at) ? Math.min(Math.max(carry.at, 0), list.length) : list.length;
  return [...list.slice(0, at), ...flattenLookupRounds(rounds), ...list.slice(at)];
};

// ---- A lookup asked a second time -------------------------------------------

// A model that cannot settle calls the same lookup with the same arguments
// again a round later, and again. A player's log has eight tasks doing it in
// thirteen minutes: list_projects(owner="Russia", status="all") three rounds
// running, list_powers(query="") three times (in two tasks), region_info(
// regionId="2476") twice. Every round is a whole request that sends the whole
// prompt again, and the task that asked for the region twice then ran out of
// rounds without ever calling the output function. The answer cannot have
// changed: a lookup reads the campaign, and the campaign does not move while a
// task runs.
//
// So a call this task has already had answered is not answered again. It is
// told its answer is above and that the output function is due, and from then
// on the task's requests offer only the output function (the carry's
// `outputOnly`), so the round cannot be spent a third time, on this attempt or
// the next. No request is added: the round that repeated was already made.

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
};

// What makes two calls the same call: the function and its arguments, whatever
// order the model wrote the keys in. Nothing looser: list_regions(owner="X")
// and list_regions(owner="X", limit=200) may or may not be the same question.
export const lookupCallKey = (call) => {
  const args = call?.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {};
  return `${clean(call?.name)}(${serialise(sortKeys(args))})`;
};

// Every call the stored rounds hold: a history's, or a carry's `rounds`.
export const answeredLookupKeys = (rounds) => new Set(array(rounds).flatMap((entry) => callsOf(entry).map(lookupCallKey)));

// What a repeated call is answered with. `outputToolName` is the task's output
// function; a chat that looks things up (the advisor) has none and answers in text.
export const repeatedLookupResponse = (outputToolName = "") => ({
  alreadyAnswered: true,
  note: "You already called this function with exactly these arguments, and its answer is above in this conversation. "
    + "It has not changed and is not given again. Do not call any more lookup functions: "
    + `${clean(outputToolName) ? `call ${clean(outputToolName)} now` : "answer now"} with what you have.`,
});

// Answers one round's calls. `answeredKeys` holds the calls already answered in
// this task (answeredLookupKeys); a call found there gets the note above
// instead of its result. Two identical calls inside ONE round are both run:
// that is a model being careless in one turn, not one going round in circles.
// The caller adds this round's calls to `answeredKeys` afterwards.
//
// Returns { results, answered, repeated }: `results` for appendLookupRound,
// `answered` for the log and the telemetry record, and whether any call was a
// repeat, which is the caller's cue to offer only the output function next.
// A lookup that throws answers { error }, and one that returns a bare value is
// wrapped, as before.
export const answerLookupCalls = async (calls, { execute, answeredKeys = new Set(), outputToolName = "", now = () => Date.now() } = {}) => {
  const results = [];
  const answered = [];
  for (const call of array(calls)) {
    const startedAt = now();
    const repeated = answeredKeys.has(lookupCallKey(call));
    let response;
    if (repeated) {
      response = repeatedLookupResponse(outputToolName);
    } else {
      try {
        response = await execute(call.name, call.args);
      } catch (error) {
        response = { error: String(error?.message || error) };
      }
    }
    if (response == null || typeof response !== "object" || Array.isArray(response)) response = { result: response ?? null };
    results.push({ id: call.id, name: call.name, response });
    answered.push({
      name: call.name,
      args: call.args,
      label: describeLookupCall(call),
      response: JSON.stringify(response),
      ms: now() - startedAt,
      error: typeof response.error === "string" && response.error.length > 0,
      repeated,
    });
  }
  return { results, answered, repeated: answered.some((entry) => entry.repeated) };
};

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
