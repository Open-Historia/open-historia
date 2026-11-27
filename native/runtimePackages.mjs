import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const builtins = new Set(builtinModules);
const IMPORTS = /(?:\bfrom|\bimport\s*\(|^\s*import)\s*["']([^"'./][^"']*)["']/gm;

const PACKAGE = /^(?:node:[a-z_/]+|(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.@-]+)*)$/i;

const packageOf = (specifier) => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);

const sourcesIn = (dir, keep, files = []) => {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "data") sourcesIn(full, keep, files);
    } else if (keep(entry.name)) {
      files.push(full);
    }
  }
  return files;
};

export const runtimePackageNames = (repo, sidecar) => {
  const script = (name) => /\.(m|c)?js$/.test(name) && !/\.test\.(m|c)?js$/.test(name);
  const files = [
    ...sourcesIn(path.join(sidecar, "handlers"), (name) => name.endsWith(".mjs")),
    ...sourcesIn(path.join(repo, "server"), script),
  ];
  const wanted = ["express", "jszip", "pmtiles"];
  for (const file of files) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(IMPORTS)) {
      const specifier = match[1];
      if (!PACKAGE.test(specifier) || specifier.startsWith("node:") || builtins.has(specifier) || builtins.has(packageOf(specifier))) continue;
      const name = packageOf(specifier);
      if (!wanted.includes(name)) wanted.push(name);
    }
  }
  return wanted;
};
