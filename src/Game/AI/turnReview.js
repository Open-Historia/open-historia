/*! Open Historia — the turn review: every check after a time skip, in one request © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// After a time skip the game used to make a separate request for each thing it
// checks: one to move the units the events talk about, one to mark occupied and
// disputed land, one to take repeats and filler off the timeline, one to move
// the Projects board, and one per deployed agent for its report. Five jobs, five
// or more requests, on a key that may allow a few hundred a day
// (requestBudget.js).
//
// The jobs do not depend on each other's ANSWERS, only on the same events. So
// they go out together: one request whose prompt is the jobs' own prompts, each
// complete and fenced off from the others, and whose answer is one object with
// a field per job. Each field is then checked and used exactly as that job's
// own request would have been — by the same schema, the same native rules — and
// a job whose field is missing or malformed fails open by itself (the units
// stay where the simulator put them, every event is kept, the board does not
// move) without costing the others theirs.
//
// This file is the part of that which is plain text and data: putting the jobs
// into one prompt and one output function, taking the answer apart, and moving
// the board's event numbers from the list the review was shown to the list the
// turn ended up with. gameplay.js decides which jobs a skip needs, and runs it.
//
// DELIBERATELY IMPORT-FREE.

export const TURN_REVIEW_TASK = "turnReview";
export const TURN_REVIEW_TOOL_NAME = "submit_turn_review";

const asText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// A job's field in the answer: a plain identifier, because it is a property name
// in a tool schema and every provider is strict about those.
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

// job: { key, title, prompt, instruction, schema }
//   key         the field its answer comes back in
//   title       two or three words, for the fence and the log
//   prompt      the system prompt that job's own request would have carried
//   instruction the user message it would have carried
//   schema      the output schema it would have answered with
export const normalizeReviewJobs = (jobs) => {
    const seen = new Set();
    const kept = [];
    for (const job of asArray(jobs)) {
        const key = asText(job?.key);
        if (!FIELD_PATTERN.test(key) || seen.has(key)) continue;
        if (!job?.schema || typeof job.schema !== "object" || !asText(job?.prompt)) continue;
        seen.add(key);
        kept.push({
            key,
            title: asText(job.title) || key,
            prompt: asText(job.prompt),
            instruction: asText(job.instruction),
            schema: job.schema,
        });
    }
    return kept;
};

// --- Text several jobs share ---
//
// Jobs are rendered from their own templates, and some of those carry the same
// long material: the scenario's simulation rules, the world snapshot, the recent
// events. Three agents' reports would send all three of those three times. The
// first job to carry a block keeps it; a later job gets a pointer to it, which
// is safe exactly because the text is identical — nothing is summarised.
//
// `blocks` are the long values the jobs were rendered from (the caller has
// them: they are template variables). Only a block that is really in two jobs,
// verbatim, is touched. Longest first, so a block inside a larger shared block
// is handled as part of it.
export const SHARED_BLOCK_MIN_CHARS = 1500;

export const shareRepeatedBlocks = (jobs, blocks, { minChars = SHARED_BLOCK_MIN_CHARS } = {}) => {
    const list = asArray(jobs).map((job) => ({ ...job, prompt: String(job?.prompt ?? "") }));
    const candidates = [...new Set(asArray(blocks).map((block) => String(block ?? "").trim()).filter((block) => block.length >= minChars))]
        .sort((a, b) => b.length - a.length);
    let saved = 0;
    for (const block of candidates) {
        const first = list.findIndex((job) => job.prompt.includes(block));
        if (first < 0) continue;
        const opening = block.slice(0, 70).replace(/\s+/g, " ").trim();
        const pointer = `[The same text as in job "${asText(list[first].key)}" above — the passage that begins "${opening}…". It applies to this job unchanged; read it there.]`;
        for (let index = first + 1; index < list.length; index += 1) {
            if (!list[index].prompt.includes(block)) continue;
            const before = list[index].prompt.length;
            list[index].prompt = list[index].prompt.split(block).join(pointer);
            saved += before - list[index].prompt.length;
        }
    }
    return { jobs: list, savedChars: saved };
};

const fence = (job, edge) => `########## ${edge} OF JOB "${job.key}" — ${job.title.toUpperCase()} ##########`;

// The rules that make several jobs in one prompt safe: each job's text is
// complete and applies to that job alone, and only the one output function
// carries answers. The jobs' own templates end with lines like "Return JSON
// only" or "Use the required tool" — written for a request of their own — so the
// preamble says what those mean here rather than leaving two instructions to
// disagree.
const preamble = (jobs) => [
    "[ONE ANSWER, SEVERAL SEPARATE JOBS]",
    `A period of the simulation has just been written. Before it is saved, ${jobs.length === 1 ? "one bookkeeping job has" : `${jobs.length} separate bookkeeping jobs have`} to be done on it. `
        + `You will do ${jobs.length === 1 ? "it" : "all of them"} in this one answer, by calling ${TURN_REVIEW_TOOL_NAME} once.`,
    "",
    "How to read what follows:",
    "- Each job is fenced between a BEGINNING line and an END line. Everything inside a fence — the role it gives you, its inputs, its rules, its numbering of events — belongs to THAT job and no other. Two jobs may number the same events differently; never carry an index, a rule or a verdict from one job into another.",
    "- Do each job exactly as if its fenced text were the only thing you had been sent. The jobs do not vote on each other: an event one job would remove is still an event the other jobs account for.",
    `- Each job's answer goes in its own field of ${TURN_REVIEW_TOOL_NAME}, named on its fence. Where a job's text tells you to return JSON, to use "the required tool", or shows an output format, that describes the CONTENT of its field — the one call to ${TURN_REVIEW_TOOL_NAME} carries every job's answer.`,
    "- A job with nothing to report still gets its field, with the empty answer its own text describes. Never leave a field out, and never pad one to look busy: for every one of these jobs, changing nothing is a normal and correct answer.",
    "",
    `The jobs, in order: ${jobs.map((job) => `${job.key} (${job.title})`).join("; ")}.`,
].join("\n");

export const buildTurnReviewPrompt = (jobs) => {
    const list = normalizeReviewJobs(jobs);
    if (!list.length) return "";
    const blocks = list.map((job) => [
        fence(job, "BEGINNING"),
        job.prompt,
        ...(job.instruction ? ["", `[YOUR INSTRUCTION FOR THIS JOB]\n${job.instruction}`] : []),
        "",
        `[WHERE THIS JOB'S ANSWER GOES]\nThe "${job.key}" field of ${TURN_REVIEW_TOOL_NAME}.`,
        fence(job, "END"),
    ].join("\n"));
    return [preamble(list), ...blocks].join("\n\n");
};

export const buildTurnReviewTool = (jobs) => {
    const list = normalizeReviewJobs(jobs);
    return {
        name: TURN_REVIEW_TOOL_NAME,
        description: `Submit the answer to every job of the turn review, one field per job: ${list.map((job) => job.key).join(", ")}.`,
        schema: {
            type: "object",
            description: "One field per job. Each field is that job's complete answer, in the shape that job's own text describes.",
            properties: Object.fromEntries(list.map((job) => [job.key, job.schema])),
            required: list.map((job) => job.key),
            additionalProperties: false,
        },
    };
};

// A model that was told to "return JSON" inside a job sometimes puts that job's
// answer in as a JSON STRING. That is the answer, one JSON.parse away.
const unwrap = (value) => {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return value;
    try {
        return JSON.parse(text);
    } catch {
        return value;
    }
};

// The answer, taken apart: { [key]: that job's part, or undefined when absent }.
// Nothing is validated here — each part goes to its own job's schema next.
export const readTurnReviewAnswer = (jobs, answer) => {
    const list = normalizeReviewJobs(jobs);
    const source = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
    const parts = {};
    for (const job of list) {
        const part = unwrap(source[job.key]);
        parts[job.key] = part && typeof part === "object" && !Array.isArray(part) ? part : undefined;
    }
    return parts;
};

// --- The board's event numbers ---
//
// The board job is shown the events as the skip WROTE them: the candidates, then
// the events an earlier screen already kept off the timeline. Its ops say which
// event caused them by number in that list. But the ops are applied after the
// timeline job's verdicts, when the list has changed: a candidate may have been
// kept (it is on the timeline, under a new permanent id), taken off the timeline
// but still true (it is now a Hidden event), or withheld altogether (a repeat or
// a contradiction — it never happened, and nothing may be recorded from it).
//
// remapBoardOps moves each op's eventIndex from the list the job saw to the list
// the turn ended with — visible events, then Hidden ones, which is the numbering
// the board's own machinery expects (projects.js boardPassCarriers). An op whose
// event was withheld is dropped and counted. An op that named no event keeps
// naming none.
const eventKey = (event) => {
    const id = asText(event?.id);
    return id ? `id:${id}` : `at:${asText(event?.date)}|${asText(event?.title).toLowerCase()}`;
};

export const remapBoardOps = ({ ops, shownEvents, visibleEvents, hiddenEvents, idMap = null } = {}) => {
    const shown = asArray(shownEvents);
    const visible = asArray(visibleEvents);
    const hidden = asArray(hiddenEvents);
    // A kept candidate is renamed to its permanent id on the way to the timeline;
    // idMap is old id -> new id.
    const renamed = (event) => {
        const id = asText(event?.id);
        const next = id && idMap && typeof idMap.get === "function" ? asText(idMap.get(id)) : "";
        return next ? `id:${next}` : "";
    };
    const where = new Map();
    visible.forEach((event, index) => where.set(eventKey(event), index));
    hidden.forEach((event, index) => {
        const key = eventKey(event);
        if (!where.has(key)) where.set(key, visible.length + index);
    });
    const textKey = (event) => `at:${asText(event?.date)}|${asText(event?.title).toLowerCase()}`;
    const byText = new Map();
    visible.forEach((event, index) => { if (!byText.has(textKey(event))) byText.set(textKey(event), index); });
    hidden.forEach((event, index) => { if (!byText.has(textKey(event))) byText.set(textKey(event), visible.length + index); });

    const kept = [];
    let dropped = 0;
    for (const op of asArray(ops)) {
        if (!op || typeof op !== "object") continue;
        const raw = Number(op.eventIndex);
        if (!Number.isInteger(raw) || raw < 0 || raw >= shown.length) {
            // Named no usable event: the board's own fallback decides where it rides.
            const { eventIndex: _unused, ...rest } = op;
            kept.push(rest);
            continue;
        }
        const event = shown[raw];
        const target = [renamed(event), eventKey(event)].map((key) => (key ? where.get(key) : undefined)).find((index) => index !== undefined)
            ?? byText.get(textKey(event));
        if (target === undefined) {
            dropped += 1;
            continue;
        }
        kept.push({ ...op, eventIndex: target });
    }
    return { ops: kept, dropped };
};

// ---- A review that did not come back ------------------------------------------
//
// A job that fails open by itself is the design above, and a time skip no
// longer lands a turn that way without telling the player: the review's
// failure holds the turn (turnChecks.js, gameplay.js finishTimelineJump).
//
// review: what gameplay.js runTurnReview returns —
//   asked    false when nothing needed checking, so no request was made
//   failure  the error, when the request itself failed (timeout, 503, no answer)
//   missing  the keys of the jobs asked whose part was absent or unusable
//
// Every job asked has a required field (buildTurnReviewTool), so a job with
// nothing to change answers with an empty list, which is usable. A missing
// part is a broken answer, never a quiet one.

// Why the review failed, or "" when it did not.
export const reviewFailure = (review) => {
  if (!review?.asked) return "";
  if (review.failure) return asText(review.failure.message) || "the request failed";
  const missing = asArray(review.missing).map(asText).filter(Boolean);
  return missing.length ? `no usable answer for ${missing.join(", ")}` : "";
};
