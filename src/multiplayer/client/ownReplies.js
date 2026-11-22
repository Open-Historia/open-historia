/*! Open Historia — a player's own device answering for the AI's governments © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host of a shared game decides who answers a player's message to a
// government the AI plays (host/settings.js `replies`). With "own" it is the
// writer's own device, on the writer's own AI key: the host takes the line, and
// its ack says so, with the line's id and the governments that answer
// (host/gameHost.js "say"). This device then waits for its view to hold the
// line, asks its own model what those governments say (words alone:
// AI/gameplay.js writeTableReply) and sends the host the words as a "reply".
// No key is sent anywhere, to anyone.
//
// One answer at a time for each thread, kept here and not in the chat panel:
// the player may leave the thread while it is written, and finds it, or what
// went wrong with it, on coming back.
//
// Import-free: the game's own reader, writer and sender are passed in, so this
// is tested under bare node.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// What one "reply" may hold (game/messages.js REPLY_MAX_LINES, REPLY_MAX_CHARS).
export const OWN_REPLY_LINES_MAX = 8;
export const OWN_REPLY_CHARS_MAX = 6000;

// How long the view is waited on for the line the host took, before giving up.
export const OWN_REPLY_VIEW_MS = 20_000;
const VIEW_LOOK_EVERY_MS = 250;

// What the host's answer to a line said in `chat` asks of this device: null
// when the host's own computer answers (or nobody does), or the thread, the
// line and the governments this device is to answer for.
export const ownReplyAsked = (chat, answer) => {
  const result = answer?.ok ? answer.result : null;
  if (!result || result.answer !== "own") return null;
  const line = clean(result.line);
  // A thread this line opened is named in the answer; any other is the one written in.
  const thread = clean(result.chatId) || (chat?.pendingShared ? "" : clean(chat?.id));
  const governments = list(result.governments).map(clean).filter(Boolean);
  return line && thread && governments.length ? { thread, line, governments } : null;
};

// The words as the host takes them: a government's name and what it said, the
// first few lines of them, none longer than a line may be.
export const replyLinesForHost = (lines) => list(lines)
  .map((entry) => ({ speaker: clean(entry?.speaker), text: String(entry?.text ?? "").trim().slice(0, OWN_REPLY_CHARS_MAX).trim() }))
  .filter((entry) => entry.speaker && entry.text)
  .slice(0, OWN_REPLY_LINES_MAX);

// `readThread(threadId)` resolves the thread as this device's view holds it,
// or null. `write({ chat, text, governments, playerCountry })` resolves
// { lines: [{ speaker, text }], unreachable, reason, refused }.
// `send({ thread, line, lines })` resolves the host's { ok, error }.
//
// A thread's job: { thread, line, governments, text, playerCountry, status, why, error }
//   status "writing": this device is asking its model, or sending the words;
//   status "stopped": nothing was sent. `why` says which:
//     "unreachable" the model could not be reached;
//     "silent"      the model answered that nobody speaks;
//     "refused"     the host did not take the words (`error`: its reason);
//     "late"        the line never came back in this device's view;
//     "failed"      anything else (`error`).
export const createOwnReplies = ({
  readThread,
  write,
  send,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  log = () => {},
} = {}) => {
  const jobs = new Map();
  const listeners = new Set();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const put = (job) => {
    jobs.set(job.thread, job);
    changed();
  };
  const drop = (thread) => {
    if (jobs.delete(thread)) changed();
  };

  // The thread once this device's view holds the line the host took, so the
  // governments are shown what the player wrote.
  const threadHolding = async (job) => {
    const until = now() + OWN_REPLY_VIEW_MS;
    for (;;) {
      const chat = await readThread(job.thread).catch(() => null);
      if (list(chat?.messages).some((message) => clean(message?.id) === job.line)) return chat;
      if (now() >= until) return null;
      await wait(VIEW_LOOK_EVERY_MS);
    }
  };

  const run = async (asked) => {
    const job = { ...asked, status: "writing", why: "", error: "" };
    put(job);
    // Still this thread's answer: a newer line of the player's replaces it.
    const current = () => jobs.get(job.thread) === job;
    const stop = (why, error = "") => {
      if (!current()) return;
      log(`this device's reply for ${job.governments.join(", ")} stopped: ${why}${error ? ` (${error})` : ""}`, why);
      put({ ...job, status: "stopped", why, error: clean(error).slice(0, 300) });
    };
    try {
      const chat = await threadHolding(job);
      if (!current()) return;
      if (!chat) return stop("late");
      const reply = await write({ chat, text: job.text, governments: job.governments, playerCountry: job.playerCountry });
      if (!current()) return;
      if (reply?.unreachable) return stop("unreachable", reply.reason);
      const lines = replyLinesForHost(reply?.lines);
      if (!lines.length) return stop("silent", reply?.refused ? `${reply.refused} of the model's actions were refused` : "");
      const answer = await send({ thread: job.thread, line: job.line, lines });
      if (!current()) return;
      if (!answer?.ok) return stop("refused", answer?.error);
      // The governments' lines arrive in the next view, as any line does.
      drop(job.thread);
    } catch (error) {
      stop("failed", error?.message || error);
    }
    return undefined;
  };

  return {
    // Answer `line` of `thread` for `governments`: `text` is what the player wrote.
    start({ thread, line, governments, text = "", playerCountry = "" } = {}) {
      const job = { thread: clean(thread), line: clean(line), governments: list(governments).map(clean).filter(Boolean), text: String(text ?? ""), playerCountry: clean(playerCountry) };
      if (!job.thread || !job.line || !job.governments.length) return Promise.resolve();
      return run(job);
    },
    // The same line again, after an answer that stopped: no second copy of it
    // is said, and the host still holds it as waiting.
    retry(thread) {
      const job = jobs.get(clean(thread));
      if (!job || job.status === "writing") return Promise.resolve();
      const { status: _status, why: _why, error: _error, ...asked } = job;
      return run(asked);
    },
    dismiss: (thread) => drop(clean(thread)),
    get: (thread) => jobs.get(clean(thread)) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
