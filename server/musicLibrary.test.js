/*! Open Historia — the music kept on this machine: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/musicLibrary.test.js
//
// "Make it so if you already have a song downloaded from another scenario, it
// doesnt redownload it for you when another scenario uses the same song." And:
// "make sure songs arent deleted along with scenarios unless it is the only
// scenario to use the song."
//
// What is pinned: a track is kept by its sha256 and downloaded once, whoever
// asks and under whatever id or address; a wrong file or a failed download
// leaves nothing behind; two requests for the same missing track share one
// download; the limit drops what was played longest ago; the route serves byte
// ranges with an audio type; and the kept music follows the scenarios that use
// it, in the store's delete, save and Update.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, afterEach, beforeEach, test } from "node:test";

import {
  MUSIC_CONTENT_TYPES,
  MUSIC_TRACK_MAX_BYTES,
  keptMusicOverLimit,
  keptMusicUnused,
  keptMusicUsage,
  musicSha256,
  musicTracksDropped,
  musicTypeOfBytes,
  normalizeKeptMusic,
  usedMusicTrackIds,
  withKeptPlay,
} from "./keptMusic.js";
import {
  MUSIC_LIBRARY_MAX_BYTES,
  clearMusicLibrary,
  createMusicLibrary,
  musicLibraryUsage,
  sweepMusicLibrary,
  tidyMusicLibrary,
} from "./musicLibrary.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
const sha256Of = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// A track's bytes: an MP3's first bytes (an ID3 tag), or an Ogg file's, and then `size` of filler.
const mp3 = (seed, size = 2000) => Buffer.concat([Buffer.from("ID3\u0004"), Buffer.alloc(size, seed)]);
const ogg = (seed, size = 2000) => Buffer.concat([Buffer.from("OggS"), Buffer.alloc(size, seed)]);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-music-library-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});
const names = () => fs.readdirSync(dir).sort();
const indexOf = () => JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));

// The hub, standing in for the download: what is at each address, and how often each was asked for.
const hub = (files) => {
  const asked = [];
  const download = async (address, destination, maxBytes) => {
    asked.push(address);
    // Not at once: two requests made together must be able to overlap.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const bytes = files[address];
    if (!bytes) throw Object.assign(new Error("Hub file fetch failed (HTTP 404)."), { status: 502 });
    if (bytes.length > maxBytes) throw Object.assign(new Error("Scenario bundle is too large."), { status: 413 });
    fs.writeFileSync(destination, bytes);
    return bytes.length;
  };
  return { asked, download };
};

// ---- the record (keptMusic.js) --------------------------------------------------------

test("the record is read strictly, and a play is written down: when, and under which id", () => {
  const sha = "a".repeat(64);
  assert.equal(musicSha256(sha.toUpperCase()), sha);
  for (const bad of ["", "abc", "g".repeat(64), "a".repeat(63), null, 5]) assert.equal(musicSha256(bad), "", String(bad));
  assert.deepEqual(normalizeKeptMusic({
    [sha]: { type: "mp3", bytes: 10, playedAt: 5, ids: ["theme", "theme", "bad id", 7], previewed: 1, extra: true },
    nothing: { type: "mp3" },
    ["b".repeat(64)]: { type: "wav", bytes: 1 },
    ["c".repeat(64)]: "text",
  }), { [sha]: { type: "mp3", bytes: 10, playedAt: 5, ids: ["theme"], previewed: false } });
  assert.deepEqual(normalizeKeptMusic(null), {});
  assert.deepEqual(normalizeKeptMusic([1, 2]), {});

  // A game's play names the track; the editor's preview keeps it without naming it.
  let index = withKeptPlay({}, sha, { type: "ogg", bytes: 300, trackId: "theme", at: 1000 });
  assert.deepEqual(index[sha], { type: "ogg", bytes: 300, playedAt: 1000, ids: ["theme"], previewed: false });
  index = withKeptPlay(index, sha, { type: "mp3", bytes: 999, trackId: "theme-again", at: 2000 });
  assert.deepEqual(index[sha], { type: "ogg", bytes: 300, playedAt: 2000, ids: ["theme", "theme-again"], previewed: false }, "the same file, known under another id too");
  index = withKeptPlay(index, sha, { trackId: "never-written", preview: true, at: 1500 });
  assert.deepEqual(index[sha], { type: "ogg", bytes: 300, playedAt: 2000, ids: ["theme", "theme-again"], previewed: true });
  const previewOnly = withKeptPlay({}, sha, { type: "mp3", bytes: 1, trackId: "theme", preview: true, at: 1 });
  assert.deepEqual(previewOnly[sha].ids, [], "a preview does not make the track a scenario's");
  assert.equal(previewOnly[sha].previewed, true);
});

test("what a file is, by how it begins; and what it is served as", () => {
  assert.equal(musicTypeOfBytes(ogg(1)), "ogg");
  assert.equal(musicTypeOfBytes(mp3(1)), "mp3");
  assert.equal(musicTypeOfBytes(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), "mp3", "an MP3 with no tag begins with a frame");
  assert.equal(musicTypeOfBytes(new Uint8Array([1, 2])), "");
  assert.equal(musicTypeOfBytes(null), "");
  assert.deepEqual({ ...MUSIC_CONTENT_TYPES }, { mp3: "audio/mpeg", ogg: "audio/ogg" });
  assert.equal(MUSIC_TRACK_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(MUSIC_LIBRARY_MAX_BYTES, 1024 * 1024 * 1024);
});

test("past the limit the tracks played longest ago go first; in use is what the scenarios name", () => {
  const entry = (bytes, playedAt, ids = ["x"]) => ({ type: "mp3", bytes, playedAt, ids, previewed: false });
  const index = { old: entry(400, 10), middle: entry(400, 20), fresh: entry(400, 30) };
  assert.deepEqual(keptMusicUsage(index), { tracks: 3, bytes: 1200 });
  assert.deepEqual(keptMusicOverLimit(index, 1000), ["old"]);
  assert.deepEqual(keptMusicOverLimit(index, 500), ["old", "middle"]);
  assert.deepEqual(keptMusicOverLimit(index, 1200), []);
  assert.deepEqual(keptMusicOverLimit(index, 1000, "old"), ["middle"], "never the one just fetched");

  const used = usedMusicTrackIds([
    { loading: [{ id: "intro", version: 1 }], game: [{ id: "theme", version: 2 }], atWar: [], battle: [] },
    null,
    { game: [{ id: "theme", version: 1 }, { id: "march", version: 1 }] },
    "not a record",
  ]);
  assert.deepEqual([...used].sort(), ["intro", "march", "theme"]);
  const kept = {
    shared: entry(1, 1, ["theme"]),
    renamed: entry(1, 1, ["gone", "march"]),
    orphan: entry(1, 1, ["gone"]),
    preview: { ...entry(1, 1, []), previewed: true },
  };
  assert.deepEqual(keptMusicUnused(kept, used), ["orphan"]);
  assert.deepEqual(keptMusicUnused(kept, new Set()).sort(), ["orphan", "renamed", "shared"], "what was only previewed is nobody's, and stays");

  // The only saves a store sweeps after: ones that take a track out.
  const music = (...ids) => ({ game: ids.map((id) => ({ id, version: 1 })) });
  assert.equal(musicTracksDropped(music("a", "b"), music("a")), true);
  assert.equal(musicTracksDropped(music("a"), null), true);
  assert.equal(musicTracksDropped(music("a"), music("a", "b")), false, "adding a track drops none");
  assert.equal(musicTracksDropped(music("a", "b"), { loading: [{ id: "b", version: 2 }], game: [{ id: "a", version: 9 }] }), false, "moved to another situation, or another version: still named");
  assert.equal(musicTracksDropped(null, music("a")), false);
  assert.equal(musicTracksDropped(undefined, undefined), false);
});

// ---- the library --------------------------------------------------------------------

test("a miss downloads the track once; every later play is the kept file, whichever id or address asks", async () => {
  const bytes = mp3(7);
  const sha256 = sha256Of(bytes);
  const first = `${RELEASES}/music/theme-v1-0a1b2c3d.mp3`;
  const second = `${RELEASES}/music-2/the-same-song.mp3`;
  const { asked, download } = hub({ [first]: bytes, [second]: bytes });
  let now = 1_000_000;
  const library = createMusicLibrary({ dir, download, now: () => now });

  const miss = await library.keep({ sha256, url: first, trackId: "theme" });
  assert.equal(miss.downloaded, true);
  assert.equal(miss.contentType, "audio/mpeg");
  assert.equal(miss.bytes, bytes.length);
  assert.equal(miss.filePath, path.join(dir, `${sha256}.mp3`));
  assert.deepEqual(fs.readFileSync(miss.filePath), bytes);
  assert.deepEqual(names(), ["index.json", `${sha256}.mp3`].sort(), "the temporary download is gone");

  // Another scenario, another track id, another address, another day: no request.
  now += 86_400_000;
  const hit = await library.keep({ sha256: sha256.toUpperCase(), url: second, trackId: "the-same-song" });
  assert.equal(hit.downloaded, false);
  assert.equal(hit.filePath, miss.filePath);
  // Not even an address is needed for what is kept.
  assert.equal((await library.keep({ sha256 })).downloaded, false);
  assert.deepEqual(asked, [first]);
  assert.deepEqual(indexOf()[sha256], { type: "mp3", bytes: bytes.length, playedAt: now, ids: ["theme", "the-same-song"], previewed: false });
  assert.deepEqual(musicLibraryUsage(dir), { tracks: 1, bytes: bytes.length });

  // One play is several requests for ranges: the index is not rewritten for each.
  const written = fs.statSync(path.join(dir, "index.json")).mtimeMs;
  now += 500;
  await library.keep({ sha256, url: first, trackId: "theme" });
  assert.equal(fs.statSync(path.join(dir, "index.json")).mtimeMs, written);
});

test("an Ogg file is kept and served as one", async () => {
  const bytes = ogg(3);
  const sha256 = sha256Of(bytes);
  const address = `${RELEASES}/music/horns-v1.ogg`;
  const library = createMusicLibrary({ dir, download: hub({ [address]: bytes }).download });
  const kept = await library.keep({ sha256, url: address, trackId: "horns" });
  assert.equal(kept.contentType, "audio/ogg");
  assert.equal(path.basename(kept.filePath), `${sha256}.ogg`);
});

test("a file that is not the one asked for, or a download that fails, leaves nothing behind", async () => {
  const bytes = mp3(1);
  const address = `${RELEASES}/music/theme.mp3`;
  const gone = `${RELEASES}/music/gone.mp3`;
  const huge = `${RELEASES}/music/huge.mp3`;
  const { asked, download } = hub({ [address]: bytes, [huge]: Buffer.alloc(MUSIC_TRACK_MAX_BYTES + 1) });
  const library = createMusicLibrary({ dir, download });

  // The hub's list said another sha256 than the file has.
  await assert.rejects(library.keep({ sha256: "f".repeat(64), url: address, trackId: "theme" }), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /not the one that was asked for/);
    return true;
  });
  await assert.rejects(library.keep({ sha256: sha256Of(bytes), url: gone }), /HTTP 404/);
  await assert.rejects(library.keep({ sha256: "e".repeat(64), url: huge }), (error) => error.status === 413);
  assert.deepEqual(names(), [], "no file, no temporary file, no index");
  assert.deepEqual(musicLibraryUsage(dir), { tracks: 0, bytes: 0 });
  // A failure is not remembered: the right sha256 is fetched the next time it is asked for.
  assert.equal((await library.keep({ sha256: sha256Of(bytes), url: address })).downloaded, true);
  assert.deepEqual(asked, [address, gone, huge, address]);
});

test("only a file in the hub's own releases is ever asked for, and only by a sha256", async () => {
  const { asked, download } = hub({});
  const library = createMusicLibrary({ dir, download });
  const sha256 = "a".repeat(64);
  for (const address of [
    "",
    "https://evil.example/x.mp3",
    "http://github.com/Open-Historia/Open-historia-scenarios/releases/download/music/x.mp3",
    "https://github.com/Someone-Else/Open-historia-scenarios/releases/download/music/x.mp3",
    "https://github.com/Open-Historia/Open-historia-scenarios/issues/1",
    `${RELEASES}/music/x.mp3?redirect=https://evil.example`,
  ]) {
    await assert.rejects(library.keep({ sha256, url: address }), (error) => error.status === 400, address);
  }
  for (const bad of ["", "../../etc/passwd", "abc", `${sha256}.mp3`, undefined]) {
    await assert.rejects(library.keep({ sha256: bad, url: `${RELEASES}/music/x.mp3` }), (error) => error.status === 400, String(bad));
  }
  assert.deepEqual(asked, [], "refused before any request");
  assert.deepEqual(names(), []);
});

test("two requests for the same missing track share one download", async () => {
  const bytes = mp3(9);
  const sha256 = sha256Of(bytes);
  const address = `${RELEASES}/music/theme.mp3`;
  const { asked, download } = hub({ [address]: bytes });
  const library = createMusicLibrary({ dir, download });
  const [one, two, three] = await Promise.all([
    library.keep({ sha256, url: address, trackId: "theme" }),
    library.keep({ sha256, url: address, trackId: "theme-in-another-scenario" }),
    library.keep({ sha256, url: `${RELEASES}/music/another-address.mp3`, trackId: "theme", preview: true }),
  ]);
  assert.deepEqual(asked, [address]);
  assert.deepEqual([one.downloaded, two.downloaded, three.downloaded], [true, false, false]);
  assert.equal(one.filePath, two.filePath);
  assert.deepEqual(names(), ["index.json", `${sha256}.mp3`].sort());
  assert.deepEqual(indexOf()[sha256].ids, ["theme", "theme-in-another-scenario"]);
  assert.equal(indexOf()[sha256].previewed, true);
  // And a failed one fails all who waited for it, and is asked for again afterwards.
  const missing = `${RELEASES}/music/missing.mp3`;
  const results = await Promise.allSettled([
    library.keep({ sha256: "d".repeat(64), url: missing }),
    library.keep({ sha256: "d".repeat(64), url: missing }),
  ]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.deepEqual(asked, [address, missing]);
});

test("past the limit, the tracks played longest ago make room for a new one", async () => {
  const tracks = ["a", "b", "c"].map((name, index) => {
    const bytes = mp3(index + 1, 1000);
    return { name, bytes, sha256: sha256Of(bytes), address: `${RELEASES}/music/${name}.mp3` };
  });
  const [a, b, c] = tracks;
  const { download } = hub(Object.fromEntries(tracks.map((track) => [track.address, track.bytes])));
  let now = 1000;
  // Room for two of them.
  const library = createMusicLibrary({ dir, download, maxBytes: 2100, now: () => now });
  await library.keep({ sha256: a.sha256, url: a.address, trackId: "a" });
  now += 100_000;
  await library.keep({ sha256: b.sha256, url: b.address, trackId: "b" });
  now += 100_000;
  // `a` is played again, so `b` is now the one played longest ago.
  await library.keep({ sha256: a.sha256, url: a.address, trackId: "a" });
  now += 100_000;
  await library.keep({ sha256: c.sha256, url: c.address, trackId: "c" });
  assert.deepEqual(names(), ["index.json", `${a.sha256}.mp3`, `${c.sha256}.mp3`].sort());
  assert.deepEqual(Object.keys(indexOf()).sort(), [a.sha256, c.sha256].sort());
  assert.deepEqual(musicLibraryUsage(dir), { tracks: 2, bytes: a.bytes.length + c.bytes.length });
  // One track larger than the whole limit is still kept while it plays: never the one just fetched.
  const small = createMusicLibrary({ dir, download, maxBytes: 10, now: () => now + 1 });
  await small.keep({ sha256: b.sha256, url: b.address, trackId: "b" });
  assert.deepEqual(names(), ["index.json", `${b.sha256}.mp3`].sort());
});

test("the sweep deletes what no scenario names any more, and leaves what was only previewed", async () => {
  const shared = mp3(1);
  const own = mp3(2);
  const tried = mp3(3);
  const files = { [`${RELEASES}/music/shared.mp3`]: shared, [`${RELEASES}/music/own.mp3`]: own, [`${RELEASES}/music/tried.mp3`]: tried };
  const library = createMusicLibrary({ dir, download: hub(files).download });
  await library.keep({ sha256: sha256Of(shared), url: `${RELEASES}/music/shared.mp3`, trackId: "shared" });
  await library.keep({ sha256: sha256Of(own), url: `${RELEASES}/music/own.mp3`, trackId: "own" });
  await library.keep({ sha256: sha256Of(tried), url: `${RELEASES}/music/tried.mp3`, trackId: "tried", preview: true });

  assert.deepEqual(sweepMusicLibrary(new Set(["shared", "own"]), dir), []);
  assert.deepEqual(sweepMusicLibrary(new Set(["shared"]), dir), [sha256Of(own)]);
  assert.deepEqual(names(), ["index.json", `${sha256Of(shared)}.mp3`, `${sha256Of(tried)}.mp3`].sort());
  assert.deepEqual(sweepMusicLibrary(new Set(), dir), [sha256Of(shared)]);
  assert.deepEqual(names(), ["index.json", `${sha256Of(tried)}.mp3`].sort(), "the previewed track is nobody's: the limit sees to it");
  assert.deepEqual(musicLibraryUsage(dir), { tracks: 1, bytes: tried.length });
});

test("clearing empties the library but leaves a download in progress; a library never made reads as empty", async () => {
  const bytes = mp3(4);
  const address = `${RELEASES}/music/theme.mp3`;
  const library = createMusicLibrary({ dir, download: hub({ [address]: bytes }).download });
  await library.keep({ sha256: sha256Of(bytes), url: address, trackId: "theme" });
  fs.writeFileSync(path.join(dir, `${"9".repeat(64)}.123.abc.tmp`), "in progress");
  assert.deepEqual(clearMusicLibrary(dir), { tracks: 0, bytes: 0 });
  assert.deepEqual(names(), [`${"9".repeat(64)}.123.abc.tmp`, "index.json"]);

  const missing = path.join(dir, "never");
  assert.deepEqual(musicLibraryUsage(missing), { tracks: 0, bytes: 0 });
  assert.deepEqual(clearMusicLibrary(missing), { tracks: 0, bytes: 0 });
  assert.deepEqual(sweepMusicLibrary(new Set(), missing), []);
  assert.deepEqual(tidyMusicLibrary(missing), []);
  assert.equal(fs.existsSync(missing), false, "and none is made by asking");
});

test("startup removes cut-short downloads, makes the index agree with the folder, then applies the limit", () => {
  const kept = "a".repeat(64);
  const lost = "b".repeat(64);
  const found = "c".repeat(64);
  fs.writeFileSync(path.join(dir, `${kept}.mp3`), Buffer.alloc(600));
  fs.writeFileSync(path.join(dir, `${found}.ogg`), Buffer.alloc(600));
  const longAgo = new Date(Date.now() - 86_400_000);
  fs.utimesSync(path.join(dir, `${found}.ogg`), longAgo, longAgo);
  fs.writeFileSync(path.join(dir, `${kept}.999.x.tmp`), "cut short by a crash");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a track: left alone");
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
    [kept]: { type: "mp3", bytes: 1, playedAt: Date.now(), ids: ["theme"], previewed: false },
    [lost]: { type: "mp3", bytes: 500, playedAt: 5, ids: ["gone"], previewed: false },
  }));

  assert.deepEqual(tidyMusicLibrary(dir, 10_000), []);
  assert.deepEqual(names(), [`${kept}.mp3`, `${found}.ogg`, "index.json", "notes.txt"].sort());
  const index = indexOf();
  assert.deepEqual(Object.keys(index).sort(), [kept, found]);
  assert.equal(index[kept].bytes, 600, "the size is the file's");
  assert.deepEqual(index[kept].ids, ["theme"]);
  assert.deepEqual([index[found].type, index[found].bytes, index[found].ids], ["ogg", 600, []], "a file with no entry is taken in as nobody's");
  // The limit: the one played longest ago (the file found, dated by its own time) goes.
  assert.deepEqual(tidyMusicLibrary(dir, 1000), [found]);
  assert.deepEqual(names(), [`${kept}.mp3`, "index.json", "notes.txt"].sort());
});

// ---- the routes, against the real server ------------------------------------------------

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// A kept track is served without touching the network, which is what lets this run offline.
test("the server serves a kept track with byte ranges and its audio type, says how much is kept, and clears it", async () => {
  const port = await freePort();
  const musicDir = path.join(dir, "music");
  fs.mkdirSync(musicDir);
  const bytes = Buffer.concat([Buffer.from("OggS"), Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz")]);
  const sha256 = sha256Of(bytes);
  fs.writeFileSync(path.join(musicDir, `${sha256}.ogg`), bytes);
  fs.writeFileSync(path.join(musicDir, "index.json"), JSON.stringify({
    [sha256]: { type: "ogg", bytes: bytes.length, playedAt: 5, ids: ["theme"], previewed: false },
  }));
  fs.writeFileSync(path.join(musicDir, `${sha256}.999.x.tmp`), "cut short by a crash");

  const child = spawn(process.execPath, [path.join(SERVER_DIR, "server.js")], {
    env: { ...process.env, OH_DATA_DIR: dir, PORT: String(port) },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const local = (route, init = {}) => fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { Origin: `http://127.0.0.1:${port}`, ...init.headers } });
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        if ((await local("/api/music")).ok) break;
      } catch { /* not up yet */ }
      if (attempt > 100 || child.exitCode !== null) throw new Error("server did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.equal(fs.existsSync(path.join(musicDir, `${sha256}.999.x.tmp`)), false, "swept at startup");
    assert.deepEqual(await (await local("/api/music")).json(), { tracks: 1, bytes: bytes.length });

    // The whole file, as an <audio> first asks for it.
    const address = `/api/music/${sha256}?url=${encodeURIComponent(`${RELEASES}/music/theme.ogg`)}&track=theme-in-another-scenario`;
    const whole = await local(address);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get("content-type"), "audio/ogg");
    assert.equal(whole.headers.get("accept-ranges"), "bytes");
    assert.equal(whole.headers.get("content-length"), String(bytes.length));
    assert.equal(whole.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes);

    // A range from the middle, an open-ended one, and the last bytes: what seeking asks for.
    const middle = await local(address, { headers: { Range: "bytes=4-13" } });
    assert.equal(middle.status, 206);
    assert.equal(middle.headers.get("content-range"), `bytes 4-13/${bytes.length}`);
    assert.equal(middle.headers.get("content-length"), "10");
    assert.equal(middle.headers.get("content-type"), "audio/ogg");
    assert.equal(await middle.text(), "0123456789");
    const rest = await local(address, { headers: { Range: "bytes=30-" } });
    assert.equal(rest.status, 206);
    assert.equal(rest.headers.get("content-range"), `bytes 30-${bytes.length - 1}/${bytes.length}`);
    assert.equal(await rest.text(), "qrstuvwxyz");
    const tail = await local(address, { headers: { Range: "bytes=-3" } });
    assert.equal(tail.status, 206);
    assert.equal(await tail.text(), "xyz");
    const past = await local(address, { headers: { Range: `bytes=${bytes.length}-` } });
    assert.equal(past.status, 416);
    assert.equal(past.headers.get("content-range"), `bytes */${bytes.length}`);

    // The play was written down: now, and under the id it was asked for as.
    const index = JSON.parse(fs.readFileSync(path.join(musicDir, "index.json"), "utf8"));
    assert.deepEqual(index[sha256].ids, ["theme", "theme-in-another-scenario"]);
    assert.ok(index[sha256].playedAt > Date.now() - 60_000);

    // What is not kept is only ever fetched from the hub's releases, and only by a sha256.
    assert.equal((await local(`/api/music/${"a".repeat(64)}?url=${encodeURIComponent("https://evil.example/x.mp3")}`)).status, 400);
    assert.equal((await local(`/api/music/not-a-sha?url=${encodeURIComponent(`${RELEASES}/music/theme.ogg`)}`)).status, 400);
    assert.equal((await local(`/api/music/${"a".repeat(64)}`)).status, 400);

    assert.deepEqual(await (await local("/api/music", { method: "DELETE" })).json(), { tracks: 0, bytes: 0 });
    assert.deepEqual(fs.readdirSync(musicDir), ["index.json"]);
    assert.deepEqual(await (await local("/api/music")).json(), { tracks: 0, bytes: 0 });
  } finally {
    child.kill();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
  }
});

test("the routes are the proxy's own download, guarded the same, and the upkeep is for this machine only", () => {
  const server = fs.readFileSync(path.join(SERVER_DIR, "server.js"), "utf8");
  // One redirect loop for both routes that download from the hub, every hop checked against the allowlist.
  assert.equal(server.match(/await fetchHubHop\(/g).length, 1);
  // (Asked through the one guard, as on beta: GitHub's hosts, and a test's fake release only when one is set.)
  assert.match(server, /const next = new URL\(location, current\);\s*if \(!isHubDownloadUrl\(next\)\) throw hubRefusal\(400, "Scenario file redirected off GitHub\."\);/);
  assert.match(server, /app\.get\("\/api\/hub\/file", async \(req, res\) => \{[\s\S]*?const upstream = await openHubDownload\(current\);/);
  assert.match(server, /const downloadHubTrack = async \(fileUrl, destination, maxBytes\) => \{\s*const upstream = await openHubDownload\(new URL\(fileUrl\)\);[\s\S]*?return saveCappedBody\(upstream\.body, destination, maxBytes\);\s*\};/);
  assert.match(server, /const musicLibrary = createMusicLibrary\(\{ download: downloadHubTrack \}\);/);
  assert.match(server, /tidyMusicLibrary\(MUSIC_LIBRARY_DIR\);/);
  // Served from disk through the helper that answers byte ranges.
  assert.match(server, /app\.get\("\/api\/music\/:sha256", async \(req, res\) => \{[\s\S]*?streamBinaryFile\(req, res, kept\.filePath, kept\.contentType\);/);
  // How much is kept, and clearing it: loopback only.
  assert.match(server, /const refuseRemoteMusic = \(req, res\) => \{\s*if \(isLoopbackAddress\(req\.socket\?\.remoteAddress\)\) return false;\s*sendError\(res, 403,/);
  assert.match(server, /app\.get\("\/api\/music", \(req, res\) => \{\s*if \(refuseRemoteMusic\(req, res\)\) return;/);
  assert.match(server, /app\.delete\("\/api\/music", \(req, res\) => \{\s*if \(refuseRemoteMusic\(req, res\)\) return;/);
  // Its own folder in the data directory, not the hub cache.
  const library = fs.readFileSync(path.join(SERVER_DIR, "musicLibrary.js"), "utf8");
  assert.match(library, /export const MUSIC_LIBRARY_DIR = path\.join\(DATA_DIR, "music"\);/);
  assert.doesNotMatch(library, /hub-cache|hubCache\.js"/);
});

// ---- the kept music follows the scenarios (the store) ----------------------------------

const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const LIBRARY_URL = url.pathToFileURL(path.join(SERVER_DIR, "musicLibrary.js")).href;
const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

// Each case in a child process: OH_DATA_DIR is read once, at import time.
const inStore = (body) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-music-store-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const music = await import(${JSON.stringify(LIBRARY_URL)});
    const fs = await import("node:fs");
    const path = await import("node:path");
    const crypto = await import("node:crypto");
    const RELEASES = ${JSON.stringify(RELEASES)};
    const bytesOf = (name) => Buffer.concat([Buffer.from("ID3"), Buffer.from(name)]);
    const shaOf = (name) => crypto.createHash("sha256").update(bytesOf(name)).digest("hex");
    const library = music.createMusicLibrary({
      download: async (address, destination) => {
        const name = path.basename(address, ".mp3");
        fs.writeFileSync(destination, bytesOf(name));
        return bytesOf(name).length;
      },
    });
    // A game of a scenario plays a track of it, or the editor previews one.
    const play = (name, options = {}) => library.keep({ sha256: shaOf(name), url: RELEASES + "/music/" + name + ".mp3", trackId: name, ...options });
    const kept = () => Object.keys(JSON.parse(fs.readFileSync(path.join(music.MUSIC_LIBRARY_DIR, "index.json"), "utf8"))).map((sha) => ["shared", "own-a", "own-b", "tried"].find((name) => shaOf(name) === sha) ?? sha).sort();
    const musicOf = (...names) => ({ loading: [], game: names.map((id) => ({ id, version: 1 })), atWar: [], battle: [] });
    ${body}
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};
const report = (expr) => `process.stdout.write("\\n@@" + JSON.stringify(${expr}));`;

test("deleting a scenario deletes the songs only it used; a shared one stays until its last scenario goes", () => {
  const result = inStore(`
    store.createScenario({ id: "alpha", name: "Alpha", music: musicOf("shared", "own-a") });
    store.createScenario({ id: "beta", name: "Beta", music: musicOf("shared", "own-b") });
    await play("shared");
    await play("own-a");
    await play("own-b");
    await play("tried", { preview: true });
    const before = kept();
    store.deleteScenario("alpha");
    const afterFirst = kept();
    // In Recently deleted, and restored from it: the files do not come back by themselves.
    const [entry] = store.listTrash();
    store.restoreFromTrash(entry.entry);
    const afterRestore = kept();
    const restoredMusic = store.getScenarioDetails("alpha").scenario.music.game.map((track) => track.id);
    // Played again, its own song is simply downloaded again.
    const again = await play("own-a");
    store.deleteScenario("alpha");
    store.deleteScenario("beta");
    ${report("{ before, afterFirst, afterRestore, restoredMusic, againDownloaded: again.downloaded, afterBoth: kept(), files: fs.readdirSync(music.MUSIC_LIBRARY_DIR).length }")}
  `);
  assert.deepEqual(result.before, ["own-a", "own-b", "shared", "tried"]);
  assert.deepEqual(result.afterFirst, ["own-b", "shared", "tried"], "the shared track stays, the deleted scenario's own goes");
  assert.deepEqual(result.afterRestore, ["own-b", "shared", "tried"], "restoring a scenario restores no file");
  assert.deepEqual(result.restoredMusic, ["shared", "own-a"], "though it names its tracks as before");
  assert.equal(result.againDownloaded, true);
  assert.deepEqual(result.afterBoth, ["tried"], "the shared track goes with its last scenario; the previewed one survives both");
  assert.equal(result.files, 2, "the previewed track's file and the index");
});

test("a save that takes a track out, and an Update that replaces the music, sweep too; other saves do not", () => {
  const result = inStore(`
    store.createScenario({ id: "alpha", name: "Alpha", music: musicOf("shared", "own-a") });
    store.createScenario({ id: "beta", name: "Beta", music: musicOf("shared", "own-b") });
    await play("shared");
    await play("own-a");
    await play("own-b");
    // A rename, and a save that only adds a track: nothing goes.
    store.updateScenario("alpha", { name: "Alpha, renamed" });
    store.updateScenario("alpha", { music: musicOf("shared", "own-a", "another") });
    const untouched = kept();
    // The author takes "own-a" out of alpha's music.
    store.updateScenario("alpha", { music: musicOf("shared") });
    const afterSave = kept();
    // A hub Update brings a version of beta with no music at all.
    const bundle = store.exportScenarioBundle("beta");
    delete bundle.scenario.music;
    store.updateScenarioFromBundle("beta", bundle);
    const afterUpdate = kept();
    // And alpha's music is taken away altogether.
    store.updateScenario("alpha", { music: null });
    ${report("{ untouched, afterSave, afterUpdate, afterNone: kept() }")}
  `);
  assert.deepEqual(result.untouched, ["own-a", "own-b", "shared"]);
  assert.deepEqual(result.afterSave, ["own-b", "shared"]);
  assert.deepEqual(result.afterUpdate, ["shared"], "alpha still names the shared track");
  assert.deepEqual(result.afterNone, []);
});

test("a game's music is its scenario's: a game carries none, and a scenario a game uses cannot be deleted", () => {
  const result = inStore(`
    store.createScenario({ id: "alpha", name: "Alpha", music: musicOf("own-a") });
    store.createGame({ id: "saga", name: "The Saga", scenarioId: "alpha", setActive: true });
    await play("own-a");
    let refused = "";
    try { store.deleteScenario("alpha"); } catch (error) { refused = error.message; }
    const catalog = store.getLibraryCatalog();
    const details = store.getGameDetails("saga");
    ${report("{ refused, kept: kept(), runtimeMusic: catalog.runtimeScenario.music.game.map((track) => track.id), gameHasMusic: 'music' in catalog.activeGame || 'music' in details.game }")}
  `);
  assert.match(result.refused, /still used by one or more games/);
  assert.deepEqual(result.kept, ["own-a"]);
  assert.deepEqual(result.runtimeMusic, ["own-a"], "what the open game plays is read from its scenario");
  assert.equal(result.gameHasMusic, false);
});
