// Run: node --test server/desktopPackaging.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import { builtinModules } from "node:module";
import test from "node:test";
import { RUNTIME_DEPENDENCIES, packagedManifest } from "../scripts/package-desktop.mjs";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const packageJson = JSON.parse(read("package.json"));

const packedCode = (folder) =>
  fs.readdirSync(new URL(`../${folder}/`, import.meta.url), { recursive: true })
    .map((file) => String(file).replace(/\\/g, "/"))
    .filter((file) => /\.(?:js|mjs|cjs)$/.test(file) && !file.includes(".test.") && !/^(?:data|seed)\//.test(file))
    .map((file) => read(`${folder}/${file}`));

const importedPackages = () => {
  const names = new Set();
  const sources = [...packedCode("server"), ...packedCode("electron"), read("scripts/fetch-map-assets.mjs")];
  for (const source of sources) {
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\(\s*|^import\s+)["']([^"'./][^"']*)["']/gm)) {
      if (specifier.startsWith("node:") || specifier === "electron") continue;
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      if (!builtinModules.includes(name)) names.add(name);
    }
  }
  return [...names].sort();
};

test("the packed list is exactly what the packed code imports", () => {
  assert.deepEqual(importedPackages(), [...RUNTIME_DEPENDENCIES].sort());
});

test("packing keeps the runtime packages and moves the rest out of what electron-builder collects", () => {
  const packed = packagedManifest(packageJson);
  assert.deepEqual(Object.keys(packed.dependencies).sort(), [...RUNTIME_DEPENDENCIES].sort());
  assert.equal(packed.optionalDependencies, undefined);
  for (const name of RUNTIME_DEPENDENCIES) assert.equal(packed.dependencies[name], packageJson.dependencies[name]);
  for (const name of ["electron", "electron-builder", "vite", "ol", "react"]) assert.ok(packed.devDependencies[name], name);
  for (const name of RUNTIME_DEPENDENCIES) assert.equal(packed.devDependencies[name], undefined, name);
  assert.deepEqual(packed.build, packageJson.build);
  assert.equal(packed.main, packageJson.main);
});

test("a package the app needs but does not declare stops the packing", () => {
  assert.throws(() => packagedManifest({ dependencies: { express: "1" } }), /electron-updater/);
});

test("nothing of a developer's, and no second copy of anything, is packed", () => {
  const { files } = packageJson.build;
  assert.ok(files.includes("!server/data/**"), "a local build would carry the developer's saves");
  assert.ok(files.includes("!server/**/*.test.js"));
  assert.ok(files.includes("!dist/screenshots/**"));
  assert.ok(files.includes("!dist/screenshot.png"));
  assert.ok(!files.includes("public/lang/**"), "the packs are already in dist/lang, which the server reads first");
  assert.match(read("server/server.js"), /fs\.existsSync\(path\.join\(distDir, "lang"\)\)\s*\? path\.join\(distDir, "lang"\)/);
});

test("the app never asks for a differential download, so the installer is not built for one", () => {
  assert.match(read("electron/main.cjs"), /autoUpdater\.disableDifferentialDownload = true/);
  assert.equal(packageJson.build.nsis.differentialPackage, false);
  for (const config of ["electron-builder.beta.yml", "electron-builder.multiplayer.yml"]) {
    assert.match(read(config), /^nsis:\n(?: {2}.*\n)*? {2}differentialPackage: false$/m, config);
  }
});

test("every build goes through the packing step", () => {
  for (const [name, script] of Object.entries(packageJson.scripts)) {
    if (!name.startsWith("dist:")) continue;
    assert.match(script, /node scripts\/package-desktop\.mjs --(?:win|mac|linux)/, name);
    assert.doesNotMatch(script, /&& electron-builder/, name);
  }
  for (const workflow of [".github/workflows/desktop-installer.yml", ".github/workflows/desktop-beta.yml"]) {
    const text = read(workflow);
    assert.match(text, /run: node scripts\/package-desktop\.mjs \$\{\{ matrix\.args \}\}/, workflow);
    assert.doesNotMatch(text, /npx electron-builder/, workflow);
  }
});
