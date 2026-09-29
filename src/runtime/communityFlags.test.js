/*! Open Historia — community flags client tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/communityFlags.test.js
//
// The flag picker's Community tab lists dedicated flag posts and, from scenario
// posts tagged Flags-Count, one installable pack per scenario. Opening a pack
// downloads the scenario's bundle and offers its custom flags. Against a
// stubbed hub: which posts become what, and which flags a pack yields.
import test from "node:test";
import assert from "node:assert/strict";

import { zipBundle } from "./bundleZip.js";
import { fetchCommunityFlags, flagPostInstallable, loadCommunityFlagPack } from "./communityFlags.js";

const ISSUES_FLAGS = /issues\?state=open&labels=flag/;
const ISSUES_SCENARIOS = /issues\?state=open&labels=scenario/;

const files = new Map();
let flagIssues = [];
let scenarioIssues = [];

globalThis.fetch = async (input) => {
  const url = String(input);
  if (ISSUES_FLAGS.test(url)) return Response.json(flagIssues);
  if (ISSUES_SCENARIOS.test(url)) return Response.json(scenarioIssues);
  if (url.startsWith("/api/hub/file?url=")) {
    const file = files.get(decodeURIComponent(url.slice("/api/hub/file?url=".length)));
    if (!file) return Response.json({ error: "Not found on the hub." }, { status: 404 });
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

const FLAG_PNG = "https://github.com/user-attachments/assets/1111-flag.png";
const FLAG_SVG = "https://github.com/user-attachments/files/201/banner.svg";
const PACK_ZIP = "https://github.com/user-attachments/files/202/empire-scenario.zip";
const PACK_JSON = "https://github.com/user-attachments/files/203/old-empire.json";
const RED = "data:image/png;base64,UkVE";
const BLUE = "data:image/png;base64,QkxVRQ==";

const flagsAsset = (data) => ({ assets: { flags: { data, fileName: "flags.json", mode: "embedded" } } });

test("flag posts and flag-carrying scenario posts are listed as what they are", async () => {
  flagIssues = [
    issue(1, "[Flag] Red Banner", `### Flag\n![red](${FLAG_PNG})\n\nFlag-Code: rom`),
    issue(2, "[Flag] Svg Banner", `### Flag\n[banner.svg](${FLAG_SVG})`),
    issue(3, "[Flag] Nothing attached", "No image here."),
    issue(4, "[Flag] A pull request", `![x](${FLAG_PNG})`, { pull_request: {} }),
  ];
  scenarioIssues = [
    issue(10, "[Scenario] Empire", `![cover](https://github.com/user-attachments/assets/cover.png)\n[empire-scenario.zip](${PACK_ZIP})\nFlags-Count: 2`),
    issue(11, "[Scenario] No flags", "[plain.zip](https://github.com/user-attachments/files/204/plain.zip)"),
  ];
  const posts = await fetchCommunityFlags({ force: true });
  assert.deepEqual(posts.map((post) => post.id), [1, 2, "scenario-10"]);

  const [red, svg, pack] = posts;
  assert.equal(red.title, "Red Banner");
  assert.equal(red.imageUrl, FLAG_PNG);
  assert.equal(red.code, "ROM");
  assert.equal(red.official, true);
  assert.equal(svg.imageUrl, FLAG_SVG, "an attached .svg is the flag itself");
  assert.equal(pack.fromScenario, true);
  assert.equal(pack.flagCount, 2);
  assert.equal(pack.packUrl, PACK_ZIP);
  assert.equal(pack.title, "Empire");
  assert.equal(pack.imageUrl, "https://github.com/user-attachments/assets/cover.png");
  for (const post of posts) assert.equal(flagPostInstallable(post), true);
  assert.equal(flagPostInstallable({ fromScenario: true }), false);
});

test("a pack yields the scenario's custom flags, from a zip or a bare JSON bundle", async () => {
  const data = { Rome: RED, Carthage: BLUE, France: "https://flagcdn.com/fr.svg" };
  files.set(PACK_ZIP, new Uint8Array(await (await zipBundle({ "scenario.json": JSON.stringify(flagsAsset(data)) })).arrayBuffer()));
  files.set(PACK_JSON, new TextEncoder().encode(JSON.stringify(flagsAsset(data))));

  const expected = [{ code: "Rome", dataUrl: RED }, { code: "Carthage", dataUrl: BLUE }];
  assert.deepEqual(await loadCommunityFlagPack({ packUrl: PACK_ZIP }), expected, "built-in flagcdn flags are left out");
  assert.deepEqual(await loadCommunityFlagPack({ packUrl: PACK_JSON }), expected);
});

test("a pack with no custom flags, or no bundle, says so", async () => {
  const empty = "https://github.com/user-attachments/files/205/empty.json";
  files.set(empty, new TextEncoder().encode(JSON.stringify(flagsAsset({ France: "https://flagcdn.com/fr.svg" }))));
  await assert.rejects(loadCommunityFlagPack({ packUrl: empty }), /No custom flags found/);
  await assert.rejects(loadCommunityFlagPack({}), /no scenario bundle/);
  await assert.rejects(loadCommunityFlagPack({ packUrl: "https://github.com/user-attachments/files/206/gone.zip" }), /Not found on the hub/);
});
