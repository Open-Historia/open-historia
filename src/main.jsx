import { createRoot } from "react-dom/client";
import { configureMapRuntime } from "./runtime/assets.js";
import { installDebugLogCapture, logDebugEvent, setDebugLogContext } from "./runtime/debugLog.js";
import { startTranslator } from "./runtime/translator.js";
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
