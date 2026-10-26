import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, "engine.js")],
  outfile: path.join(here, "dist", "engine.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  loader: { ".js": "jsx", ".jsx": "jsx" },
  jsx: "automatic",
  define: {
    "import.meta.env": JSON.stringify({ VITE_OH_WEB: false, VITE_OH_NATIVE: false, MODE: "native", DEV: false, PROD: true, BASE_URL: "/" }),
  },
  banner: { js: "import { createRequire as __ohCreateRequire } from 'node:module'; const require = __ohCreateRequire(import.meta.url);" },
  logLevel: "warning",
  sourcemap: "linked",
});
console.log("engine bundle built");

await build({
  stdin: {
    contents: [
      'export * as polityGeometry from "../../src/Game/Map/vnext/polityGeometry.js";',
      'export * as polityLabels from "../../src/Game/Map/vnext/polityLabels.js";',
      'export * as polityTextRecords from "../../src/Game/Map/labels/polityTextRecords.js";',
      'export * as polityTextCustomLayer from "../../src/Game/Map/labels/polityTextCustomLayer.js";',
      'export * as polityTextPlacement from "../../src/Game/Map/labels/polityTextPlacement.js";',
      'export * as polityTextContinuity from "../../src/Game/Map/labels/polityTextContinuity.js";',
      'export * as ownerNames from "../../src/runtime/ownerNames.js";',
    ].join(String.fromCharCode(10)),
    resolveDir: here,
    sourcefile: "labels-entry.js",
    loader: "js",
  },
  outfile: path.join(here, "dist", "labels.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  loader: { ".js": "jsx", ".jsx": "jsx" },
  jsx: "automatic",
  define: {
    "import.meta.env": JSON.stringify({ VITE_OH_WEB: false, VITE_OH_NATIVE: false, MODE: "native", DEV: false, PROD: true, BASE_URL: "/" }),
  },
  banner: { js: "import { createRequire as __ohCreateRequire } from 'node:module'; const require = __ohCreateRequire(import.meta.url);" },
  logLevel: "warning",
  sourcemap: "linked",
});
console.log("labels bundle built");
