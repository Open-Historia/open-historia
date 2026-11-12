/*! Open Historia — the badge over the map that says whether the game has an AI call open © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Off unless the player turns on "Show AI activity on the map" (Settings → AI).
//
// The skip's progress row already says what the request a player is watching
// is doing (AI/requestActivity.js). This says the rest: that a call is open at
// all, including the ones nobody watches a spinner for (a stat sheet, a country
// writing between skips), which task it is and for how long, and how many calls
// this turn and the last one made and how many came back with nothing. The numbers
// are AI/requestTally.js, which callAI feeds.
//
// Each piece of text is its own element so the translator finds it in the
// language packs by exact text: the task names are the ones Settings → AI →
// Task routing already shows, and the clock is marked data-no-translate.
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AI_TASK_ROUTING } from "../AI/providerConfig.js";
import { formatElapsedClock } from "../AI/requestActivity.js";
import { longestOpen, requestTally } from "../AI/requestTally.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

const TASK_LABELS = Object.fromEntries(AI_TASK_ROUTING.map(({ key, label }) => [key, label]));
// A call that named no task (a direct call) is told as what it is.
const taskLabel = (taskKey) => TASK_LABELS[taskKey] || "AI request";

const BUSY = "#ffc400";
const IDLE = "#58c777";
const badge = (busy) => ({
    position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 40,
    // Read, never touched: a click goes through to the map under it.
    pointerEvents: "none",
    display: "flex", alignItems: "center", gap: 8, maxWidth: "min(46vw, 560px)", padding: "5px 12px", borderRadius: 8,
    background: "rgba(13, 22, 36, 0.82)", border: `1px solid ${busy ? "rgba(255, 196, 0, 0.55)" : "rgba(120, 200, 140, 0.4)"}`,
    color: "#e8eef6", font: "600 12px/1.3 system-ui, sans-serif", whiteSpace: "nowrap", overflow: "hidden",
});
const dot = (busy) => ({ width: 8, height: 8, borderRadius: "50%", flex: "none", background: busy ? BUSY : IDLE });
const faint = { opacity: 0.72, fontWeight: 500 };
const clip = { overflow: "hidden", textOverflow: "ellipsis" };

const Badge = ({ gameDate }) => {
    const tally = useSyncExternalStore(requestTally.subscribe, requestTally.current, requestTally.current);
    const open = longestOpen(tally);
    const busy = Boolean(open);
    // The clock is state, not Date.now() read while rendering: the compiler
    // caches a render that reads the time directly, and the counter would stand
    // still. It ticks only while a call is open.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!busy) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [busy]);
    // A new game date is a new turn: its counts start again.
    const seenDate = useRef(gameDate);
    useEffect(() => {
        if (seenDate.current === gameDate) return;
        seenDate.current = gameDate;
        requestTally.newTurn();
    }, [gameDate]);

    const last = !busy ? tally.last : null;
    return (
        <div style={badge(busy)} role="status" aria-live="off">
            <span style={dot(busy)} />
            <span>{busy ? "AI is working" : "AI is idle"}</span>
            {busy && <span style={clip}>{taskLabel(open.taskKey)}</span>}
            {busy && <span data-no-translate>{formatElapsedClock(Math.max(0, now - open.startedAt))}</span>}
            {tally.open.length > 1 && <span style={faint}>Calls open: {tally.open.length}</span>}
            <span style={faint}>Calls this turn: {tally.sinceTurn}</span>
            {tally.unansweredSinceTurn > 0 && <span style={faint}>Unanswered: {tally.unansweredSinceTurn}</span>}
            {!busy && tally.lastTurn && <span style={faint}>Calls last turn: {tally.lastTurn.calls}</span>}
            {last && <span style={faint}>Last call</span>}
            {last && <span style={{ ...faint, ...clip }}>{taskLabel(last.taskKey)}</span>}
            {last && <span style={faint} data-no-translate>{formatElapsedClock(last.ms)}</span>}
            {last && !last.answered && <span style={faint}>No answer</span>}
        </div>
    );
};

export default function AiActivityBadge({ gameDate = "" }) {
    const shown = useMapSetting(MAP_SETTING_KEYS.aiActivityBadge);
    return shown ? <Badge gameDate={gameDate} /> : null;
}
