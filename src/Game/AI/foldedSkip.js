/*! Open Historia — the folded time skip: the rules that need no game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// While requests are being saved a time skip is ONE request: its events carry
// their own consequences, the Projects board among them, and the agents'
// reports ride at the end of the same answer (gameplay.js, "The folded time
// skip", says why and what each of the old checks became).
//
// gameplay.js does the work, and cannot be loaded under bare node. These are
// the three decisions in it that are pure, kept here so they can be tested:
// when a provider has refused the folded request as such, what an event is
// without the board ops written on it, and which agent each report is for.
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
