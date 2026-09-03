import { createRoot } from "react-dom/client";
import { configureMapRuntime } from "./runtime/assets.js";
import { startTranslator } from "./runtime/translator.js";
import { installLogClient, logEvent } from "./runtime/logClient.js";
import {
    getDebugLogEntries,
    installDebugLogCapture,
    logDebugEvent,
    setDebugLogContext,
    subscribeToDebugLog,
} from "./runtime/debugLog.js";
import App from "./App.jsx";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const registerServiceWorker = () => {
    if (!import.meta.env.DEV && "serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/sw.js").catch((error) => {
                console.warn("Service worker registration failed:", error);
            });
        });
    }
};

const mount = () => {
    // First, so a throw anywhere below is captured rather than lost to a console
    // nobody had open.
    installLogClient();
    configureMapRuntime();
    createRoot(document.getElementById("root")).render(
        <App />,
    );
    // Live-translates the UI when a non-English language is set in Settings.
    startTranslator();
    registerServiceWorker();
};

// Before anything else runs, so the diagnostics log in Settings covers the whole
// session — including a failure during the web backend install below, which
// happens before a single component mounts and used to be visible only in a
// console the packaged app has no way to open.
installDebugLogCapture();
setDebugLogContext({
    build: import.meta.env.VITE_OH_WEB ? "web" : (import.meta.env.DEV ? "dev" : "desktop/local"),
    language: typeof navigator !== "undefined" ? navigator.language : "",
});
logDebugEvent("app", "Open Historia started.");

// The same milestones, forwarded to the server's log file (runtime/logClient.js
// → server/logStore.js) so a desktop install's log on disk tells the same story
// the player's copied report does. Only what every report carries: detailed-mode
// entries can quote whole conversations and stay in the browser. Crashes are
// skipped because logClient reports those itself, and a repeat that folded into
// an earlier entry is not forwarded twice.
let forwardedSeq = 0;
subscribeToDebugLog(() => {
    const entries = getDebugLogEntries();
    const latest = entries[entries.length - 1];
    if (!latest || latest.seq <= forwardedSeq) return;
    forwardedSeq = latest.seq;
    if (latest.verbose || latest.category === "crash") return;
    logEvent({
        level: latest.category === "error" ? "error" : latest.category === "warn" ? "warn" : "info",
        event: `debug.${latest.category}`,
        message: latest.message,
        data: latest.detail ? { detail: latest.detail, gameDate: latest.gameDate } : undefined,
    });
});

if (import.meta.env.VITE_OH_WEB) {
    // Web build (the hosted website): install the IndexedDB-backed /api
    // interceptor before anything makes a request, then mount. This whole
    // branch — and the dynamically-imported web backend — is stripped from the
    // local download, which keeps its trusted same-origin server unchanged.
    import("./runtime/web/index.js")
        .then(({ installWebBackend }) => installWebBackend())
        .catch((error) => console.error("Web backend failed to install:", error))
        .finally(mount);
} else {
    mount();
}
