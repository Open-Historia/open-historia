// What the Actions panel shows of the AI suggestions (actions.jsx).
//
// The list is the one the game keeps on the world (gameplay.js
// generateActionSuggestions writes it, a time skip clears it), so reopening the
// panel shows it again instead of asking the player to spend a request on the
// same list.
export const selectSavedSuggestions = (world) =>
    (Array.isArray(world?.actionSuggestions) ? world.actionSuggestions : []);

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
