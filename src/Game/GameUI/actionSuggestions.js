// What the Actions panel shows of the AI suggestions (actions.jsx).
//
// The list is the one the game keeps on the world (gameplay.js
// generateActionSuggestions writes it, a time skip clears it), so reopening the
// panel shows it again instead of asking the player to spend a request on the
// same list.
export const selectSavedSuggestions = (world) =>
    (Array.isArray(world?.actionSuggestions) ? world.actionSuggestions : []);

// Canned topics, written when the AI could not be reached, are marked.
export const suggestionsFellBack = (topics) =>
    Array.isArray(topics) && topics.some((topic) => topic?.source === "fallback");

// The ids of the orders waiting for the next time skip. A suggested order keeps
// its id when queued, so a card restored from the world knows which of its
// orders are already in the queue, and one deleted from the queue can be
// queued again.
export const queuedActionIds = (actions) => new Set(
    (Array.isArray(actions) ? actions : [])
        .filter((action) => action && (action.status ?? "planned") === "planned")
        .map((action) => String(action.id ?? "").trim())
        .filter(Boolean),
);

// The orders a player's own advisor brings them each week in a shared game
// (Game/AI/seatAdvice.js): the round's one time skip writes three for every
// person who plays (world.seatAdvice, shown to that player alone,
// multiplayer/host/projection.js), and no screen showed them, though they cost
// nothing (the gap audit of 2026-11-18). They are the same kind of card as the
// AI suggestions, queued the same way. Only the round they were written for
// (`round`, the campaign's round being planned): an advisor whose week brought
// nothing new keeps last week's advice in the world, and that advice is old.
// Null when there is none.
const asText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const sameName = (left, right) => Boolean(asText(left)) && asText(left).toLocaleLowerCase() === asText(right).toLocaleLowerCase();
// A short, steady tag of a polity's name, so two players' cards never share
// an order id (the host refuses an order queued under another's id).
const nameTag = (name) => {
    let hash = 2166136261;
    for (const char of asText(name).toLocaleLowerCase()) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
};
const TITLE_MAX = 64;
export const seatAdviceTopic = (world, country, round) => {
    const advice = world?.seatAdvice && typeof world.seatAdvice === "object" ? world.seatAdvice : {};
    const entry = Object.entries(advice).find(([polity]) => sameName(polity, country))?.[1];
    const number = Number(round);
    if (!entry || !Number.isFinite(number) || number <= 0 || Number(entry.round) !== number) return null;
    const suggestions = (Array.isArray(entry.suggestions) ? entry.suggestions : [])
        .filter((text) => typeof text === "string")
        .map(asText)
        .filter(Boolean);
    if (!suggestions.length) return null;
    const name = asText(entry.advisor?.name);
    const office = asText(entry.advisor?.title);
    const tag = nameTag(country);
    return {
        id: `seat-advice-${tag}-${number}`,
        // The advisor's name and office are the AI's, in the world's language.
        title: name ? [name, office].filter(Boolean).join(", ") : "Your advisor",
        description: "Orders your advisor would have you give this round.",
        advice: true,
        actions: suggestions.map((text, index) => ({
            id: `advice-${tag}-${number}-${index + 1}`,
            kind: "action",
            title: text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 3).trimEnd()}...` : text,
            text,
        })),
    };
};

// For a useRuntimeState selector: a string, so the panel renders again only
// when the advice itself changes.
export const seatAdviceKey = (world, country, round) => JSON.stringify(seatAdviceTopic(world, country, round));
