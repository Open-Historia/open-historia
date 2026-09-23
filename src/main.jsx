import { createRoot } from "react-dom/client";
import { configureMapRuntime } from "./runtime/assets.js";
import { installAppHeight } from "./runtime/mobileUi.js";
import { startTranslator } from "./runtime/translator.js";
import {
    installDebugLogCapture,
    logDebugEvent,
    setDebugLogContext,
    withConsoleCaptureMuted,
} from "./runtime/debugLog.js";
// Registers the Logging file's settings snapshot (every setting's current value).
import "./runtime/settingsLog.js";
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
    // Before the first render: every panel sizes itself from the visible height
    // (runtime/mobileUi.js), which on a phone is not 100vh.
    installAppHeight();
    configureMapRuntime();
    createRoot(document.getElementById("root"), {
        // React console.errors every error a boundary catches, before the
        // boundary's componentDidCatch runs. Still printed for a developer, but
        // kept out of the diagnostics log: ErrorBoundary.jsx records the crash
        // itself, and without this each one would read as two.
        onCaughtError: (error) => withConsoleCaptureMuted(() => console.error(error)),
    }).render(
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
