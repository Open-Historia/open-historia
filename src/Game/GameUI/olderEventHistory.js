/*! Open Historia - read-only historical event browsing. AGPL-3.0-or-later. */
import { compareGameDatesNewestFirst } from "../../runtime/gameDates.js";

export const OLDER_EVENT_PAGE_SIZE = 15;

// The turn index is only a recent navigation window, not the event ledger.
// Do not infer old round numbers, restore points, or missing events.
export const olderLedgerEvents = (events, history, unseen = new Set()) => {
    const keptIds = new Set((Array.isArray(history) ? history : []).flatMap(entry => Array.isArray(entry?.eventIds) ? entry.eventIds : []));
    return (Array.isArray(events) ? events : [])
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => typeof event?.id === "string" && event.id && !keptIds.has(event.id) && !unseen.has(event.id))
        .sort((a, b) => compareGameDatesNewestFirst(a.event.date, b.event.date) || b.index - a.index)
        .map(({ event }) => event);
};

// Old saves may have ambiguous ids; never pick one of them as a link target.
export const uniqueLedgerEvent = (events, id) => {
    if (!id) return null;
    const matches = (Array.isArray(events) ? events : []).filter(event => event?.id === id);
    return matches.length === 1 ? matches[0] : null;
};

export const filterOlderEvents = (events, query = "", category = "") => {
    const needle = String(query).trim().toLocaleLowerCase();
    return events.filter(event => (!category || (Array.isArray(event.tags) && event.tags.includes(category))) &&
        (!needle || [event.title, event.date].some(value => String(value ?? "").toLocaleLowerCase().includes(needle))));
};

export const olderEventPage = (events, index = 0) => {
    const page = Math.min(Math.max(0, Math.floor(Number(index) || 0)), Math.max(0, Math.ceil(events.length / OLDER_EVENT_PAGE_SIZE) - 1));
    return events.slice(page * OLDER_EVENT_PAGE_SIZE, (page + 1) * OLDER_EVENT_PAGE_SIZE);
};

// The canonical commit sequence is also the undo/stale-write generation. Do
// not rewrite it to make an Events page. A completed same-day scene belongs
// after the cards of the preceding time skip, with its own durable commit.
// Walk oldest to newest, joining only proven consecutive same-day records;
// never merge two genuine skips just because they share a calendar date.
export const projectTimelineHistory = (history) => {
    const pages = [];
    for (const entry of (Array.isArray(history) ? history : []).slice().reverse()) {
        const earlier = pages.at(-1);
        const date = entry?.toDate || entry?.date;
        const previousDate = earlier?.toDate || earlier?.date;
        const round = Number(entry?.round);
        const previousRound = Number(earlier?.latestCommitRound ?? earlier?.round);
        if (entry?.mode === "interactive" && earlier && date && entry.fromDate === date
            && previousDate === date && Number.isInteger(round) && round > 0
            && Number.isInteger(previousRound) && previousRound > 0 && round === previousRound + 1
            && (["jump", "auto", "interactive"].includes(earlier.mode))) {
            pages[pages.length - 1] = {
                ...entry,
                round: earlier.round,
                latestCommitRound: round,
                sceneAppendCount: (earlier.sceneAppendCount || 0) + 1,
                fromDate: earlier.fromDate,
                eventIds: [...new Set([...(earlier.eventIds ?? []), ...(entry.eventIds ?? [])])],
                filedEvents: [...(earlier.filedEvents ?? []), ...(entry.filedEvents ?? [])],
            };
        } else {
            pages.push(entry);
        }
    }
    return pages.reverse();
};
