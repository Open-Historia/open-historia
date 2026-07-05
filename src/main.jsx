import { createRoot } from "react-dom/client";
import { configureMapRuntime } from "./runtime/assets.js";
import { startTranslator } from "./runtime/translator.js";
import App from "./App.jsx";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

configureMapRuntime();

createRoot(document.getElementById("root")).render(
  <App />,
);

// Live-translates the UI when a non-English language is set in Settings.
startTranslator();

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((error) => {
            console.warn("Service worker registration failed:", error);
        });
    });
}
