/*! Open Historia — a hub track, played from the copy kept on this device: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/keptMusic.test.js
//
// "Make it so if you already have a song downloaded from another scenario, it
// doesnt redownload it for you when another scenario uses the same song."
//
// The page's side of it (the server's is server/musicLibrary.test.js): where
// a track is played from on each platform; the website's store, against a
// stand-in for the browser's Cache Storage, keeping a track by its sha256 so
// that the same song asked for under another id or another address is fetched
// once; what happens when it cannot be kept; the limit; and the sweep that
// follows the scenarios.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KEPT_MUSIC_CACHE,
  KEPT_MUSIC_WEB_MAX_BYTES,
  clearKeptMusic,
  createKeptMusicStore,
  keptMusicAddress,
  keptMusicUsage,
  releaseMusicAddress,
  resetKeptMusicForTests,
  sweepKeptMusic,
} from "./keptMusic.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
const sha256Of = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

const mp3 = (seed, size = 2000) => Buffer.concat([Buffer.from("ID3\u0004"), Buffer.alloc(size, seed)]);
const ogg = (seed, size = 2000) => Buffer.concat([Buffer.from("OggS"), Buffer.alloc(size, seed)]);

// A track as the hub's list has it (hubMusic.js normalizeHubMusic).
const hubTrack = (id, bytes, extra = {}) => ({
  id,
  name: `Name of ${id}`,
  file: `${RELEASES}/music/${id}-v1.mp3`,
  type: "mp3",
  bytes: bytes.length,
  sha256: sha256Of(bytes),
  removed: false,
  ...extra,
});

// The browser's Cache Storage, standing in: one cache, its entries by address.
const shelfOf = () => {
  const entries = new Map();
  return {
    entries,
    match: async (key) => {
      const kept = entries.get(key);
      return kept ? new Response(kept.bytes, { headers: kept.headers }) : undefined;
    },
    put: async (key, response) => {
      entries.set(key, { bytes: Buffer.from(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) });
    },
    delete: async (key) => entries.delete(key),
  };
};
const keptIn = (shelf) => [...shelf.entries.keys()].filter((key) => !key.endsWith("index.json")).map((key) => key.split("/").pop()).sort();
const indexIn = (shelf) => JSON.parse(shelf.entries.get("/kept-music/index.json").bytes.toString("utf8"));

// The hub, standing in for the fetch: what is at each address, and how often each was asked for.
const hub = (files) => {
  const asked = [];
  const fetchFile = async (address) => {
    asked.push(address);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const bytes = files[address];
    return bytes ? new Response(bytes, { status: 200 }) : new Response("gone", { status: 404 });
  };
  return { asked, fetchFile };
};

// A store on `shelf`, with blob addresses that can be counted.
const storeOn = (shelf, { files = {}, now = () => 1000, maxBytes } = {}) => {
  const source = hub(files);
  const urls = { made: [], revoked: [] };
  const store = createKeptMusicStore({
    openShelf: async () => shelf,
    fetchFile: source.fetchFile,
    makeUrl: (blob) => { const url = `blob:test/${urls.made.length + 1}`; urls.made.push({ url, size: blob.size, type: blob.type }); return url; },
    revokeUrl: (url) => urls.revoked.push(url),
    now,
    ...(maxBytes ? { maxBytes } : {}),
  });
  return { store, urls, asked: source.asked };
};

// ---- the website's store --------------------------------------------------------------

test("the same song asked for under two ids and two addresses is fetched once, and played from the kept copy", async () => {
  const bytes = mp3(7);
  const first = hubTrack("theme", bytes);
  // Another scenario's track: another id, listed at another address, the same recording.
  const second = hubTrack("the-same-song", bytes, { file: `${RELEASES}/music-2/the-same-song.mp3` });
  assert.equal(first.sha256, second.sha256);
  const shelf = shelfOf();
  let now = 1000;
  const { store, urls, asked } = storeOn(shelf, { files: { [first.file]: bytes, [second.file]: bytes }, now: () => now });

  const firstUrl = await store.address(first);
  assert.equal(firstUrl, "blob:test/1");
  assert.deepEqual(urls.made[0], { url: "blob:test/1", size: bytes.length, type: "audio/mpeg" });
  assert.deepEqual(asked, [first.file]);
  assert.deepEqual(keptIn(shelf), [first.sha256], "kept by what it is");

  now = 5000;
  const secondUrl = await store.address(second);
  assert.equal(secondUrl, "blob:test/2", "an address of its own, from the same kept copy");
  assert.deepEqual(urls.made[1], { url: "blob:test/2", size: bytes.length, type: "audio/mpeg" });
  assert.deepEqual(asked, [first.file], "no second request to the hub");
  assert.deepEqual(indexIn(shelf)[first.sha256], { type: "mp3", bytes: bytes.length, playedAt: 5000, ids: ["theme", "the-same-song"], previewed: false });
  assert.deepEqual(await store.usage(), { tracks: 1, bytes: bytes.length });

  // Another day, another page: the cache is all it takes.
  const later = storeOn(shelf, { files: {} });
  assert.equal(await later.store.address(second), "blob:test/1");
  assert.deepEqual(later.asked, []);
  assert.deepEqual(await later.store.usage(), { tracks: 1, bytes: bytes.length });
});

test("two plays of the same missing track at once share one fetch; an Ogg file is kept as one", async () => {
  const bytes = ogg(2);
  const track = hubTrack("horns", bytes, { file: `${RELEASES}/music/horns.ogg`, type: "ogg" });
  const shelf = shelfOf();
  const { store, urls, asked } = storeOn(shelf, { files: { [track.file]: bytes } });
  const [one, two] = await Promise.all([store.address(track), store.address({ ...track, id: "horns-elsewhere" })]);
  assert.deepEqual(asked, [track.file]);
  assert.notEqual(one, two);
  assert.deepEqual(urls.made.map((made) => made.type), ["audio/ogg", "audio/ogg"]);
  assert.deepEqual(indexIn(shelf)[track.sha256].ids, ["horns", "horns-elsewhere"]);
  assert.equal(shelf.entries.get(`/kept-music/${track.sha256}`).headers["content-type"], "audio/ogg");
});

test("a file that is not the one the hub's list describes is not kept, nor one that cannot be fetched or is too large", async () => {
  const bytes = mp3(1);
  const shelf = shelfOf();
  const lying = hubTrack("theme", bytes, { sha256: "f".repeat(64) });
  const gone = hubTrack("gone", mp3(2));
  const { store, urls, asked } = storeOn(shelf, { files: { [lying.file]: bytes } });
  await assert.rejects(store.address(lying), /not the one that was asked for/);
  await assert.rejects(store.address(gone), /HTTP 404/);
  assert.deepEqual(keptIn(shelf), []);
  assert.deepEqual(urls.made, [], "no address is made of what was not kept");
  assert.deepEqual(await store.usage(), { tracks: 0, bytes: 0 });
  // A failure is not remembered.
  await assert.rejects(store.address(gone), /HTTP 404/);
  assert.deepEqual(asked, [lying.file, gone.file, gone.file]);

  // Too large by what the hub says of it, before a byte is read.
  const huge = hubTrack("huge", mp3(3));
  const declared = createKeptMusicStore({
    openShelf: async () => shelf,
    fetchFile: async () => new Response("x", { status: 200, headers: { "Content-Length": String(26 * 1024 * 1024) } }),
    makeUrl: () => "blob:never",
    revokeUrl: () => {},
  });
  await assert.rejects(declared.address(huge), /too large/);

  // Nothing to keep it by, or nowhere the hub's: no kept copy, and no error.
  assert.equal(await store.address({ ...hubTrack("no-sha", bytes), sha256: "" }), "");
  assert.equal(await store.address({ ...hubTrack("elsewhere", bytes), file: "https://evil.example/x.mp3" }), "");
  assert.equal(await store.address({ ...hubTrack("taken-down", bytes), removed: true }), "");
  assert.equal(await store.address(null), "");
});

test("past the limit the tracks played longest ago make room; a play moves a track to the back of the queue", async () => {
  const tracks = ["a", "b", "c"].map((id, index) => hubTrack(id, mp3(index + 1, 1000)));
  const [a, b, c] = tracks;
  const files = Object.fromEntries(tracks.map((track, index) => [track.file, mp3(index + 1, 1000)]));
  const shelf = shelfOf();
  let now = 1000;
  // Room for two of them.
  const { store } = storeOn(shelf, { files, now: () => now, maxBytes: 2100 });
  await store.address(a);
  now = 2000;
  await store.address(b);
  now = 3000;
  await store.address(a);
  now = 4000;
  await store.address(c);
  assert.deepEqual(keptIn(shelf), [a.sha256, c.sha256].sort(), "b was played longest ago");
  assert.deepEqual(Object.keys(indexIn(shelf)).sort(), [a.sha256, c.sha256].sort());
  assert.equal(KEPT_MUSIC_WEB_MAX_BYTES, 300 * 1024 * 1024);
});

test("the sweep deletes what no scenario names any more and leaves what was only previewed; Clear empties it all", async () => {
  const shared = hubTrack("shared", mp3(1));
  const own = hubTrack("own", mp3(2));
  const tried = hubTrack("tried", mp3(3));
  const files = { [shared.file]: mp3(1), [own.file]: mp3(2), [tried.file]: mp3(3) };
  const shelf = shelfOf();
  const { store, asked } = storeOn(shelf, { files });
  await store.address(shared);
  await store.address(own);
  // The scenario editor's preview keeps the track, and makes it nobody's.
  await store.address(tried, { preview: true });
  assert.deepEqual(indexIn(shelf)[tried.sha256].ids, []);
  assert.equal(indexIn(shelf)[tried.sha256].previewed, true);

  assert.deepEqual(await store.sweep(new Set(["shared", "own"])), []);
  assert.deepEqual(await store.sweep(new Set(["shared"])), [own.sha256]);
  assert.deepEqual(keptIn(shelf), [shared.sha256, tried.sha256].sort());
  assert.deepEqual(await store.sweep(new Set()), [shared.sha256]);
  assert.deepEqual(keptIn(shelf), [tried.sha256], "the previewed track survives: the limit sees to it");
  // Swept, it is downloaded again the next time a game plays it.
  await store.address(own);
  assert.deepEqual(asked, [shared.file, own.file, tried.file, own.file]);

  assert.deepEqual(await store.clear(), { tracks: 0, bytes: 0 });
  assert.deepEqual(keptIn(shelf), []);
  assert.deepEqual(await store.usage(), { tracks: 0, bytes: 0 });
});

test("a blob address is given back once, and only this store's own", async () => {
  const bytes = mp3(5);
  const track = hubTrack("theme", bytes);
  const { store, urls } = storeOn(shelfOf(), { files: { [track.file]: bytes } });
  const url = await store.address(track);
  store.release("blob:somebody-elses");
  store.release("/api/hub/file?url=x");
  assert.deepEqual(urls.revoked, []);
  store.release(url);
  store.release(url);
  assert.deepEqual(urls.revoked, [url]);
});

test("with no cache to keep it in, the store answers with nothing and keeps nothing", async () => {
  const bytes = mp3(6);
  const track = hubTrack("theme", bytes);
  const source = hub({ [track.file]: bytes });
  const store = createKeptMusicStore({ openShelf: async () => null, fetchFile: source.fetchFile, makeUrl: () => "blob:never", revokeUrl: () => {} });
  assert.equal(await store.address(track), "");
  assert.equal(await store.usage(), null);
  assert.equal(await store.clear(), null);
  assert.deepEqual(await store.sweep(new Set()), []);
  assert.deepEqual(source.asked, [], "and nothing is fetched to be thrown away");
});

// ---- where a track is played from, by platform -----------------------------------------------

test("the desktop app and the local server: the server's kept copy, by sha256, with the hub's file and the track's id", async () => {
  const bytes = mp3(1);
  const track = hubTrack("theme", bytes);
  const encoded = encodeURIComponent(track.file);
  assert.equal(await keptMusicAddress(track, { env: {} }), `/api/music/${track.sha256}?url=${encoded}&track=theme`);
  // The scenario editor's preview says so, which keeps the track without making it a scenario's.
  assert.equal(await keptMusicAddress(track, { env: {}, preview: true }), `/api/music/${track.sha256}?url=${encoded}&track=theme&preview=1`);
  // The list as the director holds it carries the same two things (scenarioMusic.js resolveScenarioPlaylists).
  assert.equal(await keptMusicAddress({ id: "theme", src: "/whatever", file: track.file, sha256: track.sha256.toUpperCase() }, { env: {} }), `/api/music/${track.sha256}?url=${encoded}&track=theme`);
  // No sha256 on the hub's list: the address every hub file is fetched from, as before.
  assert.equal(await keptMusicAddress({ ...track, sha256: "" }, { env: {} }), `/api/hub/file?url=${encoded}`);
  // Taken down, or not in the hub's releases: never played.
  assert.equal(await keptMusicAddress({ ...track, removed: true }, { env: {} }), "");
  assert.equal(await keptMusicAddress({ ...track, file: "https://evil.example/x.mp3" }, { env: {} }), "");
  assert.equal(await keptMusicAddress(null, { env: {} }), "");
});

// The website, with the browser's own things standing in.
const withBrowser = async ({ caches, files = {} }, run) => {
  const priorCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const priorFetch = globalThis.fetch;
  const asked = [];
  if (caches === undefined) delete globalThis.caches;
  else Object.defineProperty(globalThis, "caches", { value: caches, configurable: true, writable: true });
  globalThis.fetch = async (address, init = {}) => {
    asked.push(`${init.method || "GET"} ${address}`);
    const bytes = files[String(address)];
    return bytes ? new Response(bytes, { status: 200 }) : new Response("{}", { status: 404 });
  };
  resetKeptMusicForTests();
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorCaches) Object.defineProperty(globalThis, "caches", priorCaches);
    else delete globalThis.caches;
    resetKeptMusicForTests();
  }
};
const WEB = { VITE_OH_WEB: "1", VITE_OH_HUB_URL: "https://hub-proxy.example/" };

test("the website: fetched through the hub proxy's route once, kept in a cache of its own, played from a blob address", async () => {
  const bytes = mp3(4);
  const track = hubTrack("theme", bytes);
  const proxied = `/api/hub/file?url=${encodeURIComponent(track.file)}`;
  const shelf = shelfOf();
  const opened = [];
  const caches = { open: async (name) => { opened.push(name); return shelf; } };
  await withBrowser({ caches, files: { [proxied]: bytes } }, async (asked) => {
    const first = await keptMusicAddress(track, { env: WEB });
    assert.match(first, /^blob:/);
    assert.deepEqual(asked, [`GET ${proxied}`], "the route every hub file takes on the website");
    assert.ok(opened.every((name) => name === KEPT_MUSIC_CACHE) && opened.length > 0);
    assert.deepEqual(keptIn(shelf), [track.sha256]);

    const again = await keptMusicAddress({ ...track, id: "in-another-scenario" }, { env: WEB });
    assert.match(again, /^blob:/);
    assert.notEqual(again, first);
    assert.deepEqual(asked, [`GET ${proxied}`], "the second scenario fetches nothing");
    assert.deepEqual(await keptMusicUsage({ env: WEB }), { tracks: 1, bytes: bytes.length });

    // Given back when its <audio> has moved on; an address that is not a blob is nobody's to revoke.
    releaseMusicAddress(first);
    releaseMusicAddress("/api/hub/file?url=x");
    await assert.rejects(fetchBlob(first), "the first address no longer leads anywhere");
    assert.equal((await fetchBlob(again)).length, bytes.length, "the other one still plays");

    // The library's own store tells it what is in use (web/libraryStore.js).
    assert.deepEqual(await sweepKeptMusic(new Set(["theme"])), []);
    assert.deepEqual(await sweepKeptMusic(new Set()), [track.sha256]);
    assert.deepEqual(await keptMusicUsage({ env: WEB }), { tracks: 0, bytes: 0 });
    await keptMusicAddress(track, { env: WEB });
    assert.deepEqual(await clearKeptMusic({ env: WEB }), { tracks: 0, bytes: 0 });
    assert.deepEqual(keptIn(shelf), []);
  });
});
// What a blob address made by this process leads to (node resolves its own blob: addresses).
const fetchBlob = async (address) => {
  const { resolveObjectURL } = await import("node:buffer");
  const blob = resolveObjectURL(address);
  if (!blob) throw new Error("revoked");
  return Buffer.from(await blob.arrayBuffer());
};

test("where it cannot be kept, the music still plays: from the address every hub file is played from", async () => {
  const bytes = mp3(8);
  const track = hubTrack("theme", bytes);
  const direct = `https://hub-proxy.example/hub/file?url=${encodeURIComponent(track.file)}`;
  const proxied = `/api/hub/file?url=${encodeURIComponent(track.file)}`;

  // No Cache Storage at all: the Android app, whose page is served from an http address.
  await withBrowser({ caches: undefined, files: { [proxied]: bytes } }, async (asked) => {
    assert.equal(await keptMusicAddress(track, { env: { ...WEB, VITE_OH_NATIVE: "1" } }), direct);
    assert.deepEqual(asked, [], "nothing is fetched to be thrown away");
    assert.equal(await keptMusicUsage({ env: WEB }), null, "and Settings has nothing to show");
    assert.equal(await clearKeptMusic({ env: WEB }), null);
    assert.deepEqual(await sweepKeptMusic(new Set()), []);
  });
  // A cache that will not open (a private window that refuses it).
  await withBrowser({ caches: { open: async () => { throw new Error("denied"); } }, files: { [proxied]: bytes } }, async () => {
    assert.equal(await keptMusicAddress(track, { env: WEB }), direct);
  });
  // The fetch fails, or brings another file than the hub's list describes.
  const shelf = shelfOf();
  await withBrowser({ caches: { open: async () => shelf }, files: {} }, async (asked) => {
    assert.equal(await keptMusicAddress(track, { env: WEB }), direct);
    assert.deepEqual(asked, [`GET ${proxied}`]);
  });
  await withBrowser({ caches: { open: async () => shelf }, files: { [proxied]: mp3(9) } }, async () => {
    assert.equal(await keptMusicAddress(track, { env: WEB }), direct);
    assert.deepEqual(keptIn(shelf), [], "and the wrong file is not kept");
  });
  // No hub proxy configured: nothing to play it from, as before.
  await withBrowser({ caches: { open: async () => shelf }, files: {} }, async () => {
    assert.equal(await keptMusicAddress(track, { env: { VITE_OH_WEB: "1" } }), "");
  });
});

test("Settings asks the server how much it keeps, and to clear it; a server that will not say is nothing to show", async () => {
  await withBrowser({ caches: undefined }, async (asked) => {
    globalThis.fetch = async (address, init = {}) => {
      asked.push(`${init.method || "GET"} ${address}`);
      return new Response(JSON.stringify(init.method === "DELETE" ? { tracks: 0, bytes: 0 } : { tracks: 3, bytes: 9000 }), { status: 200 });
    };
    assert.deepEqual(await keptMusicUsage({ env: {} }), { tracks: 3, bytes: 9000 });
    assert.deepEqual(await clearKeptMusic({ env: {} }), { tracks: 0, bytes: 0 });
    assert.deepEqual(asked, ["GET /api/music", "DELETE /api/music"]);
    // Asked from another machine, the server answers 403: no row, and no error.
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Only the machine running the server can manage its downloaded music." }), { status: 403 });
    assert.equal(await keptMusicUsage({ env: {} }), null);
    assert.equal(await clearKeptMusic({ env: {} }), null);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await keptMusicUsage({ env: {} }), null);
    assert.equal(await clearKeptMusic({ env: {} }), null);
  });
});

// ---- where it is wired, read from the source ------------------------------------------------

test("the director, the editor's preview and Settings all go through this one function's module", () => {
  const director = read("src/runtime/ambientMusic.js");
  assert.ok(director.includes("trackAddress: (track) => keptMusicAddress(track, { env }),"));
  assert.ok(director.includes("releaseAddress: releaseMusicAddress,"));
  // The director itself knows no platform: no build flag, no route, no cache.
  assert.ok(!/VITE_OH_|\/api\/|caches\b|createObjectURL/.test(director));
  const panel = read("src/Game/GameUI/ScenarioMusicPanel.jsx");
  assert.ok(panel.includes("keptMusicAddress(track, { preview: true }).then((src) => {"));
  assert.ok(panel.includes("if (before && before !== src) releaseMusicAddress(before);"));
  assert.ok(panel.includes("releaseMusicAddress(heldRef.current);"), "and when the tab goes away");

  const settings = read("src/Game/GameUI/settings.jsx");
  const row = settings.slice(settings.indexOf("const DownloadedMusic = () => {"), settings.indexOf("const SoundSection = "));
  assert.ok(row.includes("keptMusicUsage().then((next) => { if (shown) setUsage(next); });"));
  // Each sentence whole, with one for a single track and one for none.
  assert.ok(row.includes("? \"Downloaded music: none\""));
  assert.ok(row.includes("? `Downloaded music: 1 track, ${size}`"));
  assert.ok(row.includes(": `Downloaded music: ${count} tracks, ${size}`}"));
  assert.ok(row.includes("if (!window.confirm(\"Delete the music downloaded to this device? It will be downloaded again when a scenario plays it.\")) return;"));
  assert.ok(row.includes("const left = await clearKeptMusic();"));
  // A grey button, like the ones around it.
  assert.match(row, /style=\{\{ \.\.\.diagnosticsButton, opacity: busy \|\| count === 0 \? 0\.5 : 1, whiteSpace: "nowrap" \}\}\s*>\s*Clear\s*<\/button>/);
  // Under the volume, in Sound.
  const sound = settings.slice(settings.indexOf("const SoundSection = "));
  assert.ok(sound.indexOf("aria-label=\"Music volume\"") < sound.indexOf("<DownloadedMusic />"));
  assert.ok(sound.indexOf("<DownloadedMusic />") < sound.indexOf("released under CC BY 4.0:"));
});

test("the page's start-up sweep of old caches leaves the kept music", () => {
  const assets = read("src/runtime/assets.js");
  assert.ok(assets.includes(`const KEPT_MUSIC_CACHE_NAME = "${KEPT_MUSIC_CACHE}";`), "the same name in both files");
  // (And the saves brought across from the site's old address, runtime/web/saveMove.js, and the
  // translation model, runtime/translationWorker.js.)
  assert.ok(assets.includes("if (key !== PRELOAD_CACHE_NAME && key !== KEPT_MUSIC_CACHE_NAME && key !== SAVE_MOVE_CACHE_NAME && key !== TRANSLATION_MODEL_CACHE_NAME) caches.delete(key).catch(() => {});"));
  assert.equal(KEPT_MUSIC_CACHE, "oh-music-v1");
});
