/*! Open Historia — reports: documents in their own voice, held by the governments that have them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An event is public: everyone reads the timeline. A secret pact, an
// intelligence assessment, a letter between two heads of state, the full
// text of a treaty — these are DOCUMENTS, and a document is held by the
// governments it was addressed to. world.reports keeps them:
//
//   { id, title, body, visibleTo, from, interceptedBy, sourceEventId,
//     createdRound, createdDate, dateline, origin }
//
// visibleTo is a list of polity names, or null for a public document (a
// published treaty, a communiqué). `from` is the polity whose document it is —
// who wrote or sent it — when the model says. `interceptedBy` lists the
// services that stole a copy through an agent; only the narrator is told.
//
// The file is the backend: nothing shows it to the player as a list. A document
// reaches the player the way it would reach a government (runtime/
// reportDelivery.js) — a letter in the thread with its sender, a stolen secret
// in the Spies tab, a published text or the player's own paper on the event
// that produced it. The narrator (the simulation) sees every report; a viewer
// sees those addressed to a polity it speaks for (AI/audience.js
// audienceSeesScoped) — the player's advisor, a leader in a chat.
//
// Reports arrive on events, as impacts (impacts.reports): `create` writes one,
// `share` widens who holds it. They never move the map: anything that changed
// the world is observable and belongs in the event's public text. A report
// costs no request of its own — it rides in the answer that wrote the event.
//
// DELIBERATELY IMPORT-FREE, like projects.js: the rules on plain data, tested
// on their own. The caller hands in how a polity name is canonicalised.

export const REPORTS_LIMIT = 240;
export const REPORT_BODY_MAX_CHARS = 6000;
export const REPORT_TITLE_MAX_CHARS = 160;
export const REPORT_OPS = Object.freeze(["create", "share"]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const fold = (value) => asText(value).toLowerCase();

const nameList = (value) => {
    const seen = new Set();
    const names = [];
    for (const entry of asArray(value)) {
        const name = asText(typeof entry === "object" && entry ? entry.name ?? entry.code : entry);
        if (!name || seen.has(fold(name))) continue;
        seen.add(fold(name));
        names.push(name);
    }
    return names;
};

let sequence = 0;
const mintId = (prefix) => {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
};

// One stored document. `visibleTo` empty in storage is read as public (null):
// a document that no government holds is one the world never wrote.
export const normalizeReportEntry = (entry, index = 0) => {
    if (!entry || typeof entry !== "object") return null;
    const title = clip(asText(entry.title), REPORT_TITLE_MAX_CHARS);
    const body = clip(String(entry.body ?? "").replace(/\r\n/g, "\n").trim(), REPORT_BODY_MAX_CHARS);
    if (!title || !body) return null;
    const visibleTo = entry.visibleTo === null || entry.visibleTo === undefined ? null : nameList(entry.visibleTo);
    const from = asText(entry.from);
    const interceptedBy = nameList(entry.interceptedBy);
    // holder -> the holder who handed them their copy (a share's `from`).
    const receivedFrom = Object.fromEntries(Object.entries(entry.receivedFrom && typeof entry.receivedFrom === "object" ? entry.receivedFrom : {})
        .map(([holder, giver]) => [asText(holder), asText(giver)])
        .filter(([holder, giver]) => holder && giver));
    return {
        id: asText(entry.id) || `report-${index + 1}`,
        title,
        body,
        visibleTo: visibleTo && visibleTo.length ? visibleTo : null,
        ...(from ? { from } : {}),
        ...(interceptedBy.length ? { interceptedBy } : {}),
        ...(Object.keys(receivedFrom).length ? { receivedFrom } : {}),
        sourceEventId: asText(entry.sourceEventId),
        createdRound: Math.max(0, Math.round(Number(entry.createdRound) || 0)),
        createdDate: asText(entry.createdDate),
        dateline: asText(entry.dateline),
        origin: asText(entry.origin) || "ai",
    };
};

export const normalizeReports = (reports) => {
    const seen = new Set();
    const list = [];
    asArray(reports).forEach((entry, index) => {
        const report = normalizeReportEntry(entry, index);
        if (!report || seen.has(report.id)) return;
        seen.add(report.id);
        list.push(report);
    });
    return list.slice(-REPORTS_LIMIT);
};

// One operation as the model writes it. A create with nothing to say is not a
// report; a share of nothing widens nothing.
export const normalizeReportOp = (entry) => {
    if (!entry || typeof entry !== "object") return null;
    const op = fold(entry.op || entry.operation || (entry.title || entry.body ? "create" : ""));
    if (op === "create") {
        const title = clip(asText(entry.title), REPORT_TITLE_MAX_CHARS);
        const body = clip(String(entry.body ?? entry.text ?? "").replace(/\r\n/g, "\n").trim(), REPORT_BODY_MAX_CHARS);
        if (!title || !body) return null;
        const from = asText(entry.from || entry.author || entry.sender);
        return {
            op: "create",
            reportId: asText(entry.reportId || entry.id),
            title,
            body,
            visibleTo: nameList(entry.visibleTo ?? entry.recipients ?? entry.holders),
            ...(from ? { from } : {}),
            dateline: asText(entry.dateline || entry.date),
        };
    }
    if (op === "share" || op === "update") {
        const reportId = asText(entry.reportId || entry.id);
        const visibleTo = nameList(entry.visibleTo ?? entry.addVisibleTo ?? entry.recipients ?? entry.holders);
        if (!reportId || !visibleTo.length) return null;
        const from = asText(entry.from || entry.sharedBy || entry.sender);
        return { op: "share", reportId, visibleTo, ...(from ? { from } : {}) };
    }
    return null;
};

// A report is found by its id, or by its exact title when the model wrote the
// title it can see in [Reports on File] instead of the id.
const findReport = (reports, key) => {
    const wanted = fold(key);
    if (!wanted) return null;
    return reports.find((report) => fold(report.id) === wanted) ?? reports.find((report) => fold(report.title) === wanted) ?? null;
};

// Apply a batch to the list (pure). `resolvePolity(name)` returns the
// canonical name of a polity the world knows, or "" — a recipient the world
// does not know is dropped from the distribution and reported; a create left
// with no known recipient when it named some is refused rather than written to
// nobody. `visibleTo` empty on a create means public.
export const applyReportOps = (reports, ops, { eventId = "", date = "", round = 0, resolvePolity = null } = {}) => {
    let next = normalizeReports(reports);
    const created = [];
    const shared = [];
    const rejected = [];
    const resolve = typeof resolvePolity === "function" ? resolvePolity : (name) => asText(name);
    const distribution = (names) => {
        const known = [];
        const unknown = [];
        for (const name of nameList(names)) {
            const canonical = asText(resolve(name));
            if (canonical) { if (!known.some((entry) => fold(entry) === fold(canonical))) known.push(canonical); } else unknown.push(name);
        }
        return { known, unknown };
    };
    for (const raw of asArray(ops)) {
        const op = normalizeReportOp(raw);
        if (!op) { rejected.push({ op: raw, reason: "not a report operation" }); continue; }
        if (op.op === "create") {
            const { known, unknown } = distribution(op.visibleTo);
            if (op.visibleTo.length && !known.length) {
                rejected.push({ op, reason: `none of its holders is a polity on this map (${unknown.join(", ")})` });
                continue;
            }
            const existing = op.reportId ? findReport(next, op.reportId) : null;
            const id = existing ? mintId("report") : (op.reportId || mintId("report"));
            // Who sent it, when the model says and the world knows them; a
            // sender it cannot place is simply not recorded.
            const from = op.from ? asText(resolve(op.from)) : "";
            const report = normalizeReportEntry({
                id,
                title: op.title,
                body: op.body,
                visibleTo: op.visibleTo.length ? known : null,
                from,
                sourceEventId: eventId,
                createdRound: round,
                createdDate: date,
                dateline: op.dateline || date,
                origin: "ai",
            });
            if (!report) { rejected.push({ op, reason: "empty" }); continue; }
            next = [...next, report].slice(-REPORTS_LIMIT);
            created.push({ report, unknown });
            continue;
        }
        const target = findReport(next, op.reportId);
        if (!target) { rejected.push({ op, reason: `no report is called "${op.reportId}"` }); continue; }
        const { known, unknown } = distribution(op.visibleTo);
        if (!known.length) { rejected.push({ op, reason: `none of the new holders is a polity on this map (${unknown.join(", ")})` }); continue; }
        // Widening only: a public document stays public, a held one gains holders.
        const newHolders = target.visibleTo === null ? [] : known.filter((name) => !target.visibleTo.some((entry) => fold(entry) === fold(name)));
        const visibleTo = target.visibleTo === null ? null : [...target.visibleTo, ...newHolders];
        // Who handed it over, when a holder did: it is how the copy reaches its
        // new holder (reportDelivery.js). A giver who never held it is not one.
        const giver = op.from ? asText(resolve(op.from)) : "";
        const handedOver = giver && target.visibleTo?.some((entry) => fold(entry) === fold(giver))
            ? Object.fromEntries(newHolders.map((name) => [name, giver]))
            : {};
        const receivedFrom = { ...(target.receivedFrom ?? {}), ...handedOver };
        next = next.map((report) => (report.id === target.id
            ? { ...report, visibleTo, ...(Object.keys(receivedFrom).length ? { receivedFrom } : {}) }
            : report));
        shared.push({ report: next.find((report) => report.id === target.id), added: known, unknown });
    }
    return { reports: next, created, shared, rejected };
};

// The reports one audience may read, newest first. `sees(visibleTo)` is the
// audience rule (audienceSeesScoped bound to the audience).
export const reportsFor = (reports, sees) => {
    const list = normalizeReports(reports);
    const allowed = typeof sees === "function" ? list.filter((report) => sees(report.visibleTo)) : list;
    return [...allowed].reverse();
};

// What a prompt is shown of the reports on file: one line each, newest first,
// bounded, so the simulator can widen one it can name and never contradicts
// one it wrote. `sees` scopes it to the audience; the narrator sees all.
//
// Who stole a copy is the narrator's alone: with `sees` set (a viewer) it is
// never shown — a holder must not learn from its own file that it was read.
export const describeReportsForPrompt = (reports, { sees = null, limit = 12, bodyChars = 160, heading = "[Reports on File]" } = {}) => {
    const list = reportsFor(reports, sees).slice(0, limit);
    if (!list.length) return "";
    const narrator = typeof sees !== "function";
    const lines = list.map((report) => {
        const holders = report.visibleTo === null ? "public" : `held by ${report.visibleTo.join(", ")}`;
        const sender = report.from ? ` · from ${report.from}` : "";
        const stolen = narrator && report.interceptedBy?.length ? ` · a copy stolen by ${report.interceptedBy.join(", ")}` : "";
        const body = clip(report.body.replace(/\s+/g, " "), bodyChars);
        return `- ${report.id} · "${report.title}"${report.dateline ? ` (${report.dateline})` : ""} · ${holders}${sender}${stolen}: ${body}`;
    });
    return `${heading}\n${lines.join("\n")}`;
};
