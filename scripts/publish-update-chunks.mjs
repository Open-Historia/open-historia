#!/usr/bin/env node
/*! Open Historia — publish an update's chunks to their release © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Puts what scripts/build-update-chunks.mjs made on a GitHub release: every
// chunk the release does not already hold, each as a file of its own, then the
// manifest, then the head. A chunk is named by its content, and so is a
// manifest, so one already there is the same bytes and is never uploaded again
// or replaced: after the first release only the chunks that changed go up, as
// only they come down.
//
//   node scripts/publish-update-chunks.mjs --dir <folder> --tag <release tag> --repo <owner/name>
//        [--prune-unreferenced]
//
// The head goes last, and replaces the one before it (it is the one file here
// with a fixed name): an app is never told of a build whose manifest and chunks
// are not all there yet.
//
// A release holds 1,000 files at most. Old chunks are only removed when asked
// (--prune-unreferenced): the chunks no manifest on the release names any more.
// Without it this stops, with a message, before the release is full.
//
// Uses the `gh` command, with the token the workflow gives it (GH_TOKEN).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const CHUNK_NAME = /^c-[0-9a-f]{40}\.bin$/;
const MANIFEST_NAME = /^m-[0-9a-f]{40}\.json$/;
const HEAD_NAME = /^payload-(win|mac|linux)\.json$/;
const RELEASE_FILE_LIMIT = 1000;
const ROOM_KEPT = 50;
const BATCH = 20;
const YOUNG_CHUNK_MS = 6 * 60 * 60 * 1000;

// What to upload and what may go, from what the folder holds and what the
// release holds. Pure, so the rules are tested without a release.
//   local:      names in the folder
//   remote:     names on the release
//   referenced: the manifests the heads that will be on the release name (the
//               ones already there for other systems, and this one's), and
//               the chunks those manifests name
export const planPublish = ({ local, remote, referenced = null }) => {
  const have = new Set(remote);
  const byContent = (name) => CHUNK_NAME.test(name) || MANIFEST_NAME.test(name);
  const heads = local.filter((name) => HEAD_NAME.test(name));
  const upload = local.filter(byContent).filter((name) => !have.has(name)).sort();
  const stale = referenced
    ? remote.filter((name) => byContent(name) && !referenced.has(name)).sort()
    : [];
  const after = new Set([...remote, ...upload, ...heads]).size - stale.length;
  return { upload, heads, stale, after, full: after > RELEASE_FILE_LIMIT - ROOM_KEPT };
};

const run = (args, options = {}) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26, ...options });

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : "";
  };
  const dir = path.resolve(flag("--dir"));
  const tag = flag("--tag");
  const repo = flag("--repo");
  const prune = args.includes("--prune-unreferenced");
  if (!tag || !repo || !fs.existsSync(dir)) {
    console.error("usage: publish-update-chunks.mjs --dir <folder> --tag <release tag> --repo <owner/name> [--prune-unreferenced]");
    process.exit(2);
  }

  // The release the chunks live on: one per channel, apart from the installers'
  // own, so the page a player downloads the game from stays a short list.
  try {
    run(["release", "view", tag, "-R", repo, "--json", "tagName"]);
  } catch {
    run([
      "release", "create", tag, "-R", repo, "--latest=false",
      "--title", "Open Historia update chunks",
      "--notes", "The app's own files, cut into chunks. The desktop app reads these to update itself by fetching only what changed. Nothing here is for downloading by hand: the installers are on the release this one is named after.",
    ]);
  }
  const releaseId = run(["api", `repos/${repo}/releases/tags/${tag}`, "-q", ".id"]).trim();
  const listRemote = () => run(["api", "--paginate", `repos/${repo}/releases/${releaseId}/assets?per_page=100`, "-q", ".[].name"]).split("\n").map((name) => name.trim()).filter(Boolean);

  const local = fs.readdirSync(dir);
  let remote = listRemote();

  // The chunks every manifest names once this one is up: the other systems'
  // manifests as they stand on the release, and the ones in the folder.
  let referenced = null;
  if (prune) {
    referenced = new Set();
    const onDisk = new Set(local);
    const read = (name) => (onDisk.has(name)
      ? fs.readFileSync(path.join(dir, name), "utf8")
      : run(["release", "download", tag, "-R", repo, "--pattern", name, "--output", "-"]));
    for (const name of new Set([...remote, ...local].filter((entry) => HEAD_NAME.test(entry)))) {
      const manifestName = JSON.parse(read(name)).manifest?.name;
      if (!manifestName) continue;
      referenced.add(manifestName);
      for (const id of Object.keys(JSON.parse(read(manifestName)).chunks ?? {})) referenced.add(`c-${id.slice(0, 40)}.bin`);
    }
  }

  const plan = planPublish({ local, remote, referenced });
  if (plan.full) {
    console.error(`The release ${tag} would hold ${plan.after} files, and a release holds ${RELEASE_FILE_LIMIT}. Run this again with --prune-unreferenced to remove the chunks no manifest names any more.`);
    process.exit(1);
  }

  console.log(`${tag}: ${plan.upload.length} file(s) to upload, ${local.filter((name) => CHUNK_NAME.test(name) || MANIFEST_NAME.test(name)).length - plan.upload.length} already there`);
  for (let start = 0; start < plan.upload.length; start += BATCH) {
    const batch = plan.upload.slice(start, start + BATCH);
    try {
      run(["release", "upload", tag, "-R", repo, ...batch.map((name) => path.join(dir, name))]);
    } catch {
      // Another system's job may have uploaded one of these in the meantime
      // (the same chunk, by its name). Whatever is still missing goes up one
      // at a time, and the check below is what decides.
      remote = listRemote();
      for (const name of batch.filter((entry) => !remote.includes(entry))) {
        try {
          run(["release", "upload", tag, "-R", repo, path.join(dir, name)]);
        } catch (error) {
          console.warn(`${name}: ${String(error?.stderr || error?.message || error).trim().split("\n")[0]}`);
        }
      }
    }
  }
  remote = listRemote();
  const missing = plan.upload.filter((name) => !remote.includes(name));
  if (missing.length) {
    console.error(`${missing.length} file(s) did not reach the release (${missing.slice(0, 3).join(", ")}...). The head was not published, so no app is pointed at them.`);
    process.exit(1);
  }

  // Only now is any app told about this build.
  for (const name of plan.heads) run(["release", "upload", tag, "-R", repo, path.join(dir, name), "--clobber"]);
  console.log(`${tag}: ${plan.heads.join(", ")} published`);

  // Never a chunk uploaded in the last few hours: another system's job of this
  // same release may have put it there for a manifest it has not published yet.
  const born = new Map(plan.stale.length
    ? run(["api", "--paginate", `repos/${repo}/releases/${releaseId}/assets?per_page=100`, "-q", '.[] | "\\(.name)\\t\\(.created_at)"'])
      .split("\n").map((line) => line.trim().split("\t")).filter((pair) => pair.length === 2)
    : []);
  const settled = (name) => Date.now() - Date.parse(born.get(name) ?? "") > YOUNG_CHUNK_MS;
  for (const name of plan.stale.filter(settled)) {
    try {
      run(["release", "delete-asset", tag, name, "-R", repo, "--yes"]);
    } catch (error) {
      console.warn(`${name} could not be removed: ${String(error?.stderr || error?.message || error).trim().split("\n")[0]}`);
    }
  }
  if (plan.stale.length) console.log(`${tag}: ${plan.stale.filter(settled).length} of ${plan.stale.length} chunk(s) no manifest names were removed (the rest are too new to be sure of)`);
}
