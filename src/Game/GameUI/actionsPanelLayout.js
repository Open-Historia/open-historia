// How the Actions panel shares its room (actions.jsx): "make it so you can
// minimize the standing goal and it is auto minimized when suggested actions
// are opened or submitted actions are opened (suggested actions and submitted
// actions already do this for each other) also make the actions tab resizable
// vertically" (the owner, 2026-11-09).
//
// The standing goal card and the two order lists are one family. Opening a
// list (its header, AI Suggestions, sending an order) minimizes the goal card,
// so the list gets the room. Expanding the goal card leaves the open list
// open: the queued orders never disappear behind it.

// Remembered across openings of the panel, on this device.
export const GOAL_OPEN_KEY = "oh-actions-goal-open";
export const PANEL_HEIGHT_KEY = "oh-actions-panel-height";

// Dragged no shorter than this, and never into the 9rem the top of the screen
// needs (the panel's own cap since it grew to fill tall screens).
export const PANEL_MIN_HEIGHT_REM = 20;
export const PANEL_TOP_CLEARANCE_REM = 9;
// An arrow key on the focused handle moves it by this much; with Shift, four times.
export const PANEL_KEY_STEP_PX = 16;

// The CSS variable the panel's height lives in, which the Projects tab reads
// to size its tag menu (projects.jsx PANEL_HEIGHT).
export const PANEL_HEIGHT_VAR = "--oh-actions-panel-height";

// Which list is open. Suggested is only ever open while it is shown at all;
// otherwise the submitted actions are.
export const openSectionOf = (section, showSuggested) => (showSuggested && section === "suggested" ? "suggested" : "submitted");

export const initialActionsLayout = (goalOpen = true) => ({ section: "submitted", goalOpen: goalOpen !== false });

// Events:
//   { type: "open", section, showSuggested }  a list asked for (AI Suggestions, an order sent)
//   { type: "toggle", showSuggested }          a list's header clicked: the other list opens
//   { type: "goal", open? }                    the goal card's header: flips it, or sets it
// A list that opens minimizes the goal card; one already open changes nothing.
export const actionsLayoutReducer = (state, event) => {
    const current = openSectionOf(state.section, event?.showSuggested);
    switch (event?.type) {
        case "open": {
            const next = event.section === "suggested" ? "suggested" : "submitted";
            if (next === current) return state.section === next ? state : { ...state, section: next };
            return { section: next, goalOpen: false };
        }
        case "toggle": {
            if (!event.showSuggested) return state;
            return { section: current === "suggested" ? "submitted" : "suggested", goalOpen: false };
        }
        case "goal": {
            const open = typeof event.open === "boolean" ? event.open : !state.goalOpen;
            return open === state.goalOpen ? state : { ...state, goalOpen: open };
        }
        default:
            return state;
    }
};

export const readGoalOpen = (storage) => {
    try {
        const saved = storage?.getItem(GOAL_OPEN_KEY);
        return saved === null || saved === undefined ? true : saved !== "0";
    } catch {
        return true;
    }
};

export const writeGoalOpen = (storage, open) => {
    try {
        storage?.setItem(GOAL_OPEN_KEY, open ? "1" : "0");
    } catch { /* private mode or blocked storage: it is only a preference */ }
};

// The height the player dragged to, in px, or null for the default.
export const readPanelHeight = (storage) => {
    try {
        const saved = Number(storage?.getItem(PANEL_HEIGHT_KEY));
        return Number.isFinite(saved) && saved > 0 ? Math.round(saved) : null;
    } catch {
        return null;
    }
};

export const writePanelHeight = (storage, px) => {
    try {
        if (px === null || px === undefined) storage?.removeItem(PANEL_HEIGHT_KEY);
        else storage?.setItem(PANEL_HEIGHT_KEY, String(Math.round(px)));
    } catch { /* private mode or blocked storage: it is only a preference */ }
};

// Between the minimum and the screen's available height. A screen too short
// for the minimum gets what it has.
export const clampPanelHeight = (px, { viewport, rem = 16 }) => {
    const max = Math.max(0, viewport - PANEL_TOP_CLEARANCE_REM * rem);
    const min = Math.min(PANEL_MIN_HEIGHT_REM * rem, max);
    return Math.round(Math.min(Math.max(Number(px) || 0, min), max));
};

// The panel's height as CSS. The default grows with a tall screen (never below
// 30rem); a dragged one is kept, but the screen's own height still caps it, so
// a rising keyboard or a smaller window never pushes the panel off the top.
export const panelHeightCss = (px, appHeight) => (
    Number.isFinite(px) && px > 0
        ? `min(calc(${appHeight} - ${PANEL_TOP_CLEARANCE_REM}rem), max(${Math.round(px)}px, ${PANEL_MIN_HEIGHT_REM}rem))`
        : `min(calc(${appHeight} - ${PANEL_TOP_CLEARANCE_REM}rem), max(calc(${appHeight} - 16rem), 30rem))`
);

// What an arrow key, Home or End does to the height (the handle is on the
// panel's top edge, so up is taller).
export const keyedPanelHeight = (key, { current, shift = false, viewport, rem = 16 }) => {
    const step = PANEL_KEY_STEP_PX * (shift ? 4 : 1);
    if (key === "ArrowUp") return clampPanelHeight(current + step, { viewport, rem });
    if (key === "ArrowDown") return clampPanelHeight(current - step, { viewport, rem });
    if (key === "Home") return clampPanelHeight(0, { viewport, rem });
    if (key === "End") return clampPanelHeight(Infinity, { viewport, rem });
    return null;
};
