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
