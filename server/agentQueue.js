/*! Open Historia — the Agent queue © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The requests an Agent Connection is waiting on, held by the local server until
// the player's Agent answers them through the game's MCP server
// (docs/adr/0008-subscription-agents-answer-through-the-game.md).
//
// In memory only: a restart drops it, as a reload drops a skip waiting on an
// API. It holds what the player started: a time skip's requests, under the
// skip, and the chats they sent (the advisor, diplomacy, the Game Master,
// interactive events), under none. One time skip is open at a time; opening
// the next cancels what the last left waiting. A page that loads afresh drops
// everything (dropAll).
//
// A request's prompt is a file in the Agent folder, not a tool result: a skip
// prompt is far larger than an Agent's limit on one MCP result. The file is
// deleted as soon as the request is answered or cancelled.
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const NOTHING_WAITING = "Nothing is waiting.";
export const SKIP_STILL_RUNNING = "The time skip is still running. Call list_requests again.";
export const LOOKUP_NOT_ANSWERED = "The game did not answer that lookup in time. Ask it again.";
export const NOT_WAITING = "That request is not waiting for an answer.";

const settle = (waiters) => {
  for (const wake of waiters.splice(0)) wake();
};

// Resolves when `wake` is called or `ms` has passed, whichever is first.
const sleepUntilWoken = (waiters, ms) =>
  new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      const at = waiters.indexOf(wake);
      if (at >= 0) waiters.splice(at, 1);
      resolve();
    }, Math.max(0, ms));
    waiters.push(wake);
  });

// `folder`: the Agent folder's requests directory. `waitMs`: how long one
// "what next?" from the Agent may wait before it is told to ask again; an
// Agent gives up on a tool call held open much longer. `log(event, data)`:
// the Diagnostics log.
// The longest any wait on the queue is held open, by the Agent or the game.
export const AGENT_WAIT_MS = 30000;

// How long after an answer `/answer` still waits for the game's follow-up to it
// (the demand check after a diplomatic reply, an interactive scene's summary),
// which the game can only ask once the answer has landed.
export const AGENT_FOLLOW_UP_MS = 5000;

export const createAgentQueue = ({ folder, waitMs = AGENT_WAIT_MS, followUpMs = AGENT_FOLLOW_UP_MS, log = () => {} }) => {
  const requests = new Map();
  let openSkip = null;
  let lastAnsweredAt = 0;
  // Woken whenever anything changes: a request queued, answered or cancelled,
  // a skip opened or finished.
  const waiters = [];

  const removeFiles = (request) => {
    fs.rmSync(request.dir, { recursive: true, force: true });
  };

  const close = (request, state, answer) => {
    if (request.state !== "waiting") return false;
    request.state = state;
    if (state === "answered") lastAnsweredAt = Date.now();
    if (answer !== undefined) request.answer = answer;
    removeFiles(request);
    log(`agent.${state}`, { id: request.id, task: request.task, skipId: request.skipId });
    settle(waiters);
    return true;
  };

  const cancelSkip = (skipId) => {
    for (const request of requests.values()) {
      if (request.skipId === skipId) close(request, "cancelled");
    }
  };

  const unread = () => [...requests.values()].filter((request) => request.state === "waiting" && !request.read);

  return {
    openSkip(skipId) {
      const id = String(skipId || crypto.randomUUID());
      if (openSkip && openSkip !== id) cancelSkip(openSkip);
      openSkip = id;
      log("agent.skip-open", { skipId: id });
      settle(waiters);
      return id;
    },

    finishSkip(skipId) {
      const id = String(skipId);
      cancelSkip(id);
      if (openSkip === id) openSkip = null;
      log("agent.skip-finished", { skipId: id });
      settle(waiters);
    },

    // A page that loads afresh: nothing an earlier page started is running.
    dropAll() {
      for (const request of requests.values()) close(request, "cancelled");
      if (openSkip) this.finishSkip(openSkip);
    },

    // `system` and `prompt` are the finished prompt the game built, written to
    // the request's prompt file as they are. `lookupTools`: the lookup
    // functions the Agent may call while it answers ({ name, description,
    // schema }), answered by the game itself (lookup below).
    ask({ skipId, task, system, prompt, lookupTools = [] }) {
      const id = crypto.randomUUID();
      const dir = path.join(folder, id);
      fs.mkdirSync(dir, { recursive: true });
      const promptFile = path.join(dir, "prompt.md");
      const answerFile = path.join(dir, "answer.md");
      const text = [system ? `# Instructions\n\n${system}` : "", `# Request\n\n${prompt || ""}`].filter(Boolean).join("\n\n");
      fs.writeFileSync(promptFile, `${text}\n`, "utf8");
      const offered = (Array.isArray(lookupTools) ? lookupTools : [])
        .filter((tool) => tool && typeof tool.name === "string" && tool.name)
        .map(({ name, description = "", schema = { type: "object" } }) => ({ name, description: String(description), schema }));
      const request = {
        id, skipId: String(skipId || ""), task: String(task || ""), dir, promptFile, answerFile,
        state: "waiting", read: false, lookupTools: offered, lookups: new Map(),
      };
      requests.set(id, request);
      log("agent.queued", { id, task: request.task, skipId: request.skipId });
      settle(waiters);
      return request;
    },

    // The game's wait for one request: what it is now, or once it changes,
    // within `ms`. While it waits, the lookups the Agent has asked come with it,
    // each handed to the game once. Null for a request this run never held.
    async poll(id, ms = 0) {
      const request = requests.get(String(id));
      if (!request) return null;
      const asked = () => [...request.lookups.values()].filter((call) => !call.handed);
      const deadline = Date.now() + Math.max(0, Number(ms) || 0);
      while (request.state === "waiting" && !asked().length && Date.now() < deadline) {
        await sleepUntilWoken(waiters, deadline - Date.now());
      }
      if (request.state === "answered") return { state: "answered", answer: request.answer };
      if (request.state !== "waiting") return { state: request.state };
      const lookups = asked().map((call) => {
        call.handed = true;
        return { callId: call.callId, name: call.name, args: call.args };
      });
      return { state: "waiting", lookups };
    },

    // The Agent asks one of the request's lookups. The game answers it on its
    // next wait (answerLookup). Until the game has taken it, held up to
    // `waitMs`, then the Agent is told to ask again. Once taken it is held
    // until answered, however long that is: a lookup can be work (the troop
    // orders fight the period again) and answers once per skip, so one cut off
    // and asked again would never reach the Agent.
    async lookup(id, name, args = {}) {
      const request = requests.get(String(id));
      if (!request || request.state !== "waiting") return { ok: false, reason: NOT_WAITING };
      if (!request.lookupTools.some((tool) => tool.name === name)) return { ok: false, reason: `This request offers no lookup called ${name}.` };
      const call = { callId: crypto.randomUUID(), name, args: args && typeof args === "object" && !Array.isArray(args) ? args : {}, handed: false, answered: false, result: null };
      request.lookups.set(call.callId, call);
      log("agent.lookup", { id: request.id, name });
      settle(waiters);
      const deadline = Date.now() + waitMs;
      while (!call.answered && request.state === "waiting" && (call.handed || Date.now() < deadline)) {
        await sleepUntilWoken(waiters, call.handed ? waitMs : deadline - Date.now());
      }
      request.lookups.delete(call.callId);
      if (call.answered) return { ok: true, result: call.result };
      if (request.state !== "waiting") return { ok: false, reason: NOT_WAITING };
      return { ok: false, reason: LOOKUP_NOT_ANSWERED };
    },

    answerLookup(id, callId, result) {
      const call = requests.get(String(id))?.lookups.get(String(callId));
      if (!call || call.answered) return false;
      call.answered = true;
      call.result = result ?? null;
      settle(waiters);
      return true;
    },

    cancel(id) {
      const request = requests.get(String(id));
      return request ? close(request, "cancelled") : false;
    },

    // The Agent's "what next?". Waiting requests it has not read yet, oldest
    // first; while a skip is open with nothing to answer, waits for its next
    // one up to `waitMs` and then says "still running". With no skip open it
    // waits only for the follow-up to an answer it just gave (`followUpMs`),
    // then answers: it never waits for anything the player has not started.
    async list() {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const fresh = unread();
        if (fresh.length) return { status: "waiting", requests: fresh.map(({ id, task }) => ({ id, task })) };
        if (!openSkip) {
          const followUpEnds = lastAnsweredAt + followUpMs;
          if (Date.now() >= followUpEnds) return { status: "idle", message: NOTHING_WAITING };
          await sleepUntilWoken(waiters, Math.min(deadline, followUpEnds) - Date.now());
          continue;
        }
        if (Date.now() >= deadline) return { status: "running", message: SKIP_STILL_RUNNING };
        await sleepUntilWoken(waiters, deadline - Date.now());
      }
    },

    read(id) {
      const request = requests.get(String(id));
      if (!request || request.state !== "waiting") return null;
      if (!request.read) {
        request.read = true;
        log("agent.read", { id: request.id, task: request.task, skipId: request.skipId });
      }
      return request;
    },

    // `text`, or what the Agent left in the request's answer file. Refused,
    // with the reason, when the request is not waiting (answered, cancelled,
    // or never held) or the answer is missing or empty.
    answer(id, text) {
      const request = requests.get(String(id));
      if (!request || request.state !== "waiting") return { ok: false, reason: NOT_WAITING };
      let answer = typeof text === "string" ? text : null;
      if (answer === null) {
        try {
          answer = fs.readFileSync(request.answerFile, "utf8");
        } catch {
          return { ok: false, reason: "No answer was given: pass text, or write the answer to the request's answer file first." };
        }
      }
      if (!answer.trim()) return { ok: false, reason: "The answer is empty." };
      close(request, "answered", answer);
      return { ok: true };
    },
  };
};
