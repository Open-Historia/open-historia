/*! Open Historia — community flags client tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/communityFlags.test.js
//
// The flag picker's Community tab lists dedicated flag posts and, from scenario
// posts tagged Flags-Count, one installable pack per scenario. Opening a pack
// downloads the scenario's bundle and offers its custom flags. Against a
// stubbed hub: which posts become what, which flags a pack yields, and that
// what is shown and what is downloaded is the checked copy in the hub's
// releases, never the post's own attachment.
import test from "node:test";
import assert from "node:assert/strict";

import { zipBundle } from "./bundleZip.js";
import {
  communityFlagsHubUrl,
  fetchCommunityFlags,
  flagPostInstallable,
  loadCommunityFlagDataUrl,
  loadCommunityFlagPack,
} from "./communityFlags.js";
import { HUB_FILE_TEXTS, HUB_INDEX_URL } from "./hubFiles.js";

const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
// A dragged-in image as GitHub writes it into a post: no extension at all.
const FLAG_PNG = "https://github.com/user-attachments/assets/1b7c4d2e-0f3a-4c59-9d61-7a8e5b2c4f10";
const FLAG_SVG = "https://github.com/user-attachments/files/201/banner.svg";
const FLAG_JPG = "https://github.com/user-attachments/assets/2c8d5e3f-1a4b-4d6a-8e72-8b9f6c3d5a21";
const FLAG_UNCHECKED = "https://github.com/user-attachments/assets/3d9e6f4a-2b5c-4e7b-9f83-9c0a7d4e6b32";
const COVER = "https://github.com/user-attachments/assets/4e0f7a5b-3c6d-4f8c-8a94-0d1b8e5f7c43";
const PACK_ZIP = "https://github.com/user-attachments/files/202/empire-scenario.zip";
const PACK_JSON = "https://github.com/user-attachments/files/203/old-empire.json";
const PACK_EMPTY = "https://github.com/user-attachments/files/205/empty.json";
const PACK_GONE = "https://github.com/user-attachments/files/206/gone.zip";
const PACK_UNCHECKED = "https://github.com/user-attachments/files/208/unchecked-scenario.zip";
const RED = "data:image/png;base64,UkVE";
const BLUE = "data:image/png;base64,QkxVRQ==";
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 2]);

// Each file as its post names it, and its checked copy in the hub's releases.
// An .svg's copy is a PNG: the hub draws one of every SVG it is given.
const COPIES = {
  [FLAG_PNG]: `${RELEASES}/flags-1/p1-1b7c4d2e-0a0a0a0a.png`,
  [FLAG_SVG]: `${RELEASES}/flags-1/p2-201-banner-1b1b1b1b.png`,
  [FLAG_JPG]: `${RELEASES}/flags-1/p5-2c8d5e3f.jpg`,
  [COVER]: `${RELEASES}/scenarios-1/p10-4e0f7a5b.png`,
  [PACK_ZIP]: `${RELEASES}/scenarios-1/p10-202-empire-scenario-4e4e4e4e.zip`,
  [PACK_JSON]: `${RELEASES}/scenarios-1/p12-203-old-empire-5f5f5f5f.json`,
  [PACK_EMPTY]: `${RELEASES}/scenarios-1/p14-205-empty-7b7b7b7b.json`,
  [PACK_GONE]: `${RELEASES}/scenarios-1/p15-206-gone-8c8c8c8c.zip`,
};

// What the stubbed hub serves, by address; every download is recorded.
const files = new Map([
  [COPIES[FLAG_PNG], PNG_BYTES],
  [COPIES[FLAG_SVG], PNG_BYTES],
  [COPIES[FLAG_JPG], JPG_BYTES],
  // The attachments themselves, so a test can see that nothing asks for one.
  [FLAG_PNG, PNG_BYTES],
  [FLAG_UNCHECKED, PNG_BYTES],
]);
const downloads = [];
const fetched = [];
let flagIssues = [];
let scenarioIssues = [];

globalThis.fetch = async (input) => {
  const url = String(input);
  fetched.push(url);
  if (url === HUB_INDEX_URL) {
    return Response.json({
      version: 2,
      files: COPIES,
      imports: {},
      posts: [...flagIssues.map((entry) => ({ ...entry, kind: "flag" })), ...scenarioIssues.map((entry) => ({ ...entry, kind: "scenario" }))],
      suggestions: {},
    });
  }
  if (url.startsWith("/api/hub/file?url=")) {
    const target = decodeURIComponent(url.slice("/api/hub/file?url=".length));
    downloads.push(target);
    const file = files.get(target);
    if (!file) return Response.json({ error: "Not found on the hub." }, { status: 404 });
    // As GitHub serves a release file, whatever it is.
    return new Response(file, { headers: { "content-type": "application/octet-stream" } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const issue = (number, title, body, extra = {}) => ({
  number,
  title,
  body,
  user: { login: `author${number}`, avatar_url: "" },
  html_url: `https://github.com/Open-Historia/Open-historia-scenarios/issues/${number}`,
  created_at: "2026-09-01T00:00:00Z",
  author_association: number === 1 ? "OWNER" : "NONE",
  reactions: { "+1": 2 },
  ...extra,
});
// A flag post's body as the hub's form writes it.
const flagForm = (image, code = "") =>
  `### Flag name\n\nA flag\n\n### Author / credit\n\n_No response_\n\n### Flag image\n\n${image}\n\n### Technical info (do not edit)\n\nFlag-Code: ${code}`;

const flagsAsset = (data) => ({ assets: { flags: { data, fileName: "flags.json", mode: "embedded" } } });
const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

test("flag posts and flag-carrying scenario posts are listed as what they are, from the hub's own list", async () => {
  flagIssues = [
    issue(1, "[Flag] Red Banner", flagForm(`<img width="640" height="427" alt="Image" src="${FLAG_PNG}" />`, "rom")),
    // Closed by the hub once its flag was released: still a post.
    issue(2, "[Flag] Svg Banner", flagForm(`[banner.svg](${FLAG_SVG})`), { state: "closed" }),
    issue(3, "[Flag] Nothing attached", flagForm("_No response_")),
    issue(4, "[Flag] Not among the checked files", flagForm(`![x](${FLAG_UNCHECKED})`)),
  ];
  scenarioIssues = [
    issue(10, "[Scenario] Empire", `<img width="588" height="369" alt="Image" src="${COVER}" />\n\n### Description\n\nAn empire.\n\n[empire-scenario.zip](${PACK_ZIP})\nFlags-Count: 2`),
    issue(11, "[Scenario] No flags", "[plain.zip](https://github.com/user-attachments/files/204/plain.zip)"),
    issue(16, "[Scenario] Not among the checked files", `[unchecked-scenario.zip](${PACK_UNCHECKED})\nFlags-Count: 3`),
  ];
  fetched.length = 0;
  const posts = await fetchCommunityFlags({ force: true });
  assert.deepEqual(fetched, [HUB_INDEX_URL], "one read of the hub's index, and no request to GitHub's API");
  assert.deepEqual(posts.map((post) => post.id), [1, 2, "scenario-10"], "a post with no image, or none the hub has released, is not offered");

  const [red, svg, pack] = posts;
  assert.equal(red.title, "Red Banner");
  assert.equal(red.imageUrl, FLAG_PNG);
  assert.equal(red.pictureUrl, COPIES[FLAG_PNG], "the card shows the flag's checked copy");
  assert.equal(red.code, "ROM");
  assert.equal(red.official, true);
  assert.equal(svg.imageUrl, FLAG_SVG, "an attached .svg is the flag itself");
  assert.equal(svg.pictureUrl, COPIES[FLAG_SVG], "shown as the PNG the hub drew of it");
  assert.equal(svg.code, null);
  assert.equal(pack.fromScenario, true);
  assert.equal(pack.flagCount, 2);
  assert.equal(pack.packUrl, PACK_ZIP);
  assert.equal(pack.title, "Empire");
  assert.equal(pack.imageUrl, COVER);
  assert.equal(pack.pictureUrl, COPIES[COVER]);
  for (const post of posts) assert.equal(flagPostInstallable(post), true);
  assert.equal(flagPostInstallable({ fromScenario: true }), false);
  assert.match(decodeURIComponent(communityFlagsHubUrl()), /\?q=is:issue label:flag$/, "the hub's page lists closed posts too");

  // Kept as long as the index is: a second look costs no request.
  await fetchCommunityFlags();
  assert.deepEqual(fetched, [HUB_INDEX_URL]);
});

test("when the hub's list cannot be read the browser says why, and nothing is asked of GitHub's API", async () => {
  const served = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (input) => {
    asked.push(String(input));
    if (String(input) === HUB_INDEX_URL) return Response.json({ version: 1, files: COPIES, imports: {} });
    throw new Error(`unexpected fetch ${input}`);
  };
  try {
    await assert.rejects(fetchCommunityFlags({ force: true }), { message: HUB_FILE_TEXTS.notListed });
    assert.deepEqual(asked, [HUB_INDEX_URL]);
  } finally {
    globalThis.fetch = served;
    await fetchCommunityFlags({ force: true });
  }
});

test("a flag is downloaded from its checked copy, and says what it is by its bytes", async () => {
  downloads.length = 0;
  assert.equal(await loadCommunityFlagDataUrl({ imageUrl: FLAG_PNG }), dataUrl("image/png", PNG_BYTES));
  assert.equal(await loadCommunityFlagDataUrl({ imageUrl: FLAG_JPG }), dataUrl("image/jpeg", JPG_BYTES), "not a PNG because GitHub called it a plain download");
  assert.equal(await loadCommunityFlagDataUrl({ imageUrl: FLAG_SVG }), dataUrl("image/png", PNG_BYTES), "the .svg's copy is a PNG");
  assert.deepEqual(downloads, [COPIES[FLAG_PNG], COPIES[FLAG_JPG], COPIES[FLAG_SVG]], "never the post's own attachment");

  await assert.rejects(loadCommunityFlagDataUrl({ imageUrl: FLAG_UNCHECKED }), { message: HUB_FILE_TEXTS.notReleased });
  await assert.rejects(loadCommunityFlagDataUrl({}), /no flag image/);
  assert.equal(downloads.length, 3, "a flag the hub has not released is not downloaded from its post instead");
});

test("a pack yields the scenario's custom flags, from a zip or a bare JSON bundle", async () => {
  const data = { Rome: RED, Carthage: BLUE, France: "https://flagcdn.com/fr.svg" };
  files.set(COPIES[PACK_ZIP], new Uint8Array(await (await zipBundle({ "scenario.json": JSON.stringify(flagsAsset(data)) })).arrayBuffer()));
  files.set(COPIES[PACK_JSON], new TextEncoder().encode(JSON.stringify(flagsAsset(data))));

  const expected = [{ code: "Rome", dataUrl: RED }, { code: "Carthage", dataUrl: BLUE }];
  downloads.length = 0;
  assert.deepEqual(await loadCommunityFlagPack({ packUrl: PACK_ZIP }), expected, "built-in flagcdn flags are left out");
  assert.deepEqual(await loadCommunityFlagPack({ packUrl: PACK_JSON }), expected);
  assert.deepEqual(downloads, [COPIES[PACK_ZIP], COPIES[PACK_JSON]], "the scenario's checked copy, not its attachment");
});

test("a pack with no custom flags, no bundle, or no checked copy says so", async () => {
  files.set(COPIES[PACK_EMPTY], new TextEncoder().encode(JSON.stringify(flagsAsset({ France: "https://flagcdn.com/fr.svg" }))));
  await assert.rejects(loadCommunityFlagPack({ packUrl: PACK_EMPTY }), /No custom flags found/);
  await assert.rejects(loadCommunityFlagPack({}), /no scenario bundle/);
  // A copy the hub lists and no longer has: the download's own failure.
  await assert.rejects(loadCommunityFlagPack({ packUrl: PACK_GONE }), /Not found on the hub/);
  await assert.rejects(loadCommunityFlagPack({ packUrl: PACK_UNCHECKED }), { message: HUB_FILE_TEXTS.notReleased });
});
