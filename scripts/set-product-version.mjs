// Writes a Windows program's product version string exactly as given.
//   node scripts/set-product-version.mjs --version 0.0.412 "release/win-unpacked/Open Historia.exe"
//
// SignPath Foundation requires every file it signs to carry one product version
// for the build (docs/code-signing.md). The installer and the speech program
// say 0.0.N, but electron-builder writes the app's version block through
// resedit, which turns the product version string into four numbers (0.0.N.0);
// electron-builder puts the file version string back as given and leaves the
// product version as resedit wrote it. This puts it back too. The numeric
// version fields stay four numbers, as Windows requires.
//
// resedit is electron-builder's own dependency (app-builder-lib), loaded from
// there rather than added to this project's.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import url from "node:url";

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");

const loadResedit = () => {
  const fromBuilder = createRequire(path.join(ROOT, "node_modules", "app-builder-lib", "package.json"));
  return fromBuilder("resedit");
};

export const setProductVersion = (file, version, resedit = loadResedit()) => {
  const executable = resedit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
  const resources = resedit.NtExecutableResource.from(executable);
  const [info] = resedit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!info) throw new Error(`${file} has no version block`);
  for (const lang of info.getAllLanguagesForStringValues()) info.setStringValues(lang, { ProductVersion: version });
  info.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  fs.writeFileSync(file, Buffer.from(executable.generate()));
};

const main = () => {
  const args = process.argv.slice(2);
  const at = args.indexOf("--version");
  const version = at >= 0 ? String(args[at + 1] || "").trim() : "";
  const files = args.filter((arg, index) => index !== at && index !== at + 1);
  if (!version || !files.length) {
    console.error("usage: node scripts/set-product-version.mjs --version <version> <file.exe>...");
    process.exit(2);
  }
  for (const file of files) {
    setProductVersion(file, version);
    console.log(`[set-product-version] ${file}: ${version}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) main();
