import { createRoot } from "react-dom/client";
import { configureMapRuntime } from "./runtime/assets.js";
import App from "./App.jsx";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

configureMapRuntime();

createRoot(document.getElementById("root")).render(
  <App />,
);
