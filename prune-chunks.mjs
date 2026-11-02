import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const update = await import(pathToFileURL(path.join(here, "sidecar", "handlers", "update.mjs")).href);
const kit = await import(pathToFileURL(path.join(here, "sidecar", "updateChunks.mjs")).href);

const REPO = "Open-Historia/open-historia";
const TAG = update.NATIVE_UPDATE_TAG;
const CHUNK_TAG = update.NATIVE_CHUNKS_TAG;
const FEEDS = [
  { platform: "windows", name: update.NATIVE_MANIFEST_NAME },
  { platform: "macos", name: update.NATIVE_MAC_MANIFEST_NAME },
  { platform: "linux", name: update.NATIVE_LINUX_MANIFEST_NAME },
];
const CHUNK_NAME = /^c-[0-9a-f]{40}\.bin$/;
const FILE_LIST_NAME = /^(mac-|linux-)?m-[0-9a-f]{40}\.json$/;
const YOUNG_MS = 6 * 60 * 60 * 1000;
const MOST_REMOVED = 0.9;
const BATCH = 50;

const prune = process.argv.includes("--prune");
let removed = 0;
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const gh = (args, encoding = "utf8") => execFileSync("gh", args, { encoding, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
const firstLine = (error) => String(error?.stderr || error?.message || error).trim().split("\n")[0];
const stop = (problems) => {
  for (const problem of [].concat(problems)) process.stderr.write(`prune-chunks: ${problem}\n`);
  process.stderr.write(removed ? `prune-chunks: stopped after removing ${removed} file(s)\n` : "prune-chunks: nothing was removed\n");
  process.exit(1);
};
const download = (tag, name) => gh(["release", "download", tag, "-R", REPO, "--pattern", name, "--output", "-"], "buffer");

const readFeed = ({ platform, name }) => {
  let raw;
  try {
    raw = JSON.parse(download(TAG, name).toString("utf8"));
  } catch (error) {
    return { error: `${name} on ${TAG} cannot be read: ${firstLine(error)}` };
  }
  const feed = update.parseManifest(raw, { platform });
  if (!feed) return { error: `${name} on ${TAG} is not a ${platform} feed the app can read` };
  if (!feed.chunks) return { error: `${name} on ${TAG} names no file list` };
  return { feed };
};

const readFileList = (named) => {
  let bytes;
  try {
    bytes = download(CHUNK_TAG, named.name);
  } catch (error) {
    return { error: `${named.name} on ${CHUNK_TAG} cannot be read: ${firstLine(error)}` };
  }
  if (named.size !== undefined && (bytes.length !== named.size || sha256(bytes) !== named.sha256)) return { error: `${named.name} on ${CHUNK_TAG} is not the file list its feed names` };
  let read;
  try {
    read = kit.readManifest(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    return { error: `${named.name} on ${CHUNK_TAG} is not JSON: ${firstLine(error)}` };
  }
  if (!read.manifest) return { error: `${named.name} on ${CHUNK_TAG}: ${read.error}` };
  return { manifest: read.manifest, chunks: Object.keys(read.manifest.chunks).map(kit.chunkAssetName) };
};

const listAssets = () => {
  const releaseId = gh(["api", `repos/${REPO}/releases/tags/${CHUNK_TAG}`, "--jq", ".id"]).trim();
  if (!/^\d+$/.test(releaseId)) stop(`${CHUNK_TAG} has no release id`);
  return gh(["api", "--paginate", `repos/${REPO}/releases/${releaseId}/assets?per_page=100`, "--jq", '.[] | [.id, .name, .size, .created_at, .updated_at] | @tsv'])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name, size, created, updated] = line.split("\t");
      const at = Math.max(Date.parse(created), Date.parse(updated));
      return { id, name, size: Number(size), at: Number.isFinite(at) ? at : Date.now() };
    });
};

const liveHeads = () => {
  const heads = FEEDS.map((entry) => ({ ...entry, ...readFeed(entry) }));
  const problems = heads.filter((head) => head.error).map((head) => head.error);
  if (problems.length) stop(problems.concat("every system's feed has to be readable before anything is removed"));
  for (const head of heads) {
    const list = readFileList(head.feed.chunks.manifest);
    if (list.error) stop(list.error);
    if (String(list.manifest.build) !== head.feed.build) stop(`${head.feed.chunks.manifest.name} describes build ${list.manifest.build}, ${head.name} build ${head.feed.build}`);
    if (update.feedPlatformOf(list.manifest) !== head.platform) stop(`${head.feed.chunks.manifest.name} is a ${update.feedPlatformOf(list.manifest)} file list, ${head.name} is for ${head.platform}`);
    Object.assign(head, list);
  }
  return heads;
};

const sameHeads = (before) => liveHeads().every((head, at) => head.feed.build === before[at].feed.build && head.feed.chunks.manifest.name === before[at].feed.chunks.manifest.name);

const heads = liveHeads();
const assets = listAssets();
const now = Date.now();
const onRelease = new Map(assets.map((asset) => [asset.name, asset]));
const keep = new Set();
let missing = 0;
for (const head of heads) {
  const listName = head.feed.chunks.manifest.name;
  keep.add(listName);
  for (const name of head.chunks) keep.add(name);
  const absent = head.chunks.filter((name) => !onRelease.has(name));
  missing += absent.length + (onRelease.has(listName) ? 0 : 1);
  console.log(`${head.name}: build ${head.feed.build}, file list ${listName}${onRelease.has(listName) ? "" : " (NOT on the release)"}, ${head.chunks.length} pieces, ${absent.length ? `${absent.length} NOT on the release: ${absent.slice(0, 5).join(" ")}` : "all on the release"}`);
}
const young = assets.filter((asset) => now - asset.at <= YOUNG_MS);
for (const asset of young.filter((entry) => FILE_LIST_NAME.test(entry.name) && !keep.has(entry.name))) {
  const list = readFileList({ name: asset.name });
  if (list.error) stop(list.error);
  for (const name of list.chunks) keep.add(name);
}
const youngNames = new Set(young.map((asset) => asset.name));
const removable = (asset) => (CHUNK_NAME.test(asset.name) || FILE_LIST_NAME.test(asset.name)) && !keep.has(asset.name) && !youngNames.has(asset.name);
const going = assets.filter(removable).sort((a, b) => a.name.localeCompare(b.name));
const goingBytes = going.reduce((sum, asset) => sum + asset.size, 0);
const kept = assets.filter((asset) => keep.has(asset.name)).length;
const sparedYoung = assets.filter((asset) => youngNames.has(asset.name) && !keep.has(asset.name)).length;
const other = assets.length - kept - sparedYoung - going.length;

console.log(`${CHUNK_TAG}: ${assets.length} files; ${kept} named by the live feeds, ${sparedYoung} more uploaded in the last six hours or named by a file list that was, ${other} not update pieces; ${going.length} to remove (${(goingBytes / 1048576).toFixed(1)} MB), leaving ${assets.length - going.length}`);
if (missing) process.stderr.write(`prune-chunks: ${missing} file(s) a live feed needs are not on ${CHUNK_TAG}\n`);
if (!keep.size) stop("the live feeds name nothing, so nothing on the release is known to be unneeded");
if (going.length > assets.length * MOST_REMOVED) stop(`${going.length} of ${assets.length} files would go, more than ${Math.round(MOST_REMOVED * 100)}%; remove them by hand if that is right`);

if (!going.length) {
  console.log("nothing to remove");
} else if (!prune) {
  for (const asset of going) console.log(`would remove ${asset.name} ${asset.size} bytes`);
  console.log(`dry run: nothing was removed. Run again with --prune to remove these ${going.length} file(s).`);
} else {
  let gone = 0;
  let failed = 0;
  for (let start = 0; start < going.length; start += BATCH) {
    if (start > 0 && !sameHeads(heads)) {
      process.stderr.write("prune-chunks: a feed changed while pruning; stopping, the rest stay\n");
      break;
    }
    for (const asset of going.slice(start, start + BATCH)) {
      try {
        gh(["api", "-X", "DELETE", `repos/${REPO}/releases/assets/${asset.id}`]);
        gone += 1;
        removed = gone;
      } catch (error) {
        failed += 1;
        process.stderr.write(`prune-chunks: ${asset.name} could not be removed: ${firstLine(error)}\n`);
      }
    }
    console.log(`removed ${gone} of ${going.length}`);
  }
  const after = listAssets();
  const left = new Set(after.map((asset) => asset.name));
  const lost = [...keep].filter((name) => onRelease.has(name) && !left.has(name));
  console.log(`${CHUNK_TAG}: ${gone} file(s) removed${failed ? `, ${failed} could not be` : ""}; it holds ${after.length} files now`);
  if (lost.length) stop(`${lost.length} file(s) a live feed needs went missing while pruning: ${lost.slice(0, 5).join(" ")}`);
}
if (missing) process.exit(1);
