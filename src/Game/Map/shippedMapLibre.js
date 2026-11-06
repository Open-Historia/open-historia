// For tests: the MapLibre this game ships is the package built from Open-Historia/maplibre-gl-js, which carries its source.
import fs from "node:fs";

const root = new URL("../../../node_modules/maplibre-gl/src/", import.meta.url);

export const shippedFile = (file) => fs.readFileSync(new URL(file, root), "utf8");

let everything = null;
export const shippedLibrary = () => {
  everything ??= fs.readdirSync(root, { recursive: true })
    // The package carries MapLibre's own tests and benches beside its source: not what the game runs.
    .filter((file) => /\.ts$/.test(file) && !/\.(test|bench)\.ts$/.test(file) && !file.startsWith("shaders"))
    .map(shippedFile)
    .join("\n");
  return everything;
};
