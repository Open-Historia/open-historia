/*! Open Historia — save the diagnostics log as a file © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One "Save logging file" for every place a failure is shown — the timeline's
// fallback warning, the advisor's error bubble, its board-update warning — and
// the Save button in Settings → Diagnostics.
//
// Those failure buttons used to copy a report of the ONE failure to the
// clipboard, and that paste is what arrived in Discord: the failure without the
// log around it, so every report needed a second round-trip to ask for the file.
// Saving the file itself, with the failure attached at the top (see `incident`
// on buildDebugLogReport), makes the first thing a player sends the whole thing.
//
// Two exceptions:
//   * Logging turned off. There is no log to send, so the buttons go back to
//     copying the failure on its own (copyIncidentReport) under their old
//     labels, and switch over live if logging is turned back on.
//   * The Android app. Its WebView cannot save a file — its download listener
//     hands every URL to the system browser, and a blob: URL means nothing
//     there — so the same report goes to the clipboard instead, and the button
//     says so. Anything else that stops the download falls back the same way.
import { useState, useSyncExternalStore } from "react";
import { copyToClipboard } from "./clipboard.js";
import {
    buildDebugLogReport,
    buildIncidentReport,
    debugLogFilename,
    isDebugLogEnabled,
    subscribeToDebugLog,
} from "./debugLog.js";
import { isNativeApp } from "./web/nativeBoot.js";

// Resolves to "saved", "copied" (the clipboard fallback) or "failed".
export const saveDebugLogFile = async ({ incident } = {}) => {
    const report = buildDebugLogReport({ incident });
    if (!isNativeApp()) {
        try {
            const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = debugLogFilename(incident?.kind);
            document.body.appendChild(link);
            link.click();
            link.remove();
            // Revoked on the next tick, not immediately: Firefox cancels a
            // download whose blob URL is revoked in the same task as the click.
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return "saved";
        } catch { /* fall through to the clipboard */ }
    }
    return (await copyToClipboard(report)) ? "copied" : "failed";
};

// The logging-off path: the failure alone, to the clipboard. Resolves to
// "copied" or "failed".
export const copyIncidentReport = async (incident) => {
    const report = buildIncidentReport(incident);
    if (!report) return "failed";
    return (await copyToClipboard(report)) ? "copied" : "failed";
};

// Whether logging is on, kept current for a mounted button. A snapshot store, so
// the button re-renders when the switch flips and not on every entry logged —
// the log emits on both (setDebugLogEnabled clears and emits when turned off,
// and logs a line when turned on).
const useDebugLogEnabled = () =>
    useSyncExternalStore(subscribeToDebugLog, isDebugLogEnabled, isDebugLogEnabled);

// The button text for each state. "copied" on the Save path has to say what
// happened, because the player pressed Save.
const saveLabel = (state) => {
    if (state === "working") return "Saving…";
    if (state === "saved") return "✓ Saved — attach the file to your report";
    if (state === "copied") return "✓ Log copied — paste it into your report";
    if (state === "failed") return "Couldn't save — try again";
    return "💾 Save logging file";
};

const copyLabel = (state, idleLabel) => {
    if (state === "working") return "Copying…";
    if (state === "copied") return "✓ Copied!";
    if (state === "failed") return "Couldn't copy — try again";
    return idleLabel;
};

// Everything a failure's report button needs, so the three of them behave
// alike: Save the log with the failure attached, or — logging off — copy the
// failure under the button's old label (`copyIdleLabel`). `buildIncident` runs
// on click, so a failure that is never reported costs nothing.
//
// `state` is idle | working | saved | copied | failed, and drops back to idle
// shortly after a result so the button does not read "Saved" forever.
export const useFailureReportButton = ({ buildIncident, copyIdleLabel }) => {
    const loggingOn = useDebugLogEnabled();
    const [state, setState] = useState("idle");
    const onClick = async () => {
        if (state === "working") return;
        setState("working");
        const incident = buildIncident();
        setState(loggingOn ? await saveDebugLogFile({ incident }) : await copyIncidentReport(incident));
        setTimeout(() => setState("idle"), 3000);
    };
    return {
        busy: state === "working",
        done: state === "saved" || state === "copied",
        label: loggingOn ? saveLabel(state) : copyLabel(state, copyIdleLabel),
        loggingOn,
        onClick,
    };
};
