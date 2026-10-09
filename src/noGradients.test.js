import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The interface is flat: no surface fades from one colour into another. A
// panel is one grey, a button one colour, and a picture that text stands on
// gets one even tint or a solid strip. The one fade kept is the Accent, the
// colour an author picks for a scenario (and a game takes from it), which
// glows in the corner of its card.
//
// Anything else that still spells a gradient is listed here with why it is
// not one to the eye: two flat colours meeting at a hard edge, a hairline
// pattern, or an effect on the map itself.
const ALLOWED = [
  { file: "src/Game/GameUI/libraryBar.jsx", has: "accentColor}", why: "the Accent of a scenario or a game" },
  { file: "src/Game/GameUI/chat.jsx", has: "${share}%, rgba(255,255,255,0.05) ${share}%", why: "a poll's bar: two flat colours, a hard edge where the share ends" },
  { file: "src/Game/Map/World.jsx", has: "radial-gradient(circle, #fff 0 7%", why: "the flash of a strike on the map, not a surface" },
  { file: "src/runtime/web/homePage.js", has: "repeating-linear-gradient(112deg", why: "a hairline texture: hard-edged stripes" },
  { file: "src/styles.css", has: "1px, transparent 1px)", why: "grid lines one pixel wide" },
];

const root = fileURLToPath(new URL("../", import.meta.url));
const SPELLED = /(?:linear|radial|conic)-gradient\s*\(|<(?:linear|radial)Gradient\b|create(?:Linear|Radial|Conic)Gradient\b/;
const READ = /\.(?:jsx?|css|html)$/;

const filesUnder = (directory) => readdirSync(directory).flatMap((name) => {
  const full = path.join(directory, name);
  if (statSync(full).isDirectory()) return name === "generated" || name === "node_modules" ? [] : filesUnder(full);
  return READ.test(name) && !name.endsWith(".test.js") ? [full] : [];
});

const sources = [
  ...filesUnder(path.join(root, "src")),
  ...filesUnder(path.join(root, "electron")),
  path.join(root, "index.html"),
].map((full) => ({ file: path.relative(root, full).split(path.sep).join("/"), lines: readFileSync(full, "utf8").split(/\r?\n/) }));

test("no surface of the interface is a gradient, the Accent aside", () => {
  const offenders = [];
  for (const { file, lines } of sources) {
    lines.forEach((line, index) => {
      if (!SPELLED.test(line)) return;
      if (ALLOWED.some((entry) => entry.file === file && line.includes(entry.has))) return;
      offenders.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("every exception still stands for a line that is there", () => {
  for (const entry of ALLOWED) {
    const source = sources.find(({ file }) => file === entry.file);
    assert.ok(source?.lines.some((line) => SPELLED.test(line) && line.includes(entry.has)), `${entry.file}: ${entry.why}`);
  }
});
