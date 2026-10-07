#!/usr/bin/env node
/*! Open Historia — cut a packed app into the chunks an update is made of © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A release publishes the app twice: as installers, and as the app's own files
// (everything inside app.asar) cut into chunks, so that an installed app can
// update by fetching the chunks that changed instead of the installer again.
// This makes the second: a folder of chunk files, each named by its content,
// a manifest saying which chunks make up which file, and the small head an
// app reads first, which names the build and its manifest
// (electron/payloadChunks.cjs has the format and the reasons). The release
// workflow runs it on what electron-builder packed and hands the folder to
// scripts/publish-update-chunks.mjs.
//
//   node scripts/build-update-chunks.mjs --app <app.asar or a folder> --out <folder>
//        --platform win|mac|linux [--channel stable|beta] [--electron <version>]
//        [--previous <an earlier manifest>]
//
// --app       the packed app: release/win-unpacked/resources/app.asar and its
//             like. A folder is read as it is (the tests, and a look by hand).
// --electron  the Electron the app was packed with; read from node_modules when
//             not given. An installed app takes these chunks only on that
//             Electron, and updates with the installer otherwise.
// --previous  the manifest of the release before, to print how much of this one
//             is new. It changes nothing that is written.
//
// The same files always give the same chunks and the same manifest, so two
// systems' builds of one release share every chunk their files share.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const require = createRequire(import.meta.url);
const { chunkAssetName, headOf, planPayload } = require("../electron/payloadChunks.cjs");
const { listFiles } = require("../electron/payloadUpdate.cjs");

const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// The app's files as a folder: the folder itself, or the archive unpacked
// beside the system's other temporary files (the files electron-builder keeps
// outside the archive, in app.asar.unpacked, are put back in their places).
const unpack = (app) => {
  if (fs.statSync(app).isDirectory()) return { root: app, cleanUp: () => {} };
  const { extractAll } = require("@electron/asar");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-payload-"));
  extractAll(app, root);
  return { root, cleanUp: () => fs.rmSync(root, { recursive: true, force: true }) };
};

// -> { manifest, chunks: Map(id -> Buffer), written, summary }
export const buildUpdateChunks = ({ app, out, platform, channel = "stable", electron = "", previous = null }) => {
  if (!["win", "mac", "linux"].includes(platform)) throw new Error(`--platform must be win, mac or linux, not "${platform}"`);
  const { root, cleanUp } = unpack(app);
  try {
    const stamp = path.join(root, "electron", "build-id.json");
    const build = fs.existsSync(stamp) ? String(readJson(stamp).build || "") : "";
    // An unstamped build is nobody's release: an app could never tell whether
    // it is newer than its own files.
    if (!/^\d+$/.test(build)) throw new Error("the packed app has no build id (electron/build-id.json): only a release build is published as chunks");
    const version = String(readJson(path.join(root, "package.json")).version || "");
    const { PROTOCOL } = require(path.join(root, "electron", "payloadBoot.cjs"));
    const runtime = electron || String(require("electron/package.json").version || "");
    if (!runtime) throw new Error("the Electron version is not known: pass --electron");

    const entries = listFiles(root).map((relative) => ({ path: relative, data: fs.readFileSync(path.join(root, ...relative.split("/"))) }));
    const { manifest, chunks } = planPayload(entries, {
      build,
      version,
      channel,
      platform,
      shell: { electron: runtime, protocol: PROTOCOL },
    });

    fs.mkdirSync(out, { recursive: true });
    let written = 0;
    for (const [id, data] of chunks) {
      const file = path.join(out, chunkAssetName(id));
      if (fs.existsSync(file) && fs.statSync(file).size === data.length) continue;
      fs.writeFileSync(file, data);
      written += 1;
    }
    // The manifest under a name made from its content, like a chunk, and the
    // head under the one fixed name an app asks for.
    const manifestText = JSON.stringify(manifest);
    const head = headOf(manifest, manifestText);
    fs.writeFileSync(path.join(out, head.manifest.name), manifestText);
    const manifestFile = path.join(out, `payload-${platform}.json`);
    fs.writeFileSync(manifestFile, JSON.stringify(head));

    const sizes = [...chunks.values()].map((data) => data.length);
    const chunkBytes = sizes.reduce((sum, size) => sum + size, 0);
    const lines = [
      `${platform} ${version} (build ${build}, Electron ${runtime}): ${manifest.files.length} files, ${megabytes(manifest.bytes)}, in ${chunks.size} chunks (${megabytes(chunkBytes)}; the largest ${megabytes(Math.max(...sizes))})`,
    ];
    if (chunks.size < 100 || chunks.size > 200) lines.push(`note: ${chunks.size} chunks is outside the 100 to 200 the sizes in electron/payloadChunks.cjs were set for`);
    if (previous) {
      const had = new Set(Object.keys(previous.chunks ?? {}));
      const fresh = [...chunks.keys()].filter((id) => !had.has(id));
      const freshBytes = fresh.reduce((sum, id) => sum + chunks.get(id).length, 0);
      lines.push(`since build ${previous.build}: ${fresh.length} of ${chunks.size} chunks are new, ${megabytes(freshBytes)} of ${megabytes(chunkBytes)}`);
    }
    lines.push(`the manifest is ${megabytes(head.manifest.size)}, fetched only by an app that updates; the head it reads at every start is ${JSON.stringify(head).length} bytes`);
    return { manifest, head, chunks, manifestFile, written, summary: lines.join("\n") };
  } finally {
    cleanUp();
  }
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : "";
  };
  try {
    // The release before: its head, beside the manifest the head names.
    let previous = flag("--previous") && fs.existsSync(flag("--previous")) ? readJson(flag("--previous")) : null;
    if (previous?.manifest?.name) {
      const named = path.join(path.dirname(path.resolve(flag("--previous"))), previous.manifest.name);
      previous = fs.existsSync(named) ? readJson(named) : null;
    }
    const result = buildUpdateChunks({
      app: path.resolve(flag("--app")),
      out: path.resolve(flag("--out")),
      platform: flag("--platform"),
      channel: flag("--channel") || "stable",
      electron: flag("--electron"),
      previous,
    });
    console.log(result.summary);
    console.log(`written to ${path.dirname(result.manifestFile)}`);
  } catch (error) {
    console.error(`build-update-chunks: ${error?.message || error}`);
    process.exitCode = 1;
  }
}
