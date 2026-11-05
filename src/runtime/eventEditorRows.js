/*! Open Historia — Event Editor row edits © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Event Editor (Cheats) shows the event ledger as it was when it last read
// it, while a time skip, an NPC reaction or another panel may have written the
// ledger since. So a save never writes the editor's copy back: it re-reads the
// ledger and applies its one change — add, edit or delete — to the row it
// meant, found again in the fresh list. Writing the copy erased every event
// written after the editor opened.
//
// Event ids in older saves are not guaranteed to be unique, so a row is found
// by id and createdAt together: the row identical to what the editor showed
// (at the index it showed it at, if it is still there), else the one at that
// index, else the first with the same id and createdAt.

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const eventRowIdentity = (event) => [cleanText(event?.id), cleanText(event?.createdAt)].join("\u001f");

const sameJson = (left, right) => {
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
};

// Where `shown` (the row the editor showed at `index`) is in `events` now; -1
// when it is gone.
export const locateEventRow = (events, shown, index = -1) => {
    const list = Array.isArray(events) ? events : [];
    const key = eventRowIdentity(shown);
    const matches = [];
    list.forEach((event, at) => { if (eventRowIdentity(event) === key) matches.push(at); });
    if (matches.length === 0) return -1;
    const atShownIndex = matches.includes(index);
    if (atShownIndex && sameJson(list[index], shown)) return index;
    return matches.find((at) => sameJson(list[at], shown)) ?? (atShownIndex ? index : matches[0]);
};

// Applies one change to the fresh ledger. `change` is { add: event }, or
// { shown, index, update: (fresh row) => next row } or { shown, index,
// remove: true }. Returns the new list, or null when the row the change is for
// is no longer in the ledger.
export const applyEventRowChange = (events, change = {}) => {
    const list = Array.isArray(events) ? events : [];
    if (change.add) return [...list, change.add];
    const at = locateEventRow(list, change.shown, change.index);
    if (at < 0) return null;
    if (change.remove) return list.filter((_, index) => index !== at);
    if (typeof change.update === "function") return list.map((event, index) => (index === at ? change.update(event) : event));
    return list;
};
