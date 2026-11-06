// For tests: the MapLibre this game ships is its own copy, vendor/maplibre-gl, not the npm package's bundle.
import fs from "node:fs";

const root = new URL("../../../vendor/maplibre-gl/src/", import.meta.url);

export const shippedFile = (file) => fs.readFileSync(new URL(file, root), "utf8");

let everything = null;
export const shippedLibrary = () => {
  everything ??= fs.readdirSync(root, { recursive: true })
    .filter((file) => /\.ts$/.test(file) && !file.startsWith("shaders"))
    .map(shippedFile)
    .join("\n");
  return everything;
};
