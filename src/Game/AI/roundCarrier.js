/*! Open Historia — a shared round's request, carried to the player whose device pays for it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Taking turns to pay (multiplayer/host/settings.js payment "cycle", the
// owner's decision 14): each round's AI request is made by each player's device
// in turn, on its own key, and no key is ever sent. The host's engine builds the
// round's request exactly as it always has. Where it would send it to its own
// provider, callAI (main.jsx) hands it instead to the carrier installed for that
// round (multiplayer/host/roundPayers.js `carry`), which sends it to the paying
// device and resolves with that device's answer in the shape a provider's
// answer has. runJsonTask then reads it, salvages it and applies it exactly as
// its own: the host is still the one game, and only the request changed hands.
//
// Which calls: those of the round's time skip, which are the calls that spend
// from a skip's budget (callAI's `spender`, set inside a skip and nowhere
// else). Anything the engine asks meanwhile (a table's answer, a stat sheet)
// is the host's as before.
//
// The paying device's end is here too: payerCallOf turns the request it was
// sent into callAI's own arguments (with no language directive and no
// difficulty line added: the host's callAI wrote both into the prompt already),
// and answerOf turns callAI's answer into what goes back. A lookup the model
// asks for is answered by the host from its own game (`execute`).
//
// Import-free, so both ends are tested under bare node.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// Plain JSON, as it will cross: a function or an undefined is left out.
const plain = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
const offset = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

let carrier = null;

// Installed for the round a player's device pays, and taken away after it:
// returns what takes it away (and leaves another round's carrier in place).
export const installRoundCarrier = (carry) => {
  carrier = typeof carry === "function" ? carry : null;
  const installed = carrier;
  return () => {
    if (carrier === installed) carrier = null;
  };
};
export const roundCarried = () => carrier !== null;

// What of a call crosses to the paying device (game/messages.js "pay" `call`):
// the prompt as built, its history, the function it is to answer with, the
// lookup functions it may call and how many rounds of them, and what the
// device's provider uses to cache the prompt and choose the task's model.
export const carriedRequestOf = ({ systemPrompt = "", history = [], opts = {}, lookups = null } = {}) => {
  const tools = list(lookups?.tools).filter((entry) => clean(entry?.name) && entry?.schema).map((entry) => plain(entry));
  const maxRounds = Number.isInteger(lookups?.maxRounds) && lookups.maxRounds >= 0 ? Math.min(16, lookups.maxRounds) : null;
  const maxTokens = Number(opts?.maxTokens) > 0 ? Math.min(1_000_000, Math.trunc(Number(opts.maxTokens))) : null;
  return {
    systemPrompt: String(systemPrompt ?? ""),
    history: plain(list(history)),
    tool: opts?.tool ? plain(opts.tool) : null,
    lookupTools: tools.slice(0, 32),
    maxRounds,
    taskKey: clean(opts?.taskKey).slice(0, 60),
    staticPrefixEnd: offset(opts?.staticPrefixEnd),
    sharedPrefixEnd: offset(opts?.sharedPrefixEnd),
    promptCacheKey: clean(opts?.promptCacheKey).slice(0, 200),
    maxTokens,
  };
};

// The host's end, from callAI: null when this call is not one to carry (no
// round is being paid by another device, or the call is not the round's), or
// a promise of the paying device's answer, as callAI returns a provider's.
// `onRequest` is told the status of every provider response the paying
// device's AI gave, in order, as callAI tells it of its own: the skip reads them
// to tell a contract the provider refused from an answer that was no good.
export const carriedCall = ({ systemPrompt, history, opts = {}, lookups = null, spender = "", onRequest = null } = {}) => {
  if (!carrier || !clean(spender)) return null;
  const call = carriedRequestOf({ systemPrompt, history, opts, lookups });
  const execute = call.lookupTools.length && typeof lookups?.execute === "function" ? lookups.execute : null;
  return Promise.resolve().then(() => carrier(call, {
    execute,
    onActivity: typeof opts?.onActivity === "function" ? opts.onActivity : null,
    onRequest: typeof onRequest === "function" ? onRequest : null,
    signal: opts?.signal ?? null,
  }));
};

// The paying device's end: callAI's arguments for the request it was sent.
// `execute(name, args)` answers a lookup (it asks the host); `signal` stops it;
// `onRequest(status)` hears each provider response, for the host.
export const payerCallOf = (call, { execute = null, signal = null, onRequest = null } = {}) => {
  const tools = list(call?.lookupTools).filter((entry) => clean(entry?.name) && entry?.schema);
  return {
    systemPrompt: String(call?.systemPrompt ?? ""),
    history: list(call?.history),
    opts: {
      // The host's callAI wrote the world's language and the difficulty's line
      // into the prompt already; nothing of this device's is added to it.
      languageMode: "none",
      logLabel: "a shared round's request, paid on this device",
      taskKey: clean(call?.taskKey),
      ...(call?.tool ? { tool: call.tool } : {}),
      ...(offset(call?.staticPrefixEnd) !== null ? { staticPrefixEnd: call.staticPrefixEnd } : {}),
      ...(offset(call?.sharedPrefixEnd) !== null ? { sharedPrefixEnd: call.sharedPrefixEnd } : {}),
      ...(clean(call?.promptCacheKey) ? { promptCacheKey: clean(call.promptCacheKey) } : {}),
      ...(Number(call?.maxTokens) > 0 ? { maxTokens: Number(call.maxTokens) } : {}),
      ...(signal ? { signal } : {}),
      ...(typeof onRequest === "function" ? { onRequest } : {}),
      ...(tools.length && typeof execute === "function"
        ? { lookups: { tools, execute, ...(Number.isInteger(call?.maxRounds) ? { maxRounds: call.maxRounds } : {}) } }
        : {}),
    },
  };
};

// What goes back to the host (game/messages.js "paid" `answer`): the answer's
// text, a function call's input as JSON text, and whether it was answered as text.
export const answerOf = (result) => ({
  text: typeof result === "string" ? result : String(result?.rawText ?? ""),
  toolJson: result && typeof result === "object" && result.toolInput && typeof result.toolInput === "object" ? JSON.stringify(result.toolInput) : "",
  asText: Boolean(result && typeof result === "object" && result.answeredAsText),
});
