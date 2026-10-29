import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const config = JSON.parse(process.env.GOLDEN_MODULES || "{}");
const runtime = new URL("./runtime.mjs", import.meta.url).href;
const targets = new Map(Object.entries(config).map(([file, value]) => [pathToFileURL(file).href.toLowerCase(), value]));

const exportsOf = (source) => {
  const names = new Set();
  for (const match of source.matchAll(/^export\s+(?:const|let|var|function\*?|async\s+function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}\s*(?:from\s*["'][^"']+["'])?/gm)) {
    for (const part of match[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] ?? bits[0]).trim();
      if (name) names.add(name);
    }
  }
  return [...names];
};

export async function load(url, context, next) {
  if (!url.startsWith("file:")) return next(url, context);
  const plain = url.split("?")[0];
  const wanted = targets.get(plain.toLowerCase());
  if (!wanted || url.includes("golden-orig")) return next(url, context);
  const source = fs.readFileSync(fileURLToPath(plain), "utf8");
  const names = exportsOf(source);
  const lines = [
    `import * as orig from ${JSON.stringify(`${plain}?golden-orig`)};`,
    `import { wrap } from ${JSON.stringify(runtime)};`,
    `const factories = ${JSON.stringify(wanted.factories ?? [])};`,
  ];
  for (const name of names) lines.push(`export const ${name} = wrap(${JSON.stringify(wanted.name)}, ${JSON.stringify(name)}, orig.${name}, factories);`);
  return { format: "module", source: lines.join("\n"), shortCircuit: true };
}
