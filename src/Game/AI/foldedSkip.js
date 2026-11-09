/*! Open Historia — the folded time skip: the rules that need no game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// While requests are being saved a time skip is ONE request: its events carry
// their own consequences, the Projects board among them, and the agents'
// reports ride at the end of the same answer (gameplay.js, "The folded time
// skip", says why and what each of the old checks became).
//
// gameplay.js does the work, and cannot be loaded under bare node. These are
// the decisions in it that are pure, kept here so they can be tested: when a
// provider has refused the folded request as such, what an event is without
// the board ops written on it, which agent each report is for, and which
// riders a skip's function can carry (fitSkipRiders).
//
// Import-free.

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A request the provider would not take as it was sent: every response it gave
// was a refusal, and at least one of them a 400 or a 422. A rate limit (429) or
// a busy model (503) is not that, and neither is a request that was answered
// and whose answer was no good: asking those again with a smaller contract
// would change nothing.
//
// Nor is a call that ended on the connection, whatever its statuses:
// `transportFailure`, which the task runner reports for a server that could not
// be reached or a connection that closed while the answer was arriving. The
// statuses alone cannot tell. A call that gave way on something else first
// (the JSON-text form refused, a temperature refused: a 400 each) and then lost
// the connection has a 400 and no 2xx among them, exactly as a refused contract
// has. Asked again the old way it would spend a request to learn nothing about
// the contract, and if that request were answered every later skip of the
// session would be asked the old way, for a contract nobody refused. (An
// answer cut at the model's output limit needs no such word: it came with a
// 200.)
export const providerRefusedContract = (statuses, { transportFailure = false } = {}) => {
    if (transportFailure) return false;
    const list = asArray(statuses).map(Number).filter(Number.isFinite);
    return list.length > 0
        && !list.some((status) => status >= 200 && status < 300)
        && list.some((status) => status === 400 || status === 422);
};

// The board ops an event carries: objects only, in the order written.
export const boardOpsOf = (event) => asArray(event?.impacts?.projectOps).filter(isRecord);

// The same event without them. The board's ops are applied by the board's own
// pass, once; left on the event they would be applied a first time with the
// rest of its impacts. An event that carries none comes back as it is.
export const withoutBoardOps = (event) => {
    if (!isRecord(event?.impacts) || !("projectOps" in event.impacts)) return event;
    const { projectOps: _projectOps, ...impacts } = event.impacts;
    return { ...event, impacts };
};

// The board ops of a list of events, each naming its event by its position in
// that list: the numbering the board pass expects (turnReview.js remapBoardOps).
// `opsFor(event, index)` says what an event carried.
export const liftBoardOps = (shownEvents, opsFor) => asArray(shownEvents).flatMap((event, index) =>
    asArray(opsFor(event, index)).filter(isRecord).map((op) => ({ ...op, eventIndex: index })));

// Which agent each report in the answer is for.
//
// A report says so with `agent`, the key the prompt listed the agent under
// ("agent_1"). A model that wrote the country instead ("Russia", "the agent
// inside Russia") is still understood. A report that names nobody on the list
// is nobody's, and is left out; so is a second report for an agent that has
// one, since the first is the one written straight after the events. Each
// result is { job, report }, the report without its `agent` field, in the
// order of `jobs`.
export const assignAgentReports = (jobs, reports, { sameName = (left, right) => asText(left).toLowerCase() === asText(right).toLowerCase() } = {}) => {
    const filed = asArray(reports).filter(isRecord);
    const taken = new Set();
    const named = (report) => asText(report.agent).replace(/^.*\b(?:inside|in)\s+/i, "");
    const assigned = [];
    for (const job of asArray(jobs)) {
        const key = asText(job?.key).toLowerCase();
        if (!key) continue;
        let at = filed.findIndex((report, index) => !taken.has(index) && asText(report.agent).toLowerCase() === key);
        if (at < 0) at = filed.findIndex((report, index) => !taken.has(index) && named(report) && sameName(named(report), job?.name));
        if (at < 0) continue;
        taken.add(at);
        const { agent: _agent, ...report } = filed[at];
        assigned.push({ job, report });
    }
    return assigned;
};

// ---- What a folded skip can carry ------------------------------------------------
// A provider can refuse a function declaration for its size alone. Gemini took
// a skip's function at 30,489 characters (its own form, geminiSchema.js) and
// refused one at 32,672; the riders a skip adds to its lean contract (the
// board's ops on every event, the agents' reports, the history fold) are some
// 3,200 characters between them, on a contract that is 27,200 to 28,100 before
// them (a shared game's host sends more: the events' audience and the players'
// advice). So each skip weighs its function before it asks, against
// FOLDED_SKIP_SCHEMA_BUDGET, and leaves out what does not fit
// (foldedSkipSent.test.js builds every combination).
export const FOLDED_SKIP_SCHEMA_BUDGET = 30400;

// The riders a skip carries: { board, agentReports, history }, and which of
// them to leave out until the function fits under `ceiling`. `sizeOf(riders)`
// is the size of the function with those riders. Left out first:
//   - the history field when no fold is due: it has no job, and is offered
//     only so the function stays the same from turn to turn;
//   - then the history fold that IS due, and the agents' reports. Neither is
//     lost: a fold left out waits for the next skip, and so do the agents (the
//     ones left out are the longest silent next time: agentReports.js
//     agentsReportingWithSkip), who also report between turns as background
//     work (gameplay.js maybeGatherIntelligence). Whichever of the two was left
//     out last skip (`waited`) goes after the other, so neither waits twice
//     running for the other;
//   - the board last of all: its ops are the record of this skip's events,
//     and nothing writes them later. A skip without it has its board stand
//     still, as a skip that is not folded always had.
// Returns the riders kept, the names left out in the order they were, the
// size, and whether it fits at all (a lean contract over the ceiling does not).
export const fitSkipRiders = ({ wanted = {}, historyDue = false, sizeOf, ceiling = FOLDED_SKIP_SCHEMA_BUDGET, waited = [] } = {}) => {
    const riders = { board: Boolean(wanted.board), agentReports: Boolean(wanted.agentReports), history: Boolean(wanted.history) };
    const measure = typeof sizeOf === "function" ? () => Number(sizeOf({ ...riders })) || 0 : () => 0;
    const waiting = new Set(asArray(waited));
    const contested = (historyDue ? ["history", "agentReports"] : ["agentReports"])
        .sort((a, b) => Number(waiting.has(a)) - Number(waiting.has(b)));
    const order = [...(historyDue ? [] : ["history"]), ...contested, "board"];
    const leftOut = [];
    let chars = measure();
    for (const name of order) {
        if (chars <= ceiling) break;
        if (!riders[name]) continue;
        riders[name] = false;
        leftOut.push(name);
        chars = measure();
    }
    return { riders, leftOut, chars, fits: chars <= ceiling };
};

// The riders left out that had a job to do, which go after the others next
// skip (`waited` above): the agents' reports, and a history fold that was due.
export const ridersThatWaited = (leftOut, { historyDue = false } = {}) => asArray(leftOut)
    .filter((name) => name === "agentReports" || (name === "history" && historyDue));

// After a provider refused a folded skip's function, the ceiling the next skip
// fits its riders under: below the size that was refused, so it carries at
// least one rider fewer. Each refusal lowers it again, for the rest of the
// session; a skip whose riders all go is asked with the lean contract.
export const ceilingAfterRefusal = (ceiling, refusedChars) => {
    const current = Number.isFinite(Number(ceiling)) ? Number(ceiling) : FOLDED_SKIP_SCHEMA_BUDGET;
    const refused = Number(refusedChars);
    return Number.isFinite(refused) && refused > 0 ? Math.min(current, refused - 1) : current;
};
