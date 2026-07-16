import { createRoot } from "react-dom/client";
import { configureMapRuntime } from "./runtime/assets.js";
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
