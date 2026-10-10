/*! Open Historia — map-asset download tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/mapAssetsFetch.test.js
//
// scripts/fetch-map-assets.mjs downloads the world map from the map-data
// release; electron/main.cjs decides from the same manifest whether the setup
// window is needed, and the server reads the files from OH_ASSETS_DIR and
// OH_DATA_DIR. All three have to agree on where a file lives: a packaged beta
// downloaded into its own folder while its server read the stable app's, so the
// map never rendered however often it downloaded.
//
// electron/main.cjs requires electron and cannot be imported by `node --test`,
// so its map-data helpers are sliced out of it and evaluated with their
// dependencies in scope (as desktopPortProbe.test.js does).

import assert from "node:assert/strict";
import crypto, { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import url from "node:url";
import { resolveAssetTarget, syncMapAssets } from "../scripts/fetch-map-assets.mjs";

const MANIFEST = JSON.parse(fs.readFileSync(new URL("../scripts/map-assets.json", import.meta.url), "utf8"));

const source = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const start = source.indexOf("const assetTarget = (assetPath) => {");
const end = source.indexOf("// The fetcher reports a file it could not get");
assert.ok(start !== -1 && end > start, "could not find the map-data helpers in electron/main.cjs");
const desktop = ({ assetsDir, dataDir, userRoot, manifestPath, logMain = () => {} }) => new Function(
  "path", "fs", "crypto", "logMain", "ASSETS_DIR", "DATA_DIR", "USER_ROOT", "MANIFEST",
  `${source.slice(start, end)}\nreturn { assetTarget, missingAssets, relocateLegacyStockMap, relocateOwnFolderMap };`,
)(path, fs, crypto, logMain, assetsDir, dataDir, userRoot, manifestPath);

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-map-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// A packaged beta: its own userData, the stable app's assets folder.
const betaLayout = (dir) => {
  const userRoot = path.join(dir, "Open Historia Beta");
  return {
    userRoot,
    dataDir: path.join(userRoot, "server", "data"),
    assetsDir: path.join(dir, "open-historia", "public", "assets"),
  };
};

// A small manifest of real bytes, served by a fake release.
const fakeRelease = (files) => {
  const assets = Object.entries(files).map(([assetPath, text]) => ({
    path: assetPath,
    asset: path.posix.basename(assetPath),
    bytes: Buffer.byteLength(text),
    sha256: sha(text),
  }));
  const byName = new Map(assets.map((asset, index) => [asset.asset, Object.values(files)[index]]));
  const requests = [];
  const fetchImpl = async (url) => {
    const name = decodeURIComponent(url.split("/").pop());
    requests.push(name);
    return byName.has(name) ? new Response(byName.get(name)) : new Response("missing", { status: 404 });
  };
  return { manifest: { owner: "o", repo: "r", release: "map-data", assets }, fetchImpl, requests };
};

test("manifest paths land in the folders the server reads", () => {
  const opts = { root: "/app", assetsDir: "/shared/public/assets", dataDir: "/app/own/data" };
  assert.equal(resolveAssetTarget("public/assets/regions.pmtiles", opts), path.resolve("/shared/public/assets/regions.pmtiles"));
  assert.equal(resolveAssetTarget("server/data/stock/regions.geojson", opts), path.resolve("/app/own/data/stock/regions.geojson"));
  assert.equal(resolveAssetTarget("other/file.bin", opts), path.resolve("/app/other/file.bin"));
  // Unset folders fall back to the project root, as a source checkout expects.
  assert.equal(resolveAssetTarget("public/assets/regions.pmtiles", { root: "/app" }), path.resolve("/app/public/assets/regions.pmtiles"));
});

test("a manifest path that climbs out of its folder is refused", () => {
  const opts = { root: "/app", assetsDir: "/shared/assets", dataDir: "/app/data" };
  assert.equal(resolveAssetTarget("public/assets/../../escape.bin", opts), null);
  assert.equal(resolveAssetTarget("../escape.bin", opts), null);
});

test("the desktop setup check and the fetcher agree on every shipped map file", (t) => {
  const layout = betaLayout(tempDir(t));
  const { assetTarget } = desktop({ ...layout, manifestPath: "" });
  for (const asset of MANIFEST.assets) {
    assert.equal(
      assetTarget(asset.path),
      resolveAssetTarget(asset.path, { root: layout.userRoot, assetsDir: layout.assetsDir, dataDir: layout.dataDir }),
      asset.path,
    );
  }
  // The pmtiles the server serves live in the shared folder, not the beta's own.
  assert.equal(assetTarget("public/assets/regions.pmtiles"), path.join(layout.assetsDir, "regions.pmtiles"));
});

test("a beta's download lands in the shared folder, and its next launch needs no setup", async (t) => {
  const dir = tempDir(t);
  const layout = betaLayout(dir);
  const release = fakeRelease({
    "public/assets/regions.pmtiles": "regions archive",
    "server/data/stock/regions.geojson": "{\"type\":\"FeatureCollection\"}",
  });
  const manifestPath = path.join(dir, "map-assets.json");
  fs.writeFileSync(manifestPath, JSON.stringify(release.manifest));
  const { missingAssets } = desktop({ ...layout, manifestPath });
  assert.equal(missingAssets().length, 2);

  const result = await syncMapAssets({
    manifest: release.manifest,
    root: layout.userRoot,
    assetsDir: layout.assetsDir,
    dataDir: layout.dataDir,
    ensure: true,
    fetchImpl: release.fetchImpl,
    log: () => {},
    warn: () => {},
  });
  assert.equal(result.downloaded, 2);
  assert.equal(fs.readFileSync(path.join(layout.assetsDir, "regions.pmtiles"), "utf8"), "regions archive");
  assert.ok(fs.existsSync(path.join(layout.dataDir, "stock", "regions.geojson")));
  assert.equal(fs.existsSync(path.join(layout.userRoot, "public")), false, "nothing written to the beta's own public/");
  assert.deepEqual(missingAssets(), []);
});

test("run as a script, it honours OH_ASSETS_DIR and OH_DATA_DIR and still exits 0 when every download fails", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const dir = tempDir(t);
  const layout = betaLayout(dir);
  fs.mkdirSync(layout.userRoot, { recursive: true });
  // No network in tests: fetch is replaced before the script runs.
  const offline = "data:text/javascript,globalThis.fetch=async()=>{throw new Error('offline test')}";
  const script = new URL("../scripts/fetch-map-assets.mjs", import.meta.url);
  const run = spawnSync(process.execPath, ["--import", offline, url.fileURLToPath(script), "--ensure"], {
    cwd: layout.userRoot,
    env: { ...process.env, OH_ASSETS_DIR: layout.assetsDir, OH_DATA_DIR: layout.dataDir },
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.match(run.stderr, /could not download regions-z8\.pmtiles|could not download regions\.pmtiles/);
  assert.match(run.stderr, /offline test/);
  assert.equal(fs.existsSync(path.join(layout.userRoot, "public")), false);
});

// A response that arrives in `parts` chunks, the way a real download does.
const chunked = (text, parts) => {
  const bytes = Buffer.from(text);
  const size = Math.ceil(bytes.length / parts);
  let at = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(new Uint8Array(bytes.subarray(at, at + size)));
      at += size;
    },
  }));
};

test("--progress streams the file and reports it in the lines the setup window reads", async (t) => {
  const dir = tempDir(t);
  const text = "x".repeat(1000);
  const asset = { path: "public/assets/regions.pmtiles", asset: "regions-z8.pmtiles", bytes: 1000, sha256: sha(text) };
  const lines = [];
  let clock = 0;
  const result = await syncMapAssets({
    manifest: { owner: "o", repo: "r", release: "map-data", assets: [asset] },
    root: dir,
    progress: true,
    progressEveryMs: 250,
    now: () => (clock += 100),
    fetchImpl: async () => chunked(text, 20),
    log: (line) => lines.push(line),
    warn: () => {},
  });
  assert.equal(result.downloaded, 1);
  assert.equal(fs.readFileSync(path.join(dir, "public", "assets", "regions.pmtiles"), "utf8"), text);

  const reports = lines.filter((line) => line.startsWith("@progress ")).map((line) => JSON.parse(line.slice("@progress ".length)));
  // The shape electron/main.cjs destructures: { asset, received, total }.
  for (const report of reports) assert.deepEqual(Object.keys(report).sort(), ["asset", "received", "total"]);
  assert.deepEqual(reports[0], { asset: "regions-z8.pmtiles", received: 0, total: 1000 });
  assert.deepEqual(reports.at(-1), { asset: "regions-z8.pmtiles", received: 1000, total: 1000 });
  const between = reports.slice(1, -1);
  assert.ok(between.length > 0, "progress is reported while the file arrives");
  assert.ok(between.length < 20, "throttled, not one line per chunk");
  assert.ok(between.every((report, index) => index === 0 || report.received > between[index - 1].received));
});

test("without --progress no progress lines are printed", async (t) => {
  const dir = tempDir(t);
  const release = fakeRelease({ "public/assets/cities.pmtiles": "cities" });
  const lines = [];
  await syncMapAssets({ manifest: release.manifest, root: dir, fetchImpl: release.fetchImpl, log: (line) => lines.push(line), warn: () => {} });
  assert.equal(lines.some((line) => line.startsWith("@progress")), false);
});

test("a download that fails its checksum leaves nothing behind and is reported", async (t) => {
  const dir = tempDir(t);
  const asset = { path: "public/assets/regions.pmtiles", asset: "regions.pmtiles", bytes: 5, sha256: sha("right") };
  const warnings = [];
  const lines = [];
  const result = await syncMapAssets({
    manifest: { owner: "o", repo: "r", release: "map-data", assets: [asset] },
    root: dir,
    progress: true,
    // A clock that stands still: no progress line falls due while the bytes
    // arrive, so the only line that could say "received 5" is the one printed
    // for a finished file. On the real clock a slow disk let 250 ms pass
    // between the first line and the bytes, and that ordinary progress line
    // failed the check below whenever the whole suite ran at once.
    now: () => 0,
    fetchImpl: async () => new Response("wrong"),
    log: (line) => lines.push(line),
    warn: (line) => warnings.push(line),
  });
  assert.deepEqual([result.downloaded, result.failed], [0, 1]);
  assert.deepEqual(fs.readdirSync(path.join(dir, "public", "assets")), []);
  assert.match(warnings.join("\n"), /could not download regions\.pmtiles \(checksum mismatch\)/);
  assert.equal(lines.some((line) => line.includes('"received":5')), false, "no finished line for a failed file");
});

// One right-size file on disk, and a release that serves the published bytes.
const oneFileInstall = (t, onDisk) => {
  const dir = tempDir(t);
  const published = "published archive bytes";
  const asset = { path: "public/assets/regions.pmtiles", asset: "regions.pmtiles", bytes: Buffer.byteLength(published), sha256: sha(published) };
  const target = path.join(dir, "public", "assets", "regions.pmtiles");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, onDisk);
  const fetched = [];
  const run = (extra = {}) => syncMapAssets({
    manifest: { owner: "o", repo: "r", release: "map-data", assets: [asset] },
    root: dir,
    ensure: true,
    stateFile: path.join(dir, ".map-assets-verified.json"),
    fetchImpl: async (u) => { fetched.push(u); return new Response(published); },
    log: () => {},
    warn: () => {},
    ...extra,
  });
  return { dir, asset, target, published, fetched, run };
};

test("--ensure repairs a right-size file with the wrong bytes, then remembers the good one", async (t) => {
  const install = oneFileInstall(t, "damaged archive by tes!");
  assert.equal(fs.statSync(install.target).size, install.asset.bytes, "same length as the published file");

  const first = await install.run();
  assert.deepEqual([first.downloaded, first.present], [1, 0]);
  assert.equal(fs.readFileSync(install.target, "utf8"), install.published);
  const stamps = JSON.parse(fs.readFileSync(path.join(install.dir, ".map-assets-verified.json"), "utf8"));
  assert.equal(stamps[install.target].sha256, install.asset.sha256);

  const second = await install.run();
  assert.deepEqual([second.downloaded, second.present], [0, 1]);
  assert.equal(install.fetched.length, 1, "a verified file is not fetched again");
});

test("--ensure trusts a stamp only while the file is unchanged since it was verified", async (t) => {
  const install = oneFileInstall(t, "published archive bytes");
  await install.run();
  assert.equal(install.fetched.length, 0, "the right bytes were hashed and kept");

  // Damage it in place, keeping the length: the mtime moves, so it is hashed again.
  fs.writeFileSync(install.target, "published archive BYTES");
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(install.target, later, later);
  const result = await install.run();
  assert.equal(result.downloaded, 1);
  assert.equal(fs.readFileSync(install.target, "utf8"), install.published);
});

test("a stamp for other bytes than the manifest's is not trusted", async (t) => {
  const install = oneFileInstall(t, "published archive bytes");
  const info = fs.statSync(install.target);
  fs.writeFileSync(path.join(install.dir, ".map-assets-verified.json"), JSON.stringify({
    [install.target]: { sha256: sha("an older map"), size: info.size, mtimeMs: info.mtimeMs },
  }));
  const result = await install.run();
  assert.deepEqual([result.present, result.downloaded], [1, 0], "hashed again, and it is the published file");
  const stamps = JSON.parse(fs.readFileSync(path.join(install.dir, ".map-assets-verified.json"), "utf8"));
  assert.equal(stamps[install.target].sha256, install.asset.sha256);
});

test("the desktop downloads the same z8 map archives the website and the Android app carry", () => {
  const android = JSON.parse(fs.readFileSync(new URL("../scripts/map-assets.web.json", import.meta.url), "utf8"));
  const pmtiles = (list) => Object.fromEntries(list.assets
    .filter((asset) => asset.path.endsWith(".pmtiles"))
    .map((asset) => [path.posix.basename(asset.path), { asset: asset.asset, bytes: asset.bytes, sha256: asset.sha256 }]));
  assert.deepEqual(pmtiles(MANIFEST), pmtiles(android));
  assert.equal(pmtiles(MANIFEST)["regions.pmtiles"].asset, "regions-z8.pmtiles");
});

// --- a beta that downloaded its map under the old rule ---
//
// Before the folders agreed, a packaged beta's setup download wrote the whole
// map under its own userData and its server never read it (a player's beta
// 0.0.66 log: "No PMTiles archive available" at every launch). That install
// still holds the map. It is moved to the folder the server reads rather than
// downloaded a second time.

// A beta install as the old rule left it: every manifest file under userData.
const oldRuleBeta = (t, files) => {
  const dir = tempDir(t);
  const layout = betaLayout(dir);
  const release = fakeRelease(files);
  const manifestPath = path.join(dir, "map-assets.json");
  fs.writeFileSync(manifestPath, JSON.stringify(release.manifest));
  const own = (assetPath) => path.join(layout.userRoot, assetPath);
  for (const [assetPath, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(own(assetPath)), { recursive: true });
    fs.writeFileSync(own(assetPath), text);
  }
  const logged = [];
  const shell = desktop({ ...layout, manifestPath, logMain: (level, event, message, data) => logged.push({ level, event, message, data }) });
  return { ...shell, layout, release, own, logged, shared: (name) => path.join(layout.assetsDir, name) };
};

const SHIPPED = {
  "public/assets/regions.pmtiles": "regions archive",
  "public/assets/cities.pmtiles": "cities archive",
  "server/data/stock/regions.geojson": "{\"type\":\"FeatureCollection\"}",
};

test("a map the beta downloaded into its own folder is moved to the shared one, not downloaded again", async (t) => {
  const install = oldRuleBeta(t, SHIPPED);
  assert.deepEqual(install.missingAssets().map((asset) => asset.asset), ["regions.pmtiles", "cities.pmtiles"], "the server's folder is empty");

  assert.deepEqual(install.relocateOwnFolderMap(), ["regions.pmtiles", "cities.pmtiles"]);
  assert.deepEqual(install.missingAssets(), [], "so the setup window is not shown");
  assert.equal(fs.readFileSync(install.shared("regions.pmtiles"), "utf8"), "regions archive");
  assert.equal(fs.readFileSync(install.shared("cities.pmtiles"), "utf8"), "cities archive");
  assert.equal(fs.existsSync(install.own("public/assets/regions.pmtiles")), false, "moved, not copied");
  // The stock map is the beta's own under both rules and stays where it is.
  assert.equal(fs.readFileSync(install.own("server/data/stock/regions.geojson"), "utf8"), SHIPPED["server/data/stock/regions.geojson"]);
  assert.deepEqual(install.logged.map((entry) => [entry.level, entry.event, entry.data]), [["info", "map.relocated", { assets: ["regions.pmtiles", "cities.pmtiles"] }]]);

  // Neither the setup download nor the background check asks the release for anything.
  const result = await syncMapAssets({
    manifest: install.release.manifest,
    root: install.layout.userRoot,
    assetsDir: install.layout.assetsDir,
    dataDir: install.layout.dataDir,
    fetchImpl: install.release.fetchImpl,
    log: () => {},
    warn: () => {},
  });
  assert.deepEqual([result.present, result.downloaded, result.failed], [3, 0, 0]);
  assert.deepEqual(install.release.requests, []);

  // A second launch finds nothing to do, and says nothing.
  assert.deepEqual(install.relocateOwnFolderMap(), []);
  assert.equal(install.logged.length, 1);
});

test("only the published bytes are moved into the folder the stable app reads too", (t) => {
  const install = oldRuleBeta(t, SHIPPED);
  // The right length, other contents: the setup check would pass it for good.
  fs.writeFileSync(install.own("public/assets/regions.pmtiles"), "regions ARCHIVE");
  // Another length: unfinished, or a file the player put there.
  fs.writeFileSync(install.own("public/assets/cities.pmtiles"), "cities");

  assert.deepEqual(install.relocateOwnFolderMap(), []);
  assert.equal(fs.existsSync(install.shared("regions.pmtiles")), false);
  assert.equal(fs.existsSync(install.shared("cities.pmtiles")), false);
  assert.equal(fs.readFileSync(install.own("public/assets/regions.pmtiles"), "utf8"), "regions ARCHIVE", "left where it was");
  assert.deepEqual(install.missingAssets().map((asset) => asset.asset), ["regions.pmtiles", "cities.pmtiles"], "and the download fetches both");
  assert.deepEqual(install.logged, []);
});

test("a file the shared folder already holds is left alone, and one it holds wrongly is replaced", (t) => {
  const install = oldRuleBeta(t, SHIPPED);
  fs.mkdirSync(install.layout.assetsDir, { recursive: true });
  // The stable app is installed and has this one: nothing to do for it.
  fs.writeFileSync(install.shared("regions.pmtiles"), "regions archive");
  const stamp = new Date(Date.now() - 60_000);
  fs.utimesSync(install.shared("regions.pmtiles"), stamp, stamp);
  const written = fs.statSync(install.shared("regions.pmtiles")).mtimeMs;
  // And a download of this one that stopped part-way.
  fs.writeFileSync(install.shared("cities.pmtiles"), "citi");

  assert.deepEqual(install.relocateOwnFolderMap(), ["cities.pmtiles"]);
  assert.equal(fs.statSync(install.shared("regions.pmtiles")).mtimeMs, written, "the stable app's file was not touched");
  assert.equal(fs.existsSync(install.own("public/assets/regions.pmtiles")), true, "and the beta's copy of it is still its own");
  assert.equal(fs.readFileSync(install.shared("cities.pmtiles"), "utf8"), "cities archive");
  assert.deepEqual(install.missingAssets(), []);
});

test("a build whose own folder is the folder its server reads moves nothing", (t) => {
  // The stable app, an unpackaged run, and a beta with nothing downloaded yet.
  const dir = tempDir(t);
  const userRoot = path.join(dir, "open-historia");
  const release = fakeRelease(SHIPPED);
  const manifestPath = path.join(dir, "map-assets.json");
  fs.writeFileSync(manifestPath, JSON.stringify(release.manifest));
  for (const [assetPath, text] of Object.entries(SHIPPED)) {
    fs.mkdirSync(path.dirname(path.join(userRoot, assetPath)), { recursive: true });
    fs.writeFileSync(path.join(userRoot, assetPath), text);
  }
  const stable = desktop({ userRoot, dataDir: path.join(userRoot, "server", "data"), assetsDir: path.join(userRoot, "public", "assets"), manifestPath });
  assert.deepEqual(stable.relocateOwnFolderMap(), []);
  assert.deepEqual(stable.missingAssets(), []);
  assert.equal(fs.readFileSync(path.join(userRoot, "public", "assets", "regions.pmtiles"), "utf8"), "regions archive");

  const fresh = desktop({ ...betaLayout(tempDir(t)), manifestPath });
  assert.deepEqual(fresh.relocateOwnFolderMap(), []);
  assert.equal(fresh.missingAssets().length, 3);
  // No manifest at all is not a reason to fail a launch.
  assert.deepEqual(desktop({ ...betaLayout(tempDir(t)), manifestPath: path.join(dir, "absent.json") }).relocateOwnFolderMap(), []);
});

test("the map already downloaded is moved before the launch decides what is missing", () => {
  const boot = source.slice(source.indexOf("const boot = async () => {"));
  const moved = boot.indexOf("relocateOwnFolderMap();");
  const checked = boot.indexOf("missingAssets()");
  assert.ok(moved !== -1 && checked !== -1 && moved < checked);
});
