#!/usr/bin/env node
/*! Open Historia — rewrite an update feed for an installer that was signed after it was built © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// electron-builder writes latest.yml as it builds the installer: the file's
// sha512 (base64) and size, which electron-updater checks a download against.
// Signing the installer afterwards (SignPath, in the release workflows) changes
// both, so the feed would name a file that no longer exists and every update
// would fail its checksum. This puts the signed file's hash and size in.
//
//   node scripts/refresh-update-feed.mjs --feed release/latest.yml --file release/Open-Historia-Setup.exe
//
// blockMapSize goes: the blockmap was made from the unsigned file, the app never
// downloads differentially (autoUpdater.disableDifferentialDownload in
// electron/main.cjs), and the release never carries blockmaps. A stale
// <installer>.blockmap beside the installer is removed for the same reason.
// The feed is edited line by line rather than parsed and dumped, so everything
// else in it (version, releaseDate, path, its line endings) stays byte for byte.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

export const sha512Base64 = (data) => crypto.createHash("sha512").update(data).digest("base64");

// -> the feed's text with the entry for `name` (and the top-level path/sha512
// when they name it) carrying the given sha512 and size.
export const refreshFeed = (text, { name, sha512, size }) => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const out = [];
  let inFiles = false;
  let entry = null; // the indentation of the keys of the files: entry being read, when it is ours
  let matched = false;
  let topPath = null;
  for (const line of lines) {
    const top = line.match(/^([A-Za-z][\w]*):(.*)$/);
    if (top) {
      inFiles = top[1] === "files";
      entry = null;
      if (top[1] === "path") topPath = unquote(top[2].trim());
      out.push(line);
      continue;
    }
    if (inFiles) {
      const start = line.match(/^(\s*)- url:\s*(.+?)\s*$/);
      if (start) {
        entry = unquote(start[2]) === name ? `${start[1]}  ` : null;
        if (entry) matched = true;
        out.push(line);
        continue;
      }
      if (entry != null && line.startsWith(entry)) {
        const key = line.slice(entry.length).match(/^(\w+):/)?.[1];
        if (key === "sha512") { out.push(`${entry}sha512: ${sha512}`); continue; }
        if (key === "size") { out.push(`${entry}size: ${size}`); continue; }
        if (key === "blockMapSize") continue;
      }
    }
    out.push(line);
  }
  if (!matched) throw new Error(`the feed has no files: entry for ${name}`);
  // The top-level sha512 is the hash of `path`; it is only ours to change when path is the same file.
  if (topPath === name) {
    for (let i = 0; i < out.length; i += 1) {
      if (/^sha512:/.test(out[i])) out[i] = `sha512: ${sha512}`;
    }
  }
  return out.join(eol);
};

const unquote = (value) => value.replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");

export const refreshFeedFile = ({ feed, file }) => {
  const data = fs.readFileSync(file);
  const name = path.basename(file);
  const before = fs.readFileSync(feed, "utf8");
  const after = refreshFeed(before, { name, sha512: sha512Base64(data), size: data.length });
  fs.writeFileSync(feed, after);
  const blockmap = `${file}.blockmap`;
  if (fs.existsSync(blockmap)) fs.rmSync(blockmap);
  return { name, size: data.length, changed: before !== after };
};

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
};

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const feed = arg("feed");
  const file = arg("file");
  if (!feed || !file) {
    console.error("usage: node scripts/refresh-update-feed.mjs --feed <latest.yml> --file <installer>");
    process.exit(2);
  }
  const result = refreshFeedFile({ feed, file });
  console.log(`[refresh-update-feed] ${feed}: ${result.name} is ${result.size} bytes${result.changed ? "" : " (unchanged)"}`);
}
