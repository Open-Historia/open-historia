/*! Open Historia — the Events panel's reveal, streamed cards and map-change lines © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The pure half of the Events panel (time.jsx): the cards a skip streams in
// before its turn is written, how far the player had read when the written turn
// replaced them, and the "What changed on the map" lines under a card. Kept
// free of React and of the map so node can test it (turnReveal.test.js);
// time.jsx hands in the lookups it needs.

import { normalizeGroupOp } from "../../runtime/groups.js";

// ---------------------------------------------------------------------------
// The turn as it is being written
// ---------------------------------------------------------------------------

// The turn as it is being written, in the shape buildTurnRecord (time.jsx)
// makes, so the Events panel gives a skip in progress the same cards, chips and
// reveal it gives a finished one (AI/streamedEvents.js). The id is fixed for the
// length of the skip: the panel keys its filter and its scroll on it.
export const LIVE_TURN_RECORD_ID = "live-turn";

// The card for one streamed event, made once and kept. Cached against the event
// it came from: the list is rebuilt on every arrival but its entries are the
// same objects, and a fresh copy each time threw away the memo in every visible
// EventCard, sending deriveEventLinks back through the place catalog for the
// whole skip.
//
// The id is always the counter's, never the model's. A model may write its own
// id and may repeat it, and two cards keyed alike is exactly the reconciliation
// bug this panel must not have. The real ids arrive with the written turn.
const liveEventCards = new WeakMap();
let liveEventSeq = 0;

// The lists the cards, the camera and the map staging walk. A streamed event's
// are whatever the model typed, and `?? []` does not save an iteration from a
// non-array: that throws in a render and blanks the panel. Dropped here once.
const LIVE_EVENT_LISTS = [
    "regionTransfers", "regionControlOps", "regionClaims", "polityChanges",
    "unitOps", "markerOps", "createdChats", "projectOps", "groupOps",
];

export const liveEventCard = (event) => {
    if (!event || typeof event !== "object") return event;
    let card = liveEventCards.get(event);
    if (!card) {
        liveEventSeq += 1;
        card = { ...event, id: `${LIVE_TURN_RECORD_ID}-${liveEventSeq}` };
        for (const key of ["tags", "combatants"]) {
            if (card[key] !== undefined && !Array.isArray(card[key])) card[key] = [];
        }
        const impacts = card.impacts && typeof card.impacts === "object" && !Array.isArray(card.impacts)
            ? { ...card.impacts }
            : {};
        for (const key of LIVE_EVENT_LISTS) {
            if (impacts[key] !== undefined && !Array.isArray(impacts[key])) impacts[key] = [];
        }
        card.impacts = impacts;
        liveEventCards.set(event, card);
    }
    return card;
};

// `rangeLabel` is the panel's subtitle, formatted by time.jsx.
export const buildLiveTurnRecord = ({ events, fromDate, toDate, round, rangeLabel = "" }) => {
    // Filtered before anything reads a field off one: this record is built on
    // every arriving event, and a throw here takes the whole panel down blank.
    const numbered = (Array.isArray(events) ? events : [])
        .filter((event) => event && typeof event === "object")
        .map(liveEventCard);
    const primaryEvent = numbered.find((event) => String(event.importance).toLowerCase() === "major") || numbered[0];

    return {
        date: toDate || fromDate,
        eventCount: numbered.length,
        events: numbered,
        fallbackReason: "",
        fromDate,
        id: LIVE_TURN_RECORD_ID,
        mode: "jump",
        plannedActions: [],
        rangeLabel,
        rawResponse: "",
        round,
        source: "ai",
        summary: "",
        title: primaryEvent?.title || "",
        toDate,
    };
};

// ---------------------------------------------------------------------------
// Carrying the reveal from the streamed cards to the written turn
// ---------------------------------------------------------------------------

// What a card is opened by, rather than which card it is. A streamed event's id
// changes when the turn is written, so a card keyed by id would close at exactly
// the moment the live panel must not. The headline survives that crossing.
export const eventDisclosureKey = (event) => {
    const title = String(event?.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    return title || String(event?.id ?? "");
};

// How far the player had read into a watched skip when it landed: which events
// were uncovered, not how many — the engine can drop one and write a scripted
// beat in above it, so counting would restore a different stretch of the round
// than the player walked through. Null when nothing streamed.
export const captureRevealCarry = (streamed, visibleCount) => {
    const list = Array.isArray(streamed) ? streamed : [];
    if (!list.length) return null;
    const revealed = Math.min(Math.max(1, Number(visibleCount) || 0), list.length);
    return {
        revealed,
        streamed: list.length,
        keys: list.slice(0, revealed).map((event) => eventDisclosureKey(event)).filter(Boolean),
    };
};

// How many of the written turn's events to show as already read: through the
// furthest of the uncovered events that survived, so everything before it
// stays walked past, including a beat the engine wrote in among them. When none
// survived this is not the round they were reading, and carrying the count
// would uncover a turn they have never seen: one event, as a fresh turn opens.
export const resolveRevealCarry = (carried, writtenEvents) => {
    const written = Array.isArray(writtenEvents) ? writtenEvents : [];
    if (!written.length) return 0;
    const wanted = new Set(Array.isArray(carried?.keys) ? carried.keys : []);
    let furthest = -1;
    written.forEach((event, index) => {
        if (wanted.has(eventDisclosureKey(event))) furthest = index;
    });
    return Math.min(written.length, furthest >= 0 ? furthest + 1 : 1);
};

// ---------------------------------------------------------------------------
// "What changed on the map"
// ---------------------------------------------------------------------------

export const resolvePolityName = (code, polityLookup) => {
    if (!code) {
        return "";
    }

    return polityLookup?.get?.(code) || code;
};

export const resolveRegionName = (transfer, regionLookup) => {
    if (!transfer) {
        return "";
    }

    return transfer.regionName || regionLookup?.get?.(transfer.regionId)?.name || transfer.regionId || "";
};

// A list the lines walk; anything else is no list at all.
const listOf = (value) => (Array.isArray(value) ? value : []);

// Every change an event made to the map, in words — what the "N map changes"
// pill opens into. Transfers and control moves name the region and both sides,
// polity changes say what happened to the country, unit and structure ops say
// what was raised, moved or built: the impacts' own vocabulary, read out.
// `unitName(id)` names a unit an operation refers to by id only.
export const describeEventMapChanges = (event, { polityLookup = new Map(), regionLookup = new Map(), unitName: nameUnit = () => "" } = {}) => {
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
    const polity = (code) => resolvePolityName(code, polityLookup) || "";
    const region = (entry) => resolveRegionName(entry, regionLookup) || "a region";
    const unitName = (id) => nameUnit(id) || `unit ${id}`;
    const note = (text) => (text ? ` — ${text}` : "");
    const lines = [];
    for (const transfer of listOf(impacts.regionTransfers)) {
        lines.push({ kind: "territory", text: `${region(transfer)}: ${polity(transfer.fromCode) || "unowned"} → ${polity(transfer.toCode) || "unowned"}${transfer.wholeCountry ? " (whole country)" : ""}${note(transfer.note)}` });
    }
    for (const op of listOf(impacts.regionControlOps)) {
        if (op?.op === "contest") lines.push({ kind: "control", text: `${region(op)}: contested by ${polity(op.actorCode)}, held by ${polity(op.fromCode) || "no one"}${note(op.note)}` });
        else if (op?.op === "control") lines.push({ kind: "control", text: `${region(op)}: control passes from ${polity(op.fromCode) || "no one"} to ${polity(op.toCode)}${note(op.note)}` });
        else if (op?.op === "clear_contest") lines.push({ kind: "control", text: `${region(op)}: ${op.clearAll ? "every contest settled" : `${polity(op.claimantCode)} no longer contests it`}${note(op.note)}` });
    }
    for (const claim of listOf(impacts.regionClaims)) {
        lines.push({ kind: "claim", text: `${region(claim)}: ${claim.drop ? `${polity(claim.claimantCode)} drops its claim` : `claimed by ${polity(claim.claimantCode)}`}${note(claim.note)}` });
    }
    // Groups (runtime/groups.js): read through the normalizer, so a streamed
    // card's "erase" reads as the dissolve it is.
    for (const raw of listOf(impacts.groupOps)) {
        const op = normalizeGroupOp(raw);
        if (!op) continue;
        const names = op.regionIds.map((id) => regionLookup.get(id)?.name || id);
        const where = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
        if (op.op === "create") lines.push({ kind: "group", text: `${op.name}: a new group${where ? `, controlling ${where}` : ""}${note(op.note)}` });
        else if (op.op === "dissolve") lines.push({ kind: "group", text: `${op.name}: erased, with the area it controlled${note(op.note)}` });
        else if (op.op === "release") lines.push({ kind: "group", text: `${op.name} ${where ? `loses control of ${where}` : "loses its whole area"}${note(op.note)}` });
        else if (op.op === "take") lines.push({ kind: "group", text: `${where || "No region"}: controlled by ${op.name}${note(op.note)}` });
        else lines.push({ kind: "group", text: `${op.newName ? `${op.name} is now ${op.newName}` : `${op.name}: changed`}${where ? `, taking ${where}` : ""}${note(op.note)}` });
    }
    for (const change of listOf(impacts.polityChanges)) {
        const verb = { create: "created", rename: "renamed", dissolve: "dissolved", restore: "restored", update: "updated" }[change?.operation] || "updated";
        const name = change?.name || polity(change?.code) || "a polity";
        const details = [];
        if (change?.operation === "rename" && change.code && change.name && change.code !== change.name) details.push(`was ${polity(change.code)}`);
        if (change?.color) details.push(`colour ${change.color}`);
        if (change?.reputation != null && change.reputation !== "") details.push(`reputation ${change.reputation}`);
        if (change?.intelligence != null && change.intelligence !== "") details.push(`intelligence ${change.intelligence}`);
        if (Array.isArray(change?.tags) && change.tags.length) details.push(`tags ${change.tags.join(", ")}`);
        lines.push({ kind: "polity", text: `${name}: ${verb}${details.length ? ` (${details.join("; ")})` : ""}${note(change?.note)}` });
    }
    for (const op of listOf(impacts.unitOps)) {
        if (op?.op === "spawn") lines.push({ kind: "unit", text: `${op.unit?.name || "A formation"} raised — ${op.unit?.type || "unit"} of ${polity(op.unit?.ownerCode) || "an unknown owner"}${note(op.unit?.note)}` });
        else if (op?.op === "move") lines.push({ kind: "unit", text: `${unitName(op.unitId)} moves${op.regionId ? ` to ${region(op)}` : ""}${op.posture ? ` (${op.posture})` : ""}${note(op.note)}` });
        else if (op?.op === "strength") lines.push({ kind: "unit", text: `${unitName(op.unitId)}: strength ${op.strength}%${note(op.note)}` });
        else if (op?.op === "remove") lines.push({ kind: "unit", text: `${unitName(op.unitId)} removed${note(op.note)}` });
    }
    for (const op of listOf(impacts.markerOps)) {
        if (op?.op === "build") lines.push({ kind: "structure", text: `${op.marker?.name || "A structure"} built${op.marker?.kind ? ` (${op.marker.kind})` : ""}${op.marker?.ownerCode ? ` by ${polity(op.marker.ownerCode)}` : ""}${note(op.marker?.note)}` });
        else if (op?.op === "remove") lines.push({ kind: "structure", text: `${op.name || op.markerId || "A structure"} removed${note(op.note)}` });
        else if (op?.op === "rename") lines.push({ kind: "structure", text: `${op.name || op.markerId} renamed ${op.newName}${note(op.note)}` });
        else if (op?.op === "update" || op?.op === "modify" || op?.op === "destroy") {
            for (const text of describeMarkerUpdate(op, { polity, note })) lines.push({ kind: "structure", text });
        } else if (op?.op === "population") {
            const population = Number(op.population ?? op.value);
            const name = op.name || op.markerId;
            lines.push({ kind: "structure", text: Number.isFinite(population) ? `${name}: population now ${Math.round(population).toLocaleString("en-US")}${note(op.note)}` : `${name}: population changed${note(op.note)}` });
        }
    }
    return lines;
};

// What the category column says, as a word the string extractor catalogues
// (the kinds themselves are ids). Upper-cased by the card's style.
export const MAP_CHANGE_KIND_LABELS = {
    territory: "Territory",
    control: "Control",
    claim: "Claim",
    group: "Group",
    polity: "Polity",
    unit: "Unit",
    structure: "Structure",
};

// A structure's lifecycle, one whole line per state it can be put in
// (MARKER_STATUSES, runtime/gameState.js). Destruction is an update, not a
// removal: normalizeMarkerOp turns a "destroy" into status "destroyed".
// `more` is the note the first line of an update carries.
const MARKER_STATUS_LINES = {
    planned: (name, more) => `${name}: now planned${more}`,
    under_construction: (name, more) => `${name}: construction under way${more}`,
    active: (name, more) => `${name}: now in service${more}`,
    damaged: (name, more) => `${name} is damaged${more}`,
    inactive: (name, more) => `${name}: out of service${more}`,
    abandoned: (name, more) => `${name} abandoned${more}`,
    destroyed: (name, more) => `${name} destroyed${more}`,
};

// A structure update, a line per thing it changed: the written op carries its
// fields under `changes`, a streamed one may carry them on the op itself. A
// note on an update is the structure's new description; it rides on the first
// line, or is the line when nothing else changed.
const describeMarkerUpdate = (op, { polity, note }) => {
    const name = op.name || op.markerId || op.id || "A structure";
    const source = op.changes && typeof op.changes === "object" && !Array.isArray(op.changes) ? op.changes : op;
    const status = op.op === "destroy" ? "destroyed" : String(source.status ?? "").toLowerCase();
    const coordinate = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    const description = typeof source.note === "string" ? source.note.trim() : "";
    const writers = [];
    if (MARKER_STATUS_LINES[status]) writers.push((more) => MARKER_STATUS_LINES[status](name, more));
    if (source.ownerCode !== undefined) {
        writers.push((more) => (source.ownerCode ? `${name}: now held by ${polity(source.ownerCode)}${more}` : `${name}: no longer held by anyone${more}`));
    }
    if (source.kind) writers.push((more) => `${name}: its kind is now ${source.kind}${more}`);
    if (coordinate(source.lng) && coordinate(source.lat)) writers.push((more) => `${name}: moved on the map${more}`);
    if (source.foundedAt) writers.push((more) => `${name}: founding date set to ${source.foundedAt}${more}`);
    if (!writers.length) return [description ? `${name}: description changed${note(description)}` : `${name} updated`];
    return writers.map((write, index) => write(index === 0 ? note(description) : ""));
};
