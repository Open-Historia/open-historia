/*! Open Historia — manual events on the turn timeline © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Manual Exact Events (Cheats > Event Editor) live in the same canonical event
// ledger as AI events, but the visible Events panel is turn-oriented: time.jsx
// renders only IDs referenced by world.simulationHistory. This keeps manual
// events linked there without advancing a turn, changing the game date, or
// applying any gameplay-state effects. Pure: the editor reads and writes.

import { compareGameDates, isGameDate } from "./gameDates.js";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const historyEntryDate = (entry) => cleanText(entry?.toDate || entry?.date || entry?.fromDate);

// Whether a turn record's date range takes in `date`. Game dates are compared
// as dates (gameDates.js): as text, a BC year sorted after an AD one.
export const historyEntryCoversDate = (entry, date) => {
    const wanted = cleanText(date);
    if (!wanted) return false;
    const from = cleanText(entry?.fromDate || entry?.date || entry?.toDate);
    const to = cleanText(entry?.toDate || entry?.date || entry?.fromDate);
    if (isGameDate(wanted) && isGameDate(from) && isGameDate(to)) {
        const [low, high] = compareGameDates(from, to) <= 0 ? [from, to] : [to, from];
        return compareGameDates(wanted, low) >= 0 && compareGameDates(wanted, high) <= 0;
    }
    return wanted === cleanText(entry?.date) || wanted === to || wanted === from;
};

export const isManualTimelineEvent = (event) => {
    const source = cleanText(event?.source).toLowerCase();
    const id = cleanText(event?.id).toLowerCase();
    return source === "manual" || id.startsWith("event-manual-");
};

const isManualRecord = (entry) => {
    const source = cleanText(entry?.source).toLowerCase();
    const mode = cleanText(entry?.mode).toLowerCase();
    return source === "manual" || mode === "manual-event";
};

const isGameMasterRecord = (entry) => {
    const source = cleanText(entry?.source).toLowerCase();
    const mode = cleanText(entry?.mode).toLowerCase();
    return source === "gm-console" || mode === "game-master";
};

// Returns { changed, world }; `world` is a new object only when something
// changed, and a pass over its own result changes nothing, so opening the
// editor does not rewrite the world.
export const syncManualEventTimelineHistory = (worldInput, eventsInput, game) => {
    const world = worldInput && typeof worldInput === "object" ? { ...worldInput } : {};
    const manualEvents = (Array.isArray(eventsInput) ? eventsInput : [])
        .filter((event) => isManualTimelineEvent(event) && cleanText(event?.id) && cleanText(event?.date));
    const manualIds = new Set(manualEvents.map((event) => cleanText(event.id)));
    const knownEventIds = new Set((Array.isArray(eventsInput) ? eventsInput : []).map((event) => cleanText(event?.id)).filter(Boolean));
    const original = Array.isArray(world.simulationHistory) ? world.simulationHistory : [];

    // The record each manual event had of its own, so the one rebuilt below
    // keeps the round it was written in rather than taking today's.
    const priorRecord = new Map();
    for (const entry of original) {
        if (!isManualRecord(entry) || !Array.isArray(entry?.eventIds)) continue;
        for (const id of entry.eventIds) {
            if (!priorRecord.has(cleanText(id))) priorRecord.set(cleanText(id), entry);
        }
    }

    // First remove every manual ID from prior links. This makes date edits deterministic
    // and prevents duplicate links if the editor is opened repeatedly.
    let history = original
        .map((entry) => {
            const before = Array.isArray(entry?.eventIds) ? entry.eventIds : [];
            const after = before.filter((id) => {
                const normalizedId = cleanText(id);
                if (manualIds.has(normalizedId)) return false;
                if (normalizedId.toLowerCase().startsWith("event-manual-") && !knownEventIds.has(normalizedId)) return false;
                return true;
            });
            return { ...entry, eventIds: after };
        })
        // Manual and GM-authored history entries exist only to make their linked
        // canonical events visible in time.jsx. An empty one is a shell — the
        // event it linked was deleted, or it never had one — and the Events
        // panel would show a turn with nothing in it, so it goes (gameplay.js
        // prunes empty GM records the same way). Structured world effects are
        // deliberately left untouched.
        .filter((entry) => entry.eventIds.length > 0 || !(isManualRecord(entry) || isGameMasterRecord(entry)));

    const orderedManual = [...manualEvents].sort((a, b) => compareGameDates(cleanText(a.date), cleanText(b.date)));

    for (const event of orderedManual) {
        const eventId = cleanText(event.id);
        const date = cleanText(event.date);
        const targetIndex = history.findIndex((entry) => historyEntryCoversDate(entry, date));

        if (targetIndex >= 0) {
            const ids = history[targetIndex].eventIds;
            if (!ids.some((id) => cleanText(id) === eventId)) {
                history[targetIndex] = { ...history[targetIndex], eventIds: [...ids, eventId] };
            }
            continue;
        }

        const prior = priorRecord.get(eventId);
        const manualRecord = {
            date,
            eventIds: [eventId],
            fallbackReason: "",
            fromDate: date,
            mode: "manual-event",
            plannedActions: [],
            round: Number.isFinite(Number(prior?.round))
                ? Number(prior.round)
                : Math.max(0, Math.trunc(Number(game?.round) || 0)),
            source: "manual",
            summary: `Manual exact event: ${cleanText(event?.title) || "Untitled event"}`,
            toDate: date,
        };

        // History runs newest first: the record goes before the first entry
        // older than it.
        let insertAt = history.findIndex((entry) => {
            const entryDate = historyEntryDate(entry);
            return isGameDate(date) && isGameDate(entryDate) && compareGameDates(date, entryDate) > 0;
        });
        if (insertAt < 0) insertAt = history.length;
        history.splice(insertAt, 0, manualRecord);
    }

    const changed = JSON.stringify(history) !== JSON.stringify(original);
    return changed
        ? { changed: true, world: { ...world, simulationHistory: history } }
        : { changed: false, world };
};
