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
//   node scripts/publish-update-chunks.mjs --prune-only --tag <release tag> --repo <owner/name>
//
// The head goes last, and replaces the one before it (it is the one file here
// with a fixed name): an app is never told of a build whose manifest and chunks
// are not all there yet.
//
// A release holds 1,000 files at most, so the chunks of builds nobody is
// pointed at any more have to come off. --prune-only does that and nothing
// else: it removes the chunks and manifests no head on the release leads to.
// The release workflows run it as their last job, once every system's build of
// the release is up, so it never runs beside a publish of the same release.
// (--prune-unreferenced does the same at the end of a publish, for a release
// made by hand from one machine.) Two things are never removed: anything a
// head leads to, and anything uploaded in the last six hours, which a publish
// still under way somewhere may be about to name.
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

// Named by its content: a chunk or a manifest. Only these are ever uploaded
// once and never replaced, and only these are ever removed.
const byContent = (name) => CHUNK_NAME.test(name) || MANIFEST_NAME.test(name);

// What to upload and what may go, from what the folder holds and what the
// release holds. Pure, so the rules are tested without a release.
//   local:      names in the folder (none, when only pruning)
//   remote:     names on the release
//   referenced: the manifests the heads that will be on the release name (the
//               ones already there for other systems, and this one's), and
//               the chunks those manifests name
export const planPublish = ({ local, remote, referenced = null }) => {
  const have = new Set(remote);
  const heads = local.filter((name) => HEAD_NAME.test(name));
  const upload = local.filter(byContent).filter((name) => !have.has(name)).sort();
  const stale = referenced
    ? remote.filter((name) => byContent(name) && !referenced.has(name)).sort()
    : [];
  const after = new Set([...remote, ...upload, ...heads]).size - stale.length;
  return { upload, heads, stale, after, full: after > RELEASE_FILE_LIMIT - ROOM_KEPT };
};

// Of the files that may go, the ones old enough to be sure of.
//   born: Map(name -> when it was uploaded, as the release says it)
export const settledStale = (stale, born, now = Date.now()) => stale.filter((name) => {
  const at = Date.parse(born.get(name) ?? "");
  return Number.isFinite(at) && now - at > YOUNG_CHUNK_MS;
});

const run = (args, options = {}) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26, ...options });
const firstLine = (error) => String(error?.stderr || error?.message || error).trim().split("\n")[0];

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : "";
  };
  const pruneOnly = args.includes("--prune-only");
  const prune = pruneOnly || args.includes("--prune-unreferenced");
  const dir = pruneOnly ? "" : path.resolve(flag("--dir") || ".");
  const tag = flag("--tag");
  const repo = flag("--repo");
  if (!tag || !repo || (!pruneOnly && (!flag("--dir") || !fs.existsSync(dir)))) {
    console.error("usage: publish-update-chunks.mjs --dir <folder> --tag <release tag> --repo <owner/name> [--prune-unreferenced]\n       publish-update-chunks.mjs --prune-only --tag <release tag> --repo <owner/name>");
    process.exit(2);
  }

  // The release the chunks live on: one per channel, apart from the installers'
  // own, so the page a player downloads the game from stays a short list.
  let exists = true;
  try {
    run(["release", "view", tag, "-R", repo, "--json", "tagName"]);
  } catch {
    exists = false;
  }
  if (!exists && pruneOnly) {
    console.log(`${tag}: no such release, so nothing to remove`);
    process.exit(0);
  }
  if (!exists) {
    run([
      "release", "create", tag, "-R", repo, "--latest=false",
      "--title", "Open Historia update chunks",
      "--notes", "The app's own files, cut into chunks. The desktop app reads these to update itself by fetching only what changed. Nothing here is for downloading by hand: the installers are on the release this one is named after.",
    ]);
  }
  const releaseId = run(["api", `repos/${repo}/releases/tags/${tag}`, "-q", ".id"]).trim();
  const assets = (query) => run(["api", "--paginate", `repos/${repo}/releases/${releaseId}/assets?per_page=100`, "-q", query]).split("\n").map((line) => line.trim()).filter(Boolean);
  const listRemote = () => assets(".[].name");

  const local = pruneOnly ? [] : fs.readdirSync(dir);
  let remote = listRemote();

  // What every head leads to once this publish is done: the heads as they stand
  // on the release, the ones in the folder in place of theirs, each one's
  // manifest, and the chunks that manifest names.
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
    // No head at all is a release nothing reads yet, or one that cannot be
    // read: either way nothing on it is known to be unneeded.
    if (!referenced.size) referenced = null;
  }

  const plan = planPublish({ local, remote, referenced });
  if (!pruneOnly) {
    if (plan.full) {
      console.error(`The release ${tag} would hold ${plan.after} files, and a release holds ${RELEASE_FILE_LIMIT}. Remove the chunks no build names any more first: publish-update-chunks.mjs --prune-only --tag ${tag} --repo ${repo}`);
      process.exit(1);
    }
    const needed = local.filter(byContent);
    console.log(`${tag}: ${plan.upload.length} file(s) to upload, ${needed.length - plan.upload.length} already there`);
    const upload = (names) => {
      for (let start = 0; start < names.length; start += BATCH) {
        const batch = names.slice(start, start + BATCH);
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
              console.warn(`${name}: ${firstLine(error)}`);
            }
          }
        }
      }
    };
    upload(plan.upload);
    // Everything this build is made of has to be on the release before any app
    // is told of it: what was uploaded just now, and what was already there
    // when this began and may have come off since.
    remote = listRemote();
    let missing = needed.filter((name) => !remote.includes(name));
    if (missing.length) {
      upload(missing);
      remote = listRemote();
      missing = needed.filter((name) => !remote.includes(name));
    }
    if (missing.length) {
      console.error(`${missing.length} file(s) did not reach the release (${missing.slice(0, 3).join(", ")}...). The head was not published, so no app is pointed at them.`);
      process.exit(1);
    }

    // Only now is any app told about this build.
    for (const name of plan.heads) run(["release", "upload", tag, "-R", repo, path.join(dir, name), "--clobber"]);
    console.log(`${tag}: ${plan.heads.join(", ")} published`);
  }

  if (plan.stale.length) {
    const born = new Map(assets('.[] | "\\(.name)\\t\\(.created_at)"').map((line) => line.split("\t")).filter((pair) => pair.length === 2));
    const going = settledStale(plan.stale, born);
    let gone = 0;
    for (const name of going) {
      try {
        run(["release", "delete-asset", tag, name, "-R", repo, "--yes"]);
        gone += 1;
      } catch (error) {
        console.warn(`${name} could not be removed: ${firstLine(error)}`);
      }
    }
    console.log(`${tag}: ${gone} of ${plan.stale.length} file(s) no build names were removed${going.length < plan.stale.length ? " (the rest are too new to be sure of)" : ""}`);
  } else if (prune) {
    console.log(`${tag}: nothing to remove`);
  }
}
