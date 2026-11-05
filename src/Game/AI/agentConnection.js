/*! Open Historia — an Agent Connection's calls © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A call that reaches an Agent entry of the Fallback list
// (docs/adr/0008-subscription-agents-answer-through-the-game.md). Nothing goes to
// a provider: the finished prompt goes into the local server's Agent queue and
// the call waits, with no time limit, until the player's own Agent answers it
// through `/skip` or the player cancels. The answer comes back in the shape a
// provider path returns, so the rest of the call (validation, salvage, the
// application receipt, the staged reveal) runs as it does for an API answer.
//
// One time skip is one skip in the queue, opened by its first request and
// finished when the game has stopped simulating (simulationStatus), so the
// Agent's `/skip` knows to stop.
import { buildAnswerFormatBlock } from "./schemaOutline.js";
import { logDebugEvent } from "../../runtime/debugLog.js";

// How long one wait for the answer is held open before it is asked again.
const ANSWER_WAIT_MS = 25000;

export const AGENT_GONE_MESSAGE = "The game's local server restarted while it waited for your Agent, so this request is no longer in the Agent queue. Run the time skip again.";

const historyText = (history) => (Array.isArray(history) ? history : [])
    .map((turn) => {
        const text = (Array.isArray(turn?.parts) ? turn.parts : []).map((part) => String(part?.text ?? "")).filter(Boolean).join("\n");
        if (!text) return "";
        return turn?.role === "model" || turn?.role === "assistant" ? `## Your earlier answer\n\n${text}` : text;
    })
    .filter(Boolean)
    .join("\n\n");

// What goes in the request's prompt file. The Agent cannot call the task's
// output function, so the function's shape is spelled out as the answer format,
// as Gemini's JSON-text answers are.
export const buildAgentPrompt = (systemPrompt, history, { tool = null } = {}) => {
    const format = tool?.schema
        ? buildAnswerFormatBlock(tool.schema, { first: Object.keys(tool.schema?.properties ?? {})[0] || "" })
        : "";
    return {
        system: String(systemPrompt ?? ""),
        prompt: [historyText(history), format].filter(Boolean).join("\n\n"),
    };
};

const abortReason = (signal) => signal?.reason ?? new DOMException("Aborted", "AbortError");

const newSkipId = () => (globalThis.crypto?.randomUUID?.() ?? `skip-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// The player sent a waiting request on to the next entry (Use API key). The
// runner moves on without a mark (fallbackRunner.js, "passedOn").
export const PASSED_ON_MESSAGE = "You sent this request to your next entry instead of your Agent.";
export const AGENT_CANCELLED_MESSAGE = "You cancelled the request waiting on your Agent.";
// A Cancel is the player's, so a task does not answer it with its canned
// fallback (gameplay.js runJsonTask).
const cancelledError = () => Object.assign(new DOMException(AGENT_CANCELLED_MESSAGE, "AbortError"), { agentCancelled: true });
const passedOnError = () => Object.assign(new Error(PASSED_ON_MESSAGE), {
    providerFailure: { kind: "passedOn", reason: "the player chose their next entry" },
});

export const createAgentClient = ({ fetch: send = (...args) => globalThis.fetch(...args), pollMs = ANSWER_WAIT_MS } = {}) => {
    let skip = null; // { id, opened: Promise }
    // The game's own follow-ups to a skip (agentClient.holdSkip): the skip is
    // finished only once they are done, so /answer answers them in it.
    const held = new Set();
    // Use API key on a skip sends the rest of that skip on too.
    let skipPassedOn = false;
    // What is waiting on the Agent right now, for the page to show: one
    // record per call, with the kind it is and how to pass it on.
    const waiting = new Set();
    const listeners = new Set();
    const tell = () => {
        for (const listener of [...listeners]) {
            try { listener(); } catch { /* a listener must never cost a request */ }
        }
    };

    const call = async (method, route, body, signal) => {
        const response = await send(route, {
            method,
            headers: body === undefined ? undefined : { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });
        const json = await response.json().catch(() => ({}));
        return { status: response.status, ok: response.ok, json };
    };

    const currentSkip = () => {
        if (!skip) {
            const id = newSkipId();
            skip = { id, opened: call("POST", "/api/agent/skips", { skipId: id }) };
        }
        return skip;
    };

    return {
        // A page that loads afresh: nothing an earlier page started is running.
        async dropStaleSkips() {
            await call("DELETE", "/api/agent/skips").catch(() => {});
        },

        // A follow-up the game asks as a skip lands (the first stat-sheet
        // reading): the skip stays open until it is done.
        holdSkip(work) {
            const promise = Promise.resolve(work).catch(() => {});
            held.add(promise);
            void promise.finally(() => held.delete(promise));
            return work;
        },

        // The game has stopped simulating and the skip's follow-ups are done:
        // the skip is finished, and the Agent's `/answer` stops waiting for it.
        // The next skip starts on the Agent again.
        async finishSkip() {
            while (held.size) await Promise.all([...held]);
            const finished = skip;
            skip = null;
            skipPassedOn = false;
            if (!finished) return;
            await finished.opened.catch(() => {});
            await call("DELETE", `/api/agent/skips/${encodeURIComponent(finished.id)}`).catch(() => {});
        },

        // How many calls of each kind wait on the Agent: { skip: 1, advisor: 2 }.
        waits() {
            const counts = {};
            for (const entry of waiting) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
            return counts;
        },
        subscribeWaits(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },

        // Use API key: the waiting calls of these kinds go on to the next entry.
        passOn(kinds) {
            const chosen = new Set(kinds);
            if (chosen.has("skip") && skip) skipPassedOn = true;
            for (const entry of waiting) if (chosen.has(entry.kind)) entry.passOn();
        },
        // Cancel: the waiting calls of these kinds end as cancelled.
        cancel(kinds) {
            const chosen = new Set(kinds);
            for (const entry of waiting) if (chosen.has(entry.kind)) entry.cancel();
        },
        // Whether the rest of the running skip goes past the Agent (main.jsx).
        skipPassedOn() {
            return skipPassedOn;
        },

        // `agentKind` says what the player started (providerConfig.js
        // AGENT_KINDS); a time skip's calls say it with their `spender`, which
        // also names the task for the Agent. A skip's calls queue under the
        // skip; a chat's under none. `onAgentWait` says the call now waits on
        // the player. `agentLookups`: the task's lookup functions ({ tools,
        // execute }); the Agent may call them while it answers, the game
        // answers each from here, and none is a request of the skip.
        async call(systemPrompt, history, opts = {}) {
            const { signal, tool, spender, taskKey, agentKind, onSend, onActivity, onAgentWait, onToolStream, onReceived, agentLookups = null } = opts;
            const kind = agentKind || "skip";
            const lookupTools = Array.isArray(agentLookups?.tools) && typeof agentLookups?.execute === "function"
                ? agentLookups.tools.filter((entry) => entry?.name && entry?.schema)
                    .map(({ name, description = "", schema }) => ({ name, description, schema }))
                : [];
            if (signal?.aborted) throw abortReason(signal);
            const { system, prompt } = buildAgentPrompt(systemPrompt, history, { tool });
            let skipId;
            if (kind === "skip") {
                const open = currentSkip();
                await open.opened;
                skipId = open.id;
            }
            const queued = await call("POST", "/api/agent/requests", {
                // The Agent sees the task (a skip's, its follow-up's) or what the player started.
                ...(skipId ? { skipId } : {}), task: String(kind === "skip" ? (spender || taskKey || "") : agentKind), system, prompt,
                ...(lookupTools.length ? { lookupTools } : {}),
            }, signal);
            if (!queued.ok || !queued.json?.id) throw new Error(queued.json?.error || "The Agent queue did not take the request.");
            const id = queued.json.id;
            onSend?.();
            onAgentWait?.();
            // The player's Cancel arrives on `signal`; their Use API key on this one.
            const passed = new AbortController();
            const stop = signal ? AbortSignal.any([signal, passed.signal]) : passed.signal;
            const record = {
                kind,
                passOn: () => passed.abort(passedOnError()),
                cancel: () => passed.abort(cancelledError()),
            };
            waiting.add(record);
            tell();
            const cancel = () => { void call("DELETE", `/api/agent/requests/${encodeURIComponent(id)}`).catch(() => {}); };
            try {
                for (;;) {
                    if (stop.aborted) throw stop.reason;
                    const polled = await call("GET", `/api/agent/requests/${encodeURIComponent(id)}?waitMs=${pollMs}`, undefined, stop);
                    if (polled.status === 404) throw new Error(AGENT_GONE_MESSAGE);
                    const { state, answer, lookups: asked } = polled.json ?? {};
                    for (const question of Array.isArray(asked) ? asked : []) {
                        // As a provider's lookup round answers it (toolTurns.js
                        // answerLookupCalls): an error is the answer, and a bare
                        // value is wrapped.
                        let result;
                        try {
                            result = await agentLookups.execute(question.name, question.args ?? {});
                        } catch (error) {
                            result = { error: String(error?.message || error) };
                        }
                        if (result == null || typeof result !== "object" || Array.isArray(result)) result = { result: result ?? null };
                        logDebugEvent("ai-call", `Agent lookup: ${question.name}.`, { args: question.args, response: result }, { verbose: true });
                        await call("POST", `/api/agent/requests/${encodeURIComponent(id)}/lookups/${encodeURIComponent(question.callId)}`, { result: result ?? null }, stop);
                    }
                    if (state === "answered") {
                        const rawText = String(answer ?? "");
                        onReceived?.({ answerChars: rawText.length });
                        if (tool?.name && typeof onToolStream === "function") onToolStream({ name: tool.name, json: rawText });
                        // A task's answer, or a chat's reply as the text it is.
                        return tool ? { rawText, toolInput: null } : rawText;
                    }
                    if (state === "cancelled") throw signal?.aborted ? abortReason(signal) : new DOMException("The request was cancelled in the Agent queue.", "AbortError");
                    // Still waiting on the player: life, not silence.
                    onActivity?.();
                }
            } catch (error) {
                if (passed.signal.aborted && !signal?.aborted) {
                    cancel();
                    throw passed.signal.reason;
                }
                if (signal?.aborted || error?.name === "AbortError") {
                    cancel();
                    throw signal?.aborted ? abortReason(signal) : error;
                }
                throw error;
            } finally {
                waiting.delete(record);
                tell();
            }
        },
    };
};

// The one the game uses.
export const agentClient = createAgentClient();

// Where the Agent folder is, and opening it in the system's file manager. The
// game opens a folder; it never starts an Agent.
export const readAgentFolder = async () => {
    const response = await fetch("/api/agent/folder");
    if (!response.ok) throw new Error("The Agent folder is only on the desktop app.");
    return String((await response.json())?.path ?? "");
};

export const openAgentFolder = async () => {
    const response = await fetch("/api/agent/folder/open", { method: "POST" });
    return response.ok;
};
